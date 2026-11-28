const swaggerUi = require('swagger-ui-express');
const { limits } = require('../auth/domain/input');

const invoiceSearchExample = {
  sale_id: 50,
  invoice_number: 'A116',
  branch_id: 2,
  branch_name: 'الإصلاح',
  customer_id: 10,
  customer_code: '3000010',
  customer_name: 'أحمد محمود',
  primary_phone: '01012345678',
  item_details: 'ثلاجة',
  monthly_installment: '1000.00',
  installments_count: 5,
  first_installment_date: '2026-11-01',
  due_day: 1,
  total_paid: '1000.00',
  required_installments_total: '5000.00',
  remaining_amount: '4000.00',
  due_installments: 1,
  due_amount: '1000.00',
  overdue_amount: '0.00',
  status: 'منتظم',
  guarantors: [{ name: 'محمود السيد', phones: [{ phone: '01112345678' }] }],
};

const invoiceDetailsExample = {
  id: 50,
  invoice_number: 'A116',
  branch_id: 2,
  customer_id: 10,
  address_id: 5,
  item_details: 'ثلاجة',
  cash_price: '5000.00',
  down_payment: '1000.00',
  monthly_installment: '1000.00',
  installments_count: 5,
  discount_amount: '0.00',
  total_amount: '6000.00',
  delivery_date: '2026-10-25',
  first_installment_date: '2026-11-01',
  due_day: 1,
  collection_type: 'فرع',
  status: 'منتظم',
  created_at: '2026-10-25T10:00:00.000Z',
  updated_at: '2026-11-01T10:00:00.000Z',
  branch: { id: 2, name: 'الإصلاح' },
  customer: {
    id: 10, customer_code: '3000010', name: 'أحمد محمود',
    phones: [{ id: 11, phone: '01012345678', is_primary: true, label: 'شخصي' }],
  },
  address: { id: 5, area: 'العجمي', housing_type: 'ملك', address_details: 'شارع السوق', is_current: true },
  guarantors: [{
    id: 70, sale_id: 50, name: 'محمود السيد', created_at: '2026-10-25T10:00:00.000Z',
    phones: [{ id: 12, phone: '01112345678', is_primary: true, label: 'موبايل' }],
  }],
  payments: [{
    id: 20, sale_id: 50, amount: '1000.00', payment_month: '2026-11-01',
    payment_date: '2026-11-01', payment_method: 'كاش', notes: null, created_at: '2026-11-01T10:00:00.000Z',
  }],
  notes: [{
    id: 30, sale_id: 50, created_by_user_id: '22222222-2222-4222-8222-222222222222',
    note_type: 'call', content: 'تم التواصل', follow_up_date: '2026-11-28', created_at: '2026-11-27T10:00:00.000Z',
  }],
  total_paid: '1000.00',
  required_installments_total: '5000.00',
  remaining_amount: '4000.00',
  due_installments: 1,
  due_amount: '1000.00',
  overdue_amount: '0.00',
};
invoiceDetailsExample.guarantor = invoiceDetailsExample.guarantors[0];

