-- 008_collection_branch_and_balance_fix.sql
-- 1. إضافة فرع التحصيل الفعلي لجدول المدفوعات (لحساب إيرادات كل فرع آخر اليوم)
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS collection_branch_id integer REFERENCES public.branches(id);

UPDATE public.payments p
SET collection_branch_id = s.branch_id
FROM public.sales s
WHERE s.id = p.sale_id
  AND p.collection_branch_id IS NULL;

-- 2. تصحيح حساب due_amount و overdue_amount في sale_balances ليتقيد بحد required_installments_total بعد الخصم
CREATE OR REPLACE VIEW public.sale_balances AS
WITH payment_sums AS (
  SELECT
    sale_id,
    COALESCE(SUM(amount), 0) AS total_paid
  FROM public.payments
  GROUP BY sale_id
),
calc AS (
  SELECT
    s.id AS sale_id,
    s.invoice_number,
    s.branch_id,
    s.customer_id,
    s.address_id,
    s.item_details,
    s.cash_price,
    s.down_payment,
    s.monthly_installment,
    s.installments_count,
    s.discount_amount,
    s.total_amount,
    s.delivery_date,
    s.first_installment_date,
    s.due_day,
    s.collection_type,
    s.status,
    s.created_at,
    s.updated_at,
    COALESCE(p.total_paid, 0) AS total_paid,
    GREATEST(0, (s.monthly_installment * s.installments_count) - s.discount_amount) AS required_installments_total,
    CASE
      WHEN CURRENT_DATE < s.first_installment_date THEN 0
      ELSE LEAST(
        s.installments_count,
        (EXTRACT(YEAR FROM AGE(CURRENT_DATE, s.first_installment_date)) * 12
         + EXTRACT(MONTH FROM AGE(CURRENT_DATE, s.first_installment_date))
         + 1)::integer
      )
    END AS due_installments
  FROM public.sales s
  LEFT JOIN payment_sums p ON p.sale_id = s.id
)
SELECT
  c.*,
  GREATEST(0, c.required_installments_total - c.total_paid) AS remaining_amount,
  LEAST(c.required_installments_total, c.due_installments * c.monthly_installment) AS due_amount,
  GREATEST(0, LEAST(c.required_installments_total, c.due_installments * c.monthly_installment) - c.total_paid) AS overdue_amount
FROM calc c;
