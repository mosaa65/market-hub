import { useModules } from "@/lib/modules";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Users,
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  MoreVertical,
  Wallet,
  AlertTriangle,
  FileText,
  ShoppingCart,
  Star,
  Receipt,
  Printer,
  CreditCard,
  Calendar,
  MapPin,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/customers")({
  head: () => ({ meta: [{ title: "العملاء — فورتيكس ERP" }] }),
  component: CustomersPage,
});

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  credit_limit: number;
  balance: number;
  loyalty_points: number;
  is_active: boolean;
  created_at: string;
}

function CustomersPage() {
  const { t, lang } = useI18n();
  const { isModuleEnabled } = useModules();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<Partial<Customer> | null>(null);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [activity, setActivity] = useState<
    { label: string; date: string; amount: number; kind: "sale" | "payment" }[]
  >([]);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"all" | "invoices" | "payments">("all");
  const menuRef = useRef<HTMLDivElement>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("customers").select("*").order("name");
    setRows((data ?? []) as Customer[]);
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, []);

  // Close menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(null);
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [menuOpen]);

  const filtered = rows.filter(
    (r) =>
      !search ||
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      (r.phone ?? "").includes(search) ||
      (r.email ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  // Balance summaries
  const { totalOwed, totalCredit } = useMemo(() => {
    let owed = 0;
    let credit = 0;
    for (const r of rows) {
      const bal = Number(r.balance);
      if (bal > 0) owed += bal;
      else if (bal < 0) credit += Math.abs(bal);
    }
    return { totalOwed: owed, totalCredit: credit };
  }, [rows]);

  async function save() {
    if (!edit?.name?.trim()) return toast.error(t("common.required"));
    const payload = {
      name: edit.name.trim(),
      phone: edit.phone || null,
      email: edit.email || null,
      address: edit.address || null,
      credit_limit: Number(edit.credit_limit ?? 0),
      is_active: edit.is_active ?? true,
    };
    const { error } = edit.id
      ? await supabase.from("customers").update(payload).eq("id", edit.id)
      : await supabase.from("customers").insert(payload);
    if (error) return toast.error(error.message);
    toast.success(edit.id ? t("common.updated") : t("common.created"));
    setEdit(null);
    await load();
  }

  const remove = useCallback(
    async (id: string) => {
      if (!confirm(t("common.confirm_delete"))) return;
      const { error } = await supabase.from("customers").delete().eq("id", id);
      if (error) return toast.error(error.message);
      toast.success(t("common.deleted"));
      await load();
    },
    [t],
  );

  async function openCustomer(customer: Customer) {
    setSelected(customer);
    setActivity([]);
    setDetailTab("all");
    const [sales, payments] = await Promise.all([
      supabase
        .from("sales_invoices")
        .select("invoice_number,created_at,total")
        .eq("customer_id", customer.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("customer_payments")
        .select("payment_date,amount,sales_invoices(invoice_number)")
        .eq("customer_id", customer.id)
        .order("payment_date", { ascending: false }),
    ]);
    setActivity(
      [
        ...(sales.data ?? []).map((s) => ({
          label: `${lang === "ar" ? "فاتورة" : "Invoice"} ${s.invoice_number}`,
          date: s.created_at,
          amount: Number(s.total),
          kind: "sale" as const,
        })),
        ...(payments.data ?? []).map((p: any) => ({
          label: `${lang === "ar" ? "سداد" : "Payment"} ${p.sales_invoices?.invoice_number ?? ""}`,
          date: p.payment_date,
          amount: Number(p.amount),
          kind: "payment" as const,
        })),
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    );
  }

  // ─── Quick actions navigation ───
  const goPayment = useCallback(
    (c: Customer) => {
      navigate({ to: "/payments", search: { customerId: c.id } as any });
    },
    [navigate],
  );
  const goDebts = useCallback(
    (c: Customer) => {
      navigate({ to: "/debts", search: { customerId: c.id } as any });
    },
    [navigate],
  );
  const goStatement = useCallback(
    (c: Customer) => {
      navigate({ to: "/account-statement", search: { customerId: c.id } as any });
    },
    [navigate],
  );
  const goPOS = useCallback(
    (c: Customer) => {
      navigate({ to: "/pos", search: { customerId: c.id } as any });
    },
    [navigate],
  );
  const goSales = useCallback(
    (c: Customer) => {
      navigate({ to: "/sales", search: { customerId: c.id } as any });
    },
    [navigate],
  );

  const printCustomerStatement = useCallback(
    (c: Customer) => {
      const rtl = lang === "ar";
      const esc = (value: string | number | null | undefined) =>
        String(value ?? "—").replace(
          /[&<>"']/g,
          (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!,
        );
      const date = (value: string) => new Date(value).toLocaleDateString(rtl ? "ar-SA" : "en-GB");
      const activityRows = activity
        .map(
          (a) =>
            `<tr><td>${esc(date(a.date))}</td><td>${esc(a.label)}</td><td class="${a.kind === "sale" ? "balance" : "paid"}">${a.kind === "sale" ? "+" : "−"}${esc(money(a.amount))}</td></tr>`,
        )
        .join("");
      const popup = window.open("", "_blank", "noopener,noreferrer");
      if (!popup) return;
      popup.document
        .write(`<!doctype html><html lang="${rtl ? "ar" : "en"}" dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>${rtl ? "كشف حساب" : "Account statement"} — ${esc(c.name)}</title><style>
      @page { size: A4; margin: 14mm; } * { box-sizing: border-box; } body { font-family: Tahoma, Arial, sans-serif; color:#172033; font-size:12px; } .top { display:flex; justify-content:space-between; gap:24px; border-bottom:3px solid #2563eb; padding-bottom:14px; } h1 { margin:0 0 5px; font-size:24px; } .muted { color:#667085; } .summary { display:grid; grid-template-columns:repeat(2,1fr); gap:10px; margin:20px 0; } .card { border:1px solid #dbe3ef; border-radius:10px; padding:11px; background:#f8fafc; } .card b { display:block; font-size:17px; margin-top:4px; } table { width:100%; border-collapse:collapse; margin-top:14px; } th { background:#1e293b; color:white; font-weight:600; } th,td { padding:8px; border:1px solid #dbe3ef; text-align:${rtl ? "right" : "left"}; } tr:nth-child(even) { background:#f8fafc; } .balance { color:#b45309; font-weight:700; } .paid { color:#047857; font-weight:700; } .foot { margin-top:24px; padding-top:10px; border-top:1px solid #dbe3ef; color:#667085; font-size:10px; } @media print { .no-print { display:none; } }
    </style></head><body><div class="top"><div><h1>${rtl ? "كشف حساب عميل" : "Customer account statement"}</h1><div class="muted">${rtl ? "تاريخ الإصدار" : "Issued"}: ${esc(new Date().toLocaleDateString(rtl ? "ar-SA" : "en-GB"))}</div></div><div><b>${esc(c.name)}</b><div class="muted">${esc(c.phone)} ${c.email ? `· ${esc(c.email)}` : ""}</div></div></div><div class="summary"><div class="card"><span class="muted">${rtl ? "الرصيد المستحق" : "Current balance"}</span><b>${esc(money(Number(c.balance)))}</b></div><div class="card"><span class="muted">${rtl ? "حد الائتمان" : "Credit limit"}</span><b>${esc(money(Number(c.credit_limit)))}</b></div></div><table><thead><tr><th>${rtl ? "التاريخ" : "Date"}</th><th>${rtl ? "البيان" : "Description"}</th><th>${rtl ? "المبلغ" : "Amount"}</th></tr></thead><tbody>${activityRows || `<tr><td colspan="3">${rtl ? "لا توجد حركات" : "No activity"}</td></tr>`}</tbody></table><div class="foot">${rtl ? "تم إنشاء هذا التقرير تلقائياً بواسطة نظام فورتيكس ERP." : "Generated automatically by Vortex ERP."}</div><script>window.onload=()=>setTimeout(()=>window.print(),200)</script></body></html>`);
      popup.document.close();
    },
    [lang, activity],
  );

  // ─── Keyboard shortcuts (customers page only) ───
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Don't fire when editing inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (edit) return; // don't fire when edit modal open

      const active = (hoveredRow ? rows.find((r) => r.id === hoveredRow) : null) || selected;

      switch (e.key) {
        case "F1":
          e.preventDefault();
          setEdit({});
          break;
        case "F2":
          if (active) {
            e.preventDefault();
            setEdit(active);
          } else
            toast.info(
              lang === "ar"
                ? "مرر المؤشر فوق عميل للتعديل (F2)"
                : "Hover over a customer to edit (F2)",
            );
          break;
        case "F3":
          if (active) {
            e.preventDefault();
            goPayment(active);
          } else
            toast.info(
              lang === "ar"
                ? "مرر المؤشر فوق عميل للتحصيل (F3)"
                : "Hover over a customer to collect payment (F3)",
            );
          break;
        case "F4":
          if (active) {
            e.preventDefault();
            void remove(active.id);
          } else
            toast.info(
              lang === "ar"
                ? "مرر المؤشر فوق عميل للحذف (F4)"
                : "Hover over a customer to delete (F4)",
            );
          break;
        case "F5":
          if (active) {
            e.preventDefault();
            goStatement(active);
          } else
            toast.info(
              lang === "ar"
                ? "مرر المؤشر فوق عميل لكشف الحساب (F5)"
                : "Hover over a customer for statement (F5)",
            );
          break;
        case "F6":
          if (active) {
            if (Number(active.balance) > 0) {
              e.preventDefault();
              goDebts(active);
            } else {
              toast.info(
                lang === "ar"
                  ? "هذا العميل ليس عليه ديون"
                  : "This customer has no outstanding debt",
              );
            }
          } else {
            toast.info(
              lang === "ar"
                ? "مرر المؤشر فوق عميل لعرض الدين (F6)"
                : "Hover over a customer to view debt (F6)",
            );
          }
          break;
        case "Escape":
          setMenuOpen(null);
          setSelected(null);
          setEdit(null);
          break;
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hoveredRow, selected, rows, edit, lang, goPayment, goDebts, goStatement, remove]);

  // Detail dialog stats
  const detailStats = useMemo(() => {
    if (!selected) return null;
    const invoiceItems = activity.filter((a) => a.kind === "sale");
    const paymentItems = activity.filter((a) => a.kind === "payment");
    const totalPurchases = invoiceItems.reduce((s, a) => s + a.amount, 0);
    const totalPayments = paymentItems.reduce((s, a) => s + a.amount, 0);
    const lastActivity = activity.length > 0 ? activity[0].date : null;
    return {
      invoiceItems,
      paymentItems,
      totalPurchases,
      totalPayments,
      invoiceCount: invoiceItems.length,
      paymentCount: paymentItems.length,
      lastActivity,
    };
  }, [selected, activity]);

  return (
    <>
      <PageHeader title={t("customers.title")} subtitle={t("customers.subtitle")} />

      {/* ─── Balance Summary Strip ─── */}
      <div className="mb-4 flex items-center justify-between rounded-xl border border-border/60 bg-surface/60 backdrop-blur-sm px-4 py-2.5">
        <div className="flex items-center gap-6 text-xs">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-2 w-2 rounded-full bg-amber-500" />
            <span className="text-muted-foreground">
              {lang === "ar" ? "المبلغ عليهم:" : "Owed by them:"}
            </span>
            <span className="font-mono font-semibold text-amber-500">{money(totalOwed)}</span>
          </div>
          <div className="h-4 w-px bg-border/60" />
          <div className="flex items-center gap-2">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-muted-foreground">
              {lang === "ar" ? "المبلغ لهم:" : "Owed to them:"}
            </span>
            <span className="font-mono font-semibold text-emerald-500">{money(totalCredit)}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Subtle keyboard shortcuts helper pill */}
          <div className="hidden lg:flex items-center gap-2 text-[10px] text-muted-foreground/70 bg-surface-2/40 px-2.5 py-1 rounded-lg border border-border/40">
            <span>F1 عميل جديد</span>
            <span>·</span>
            <span>F2 تعديل</span>
            <span>·</span>
            <span>F3 تحصيل</span>
            <span>·</span>
            <span>F4 حذف</span>
            <span>·</span>
            <span>F5 كشف</span>
            <span>·</span>
            <span>F6 دين</span>
          </div>
          <div className="text-[10px] text-muted-foreground">
            {lang === "ar" ? `${rows.length} عميل` : `${rows.length} customers`}
          </div>
        </div>
      </div>

      <div className="panel-elevated p-4">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-10 flex-1 items-center gap-2 rounded-full border border-input bg-surface px-4 text-sm">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={lang === "ar" ? "ابحث في العملاء..." : "Search customers…"}
              className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex flex-col items-center">
            <button
              onClick={() => setEdit({})}
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-sm shadow-primary/20 hover:opacity-90 transition"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{lang === "ar" ? "عميل جديد" : "New customer"}</span>
            </button>
            <span className="text-[9px] text-muted-foreground/60 font-mono mt-0.5">F1</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-start font-medium">{t("common.name")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("common.phone")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("common.email")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("common.balance")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("common.status")}</th>
                <th className="px-3 py-2 text-end font-medium">
                  {lang === "ar" ? "الإجراءات" : "Actions"}
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-muted-foreground">
                    {t("common.loading")}
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-muted-foreground">
                    <Users className="mx-auto mb-2 h-8 w-8 opacity-50" />
                    {t("customers.no_customers")}
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => void openCustomer(r)}
                    onMouseEnter={() => setHoveredRow(r.id)}
                    onMouseLeave={() => setHoveredRow(null)}
                    className={`cursor-pointer border-b border-border/50 transition-colors ${hoveredRow === r.id ? "bg-surface-2/60" : "hover:bg-surface-2/50"}`}
                  >
                    <td className="px-3 py-2.5">
                      <div className="font-medium">{r.name}</div>
                      {Number(r.credit_limit) > 0 && (
                        <div className="text-[11px] text-rose-500 font-mono mt-0.5">
                          {lang === "ar" ? "حد الائتمان:" : "Credit:"}{" "}
                          {money(Number(r.credit_limit))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{r.phone ?? "—"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{r.email ?? "—"}</td>
                    <td className="px-3 py-2.5 text-end font-mono">{money(Number(r.balance))}</td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${r.is_active ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : "border-border bg-muted text-muted-foreground"}`}
                      >
                        {r.is_active ? t("common.active") : t("common.inactive")}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-end">
                      <div className="flex items-center justify-end gap-1.5 relative">
                        {/* Edit with F2 below */}
                        <div className="flex flex-col items-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEdit(r);
                            }}
                            title={`${t("common.edit")} (F2)`}
                            className="group/btn grid h-7 w-7 place-items-center rounded-lg border border-border bg-surface text-muted-foreground hover:bg-surface-2 hover:text-foreground transition"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <span className="text-[9px] text-muted-foreground/50 font-mono leading-none mt-0.5">
                            F2
                          </span>
                        </div>

                        {/* Delete with F4 below */}
                        <div className="flex flex-col items-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void remove(r.id);
                            }}
                            title={`${t("common.delete")} (F4)`}
                            className="group/btn grid h-7 w-7 place-items-center rounded-lg border border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10 transition"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                          <span className="text-[9px] text-muted-foreground/50 font-mono leading-none mt-0.5">
                            F4
                          </span>
                        </div>

                        {/* Quick actions trigger with menu */}
                        <div className="flex flex-col items-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuOpen(menuOpen === r.id ? null : r.id);
                            }}
                            title={lang === "ar" ? "إجراءات سريعة" : "Quick actions"}
                            className="grid h-7 w-7 place-items-center rounded-lg border border-border bg-surface text-muted-foreground hover:bg-surface-2 hover:text-foreground transition"
                          >
                            <MoreVertical className="h-3.5 w-3.5" />
                          </button>
                          <span className="text-[9px] text-muted-foreground/50 font-mono leading-none mt-0.5">
                            ⋯
                          </span>
                        </div>

                        {/* Quick actions dropdown */}
                        {menuOpen === r.id && (
                          <div
                            ref={menuRef}
                            className="absolute end-0 top-10 z-50 min-w-[210px] rounded-xl border border-border/60 bg-surface shadow-xl shadow-black/20 backdrop-blur-xl p-1.5 animate-in fade-in slide-in-from-top-2 duration-150"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {isModuleEnabled("payments") && (
                              <QuickActionItem
                                icon={<Wallet className="h-3.5 w-3.5" />}
                                label={lang === "ar" ? "تحصيل دفعة" : "Collect payment"}
                                shortcut="F3"
                                onClick={() => {
                                  setMenuOpen(null);
                                  goPayment(r);
                                }}
                              />
                            )}
                            {isModuleEnabled("payments") && Number(r.balance) > 0 && (
                              <QuickActionItem
                                icon={<AlertTriangle className="h-3.5 w-3.5" />}
                                label={lang === "ar" ? "الدين" : "Debt"}
                                shortcut="F6"
                                tone="amber"
                                onClick={() => {
                                  setMenuOpen(null);
                                  goDebts(r);
                                }}
                              />
                            )}
                            {isModuleEnabled("payments") && (
                              <QuickActionItem
                                icon={<FileText className="h-3.5 w-3.5" />}
                                label={lang === "ar" ? "كشف حساب" : "Account statement"}
                                shortcut="F5"
                                onClick={() => {
                                  setMenuOpen(null);
                                  goStatement(r);
                                }}
                              />
                            )}
                            <div className="my-1 border-t border-border/40" />
                            <QuickActionItem
                              icon={<ShoppingCart className="h-3.5 w-3.5" />}
                              label={lang === "ar" ? "إنشاء فاتورة بيع" : "New sale"}
                              onClick={() => {
                                setMenuOpen(null);
                                if (isModuleEnabled("pos")) {
                                  goPOS(r);
                                } else {
                                  navigate({ to: "/sales" });
                                }
                              }}
                            />
                            {isModuleEnabled("loyalty") && Number(r.loyalty_points) > 0 && (
                              <QuickActionItem
                                icon={<Star className="h-3.5 w-3.5" />}
                                label={lang === "ar" ? "نقاط الولاء" : "Loyalty points"}
                                badge={String(r.loyalty_points)}
                                onClick={() => {
                                  setMenuOpen(null);
                                  navigate({ to: "/loyalty" });
                                }}
                              />
                            )}
                            <QuickActionItem
                              icon={<Receipt className="h-3.5 w-3.5" />}
                              label={lang === "ar" ? "فواتير العميل" : "Customer invoices"}
                              onClick={() => {
                                setMenuOpen(null);
                                goSales(r);
                              }}
                            />
                            <div className="my-1 border-t border-border/40" />
                            <QuickActionItem
                              icon={<Pencil className="h-3.5 w-3.5" />}
                              label={lang === "ar" ? "تعديل" : "Edit"}
                              shortcut="F2"
                              onClick={() => {
                                setMenuOpen(null);
                                setEdit(r);
                              }}
                            />
                            <QuickActionItem
                              icon={<Trash2 className="h-3.5 w-3.5" />}
                              label={lang === "ar" ? "حذف" : "Delete"}
                              shortcut="F4"
                              tone="red"
                              onClick={() => {
                                setMenuOpen(null);
                                void remove(r.id);
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Edit / New Customer Dialog ─── */}
      {edit && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm p-4">
          <div className="panel-elevated w-full max-w-md p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">
                {edit.id
                  ? lang === "ar"
                    ? "تعديل العميل"
                    : "Edit customer"
                  : lang === "ar"
                    ? "عميل جديد"
                    : "New customer"}
              </h3>
              <button onClick={() => setEdit(null)} className="rounded p-1 hover:bg-surface-2">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <InputField
                label={`${t("common.name")} *`}
                value={edit.name ?? ""}
                onChange={(v) => setEdit({ ...edit, name: v })}
              />
              <div className="grid grid-cols-2 gap-3">
                <InputField
                  label={t("common.phone")}
                  value={edit.phone ?? ""}
                  onChange={(v) => setEdit({ ...edit, phone: v })}
                />
                <InputField
                  label={t("common.email")}
                  value={edit.email ?? ""}
                  onChange={(v) => setEdit({ ...edit, email: v })}
                  type="email"
                />
              </div>
              <InputField
                label={t("common.address")}
                value={edit.address ?? ""}
                onChange={(v) => setEdit({ ...edit, address: v })}
              />
              <div>
                <InputField
                  label={t("customers.credit_limit")}
                  value={String(edit.credit_limit ?? 0)}
                  onChange={(v) => setEdit({ ...edit, credit_limit: Number(v) as any })}
                  type="number"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {lang === "ar"
                    ? "اتركه صفرًا لفتح الآجل بلا سقف (ما لم يُفعّل السقف من الإعدادات)."
                    : "Zero means unlimited credit unless enforcement is enabled in Settings."}
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={edit.is_active ?? true}
                  onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })}
                  className="h-4 w-4 rounded border-border"
                />
                {t("common.active")}
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setEdit(null)}
                className="h-9 rounded-md border border-border px-4 text-sm hover:bg-surface-2"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={save}
                className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                {t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Enhanced Customer Detail Dialog ─── */}
      {selected && detailStats && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="panel-elevated w-full max-w-2xl p-6 max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">{selected.name}</h3>
                <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-muted-foreground">
                  {selected.phone && <span>{selected.phone}</span>}
                  {selected.email && (
                    <>
                      <span>·</span>
                      <span>{selected.email}</span>
                    </>
                  )}
                  {selected.address && (
                    <>
                      <span>·</span>
                      <span className="flex items-center gap-0.5">
                        <MapPin className="h-3 w-3" />
                        {selected.address}
                      </span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${selected.is_active ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : "border-border bg-muted text-muted-foreground"}`}
                  >
                    {selected.is_active ? t("common.active") : t("common.inactive")}
                  </span>
                  {Number(selected.credit_limit) > 0 &&
                    Number(selected.balance) > Number(selected.credit_limit) && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-500">
                        <AlertTriangle className="h-3 w-3" />{" "}
                        {lang === "ar" ? "تجاوز حد الائتمان" : "Over credit limit"}
                      </span>
                    )}
                  {Number(selected.loyalty_points) > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-500">
                      <Star className="h-3 w-3" /> {selected.loyalty_points}{" "}
                      {lang === "ar" ? "نقطة" : "pts"}
                    </span>
                  )}
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="rounded p-1 hover:bg-surface-2">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Stats cards */}
            <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
              <MiniStat
                label={lang === "ar" ? "الرصيد المستحق" : "Balance"}
                value={money(Number(selected.balance))}
                color="text-primary"
              />
              <MiniStat
                label={lang === "ar" ? "حد الائتمان" : "Credit limit"}
                value={money(Number(selected.credit_limit))}
              />
              <MiniStat
                label={lang === "ar" ? "إجمالي الفواتير" : "Total invoices"}
                value={String(detailStats.invoiceCount)}
              />
              <MiniStat
                label={lang === "ar" ? "إجمالي المدفوع" : "Total paid"}
                value={money(detailStats.totalPayments)}
                color="text-emerald-500"
              />
            </div>

            {/* Quick action buttons */}
            <div className="mb-4 flex flex-wrap gap-2">
              <DetailActionBtn
                icon={<Wallet className="h-3.5 w-3.5" />}
                label={lang === "ar" ? "تحصيل دفعة" : "Collect"}
                onClick={() => goPayment(selected)}
              />
              {Number(selected.balance) > 0 && (
                <DetailActionBtn
                  icon={<AlertTriangle className="h-3.5 w-3.5" />}
                  label={lang === "ar" ? "الدين" : "Debt"}
                  onClick={() => goDebts(selected)}
                />
              )}
              <DetailActionBtn
                icon={<FileText className="h-3.5 w-3.5" />}
                label={lang === "ar" ? "كشف حساب" : "Statement"}
                onClick={() => goStatement(selected)}
              />
              <DetailActionBtn
                icon={<ShoppingCart className="h-3.5 w-3.5" />}
                label={lang === "ar" ? "فاتورة بيع" : "New sale"}
                onClick={() => goPOS(selected)}
              />
              <DetailActionBtn
                icon={<Printer className="h-3.5 w-3.5" />}
                label={lang === "ar" ? "طباعة كشف" : "Print"}
                onClick={() => printCustomerStatement(selected)}
              />
            </div>

            {/* Activity tabs */}
            <div className="flex items-center gap-1 mb-3 border-b border-border pb-1">
              {(["all", "invoices", "payments"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setDetailTab(tab)}
                  className={`rounded-full px-3 py-1 text-xs transition ${detailTab === tab ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {tab === "all"
                    ? (lang === "ar" ? "الكل" : "All") + ` (${activity.length})`
                    : tab === "invoices"
                      ? (lang === "ar" ? "فواتير" : "Invoices") + ` (${detailStats.invoiceCount})`
                      : (lang === "ar" ? "دفعات" : "Payments") + ` (${detailStats.paymentCount})`}
                </button>
              ))}
            </div>

            {/* Activity list */}
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
              {(() => {
                const items =
                  detailTab === "all"
                    ? activity
                    : detailTab === "invoices"
                      ? detailStats.invoiceItems
                      : detailStats.paymentItems;
                return items.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {lang === "ar" ? "لا توجد حركات لهذا العميل" : "No activity for this customer"}
                  </p>
                ) : (
                  items.map((item, index) => (
                    <div
                      key={`${item.label}-${index}`}
                      className="flex items-center justify-between rounded-lg border border-border/60 p-2.5 text-sm hover:bg-surface-2/40 transition"
                    >
                      <div>
                        <div className="flex items-center gap-1.5">
                          {item.kind === "sale" ? (
                            <Receipt className="h-3 w-3 text-rose-500" />
                          ) : (
                            <CreditCard className="h-3 w-3 text-emerald-500" />
                          )}
                          <span>{item.label}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(item.date).toLocaleDateString()}
                        </div>
                      </div>
                      <span
                        className={`font-mono font-semibold ${item.kind === "sale" ? "text-rose-500" : "text-emerald-500"}`}
                      >
                        {item.kind === "sale" ? "+" : "−"}
                        {money(item.amount)}
                      </span>
                    </div>
                  ))
                );
              })()}
            </div>

            {/* Footer info */}
            {detailStats.lastActivity && (
              <div className="mt-3 pt-2 border-t border-border/40 text-[11px] text-muted-foreground flex justify-between">
                <span>
                  {lang === "ar" ? "آخر حركة:" : "Last activity:"}{" "}
                  {new Date(detailStats.lastActivity).toLocaleDateString()}
                </span>
                <span>
                  {lang === "ar" ? "تاريخ الإنشاء:" : "Created:"}{" "}
                  {new Date(selected.created_at).toLocaleDateString()}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ─── Sub-components ─── */

function QuickActionItem({
  icon,
  label,
  shortcut,
  badge,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  badge?: string;
  tone?: "red" | "amber";
  onClick: () => void;
}) {
  const color =
    tone === "red"
      ? "text-destructive hover:bg-destructive/10"
      : tone === "amber"
        ? "text-amber-500 hover:bg-amber-500/10"
        : "text-foreground hover:bg-surface-2";
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs transition ${color}`}
    >
      {icon}
      <span className="flex-1 text-start">{label}</span>
      {badge && (
        <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-mono text-amber-500">
          {badge}
        </span>
      )}
      {shortcut && (
        <kbd className="rounded border border-border/40 bg-background/60 px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg bg-surface-2/60 p-2.5 text-center">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`font-mono text-sm font-bold mt-0.5 ${color ?? "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}

function DetailActionBtn({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full border border-border/60 bg-surface px-3 py-1.5 text-xs text-muted-foreground hover:bg-surface-2 hover:text-foreground transition"
    >
      {icon}
      {label}
    </button>
  );
}

function InputField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
      />
    </div>
  );
}
