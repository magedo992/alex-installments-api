-- 007_sale_status_and_payment_method.sql
-- 1. تحديث القيم الافتراضية والحالية لحالة البيعة إلى النظام العربي الجديد (حالي، منتظم، متأخر، منتهي، محامي)
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_status_check;
ALTER TABLE public.sales ALTER COLUMN status SET DEFAULT 'حالي';

UPDATE public.sales SET status = 'منتهي' WHERE status = 'completed';
UPDATE public.sales SET status = 'منتظم' WHERE status = 'active';
UPDATE public.sales SET status = 'محامي' WHERE status = 'legal';

ALTER TABLE public.sales
  ADD CONSTRAINT sales_status_check
  CHECK (status IN ('حالي', 'منتظم', 'متأخر', 'منتهي', 'محامي'));

-- 2. إضافة طريقة الدفع (كاش / فودافون كاش) لجدول المدفوعات
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'كاش';

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_method_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_payment_method_check
  CHECK (payment_method IN ('كاش', 'فودافون كاش'));
