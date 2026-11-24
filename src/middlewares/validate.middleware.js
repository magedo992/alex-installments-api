const { z } = require('zod');
const { toAsciiDigits } = require('../lib/arabic');

/**
 * Creates an Express middleware to validate request data against a Zod schema.
 * @param {z.ZodSchema} schema - The Zod schema to validate against.
 * @param {'body'|'query'|'params'} [source='body'] - The part of request to validate.
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    // Clean Arabic/Eastern digits in strings before validation if validating body
    if (source === 'body' && req.body && typeof req.body === 'object') {
      sanitizeEasternDigits(req.body);
    }

    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const issues = result.error.issues || result.error.errors || [];
      const formattedErrors = issues.map((e) => ({
        field: e.path.join('.') || 'root',
        message: e.message,
      }));

      return res.status(400).json({
        success: false,
        message: 'بيانات غير صالحة، يرجى مراجعة الحقول المطلوبة',
        errors: formattedErrors,
      });
    }

    req[source] = result.data;
    next();
  };
}

/**
 * Recursively converts Eastern Arabic digits to ASCII digits in objects.
 */
function sanitizeEasternDigits(obj) {
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === 'string') {
      obj[key] = toAsciiDigits(val);
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      sanitizeEasternDigits(val);
    } else if (Array.isArray(val)) {
      val.forEach((item) => {
        if (item && typeof item === 'object') sanitizeEasternDigits(item);
      });
    }
  }
}

// Egyptian phone regex: 010, 011, 012, 015 followed by 8 digits (11 digits total), or 7-9 digit landlines with area code
const phoneRegex = /^(01[0125][0-9]{8}|0[2-9][0-9]{7,8})$/;

const phoneSchema = z.union([
  z.string().regex(phoneRegex, 'رقم الهاتف غير صالح، يجب أن يكون 11 رقماً ويبدأ بـ 01'),
  z.object({
    phone: z.string().regex(phoneRegex, 'رقم الهاتف غير صالح، يجب أن يكون 11 رقماً ويبدأ بـ 01'),
    is_primary: z.boolean().optional().default(false),
    label: z.string().max(50, 'اسم التسمية طويل جداً').optional().nullable(),
  }),
]);

const addressSchema = z.object({
  area: z.string().max(100, 'اسم المنطقة طويل جداً').optional().nullable(),
  housing_type: z.string().max(50, 'نوع السكن طويل جداً').optional().nullable(),
  address_details: z.string().max(500, 'تفاصيل العنوان طويلة جداً').optional().nullable(),
}).optional().nullable();

const createCustomerSchema = z.object({
  branch_id: z.number({ invalid_type_error: 'معرف الفرع يجب أن يكون رقماً' }).int().positive('معرف الفرع يجب أن يكون رقماً موجباً').optional(),
  name: z.string({ required_error: 'اسم العميل إلزامي' }).min(2, 'اسم العميل يجب أن لا يقل عن حرفين').max(150, 'اسم العميل طويل جداً').trim(),
  phones: z.array(phoneSchema).optional().default([]),
  address: addressSchema,
  risk_level: z.enum(['low', 'medium', 'high'], { invalid_type_error: 'مستوى المخاطرة يجب أن يكون low أو medium أو high' }).optional().default('low'),
  general_note: z.string().max(1000, 'الملاحظة طويلة جداً').optional().nullable(),
});

const searchCustomerSchema = z.object({
  q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const createSaleSchema = z.object({
  invoice_number: z.string({ required_error: 'رقم الفاتورة إلزامي' }).min(1, 'رقم الفاتورة إلزامي').max(50, 'رقم الفاتورة طويل جداً').trim(),
  branch_id: z.number().int().positive('معرف الفرع يجب أن يكون رقماً موجباً').optional(),
  customer_id: z.number({ required_error: 'معرف العميل إلزامي' }).int().positive('معرف العميل غير صالح'),
  address_id: z.number().int().positive().optional().nullable(),
  item_details: z.string().max(1000, 'تفاصيل البضاعة طويلة جداً').optional().nullable(),
  cash_price: z.number().min(0, 'سعر الكاش لا يمكن أن يكون سالباً').default(0),
  down_payment: z.number().min(0, 'المقدم لا يمكن أن يكون سالباً').default(0),
  monthly_installment: z.number({ required_error: 'قيمة القسط الشهري إلزامية' }).positive('قيمة القسط الشهري يجب أن تكون أكبر من صفر'),
  installments_count: z.number({ required_error: 'عدد الأقساط إلزامي' }).int().min(1, 'عدد الأقساط يجب أن يكون 1 على الأقل'),
  discount_amount: z.number().min(0, 'قيمة الخصم لا يمكن أن تكون سالبة').default(0),
  delivery_date: z.string().regex(dateRegex, 'صيغة تاريخ التسليم يجب أن تكون YYYY-MM-DD').optional(),
  first_installment_date: z.string({ required_error: 'تاريخ أول قسط إلزامي' }).regex(dateRegex, 'صيغة تاريخ أول قسط يجب أن تكون YYYY-MM-DD'),
  due_day: z.number().int().min(1, 'يوم الاستحقاق من 1 إلى 31').max(31, 'يوم الاستحقاق من 1 إلى 31').optional(),
  collection_type: z.string().max(50).optional().default('فرع'),
  guarantor: z.object({
    name: z.string().min(2, 'اسم الضامن يجب أن لا يقل عن حرفين').max(150),
    phones: z.array(phoneSchema).optional().default([]),
  }).optional().nullable(),
});

const recordPaymentSchema = z.object({
  amount: z.number({ required_error: 'قيمة الدفعة إلزامية' }).positive('قيمة الدفعة يجب أن تكون أكبر من صفر'),
  payment_date: z.string().regex(dateRegex, 'صيغة تاريخ الدفع يجب أن تكون YYYY-MM-DD').optional(),
  notes: z.string().max(500, 'الملاحظة طويلة جداً').optional().nullable(),
});

const overdueSalesSchema = z.object({
  branch_id: z.coerce.number().int().positive().optional(),
  due_day: z.coerce.number().int().min(1).max(31).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const addNoteSchema = z.object({
  content: z.string({ required_error: 'محتوى الملاحظة إلزامي' }).min(1, 'محتوى الملاحظة إلزامي').max(2000, 'محتوى الملاحظة طويل جداً').trim(),
  note_type: z.enum(['call', 'visit', 'inquiry', 'legal', 'general', 'legacy_import'], {
    invalid_type_error: 'نوع الملاحظة غير صالح',
  }).default('call'),
  follow_up_date: z.string().regex(dateRegex, 'صيغة تاريخ المتابعة يجب أن تكون YYYY-MM-DD').optional().nullable(),
});

module.exports = {
  validate,
  createCustomerSchema,
  searchCustomerSchema,
  createSaleSchema,
  recordPaymentSchema,
  overdueSalesSchema,
  addNoteSchema,
};
