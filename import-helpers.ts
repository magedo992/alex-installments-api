// Pure helpers: no DB, no Excel dependency. Safe to unit test and to reuse in the Express API.

// ---------- Arabic / text ----------

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export function toAsciiDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (ch) => {
    const i = ARABIC_DIGITS.indexOf(ch);
    return String(i >= 0 ? i : PERSIAN_DIGITS.indexOf(ch));
  });
}

/** Normalizes Arabic text for search/matching. Use the SAME function in the API when filling customers.normalized_name. */
export function normalizeArabic(s: string): string {
  return toAsciiDigits(s)
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // tashkeel + tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** For header matching: normalized + everything except letters/digits removed. */
export function normalizeHeader(s: string): string {
  return normalizeArabic(s).replace(/[^\p{L}\p{N}]/gu, '');
}

// ---------- Cell values ----------

/** Unwraps exceljs formula / rich text / hyperlink cells into plain values. */
export function cellValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('result' in o) return cellValue(o.result);
    if (Array.isArray(o.richText)) {
      return cellValue((o.richText as Array<{ text?: string }>).map((t) => t.text ?? '').join(''));
    }
    if ('text' in o) return cellValue(o.text);
    if ('error' in o) return null;
    return null;
  }
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  return v;
}

export function asText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return String(v);
  const t = String(v).trim();
  return t === '' ? null : t;
}

export type NumResult = { ok: true; value: number | null } | { ok: false };

/** Empty -> ok/null. Text that is not a number -> not ok. */
export function parseNumber(v: unknown): NumResult {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v === 'number') return Number.isFinite(v) ? { ok: true, value: v } : { ok: false };
  if (v instanceof Date) return { ok: false };
  const t = toAsciiDigits(String(v)).replace(/[,\s٬]/g, '').replace(/٫/g, '.');
  if (t === '' || t === '-') return { ok: true, value: null };
  if (!/^-?\d+(\.\d+)?$/.test(t)) return { ok: false };
  return { ok: true, value: Number(t) };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

const validYmd = (y: number, month: number, day: number): string | null => {
  const dt = new Date(Date.UTC(y, month - 1, day));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return `${y}-${pad2(month)}-${pad2(day)}`;
};

/** Returns 'YYYY-MM-DD' or null. Accepts Date, ISO text, or an Excel serial number. Ambiguous text dates return null on purpose. */
export function parseDate(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return `${v.getUTCFullYear()}-${pad2(v.getUTCMonth() + 1)}-${pad2(v.getUTCDate())}`;
  }
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) {
      return parseDate(new Date(Math.round((v - 25569) * 86400 * 1000)));
    }
    return null;
  }
  const t = toAsciiDigits(String(v)).trim();
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]));

  // a/b/yyyy as text: accepted only when it can be read one way (one part > 12, or both parts equal)
  const x = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(t);
  if (x) {
    const a = Number(x[1]);
    const b = Number(x[2]);
    const y = Number(x[3]);
    let day: number;
    let month: number;
    if (a > 12 && b <= 12) { day = a; month = b; }
    else if (b > 12 && a <= 12) { month = a; day = b; }
    else if (a === b && a <= 12) { day = a; month = b; }
    else return null; // ambiguous (e.g. 6/11/2025) or invalid
    return validYmd(y, month, day);
  }
  return null;
}

/** 'YYYY-MM-01' for a month column header (Date, Excel serial, or text like 01/06/2026 read as day/month/year). */
export function monthKeyFromHeader(v: unknown): string | null {
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) return monthKeyFromHeader(new Date(Math.round((v - 25569) * 86400 * 1000)));
    return null;
  }
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return `${v.getUTCFullYear()}-${pad2(v.getUTCMonth() + 1)}-01`;
  }
  if (typeof v === 'string') {
    const t = toAsciiDigits(v).trim();
    let m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(t);
    if (m) {
      const month = Number(m[2]);
      if (month >= 1 && month <= 12) return `${m[3]}-${pad2(month)}-01`;
      return null;
    }
    m = /^(\d{4})-(\d{2})-\d{2}/.exec(t);
    if (m) return `${m[1]}-${m[2]}-01`;
  }
  return null;
}

/** First day of the month a payment belongs to, e.g. 2026-11-01. */
export function firstOfMonth(d: Date | string, timeZone = 'Africa/Cairo'): string {
  if (typeof d === 'string') {
    const m = /^(\d{4})-(\d{2})-\d{2}/.exec(d);
    if (!m) throw new Error(`Invalid date: ${d}`);
    return `${m[1]}-${m[2]}-01`;
  }
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(d);
  const year = parts.find((p) => p.type === 'year')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  return `${year}-${month}-01`;
}

