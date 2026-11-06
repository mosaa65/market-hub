import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldInput } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { parseAmount } from "@/lib/expenses/query-keys";

type ApprovalRule = { id: string; min_amount: number | string; required_role_rank: 40 | 50 };

export function ExpenseApprovalRulesSection({ canEdit = false, lang = "ar" }) {
  const isAr = lang === "ar";
  const db = supabase as any;
  const client = useQueryClient();
  const [minimumAmount, setMinimumAmount] = useState("");
  const [requiredRoleRank, setRequiredRoleRank] = useState<40 | 50>(40);
  const query = useQuery({
    queryKey: ["expense-approval-rules"],
    enabled: canEdit,
    queryFn: async (): Promise<ApprovalRule[]> => {
      const { data, error } = await db.rpc("expense_approval_rule_management");
      if (error) throw error;
      return (data ?? []) as ApprovalRule[];
    },
  });
  const refresh = () => void client.invalidateQueries({ queryKey: ["expense-approval-rules"] });
  const save = useMutation({
    mutationFn: async () => {
      const parsed = parseAmount(minimumAmount);
      if (!parsed.ok)
        throw new Error(isAr ? "أدخل حدًا ماليًا صحيحًا" : "Enter a valid amount threshold");
      const { error } = await db.rpc("save_expense_approval_rule", {
        p_min_amount: parsed.value,
        p_required_role_rank: requiredRoleRank,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setMinimumAmount("");
      refresh();
      toast.success(isAr ? "تم حفظ قاعدة الاعتماد" : "Approval rule saved");
    },
    onError: (error: any) =>
      toast.error(error?.message || (isAr ? "تعذر حفظ القاعدة" : "Could not save the rule")),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.rpc("delete_expense_approval_rule", { p_rule_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      toast.success(isAr ? "تم حذف القاعدة" : "Rule deleted");
    },
    onError: (error: any) =>
      toast.error(error?.message || (isAr ? "تعذر حذف القاعدة" : "Could not delete the rule")),
  });

  return (
    <Card className="border-border/70 bg-card/80">
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <ShieldCheck className="size-5" />
          </span>
          <div>
            <CardTitle>{isAr ? "قواعد اعتماد المصروفات" : "Expense approval thresholds"}</CardTitle>
            <CardDescription className="mt-1 max-w-3xl leading-relaxed">
              {isAr
                ? "تُحفظ رتبة الاعتماد المطلوبة على المستند عند إرساله. المبالغ الأقل تعتمدها الإدارة، والمبالغ التي تبلغ حدًا معينًا يمكن حصر اعتمادها بالمالك. هذا إعداد اعتماد فقط ولا يرحّل القيد أو يصرف النقد."
                : "The required approval rank is captured when a document is submitted. Higher amounts can require owner approval. Approval alone never posts a journal or moves cash."}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <label className="min-w-0">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">
              {isAr ? "الحد الأدنى للمبلغ" : "Minimum amount"}
            </span>
            <FieldInput
              type="decimal"
              value={minimumAmount}
              onValueChange={setMinimumAmount}
              placeholder="100000"
            />
          </label>
          <label className="min-w-0">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">
              {isAr ? "من يحق له الاعتماد؟" : "Approver"}
            </span>
            <select
              value={requiredRoleRank}
              onChange={(event) => setRequiredRoleRank(Number(event.target.value) as 40 | 50)}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <option value={40}>{isAr ? "مدير أو مالك" : "Manager or owner"}</option>
              <option value={50}>{isAr ? "المالك فقط" : "Owner only"}</option>
            </select>
          </label>
          <Button
            disabled={!canEdit || save.isPending}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            <Check className="me-1.5 size-4" />
            {isAr ? "إضافة الحد" : "Add threshold"}
          </Button>
        </div>

        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">
            {isAr ? "جارٍ تحميل القواعد…" : "Loading rules…"}
          </p>
        ) : null}
        {query.error ? (
          <p role="alert" className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive">
            {isAr ? "تعذر تحميل قواعد الاعتماد." : "Could not load approval rules."}
          </p>
        ) : null}
        {query.data?.length ? (
          <div className="overflow-hidden rounded-xl border border-border/70">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 bg-muted/50 px-3 py-2 text-[11px] font-semibold text-muted-foreground">
              <span>{isAr ? "يبدأ من مبلغ" : "Starts at"}</span>
              <span>{isAr ? "الاعتماد المطلوب" : "Required approver"}</span>
              <span />
            </div>
            {query.data.map((rule) => (
              <div
                key={rule.id}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 border-t border-border/60 px-3 py-2.5 text-sm"
              >
                <span className="font-mono tabular-nums">
                  {Number(rule.min_amount).toLocaleString(isAr ? "ar" : "en-US", {
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span>
                  {rule.required_role_rank >= 50
                    ? isAr
                      ? "المالك فقط"
                      : "Owner only"
                    : isAr
                      ? "مدير أو مالك"
                      : "Manager or owner"}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={!canEdit || Number(rule.min_amount) === 0 || remove.isPending}
                  aria-label={isAr ? "حذف قاعدة الاعتماد" : "Delete approval threshold"}
                  onClick={() => remove.mutate(rule.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
