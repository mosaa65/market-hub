import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  Boxes,
  Copy,
  Database,
  Download,
  GitBranch,
  HardDrive,
  Layers,
  Loader2,
  Play,
  RotateCcw,
  RefreshCw,
  Search,
  Server,
  Square,
  Terminal,
  Trash2,
  Upload,
  Wrench,
  ExternalLink,
  CheckCircle2,
  XCircle,
  History,
  Stethoscope,
  Package,
  Network,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  getHealthReport,
  getDiagnosis,
  getDockerExplorer,
  getSupabaseStatus,
  getMigrations,
  getGitStatus,
  getGitUpdateCheck,
  getContainerLogs,
  getBackups,
  getAuditLog,
  inspectContainerFn,
  containerAction,
  supabaseAction,
  dbAction,
  seedAction,
  migrationAction,
  gitActionFn,
  maintenanceAction,
} from "@/lib/infra/functions";
import { dependencyOrder } from "@/lib/infra/services";
import type {
  HealthReport,
  DiagnosisReport,
  SupabaseStatusReport,
  MigrationStatusReport,
  GitStatusReport,
  GitUpdateCheck,
} from "@/lib/infra/types";
import { OwnerGuard } from "@/components/infra/owner-guard";

export const Route = createFileRoute("/_app/infrastructure")({
  head: () => ({ meta: [{ title: "مدير التطوير والبنية التحتية — Vortex" }] }),
  component: () => (
    <OwnerGuard>
      <InfrastructurePage />
    </OwnerGuard>
  ),
});

// ---------------------------------------------------------------------------
// مساعدات عرض صغيرة
// ---------------------------------------------------------------------------

const REFRESH_MS = 5000;

