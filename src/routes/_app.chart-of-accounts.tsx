import { ModuleGuard } from "@/lib/modules";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FolderTree,
  ChevronDown,
  ChevronRight,
  Search,
  ExternalLink,
  ShieldAlert,
  CheckCircle2,
  Lock,
  Layers,
  BookOpen,
  RefreshCw,
  FileText,
} from "lucide-react";

export const Route = createFileRoute("/_app/chart-of-accounts")({
  head: () => ({
    meta: [{ title: "شجرة دليل الحسابات — Vortex ERP" }],
  }),
  component: () => (
    <ModuleGuard moduleId="advanced_accounting">
      <ChartOfAccountsPage />
    </ModuleGuard>
  ),
});

interface AccountNode {
  id: string;
  code: string;
  name_ar: string;
  account_type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  parent_id: string | null;
  parent_code: string | null;
  level: number;
  is_postable: boolean;
  is_system: boolean;
  is_active: boolean;
  notes: string | null;
  total_debit: number;
  total_credit: number;
  current_balance: number;
  children_count: number;
}

function ChartOfAccountsPage() {
  const { dir } = useI18n();
  const isRtl = dir === "rtl";
  const [accounts, setAccounts] = useState<AccountNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [postableFilter, setPostableFilter] = useState<string>("ALL");
  const [collapsedNodes, setCollapsedNodes] = useState<Record<string, boolean>>({});

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any).rpc("get_chart_of_accounts_tree");

      if (error) {
        // Fallback to direct select from accounts if RPC not yet created
        const { data: raw, error: rawErr } = await (supabase as any)
          .from("accounts")
          .select("*")
          .order("code");

        if (rawErr) throw rawErr;
        const mapped = (raw || []).map((a: any) => ({
          id: a.id,
          code: a.code,
          name_ar: a.name_ar,
          account_type: a.account_type,
          parent_id: a.parent_id,
          parent_code: null,
          level: a.code.length <= 4 && a.code.endsWith("000") ? 1 : a.code.endsWith("00") ? 2 : 3,
          is_postable: a.is_postable ?? true,
          is_system: a.is_system ?? false,
          is_active: a.is_active ?? true,
          notes: a.notes,
          total_debit: 0,
          total_credit: 0,
          current_balance: 0,
          children_count: 0,
        }));
        setAccounts(mapped);
      } else {
        setAccounts(
          (data || []).map((a: any) => ({
            id: a.id,
            code: a.code,
            name_ar: a.name_ar,
            account_type: a.account_type,
            parent_id: a.parent_id,
            parent_code: a.parent_code,
            level: Number(a.level) || 1,
            is_postable: Boolean(a.is_postable),
            is_system: Boolean(a.is_system),
            is_active: Boolean(a.is_active),
            notes: a.notes,
            total_debit: Number(a.total_debit) || 0,
            total_credit: Number(a.total_credit) || 0,
            current_balance: Number(a.current_balance) || 0,
            children_count: Number(a.children_count) || 0,
          })),
        );
      }
    } catch {
      // keep empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const toggleCollapse = (code: string) => {
    setCollapsedNodes((prev) => ({
      ...prev,
      [code]: !prev[code],
    }));
  };

  const expandAll = () => setCollapsedNodes({});
  const collapseAll = () => {
    const next: Record<string, boolean> = {};
    accounts.forEach((a) => {
      if (a.children_count > 0 || !a.is_postable) {
        next[a.code] = true;
      }
    });
    setCollapsedNodes(next);
  };

  // Filter accounts
  const filteredAccounts = useMemo(() => {
    return accounts.filter((a) => {
      if (typeFilter !== "ALL" && a.account_type !== typeFilter) {
        return false;
      }
      if (postableFilter === "POSTABLE" && !a.is_postable) return false;
      if (postableFilter === "PARENT" && a.is_postable) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        return (
          a.code.toLowerCase().includes(q) ||
          a.name_ar.toLowerCase().includes(q) ||
          (a.notes && a.notes.toLowerCase().includes(q))
        );
      }

      // Check if any ancestor is collapsed
      if (a.parent_code && collapsedNodes[a.parent_code]) {
        return false;
      }

      return true;
    });
  }, [accounts, typeFilter, postableFilter, searchQuery, collapsedNodes]);

  // Statistics
  const totalCount = accounts.length;
  const parentCount = accounts.filter((a) => !a.is_postable).length;
  const postableCount = accounts.filter((a) => a.is_postable).length;
  const systemCount = accounts.filter((a) => a.is_system).length;

  const getTypeBadge = (type: string) => {
    switch (type) {
      case "ASSET":
        return (
          <Badge variant="outline" className="border-blue-500 text-blue-600 bg-blue-50/50">
            أصول
          </Badge>
        );
      case "LIABILITY":
        return (
          <Badge variant="outline" className="border-amber-500 text-amber-700 bg-amber-50/50">
            خصوم والتزامات
          </Badge>
        );
      case "EQUITY":
        return (
          <Badge variant="outline" className="border-purple-500 text-purple-700 bg-purple-50/50">
            حقوق ملكية
          </Badge>
        );
      case "REVENUE":
        return (
          <Badge variant="outline" className="border-emerald-500 text-emerald-700 bg-emerald-50/50">
            إيرادات
          </Badge>
        );
      case "EXPENSE":
        return (
          <Badge variant="outline" className="border-rose-500 text-rose-700 bg-rose-50/50">
            مصروفات
          </Badge>
        );
      default:
        return <Badge variant="outline">{type}</Badge>;
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" dir={isRtl ? "rtl" : "ltr"}>
      <PageHeader
        title="دليل الحسابات وشجرة الأستاذ العام"
        subtitle="الهيكل الشجري المحاسبي الموحد لكافة الحسابات الرئيسية والتجميعية والتشغيلية، مع حوكمة الترحيل ومجاميع الأرصدة."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchAccounts} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ml-1.5 ${loading ? "animate-spin" : ""}`} />
              تحديث
            </Button>
            <Button variant="outline" size="sm" onClick={expandAll}>
              توسيع الكل
            </Button>
            <Button variant="outline" size="sm" onClick={collapseAll}>
              طي الشجرة
            </Button>
          </div>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground flex items-center justify-between">
              <span>إجمالي الحسابات بالدليل</span>
              <FolderTree className="h-4 w-4 text-primary" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCount}</div>
            <p className="text-xs text-muted-foreground mt-1">
              حسابات رئيسية وفرعية موزعة على 5 مستويات
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground flex items-center justify-between">
              <span>الحسابات التجميعية (آباء)</span>
              <Layers className="h-4 w-4 text-amber-600" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{parentCount}</div>
            <p className="text-xs text-muted-foreground mt-1">
              غير قابلة للترحيل المباشر (is_postable = false)
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground flex items-center justify-between">
              <span>الحسابات التشغيلية المباشرة</span>
              <BookOpen className="h-4 w-4 text-emerald-600" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">{postableCount}</div>
            <p className="text-xs text-muted-foreground mt-1">
              حسابات فرعية قابلة للقيد والترحيل المحاسبي
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground flex items-center justify-between">
              <span>حسابات النظام المحمية</span>
              <Lock className="h-4 w-4 text-blue-600" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{systemCount}</div>
            <p className="text-xs text-muted-foreground mt-1">
              مربوطة بدوال الترحيل التلقائي لمبيعات ومشتريات
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <Card className="shadow-sm">
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="البحث برقم الحساب أو الاسم أو الملاحظات..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-9 text-xs"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground whitespace-nowrap">النوع:</span>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">كافة الأنواع</SelectItem>
                  <SelectItem value="ASSET">الأصول</SelectItem>
                  <SelectItem value="LIABILITY">الخصوم</SelectItem>
                  <SelectItem value="EQUITY">حقوق الملكية</SelectItem>
                  <SelectItem value="REVENUE">الإيرادات</SelectItem>
                  <SelectItem value="EXPENSE">المصروفات</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                قابلية الترحيل:
              </span>
              <Select value={postableFilter} onValueChange={setPostableFilter}>
                <SelectTrigger className="w-40 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">الكل</SelectItem>
                  <SelectItem value="POSTABLE">قابلة للترحيل فقط</SelectItem>
                  <SelectItem value="PARENT">حسابات تجميعية فقط</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(searchQuery || typeFilter !== "ALL" || postableFilter !== "ALL") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchQuery("");
                  setTypeFilter("ALL");
                  setPostableFilter("ALL");
                }}
                className="text-xs"
              >
                مسح التصفية
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tree Table */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <FolderTree className="h-5 w-5 text-primary" />
            شجرة دليل الحسابات
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            {filteredAccounts.length} حساب معروض
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-80">الحساب والرمز</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>المستوى</TableHead>
                <TableHead>حالة الترحيل</TableHead>
                <TableHead className="text-left font-mono">إجمالي المدين</TableHead>
                <TableHead className="text-left font-mono">إجمالي الدائن</TableHead>
                <TableHead className="text-left font-mono">الرصيد الدفتري</TableHead>
                <TableHead className="w-24 text-center">الإجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAccounts.map((a) => {
                const isCollapsed = collapsedNodes[a.code];
                const hasChildren = a.children_count > 0 || !a.is_postable;
                const indentPadding = (a.level - 1) * 20;

                return (
                  <TableRow
                    key={a.id}
                    className={`hover:bg-muted/30 ${
                      !a.is_postable ? "bg-muted/15 font-semibold" : ""
                    }`}
                  >
                    {/* Account Code & Name with Tree indentation */}
                    <TableCell>
                      <div
                        className="flex items-center gap-1.5"
                        style={{ paddingRight: `${indentPadding}px` }}
                      >
                        {hasChildren ? (
                          <button
                            type="button"
                            onClick={() => toggleCollapse(a.code)}
                            className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground shrink-0"
                          >
                            {isCollapsed ? (
                              <ChevronRight className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </button>
                        ) : (
                          <span className="w-6 shrink-0 inline-block text-center text-muted-foreground/40">
                            •
                          </span>
                        )}

                        <span className="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-muted/60 text-primary shrink-0">
                          {a.code}
                        </span>

                        <span className="truncate text-xs font-medium mr-1">{a.name_ar}</span>

                        {a.children_count > 0 && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1 py-0 h-4 mr-1 shrink-0"
                          >
                            {a.children_count} فرعي
                          </Badge>
                        )}
                      </div>
                    </TableCell>

                    <TableCell>{getTypeBadge(a.account_type)}</TableCell>

                    <TableCell>
                      <Badge variant="outline" className="text-[11px]">
                        مستوى {a.level}
                      </Badge>
                    </TableCell>

                    <TableCell>
                      {a.is_postable ? (
                        <div className="flex items-center gap-1 text-xs text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>قابل للترحيل</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-xs text-amber-700">
                          <ShieldAlert className="h-3.5 w-3.5" />
                          <span>تجميعي (مغلق)</span>
                        </div>
                      )}
                    </TableCell>

                    <TableCell className="font-mono text-xs text-left">
                      {a.total_debit > 0 ? money(a.total_debit) : "—"}
                    </TableCell>

                    <TableCell className="font-mono text-xs text-left">
                      {a.total_credit > 0 ? money(a.total_credit) : "—"}
                    </TableCell>

                    <TableCell className="font-mono text-xs font-bold text-left text-primary">
                      {a.current_balance !== 0 ? money(a.current_balance) : "0.00"}
                    </TableCell>

                    <TableCell className="text-center">
                      {a.is_postable && (
                        <Link
                          to="/general-ledger"
                          search={{ accountCode: a.code } as any}
                          className="inline-flex items-center justify-center p-1.5 text-muted-foreground hover:text-primary hover:bg-muted rounded"
                          title="عرض في الأستاذ العام"
                        >
                          <FileText className="h-3.5 w-3.5" />
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
