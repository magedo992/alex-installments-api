const swaggerUi = require('swagger-ui-express');
const { limits } = require('../auth/domain/input');

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
                    enum: ['admin', 'employee', 'accountant'],
                    default: 'employee',
                    description: 'دور المستخدم في النظام',
                    example: 'employee',
                  },
                  branch_id: {
                    type: 'integer',
                    nullable: true,
                    description: 'معرف الفرع (إلزامي إذا كان الدور employee، واختياري/null لـ accountant أو admin)',
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
            required: true,
            description: 'بصمة الجهاز المقترنة بجلسة تسجيل الدخول',
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
        summary: 'البحث عن العملاء واسترجاع بياناتهم والضامنين وجميع عملياتهم',
        description: 'بحث سريع ومرن يدعم الاسم العربي المطبع، كود العميل، أو رقم الهاتف من جدول phone_numbers. يرجع بيانات العميل وهواتفه وعنوانه مع جميع الضامنين (guarantors) وجميع فواتيره/عملياته (sales) مقيدة بفرع الموظف إن وُجد. يدعم الـ Pagination.',
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
            description: 'كلمة البحث (الاسم، كود العميل، أو رقم الهاتف)',
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
        description: 'عند البحث بـ invoice_number تُرجع الفاتورة المطلوبة فقط بكل تفاصيلها (العميل، الهواتف، العنوان، الضامنين، سجل الدفعات، الملاحظات، والأرصدة). أما عند البحث العام بـ q (اسم العميل أو كوده أو رقم الهاتف) فتُرجع جميع الفواتير الخاصة بالعميل مع أرصدتها.',
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
            description: 'رقم الفاتورة اليدوي للبحث المطابق (مثل A116)',
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
          200: { description: 'قائمة الفواتير المطابقة مع الأرصدة' },
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
        description: 'يُرجع كامل تفاصيل الفاتورة المختارة بواسطة sales.id (بيانات الفاتورة، الأرصدة، بيانات العميل وهواتفه، العنوان، الضامنين وهواتفهم، سجل الدفعات، وملاحظات المتابعة) مع تطبيق تقييد الفرع.',
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
          200: { description: 'تفاصيل الفاتورة الكاملة' },
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
        description: 'يُرجع كامل تفاصيل الفاتورة (بيانات الفاتورة، الأرصدة، العميل، العنوان، الضامنين، الدفعات، والملاحظات) عند البحث المباشر برقم الفاتورة اليدوي مثل A116.',
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
          200: { description: 'تفاصيل الفاتورة الكاملة' },
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
        description: 'يقوم بتسجيل دفعة جديدة في جدول payments، واحتساب شهر القسط payment_month تلقائياً (بداية الشهر firstOfMonth)، وقفل سجل الفاتورة لمنع التضارب، وتحديث حالة الفاتورة تلقائياً إلى completed فور اكتمال سداد إجمالي المستحق.',
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
            description: 'بصمة الجهاز المقترنة بجلسة تسجيل الدخول',
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
          },
          400: {
            description: 'قيمة الدفعة أو معرف الفاتورة غير صالح',
          },
          401: {
            description: 'غير مصرح بالدخول',
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
    '/api/sales/follow-up': {
      get: {
        tags: ['Sales'],
        summary: 'قائمة المتابعة اليومية للمتأخرين في السداد (حتى يوم محدد أو تاريخ اليوم)',
        description: 'يرجع جميع العملاء المتأخرين في السداد (status = active و overdue_amount > 0) الذين يكون يوم استحقاقهم (due_day) أقل من أو يساوي اليوم المحدد (مثلاً يوم 25 يجلب كل المتأخرين من يوم 1 حتى 25). إذا لم يُرسل day أو date يُستخدم يوم اليوم تلقائياً بتوقيت القاهرة. يرجع كامل بيانات العميل، الهواتف، العنوان، الضامنين وهواتفهم، تفاصيل الفاتورة والأرصدة، وآخر ملاحظة وسجل الملاحظات.',
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
            required: true,
            description: 'بصمة الجهاز المقترنة بجلسة تسجيل الدخول',
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
            required: true,
            description: 'بصمة الجهاز المقترنة بجلسة تسجيل الدخول',
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
                    enum: ['call', 'visit', 'inquiry', 'legal', 'general'],
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

