# حالة مشروع Alex وخطة الاستكمال (Project Handoff)

**آخر تحديث:** 28 نوفمبر 2026 — توقيت القاهرة (`Africa/Cairo`).  
**الغرض من الملف:** مرجع كامل لحالة الكود وقاعدة البيانات والاختبارات والفروقات مع شيتات الإكسيل، بحيث يمكن استكمال العمل مباشرة من أي جلسة جديدة.

---

## 1. ملخص ما تم إنجازه حتى الآن

المشروع عبارة عن Backend API (Node.js + Express 5 + PostgreSQL/Neon) لإدارة البيع بالتقسيط عبر الفروع، ويشمل:
- **المصادقة والصلاحيات وبصمة الجهاز:** تسجيل دخول، JWT، أدوار (`admin`, `employee`, `accountant`, `follow_up`)، وإلزام `x-device-id` لغير الأدمن.
- **العملاء والضامنين:** إنشاء عميل بهواتف وعنوان وتوليد كود تلقائي، وبحث بالاسم (مع التطبيع العربي) والكود والهاتف.
- **فواتير التقسيط:** إنشاء فاتورة برقم يدوي (`invoice_number`) + ضامن وهواتفه داخل Transaction، وعرض تفاصيل الفاتورة كاملة عبر `GET /api/sales/:id` أو `GET /api/sales/by-invoice/:invoice_number`.
- **تسجيل الأقساط بطرق الدفع (`007`, `008`):**
  - إضافة `payment_method` في جدول `payments` بالقيم المسموحة فقط: `'كاش'` أو `'فودافون كاش'` (الافتراضي `'كاش'`).
  - إضافة `collection_branch_id` في `payments` لتسجيل فرع التحصيل الفعلي (يُحدد تلقائياً من فرع الموظف، أو يمرره الأدمن/المحاسب).
  - إقفال الفاتورة تلقائياً بتحديث `sales.status` إلى `'منتهي'` عند سداد كامل المطلوب (`required_installments_total`).
- **يومية التحصيل للفرع آخر اليوم (`GET /api/sales/daily-summary`):**
  - تحسب إجمالي التحصيل اليومي (`total_amount`) وعدد الدفعات، مقسماً إلى `cash` (`total`, `count`) و`vodafone_cash` (`total`, `count`)، مع تفصيل كل فرع تحصيل في `by_branch` وقائمة دفعات اليوم، بتوقيت القاهرة (`Africa/Cairo`).
- **المتابعة والمتأخرات وتحديث الحالة:**
  - `GET /api/sales/overdue` و`GET /api/sales/follow-up` لمتابعة المتأخرين حسب `due_day` والفرع.
  - `PATCH /api/sales/:id/status` (للأدمن و`follow_up`) لتحديث الحالة بين: `'حالي'`, `'منتظم'`, `'متأخر'`, `'محامي'` (وحالة `'منتهي'` محمية ولا تُفتح يدوياً).
  - `POST /api/sales/:id/notes` لتسجيل ملاحظات المكالمات/الزيارات وموعد المتابعة.
- **التوثيق:** موثق في [src/config/swagger.js](src/config/swagger.js) ومتاح على `/api-docs`.

---

## 2. حالة قاعدة البيانات الحالية (Neon PostgreSQL)

تم تطبيق الترحيلات حتى `008` بنجاح على قاعدة البيانات الحية:
1. **`007_sale_status_and_payment_method.sql`** (تم تحديثه وتطبيقه):
   - تم تحديث قيد `sales_status_check` ليسمح بالقيم العربية: `('حالي', 'منتظم', 'متأخر', 'منتهي', 'محامي')` والافتراضي `'حالي'`.
   - تم تحويل الحالات القديمة (`7558` فاتورة `'منتظم'`، `1` فاتورة `'منتهي'`).
   - تم إضافة `payments.payment_method` (`text NOT NULL DEFAULT 'كاش'`) مع قيد `payments_payment_method_check`.
2. **`008_collection_branch_and_balance_fix.sql`** (تم تطبيقه):
   - تم إضافة `payments.collection_branch_id` (`integer REFERENCES public.branches(id)`) وتعبئة القيم السابقة من `sales.branch_id`.
   - تم تحديث `public.sale_balances` View لتقييد `due_amount` و`overdue_amount` بحد `required_installments_total` بعد الخصم.

**حالة فحص قاعدة البيانات (`npm run test:db:workflow`):**
- **9/9 فحوصات ناجحة**، و**0 مخالفات** في حدود الأرصدة (`db.balance-invariants`).
- **تنبيه مهم:** قبل مسح الداتا وإعادة رفع داتا جديدة، الترحيلات `001`–`008` تعتمد على وجود الجداول الأساسية (`branches`, `customers`, `phone_numbers`, `customer_addresses`, `sales`, `guarantors`, `payments`, `sale_notes`) مسبقاً، كما أن الترحيل `004` يحتوي على `USING NULL` على `sale_notes.created_by_user_id` فلا يجب تشغيل `scripts/migrate.js` كاملاً على بيانات حية بدون فصل الترحيلات المطبقة.

