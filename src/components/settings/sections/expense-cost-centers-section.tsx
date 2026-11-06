import { useCallback, useEffect, useState } from "react";
import { Check, GitBranch, LoaderCircle, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { ActionButton } from "@/components/ui/action-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

interface CostCenter {
  id: string;
  code: string | null;
  name: string;
  name_ar: string | null;
  is_active: boolean;
}

interface CostCenterForm {
  id: string | null;
  code: string;
  name: string;
  name_ar: string;
}

const EMPTY_FORM: CostCenterForm = { id: null, code: "", name: "", name_ar: "" };

export function ExpenseCostCentersSection({ canEdit = false, lang = "ar" }) {
  const isAr = lang === "ar";
  const [centers, setCenters] = useState<CostCenter[]>([]);
  const [form, setForm] = useState<CostCenterForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadCenters = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("expense_cost_centers")
        .select("id,code,name,name_ar,is_active")
        .order("name");
      if (error) throw error;
      setCenters((data ?? []) as CostCenter[]);
    } catch (error) {
      console.error("Could not load cost centers", error);
      toast.error(isAr ? "تعذر تحميل مراكز التكلفة" : "Could not load cost centers");
    } finally {
      setLoading(false);
    }
  }, [isAr]);

  useEffect(() => {
    void loadCenters();
  }, [loadCenters]);

  const saveCenter = async (values: CostCenterForm, active = true) => {
    if (!canEdit || saving) return;
    if (!values.name.trim()) {
      toast.error(isAr ? "أدخل اسم مركز التكلفة" : "Enter a cost center name");
      return;
    }
    setSaving(true);
    try {
      const { error } = await (supabase as any).rpc("save_expense_dimension", {
        p_kind: "cost_center",
        p_id: values.id,
        p_code: values.code.trim(),
        p_name: values.name.trim(),
        p_name_ar: values.name_ar.trim(),
        p_is_active: active,
      });
      if (error) throw error;
      toast.success(isAr ? "تم حفظ مركز التكلفة" : "Cost center saved");
      setForm(EMPTY_FORM);
      await loadCenters();
    } catch (error) {
      console.error("Could not save cost center", error);
      toast.error(
        isAr
          ? "تعذر حفظ مركز التكلفة. تحقق من صلاحيتك."
          : "Could not save the cost center. Check your access.",
      );
    } finally {
      setSaving(false);
    }
  };

  const setActive = async (center: CostCenter) => {
    if (!canEdit || saving) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any).rpc("save_expense_dimension", {
        p_kind: "cost_center",
        p_id: center.id,
        p_code: center.code,
        p_name: center.name,
        p_name_ar: center.name_ar,
        p_is_active: !center.is_active,
      });
      if (error) throw error;
      await loadCenters();
    } catch (error) {
      console.error("Could not change cost center status", error);
      toast.error(isAr ? "تعذر تغيير حالة مركز التكلفة" : "Could not change cost center status");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitBranch className="size-4 text-primary" />
          {isAr ? "إدارة مراكز التكلفة" : "Cost Center Management"}
        </CardTitle>
        <CardDescription>
          {isAr
            ? "تُستخدم مراكز التكلفة لتحليل المصروفات وربط التكاليف بأوامر الإنتاج."
            : "Cost centers help analyze expenses and assign eligible costs to production orders."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {canEdit ? (
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">
                {form.id
                  ? isAr
                    ? "تعديل مركز تكلفة"
                    : "Edit cost center"
                  : isAr
                    ? "إضافة مركز تكلفة"
                    : "Add a cost center"}
              </p>
              {form.id ? (
                <ActionButton
                  tone="ghost"
                  size="sm"
                  icon={<X />}
                  onClick={() => setForm(EMPTY_FORM)}
                >
                  {isAr ? "إلغاء التعديل" : "Cancel edit"}
                </ActionButton>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="cost-center-name-ar">
                  {isAr ? "الاسم بالعربية" : "Arabic name"}
                </Label>
                <Input
                  id="cost-center-name-ar"
                  value={form.name_ar}
                  onChange={(event) => setForm({ ...form, name_ar: event.target.value })}
                  placeholder={isAr ? "مثال: الإنتاج" : "Example: Production"}
                  dir="auto"
                  disabled={saving}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cost-center-name">{isAr ? "الاسم" : "Name"} *</Label>
                <Input
                  id="cost-center-name"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder={isAr ? "مثال: Production" : "Example: Production"}
                  dir="auto"
                  disabled={saving}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cost-center-code">
                  {isAr ? "الرمز (اختياري)" : "Code (optional)"}
                </Label>
                <Input
                  id="cost-center-code"
                  value={form.code}
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                  placeholder="PROD"
                  dir="ltr"
                  disabled={saving}
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <ActionButton
                icon={form.id ? <Check /> : <Plus />}
                loading={saving}
                onClick={() => void saveCenter(form)}
              >
                {form.id
                  ? isAr
                    ? "حفظ التعديل"
                    : "Save changes"
                  : isAr
                    ? "إضافة المركز"
                    : "Add center"}
              </ActionButton>
            </div>
          </div>
        ) : (
          <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
            {isAr
              ? "إضافة وتعديل مراكز التكلفة متاح للمالك والمدير."
              : "Only owners and managers can manage cost centers."}
          </p>
        )}

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">
            {isAr ? "المراكز المسجلة" : "Registered centers"}
          </h3>
          {loading ? (
            <div className="flex items-center gap-2 py-5 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              {isAr ? "جارٍ التحميل…" : "Loading…"}
            </div>
          ) : centers.length === 0 ? (
            <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
              {isAr
                ? "لا توجد مراكز تكلفة بعد. أضف المركز الأول من النموذج أعلاه."
                : "No cost centers yet. Add the first one above."}
            </p>
          ) : (
            <ul className="divide-y rounded-xl border">
              {centers.map((center) => (
                <li
                  key={center.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {center.name_ar || center.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[
                        center.code,
                        center.name_ar && center.name_ar !== center.name ? center.name : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || (isAr ? "بدون رمز" : "No code")}
                    </p>
                  </div>
                  {canEdit ? (
                    <div className="flex shrink-0 gap-2">
                      <ActionButton
                        tone="outline"
                        size="sm"
                        icon={<Pencil />}
                        disabled={saving || !center.is_active}
                        onClick={() =>
                          setForm({
                            id: center.id,
                            code: center.code ?? "",
                            name: center.name,
                            name_ar: center.name_ar ?? "",
                          })
                        }
                      >
                        {isAr ? "تعديل" : "Edit"}
                      </ActionButton>
                      <ActionButton
                        tone="ghost"
                        size="sm"
                        disabled={saving}
                        onClick={() => void setActive(center)}
                      >
                        {center.is_active
                          ? isAr
                            ? "إيقاف"
                            : "Deactivate"
                          : isAr
                            ? "تفعيل"
                            : "Activate"}
                      </ActionButton>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
