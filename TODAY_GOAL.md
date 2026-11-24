# 🎯 خطة الهدف اليومي — Alex Project (Daily Goal)

> **تاريخ الاعتماد:** 24 نوفمبر 2026  
> **حالة قاعدة البيانات:** متصلة أونلاين على Neon Postgres (`public` schema جاهز بالكامل).  
> **طريقة التنفيذ:** كتابة برمجية مباشرة عبر Node.js / Express من قبل Orchestrator دون أي تفويض لنماذج محلية، والالتزام الصارم بـ Zero-Defect & OWASP.

---

## 📌 المبدأ التوجيهي اليوم
التركيز التام على إنجاز المسارات الأساسية الثلاثة (Endpoints) وتوثيقها فوراً في Swagger دون الخروج عن نطاق هذا الملف حتى اكتمالها بنسبة 100%.

---

## 🚀 محاور الهدف اليومي (Milestones)

### 1️⃣ إضافة عميل والبحث السريع عنه
* **المسارات:** `POST /api/customers` و `GET /api/customers`
* **المطلوب بالتفصيل:**
  - [x] **`POST /api/customers` (إضافة عميل في Transaction موحدة):**
    1. تحديث تسلسلي آمن لكود الفرع:  
       `UPDATE branches SET last_number = last_number + 1 WHERE id = $1 RETURNING code_prefix, last_number`
    2. توليد `customer_code` فريد بدمج البادئة مع الرقم التسلسلي.
    3. تطبيق خوارزمية `normalizeArabic(name)` لتوحيد الحروف العربية للبحث الدقيق.
    4. حفظ العميل في جدول `customers`.
    5. حفظ أرقام الهواتف في جدول `phone_numbers` (مع تحديد الرقم الأساسي `is_primary`).
    6. حفظ العنوان في جدول `customer_addresses` مع `is_current = TRUE`.
  - [x] **`GET /api/customers` (بحث فوري ومتعدد المعايير):**
    - البحث عبر `q` ويدعم:
      - الاسم العربي المطبع (`normalized_name ILIKE %q%`)
      - كود العميل (`customer_code ILIKE %q%`)
      - رقم الهاتف من جدول `phone_numbers` عبر `EXISTS` سريع
    - دعم الـ Pagination (`page`, `limit`) وعرض العنوان الحالي وأرقام الهاتف.

---

### 2️⃣ إضافة فاتورة وتسجيل الأقساط / الدفعات
* **المسارات:** `POST /api/sales` و `POST /api/sales/:id/payments`
* **المطلوب بالتفصيل:**
  - [x] **`POST /api/sales` (إنشاء فاتورة بيع بالتقسيط في Transaction):**
    1. التحقق من وجود العميل والفرع وصحة التواريخ والقيم المالية.
    2. إدخال سجل الفاتورة في جدول `sales` مع حساب `total_amount = down_payment + (monthly_installment * installments_count)`.
    3. إدخال بيانات الضامن في جدول `guarantors` إن وُجد.
    4. إدخال أرقام هواتف الضامن في جدول `phone_numbers` مع ربط `guarantor_id`.
  - [x] **`POST /api/sales/:id/payments` (تسجيل دفعة / قسط وتحديث الحالة):**
    1. إدخال الدفعة في جدول `payments` وحساب شهر القسط `payment_month` (تلقائياً بداية الشهر `firstOfMonth`).
    2. احتساب إجمالي مدفوعات الأقساط مقارنة بإجمالي الأقساط المطلوبة `(monthly_installment * installments_count) - discount_amount`.
    3. في حال سداد كامل الأقساط المستحقة للفاتورة: تحديث حالة الفاتورة تلقائياً إلى `status = 'completed'`.

---

### 3️⃣ إدارة المتأخرات والمتابعات الهاتفية
* **المسارات:** `GET /api/sales/overdue` و `POST /api/sales/:id/notes`
* **المطلوب بالتفصيل:**
  - [x] **إنشاء SQL View باسم `sale_balances` على Neon:**
    - حساب الأقساط المستحقة حتى اليوم بناءً على `first_installment_date` واليوم الحالي و `due_day`.
    - حساب إجمالي المدفوعات لكل فاتورة `active`.
    - استخراج قيمة المتأخرات بدقة: `المتأخر = (الأقساط المستحقة × قيمة القسط) - إجمالي المدفوع`.
  - [x] **`GET /api/sales/overdue` (قائمة المتأخرات لمسؤولي التحصيل):**
    - فلترة بالفرع (`branch_id`) ويوم الاستحقاق (`due_day`).
    - دعم الـ Pagination مع جلب اسم العميل ورقم هاتفه الأساسي وآخر ملاحظة متابعة مسجلة.
  - [x] **`POST /api/sales/:id/notes` (تسجيل نتيجة المتابعة):**
    - تسجيل محتوى المكالمة (`content`) ونوع الملاحظة (`note_type`).
    - تسجيل تاريخ المتابعة القادم (`follow_up_date`) لجدولة الاتصال التالي.

---

### 4️⃣ توثيق مسارات اليوم في Swagger
* **الملف المستهدف:** `src/config/swagger.js`
* **المطلوب:**
  - [x] توثيق جميع الـ 6 مسارات الجديدة بتفاصيل الـ Headers المطلوبة (`Authorization: Bearer <token>` و `x-device-id`).
  - [x] توثيق مخططات المدخلات (Request Body schemas) واستجابات النجاح والخطأ (200, 201, 400, 401, 404, 500).

---

## 📋 مصفوفة التحقق والإنجاز (Sign-off Checklist)

| المهمة | المسار | الحالة | اختبار Neon DB | Swagger |
|---|---|:---:|:---:|:---:|
| إضافة عميل | `POST /api/customers` | ✅ مكتمل ومختبر | ✅ | ✅ |
| البحث عن عميل | `GET /api/customers` | ✅ مكتمل ومختبر | ✅ | ✅ |
| إضافة فاتورة وضامن | `POST /api/sales` | ✅ مكتمل ومختبر | ✅ | ✅ |
| تسجيل دفعة | `POST /api/sales/:id/payments` | ✅ مكتمل ومختبر | ✅ | ✅ |
| استعلام المتأخرات | `GET /api/sales/overdue` | ✅ مكتمل ومختبر | ✅ | ✅ |
| تسجيل متابعة | `POST /api/sales/:id/notes` | ✅ مكتمل ومختبر | ✅ | ✅ |
