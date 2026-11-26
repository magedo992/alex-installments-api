const { firstOfMonth } = require('../lib/date-helpers');
const { toAsciiDigits } = require('../lib/arabic');

function createSaleService(pool) {
  async function getSaleDetails({ user, saleId, invoiceNumber }) {
    const userBranch = user?.branch_id ?? user?.branchId;
    const hasBranch = userBranch !== null && userBranch !== undefined;
    const branchId = hasBranch ? Number(userBranch) : null;

    if ((hasBranch && (!Number.isSafeInteger(branchId) || branchId <= 0)) ||
        (!hasBranch && !['admin', 'accountant'].includes(user?.role))) {
      const error = new Error('غير مصرح لك بعرض الفواتير دون فرع صالح');
      error.statusCode = 403;
      throw error;
    }

    // Keep internal IDs and invoice numbers separate, including numeric invoice numbers.
    const byInvoice = invoiceNumber !== undefined;
    const identifier = byInvoice && typeof invoiceNumber === 'string'
      ? toAsciiDigits(invoiceNumber).trim()
      : saleId;
    if ((byInvoice && (saleId !== undefined || typeof identifier !== 'string' ||
         !identifier || identifier.length > 50)) ||
        (!byInvoice && (!Number.isSafeInteger(identifier) || identifier <= 0))) {
      const error = new Error('معرف الفاتورة أو رقمها غير صالح');
      error.statusCode = 400;
      throw error;
    }

    const params = [identifier];
    const conditions = [byInvoice ? 'LOWER(s.invoice_number) = LOWER($1)' : 's.id = $1::bigint'];
    if (hasBranch) {
      params.push(branchId);
      conditions.push('s.branch_id = $2');
    }

    // Each collection is aggregated separately so phones/payments/notes never multiply rows.
    const result = await pool.query(`
      SELECT
        s.*,
        (
          SELECT json_build_object('id', b.id, 'name', b.name)
          FROM branches b WHERE b.id = s.branch_id
        ) AS branch,
        (
          SELECT json_build_object(
            'id', c.id,
            'customer_code', c.customer_code,
            'name', c.name,
            'phones', COALESCE((
              SELECT json_agg(json_build_object(
                'id', pn.id, 'phone', pn.phone,
                'is_primary', pn.is_primary, 'label', pn.label
              ) ORDER BY pn.is_primary DESC, pn.id ASC)
              FROM phone_numbers pn WHERE pn.customer_id = c.id
            ), '[]'::json)
          )
          FROM customers c WHERE c.id = s.customer_id
        ) AS customer,
        (
          SELECT json_build_object(
            'id', ca.id, 'area', ca.area, 'housing_type', ca.housing_type,
            'address_details', ca.address_details, 'is_current', ca.is_current
          )
          FROM customer_addresses ca
          WHERE ca.id = s.address_id AND ca.customer_id = s.customer_id
        ) AS address,
        COALESCE((
          SELECT json_agg(json_build_object(
            'id', g.id, 'sale_id', g.sale_id, 'name', g.name, 'created_at', g.created_at,
            'phones', COALESCE((
              SELECT json_agg(json_build_object(
                'id', gp.id, 'phone', gp.phone,
                'is_primary', gp.is_primary, 'label', gp.label
              ) ORDER BY gp.is_primary DESC, gp.id ASC)
              FROM phone_numbers gp WHERE gp.guarantor_id = g.id
            ), '[]'::json)
          ) ORDER BY g.id ASC)
          FROM guarantors g WHERE g.sale_id = s.id
        ), '[]'::json) AS guarantors,
        COALESCE((
          SELECT json_agg(json_build_object(
            'id', p.id, 'sale_id', p.sale_id, 'amount', p.amount,
            'payment_month', p.payment_month, 'payment_date', p.payment_date,
            'notes', p.notes, 'created_at', p.created_at
          ) ORDER BY p.payment_date ASC, p.id ASC)
          FROM payments p WHERE p.sale_id = s.id
        ), '[]'::json) AS payments,
        COALESCE((
          SELECT json_agg(json_build_object(
            'id', sn.id, 'sale_id', sn.sale_id, 'created_by_user_id', sn.created_by_user_id,
            'note_type', sn.note_type, 'content', sn.content,
            'follow_up_date', sn.follow_up_date, 'created_at', sn.created_at
          ) ORDER BY sn.id DESC)
          FROM sale_notes sn WHERE sn.sale_id = s.id
        ), '[]'::json) AS notes,
        sb.total_paid,
        sb.required_installments_total,
        sb.remaining_amount,
        sb.due_installments,
        sb.due_amount,
        sb.overdue_amount
      FROM sales s
      LEFT JOIN sale_balances sb ON sb.sale_id = s.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY s.id ASC
      LIMIT 1
    `, params);

    const sale = result.rows[0];
    if (!sale) return null;

    return {
      ...sale,
      // Preserve the singular shape used by createSale without losing legacy guarantors.
      guarantor: sale.guarantors[0] ?? null,
    };
  }

  async function createSale({ user, saleData }) {
    const {
      invoice_number,
      branch_id,
      customer_id,
      address_id,
      item_details,
      cash_price = 0,
      down_payment = 0,
      monthly_installment,
      installments_count,
      discount_amount = 0,
      delivery_date,
      first_installment_date,
      due_day,
      collection_type = 'فرع',
      status = 'active',
      guarantor = null,
    } = saleData;

    let effectiveBranchId;
    const userBranch = user?.branch_id ?? user?.branchId;
    if (userBranch !== null && userBranch !== undefined) {
      effectiveBranchId = Number(userBranch);
    } else {
      if (!branch_id) {
        throw new Error('حقل الفرع (branch_id) إلزامي للمستخدمين غير المرتبطين بفرع محدد');
      }
      effectiveBranchId = Number(branch_id);
    }

    if (!effectiveBranchId || isNaN(effectiveBranchId) || effectiveBranchId <= 0) {
      throw new Error('معرف الفرع غير صالح');
    }

    const trimmedInvoice = typeof invoice_number === 'string' ? invoice_number.trim() : '';
    if (!trimmedInvoice) {
      throw new Error('رقم الفاتورة (invoice_number) إلزامي');
    }

    const customerIdNum = Number(customer_id);
    if (!customerIdNum || isNaN(customerIdNum) || customerIdNum <= 0) {
      throw new Error('معرف العميل (customer_id) إلزامي');
    }

    const installmentNum = Number(monthly_installment);
    if (isNaN(installmentNum) || installmentNum < 0) {
      throw new Error('قيمة القسط الشهري (monthly_installment) غير صالحة');
    }

    const countNum = parseInt(installments_count, 10);
    if (isNaN(countNum) || countNum < 1) {
      throw new Error('عدد الأقساط (installments_count) يجب أن يكون 1 على الأقل');
    }

    if (!first_installment_date) {
      throw new Error('تاريخ أول قسط (first_installment_date) إلزامي');
    }

    const cashPriceNum = Number(cash_price) || 0;
    const downPaymentNum = Number(down_payment) || 0;
    const discountNum = Number(discount_amount) || 0;
    const totalAmount = downPaymentNum + (installmentNum * countNum) - discountNum;

    let effectiveDueDay = due_day ? parseInt(due_day, 10) : null;
    if (!effectiveDueDay || effectiveDueDay < 1 || effectiveDueDay > 31) {
      const matchDay = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(first_installment_date));
      effectiveDueDay = matchDay ? parseInt(matchDay[3], 10) : 1;
    }

    const effectiveDeliveryDate = delivery_date || first_installment_date;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const custCheck = await client.query('SELECT id FROM customers WHERE id = $1', [customerIdNum]);
      if (custCheck.rows.length === 0) {
        throw new Error('العميل المحدد غير موجود');
      }

      let effectiveAddressId = address_id ? Number(address_id) : null;
      if (!effectiveAddressId) {
        const addrCheck = await client.query(
          'SELECT id FROM customer_addresses WHERE customer_id = $1 AND is_current = TRUE LIMIT 1',
          [customerIdNum]
        );
        if (addrCheck.rows.length > 0) {
          effectiveAddressId = addrCheck.rows[0].id;
        }
      }

      const saleRes = await client.query(
        `INSERT INTO sales (
           invoice_number, branch_id, customer_id, address_id, item_details,
           cash_price, down_payment, monthly_installment, installments_count, discount_amount,
           total_amount, delivery_date, first_installment_date, due_day, collection_type, status,
           created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW())
         RETURNING *`,
        [
          trimmedInvoice,
          effectiveBranchId,
          customerIdNum,
          effectiveAddressId,
          item_details || null,
          cashPriceNum,
          downPaymentNum,
          installmentNum,
          countNum,
          discountNum,
          totalAmount,
          effectiveDeliveryDate,
          first_installment_date,
          effectiveDueDay,
          collection_type,
          status,
        ]
      );
      const sale = saleRes.rows[0];

      let insertedGuarantor = null;
      if (guarantor && typeof guarantor === 'object' && guarantor.name && guarantor.name.trim()) {
        const gName = guarantor.name.trim();
        const gRes = await client.query(
          `INSERT INTO guarantors (sale_id, name, created_at)
           VALUES ($1, $2, NOW())
           RETURNING id, sale_id, name, created_at`,
          [sale.id, gName]
        );
        const gRecord = gRes.rows[0];
        const insertedGPhones = [];

        if (Array.isArray(guarantor.phones) && guarantor.phones.length > 0) {
          for (let i = 0; i < guarantor.phones.length; i++) {
            const pItem = guarantor.phones[i];
            const rawPhone = typeof pItem === 'object' && pItem !== null ? pItem.phone : pItem;
            const phoneStr = toAsciiDigits(String(rawPhone || '')).replace(/\s+/g, '');

            if (phoneStr) {
              const isPrimary = typeof pItem === 'object' && pItem !== null && typeof pItem.is_primary === 'boolean'
                ? pItem.is_primary
                : i === 0;
              const label = typeof pItem === 'object' && pItem !== null && pItem.label ? String(pItem.label).trim() : null;

              const phoneRes = await client.query(
                `INSERT INTO phone_numbers (guarantor_id, phone, is_primary, label, created_at)
                 VALUES ($1, $2, $3, $4, NOW())
                 RETURNING id, phone, is_primary, label`,
                [gRecord.id, phoneStr, isPrimary, label]
              );
              insertedGPhones.push(phoneRes.rows[0]);
            }
          }
        }

        insertedGuarantor = {
          ...gRecord,
          phones: insertedGPhones,
        };
      }

      await client.query('COMMIT');

      return {
        ...sale,
        guarantor: insertedGuarantor,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505' && err.constraint?.includes('invoice_number')) {
        throw new Error('رقم الفاتورة مسجل مسبقاً في النظام');
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async function findSaleByIdentifier(queryable, saleId, { forUpdate = false } = {}) {
    const rawIdentifier = toAsciiDigits(String(saleId ?? '')).trim();
    if (!rawIdentifier || /^-?\d+$/.test(rawIdentifier) && Number(rawIdentifier) <= 0) {
      throw new Error('معرف الفاتورة (saleId) غير صالح');
    }

    const lockClause = forUpdate ? ' FOR UPDATE' : '';
    const columns = forUpdate
      ? 'id, invoice_number, branch_id, monthly_installment, installments_count, discount_amount, status'
      : 'id, invoice_number, branch_id';

    if (/^\d+$/.test(rawIdentifier)) {
      const res = await queryable.query(
        `SELECT ${columns} FROM sales WHERE id = $1 OR LOWER(invoice_number) = LOWER($2) LIMIT 1${lockClause}`,
        [Number(rawIdentifier), rawIdentifier]
      );
      return res.rows[0] || null;
    }

    const res = await queryable.query(
      `SELECT ${columns} FROM sales WHERE LOWER(invoice_number) = LOWER($1) LIMIT 1${lockClause}`,
      [rawIdentifier]
    );
    return res.rows[0] || null;
  }

  async function recordPayment({ user, saleId, amount, paymentDate, notes = null }) {
    const rawIdentifier = toAsciiDigits(String(saleId ?? '')).trim();
    if (!rawIdentifier || (/^-?\d+$/.test(rawIdentifier) && Number(rawIdentifier) <= 0)) {
      throw new Error('معرف الفاتورة (saleId) غير صالح');
    }

    const amountNum = Number(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new Error('قيمة الدفعة (amount) يجب أن تكون أكبر من صفر');
    }

    const effectiveDate = paymentDate || new Date().toISOString().slice(0, 10);
    const paymentMonth = firstOfMonth(effectiveDate);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const sale = await findSaleByIdentifier(client, rawIdentifier, { forUpdate: true });
      if (!sale) {
        throw new Error('الفاتورة المحددة غير موجودة');
      }

      const actualSaleId = Number(sale.id);
      const userBranch = user?.branch_id ?? user?.branchId;
      if (userBranch !== null && userBranch !== undefined && Number(sale.branch_id) !== Number(userBranch)) {
        const forbiddenErr = new Error('غير مصرح لك بتسجيل دفعة على فاتورة تخص فرع آخر');
        forbiddenErr.statusCode = 403;
        throw forbiddenErr;
      }

      const monthlyInstallment = Number(sale.monthly_installment) || 0;
      const installmentsCount = Number(sale.installments_count) || 0;
      const discountAmount = Number(sale.discount_amount) || 0;
      const requiredInstallmentsTotal = Math.max(0, (monthlyInstallment * installmentsCount) - discountAmount);

      const payRes = await client.query(
        `INSERT INTO payments (sale_id, amount, payment_month, payment_date, notes, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING id, sale_id, amount, payment_month, payment_date, notes, created_at`,
        [actualSaleId, amountNum, paymentMonth, effectiveDate, notes ? String(notes).trim() : null]
      );
      const payment = payRes.rows[0];

      const totalRes = await client.query(
        'SELECT COALESCE(SUM(amount), 0) AS total_paid FROM payments WHERE sale_id = $1',
        [actualSaleId]
      );
      const totalPaid = Number(totalRes.rows[0].total_paid);
      const remainingBalance = Math.max(0, requiredInstallmentsTotal - totalPaid);

      let currentStatus = sale.status;
      if (totalPaid >= requiredInstallmentsTotal && requiredInstallmentsTotal > 0 && currentStatus !== 'completed') {
        const updateRes = await client.query(
          `UPDATE sales SET status = 'completed', updated_at = NOW() WHERE id = $1 RETURNING status`,
          [actualSaleId]
        );
        currentStatus = updateRes.rows[0].status;
      }

      await client.query('COMMIT');

      return {
        payment,
        summary: {
          sale_id: actualSaleId,
          invoice_number: sale.invoice_number,
          required_installments_total: requiredInstallmentsTotal,
          total_paid: totalPaid,
          remaining_balance: remainingBalance,
          sale_status: currentStatus,
          is_completed: currentStatus === 'completed',
        },
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async function getOverdueSales({ user, query = {} }) {
    const { branch_id, due_day, page = 1, limit = 20 } = query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    let effectiveBranchId = null;
    const userBranch = user?.branch_id ?? user?.branchId;
    if (userBranch !== null && userBranch !== undefined) {
      effectiveBranchId = Number(userBranch);
    } else if (branch_id) {
      effectiveBranchId = Number(branch_id);
    }

    const conditions = ["sb.status = 'active'", "sb.overdue_amount > 0"];
    const params = [];

    if (effectiveBranchId) {
      params.push(effectiveBranchId);
      conditions.push(`sb.branch_id = $${params.length}`);
    }

    if (due_day !== undefined && due_day !== null && due_day !== '') {
      const dueDayNum = parseInt(due_day, 10);
      if (!isNaN(dueDayNum) && dueDayNum >= 1 && dueDayNum <= 31) {
        params.push(dueDayNum);
        conditions.push(`sb.due_day = $${params.length}`);
      }
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countSql = `SELECT COUNT(*) AS total FROM sale_balances sb ${whereClause}`;
    const countRes = await pool.query(countSql, params);
    const total = parseInt(countRes.rows[0]?.total || 0, 10);

    const dataParams = [...params, limitNum, offset];
    const limitParamIdx = dataParams.length - 1;
    const offsetParamIdx = dataParams.length;

    const dataSql = `
      SELECT 
        sb.sale_id,
        sb.invoice_number,
        sb.branch_id,
        b.name AS branch_name,
        sb.customer_id,
        c.customer_code,
        c.name AS customer_name,
        (
          SELECT pn.phone 
          FROM phone_numbers pn 
          WHERE pn.customer_id = sb.customer_id 
          ORDER BY pn.is_primary DESC, pn.id ASC 
          LIMIT 1
        ) AS primary_phone,
        sb.item_details,
        sb.monthly_installment,
        sb.installments_count,
        sb.first_installment_date,
        sb.due_day,
        sb.total_paid,
        sb.required_installments_total,
        sb.remaining_amount,
        sb.due_installments,
        sb.due_amount,
        sb.overdue_amount,
        (
          SELECT json_build_object(
            'id', sn.id,
            'note_type', sn.note_type,
            'content', sn.content,
            'follow_up_date', sn.follow_up_date,
            'created_at', sn.created_at
          )
          FROM sale_notes sn
          WHERE sn.sale_id = sb.sale_id
          ORDER BY sn.id DESC
          LIMIT 1
        ) AS latest_note
      FROM sale_balances sb
      JOIN customers c ON c.id = sb.customer_id
      LEFT JOIN branches b ON b.id = sb.branch_id
      ${whereClause}
      ORDER BY sb.overdue_amount DESC, sb.due_day ASC
      LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
    `;

    const dataRes = await pool.query(dataSql, dataParams);

    return {
      data: dataRes.rows,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    };
  }

  async function getFollowUpSales({ user, query = {} }) {
    const { branch_id, day, date, page = 1, limit = 20 } = query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    const userBranch = user?.branch_id ?? user?.branchId;
    const hasBranch = userBranch !== null && userBranch !== undefined;
    let effectiveBranchId = null;

    if (hasBranch) {
      effectiveBranchId = Number(userBranch);
      if (!Number.isSafeInteger(effectiveBranchId) || effectiveBranchId <= 0) {
        const forbiddenErr = new Error('غير مصرح لك بعرض قائمة المتابعة دون فرع صالح');
        forbiddenErr.statusCode = 403;
        throw forbiddenErr;
      }
    } else if (!['admin', 'accountant'].includes(user?.role)) {
      const forbiddenErr = new Error('غير مصرح لك بعرض قائمة المتابعة دون فرع محدد');
      forbiddenErr.statusCode = 403;
      throw forbiddenErr;
    } else if (branch_id) {
      effectiveBranchId = Number(branch_id);
    }

    let filterDay;
    if (day !== undefined && day !== null && day !== '') {
      filterDay = parseInt(day, 10);
    } else if (date && /^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      filterDay = parseInt(String(date).split('-')[2], 10);
    } else {
      filterDay = Number(
        new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', day: 'numeric' }).format(new Date())
      );
    }

    const conditions = ["sb.status = 'active'", "sb.overdue_amount > 0", 'sb.due_day <= $1'];
    const params = [filterDay];

    if (effectiveBranchId) {
      params.push(effectiveBranchId);
      conditions.push(`sb.branch_id = $${params.length}`);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countSql = `SELECT COUNT(*) AS total FROM sale_balances sb ${whereClause}`;
    const countRes = await pool.query(countSql, params);
    const total = parseInt(countRes.rows[0]?.total || 0, 10);

    const dataParams = [...params, limitNum, offset];
    const limitParamIdx = dataParams.length - 1;
    const offsetParamIdx = dataParams.length;

    const dataSql = `
      SELECT
        sb.sale_id,
        sb.invoice_number,
        sb.branch_id,
        b.name AS branch_name,
        sb.customer_id,
        c.customer_code,
        c.name AS customer_name,
        c.risk_level,
        c.general_note,
        (
          SELECT json_build_object(
            'id', ca.id,
            'area', ca.area,
            'housing_type', ca.housing_type,
            'address_details', ca.address_details
          )
          FROM customer_addresses ca
          WHERE ca.id = sb.address_id
          LIMIT 1
        ) AS address,
        COALESCE(
          (
            SELECT json_agg(json_build_object(
              'id', pn.id,
              'phone', pn.phone,
              'is_primary', pn.is_primary,
              'label', pn.label
            ) ORDER BY pn.is_primary DESC, pn.id ASC)
            FROM phone_numbers pn
            WHERE pn.customer_id = sb.customer_id
          ), '[]'::json
        ) AS customer_phones,
        sb.item_details,
        sb.cash_price,
        sb.down_payment,
        sb.monthly_installment,
        sb.installments_count,
        sb.discount_amount,
        sb.total_amount,
        sb.delivery_date,
        sb.first_installment_date,
        sb.due_day,
        sb.collection_type,
        sb.status,
        sb.total_paid,
        sb.required_installments_total,
        sb.remaining_amount,
        sb.due_installments,
        sb.due_amount,
        sb.overdue_amount,
        COALESCE(
          (
            SELECT json_agg(json_build_object(
              'id', g.id,
              'name', g.name,
              'created_at', g.created_at,
              'phones', COALESCE(
                (
                  SELECT json_agg(json_build_object(
                    'id', gpn.id,
                    'phone', gpn.phone,
                    'is_primary', gpn.is_primary,
                    'label', gpn.label
                  ) ORDER BY gpn.is_primary DESC, gpn.id ASC)
                  FROM phone_numbers gpn
                  WHERE gpn.guarantor_id = g.id
                ), '[]'::json
              )
            ) ORDER BY g.id ASC)
            FROM guarantors g
            WHERE g.sale_id = sb.sale_id
          ), '[]'::json
        ) AS guarantors,
        (
          SELECT json_build_object(
            'id', sn.id,
            'note_type', sn.note_type,
            'content', sn.content,
            'follow_up_date', sn.follow_up_date,
            'created_at', sn.created_at
          )
          FROM sale_notes sn
          WHERE sn.sale_id = sb.sale_id
          ORDER BY sn.id DESC
          LIMIT 1
        ) AS latest_note,
        COALESCE(
          (
            SELECT json_agg(json_build_object(
              'id', sn.id,
              'created_by_user_id', sn.created_by_user_id,
              'note_type', sn.note_type,
              'content', sn.content,
              'follow_up_date', sn.follow_up_date,
              'created_at', sn.created_at
            ) ORDER BY sn.id DESC)
            FROM sale_notes sn
            WHERE sn.sale_id = sb.sale_id
          ), '[]'::json
        ) AS notes
      FROM sale_balances sb
      JOIN customers c ON c.id = sb.customer_id
      LEFT JOIN branches b ON b.id = sb.branch_id
      ${whereClause}
      ORDER BY sb.due_day ASC, sb.overdue_amount DESC
      LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
    `;

    const dataRes = await pool.query(dataSql, dataParams);

    return {
      filter_day: filterDay,
      data: dataRes.rows,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    };
  }

  async function addSaleNote({ user, saleId, noteData }) {
    const rawIdentifier = toAsciiDigits(String(saleId ?? '')).trim();
    if (!rawIdentifier || (/^-?\d+$/.test(rawIdentifier) && Number(rawIdentifier) <= 0)) {
      throw new Error('معرف الفاتورة (saleId) غير صالح');
    }

    const { content, note_type = 'call', follow_up_date = null } = noteData || {};

    const trimmedContent = typeof content === 'string' ? content.trim() : '';
    if (!trimmedContent) {
      throw new Error('محتوى الملاحظة (content) إلزامي');
    }

    const allowedTypes = ['call', 'visit', 'inquiry', 'legal', 'general', 'legacy_import'];
    const effectiveNoteType = allowedTypes.includes(note_type) ? note_type : 'call';

    const sale = await findSaleByIdentifier(pool, rawIdentifier);
    if (!sale) {
      throw new Error('الفاتورة المحددة غير موجودة');
    }

    const actualSaleId = Number(sale.id);
    const userBranch = user?.branch_id ?? user?.branchId;
    if (userBranch !== null && userBranch !== undefined && Number(sale.branch_id) !== Number(userBranch)) {
      const forbiddenErr = new Error('غير مصرح لك بتسجيل ملاحظة على فاتورة تخص فرع آخر');
      forbiddenErr.statusCode = 403;
      throw forbiddenErr;
    }

    const insertSql = `
      INSERT INTO sale_notes (sale_id, created_by_user_id, note_type, content, follow_up_date, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING id, sale_id, created_by_user_id, note_type, content, follow_up_date, created_at
    `;

    const res = await pool.query(insertSql, [
      actualSaleId,
      user?.id || null,
      effectiveNoteType,
      trimmedContent,
      follow_up_date || null,
    ]);

    return res.rows[0];
  }

  async function searchSales({ user, query = {} }) {
    const { invoice_number, q, branch_id, page = 1, limit = 20 } = query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    let effectiveBranchId = null;
    const userBranch = user?.branch_id ?? user?.branchId;
    if (userBranch !== null && userBranch !== undefined) {
      effectiveBranchId = Number(userBranch);
    } else if (branch_id) {
      effectiveBranchId = Number(branch_id);
    }

    const conditions = [];
    const params = [];

    if (effectiveBranchId) {
      params.push(effectiveBranchId);
      conditions.push(`sb.branch_id = $${params.length}`);
    }

    if (invoice_number && String(invoice_number).trim()) {
      params.push(toAsciiDigits(String(invoice_number)).trim());
      conditions.push(`LOWER(sb.invoice_number) = LOWER($${params.length})`);
    } else if (q && String(q).trim()) {
      const cleanQ = toAsciiDigits(String(q)).trim();
      params.push(`%${cleanQ}%`);
      const likeIdx = params.length;
      params.push(cleanQ);
      const exactIdx = params.length;
      conditions.push(`(
        sb.invoice_number ILIKE $${likeIdx}
        OR c.name ILIKE $${likeIdx}
        OR c.normalized_name ILIKE $${likeIdx}
        OR c.customer_code = $${exactIdx}
        OR EXISTS (SELECT 1 FROM phone_numbers pn WHERE pn.customer_id = sb.customer_id AND pn.phone ILIKE $${likeIdx})
      )`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countSql = `SELECT COUNT(*) AS total FROM sale_balances sb JOIN customers c ON c.id = sb.customer_id ${whereClause}`;
    const countRes = await pool.query(countSql, params);
    const total = parseInt(countRes.rows[0]?.total || 0, 10);

    const dataParams = [...params, limitNum, offset];
    const limitParamIdx = dataParams.length - 1;
    const offsetParamIdx = dataParams.length;

    const isDirectInvoiceLookup = Boolean(invoice_number && String(invoice_number).trim());
    const detailColumns = isDirectInvoiceLookup
      ? `,
        sb.cash_price,
        sb.down_payment,
        sb.discount_amount,
        sb.total_amount,
        sb.delivery_date,
        sb.collection_type,
        sb.created_at,
        sb.updated_at,
        c.risk_level,
        c.general_note,
        (
          SELECT json_build_object(
            'id', ca.id,
            'area', ca.area,
            'housing_type', ca.housing_type,
            'address_details', ca.address_details
          )
          FROM customer_addresses ca
          WHERE ca.id = sb.address_id
          LIMIT 1
        ) AS address,
        COALESCE(
          (
            SELECT json_agg(json_build_object(
              'id', pn.id,
              'phone', pn.phone,
              'is_primary', pn.is_primary,
              'label', pn.label
            ) ORDER BY pn.is_primary DESC, pn.id ASC)
            FROM phone_numbers pn
            WHERE pn.customer_id = sb.customer_id
          ), '[]'::json
        ) AS customer_phones,
        COALESCE(
          (
            SELECT json_agg(json_build_object(
              'id', g.id,
              'name', g.name,
              'created_at', g.created_at,
              'phones', COALESCE(
                (
                  SELECT json_agg(json_build_object(
                    'id', gpn.id,
                    'phone', gpn.phone,
                    'is_primary', gpn.is_primary,
                    'label', gpn.label
                  ) ORDER BY gpn.is_primary DESC, gpn.id ASC)
                  FROM phone_numbers gpn
                  WHERE gpn.guarantor_id = g.id
                ), '[]'::json
              )
            ) ORDER BY g.id ASC)
            FROM guarantors g
            WHERE g.sale_id = sb.sale_id
          ), '[]'::json
        ) AS guarantors,
        COALESCE(
          (
            SELECT json_agg(json_build_object(
              'id', p.id,
              'amount', p.amount,
              'payment_month', p.payment_month,
              'payment_date', p.payment_date,
              'notes', p.notes,
              'created_at', p.created_at
            ) ORDER BY p.payment_date DESC, p.id DESC)
            FROM payments p
            WHERE p.sale_id = sb.sale_id
          ), '[]'::json
        ) AS payments,
        COALESCE(
          (
            SELECT json_agg(json_build_object(
              'id', sn.id,
              'created_by_user_id', sn.created_by_user_id,
              'note_type', sn.note_type,
              'content', sn.content,
              'follow_up_date', sn.follow_up_date,
              'created_at', sn.created_at
            ) ORDER BY sn.id DESC)
            FROM sale_notes sn
            WHERE sn.sale_id = sb.sale_id
          ), '[]'::json
        ) AS notes`
      : '';

    const dataSql = `
      SELECT
        sb.sale_id,
        sb.invoice_number,
        sb.branch_id,
        b.name AS branch_name,
        sb.customer_id,
        c.customer_code,
        c.name AS customer_name,
        (
          SELECT pn.phone
          FROM phone_numbers pn
          WHERE pn.customer_id = sb.customer_id
          ORDER BY pn.is_primary DESC, pn.id ASC
          LIMIT 1
        ) AS primary_phone,
        sb.item_details,
        sb.monthly_installment,
        sb.installments_count,
        sb.first_installment_date,
        sb.due_day,
        sb.total_paid,
        sb.required_installments_total,
        sb.remaining_amount,
        sb.due_installments,
        sb.due_amount,
        sb.overdue_amount,
        sb.status${detailColumns}
      FROM sale_balances sb
      JOIN customers c ON c.id = sb.customer_id
      LEFT JOIN branches b ON b.id = sb.branch_id
      ${whereClause}
      ORDER BY sb.sale_id DESC
      LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
    `;

    const dataRes = await pool.query(dataSql, dataParams);

    return {
      data: dataRes.rows,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    };
  }

  return {
    getSaleDetails,
    createSale,
    searchSales,
    recordPayment,
    getOverdueSales,
    getFollowUpSales,
    addSaleNote,
  };
}

module.exports = {
  createSaleService,
};
