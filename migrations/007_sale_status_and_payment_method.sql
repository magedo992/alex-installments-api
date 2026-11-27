-- 007_sale_status_and_payment_method.sql
-- 1. تحديث القيم الافتراضية والحالية لحالة البيعة إلى النظام العربي الجديد (حالي، منتظم، متأخر، منتهي، محامي)
ALTER TABLE public.sales ALTER COLUMN status SET DEFAULT 'حالي';

UPDATE public.sales SET status = 'منتهي' WHERE status = 'completed';
UPDATE public.sales SET status = 'منتظم' WHERE status = 'active';

-- 2. إضافة طريقة الدفع (كاش / فودافون كاش) لجدول المدفوعات
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'كاش';