/** Maps Arabic sheet status (e.g. 'منتهى', 'متاخر') to DB sales.status. */
export function parseSaleStatus(v: unknown): 'active' | 'completed' | 'defaulted' | 'legal' | 'cancelled' {
  const s = normalizeArabic(asText(v) ?? '');
  if (s.includes('منتهي') || s.includes('خالص')) return 'completed';
  if (s.includes('قانوني') || s.includes('محكمه')) return 'legal';
  if (s.includes('ملغي')) return 'cancelled';
  return 'active';
}

// ---------- Phones ----------

export type Phone = { phone: string; label: 'موبايل' | 'أرضي' };
export type PhoneParse = { phones: Phone[]; invalid: string[]; fixed: string[] };

const MOBILE = /^01[0125]\d{8}$/; // 11 digits
const LANDLINE = /^0[2-9]\d{6,8}$/; // 8-10 digits, e.g. 035320298

export function classifyPhone(digits: string): Phone | null {
  if (MOBILE.test(digits)) return { phone: digits, label: 'موبايل' };
  if (LANDLINE.test(digits)) return { phone: digits, label: 'أرضي' };
  return null;
}

/** Splits a cell that may hold several numbers, cleans each, and classifies it. Broken numbers go to `invalid`. */
export function parsePhones(cell: unknown): PhoneParse {
  const out: PhoneParse = { phones: [], invalid: [], fixed: [] };
  if (cell === null || cell === undefined) return out;
  const text = toAsciiDigits(typeof cell === 'number' ? String(cell) : String(cell));
  const pieces = text.split(/[\n\r,،\/;|\\]+|\s+-\s+|\s+/);
  const seen = new Set<string>();

  const add = (digits: string, original: string) => {
    const p = classifyPhone(digits);
    if (!p) {
      out.invalid.push(original.trim());
      return;
    }
    if (digits !== original.replace(/\D/g, '')) out.fixed.push(`${original.trim()} -> ${digits}`);
    if (!seen.has(p.phone)) {
      seen.add(p.phone);
      out.phones.push(p);
    }
  };

  for (const piece of pieces) {
    let digits = piece.replace(/\D/g, '');
    if (!digits) continue;
    const original = piece;

    // two mobiles glued together without a separator
    if (digits.length === 22 && /^(01[0125]\d{8}){2}$/.test(digits)) {
      add(digits.slice(0, 11), original);
      add(digits.slice(11), original);
      continue;
    }
    // country code variants: 0020 10..., +20 10..., +20 010..., 0020 010...
    if (digits.startsWith('002001') && digits.length === 15) digits = digits.slice(4);
    else if (digits.startsWith('0020')) digits = '0' + digits.slice(4);
    else if (digits.length === 13 && digits.startsWith('2001')) digits = digits.slice(2);
    else if (digits.length === 12 && digits.startsWith('201')) digits = '0' + digits.slice(2);

    // Excel dropped the leading zero (number stored as a numeric cell): mobile or landline
    if (digits.length === 10 && /^1[0125]/.test(digits)) {
      digits = '0' + digits;
    } else if (
      (digits.length === 8 && /^3\d{7}$/.test(digits)) || // Alexandria 03
      (digits.length === 9 && /^[24-9]\d{8}$/.test(digits)) // Cairo 02 and other governorates
    ) {
      digits = '0' + digits;
    }

    add(digits, original);
  }
  return out;
}

// ---------- Headers ----------

export type FieldKey =
  | 'invoice' | 'customerCode' | 'customerName' | 'branch' | 'status' | 'deliveryDate' | 'dueDay'
  | 'installment' | 'installmentsCount' | 'firstInstallmentDate' | 'collectionType'
  | 'guarantorName' | 'customerPhone' | 'guarantorPhone' | 'area' | 'housing' | 'item'
  | 'cash' | 'down' | 'discount' | 'notes'
  | 'sheetTotal' | 'sheetPaid' | 'sheetRemainingBefore' | 'sheetRemaining' | 'sheetOverdue';

type FieldSpec = { candidates: string[]; required: boolean };