const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Alex Project API Documentation',
    version: '1.0.0',
    description: 'توثيق واجهات برمجة التطبيقات (APIs) لمشروع Alex Project مع نظام المصادقة وبصمة الجهاز (x-device-id).',
  },
  servers: [
    {
      url: '/',
      description: 'Current Environment Server',
    },
  ],
  paths: {
    '/': {
      get: {
        tags: ['General'],
        summary: 'رسالة الترحيب',
        description: 'نقطة البداية للمشروع للتأكد من عمل الخادم.',
        responses: {
          200: {
            description: 'نجاح الطلب',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: {
                      type: 'string',
                      example: 'Welcome to Alex Project API',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/register': {
      post: {
        tags: ['Authentication'],
        summary: 'تسجيل مستخدم جديد (خاص بالأدمن فقط)',
        description: 'إنشاء حساب جديد بواسطة الأدمن وتشفير كلمة المرور وتحديد الدور (role) والفرع (branch_id). يمكن للأدمن تحديد بصمة الجهاز (device_id) للمستخدم مباشرة عند الإنشاء، أو تركها فارغة ليتم ربطها عند أول تسجيل دخول للموظف. الأدمن لا يحتاج لإرسال x-device-id.',
        security: [
          {
            bearerAuth: [],
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'email', 'password'],
                properties: {
                  username: {
                    type: 'string',
                    minLength: 1,
                    maxLength: limits.username,
                    example: 'ahmed_dev',
                  },
                  email: {
                    type: 'string',
                    format: 'email',
                    maxLength: limits.email,
                    example: 'ahmed@example.com',
                  },
                  password: {
                    type: 'string',
                    format: 'password',
                    minLength: limits.passwordMin,
                    description: 'الحد الأقصى 72 بايت بترميز UTF-8',
                    example: 'Secret1234',
                  },
                  role: {
                    type: 'string',
                    enum: ['admin', 'employee', 'accountant', 'follow_up'],
                    default: 'employee',
                    description: 'دور المستخدم في النظام (employee: موظف فرع، follow_up: موظف متابعات، accountant: محاسب، admin: مدير)',
                    example: 'employee',
                  },
                  branch_id: {
                    type: 'integer',
                    nullable: true,
                    description: 'معرف الفرع (إلزامي إذا كان الدور employee، واختياري/null لـ follow_up أو accountant أو admin)',
                    example: 1,
                  },
                  device_id: {
                    type: 'string',
                    nullable: true,
                    maxLength: limits.deviceId,
                    description: 'بصمة الجهاز المخصصة للمستخدم (بدون مسافات أو فواصل؛ اختياري)',
                    example: 'branch1-pos-01',
                  },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'تم إنشاء الحساب بنجاح',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: {
                      type: 'string',
                      example: 'تم إنشاء الحساب بنجاح',
                    },
                    user: {
                      type: 'object',
                      properties: {
                        id: { type: 'string', example: '123' },
                        username: { type: 'string', example: 'ahmed_dev' },
                        email: { type: 'string', example: 'ahmed@example.com' },
                        role: { type: 'string', example: 'employee' },
                        branch_id: { type: 'integer', nullable: true, example: 1 },
                      },
                    },
                  },
                },
              },
            },
          },
          400: {
            description: 'بيانات غير مكتملة أو مدخلات غير صحيحة أو اسم المستخدم/البريد مسجل مسبقاً',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: {
                      type: 'string',
                      example: 'أدخل بريداً إلكترونياً صالحاً',
                    },
                    field: { type: 'string', example: 'email' },
                  },
                },
              },
            },
          },
          401: {
            description: 'غير مصرح بالدخول',
          },
          403: {
            description: 'ليس لديك صلاحية تنفيذ هذا الإجراء (يتطلب دور admin)',
          },
          500: {
            description: 'خطأ في الخادم',
          },
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'تسجيل الدخول',
        description: 'تسجيل الدخول باستخدام اسم المستخدم (username) أو البريد الإلكتروني (email) وكلمة المرور وتوليد توكين JWT. الأدمن يدخل بدون بصمة جهاز (x-device-id)، بينما الموظف والمحاسب يشترط لهما إرسال بصمة الجهاز في الهيدر x-device-id.',
        parameters: [
          {
            name: 'x-device-id',
            in: 'header',
            required: false,
            description: 'بصمة أو معرف الجهاز الفريد (إلزامي للموظف والمحاسب، وغير مطلوب للأدمن)',
            schema: {
              type: 'string',
              minLength: 1,
              maxLength: limits.deviceId,
              description: 'بدون مسافات أو فواصل',
              example: 'device-unique-fingerprint-123',
            },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['password'],
                properties: {
                  username: {
                    type: 'string',
                    maxLength: limits.email,
                    description: 'اسم المستخدم أو البريد الإلكتروني (يمكن أيضاً إرسال الحقل باسم email أو identifier)',
                    example: 'ahmed_dev',
                  },
                  email: {
                    type: 'string',
                    format: 'email',
                    maxLength: limits.email,
                    description: 'اختياري كبديل عن username',
                    example: 'ahmed@example.com',
                  },
                  password: {
                    type: 'string',
                    format: 'password',
                    example: 'Secret1234',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'نجاح تسجيل الدخول وإرجاع التوكين',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    token: {
                      type: 'string',
                      example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
                    },
                    user: {
                      type: 'object',
                      properties: {
                        id: { type: 'string', example: '123' },
                        username: { type: 'string', example: 'ahmed_dev' },
                        email: { type: 'string', example: 'ahmed@example.com' },
                        role: { type: 'string', example: 'employee' },
                      },
                    },
                  },
                },
              },
            },
          },
          400: {
            description: 'بيانات ناقصة أو غير صالحة',
          },
          401: {
            description: 'بيانات الدخول غير صحيحة',
          },
          403: {
            description: 'الحساب مربوط بجهاز آخر',
          },
          409: {
            description: 'تعارض مع محاولة دخول متزامنة؛ أعد المحاولة',
          },
        },
      },
    },
    '/api/profile': {
      get: {
        tags: ['User Profile'],
        summary: 'عرض الملف الشخصي للمستخدم',
        description: 'نقطة محمية تتطلب Bearer Token وبصمة الجهاز (x-device-id).',
        security: [
          {
            bearerAuth: [],
            deviceIdAuth: [],
          },
        ],
        responses: {
          200: {
            description: 'تم التحقق من التوكين وبصمة الجهاز بنجاح',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: {
                      type: 'string',
                      example: 'تم التحقق من التوكين وبصمة الجهاز بنجاح',
                    },
                    user: {
                      type: 'object',
                      properties: {
                        id: { type: 'string', example: '123' },
                        username: { type: 'string', example: 'ahmed_dev' },
                        email: { type: 'string', example: 'ahmed@example.com' },
                        role: { type: 'string', example: 'employee' },
                        deviceId: { type: 'string', example: 'device-unique-fingerprint-123' },
                      },
                    },
                  },
                },
              },
            },
          },
          401: {
            description: 'غير مصرح أو التوكين غير صالح / منتهي',
          },
          403: {
            description: 'الجهاز غير مطابق للتوكين المسجل أو تم الدخول من جهاز آخر',
          },
        },
      },
    },
    '/api/auth/users': {
      get: {
        tags: ['Admin'],
        summary: 'عرض قائمة المستخدمين (خاص بالأدمن فقط)',
        description: 'استرجاع جميع المستخدمين المسجلين في النظام مع الصلاحيات وأرقام الفروع وبصمة الجهاز.',
        security: [
          {
            bearerAuth: [],
          },
        ],
        responses: {
          200: {
            description: 'قائمة المستخدمين بنجاح',
          },
          401: {
            description: 'غير مصرح بالدخول',
          },
          403: {
            description: 'ليس لديك صلاحية تنفيذ هذا الإجراء (المستخدم ليس أدمن)',
          },
        },
      },
    },
    '/api/auth/branches': {
      get: {
        tags: ['Admin'],
        summary: 'عرض قائمة الفروع (خاص بالأدمن فقط)',
        description: 'استرجاع قائمة الفروع المتاحة لربط موظفي الفروع بها عند إنشاء حساب جديد.',
        security: [
          {
            bearerAuth: [],
          },
        ],
        responses: {
          200: {
            description: 'قائمة الفروع بنجاح',
          },
          401: {
            description: 'غير مصرح بالدخول',
          },
          403: {
            description: 'ليس لديك صلاحية تنفيذ هذا الإجراء (المستخدم ليس أدمن)',
          },
        },
      },
    },
    '/api/admin-only': {
      get: {
        tags: ['Admin'],
        summary: 'لوحة الأدمن (خاصة بالمسؤولين فقط)',
        description: 'نقطة محمية مقتصرة حصرياً على المستخدمين أصحاب الدور `admin` (لا تشترط بصمة جهاز).',
        security: [
          {
            bearerAuth: [],
          },
        ],
        responses: {
          200: {
            description: 'الترحيب بالأدمن',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: {
                      type: 'string',
                      example: 'أهلاً بك في لوحة الأدمن',
                    },
                  },
                },
              },
            },
          },
          401: {
            description: 'غير مصرح بالدخول',
          },
          403: {
            description: 'ليس لديك صلاحية تنفيذ هذا الإجراء (المستخدم ليس أدمن)',
          },
        },
      },
    },
    '/api/customers': {
      post: {
        tags: ['Customers'],
        summary: 'إضافة عميل جديد وتوليد كوده تلقائياً',
        description: 'يقوم بإنشاء سجل عميل جديد في Transaction ذرية واحدة: يحدّث عداد الفرع في branches (last_number + 1) لاستخراج الكود الفريد، يطبّق معالجة الاسم العربي normalizeArabic، ويدخل أرقام الهواتف في phone_numbers والعنوان في customer_addresses. تحديد الفرع تلقائي: إذا كان المستخدم موظف فرع يؤخذ الفرع من حسابه تلقائياً ويتجاهل أي قيمة مرسلة في الـ Body، وإذا كان المستخدم أدمن/محاسب عام (غير مرتبط بفرع) فيلزم إرسال branch_id في الـ Body. يتطلب توكين صالح وبصمة جهاز مطابقة.',
        security: [
          {
            bearerAuth: [],
            deviceIdAuth: [],
          },
        ],
        parameters: [
          {
            name: 'x-device-id',
            in: 'header',
            required: false,
            description: 'بصمة الجهاز (إلزامية لغير الأدمن، وغير مطلوبة للأدمن)',
            schema: {
              type: 'string',
              example: 'device-unique-fingerprint-123',
            },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  branch_id: {
                    type: 'integer',
                    description: 'معرف الفرع (إلزامي للأدمن والمحاسب العام؛ اختياري لموظف الفرع حيث يؤخذ من حسابه تلقائياً)',
                    example: 1,
                  },
                  name: {
                    type: 'string',
                    description: 'اسم العميل بالكامل',
                    example: 'أحمد محمود إبراهيم سالم',
                  },
                  phones: {
                    type: 'array',
                    description: 'أرقام هواتف العميل',
                    items: {
                      type: 'object',
                      properties: {
                        phone: {
                          type: 'string',
                          example: '01012345678',
                        },
                        is_primary: {
                          type: 'boolean',
                          example: true,
                        },
                        label: {
                          type: 'string',
                          example: 'شخصي',
                        },
                      },
                    },
                  },
                  address: {
                    type: 'object',
                    description: 'عنوان العميل الحالي',
                    properties: {
                      area: {
                        type: 'string',
                        example: 'العجمي',
                      },
                      housing_type: {
                        type: 'string',
                        example: 'إيجار جديد',
                      },
                      address_details: {
                        type: 'string',
                        example: 'شارع البيطاش الرئيسي، عمارة الأمل الدور الثالث',
                      },
                    },
                  },
                  risk_level: {
                    type: 'string',
                    description: 'مستوى المخاطرة الائتمانية',
                    enum: ['low', 'medium', 'high'],
                    example: 'low',
                  },
                  general_note: {
                    type: 'string',
                    description: 'ملاحظات عامة حول العميل',
                    example: 'عميل ملتزم بالسداد',
                  },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'تم إضافة العميل بنجاح وتوليد الكود',
          },
          400: {
            description: 'خطأ في المدخلات أو الفرع غير موجود',
          },
          401: {
            description: 'غير مصرح بالدخول (التوكين غير صالح أو مفقود)',
          },
          403: {
            description: 'الجهاز غير مطابق للتوكين أو تم الدخول من جهاز آخر',
          },
          500: {
            description: 'خطأ داخلي في الخادم',
          },
        },
      },
      get: {
        tags: ['Customers'],
        summary: 'البحث باسم العميل أو كوده أو هاتفه أو رقم الفاتورة',
        description: 'يدعم q اسم العميل العربي المطبع، كود العميل، رقم موبايله، أو رقم الفاتورة مع توحيد الأرقام العربية والإنجليزية. البحث ببيانات العميل يرجع كل فواتيره المتاحة في sales، والبحث برقم فاتورة فقط يرجع الفواتير المطابقة. الضامن موجود داخل كل sales[].guarantors باسمه وأرقام هواتفه فقط، ولا يوجد guarantors على مستوى العميل. الفواتير ومطابقة رقمها مقيدة بفرع الموظف. استخدم sale_id من النتيجة في GET /api/sales/{id} لعرض التفاصيل الكاملة. يدعم Pagination.',
        security: [
          {
            bearerAuth: [],
            deviceIdAuth: [],
          },
        ],
        parameters: [
          {
            name: 'x-device-id',
            in: 'header',
            required: true,
            description: 'بصمة الجهاز المقترنة بجلسة الدخول',
            schema: {
              type: 'string',
              example: 'device-unique-fingerprint-123',
            },
          },
          {
            name: 'q',
            in: 'query',
            required: false,
            description: 'كلمة البحث (اسم العميل، كوده، رقم موبايله، أو رقم الفاتورة مثل A116)',
            schema: {
              type: 'string',
              example: 'أحمد',
            },
          },
          {
            name: 'page',
            in: 'query',
            required: false,
            description: 'رقم الصفحة المطلوب استرجاعها',
            schema: {
              type: 'integer',
              default: 1,
              example: 1,
            },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            description: 'عدد العناصر في الصفحة (الحد الأقصى 100)',
            schema: {
              type: 'integer',
              default: 20,
              example: 20,
            },
          },
        ],
        responses: {
          200: {
            description: 'قائمة العملاء وبيانات التصفح بنجاح',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CustomerSearchResponse' },
                example: {
                  success: true,
                  data: [{
                    id: 10, customer_code: '3000010', name: 'أحمد محمود', normalized_name: 'احمد محمود',
                    risk_level: 'low', general_note: null,
                    phones: [{ id: 11, phone: '01012345678', is_primary: true, label: 'شخصي' }],
                    current_address: { id: 5, area: 'العجمي', housing_type: 'ملك', address_details: 'شارع السوق' },
                    sales: [{
                      sale_id: 50, invoice_number: 'A116', branch_id: 2, branch_name: 'الإصلاح',
                      item_details: 'ثلاجة', remaining_amount: 4000, status: 'منتظم',
                      guarantors: [{ name: 'محمود السيد', phones: [{ phone: '01112345678' }] }],
                    }],
                  }],
                  pagination: { total: 1, page: 1, limit: 20, totalPages: 1 },
                },
              },
            },
          },
          401: {
            description: 'غير مصرح بالدخول',
          },
          403: {
            description: 'الجهاز غير مطابق للتوكين',
          },
          500: {
            description: 'خطأ أثناء البحث',
          },
        },
      },
    },
    '/api/sales': {
      get: {
        tags: ['Sales'],
        summary: 'البحث عن الفواتير برقم الفاتورة (invoice_number) أو اسم/كود/هاتف العميل',
        description: 'بحث موحد بـ q برقم الفاتورة أو اسم العميل العربي المطبع أو كوده أو رقم موبايله، مع توحيد الأرقام العربية والإنجليزية. invoice_number فلتر مطابق لرقم الفاتورة غير حساس لحالة الأحرف وله الأولوية على q عند إرسالهما معاً. جميع طرق البحث ترجع نفس ملخص الفاتورة والأرصدة وguarantors داخل كل فاتورة (الاسم وأرقام الهواتف فقط). البحث ببيانات العميل يرجع فواتيره المتاحة. التفاصيل الكاملة، ومنها العنوان وسجل الدفعات والملاحظات، تُجلب بطلب GET /api/sales/{id} باستخدام sale_id من نتيجة البحث. تطبق صلاحيات الفرع والتصفح بالصفحات.',
        security: [
          {
            bearerAuth: [],
            deviceIdAuth: [],
          },
        ],
        parameters: [
          {
            name: 'x-device-id',
            in: 'header',
            required: false,
            description: 'بصمة الجهاز (إلزامية للموظف والمحاسب، وغير مطلوبة للأدمن)',
            schema: { type: 'string', example: 'device-unique-fingerprint-123' },
          },
          {
            name: 'invoice_number',
            in: 'query',
            required: false,
            description: 'رقم الفاتورة اليدوي للبحث المطابق (مثل A116)؛ يرجع نفس ملخص البحث بـ q وله الأولوية عليه',
            schema: { type: 'string', example: 'A116' },
          },
          {
            name: 'q',
            in: 'query',
            required: false,
            description: 'بحث عام (رقم الفاتورة، اسم العميل، كود العميل، أو رقم الهاتف)',
            schema: { type: 'string', example: 'A116' },
          },
          {
            name: 'branch_id',
            in: 'query',
            required: false,
            description: 'معرف الفرع (للأدمن والمحاسب فقط؛ موظف الفرع يُحدد فرعه تلقائياً)',
            schema: { type: 'integer', example: 1 },
          },
          {
            name: 'status',
            in: 'query',
            required: false,
            description: 'فلترة بحالة الفاتورة',
            schema: { type: 'string', enum: ['حالي', 'منتظم', 'متأخر', 'منتهي', 'محامي'], example: 'منتظم' },
          },
          {
            name: 'page',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 1, example: 1 },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 20, example: 20 },
          },
        ],
        responses: {
          200: {
            description: 'ملخصات الفواتير مع الأرصدة والضامن داخل كل فاتورة',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SaleSearchResponse' },
                example: {
                  success: true, data: [invoiceSearchExample],
                  pagination: { total: 1, page: 1, limit: 20, totalPages: 1 },
                },
              },
            },
          },
          400: { description: 'معايير البحث أو بيانات التصفح غير صالحة' },
          401: { description: 'غير مصرح بالدخول' },
          403: { description: 'الجهاز غير مطابق للتوكين' },
        },
      },
      post: {
        tags: ['Sales'],
        summary: 'إنشاء فاتورة بيع بالتقسيط جديدة مع الضامن',
        description: 'يقوم بإنشاء سجل فاتورة جديدة في Transaction ذرية: **معرف الفاتورة (id) يتولد تلقائياً (serial) من قاعدة البيانات، بينما رقم الفاتورة (invoice_number مثل A116) يُدخله الموظف يدوياً (Manual)** وهو ما يُستخدم لاحقاً للبحث ودفع الأقساط. يحدد الفرع تلقائياً بناءً على المستخدم (إذا كان موظف فرع يؤخذ فرعه تلقائياً، وإذا كان أدمن يلزم إرساله في الـ Body)، يحسب إجمالي الفاتورة، ويسجل الضامن وأرقامه إن وُجدوا.',
        security: [
          {
            bearerAuth: [],
            deviceIdAuth: [],
          },
        ],
        parameters: [
          {
            name: 'x-device-id',
            in: 'header',
            required: false,
            description: 'بصمة الجهاز المقترنة بجلسة تسجيل الدخول (إلزامي للموظف والمحاسب، وغير مطلوب للأدمن)',
            schema: {
              type: 'string',
              example: 'device-unique-fingerprint-123',
            },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['invoice_number', 'customer_id', 'monthly_installment', 'installments_count', 'first_installment_date'],
                properties: {
                  invoice_number: {
                    type: 'string',
                    description: 'رقم الفاتورة الفريد (يُدخله الموظف يدوياً مثل A116)',
                    example: 'A116',
                  },
                  branch_id: {
                    type: 'integer',
                    description: 'معرف الفرع (إلزامي للأدمن؛ اختياري لموظف الفرع حيث يؤخذ من حسابه)',
                    example: 1,
                  },
                  customer_id: {
                    type: 'integer',
                    description: 'معرف العميل المسجل في النظام',
                    example: 10,
                  },
                  address_id: {
                    type: 'integer',
                    description: 'معرف عنوان العميل (اختياري، إن لم يُرسل يؤخذ العنوان الحالي للعميل)',
                    example: 5,
                  },
                  item_details: {
                    type: 'string',
                    description: 'تفاصيل البضاعة أو الأجهزة المشتراة',
                    example: 'غسالة توشيبا 10 كيلو فوق أوتوماتيك',
                  },
                  cash_price: {
                    type: 'number',
                    description: 'سعر الكاش للبضاعة',
                    example: 12000,
                  },
                  down_payment: {
                    type: 'number',
                    description: 'المقدم المدفوع وقت التعاقد',
                    example: 2000,
                  },
                  monthly_installment: {
                    type: 'number',
                    description: 'قيمة القسط الشهري',
                    example: 1000,
                  },
                  installments_count: {
                    type: 'integer',
                    description: 'عدد الأقساط الإجمالي',
                    example: 12,
                  },
                  discount_amount: {
                    type: 'number',
                    description: 'قيمة الخصم الممنوح',
                    example: 0,
                  },
                  delivery_date: {
                    type: 'string',
                    format: 'date',
                    description: 'تاريخ تسليم البضاعة (YYYY-MM-DD)',
                    example: '2026-11-24',
                  },
                  first_installment_date: {
                    type: 'string',
                    format: 'date',
                    description: 'تاريخ استحقاق أول قسط (YYYY-MM-DD)',
                    example: '2026-12-01',
                  },
                  due_day: {
                    type: 'integer',
                    description: 'يوم الاستحقاق الشهري من 1 إلى 31 (اختياري، يؤخذ من تاريخ أول قسط تلقائياً)',
                    example: 1,
                  },
                  collection_type: {
                    type: 'string',
                    description: 'طريقة التحصيل (فرع، محصل، تحويل، بنك)',
                    example: 'فرع',
                  },
                  guarantor: {
                    type: 'object',
                    description: 'بيانات الضامن إن وجد',
                    properties: {
                      name: {
                        type: 'string',
                        description: 'اسم الضامن بالكامل',
                        example: 'محمد سعيد السيد',
                      },
                      phones: {
                        type: 'array',
                        description: 'أرقام هواتف الضامن',
                        items: {
                          type: 'object',
                          properties: {
                            phone: {
                              type: 'string',
                              example: '01234567890',
                            },
                            is_primary: {
                              type: 'boolean',
                              example: true,
                            },
                            label: {
                              type: 'string',
                              example: 'شخصي',
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'تم إنشاء الفاتورة بنجاح',
          },
          400: {
            description: 'بيانات غير صالحة أو رقم الفاتورة (invoice_number) مسجل مسبقاً',
          },
          401: {
            description: 'غير مصرح بالدخول',
          },
          403: {
            description: 'الجهاز غير مطابق للتوكين',
          },
          500: {
            description: 'خطأ داخلي أثناء إنشاء الفاتورة',
          },
        },
      },
    },
    '/api/sales/{id}': {
      get: {
        tags: ['Sales'],
        summary: 'عرض تفاصيل فاتورة محددة بواسطة معرفها (id)',
        description: 'يُرجع كامل تفاصيل الفاتورة المختارة بواسطة sales.id (بيانات الفاتورة، الأرصدة، بيانات العميل وهواتفه، العنوان، الضامنين وهواتفهم، سجل الدفعات، وملاحظات المتابعة) مع تطبيق تقييد الفرع. استخدم sale_id من نتيجة البحث كقيمة id، أو اطلب الفاتورة مباشرة بمعرفها. الرد كائن واحد في data بدون pagination. رقم الفاتورة invoice_number منفصل عن المعرف الداخلي id حتى لو كان رقماً فقط.',
        security: [
          {
            bearerAuth: [],
            deviceIdAuth: [],
          },
        ],
        parameters: [
          {
            name: 'x-device-id',
            in: 'header',
            required: false,
            description: 'بصمة الجهاز (إلزامية للموظف والمحاسب، وغير مطلوبة للأدمن)',
            schema: { type: 'string', example: 'device-unique-fingerprint-123' },
          },
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'معرف الفاتورة الداخلي (sales.id)',
            schema: { type: 'integer', example: 50 },
          },
        ],
        responses: {
          200: {
            description: 'تفاصيل الفاتورة الكاملة',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SaleDetailsResponse' },
                example: { success: true, data: invoiceDetailsExample },
              },
            },
          },
          400: { description: 'معرف الفاتورة غير صالح' },
          401: { description: 'غير مصرح بالدخول' },
          403: { description: 'غير مصرح بعرض فاتورة تخص فرع آخر أو الجهاز غير مطابق' },
          404: { description: 'الفاتورة غير موجودة' },
        },
      },
    },
    '/api/sales/by-invoice/{invoice_number}': {
      get: {
        tags: ['Sales'],
        summary: 'عرض تفاصيل فاتورة محددة مباشرة برقم الفاتورة (invoice_number)',
        description: 'مسار صريح لجلب التفاصيل الكاملة برقم الفاتورة اليدوي مثل A116. يرجع نفس تفاصيل GET /api/sales/{id}، بينما GET /api/sales?invoice_number=A116 يرجع ملخص البحث داخل قائمة.',
        security: [
          {
            bearerAuth: [],
            deviceIdAuth: [],
          },
        ],
        parameters: [
          {
            name: 'x-device-id',
            in: 'header',
            required: false,
            description: 'بصمة الجهاز (إلزامية للموظف والمحاسب، وغير مطلوبة للأدمن)',
            schema: { type: 'string', example: 'device-unique-fingerprint-123' },
          },
          {
            name: 'invoice_number',
            in: 'path',
            required: true,
            description: 'رقم الفاتورة اليدوي (مثل A116)',
            schema: { type: 'string', example: 'A116' },
          },
        ],
        responses: {
          200: {
            description: 'تفاصيل الفاتورة الكاملة',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SaleDetailsResponse' },
                example: { success: true, data: invoiceDetailsExample },
              },
            },
          },
          400: { description: 'رقم الفاتورة غير صالح' },
          401: { description: 'غير مصرح بالدخول' },
          403: { description: 'غير مصرح بعرض فاتورة تخص فرع آخر أو الجهاز غير مطابق' },
          404: { description: 'الفاتورة غير موجودة' },
        },
      },
    },
    '/api/sales/{id}/payments': {
      post: {
        tags: ['Sales'],
        summary: 'تسجيل دفعة / قسط للفاتورة',
        description: 'يقوم بتسجيل دفعة جديدة في جدول payments، واحتساب شهر القسط payment_month تلقائياً (بداية الشهر firstOfMonth)، وقفل سجل الفاتورة لمنع التضارب، وتحديث حالة الفاتورة تلقائياً إلى "منتهي" فور اكتمال سداد إجمالي المستحق.',
        security: [
          {
            bearerAuth: [],
            deviceIdAuth: [],
          },
        ],
        parameters: [
          {
            name: 'x-device-id',
            in: 'header',
            required: false,
            description: 'بصمة الجهاز (إلزامية لغير الأدمن، وغير مطلوبة للأدمن)',
            schema: {
              type: 'string',
              example: 'device-unique-fingerprint-123',
            },
          },
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'رقم الفاتورة (invoice_number مثل A116) أو معرف الفاتورة الداخلي (sales.id)',
            schema: {
              type: 'string',
              example: 'A116',
            },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['amount'],
                properties: {
                  amount: {
                    type: 'number',
                    description: 'قيمة الدفعة أو القسط المسدد',
                    example: 1000,
                  },
                  payment_date: {
                    type: 'string',
                    format: 'date',
                    description: 'تاريخ السداد (YYYY-MM-DD)، الافتراضي تاريخ اليوم',
                    example: '2026-12-01',
                  },
                  payment_method: {
                    type: 'string',
                    enum: ['كاش', 'فودافون كاش'],
                    default: 'كاش',
                    description: 'طريقة الدفع (كاش أو فودافون كاش)',
                    example: 'فودافون كاش',
                  },
                  collection_branch_id: {
                    type: 'integer',
                    description: 'معرف فرع التحصيل (يُحدد تلقائياً من فرع الموظف، أو يمرره الأدمن/المحاسب لحساب يومية كل فرع)',
                    example: 2,
                  },
                  notes: {
                    type: 'string',
                    description: 'ملاحظات حول الدفعة أو طريقة التحصيل',
                    example: 'سداد قسط شهر ديسمبر كاش بالفرع',
                  },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'تم تسجيل الدفعة وتحديث الرصيد وحالة الفاتورة بنجاح',
            content: {
              'application/json': {
                example: {
                  success: true,
                  message: 'تم تسجيل الدفعة بنجاح',
                  data: {
                    payment: {
                      id: 99,
                      sale_id: 50,
                      amount: '1000.00',
                      payment_month: '2026-12-01',
                      payment_date: '2026-12-01',
                      payment_method: 'فودافون كاش',
                      collection_branch_id: 2,
                      collection_branch_name: 'الإصلاح',
                      notes: 'سداد قسط شهر ديسمبر',
                      created_at: '2026-12-01T10:00:00.000Z',
                    },
                    summary: {
                      sale_id: 50,
                      invoice_number: 'A116',
                      required_installments_total: 5000,
                      total_paid: 5000,
                      remaining_balance: 0,
                      sale_status: 'منتهي',
                      is_completed: true,
                    },
                  },
                },
              },
            },
          },
          400: {
            description: 'قيمة الدفعة أو طريقة الدفع أو معرف الفاتورة غير صالح',
          },
          401: {
            description: 'غير مصرح بالدخول',
          },
          403: {
            description: 'غير مصرح لك بتسجيل دفعة على فاتورة تخص فرع آخر أو الجهاز غير مطابق',
          },
          404: {
            description: 'الفاتورة غير موجودة في النظام',
          },
          500: {
            description: 'خطأ داخلي أثناء تسجيل الدفعة',
          },
        },
      },
    },
    '/api/sales/{id}/status': {
      patch: {
        tags: ['Sales'],
        summary: 'تغيير حالة الفاتورة (للأدمن أو موظف المتابعات follow_up فقط)',
        description: 'تحديث حالة الفاتورة يدوياً إلى (حالي، منتظم، متأخر، محامي). حالة "منتهي" تُحدَّث تلقائياً عند سداد كامل الأقساط ولا يمكن تغييرها يدوياً.',
        security: [{ bearerAuth: [], deviceIdAuth: [] }],
        parameters: [
          {
            name: 'x-device-id',
            in: 'header',
            required: false,
            description: 'بصمة الجهاز (إلزامية لـ follow_up، وغير مطلوبة للأدمن)',
            schema: { type: 'string', example: 'device-unique-fingerprint-123' },
          },
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'رقم الفاتورة أو معرفها الداخلي',
            schema: { type: 'string', example: 'A116' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: {
                    type: 'string',
                    enum: ['حالي', 'منتظم', 'متأخر', 'محامي'],
                    example: 'منتظم',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'تم تحديث حالة الفاتورة بنجاح',
            content: {
              'application/json': {
                example: {
                  success: true,
                  message: 'تم تحديث حالة الفاتورة بنجاح',
                  data: {
                    id: 50,
                    invoice_number: 'A116',
                    branch_id: 2,
                    status: 'منتظم',
                    updated_at: '2026-11-27T12:00:00.000Z',
                  },
                },
              },
            },
          },
          400: { description: 'الحالة غير صالحة أو الفاتورة منتهية بالفعل' },
          401: { description: 'غير مصرح بالدخول' },
          403: { description: 'ليس لديك صلاحية تنفيذ هذا الإجراء (يتطلب admin أو follow_up)' },
          404: { description: 'الفاتورة غير موجودة' },
        },
      },
    },
    '/api/sales/daily-summary': {
      get: {
        tags: ['Sales'],
        summary: 'حساب يومية التحصيل آخر اليوم لكل فرع (كاش وفودافون كاش)',
        description: 'يرجع إجمالي التحصيل وعدد الدفعات مقسماً حسب طريقة الدفع (كاش / فودافون كاش) وحسب فرع التحصيل الفعلي (by_branch) لتاريخ محدد (الافتراضي تاريخ اليوم بتوقيت القاهرة) مع قائمة دفعات اليوم.',
        security: [{ bearerAuth: [], deviceIdAuth: [] }],
        parameters: [
          {
            name: 'x-device-id',
            in: 'header',
            required: false,
            description: 'بصمة الجهاز (إلزامية لغير الأدمن، وغير مطلوبة للأدمن)',
            schema: { type: 'string', example: 'device-unique-fingerprint-123' },
          },
          { name: 'date', in: 'query', required: false, description: 'التاريخ (YYYY-MM-DD)، الافتراضي تاريخ اليوم بتوقيت القاهرة', schema: { type: 'string', format: 'date', example: '2026-11-27' } },
          { name: 'branch_id', in: 'query', required: false, description: 'معرف فرع التحصيل (للأدمن/المحاسب/المتابعة بدون فرع؛ موظف الفرع يُحدد فرعه تلقائياً)', schema: { type: 'integer', example: 2 } },
        ],
        responses: {
          200: {
            description: 'تم حساب اليومية بنجاح',
            content: {
              'application/json': {
                example: {
                  success: true,
                  date: '2026-11-27',
                  branch_id: 2,
                  summary: {
                    total_amount: 2500,
                    payments_count: 2,
                    cash: { total: 1500, count: 1 },
                    vodafone_cash: { total: 1000, count: 1 },
                  },
                  by_branch: [
                    {
                      branch_id: 2,
                      branch_name: 'الإصلاح',
                      total_amount: 2500,
                      payments_count: 2,
                      cash: { total: 1500, count: 1 },
                      vodafone_cash: { total: 1000, count: 1 },
                    },
                  ],
                  payments: [
                    {
                      id: 99,
                      sale_id: 50,
                      invoice_number: 'A116',
                      collection_branch_id: 2,
                      collection_branch_name: 'الإصلاح',
                      sale_branch_id: 2,
                      sale_branch_name: 'الإصلاح',
                      customer_id: 10,
                      customer_name: 'أحمد محمود',
                      amount: '1000.00',
                      payment_method: 'فودافون كاش',
                      payment_date: '2026-11-27',
                      notes: null,
                      created_at: '2026-11-27T12:00:00.000Z',
                    },
                  ],
                },
              },
            },
          },
          400: { description: 'صيغة التاريخ أو معرف الفرع غير صالح' },
          401: { description: 'غير مصرح بالدخول' },
          403: { description: 'غير مصرح لك بعرض اليومية أو الجهاز غير مطابق' },
        },
      },
    },
    '/api/sales/monthly-summary': {
      get: {
        tags: ['Sales'],
        summary: 'حساب التحصيل الشهري لكل فرع والإجمالي العام (كاش وفودافون كاش)',
        description: 'يرجع عدد الفروع وتحصيل كل فرع خلال شهر محدد (الافتراضي الشهر الحالي بتوقيت القاهرة) مقسماً بين كاش وفودافون كاش، بالإضافة إلى المجموع العام في summary. للأدمن والمحاسب يعرض كل الفروع، ولموظف الفرع يعرض فرعه فقط (غير متاح لحساب المتابعة).',
        security: [{ bearerAuth: [], deviceIdAuth: [] }],
        parameters: [
          {
            name: 'x-device-id',
            in: 'header',
            required: false,
            description: 'بصمة الجهاز (إلزامية لغير الأدمن، وغير مطلوبة للأدمن)',
            schema: { type: 'string', example: 'device-unique-fingerprint-123' },
          },
          { name: 'month', in: 'query', required: false, description: 'الشهر بصيغة YYYY-MM (الافتراضي الشهر الحالي بتوقيت القاهرة)', schema: { type: 'string', example: '2026-11' } },
          { name: 'branch_id', in: 'query', required: false, description: 'معرف فرع التحصيل (اختياري للأدمن والمحاسب بدون فرع؛ موظف الفرع يُحدد فرعه تلقائياً)', schema: { type: 'integer', example: 2 } },
        ],
        responses: {
          200: {
            description: 'تم حساب التحصيل الشهري بنجاح',
            content: {
              'application/json': {
                example: {
                  success: true,
                  month: '2026-11',
                  branch_id: null,
                  branches_count: 4,
                  summary: {
                    branches_count: 4,
                    total_amount: 371799,
                    payments_count: 234,
                    cash: { total: 355559, count: 220 },
                    vodafone_cash: { total: 16240, count: 14 },
                  },
                  by_branch: [
                    {
                      branch_id: 1,
                      branch_name: 'الحمد',
                      total_amount: 50480,
                      payments_count: 56,
                      cash: { total: 50480, count: 56 },
                      vodafone_cash: { total: 0, count: 0 },
                    },
                    {
                      branch_id: 2,
                      branch_name: 'الاصلاح',
                      total_amount: 102944,
                      payments_count: 107,
                      cash: { total: 86704, count: 93 },
                      vodafone_cash: { total: 16240, count: 14 },
                    },
                  ],
                },
              },
            },
          },
          400: { description: 'صيغة الشهر أو معرف الفرع غير صالح' },
          401: { description: 'غير مصرح بالدخول' },
          403: { description: 'غير مصرح لك بعرض التحصيل الشهري أو الجهاز غير مطابق' },
        },
      },
    },
    '/api/sales/follow-up': {
      get: {
        tags: ['Sales'],
        summary: 'قائمة المتابعة اليومية للمتأخرين في السداد (حتى يوم محدد أو تاريخ اليوم)',
        description: 'يرجع جميع العملاء المتأخرين في السداد (status != منتهي و overdue_amount > 0) الذين يكون يوم استحقاقهم (due_day) أقل من أو يساوي اليوم المحدد (مثلاً يوم 25 يجلب كل المتأخرين من يوم 1 حتى 25). إذا لم يُرسل day أو date يُستخدم يوم اليوم تلقائياً بتوقيت القاهرة. يرجع كامل بيانات العميل، الهواتف، العنوان، الضامنين وهواتفهم، تفاصيل الفاتورة والأرصدة، وآخر ملاحظة وسجل الملاحظات.',
        security: [
          {
            bearerAuth: [],
            deviceIdAuth: [],
          },
        ],
        parameters: [
          {
            name: 'x-device-id',
            in: 'header',
            required: false,
            description: 'بصمة الجهاز (إلزامية للموظف والمحاسب، وغير مطلوبة للأدمن)',
            schema: { type: 'string', example: 'device-unique-fingerprint-123' },
          },
          {
            name: 'day',
            in: 'query',
            required: false,
            description: 'رقم اليوم في الشهر (1 - 31) لجلب المتأخرين حتى هذا اليوم شاملة (الافتراضي يوم اليوم)',
            schema: { type: 'integer', minimum: 1, maximum: 31, example: 25 },
          },
          {
            name: 'date',
            in: 'query',
            required: false,
            description: 'تاريخ بصيغة YYYY-MM-DD لاستخراج اليوم منه في حال عدم إرسال day',
            schema: { type: 'string', format: 'date', example: '2026-11-25' },
          },
          {
            name: 'branch_id',
            in: 'query',
            required: false,
            description: 'معرف الفرع (للأدمن والمحاسب فقط؛ موظف الفرع يُحدد فرعه تلقائياً)',
            schema: { type: 'integer', example: 1 },
          },
          {
            name: 'status',
            in: 'query',
            required: false,
            description: 'فلترة بحالة الفاتورة',
            schema: { type: 'string', enum: ['حالي', 'منتظم', 'متأخر', 'منتهي', 'محامي'], example: 'منتظم' },
          },
          {
            name: 'page',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 1, example: 1 },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 20, example: 20 },
          },
        ],
        responses: {
          200: { description: 'قائمة المتابعة مع كامل بيانات العملاء والضامنين والأرصدة والملاحظات' },
          400: { description: 'معاملات الفلترة غير صالحة' },
          401: { description: 'غير مصرح بالدخول' },
          403: { description: 'غير مصرح أو الجهاز غير مطابق' },
          500: { description: 'خطأ أثناء استرجاع قائمة المتابعة' },
        },
      },
    },
    '/api/sales/overdue': {
      get: {
        tags: ['Sales'],
        summary: 'استعلام فواتير الأقساط المتأخرة لمسؤولي التحصيل',
        description: 'يعتمد على الـ SQL View (sale_balances) لحساب الأقساط المستحقة والمتأخرات بدقة لكل فاتورة نشطة. يطبق قاعدة الفرع التلقائية: موظف الفرع يرى متأخرات فرعه فقط، بينما الأدمن والمحاسب العام يمكنهما الفلترة بـ branch_id أو استعراض كل الفروع. يدعم الفلترة بيوم الاستحقاق due_day والـ Pagination.',
        security: [
          {
            bearerAuth: [],
            deviceIdAuth: [],
          },
        ],
        parameters: [
          {
            name: 'x-device-id',
            in: 'header',
            required: false,
            description: 'بصمة الجهاز (إلزامية لغير الأدمن، وغير مطلوبة للأدمن)',
            schema: {
              type: 'string',
              example: 'device-unique-fingerprint-123',
            },
          },
          {
            name: 'branch_id',
            in: 'query',
            required: false,
            description: 'معرف الفرع للفلترة (متاح للأدمن؛ موظف الفرع يُحدد فرعه تلقائياً)',
            schema: {
              type: 'integer',
              example: 1,
            },
          },
          {
            name: 'due_day',
            in: 'query',
            required: false,
            description: 'يوم الاستحقاق الشهري (1 - 31)',
            schema: {
              type: 'integer',
              example: 5,
            },
          },
          {
            name: 'status',
            in: 'query',
            required: false,
            description: 'فلترة بحالة الفاتورة',
            schema: { type: 'string', enum: ['حالي', 'منتظم', 'متأخر', 'منتهي', 'محامي'], example: 'متأخر' },
          },
          {
            name: 'page',
            in: 'query',
            required: false,
            description: 'رقم الصفحة (الافتراضي 1)',
            schema: {
              type: 'integer',
              default: 1,
              example: 1,
            },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            description: 'عدد العناصر في الصفحة (الافتراضي 20، الحد الأقصى 100)',
            schema: {
              type: 'integer',
              default: 20,
              example: 20,
            },
          },
        ],
        responses: {
          200: {
            description: 'قائمة الفواتير المتأخرة بنجاح مع بيانات العملاء وآخر ملاحظة متابعة',
          },
          401: {
            description: 'غير مصرح بالدخول',
          },
          403: {
            description: 'الجهاز غير مطابق للتوكين',
          },
          500: {
            description: 'خطأ أثناء استعلام المتأخرات',
          },
        },
      },
    },
    '/api/sales/{id}/notes': {
      post: {
        tags: ['Sales'],
        summary: 'تسجيل ملاحظة متابعة أو اتصال هاتفي للفاتورة',
        description: 'يقوم بتسجيل نتيجة المكالمة أو المتابعة الميدانية وربطها بالمستخدم الحالي req.user.id وجدولة تاريخ المتابعة القادم follow_up_date.',
        security: [
          {
            bearerAuth: [],
            deviceIdAuth: [],
          },
        ],
        parameters: [
          {
            name: 'x-device-id',
            in: 'header',
            required: false,
            description: 'بصمة الجهاز (إلزامية لغير الأدمن، وغير مطلوبة للأدمن)',
            schema: {
              type: 'string',
              example: 'device-unique-fingerprint-123',
            },
          },
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'رقم الفاتورة (invoice_number مثل A116) أو معرف الفاتورة الداخلي (sales.id)',
            schema: {
              type: 'string',
              example: 'A116',
            },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['content'],
                properties: {
                  content: {
                    type: 'string',
                    description: 'نص ملاحظة أو نتيجة الاتصال بالعميل',
                    example: 'تم الاتصال بالعميل ووعد بالحضور للفرع والسداد يوم الخميس القادم',
                  },
                  note_type: {
                    type: 'string',
                    description: 'نوع الملاحظة',
                    enum: ['call', 'visit', 'inquiry', 'legal', 'general', 'legacy_import'],
                    default: 'call',
                    example: 'call',
                  },
                  follow_up_date: {
                    type: 'string',
                    format: 'date',
                    description: 'تاريخ المتابعة القادم المطلوب الاتصال فيه بالعميل (YYYY-MM-DD)',
                    example: '2026-11-28',
                  },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'تم تسجيل الملاحظة بنجاح وجدولة المتابعة',
          },
          400: {
            description: 'محتوى الملاحظة مفقود أو غير صالح',
          },
          401: {
            description: 'غير مصرح بالدخول',
          },
          403: {
            description: 'غير مصرح لك بتسجيل ملاحظة على فاتورة تخص فرع آخر أو الجهاز غير مطابق',
          },
          404: {
            description: 'الفاتورة غير موجودة',
          },
          500: {
            description: 'خطأ داخلي أثناء تسجيل الملاحظة',
          },
        },
      },
    },
  },
  components: {
    schemas: {
      DatabaseNumber: {
        description: 'قيمة رقمية؛ قد تُرجع PostgreSQL أرقام numeric وbigint كنصوص.',
        oneOf: [{ type: 'number' }, { type: 'string' }],
      },
      SearchGuarantor: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'phones'],
        properties: {
          name: { type: 'string', example: 'محمود السيد' },
          phones: {
            type: 'array',
            description: 'أرقام هواتف الضامن فقط، أو قائمة فارغة إذا لم يوجد رقم.',
            items: {
              type: 'object', additionalProperties: false, required: ['phone'],
              properties: { phone: { type: 'string', example: '01112345678' } },
            },
          },
        },
      },
      Pagination: {
        type: 'object', required: ['total', 'page', 'limit', 'totalPages'],
        properties: {
          total: { type: 'integer', minimum: 0 },
          page: { type: 'integer', minimum: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          totalPages: { type: 'integer', minimum: 1 },
        },
      },
      SaleSearchResult: {
        type: 'object', required: ['sale_id', 'invoice_number', 'guarantors'],
        properties: {
          sale_id: { $ref: '#/components/schemas/DatabaseNumber' },
          invoice_number: { type: 'string' },
          branch_id: { $ref: '#/components/schemas/DatabaseNumber' },
          branch_name: { type: 'string', nullable: true },
          customer_id: { $ref: '#/components/schemas/DatabaseNumber' },
          customer_code: { type: 'string' },
          customer_name: { type: 'string' },
          primary_phone: { type: 'string', nullable: true },
          item_details: { type: 'string', nullable: true },
          monthly_installment: { $ref: '#/components/schemas/DatabaseNumber' },
          installments_count: { type: 'integer' },
          first_installment_date: { type: 'string', format: 'date' },
          due_day: { type: 'integer' },
          total_paid: { $ref: '#/components/schemas/DatabaseNumber' },
          required_installments_total: { $ref: '#/components/schemas/DatabaseNumber' },
          remaining_amount: { $ref: '#/components/schemas/DatabaseNumber' },
          due_installments: { type: 'integer' },
          due_amount: { $ref: '#/components/schemas/DatabaseNumber' },
          overdue_amount: { $ref: '#/components/schemas/DatabaseNumber' },
          status: { type: 'string', enum: ['حالي', 'منتظم', 'متأخر', 'منتهي', 'محامي'] },
          guarantors: { type: 'array', items: { $ref: '#/components/schemas/SearchGuarantor' } },
        },
      },
      SaleSearchResponse: {
        type: 'object', required: ['success', 'data', 'pagination'],
        properties: {
          success: { type: 'boolean', example: true },
          data: { type: 'array', items: { $ref: '#/components/schemas/SaleSearchResult' } },
          pagination: { $ref: '#/components/schemas/Pagination' },
        },
      },
      CustomerSearchResponse: {
        type: 'object', required: ['success', 'data', 'pagination'],
        properties: {
          success: { type: 'boolean', example: true },
          pagination: { $ref: '#/components/schemas/Pagination' },
          data: {
            type: 'array', items: {
              type: 'object', required: ['id', 'name', 'sales'],
              properties: {
                id: { $ref: '#/components/schemas/DatabaseNumber' },
                customer_code: { type: 'string' },
                name: { type: 'string' },
                normalized_name: { type: 'string' },
                risk_level: { type: 'string', nullable: true },
                general_note: { type: 'string', nullable: true },
                phones: { type: 'array', items: { type: 'object' } },
                current_address: { type: 'object', nullable: true },
                created_at: { type: 'string', format: 'date-time' },
                updated_at: { type: 'string', format: 'date-time' },
                sales: {
                  type: 'array',
                  description: 'فواتير العميل المتاحة، وداخل كل فاتورة ضامنها باسمه وأرقام هواتفه فقط.',
                  items: {
                    allOf: [{ $ref: '#/components/schemas/SaleSearchResult' }],
                    properties: {
                      cash_price: { $ref: '#/components/schemas/DatabaseNumber' },
                      down_payment: { $ref: '#/components/schemas/DatabaseNumber' },
                      discount_amount: { $ref: '#/components/schemas/DatabaseNumber' },
                      total_amount: { $ref: '#/components/schemas/DatabaseNumber' },
                      delivery_date: { type: 'string', format: 'date', nullable: true },
                      collection_type: { type: 'string' },
                      created_at: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      SaleDetailsResponse: {
        type: 'object', required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            description: 'كل أعمدة الفاتورة مع الفرع والعميل والعنوان والضامنين والدفعات والملاحظات والأرصدة. guarantor هو أول عنصر في guarantors أو null.',
            required: ['id', 'invoice_number', 'guarantors', 'guarantor', 'payments', 'notes'],
            properties: {
              id: { $ref: '#/components/schemas/DatabaseNumber' },
              invoice_number: { type: 'string' },
              branch_id: { $ref: '#/components/schemas/DatabaseNumber' },
              customer_id: { $ref: '#/components/schemas/DatabaseNumber' },
              address_id: { type: 'integer', nullable: true },
              item_details: { type: 'string', nullable: true },
              cash_price: { $ref: '#/components/schemas/DatabaseNumber' },
              down_payment: { $ref: '#/components/schemas/DatabaseNumber' },
              monthly_installment: { $ref: '#/components/schemas/DatabaseNumber' },
              installments_count: { type: 'integer' },
              discount_amount: { $ref: '#/components/schemas/DatabaseNumber' },
              total_amount: { $ref: '#/components/schemas/DatabaseNumber' },
              delivery_date: { type: 'string', format: 'date', nullable: true },
              first_installment_date: { type: 'string', format: 'date' },
              due_day: { type: 'integer' },
              collection_type: { type: 'string' },
              status: { type: 'string', enum: ['حالي', 'منتظم', 'متأخر', 'منتهي', 'محامي'] },
              created_at: { type: 'string', format: 'date-time' },
              updated_at: { type: 'string', format: 'date-time' },
              branch: { type: 'object', nullable: true },
              customer: { type: 'object', nullable: true },
              address: { type: 'object', nullable: true },
              guarantors: { type: 'array', items: { type: 'object' } },
              guarantor: { type: 'object', nullable: true },
              payments: { type: 'array', items: { type: 'object' } },
              notes: { type: 'array', items: { type: 'object' } },
              total_paid: { $ref: '#/components/schemas/DatabaseNumber' },
              required_installments_total: { $ref: '#/components/schemas/DatabaseNumber' },
              remaining_amount: { $ref: '#/components/schemas/DatabaseNumber' },
              due_installments: { type: 'integer' },
              due_amount: { $ref: '#/components/schemas/DatabaseNumber' },
              overdue_amount: { $ref: '#/components/schemas/DatabaseNumber' },
            },
          },
        },
      },
    },
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'أدخل توكين الـ JWT بالشكل: Bearer <token>',
      },
      deviceIdAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-device-id',
        description: 'بصمة أو معرف الجهاز الفريد المستخدم في تسجيل الدخول',
      },
    },
  },
};

module.exports = {
  swaggerUi,
  swaggerDocument,
};

