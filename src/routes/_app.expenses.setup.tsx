import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Building2, Landmark, ShieldCheck, Tags } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ExpenseCategoriesSection } from "@/components/settings/sections/expense-categories-section";
import { ExpenseCostCentersSection } from "@/components/settings/sections/expense-cost-centers-section";
import { ExpenseLedgerAccountsSection } from "@/components/settings/sections/expense-ledger-accounts-section";
import { ExpenseApprovalRulesSection } from "@/components/settings/sections/expense-approval-rules-section";
import { ModuleGuard } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/expenses/setup")({
  validateSearch: (search: Record<string, unknown>) => ({
    section:
      search.section === "cost-centers"
        ? "cost-centers"
        : search.section === "accounts"
          ? "accounts"
          : search.section === "approvals"
            ? "approvals"
          : "categories",
  }),
  head: () => ({ meta: [{ title: "إعدادات المصروفات — فورتكس ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="expenses">
      <ExpenseSetupPage />
    </ModuleGuard>
  ),
});

function ExpenseSetupPage() {
  const { section } = Route.useSearch();
  const { hasRole } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const canEdit = hasRole("owner") || hasRole("manager");
  const sections = [
    {
      id: "categories" as const,
      label: isAr ? "تصنيفات المصروفات" : "Expense categories",
      icon: Tags,
    },
    {
      id: "cost-centers" as const,
      label: isAr ? "مراكز التكلفة" : "Cost centers",
      icon: Building2,
    },
    {
      id: "accounts" as const,
      label: isAr ? "ربط الحسابات" : "Ledger accounts",
      icon: Landmark,
    },
    {
      id: "approvals" as const,
      label: isAr ? "قواعد الاعتماد" : "Approval rules",
      icon: ShieldCheck,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={isAr ? "إعدادات المصروفات" : "Expense setup"}
        subtitle={
          isAr
            ? "إدارة التصنيفات وحساباتها ومراكز التكلفة من قسم المصروفات."
            : "Manage expense categories, posting accounts, and cost centers."
        }
        actions={
          <Link
            to="/expenses"
            search={{ create: false, costCenterId: undefined, categoryId: undefined, section: undefined }}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border px-3 text-sm font-semibold hover:bg-muted"
          >
            <ArrowRight className="size-4" aria-hidden="true" />
            {isAr ? "سجل المصروفات" : "Expense register"}
          </Link>
        }
      />

      <nav
        aria-label={isAr ? "إعدادات المصروفات" : "Expense settings"}
        className="flex flex-wrap gap-2 rounded-2xl border border-border/70 bg-card/70 p-2"
      >
        {sections.map(({ id, label, icon: Icon }) => (
          <Link
            key={id}
            to="/expenses/setup"
            search={{ section: id } as any}
            aria-current={section === id ? "page" : undefined}
            className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
              section === id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </Link>
        ))}
      </nav>

      {section === "categories" ? (
        <ExpenseCategoriesSection canEdit={canEdit} lang={lang} />
      ) : section === "cost-centers" ? (
        <ExpenseCostCentersSection canEdit={canEdit} lang={lang} />
      ) : section === "accounts" ? (
        <ExpenseLedgerAccountsSection canEdit={canEdit} lang={lang} />
      ) : (
        <ExpenseApprovalRulesSection canEdit={canEdit} lang={lang} />
      )}
    </div>
  );
}