/** Candidate header names (matched after normalization). Trailing * = prefix match. */
export const FIELDS: Record<FieldKey, FieldSpec> = {
 invoice: { required: true,  candidates: ['كود السيستيم', 'كود السيستم', 'Column5', 'رقم الفاتورة', 'رقم الفاتوره', 'الفاتورة'] },
status:  { required: false, candidates: ['حاله العميل', 'حالة العميل', '1', 'الحالة', 'الحاله'] },
cash:    { required: false, candidates: ['سعر الكاش', 'الكاش'] },
  customerCode:         { required: true,  candidates: ['Column1', 'كود العميل', 'كود المشتري', 'كود'] },
  customerName:         { required: true,  candidates: ['اسم المشتري', 'اسم العميل'] },
  branch:               { required: true,  candidates: ['الفروع', 'الفرع'] },
  status:               { required: false, candidates: ['1', 'الحالة', 'الحاله'] },
  deliveryDate:         { required: false, candidates: ['تاريخ التسليم'] },
  dueDay:               { required: false, candidates: ['اليوم'] },
  installment:          { required: true,  candidates: ['قيمة القسط', 'قيمه القسط', 'القسط'] },
  installmentsCount:    { required: true,  candidates: ['عدد الاقساط', 'عدد/الاقساط', 'عدد الأقساط'] },
  firstInstallmentDate: { required: true,  candidates: ['تاريخ القسط'] },
  collectionType:       { required: false, candidates: ['Column4'] },
  guarantorName:        { required: false, candidates: ['اسم الضامن'] },
  customerPhone:        { required: false, candidates: ['رقم تليفون المشتري*', 'رقم تليفون العميل*', 'تليفون المشتري*'] },
  guarantorPhone:       { required: false, candidates: ['رقم تليفون الضامن*', 'تليفون الضامن*'] },
  area:                 { required: false, candidates: ['المنطقة', 'المنطقه'] },
  housing:              { required: false, candidates: ['السكن', 'نوع السكن'] },
  item:                 { required: true,  candidates: ['الصنف'] },
  cash:                 { required: false, candidates: ['الكاش'] },
  down:                 { required: false, candidates: ['المقدم'] },
  discount:             { required: false, candidates: ['الخصومات'] },
  notes:                { required: false, candidates: ['المحلاظات', 'الملاحظات'] },
  sheetTotal:           { required: false, candidates: ['اجمالي المبلغ', 'إجمالي المبلغ', 'اجملي المبلغ'] },
  sheetPaid:            { required: false, candidates: ['الجمالي المدفوع', 'اجمالي المدفوع', 'إجمالي المدفوع'] },
  sheetRemainingBefore: { required: false, candidates: ['المبلغ المتبقي قبل الخصم*'] },
  sheetRemaining:       { required: false, candidates: ['اجمالي المبلغ المتبقي', 'إجمالي المبلغ المتبقي'] },
  sheetOverdue:         { required: false, candidates: ['المتأخر', 'المتاخر'] },
};

export function headerMatches(normHeader: string, candidate: string): boolean {
  const star = candidate.endsWith('*');
  const c = normalizeHeader(star ? candidate.slice(0, -1) : candidate);
  if (!c) return false;
  if (star) return normHeader.startsWith(c);
  if (normHeader === c) return true;
  // Excel adds a number to duplicated table headers (e.g. "تاريخ التسليم2")
  return !c.startsWith('column') && normHeader.replace(/\d+$/, '') === c;
}

export type ColumnMap = {
  fields: Partial<Record<FieldKey, number>>; // 1-based column index
  duplicates: Array<{ field: FieldKey; columns: number[] }>;
  missingRequired: FieldKey[];
  months: Array<{ col: number; month: string }>; // payment month columns
  duplicateMonths: Array<{ month: string; columns: number[] }>;
};

export function buildColumnMap(headers: unknown[]): ColumnMap {
  const clean = headers.map(cellValue);
  const fields: Partial<Record<FieldKey, number>> = {};
  const duplicates: ColumnMap['duplicates'] = [];
  const months: ColumnMap['months'] = [];
  const monthCols = new Map<string, number[]>();
  const norm = clean.map((h) => (typeof h === 'string' ? normalizeHeader(h) : ''));

  (Object.keys(FIELDS) as FieldKey[]).forEach((key) => {
    const hits: number[] = [];
    norm.forEach((h, i) => {
      if (h && FIELDS[key].candidates.some((c) => headerMatches(h, c))) hits.push(i + 1);
    });
    if (hits.length) {
      fields[key] = hits[0];
      if (hits.length > 1) duplicates.push({ field: key, columns: hits });
    }
  });

  clean.forEach((h, i) => {
    const mk = monthKeyFromHeader(h);
    if (mk) {
      months.push({ col: i + 1, month: mk });
      const cols = monthCols.get(mk) ?? [];
      cols.push(i + 1);
      monthCols.set(mk, cols);
    }
  });

  const duplicateMonths: ColumnMap['duplicateMonths'] = [];
  monthCols.forEach((columns, month) => {
    if (columns.length > 1) duplicateMonths.push({ month, columns });
  });

  const missingRequired = (Object.keys(FIELDS) as FieldKey[]).filter(
    (k) => FIELDS[k].required && fields[k] === undefined,
  );
  return { fields, duplicates, missingRequired, months, duplicateMonths };
}

/** How many known headers a row matches — used to find the header row automatically. */
export function headerScore(headers: unknown[]): number {
  const map = buildColumnMap(headers);
  return Object.keys(map.fields).length + (map.months.length > 0 ? 1 : 0);
}