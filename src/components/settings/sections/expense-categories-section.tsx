import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, Tags } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { expenseKeys } from "@/lib/expenses/query-keys";

interface ExpenseCategory {
  id: string;
  name: string;
  name_ar: string | null;
  notes: string | null;
  is_active: boolean;
  production_cost_eligible: boolean;
  account_id: string | null;
}

interface ExpenseAccount {
  id: string;
  code: string;
  name_ar: string | null;
}

interface FormState {
  id: string | null;
  name: string;
  name_ar: string;
  notes: string;
  account_id: string;
}

const emptyForm = (): FormState => ({
  id: null,
  name: "",
  name_ar: "",
  notes: "",
  account_id: "",
});

export function ExpenseCategoriesSection({ canEdit = false, lang = "ar" }) {
  const isAr = lang === "ar";
  const client = useQueryClient();
  const [form, setForm] = useState<FormState>(emptyForm);
  const db = supabase as any;
  const categories = useQuery({
    queryKey: ["expense-category-management"],
    enabled: canEdit,
    queryFn: async () => {
      const { data, error } = await db.rpc("expense_category_management");
      if (error) throw error;
      return (data ?? []) as ExpenseCategory[];
    },
  });
  const accounts = useQuery({
    queryKey: ["expense-category-accounts"],
    enabled: canEdit,
    queryFn: async () => {
      const { data, error } = await db.rpc("expense_category_postable_accounts");
      if (error) throw error;
      return (data ?? []) as ExpenseAccount[];
    },
  });

  useEffect(() => {
    if (!form.id) return;
    const current = categories.data?.find((category) => category.id === form.id);
    if (current) {
      setForm({
        id: current.id,
        name: current.name,
        name_ar: current.name_ar ?? "",
        notes: current.notes ?? "",
        account_id: current.account_id ?? "",
      });
    }
  }, [categories.data, form.id]);

  const save = useMutation({
    mutationFn: async (input: FormState) => {
      const { data, error } = await db.rpc("save_expense_category", {
        p_id: input.id,
        p_name: input.name.trim(),
        p_name_ar: input.name_ar.trim(),
        p_sort_order: null,
        p_notes: input.notes.trim(),
        p_is_active: true,
      });
      if (error) throw error;
      const saved = Array.isArray(data) ? data[0] : data;
      const categoryId = input.id ?? saved?.id;
      if (!categoryId) throw new Error("لم يتم إرجاع معرّف تصنيف المصروف");

      const { error: accountError } = await db.rpc("set_expense_category_account", {
        p_category_id: categoryId,
        p_account_id: input.account_id || null,
      });
      if (accountError) throw accountError;
      return categoryId as string;
    },
    onSuccess: async () => {
      toast.success(isAr ? "تم حفظ تصنيف المصروف" : "Expense category saved");
      setForm(emptyForm());
      await Promise.all([
        client.invalidateQueries({ queryKey: ["expense-category-management"] }),
        client.invalidateQueries({ queryKey: ["company-production"] }),
        client.invalidateQueries({ queryKey: expenseKeys.lookups() }),
      ]);
    },
    onError: (error: any) => {
      toast.error(error?.message || (isAr ? "تعذر حفظ تصنيف المصروف" : "Could not save category"));
    },
  });

  const eligibility = useMutation({
    mutationFn: async (input: { id: string; eligible: boolean }) => {
      const { error } = await db.rpc("set_production_expense_category_eligibility", {
        p_category_id: input.id,
        p_eligible: input.eligible,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["expense-category-management"] }),
        client.invalidateQueries({ queryKey: ["company-production"] }),
      ]);
    },
    onError: (error: any) => {
      toast.error(error?.message || (isAr ? "تعذر تحديث أهلية التصنيف" : "Could not update eligibility"));
    },
  });

  const setActive = useMutation({
    mutationFn: async (category: ExpenseCategory) => {
      const { error } = await db.rpc("save_expense_category", {
        p_id: category.id,
        p_name: category.name,
        p_name_ar: category.name_ar,
        p_sort_order: null,
        p_notes: category.notes,
        p_is_active: !category.is_active,
      });
      if (error) throw error;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["expense-category-management"] }),
    onError: (error: any) => {
      toast.error(error?.message || (isAr ? "تعذر تحديث حالة التصنيف" : "Could not update category"));
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tags className="size-4 text-primary" />
          {isAr ? "تصنيفات المصروفات" : "Expense categories"}
        </CardTitle>
        <CardDescription>
          {isAr
            ? "أنشئ تصنيفات تناسب نشاطك واربط كل تصنيف بحساب مصروف. أهلية الإنتاج لا تعني رسملة كل المبلغ؛ تُحمّل التشغيلة فقط الجزء المباشر الموثق."
            : "Create categories for your business and map each one to an expense account. Production eligibility does not capitalize the full expense; only the documented production share is allocated."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {canEdit ? (
          <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-4">
            <p className="text-sm font-semibold">
              {form.id ? (isAr ? "تعديل تصنيف" : "Edit category") : isAr ? "إضافة تصنيف" : "Add category"}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="expense-category-name-ar">{isAr ? "الاسم بالعربية" : "Arabic name"}</Label>
                <Input
                  id="expense-category-name-ar"
                  value={form.name_ar}
                  onChange={(event) => setForm({ ...form, name_ar: event.target.value })}
                  placeholder={isAr ? "مثال: أجور مباشرة للإنتاج" : "Example: Direct production labour"}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="expense-category-name">{isAr ? "اسم التصنيف *" : "Category name *"}</Label>
                <Input
                  id="expense-category-name"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder={isAr ? "اسم واضح ومميز" : "A clear, distinct name"}
                  dir="auto"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="expense-category-account">{isAr ? "الحساب المحاسبي (مطلوب لأهلية الإنتاج)" : "Posting account (required for production eligibility)"}</Label>
                <select
                  id="expense-category-account"
                  value={form.account_id}
                  onChange={(event) => setForm({ ...form, account_id: event.target.value })}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                  disabled={accounts.isLoading || Boolean(accounts.error)}
                >
                  <option value="">{isAr ? "استخدم الحساب الافتراضي للمصروف" : "Use the default expense account"}</option>
                  {(accounts.data ?? []).map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} · {account.name_ar || account.code}
                    </option>
                  ))}
                </select>
                {accounts.error && (
                  <p className="text-xs text-destructive">{isAr ? "تعذر تحميل حسابات المصروف." : "Could not load expense accounts."}</p>
                )}
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="expense-category-notes">{isAr ? "ملاحظة الاستخدام" : "Usage note"}</Label>
                <Input
                  id="expense-category-notes"
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  placeholder={isAr ? "مثال: جزء الأجور الخاص بخط الإنتاج فقط" : "Example: Labour for the production line only"}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              {form.id && (
                <Button type="button" variant="outline" onClick={() => setForm(emptyForm())}>
                  {isAr ? "إلغاء" : "Cancel"}
                </Button>
              )}
              <Button
                type="button"
                disabled={save.isPending || !form.name.trim()}
                onClick={() => save.mutate(form)}
              >
                {form.id ? <Check className="me-2 size-4" /> : <Plus className="me-2 size-4" />}
                {save.isPending ? (isAr ? "جارٍ الحفظ…" : "Saving…") : isAr ? "حفظ التصنيف" : "Save category"}
              </Button>
            </div>
          </div>
        ) : (
          <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
            {isAr ? "إدارة التصنيفات متاحة للمالك والمدير." : "Category management is available to owners and managers."}
          </p>
        )}

        <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 text-xs leading-6 text-muted-foreground">
          {isAr
            ? "أمثلة: الأجور المباشرة والطاقة والمواد المستهلكة في التشغيل والخدمات الإنتاجية المحددة قد تدخل بقدر استخدامها. الإيجار والاستهلاك والصيانة الصناعية تحتاج توزيعاً منتظماً على الطاقة الطبيعية؛ أما الإدارة والمبيعات والتسويق والتوصيل للعملاء فلا تُحمّل على المخزون. مواد التعبئة المشتراة كأصناف مخزنية تُضاف كمواد مصروفة للتشغيلة، لا كمصروف ثانٍ."
            : "Direct labour, production energy, consumables, and specific production services may be allocated to the extent used. Factory rent, depreciation, and maintenance need systematic allocation based on normal capacity; administration, selling, marketing, and customer delivery stay out of inventory. Packaging held as stock should be issued as a production material, not expensed twice."}
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{isAr ? "التصنيفات المسجلة" : "Registered categories"}</h3>
          {categories.isLoading ? (
            <p className="py-4 text-sm text-muted-foreground">{isAr ? "جارٍ التحميل…" : "Loading…"}</p>
          ) : categories.error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {isAr ? "تعذر تحميل التصنيفات." : "Could not load categories."}
            </p>
          ) : (categories.data ?? []).length === 0 ? (
            <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
              {isAr ? "لا توجد تصنيفات مصروفات." : "No expense categories yet."}
            </p>
          ) : (
            <ul className="divide-y rounded-xl border">
              {(categories.data ?? []).map((category) => (
                <li key={category.id} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{category.name_ar || category.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {accounts.data?.find((account) => account.id === category.account_id)?.code ??
                        (isAr ? "الحساب الافتراضي" : "Default expense account")}
                      {category.notes ? ` · ${category.notes}` : ""}
                      {!category.is_active ? ` · ${isAr ? "مؤرشف" : "Archived"}` : ""}
                    </p>
                  </div>
                  {canEdit && category.is_active && (
                    <>
                      <label className="flex items-center gap-2 text-xs">
                        <Switch
                          checked={category.production_cost_eligible}
                          disabled={eligibility.isPending || !category.account_id}
                          onCheckedChange={(eligible) => eligibility.mutate({ id: category.id, eligible })}
                        />
                        <span>
                          {category.production_cost_eligible
                            ? isAr
                              ? "مؤهل لتخصيص الإنتاج"
                              : "Production eligible"
                            : isAr
                              ? "غير مؤهل لتخصيص الإنتاج"
                              : "Not production eligible"}
                        </span>
                      </label>
                      {!category.account_id && (
                        <span className="text-[10px] text-amber-700">
                          {isAr ? "اربط حساب مصروف أولاً" : "Map an expense account first"}
                        </span>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={isAr ? `تعديل ${category.name_ar || category.name}` : `Edit ${category.name}`}
                        onClick={() => setForm({
                          id: category.id,
                          name: category.name,
                          name_ar: category.name_ar ?? "",
                          notes: category.notes ?? "",
                          account_id: category.account_id ?? "",
                        })}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={setActive.isPending}
                        onClick={() => setActive.mutate(category)}
                      >
                        {isAr ? "أرشفة" : "Archive"}
                      </Button>
                    </>
                  )}
                  {canEdit && !category.is_active && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setActive.mutate(category)}>
                      {isAr ? "إعادة تفعيل" : "Reactivate"}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