function StateBadge({ state, health }: { state: string; health: string }) {
  const map: Record<string, { label: string; className: string }> = {
    running: {
      label: "تعمل",
      className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
    },
    healthy: {
      label: "سليمة",
      className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
    },
    unhealthy: { label: "غير سليمة", className: "bg-red-500/15 text-red-600 border-red-500/30" },
    exited: { label: "متوقفة", className: "bg-zinc-500/15 text-zinc-600 border-zinc-500/30" },
    stopped: { label: "متوقفة", className: "bg-zinc-500/15 text-zinc-600 border-zinc-500/30" },
    restarting: {
      label: "إعادة تشغيل",
      className: "bg-amber-500/15 text-amber-600 border-amber-500/30",
    },
    starting: { label: "بدء", className: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
    paused: { label: "موقوفة", className: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
    dead: { label: "ميتة", className: "bg-red-500/15 text-red-600 border-red-500/30" },
    absent: { label: "غير موجودة", className: "bg-zinc-500/15 text-zinc-500 border-zinc-500/30" },
    none: { label: "بلا فحص", className: "bg-zinc-500/10 text-zinc-500 border-zinc-500/20" },
    unknown: { label: "؟", className: "bg-zinc-500/10 text-zinc-500 border-zinc-500/20" },
  };
  const key = health !== "none" && health !== "unknown" ? health : state;
  const v = map[key] ?? map.unknown;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${v.className}`}
    >
      {v.label}
    </span>
  );
}

function uptime(sec: number | null): string {
  if (sec === null) return "—";
  if (sec < 60) return `${sec}ث`;
  if (sec < 3600) return `${Math.round(sec / 60)}د`;
  return `${Math.round(sec / 3600)}س`;
}

function ConfirmDialog({
  open,
  title,
  word,
  description,
  onConfirm,
  onCancel,
  busy,
}: {
  open: boolean;
  title: string;
  word: string;
  description: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const [value, setValue] = useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" /> {title}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{description}</p>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={`اكتب ${word} للتأكيد`}
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            إلغاء
          </Button>
          <Button variant="destructive" disabled={value !== word || busy} onClick={onConfirm}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} تنفيذ
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// الصفحة
// ---------------------------------------------------------------------------

const TABS = [
  { key: "overview", label: "نظرة عامة", icon: Activity },
  { key: "containers", label: "الحاويات", icon: Boxes },
  { key: "explorer", label: "مستكشف Docker", icon: Layers },
  { key: "logs", label: "السجلات", icon: Terminal },
  { key: "database", label: "قاعدة البيانات", icon: Database },
  { key: "supabase", label: "Supabase", icon: Server },
  { key: "migrations", label: "الترحيلات", icon: Upload },
  { key: "diagnosis", label: "التشخيص", icon: Stethoscope },
  { key: "git", label: "Git", icon: GitBranch },
  { key: "updates", label: "التحديثات", icon: Download },
  { key: "maintenance", label: "الصيانة", icon: Wrench },
] as const;

function InfrastructurePage() {
  const [tab, setTab] = useState<string>("overview");
  const qc = useQueryClient();
  const health = useQuery({
    queryKey: ["infra", "health"],
    queryFn: () =>
      getHealthReport() as Promise<{ report: HealthReport; issues: DiagnosisReport["issues"] }>,
    refetchInterval: REFRESH_MS,
  });

  const report = health.data?.report;
  const issues = health.data?.issues ?? [];

  return (
    <div className="space-y-4 p-4 md:p-6" dir="rtl">
      {/* ترويسة */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <HardDrive className="h-6 w-6 text-primary" /> مدير التطوير والبنية التحتية
          </h1>
          <p className="text-sm text-muted-foreground">
            مركز إدارة Docker وSupabase المحلي وGit — تحديث تلقائي كل 5 ثوانٍ.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {issues.filter((i) => i.severity === "critical").length > 0 && (
            <Badge className="bg-red-500/15 text-red-600 border-red-500/30">
              <AlertTriangle className="h-3 w-3 ml-1" />{" "}
              {issues.filter((i) => i.severity === "critical").length} مشكلة حرجة
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => void health.refetch()}>
            <RefreshCw className={`h-4 w-4 ${health.isFetching ? "animate-spin" : ""}`} /> تحديث
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className="gap-1.5">
              <t.icon className="h-4 w-4" /> {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab report={report} issues={issues} onGo={setTab} />
        </TabsContent>
        <TabsContent value="containers">
          <ContainersTab report={report} qc={qc} />
        </TabsContent>
        <TabsContent value="explorer">
          <ExplorerTab />
        </TabsContent>
        <TabsContent value="logs">
          <LogsTab />
        </TabsContent>
        <TabsContent value="database">
          <DatabaseTab qc={qc} />
        </TabsContent>
        <TabsContent value="supabase">
          <SupabaseTab qc={qc} />
        </TabsContent>
        <TabsContent value="migrations">
          <MigrationsTab qc={qc} />
        </TabsContent>
        <TabsContent value="diagnosis">
          <DiagnosisTab />
        </TabsContent>
        <TabsContent value="git">
          <GitTab />
        </TabsContent>
        <TabsContent value="updates">
          <UpdatesTab qc={qc} />
        </TabsContent>
        <TabsContent value="maintenance">
          <MaintenanceTab qc={qc} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// نظرة عامة
// ---------------------------------------------------------------------------

function OverviewTab({
  report,
  issues,
  onGo,
}: {
  report: HealthReport | undefined;
  issues: DiagnosisReport["issues"];
  onGo: (t: string) => void;
}) {
  if (!report) return <LoadingBlock />;
  const r = report.resources;
  const stats = [
    {
      label: "خدمات تعمل",
      value: `${report.summary.running}/${report.summary.total}`,
      ok: report.summary.running === report.summary.total,
    },
    {
      label: "Docker Engine",
      value: report.engine.available ? (report.engine.version ?? "نعم") : "متوقف",
      ok: report.engine.available,
    },
    {
      label: "قاعدة البيانات",
      value: report.dbConnected ? "متصلة" : "غير متصلة",
      ok: report.dbConnected === true,
    },
    { label: "الذاكرة", value: `${r.memUsedPercent}%`, ok: r.memUsedPercent < 85 },
    {
      label: "القرص",
      value: r.diskUsedPercent !== null ? `${r.diskUsedPercent}%` : "—",
      ok: (r.diskUsedPercent ?? 0) < 90,
    },
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label} className="py-3">
            <CardContent className="flex items-center justify-between px-3">
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-lg font-bold">{s.value}</p>
              </div>
              {s.ok ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              ) : (
                <XCircle className="h-5 w-5 text-red-500" />
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* رسم الاعتماد */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">سلسلة الاعتماد — من يمنع من؟</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            {dependencyOrder().map((def, i) => {
              const svc = report.services.find((s) => s.serviceKey === def.key);
              const state =
                def.key === "docker"
                  ? report.engine.available
                    ? "running"
                    : "exited"
                  : (svc?.state ?? "absent");
              return (
                <span key={def.key} className="flex items-center gap-2">
                  {i > 0 && <span className="text-muted-foreground">←</span>}
                  <button
                    className={`rounded-lg border px-2.5 py-1.5 text-xs transition hover:shadow ${
                      state === "running"
                        ? "border-emerald-500/40 bg-emerald-500/10"
                        : "border-zinc-400/40 bg-zinc-500/10"
                    }`}
                    onClick={() => onGo("containers")}
                    title={def.labelEn}
                  >
                    {def.label}
                  </button>
                </span>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            اضغط أي خدمة للانتقال إلى التحكم بالحاويات. الخدمة الرمادية لا تعمل — انظر «التشخيص»
            لمعرفة السبب الجذري.
          </p>
        </CardContent>
      </Card>

      {/* أحدث المشاكل */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Stethoscope className="h-4 w-4" /> ملخص التشخيص الفوري
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {issues.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4" /> كل الخدمات تعمل بشكل سليم.
            </p>
          ) : (
            issues.slice(0, 5).map((i) => (
              <div key={i.id} className="flex items-start gap-2 rounded-lg border p-2 text-sm">
                <AlertTriangle
                  className={`mt-0.5 h-4 w-4 shrink-0 ${i.severity === "critical" ? "text-red-500" : "text-amber-500"}`}
                />
                <div>
                  <p className="font-medium">{i.titleAr}</p>
                  <p className="text-xs text-muted-foreground">{i.causeAr}</p>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// الحاويات
// ---------------------------------------------------------------------------

function ContainersTab({
  report,
  qc,
}: {
  report: HealthReport | undefined;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const act = useMutation({
    mutationFn: (p: { action: "start" | "stop" | "restart" | "recreate"; container: string }) =>
      containerAction({ data: p }),
    onSuccess: (res) => {
      if (res.ok) toast.success("تم التنفيذ بنجاح");
      else toast.error(res.output.slice(0, 300));
      void qc.invalidateQueries({ queryKey: ["infra"] });
    },
    onError: (e) => toast.error(String(e).slice(0, 300)),
  });
  if (!report) return <LoadingBlock />;
  const ordered = [...report.services].sort((a, b) => {
    const rank = (s: typeof a) => (s.state === "running" ? 1 : 0);
    return rank(a) - rank(b);
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between">
          <span>
            حاويات المشروع ({report.services.filter((s) => s.state === "running").length} تعمل)
          </span>
          <span className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                act.mutate({ action: "start", container: "supabase_kong_kwzqvgdyadylwnvjghqn" })
              }
              disabled={act.isPending}
            >
              <Play className="h-3.5 w-3.5" /> تشغيل المجموعة (Supabase start)
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                act.mutate({ action: "stop", container: "supabase_kong_kwzqvgdyadylwnvjghqn" })
              }
              disabled={act.isPending}
            >
              <Square className="h-3.5 w-3.5" /> إيقاف الكل (Supabase stop)
            </Button>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {ordered.map((s) => (
          <ServiceRow key={s.serviceKey} entry={s} act={act} busy={act.isPending} />
        ))}
      </CardContent>
    </Card>
  );
}

function ServiceRow({
  entry,
  act,
  busy,
}: {
  entry: HealthReport["services"][number];
  act: ReturnType<
    typeof useMutation<
      { ok: boolean; output: string; auditId: string },
      Error,
      { action: "start" | "stop" | "restart" | "recreate"; container: string }
    >
  >;
  busy: boolean;
}) {
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text);
    toast.success("تم النسخ");
  };
  const [inspectOpen, setInspectOpen] = useState(false);
  const inspectQ = useQuery({
    queryKey: ["infra", "inspect", entry.containerName],
    queryFn: () => inspectContainerFn({ data: { container: entry.containerName! } }),
    enabled: inspectOpen && Boolean(entry.containerName),
  });
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
        <div className="min-w-40 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{entry.label}</span>
            <StateBadge state={entry.state} health={entry.health} />
            {entry.restartCount ? (
              <Badge variant="outline" className="text-[10px]">
                ↻{entry.restartCount}
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            {entry.containerName}
          </p>
        </div>
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span>⏱ {uptime(entry.uptimeSeconds)}</span>
          <span>CPU {entry.cpuPercent !== null ? `${entry.cpuPercent.toFixed(1)}%` : "—"}</span>
          <span>RAM {entry.memUsedMb !== null ? `${entry.memUsedMb}MB` : "—"}</span>
          {entry.ports.length > 0 && <span>: {entry.ports.slice(0, 2).join(", ")}</span>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || entry.state === "running"}
            onClick={() => act.mutate({ action: "start", container: entry.containerName! })}
          >
            <Play className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || entry.state !== "running"}
            onClick={() => act.mutate({ action: "stop", container: entry.containerName! })}
          >
            <Square className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || entry.state !== "running"}
            onClick={() => act.mutate({ action: "restart", container: entry.containerName! })}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => act.mutate({ action: "recreate", container: entry.containerName! })}
          >
            <Package className="h-3.5 w-3.5" /> Recreate
          </Button>
          <Button size="sm" variant="ghost" onClick={() => copy(entry.containerName ?? "")}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setInspectOpen(true)}
            title="Inspect (تفاصيل JSON)"
          >
            <Terminal className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <Dialog open={inspectOpen} onOpenChange={setInspectOpen}>
        <DialogContent className="max-w-3xl" dir="ltr">
          <DialogHeader>
            <DialogTitle dir="rtl">Inspect — {entry.label}</DialogTitle>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded-lg bg-zinc-950 p-3 font-mono text-[10px] leading-4 text-zinc-200">
            {inspectQ.isFetching ? "جارِ الفحص..." : (inspectQ.data ?? "لا بيانات")}
          </pre>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// مستكشف Docker
// ---------------------------------------------------------------------------

function ExplorerTab() {
  const q = useQuery({
    queryKey: ["infra", "explorer"],
    queryFn: getDockerExplorer,
    refetchInterval: REFRESH_MS * 4,
  });
  const [sub, setSub] = useState<"images" | "volumes" | "networks">("images");
  if (q.isLoading) return <LoadingBlock />;
  const data = q.data;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">مستكشف Docker</CardTitle>
        <div className="flex gap-1">
          {(["images", "volumes", "networks"] as const).map((k) => (
            <Button
              key={k}
              size="sm"
              variant={sub === k ? "default" : "outline"}
              onClick={() => setSub(k)}
            >
              {k === "images" ? "الصور" : k === "volumes" ? "الأقراص" : "الشبكات"} (
              {data
                ? k === "images"
                  ? data.images.length
                  : k === "volumes"
                    ? data.volumes.length
                    : data.networks.length
                : 0}
              )
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <div className="max-h-[500px] overflow-auto rounded-lg border">
          <table className="w-full text-right text-xs">
            <thead className="sticky top-0 bg-muted">
              {sub === "images" ? (
                <tr>
                  <th className="p-2">الصورة</th>
                  <th>الوسم</th>
                  <th>الحجم</th>
                  <th>أُنشئت</th>
                </tr>
              ) : sub === "volumes" ? (
                <tr>
                  <th className="p-2">الاسم</th>
                  <th>المشغّل</th>
                  <th>الحجم</th>
                </tr>
              ) : (
                <tr>
                  <th className="p-2">الاسم</th>
                  <th>المشغّل</th>
                  <th>النطاق</th>
                  <th>داخلية</th>
                </tr>
              )}
            </thead>
            <tbody>
              {sub === "images" &&
                (data?.images ?? []).map((i) => (
                  <tr key={i.id} className={`border-t ${i.dangling ? "opacity-60" : ""}`}>
                    <td className="p-2 font-mono">{i.repository}</td>
                    <td>{i.tag}</td>
                    <td>{i.sizeMb} MB</td>
                    <td>{i.createdSince}</td>
                  </tr>
                ))}
              {sub === "volumes" &&
                (data?.volumes ?? []).map((v) => (
                  <tr key={v.name} className="border-t">
                    <td className="p-2 font-mono">{v.name}</td>
                    <td>{v.driver}</td>
                    <td>{v.size ?? "—"}</td>
                  </tr>
                ))}
              {sub === "networks" &&
                (data?.networks ?? []).map((n) => (
                  <tr key={n.name} className="border-t">
                    <td className="p-2 font-mono">{n.name}</td>
                    <td>{n.driver}</td>
                    <td>{n.scope}</td>
                    <td>{n.internal ? "نعم" : "لا"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// السجلات
// ---------------------------------------------------------------------------

function LogsTab() {
  const q = useQuery({ queryKey: ["infra", "health"] });
  const report = (q.data as { report: HealthReport } | undefined)?.report;
  const [sel, setSel] = useState<string>("");
  const [search, setSearch] = useState("");
  const container = sel || report?.services.find((s) => s.state === "running")?.containerName || "";
  const logs = useQuery({
    queryKey: ["infra", "logs", container],
    queryFn: () => getContainerLogs({ data: { container, tail: 500 } }),
    refetchInterval: 3000,
    enabled: Boolean(container),
  });
  const lines = (logs.data ?? "").split(/\r?\n/);
  const filtered = search
    ? lines.filter((l) => l.toLowerCase().includes(search.toLowerCase()))
    : lines;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={container}
          onChange={(e) => setSel(e.target.value)}
        >
          {report?.services.map((s) => (
            <option key={s.serviceKey} value={s.containerName ?? ""}>
              {s.label}
            </option>
          ))}
        </select>
        <div className="relative flex-1 min-w-60">
          <Search className="absolute right-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث في السجلات..."
            className="pr-8"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void navigator.clipboard.writeText(logs.data ?? "")}
        >
          <Copy className="h-3.5 w-3.5" /> نسخ
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const blob = new Blob([logs.data ?? ""], { type: "text/plain" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `${container}.log`;
            a.click();
          }}
        >
          <Download className="h-3.5 w-3.5" /> تنزيل
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setSearch("")}>
          <Trash2 className="h-3.5 w-3.5" /> مسح العرض
        </Button>
        <span className="text-xs text-muted-foreground">
          تحديث مباشر كل 3ث — {filtered.length} سطر
        </span>
      </div>
      <ScrollArea className="h-[480px] rounded-lg border bg-zinc-950 p-3">
        <pre className="font-mono text-[11px] leading-4 text-zinc-200" dir="ltr">
          {filtered.slice(-800).map((l, i) => (
            <div
              key={i}
              className={
                /error|fatal|panic/i.test(l)
                  ? "text-red-400"
                  : /warn/i.test(l)
                    ? "text-amber-300"
                    : ""
              }
            >
              {l || " "}
            </div>
          ))}
        </pre>
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// قاعدة البيانات
// ---------------------------------------------------------------------------

function DatabaseTab({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const backups = useQuery({
    queryKey: ["infra", "backups"],
    queryFn: getBackups,
    refetchInterval: REFRESH_MS * 4,
  });
  const act = useMutation({
    mutationFn: (p: {
      action: "backup" | "restore" | "exportDump" | "reset" | "deleteBackup";
      file?: string;
      confirm?: string;
    }) => dbAction({ data: p }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(res.output.slice(0, 200));
      } else {
        toast.error(res.output.slice(0, 300));
      }
      void qc.invalidateQueries({ queryKey: ["infra", "backups"] });
    },
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">عمليات قاعدة البيانات المحلية</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => act.mutate({ action: "backup" })}
            disabled={act.isPending}
          >
            <Download className="h-3.5 w-3.5" /> نسخة احتياطية
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => act.mutate({ action: "exportDump" })}
            disabled={act.isPending}
          >
            <Upload className="h-3.5 w-3.5" /> تصدير Dump
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href="http://127.0.0.1:54323" target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" /> فتح Studio
            </a>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard.writeText(
                "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
              );
              toast.success("نُسخ رابط الاتصال — الصقه في TablePlus / pgAdmin / DBeaver");
            }}
            title="نسخ Connection String لـ TablePlus أو pgAdmin"
          >
            <Copy className="h-3.5 w-3.5" /> Connection String (TablePlus/pgAdmin)
          </Button>
          <Button size="sm" variant="ghost" asChild title="بريد التطوير المحلي">
            <a href="http://127.0.0.1:54324" target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" /> Inbucket (البريد)
            </a>
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setConfirmOpen(true)}>
            <Trash2 className="h-3.5 w-3.5" /> Reset كامل
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            النسخ الاحتياطية ({backups.data?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 max-h-72 overflow-auto">
          {(backups.data ?? []).map((b) => (
            <div
              key={b.name}
              className="flex items-center justify-between rounded-lg border p-2 text-sm"
            >
              <div>
                <p className="font-mono text-xs">{b.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {b.sizeKb} KB — {new Date(b.modified).toLocaleString("ar")}
                </p>
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={act.isPending}
                  onClick={() => act.mutate({ action: "restore", file: b.name })}
                >
                  استعادة
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => act.mutate({ action: "deleteBackup", file: b.name })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
          {(backups.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              لا توجد نسخ بعد — أنشئ أول نسخة احتياطية.
            </p>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="إعادة بناء قاعدة البيانات المحلية"
        word="RESET"
        description="سيتم إيقاف كل حاويات Supabase المحلية وإعادة بنائها من الترحيلات. بيانات قاعدة البيانات المحلية ستُفقد (لن يتأثر المشروع السحابي أبداً)."
        busy={act.isPending}
        onConfirm={() => {
          act.mutate({ action: "reset", confirm: "RESET LOCAL kwzqvgdyadylwnvjghqn" });
          setConfirmOpen(false);
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

function SupabaseTab({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const q = useQuery({
    queryKey: ["infra", "supabase"],
    queryFn: getSupabaseStatus,
    refetchInterval: REFRESH_MS,
  });
  const act = useMutation({
    mutationFn: (p: { action: "start" | "stop" }) => supabaseAction({ data: p }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("تم التنفيذ");
      } else {
        toast.error(res.output.slice(0, 300));
      }
      void qc.invalidateQueries({ queryKey: ["infra"] });
    },
  });
  if (q.isLoading) return <LoadingBlock />;
  const s = q.data as SupabaseStatusReport | undefined;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            الوضع المحلي
            <Badge variant={s?.local.running ? "default" : "secondary"}>
              {s?.local.running ? "تعمل المجموعة" : "متوقفة"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {s?.local.stoppedServices.length ? (
            <p className="text-sm text-amber-600 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> خدمات متوقفة:{" "}
              {s.local.stoppedServices.join(", ")}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => act.mutate({ action: "start" })}
              disabled={act.isPending}
            >
              <Play className="h-3.5 w-3.5" /> supabase start
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => act.mutate({ action: "stop" })}
              disabled={act.isPending}
            >
              <Square className="h-3.5 w-3.5" /> supabase stop
            </Button>
          </div>
          <div className="grid gap-1 text-xs">
            {Object.entries(s?.local.urls ?? {}).map(([k, v]) => (
              <div key={k} className="flex justify-between rounded border px-2 py-1">
                <span className="font-mono text-muted-foreground">{k}</span>
                <a
                  href={v}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-primary hover:underline"
                  dir="ltr"
                >
                  {v}
                </a>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">الارتباط بالسحابة (Cloud)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {s?.cloud.linked ? (
            <>
              <p className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> مرتبط بمشروع{" "}
                <span className="font-mono">{s.cloud.projectRef}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                في وضع السحابة تُعرض المعلومات الرسمية فقط (حالة الارتباط وبيانات المشروع) — لا
                تُدار الخدمات السحابية من هنا لأنها خارج نطاق Docker المحلي. استخدم تبويب
                «الترحيلات» للدفع/السحب عبر Supabase CLI.
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">
              لا يوجد ربط بمشروع سحابي (supabase/.temp/project-ref غير موجود).
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// الترحيلات
// ---------------------------------------------------------------------------

function MigrationsTab({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const q = useQuery({
    queryKey: ["infra", "migrations"],
    queryFn: getMigrations,
    refetchInterval: REFRESH_MS * 3,
  });
  const act = useMutation({
    mutationFn: (p: { action: "list" | "repair" | "diff" | "push" | "pull"; confirm?: string }) =>
      migrationAction({ data: p }),
    onSuccess: (res) => {
      if (res.ok) toast.success("تم — راجع المخرجات في السجل تحت");
      else toast.error(res.output.slice(0, 300));
      void qc.invalidateQueries({ queryKey: ["infra", "migrations"] });
    },
  });
  const [out, setOut] = useState("");
  const run = (p: { action: "list" | "repair" | "diff" | "push" | "pull"; confirm?: string }) =>
    act.mutate(p, { onSuccess: (res) => setOut(res.output) });
  if (q.isLoading) return <LoadingBlock />;
  const m = q.data as MigrationStatusReport | undefined;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">حالة الترحيلات</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-3 text-sm">
            <Badge variant="outline" className="text-amber-600">
              معلقة محلياً: {m?.pending ?? "—"}
            </Badge>
            <Badge variant="outline" className="text-blue-600">
              مطبقة سحابياً فقط: {m?.appliedRemoteOnly ?? "—"}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => run({ action: "list" })}>
              <RefreshCw className="h-3.5 w-3.5" /> تحديث القائمة
            </Button>
            <Button size="sm" variant="outline" onClick={() => run({ action: "diff" })}>
              <History className="h-3.5 w-3.5" /> Diff (مقارنة المخطط)
            </Button>
            <Button size="sm" variant="secondary" onClick={() => run({ action: "pull" })}>
              <Download className="h-3.5 w-3.5" /> Pull من السحابة
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                const c = window.prompt("سيطبق الترحيلات على قاعدة السحابة. اكتب PUSH للتأكيد:");
                if (c) run({ action: "push", confirm: c });
              }}
            >
              <Upload className="h-3.5 w-3.5" /> Push إلى السحابة (خطر)
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Seeds ({m?.seedFiles.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="max-h-60 space-y-1.5 overflow-auto">
          {(m?.seedFiles ?? []).map((f) => (
            <div
              key={f.path}
              className="flex items-center justify-between rounded border px-2 py-1.5 text-xs"
            >
              <span className="font-mono" dir="ltr">
                {f.path}
              </span>
              <span className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">
                  {f.kind}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[11px]"
                  disabled={act.isPending}
                  onClick={() =>
                    seedAction({ data: { file: f.path } }).then((r) => {
                      if (r.ok) {
                        toast.success("تم تنفيذ الملف");
                      } else {
                        toast.error(r.output.slice(0, 200));
                      }
                    })
                  }
                >
                  تشغيل
                </Button>
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
      {out && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">مخرجات آخر عملية</CardTitle>
          </CardHeader>
          <CardContent>
            <pre
              className="max-h-64 overflow-auto rounded-lg bg-zinc-950 p-3 font-mono text-[11px] text-zinc-200"
              dir="ltr"
            >
              {out}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// التشخيص
// ---------------------------------------------------------------------------

function DiagnosisTab() {
  const q = useQuery({
    queryKey: ["infra", "diagnosis"],
    queryFn: getDiagnosis,
    refetchInterval: REFRESH_MS * 2,
  });
  const qc = useQueryClient();
  const act = useMutation({
    mutationFn: (p: { action: "start" | "stop" | "restart" | "recreate"; container: string }) =>
      containerAction({ data: p }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("تم الإصلاح");
      } else {
        toast.error(res.output.slice(0, 300));
      }
      void qc.invalidateQueries({ queryKey: ["infra"] });
    },
  });
  if (q.isLoading) return <LoadingBlock />;
  const d = q.data as DiagnosisReport | undefined;
  return (
    <div className="space-y-3">
      {(d?.issues ?? []).map((i) => (
        <Card
          key={i.id}
          className={`border-r-4 ${i.severity === "critical" ? "border-r-red-500" : i.severity === "warning" ? "border-r-amber-500" : "border-r-blue-500"}`}
        >
          <CardContent className="space-y-2 pt-4">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold">{i.titleAr}</p>
              <Badge variant={i.severity === "critical" ? "destructive" : "outline"}>
                {i.severity}
              </Badge>
            </div>
            <p className="text-sm">{i.detailAr}</p>
            <p className="rounded-md bg-muted p-2 text-xs">
              <strong>السبب المرجّح:</strong> {i.causeAr}
            </p>
            {i.fix.action && (
              <Button
                size="sm"
                onClick={() => {
                  if (i.fix.action === "container.restart")
                    act.mutate({ action: "restart", container: i.fix.args?.container ?? "" });
                  else if (i.fix.action === "supabase.start")
                    act.mutate({
                      action: "start",
                      container: "supabase_kong_kwzqvgdyadylwnvjghqn",
                    });
                }}
                disabled={act.isPending}
              >
                <Wrench className="h-3.5 w-3.5" /> إصلاح تلقائي
              </Button>
            )}
            {i.fix.manualStepsAr && (
              <ul className="list-inside list-disc text-xs text-muted-foreground">
                {i.fix.manualStepsAr.map((s, idx) => (
                  <li key={idx}>{s}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}
      {d && d.issues.length === 0 && (
        <Card>
          <CardContent className="pt-4 text-sm text-emerald-600 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" /> لا توجد مشاكل — كل شيء سليم.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

function GitTab() {
  const q = useQuery({
    queryKey: ["infra", "git"],
    queryFn: getGitStatus,
    refetchInterval: REFRESH_MS * 2,
  });
  const qc = useQueryClient();
  const act = useMutation({
    mutationFn: (p: { action: string; branch?: string }) => gitActionFn({ data: p }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("تم");
      } else {
        toast.error(res.output.slice(0, 300));
      }
      void qc.invalidateQueries({ queryKey: ["infra", "git"] });
    },
  });
  if (q.isLoading) return <LoadingBlock />;
  const g = q.data as GitStatusReport | undefined;
  const run = (action: string, branch?: string) => act.mutate({ action, branch });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <GitBranch className="h-4 w-4" /> {g?.currentBranch ?? "—"}
            </span>
            {g && (g.ahead > 0 || g.behind > 0) && (
              <Badge
                variant="outline"
                className={g.behind > 0 ? "text-amber-600" : "text-blue-600"}
              >
                {g.behind > 0 ? `${g.behind} خلف الأصل` : ""}
                {g.ahead > 0 ? ` ${g.ahead} غير مرفوعة` : ""}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Remote:{" "}
            <span className="font-mono" dir="ltr">
              {g?.upstream ?? "—"}
            </span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => run("fetch")}
              disabled={act.isPending}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Fetch
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => run("pull")}
              disabled={act.isPending}
            >
              <Download className="h-3.5 w-3.5" /> Pull
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => run("push")}
              disabled={act.isPending}
            >
              <Upload className="h-3.5 w-3.5" /> Push
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => run("stash")}
              disabled={act.isPending}
            >
              Stash
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => run("stashPop")}
              disabled={act.isPending}
            >
              Pop Stash
            </Button>
          </div>
          {g?.stashes.length ? (
            <p className="text-xs text-muted-foreground">Stashes: {g.stashes.length}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">حالة الملفات ({g?.files.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="max-h-72 space-y-1 overflow-auto text-xs font-mono" dir="ltr">
          {(g?.files ?? []).slice(0, 60).map((f, i) => (
            <div key={i} className="flex gap-2">
              <span
                className={
                  f.code === "?"
                    ? "text-blue-500"
                    : f.code === "D"
                      ? "text-red-500"
                      : "text-amber-500"
                }
              >
                {f.code}
              </span>
              <span>{f.path}</span>
            </div>
          ))}
          {(g?.files ?? []).length === 0 && (
            <p className="text-muted-foreground" dir="rtl">
              لا تغييرات محلية.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">الفروع ({g?.branches.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="max-h-64 space-y-1.5 overflow-auto">
          {(g?.branches ?? []).map((b) => (
            <div
              key={b.name}
              className="flex items-center justify-between rounded border px-2 py-1.5 text-sm"
            >
              <span className="flex items-center gap-2 font-mono text-xs" dir="ltr">
                {b.current && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />} {b.name}
                {b.ahead > 0 || b.behind > 0 ? (
                  <span className="text-muted-foreground">
                    ↑{b.ahead} ↓{b.behind}
                  </span>
                ) : null}
              </span>
              {!b.current && (
                <span className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[11px]"
                    onClick={() => run("checkout", b.name)}
                    disabled={act.isPending}
                  >
                    Switch
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[11px]"
                    onClick={() => run("merge", b.name)}
                    disabled={act.isPending}
                  >
                    Merge
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[11px]"
                    onClick={() => run("deleteBranch", b.name)}
                    disabled={act.isPending}
                  >
                    حذف
                  </Button>
                </span>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            آخر Commits
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const b = window.prompt("اسم الفرع الجديد:");
                if (b) run("createBranch", b);
              }}
            >
              فرع جديد
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="max-h-64 space-y-2 overflow-auto text-xs" dir="ltr">
          {(g?.lastCommits ?? []).map((c) => (
            <div key={c.hash} className="rounded border px-2 py-1.5">
              <p className="font-mono text-primary">
                {c.shortHash} — {c.author}
              </p>
              <p className="truncate text-muted-foreground">{c.subject}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// التحديثات
// ---------------------------------------------------------------------------

function UpdatesTab({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const q = useQuery({
    queryKey: ["infra", "updates"],
    queryFn: getGitUpdateCheck,
    refetchInterval: REFRESH_MS * 3,
  });
  const act = useMutation({
    mutationFn: (p: { action: string }) => gitActionFn({ data: p }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("تم");
      } else {
        toast.error(res.output.slice(0, 400));
      }
      void qc.invalidateQueries({ queryKey: ["infra"] });
    },
  });
  if (q.isLoading) return <LoadingBlock />;
  const u = q.data as GitUpdateCheck | undefined;
  const hasUpdate = (u?.incomingCommits ?? 0) > 0;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">مركز التحديثات</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {u?.available ? (
            <>
              <p className="flex items-center gap-2 text-sm">
                {hasUpdate ? (
                  <>
                    <AlertTriangle className="h-4 w-4 text-amber-500" /> يوجد{" "}
                    <strong>{u.incomingCommits}</strong> Commit جديد على GitHub في الفرع{" "}
                    <span className="font-mono">{u.currentBranch}</span>.
                  </>
                ) : u.outgoingCommits > 0 ? (
                  <>
                    <Upload className="h-4 w-4 text-blue-500" /> محدّث — ولديك {u.outgoingCommits}{" "}
                    Commit محلي غير مرفوع.
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" /> محدّث تماماً مع الأصل.
                  </>
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => act.mutate({ action: "fetch" })}
                  disabled={act.isPending}
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Fetch
                </Button>
                <Button
                  size="sm"
                  disabled={!hasUpdate || act.isPending}
                  onClick={() => act.mutate({ action: "pull" })}
                >
                  <Download className="h-3.5 w-3.5" /> تنزيل التحديث (Pull)
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!hasUpdate || act.isPending}
                  onClick={() => act.mutate({ action: "sync" })}
                >
                  Sync (rebase آمن)
                </Button>
              </div>
              {u.affectedFiles.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium">الملفات المتأثرة:</p>
                  <div className="max-h-40 space-y-1 overflow-auto font-mono text-[11px]" dir="ltr">
                    {u.affectedFiles.map((f) => (
                      <div key={f.path} className="flex justify-between rounded border px-2 py-0.5">
                        <span>{f.path}</span>
                        <span className="text-muted-foreground">{f.changes}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{u?.error ?? "غير متاح"}</p>
          )}
        </CardContent>
      </Card>
      {u && u.incoming.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ما الجديد؟ ({u.incoming.length})</CardTitle>
          </CardHeader>
          <CardContent className="max-h-52 space-y-2 overflow-auto text-xs" dir="ltr">
            {u.incoming.map((c) => (
              <div key={c.hash} className="rounded border px-2 py-1.5">
                <p className="font-mono text-primary">
                  {c.shortHash} — {c.author}
                </p>
                <p className="text-muted-foreground">{c.subject}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// الصيانة
// ---------------------------------------------------------------------------

const MAINT_OPS = [
  { op: "restartAll", label: "إعادة تشغيل كل الخدمات", icon: RotateCcw, danger: false },
  { op: "removeDangling", label: "إزالة الصور المعلقة", icon: Trash2, danger: false },
  {
    op: "pruneImages",
    label: "تنظيف كل الصور (Prune Images)",
    icon: HardDrive,
    danger: true,
    word: "PRUNE IMAGES",
  },
  {
    op: "pruneContainers",
    label: "تنظيف الحاويات المتوقفة",
    icon: Boxes,
    danger: true,
    word: "PRUNE CONTAINERS",
  },
  { op: "pruneNetworks", label: "تنظيف الشبكات", icon: Network, danger: false },
  {
    op: "pruneVolumes",
    label: "تنظيف الأقراص (يحذف البيانات!)",
    icon: Database,
    danger: true,
    word: "PRUNE VOLUMES",
  },
] as const;

function MaintenanceTab({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const act = useMutation({
    mutationFn: (p: { op: string; confirm?: string }) => maintenanceAction({ data: p as any }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("تمت العملية");
      } else {
        toast.error(res.output.slice(0, 300));
      }
      void qc.invalidateQueries({ queryKey: ["infra"] });
    },
  });
  const audit = useQuery({
    queryKey: ["infra", "audit"],
    queryFn: getAuditLog,
    refetchInterval: REFRESH_MS * 5,
  });
  const [pending, setPending] = useState<{ op: string; word: string } | null>(null);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">عمليات الصيانة</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {MAINT_OPS.map((m) => (
            <Button
              key={m.op}
              size="sm"
              variant={m.danger ? "destructive" : "outline"}
              disabled={act.isPending}
              onClick={() => {
                if (m.danger) setPending({ op: m.op, word: "word" in m ? m.word : "" });
                else act.mutate({ op: m.op });
              }}
            >
              <m.icon className="h-3.5 w-3.5" /> {m.label}
            </Button>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4" /> سجل التدقيق (Audit Log)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <pre
            className="max-h-72 overflow-auto rounded-lg bg-zinc-950 p-3 font-mono text-[10px] leading-4 text-zinc-300"
            dir="ltr"
          >
            {(audit.data ?? "لا عمليات مسجلة بعد.").split("\n").reverse().slice(0, 60).join("\n")}
          </pre>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={Boolean(pending)}
        title="عملية خطر"
        word={pending?.word ?? ""}
        description="هذه العملية تحذف بيانات Docker بشكل نهائي ولا يمكن التراجع عنها. تأكد أن لديك نسخة احتياطية عند الحاجة."
        busy={act.isPending}
        onConfirm={() => {
          if (pending) act.mutate({ op: pending.op, confirm: pending.word });
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// عام
// ---------------------------------------------------------------------------

function LoadingBlock() {
  return (
    <div className="flex h-48 items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" /> جارِ جمع حالة البنية التحتية...
    </div>
  );
}
