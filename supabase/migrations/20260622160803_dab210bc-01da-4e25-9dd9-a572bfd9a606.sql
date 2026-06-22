
-- Expense categories + Expenses for Finance module
CREATE TABLE public.expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  name_ar TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_categories TO authenticated;
GRANT ALL ON public.expense_categories TO service_role;
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read expense cats" ON public.expense_categories FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "staff write expense cats" ON public.expense_categories FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES public.expense_categories(id) ON DELETE SET NULL,
  amount NUMERIC NOT NULL CHECK (amount >= 0),
  payment_method payment_method NOT NULL DEFAULT 'cash',
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;
GRANT ALL ON public.expenses TO service_role;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read expenses" ON public.expenses FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "staff write expenses" ON public.expenses FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE TRIGGER tg_expenses_updated BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

INSERT INTO public.expense_categories(name, name_ar) VALUES
  ('Rent','إيجار'), ('Salaries','رواتب'), ('Utilities','مرافق'),
  ('Transport','نقل'), ('Marketing','تسويق'), ('Other','أخرى');