---

## 3. كيف تعمل حسابات الأقساط والمتأخرات حالياً؟

في `public.sale_balances`:
```text
required_installments_total = GREATEST(0, (monthly_installment * installments_count) - discount_amount)
due_installments = 0 إذا CURRENT_DATE < first_installment_date
                   وإلا LEAST(installments_count, عدد الأشهر من first_installment_date حتى CURRENT_DATE + 1)
due_amount = LEAST(required_installments_total, due_installments * monthly_installment)
overdue_amount = GREATEST(0, due_amount - total_paid)
remaining_amount = GREATEST(0, required_installments_total - total_paid)
```
- **التراكم الشهري:** إذا تأخر العميل في شهر، يظل المبلغ غير المدفوع محسوباً ضمن `overdue_amount` ويُضاف إليه قسط الشهر التالي تلقائياً عند حلول موعده.
- **ملاحظة:** `due_day` يُستخدم كفلتر في `/api/sales/follow-up` و`/api/sales/overdue`، بينما حساب `due_installments` يعتمد على `AGE(CURRENT_DATE, first_installment_date)`.

---

## 4. الفروقات بين شيتات الإكسيل والنظام الحالي

تم فحص الشيتين الموجودين في المستودع (`الاصلاح.xlsm` و`mazen new 2026(0AutoRecovered).xlsm`):
1. **تقسيم الكاش وفودافون كاش (`ادخال تحصيل`):** الشيت يضع عمود `تحصيل` (كاش) وعمود `فودافون` في نفس الصف، بينما النظام يسجل كل دفعة كصف مستقل في `payments` مع `payment_method` (`كاش` أو `فودافون كاش`) و`collection_branch_id`.
2. **تواريخ الدفعات القديمة:** الدفعات المستوردة من شيت `التحصيل` محفوظة بتاريخ `01` من كل شهر (`2026-11-01` إلخ) ما عدا `2026-11-26` (فرع 2 فقط). عند رفع بيانات أحدث من شيت `ادخال تحصيل` يُفضّل استيراد تاريخ الدفع الفعلي لكل عملية حتى تعمل اليومية لكل يوم بدقة.
3. **حالات الفاتورة:** الشيت يحتوي عمود `حاله العميل`؛ عند الاستيراد يجب مطابقته مع الحالات الخمس المعتمدة (`حالي`, `منتظم`, `متأخر`, `منتهي`, `محامي`).
4. **شيتات غير ممثلة في الـAPI حالياً:** شيت `استلام خزنه` (تسليم/استلام الخزنة) وبنود `م.ا` (المصاريف الإدارية) والمقدمات في شيت `اضافى` غير موجودة كمسارات API مستقلة حالياً (`down_payment` محفوظ على الفاتورة ولا يدخل جدول `payments`).
5. **سكربت الاستيراد:** لا يوجد حالياً سكربت استيراد Excel جاهز داخل `scripts/` (يلزم بناؤه عند رفع الشيتات الأحدث).

---

## 5. حالة الاختبارات والعوائق المتبقية

| البوابة / الفحص | النتيجة | التفاصيل |
| --- | --- | --- |
| `npm test` | **PASS** | كل الاختبارات المحلية ناجحة (باستخدام mock pool/store) |
| `npm run test:db:workflow` | **PASS (9/9)** | نجاح كامل على قاعدة البيانات الحية + 0 مخالفات أرصدة |
| `npm run test:http` | **FAIL (9/10)** | **العائق المتبقي:** CORS في [src/index.js](src/index.js#L30) لا يشمل `PATCH` |

### مسائل معروفة مطلوبة لاحقاً:
1. **إضافة `PATCH` في CORS:** في [src/index.js (line 30)](src/index.js#L30) تعديل `methods` لتصبح `['GET', 'POST', 'PUT', 'PATCH', 'DELETE']` حتى يعمل `PATCH /api/sales/:id/status` من المتصفح.
2. **توحيد توقيت القاهرة في `recordPayment`:** في [src/service/sale.service.js (line 346)](src/service/sale.service.js#L346) التاريخ الافتراضي للدفع يستخدم `UTC` بدل `Africa/Cairo` (عكس `getDailySummary` الذي يستخدم `Africa/Cairo`).
3. **حالات حدية أخرى:** التحقق التقويمي للتواريخ (مثل رفض `2026-02-31`)، ومنع الدفع الزائد عن `remaining_balance` أو الدفع على فاتورة منتهية، وبناء سكربت استيراد الشيتات الأحدث.
4. **تنبيه بخصوص `invoiceDetailsExample` في Swagger:** المثال في [src/config/swagger.js (lines 58-61)](src/config/swagger.js#L58-L61) يمكن إضافة `collection_branch_id` و`collection_branch_name` له ليطابق مخرجات `getSaleDetails` بالكامل.
