import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Landmark } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

type ExpenseLedgerRole = "INPUT_TAX" | "SUPPLIER_PAYABLE" | "EMPLOYEE_PAYABLE" | "OTHER_PAYABLE";
type ExpenseLedgerAccount = {
  id: string;
  code: string;
  name_ar: string;
  account_type: "ASSET" | "LIABILITY";
};
type ExpenseLedgerRoleRow = {
  role: ExpenseLedgerRole;
  account_id: string | null;
  account_code: string | null;
  account_name_ar: string | null;
  account_type: string | null;
};
type ExpenseLedgerManagement = {
  roles: ExpenseLedgerRoleRow[];
  accounts: ExpenseLedgerAccount[];
};

const ROLE_LABELS: Record<ExpenseLedgerRole, { ar: string; en: string; type: "ASSET" | "LIABILITY" }> = {
  INPUT_TAX: { ar: "ضريبة مدخلات قابلة للاسترداد", en: "Recoverable input tax", type: "ASSET" },
  SUPPLIER_PAYABLE: { ar: "ذمم الموردين", en: "Supplier payable", type: "LIABILITY" },
  EMPLOYEE_PAYABLE: { ar: "مستحقات الموظفين", en: "Employee payable", type: "LIABILITY" },
  OTHER_PAYABLE: { ar: "مصروفات مستحقة أخرى", en: "Other accrued expenses", type: "LIABILITY" },
};

export function ExpenseLedgerAccountsSection({ canEdit = false, lang = "ar" }) {
  const isAr = lang === "ar";
  const client = useQueryClient();
  const db = supabase as any;
  const query = useQuery({
    queryKey: ["expense-ledger-account-management"],
    enabled: canEdit,
    queryFn: async (): Promise<ExpenseLedgerManagement> => {
      const { data, error } = await db.rpc("expense_ledger_account_management");
      if (error) throw error;
      return (data ?? { roles: [], accounts: [] }) as ExpenseLedgerManagement;
    },
  });
  const save = useMutation({
    mutationFn: async ({ role, accountId }: { role: ExpenseLedgerRole; accountId: string }) => {
      const { error } = await db.rpc("set_expense_ledger_account", {
        p_role: role,
        p_account_id: accountId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["expense-ledger-account-management"] });
      toast.success(isAr ? "تم تحديث الربط المحاسبي" : "Ledger mapping saved");
    },
    onError: (error: any) => toast.error(error?.message || (isAr ? "تعذر حفظ الربط" : "Could not save mapping")),
  });

  return (
    <Card className="border-border/70 bg-card/80">
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <Landmark className="size-5" />
          </span>
          <div>
            <CardTitle>{isAr ? "الحسابات الأساسية للمصروفات" : "Expense ledger accounts"}</CardTitle>
            <CardDescription className="mt-1 max-w-3xl leading-relaxed">
              {isAr
                ? "تحدد هذه الروابط حسابات الالتزام والضريبة القابلة للاسترداد. كل حساب يجب أن يكون نشطًا وقابلًا للترحيل ومن النوع المحاسبي الصحيح. لا يستخدم النظام حسابًا افتراضيًا عند غياب الربط."
                : "These mappings select payable and recoverable-tax accounts. Each account must be active, postable, and of the expected accounting type. Posting is blocked when a required mapping is missing."}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isLoading ? (
          <p className="rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground">
            {isAr ? "جارٍ تحميل الحسابات…" : "Loading accounts…"}
          </p>
        ) : query.error ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm">
            <span>{isAr ? "تعذر تحميل روابط الحسابات." : "Could not load account mappings."}</span>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              {isAr ? "إعادة المحاولة" : "Retry"}
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {(query.data?.roles ?? []).map((row) => {
              const meta = ROLE_LABELS[row.role];
              const options = (query.data?.accounts ?? []).filter((account) => account.account_type === meta.type);
              return (
                <label key={row.role} className="min-w-0 rounded-xl border border-border/70 bg-surface/50 p-3">
                  <span className="mb-2 block text-sm font-semibold text-foreground">
                    {isAr ? meta.ar : meta.en}
                  </span>
                  <select
                    value={row.account_id ?? ""}
                    disabled={!canEdit || save.isPending}
                    onChange={(event) => {
                      if (event.target.value) void save.mutateAsync({ role: row.role, accountId: event.target.value });
                    }}
                    className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <option value="">{isAr ? "اختر حسابًا…" : "Choose an account…"}</option>
                    {options.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.code} · {account.name_ar}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1.5 block text-[11px] text-muted-foreground">
                    {row.account_code
                      ? `${row.account_code} · ${row.account_name_ar ?? ""}`
                      : isAr
                        ? "غير مربوط؛ سيمنع النظام الترحيل عند الحاجة إليه."
                        : "Unmapped; posting will be blocked when this account is required."}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
