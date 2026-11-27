const { z } = require('zod');
const { toAsciiDigits } = require('../lib/arabic');

function validate(schema, source = 'body') {
  return (req, res, next) => {
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

const registerUserSchema = z.object({
  username: z.string({ required_error: 'اسم المستخدم إلزامي' }).min(1, 'اسم المستخدم إلزامي').max(100, 'اسم المستخدم طويل جداً').trim(),
  email: z.string({ required_error: 'البريد الإلكتروني إلزامي' }).email('أدخل بريداً إلكترونياً صالحاً').max(254).trim(),
  password: z.string({ required_error: 'كلمة المرور إلزامية' }).min(8, 'كلمة المرور يجب ألا تقل عن 8 أحرف').max(72, 'كلمة المرور لا تتجاوز 72 حرفاً'),
  role: z.enum(['admin', 'employee', 'accountant', 'follow_up'], {
    invalid_type_error: 'الدور يجب أن يكون admin أو employee أو accountant أو follow_up',
  }).optional().default('employee'),
  branch_id: z.number({ invalid_type_error: 'معرف الفرع يجب أن يكون رقماً' }).int().positive('معرف الفرع يجب أن يكون رقماً موجباً').optional().nullable(),
  device_id: z.string()
    .trim()
    .min(1, 'بصمة الجهاز غير صالحة')
    .max(256, 'بصمة الجهاز يجب ألا تتجاوز 256 حرفاً')
    .refine((val) => !/[\s,\p{Cc}]/u.test(val), 'بصمة الجهاز يجب ألا تحتوي على مسافات أو فواصل')
    .optional()
    .nullable(),
}).strict()
.refine(
  (data) => {
    if (data.role === 'employee') {
      return typeof data.branch_id === 'number' && Number.isInteger(data.branch_id) && data.branch_id > 0;
    }
    return true;
  },
  {
    message: 'حقل الفرع (branch_id) إلزامي لموظف الفرع ويجب أن يكون رقماً صحيحاً موجباً',
    path: ['branch_id'],
  }
);

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

const SALE_STATUSES = ['حالي', 'منتظم', 'متأخر', 'منتهي', 'محامي'];
const EDITABLE_SALE_STATUSES = ['حالي', 'منتظم', 'متأخر', 'محامي'];
const PAYMENT_METHODS = ['كاش', 'فودافون كاش'];

function normalizeSaleStatusInput(val) {
  if (typeof val !== 'string') return val;
  const trimmed = val.trim();
  const map = {
    'حالى': 'حالي',
    'متاخر': 'متأخر',
    'منتهى': 'منتهي',
    'محامى': 'محامي',
  };
  return map[trimmed] || trimmed;
}

function normalizePaymentMethodInput(val) {
  if (typeof val !== 'string') return val;
  const trimmed = val.trim();
  if (trimmed === 'فودافون_كاش') return 'فودافون كاش';
  return trimmed;
}

const saleStatusFilterSchema = z.preprocess(
  normalizeSaleStatusInput,
  z.enum(SALE_STATUSES, { invalid_type_error: 'حالة الفاتورة غير صالحة' })
).optional();

const updateSaleStatusSchema = z.object({
  status: z.preprocess(
    normalizeSaleStatusInput,
    z.enum(EDITABLE_SALE_STATUSES, {
      required_error: 'حالة الفاتورة (status) إلزامية',
      invalid_type_error: 'الحالة المسموح بتعديلها يدوياً هي: حالي، منتظم، متأخر، محامي فقط (حالة منتهي تُحدث تلقائياً عند السداد)',
    })
  ),
});

const recordPaymentSchema = z.object({
  amount: z.number({ required_error: 'قيمة الدفعة إلزامية' }).positive('قيمة الدفعة يجب أن تكون أكبر من صفر'),
  payment_date: z.string().regex(dateRegex, 'صيغة تاريخ الدفع يجب أن تكون YYYY-MM-DD').optional(),
  payment_method: z.preprocess(
    normalizePaymentMethodInput,
    z.enum(PAYMENT_METHODS, {
      invalid_type_error: 'طريقة الدفع يجب أن تكون كاش أو فودافون كاش',
    })
  ).optional().default('كاش'),
  collection_branch_id: z.number({ invalid_type_error: 'معرف فرع التحصيل يجب أن يكون رقماً' }).int().positive('معرف فرع التحصيل يجب أن يكون رقماً موجباً').optional().nullable(),
  notes: z.string().max(500, 'الملاحظة طويلة جداً').optional().nullable(),
});

const dailySummarySchema = z.object({
  date: z.string().regex(dateRegex, 'صيغة التاريخ يجب أن تكون YYYY-MM-DD').optional(),
  branch_id: z.coerce.number().int().positive().optional(),
});

const overdueSalesSchema = z.object({
  branch_id: z.coerce.number().int().positive().optional(),
  due_day: z.coerce.number().int().min(1).max(31).optional(),
  status: saleStatusFilterSchema,
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const followUpSalesSchema = z.object({
  branch_id: z.coerce.number().int().positive().optional(),
  day: z.coerce.number().int().min(1, 'اليوم يجب أن يكون بين 1 و 31').max(31, 'اليوم يجب أن يكون بين 1 و 31').optional(),
  date: z.string().regex(dateRegex, 'صيغة التاريخ يجب أن تكون YYYY-MM-DD').optional(),
  status: saleStatusFilterSchema,
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const searchSalesSchema = z.object({
  invoice_number: z.string().max(50).trim().optional(),
  q: z.string().max(100).trim().optional(),
  branch_id: z.coerce.number().int().positive().optional(),
  status: saleStatusFilterSchema,
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const saleDetailsParamsSchema = z.object({
  id: z.string().trim().transform(toAsciiDigits)
    .pipe(z.string().regex(/^\d+$/, 'معرف الفاتورة يجب أن يكون رقماً صحيحاً موجباً'))
    .pipe(z.coerce.number().int().positive('معرف الفاتورة يجب أن يكون رقماً صحيحاً موجباً')),
});

const saleByInvoiceParamsSchema = z.object({
  invoice_number: z.string().trim().min(1, 'رقم الفاتورة إلزامي')
    .max(50, 'رقم الفاتورة طويل جداً').transform(toAsciiDigits),
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
  registerUserSchema,
  createCustomerSchema,
  searchCustomerSchema,
  createSaleSchema,
  searchSalesSchema,
  saleDetailsParamsSchema,
  saleByInvoiceParamsSchema,
  recordPaymentSchema,
  updateSaleStatusSchema,
  dailySummarySchema,
  overdueSalesSchema,
  followUpSalesSchema,
  addNoteSchema,
};
