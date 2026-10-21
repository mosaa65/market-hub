import { ModuleGuard } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AmountInput } from "@/components/ui/amount-input";
import { QuantityInput } from "@/components/ui/quantity-input";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Building2,
  Plus,
  Play,
  RotateCcw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

export const Route = createFileRoute("/_app/fixed-assets")({
  head: () => ({ meta: [{ title: "الأصول الثابتة — Vortex ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="advanced_accounting">
      <FixedAssetsPage />
    </ModuleGuard>
  ),
});

interface FixedAsset {
  id: string;
  asset_code: string;
  name_ar: string;
  name_en: string | null;
  category: "MACHINERY" | "VEHICLES" | "EQUIPMENT" | "BUILDINGS" | "OTHER";
  purchase_date: string;
  purchase_cost: number;
  salvage_value: number;
  useful_life_months: number;
  depreciation_method: string;
  asset_account_code: string;
  accumulated_depreciation: number;
  current_book_value: number;
  status: "DRAFT" | "ACTIVE" | "FULLY_DEPRECIATED" | "DISPOSED";
  last_depreciation_date: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  MACHINERY: "آلات ومعدات",
  VEHICLES: "مركبات ووسائل نقل",
  EQUIPMENT: "أجهزة وأثاث",
  BUILDINGS: "مباني ومنشآت",
  OTHER: "أخرى",
};

function FixedAssetsPage() {
  const { t } = useI18n();
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // حوار إضافة أصل جديد
  const [newOpen, setNewOpen] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<FixedAsset["category"]>("MACHINERY");
  const [newCost, setNewCost] = useState("");
  const [newSalvage, setNewSalvage] = useState("0");
  const [newMonths, setNewMonths] = useState("60");
  const [newAccount, setNewAccount] = useState("1411");

  // حوار تشغيل الإهلاك
  const [deprOpen, setDeprOpen] = useState(false);
  const [deprAssetId, setDeprAssetId] = useState<string | null>(null);
  const [deprDate, setDeprDate] = useState(new Date().toISOString().slice(0, 10));

  // حوار استبعاد الأصل
  const [disposeOpen, setDisposeOpen] = useState(false);
  const [disposeAsset, setDisposeAsset] = useState<FixedAsset | null>(null);
  const [disposeDate, setDisposeDate] = useState(new Date().toISOString().slice(0, 10));
  const [disposeProceeds, setDisposeProceeds] = useState("0");
  const [disposeAccount, setDisposeAccount] = useState("1101");

  const loadAssets = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from("fixed_assets" as never)
      .select("*")
      .order("purchase_date", { ascending: false });
    if (qErr) {
      setError(qErr.message);
      setAssets([]);
    } else {
      setAssets((data ?? []) as unknown as FixedAsset[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  const summary = useMemo(() => {
    const totalCost = assets.reduce((s, a) => s + Number(a.purchase_cost || 0), 0);
    const totalDepr = assets.reduce((s, a) => s + Number(a.accumulated_depreciation || 0), 0);
    const totalBook = assets.reduce((s, a) => s + Number(a.current_book_value || 0), 0);
    const activeCount = assets.filter((a) => a.status === "ACTIVE").length;
    return { totalCost, totalDepr, totalBook, activeCount };
  }, [assets]);

  const handleCreateAsset = async () => {
    if (!newCode || !newName || !newCost || !newMonths) return;
    setActing(true);
    setError(null);
    const cost = Number(newCost);
    const salvage = Number(newSalvage) || 0;
    const months = Number(newMonths);

    const { error: insErr } = await supabase.from("fixed_assets" as never).insert({
      asset_code: newCode.trim(),
      name_ar: newName.trim(),
      category: newCategory,
      purchase_date: new Date().toISOString().slice(0, 10),
      purchase_cost: cost,
      salvage_value: salvage,
      useful_life_months: months,
      asset_account_code: newAccount,
      accumulated_depreciation_account_code: "1491",
      depreciation_expense_account_code: "5611",
      status: "DRAFT",
      accumulated_depreciation: 0,
      current_book_value: cost,
    } as never);

    setActing(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    setNewOpen(false);
    setNewCode("");
    setNewName("");
    setNewCost("");
    setNotice("تمت إضافة الأصل الثابت كمسودة بنجاح");
    await loadAssets();
  };

  const handleActivate = async (id: string) => {
    setActing(true);
    setError(null);
    const { error: actErr } = await supabase.rpc(
      "activate_fixed_asset" as never,
      {
        p_asset_id: id,
      } as never,
    );
    setActing(false);
    if (actErr) {
      setError(actErr.message);
      return;
    }
    setNotice("تم تفعيل الأصل الثابت بنجاح");
    await loadAssets();
  };

  const handleRunDepreciation = async () => {
    setActing(true);
    setError(null);
    if (deprAssetId) {
      // إهلاك فردي
      const { error: rpcErr } = await supabase.rpc(
        "run_depreciation" as never,
        {
          p_asset_id: deprAssetId,
          p_date: deprDate,
        } as never,
      );
      if (rpcErr) {
        setError(rpcErr.message);
        setActing(false);
        return;
      }
      setNotice("تم ترحيل قيد الإهلاك بنجاح (Dr 5611 / Cr 1491)");
    } else {
      // إهلاك جماعي
      const { error: rpcErr } = await supabase.rpc(
        "run_batch_depreciation" as never,
        { p_date: deprDate } as never,
      );
      if (rpcErr) {
        setError(rpcErr.message);
        setActing(false);
        return;
      }
      setNotice("تم تشغيل الإهلاك الدوري لجميع الأصول النشطة بنجاح");
    }
    setActing(false);
    setDeprOpen(false);
    await loadAssets();
  };

  const handleDispose = async () => {
    if (!disposeAsset) return;
    setActing(true);
    setError(null);
    const { error: rpcErr } = await supabase.rpc(
      "dispose_fixed_asset" as never,
      {
        p_asset_id: disposeAsset.id,
        p_disposal_date: disposeDate,
        p_proceeds: Number(disposeProceeds) || 0,
        p_proceeds_account: disposeAccount,
      } as never,
    );
    setActing(false);
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    setDisposeOpen(false);
    setNotice("تم استبعاد الأصل وشطب قيمته الدفترية بنجاح");
    await loadAssets();
  };

  const statusBadge = (status: FixedAsset["status"]) => {
    switch (status) {
      case "ACTIVE":
        return <Badge className="bg-green-600">نشط</Badge>;
      case "DRAFT":
        return <Badge variant="secondary">مسودة</Badge>;
      case "FULLY_DEPRECIATED":
        return <Badge className="bg-blue-600">مستهلك بالكامل</Badge>;
      case "DISPOSED":
        return <Badge variant="destructive">مستبعد / مشطوب</Badge>;
    }
  };

  return (
    <div className="container mx-auto p-4 space-y-4">
      <PageHeader
        title={t("nav.fixed_assets") || "سجل الأصول الثابتة"}
        subtitle="إدارة الأصول الرأسمالية، حساب الإهلاك الدوري (Dr 5611 / Cr 1491)، واستبعاد الأصول"
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setDeprAssetId(null);
                setDeprOpen(true);
              }}
            >
              <Play className="ms-2 h-4 w-4" />
              تشغيل الإهلاك الدوري
            </Button>
            <Button onClick={() => setNewOpen(true)}>
              <Plus className="ms-2 h-4 w-4" />
              إضافة أصل جديد
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-md bg-destructive/10 text-destructive p-3 text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="rounded-md bg-green-500/10 text-green-700 p-3 text-sm flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          <span>{notice}</span>
        </div>
      )}

      {/* Summary Deck */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              إجمالي التكلفة التاريخية
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{money(summary.totalCost)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              مجمع الإهلاك المتراكم
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{money(summary.totalDepr)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              صافي القيمة الدفترية
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{money(summary.totalBook)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              الأصول النشطة
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.activeCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Assets Table */}
      <Card>
        <CardHeader>
          <CardTitle>قائمة الأصول الثابتة</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground flex justify-center items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>جارٍ تحميل سجل الأصول...</span>
            </div>
          ) : assets.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              لا توجد أصول ثابتة مسجلة بعد.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>كود الأصل</TableHead>
                    <TableHead>الاسم</TableHead>
                    <TableHead>التصنيف</TableHead>
                    <TableHead>تاريخ الشراء</TableHead>
                    <TableHead>تكلفة الشراء</TableHead>
                    <TableHead>مجمع الإهلاك</TableHead>
                    <TableHead>القيمة الدفترية</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead className="text-end">الإجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assets.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-mono font-medium">{a.asset_code}</TableCell>
                      <TableCell>{a.name_ar}</TableCell>
                      <TableCell>{CATEGORY_LABELS[a.category] || a.category}</TableCell>
                      <TableCell>{a.purchase_date}</TableCell>
                      <TableCell>{money(a.purchase_cost)}</TableCell>
                      <TableCell className="text-amber-600 font-semibold">
                        {money(a.accumulated_depreciation)}
                      </TableCell>
                      <TableCell className="text-green-600 font-semibold">
                        {money(a.current_book_value)}
                      </TableCell>
                      <TableCell>{statusBadge(a.status)}</TableCell>
                      <TableCell className="text-end space-x-1 space-x-reverse">
                        {a.status === "DRAFT" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleActivate(a.id)}
                            disabled={acting}
                          >
                            تفعيل
                          </Button>
                        )}
                        {a.status === "ACTIVE" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setDeprAssetId(a.id);
                                setDeprOpen(true);
                              }}
                              disabled={acting}
                            >
                              <Play className="h-3 w-3 ms-1" />
                              إهلاك
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10"
                              onClick={() => {
                                setDisposeAsset(a);
                                setDisposeProceeds(String(a.current_book_value));
                                setDisposeOpen(true);
                              }}
                              disabled={acting}
                            >
                              <RotateCcw className="h-3 w-3 ms-1" />
                              استبعاد
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog: Add Asset */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إضافة أصل ثابت جديد</DialogTitle>
            <DialogDescription>
              تسجيل أصل رأسمالي وتحديد معايير الإهلاك بالقسط الثابت
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>كود الأصل</Label>
                <Input
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  placeholder="AST-0001"
                />
              </div>
              <div className="space-y-1">
                <Label>تصنيف الأصل</Label>
                <Select
                  value={newCategory}
                  onValueChange={(v) => setNewCategory(v as FixedAsset["category"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MACHINERY">آلات ومعدات</SelectItem>
                    <SelectItem value="VEHICLES">مركبات ونقل</SelectItem>
                    <SelectItem value="EQUIPMENT">أجهزة وأثاث</SelectItem>
                    <SelectItem value="BUILDINGS">مباني</SelectItem>
                    <SelectItem value="OTHER">أخرى</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>اسم الأصل</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="مثال: مطحنة حبوب آلية 50 طن"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>تكلفة الشراء</Label>
                <AmountInput
                  value={newCost === "" ? null : Number(newCost)}
                  onValueChange={(v) => setNewCost(v == null ? "" : String(v))}
                  min={0}
                  showInWords={false}
                />
              </div>
              <div className="space-y-1">
                <Label>قيمة الخردة</Label>
                <AmountInput
                  value={newSalvage === "" ? null : Number(newSalvage)}
                  onValueChange={(v) => setNewSalvage(v == null ? "" : String(v))}
                  min={0}
                  showInWords={false}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1">
                <Label>العمر (شهور)</Label>
                <QuantityInput
                  value={newMonths === "" ? null : Number(newMonths)}
                  onValueChange={(v) => setNewMonths(v == null ? "" : String(v))}
                  decimals={0}
                  min={0}
                  placeholder="60"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>حساب الأصل المحاسبي</Label>
              <Select value={newAccount} onValueChange={setNewAccount}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1411">1411 — آلات ومعدات</SelectItem>
                  <SelectItem value="1421">1421 — مركبات ونقل</SelectItem>
                  <SelectItem value="1431">1431 — أثاث ومعدات مكتبية</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={handleCreateAsset} disabled={acting}>
              {acting && <Loader2 className="ms-2 h-4 w-4 animate-spin" />}
              حفظ الأصل
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Run Depreciation */}
      <Dialog open={deprOpen} onOpenChange={setDeprOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deprAssetId ? "ترحيل إهلاك أصل محدد" : "تشغيل الإهلاك الدوري الشامل"}
            </DialogTitle>
            <DialogDescription>
              سيتم إنشاء قيد محاسبي مزدوج (Dr 5611 مصروف الإهلاك / Cr 1491 مجمع الإهلاك)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>تاريخ الإهلاك</Label>
              <Input type="date" value={deprDate} onChange={(e) => setDeprDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeprOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={handleRunDepreciation} disabled={acting}>
              {acting && <Loader2 className="ms-2 h-4 w-4 animate-spin" />}
              تأكيد وترحيل الإهلاك
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Dispose Asset */}
      <Dialog open={disposeOpen} onOpenChange={setDisposeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>استبعاد وشطب أصل ثابت</DialogTitle>
            <DialogDescription>
              إقفال التكلفة التاريخية ومجمع الإهلاك وإثبات أرباح أو خسائر الشطب
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="text-sm p-3 rounded-lg border bg-muted/40 space-y-1">
              <div>
                الأصل: <strong>{disposeAsset?.name_ar}</strong> ({disposeAsset?.asset_code})
              </div>
              <div>
                القيمة الدفترية الحالية:{" "}
                <strong className="text-green-600">
                  {money(disposeAsset?.current_book_value || 0)}
                </strong>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>تاريخ الاستبعاد</Label>
                <Input
                  type="date"
                  value={disposeDate}
                  onChange={(e) => setDisposeDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>حصيلة البيع إن وجدت</Label>
                <AmountInput
                  value={disposeProceeds === "" ? null : Number(disposeProceeds)}
                  onValueChange={(v) => setDisposeProceeds(v == null ? "" : String(v))}
                  min={0}
                  showInWords={false}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>حساب إيداع الحصيلة</Label>
              <Select value={disposeAccount} onValueChange={setDisposeAccount}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1101">1101 — النقدية بالصندوق</SelectItem>
                  <SelectItem value="1111">1111 — البنك</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisposeOpen(false)}>
              إلغاء
            </Button>
            <Button variant="destructive" onClick={handleDispose} disabled={acting}>
              {acting && <Loader2 className="ms-2 h-4 w-4 animate-spin" />}
              تأكيد الاستبعاد والشطب
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default FixedAssetsPage;
