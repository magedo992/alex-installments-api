import 'dotenv/config';
import ExcelJS from 'exceljs';
import { Pool } from 'pg';
import {
  asText,
  buildColumnMap,
  cellValue,
  headerScore,
  normalizeArabic,
  parseDate,
  parseNumber,
  parsePhones,
  parseSaleStatus,
  Phone,
} from './import-helpers';

const CONCURRENCY = 10;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: CONCURRENCY + 2,
});

type ParsedRow = {
  rowNum: number;
  invoice: string;
  customerCode: string;
  customerName: string;
  branchId: number;
  itemDetails: string;
  cash: number;
  down: number;
  installment: number;
  count: number;
  discount: number;
  deliveryDate: string;
  firstDate: string;
  dueDay: number;
  collectionType: string | null;
  status: string;
  area: string | null;
  housing: string | null;
  custPhones: Phone[];
  gName: string | null;
  gPhones: Phone[];
  payments: Array<{ amount: number; month: string }>;
  note: string | null;
};

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npx tsx import-excel.ts <path-to-file.xlsx>');
    process.exit(1);
  }

  console.log('Reading Excel file...');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet('التحصيل') ?? workbook.worksheets[0];

  let headerRowIdx = 1;
  let bestScore = -1;
  for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
    const vals = (sheet.getRow(r).values as unknown[]).slice(1);
    const score = headerScore(vals);
    if (score > bestScore) {
      bestScore = score;
      headerRowIdx = r;
    }
  }

  const headerVals = (sheet.getRow(headerRowIdx).values as unknown[]).slice(1);
  const colMap = buildColumnMap(headerVals);

  // تحميل الفروع + الفواتير اللي اترفعت قبل كده عشان نتخطاها
  const [branchRes, existingRes] = await Promise.all([
    pool.query<{ id: number; name: string }>('SELECT id, name FROM branches'),
    pool.query<{ invoice_number: string }>('SELECT invoice_number FROM sales'),
  ]);

  const branchMap = new Map(branchRes.rows.map((b) => [normalizeArabic(b.name), b.id]));
  const existingInvoices = new Set(existingRes.rows.map((r) => r.invoice_number));
  console.log(`Already in DB: ${existingInvoices.size} sales (will skip them)`);

  const rejected: Array<{ row: number; invoice: string | null; reason: string }> = [];
  const byCustomer = new Map<string, ParsedRow[]>();
  let totalToImport = 0;

  for (let r = headerRowIdx + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const get = (col?: number) => (col ? cellValue(row.getCell(col).value) : null);

    const invoice = asText(get(colMap.fields.invoice));
    const customerCode = asText(get(colMap.fields.customerCode));
    const customerName = asText(get(colMap.fields.customerName));
    if (!invoice && !customerCode && !customerName) continue;
    if (invoice && existingInvoices.has(invoice)) continue;

    if (!invoice || !customerCode || !customerName) {
      rejected.push({ row: r, invoice, reason: 'Missing invoice, customerCode, or customerName' });
      continue;
    }

    const branchName = normalizeArabic(asText(get(colMap.fields.branch)) ?? '');
    const branchId = branchMap.get(branchName);
    if (!branchId) {
      rejected.push({ row: r, invoice, reason: `Unknown branch: ${branchName}` });
      continue;
    }

    const installment = parseNumber(get(colMap.fields.installment));
    const count = parseNumber(get(colMap.fields.installmentsCount));
    const firstDate = parseDate(get(colMap.fields.firstInstallmentDate));
    const deliveryDate = parseDate(get(colMap.fields.deliveryDate)) ?? firstDate;

    if (!installment.ok || !installment.value || !count.ok || !count.value || !firstDate || !deliveryDate) {
      rejected.push({ row: r, invoice, reason: 'Invalid installment, count, or dates' });
      continue;
    }

    const dueDayParsed = parseNumber(get(colMap.fields.dueDay));
    const dueDay = dueDayParsed.ok && dueDayParsed.value ? dueDayParsed.value : Number(firstDate.slice(8, 10));
    const cash = parseNumber(get(colMap.fields.cash));
    const down = parseNumber(get(colMap.fields.down));
    const discount = parseNumber(get(colMap.fields.discount));

    const payments: Array<{ amount: number; month: string }> = [];
    for (const m of colMap.months) {
      const amt = parseNumber(get(m.col));
      if (amt.ok && amt.value && amt.value > 0) {
        payments.push({ amount: amt.value, month: m.month });
      }
    }

    const parsed: ParsedRow = {
      rowNum: r,
      invoice,
      customerCode,
      customerName,
      branchId,
      itemDetails: asText(get(colMap.fields.item)) ?? 'غير محدد',
      cash: cash.ok && cash.value ? cash.value : 0,
      down: down.ok && down.value ? down.value : 0,
      installment: installment.value,
      count: Math.trunc(count.value),
      discount: discount.ok && discount.value ? discount.value : 0,
      deliveryDate,
      firstDate,
      dueDay,
      collectionType: asText(get(colMap.fields.collectionType)),
      status: parseSaleStatus(get(colMap.fields.status)),
      area: asText(get(colMap.fields.area)),
      housing: asText(get(colMap.fields.housing)),
      custPhones: parsePhones(get(colMap.fields.customerPhone)).phones,
      gName: asText(get(colMap.fields.guarantorName)),
      gPhones: parsePhones(get(colMap.fields.guarantorPhone)).phones,
      payments,
      note: asText(get(colMap.fields.notes)),
    };

    const list = byCustomer.get(customerCode) ?? [];
    list.push(parsed);
    byCustomer.set(customerCode, list);
    totalToImport++;
  }

  console.log(`Starting fast import: ${totalToImport} remaining sales across ${byCustomer.size} customers...`);

  const groups = Array.from(byCustomer.values());
  let cursor = 0;
  let imported = 0;
  const startTime = Date.now();

  async function worker() {
    const client = await pool.connect();
    try {
      while (true) {
        const idx = cursor++;
        if (idx >= groups.length) break;
        const rows = groups[idx];

        for (const item of rows) {
          await client.query('BEGIN');
          try {
            // 1. العميل
            const custRes = await client.query<{ id: number }>(
              `INSERT INTO customers (customer_code, name, normalized_name)
               VALUES ($1, $2, $3)
               ON CONFLICT (customer_code) DO UPDATE
               SET name = EXCLUDED.name, normalized_name = EXCLUDED.normalized_name, updated_at = NOW()
               RETURNING id`,
              [item.customerCode, item.customerName, normalizeArabic(item.customerName)],
            );
            const customerId = custRes.rows[0].id;

            // 2. أرقام العميل (استعلام واحد بـ UNNEST)
            if (item.custPhones.length) {
              await client.query(
                `INSERT INTO phone_numbers (customer_id, phone, is_primary, label)
                 SELECT $1, p, prim, lbl
                 FROM UNNEST($2::varchar[], $3::boolean[], $4::varchar[]) AS t(p, prim, lbl)
                 ON CONFLICT (customer_id, phone) WHERE customer_id IS NOT NULL DO NOTHING`,
                [
                  customerId,
                  item.custPhones.map((p) => p.phone),
                  item.custPhones.map((_, i) => i === 0),
                  item.custPhones.map((p) => p.label),
                ],
              );
            }

            // 3. العنوان
            let addressId: number | null = null;
            if (item.area || item.housing) {
              const curAddr = await client.query<{ id: number; area: string | null; housing_type: string | null }>(
                `SELECT id, area, housing_type FROM customer_addresses WHERE customer_id = $1 AND is_current = TRUE`,
                [customerId],
              );
              if (curAddr.rows[0] && curAddr.rows[0].area === item.area && curAddr.rows[0].housing_type === item.housing) {
                addressId = curAddr.rows[0].id;
              } else {
                await client.query(
                  `UPDATE customer_addresses SET is_current = FALSE WHERE customer_id = $1 AND is_current = TRUE`,
                  [customerId],
                );
                const newAddr = await client.query<{ id: number }>(
                  `INSERT INTO customer_addresses (customer_id, area, housing_type, is_current) VALUES ($1, $2, $3, TRUE) RETURNING id`,
                  [customerId, item.area, item.housing],
                );
                addressId = newAddr.rows[0].id;
              }
            }

            // 4. الفاتورة
            const saleRes = await client.query<{ id: number }>(
              `INSERT INTO sales (
                 invoice_number, branch_id, customer_id, address_id, item_details,
                 cash_price, down_payment, monthly_installment, installments_count, discount_amount,
                 delivery_date, first_installment_date, due_day, collection_type, status
               ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
               ON CONFLICT (invoice_number) DO UPDATE SET
                 item_details = EXCLUDED.item_details,
                 discount_amount = EXCLUDED.discount_amount,
                 status = EXCLUDED.status,
                 updated_at = NOW()
               RETURNING id`,
              [
                item.invoice, item.branchId, customerId, addressId, item.itemDetails,
                item.cash, item.down, item.installment, item.count, item.discount,
                item.deliveryDate, item.firstDate, item.dueDay, item.collectionType, item.status,
              ],
            );
            const saleId = saleRes.rows[0].id;

            // 5. الضامن وأرقامه (استعلام واحد للأرقام)
            if (item.gName) {
              const gRes = await client.query<{ id: number }>(
                `INSERT INTO guarantors (sale_id, name) VALUES ($1, $2) RETURNING id`,
                [saleId, item.gName],
              );
              const gId = gRes.rows[0].id;

              if (item.gPhones.length) {
                await client.query(
                  `INSERT INTO phone_numbers (guarantor_id, phone, is_primary, label)
                   SELECT $1, p, prim, lbl
                   FROM UNNEST($2::varchar[], $3::boolean[], $4::varchar[]) AS t(p, prim, lbl)
                   ON CONFLICT (guarantor_id, phone) WHERE guarantor_id IS NOT NULL DO NOTHING`,
                  [
                    gId,
                    item.gPhones.map((p) => p.phone),
                    item.gPhones.map((_, i) => i === 0),
                    item.gPhones.map((p) => p.label),
                  ],
                );
              }
            }

            // 6. كل التحصيلات الشهرية في استعلام واحد بـ UNNEST
            if (item.payments.length) {
              await client.query(
                `INSERT INTO payments (sale_id, amount, payment_month, payment_date, source_column)
                 SELECT $1, a, m, m, s
                 FROM UNNEST($2::numeric[], $3::date[], $4::varchar[]) AS t(a, m, s)
                 ON CONFLICT (sale_id, source_column) WHERE source_column IS NOT NULL
                 DO UPDATE SET amount = EXCLUDED.amount`,
                [
                  saleId,
                  item.payments.map((p) => p.amount),
                  item.payments.map((p) => p.month),
                  item.payments.map((p) => p.month),
                ],
              );
            }

            // 7. الملاحظات
            if (item.note) {
              await client.query(
                `INSERT INTO sale_notes (sale_id, note_type, content) VALUES ($1, 'legacy_import', $2)`,
                [saleId, item.note],
              );
            }

            await client.query('COMMIT');
            imported++;
            if (imported % 100 === 0 || imported === totalToImport) {
              const sec = ((Date.now() - startTime) / 1000).toFixed(0);
              const pct = ((imported / totalToImport) * 100).toFixed(1);
              console.log(`Progress: ${imported}/${totalToImport} (${pct}%) — ${sec}s`);
            }
          } catch (err) {
            await client.query('ROLLBACK');
            rejected.push({ row: item.rowNum, invoice: item.invoice, reason: (err as Error).message });
          }
        }
      }
    } finally {
      client.release();
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  await pool.end();

  console.log(`\nFinished! Imported: ${imported}, Rejected: ${rejected.length}`);
  if (rejected.length) console.table(rejected.slice(0, 20));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});