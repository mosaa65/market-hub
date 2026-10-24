/**
 * جامع تقرير الصحة الكامل: Docker Engine + كل خدمات Supabase + موارد النظام
 * + فحوص HTTP + الاتصال بقاعدة البيانات. ثم محرك التشخيص فوقه.
 */
import os from "node:os";
import { statfs } from "node:fs/promises";
import { docker, resolveTools } from "./tools";
import { SERVICES, containerName, serviceDef, toEntry } from "./services";
import { listContainers, dockerVersion, composeVersion } from "./docker";
import type { DiagnosisIssue, DiagnosisReport, HealthReport, ServiceHealthEntry } from "./types";

async function probeHttp(
  url: string,
): Promise<{ ok: boolean; status: number | null; ms: number | null }> {
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return { ok: res.status < 500, status: res.status, ms: Date.now() - started };
  } catch {
    return { ok: false, status: null, ms: Date.now() - started };
  }
}

async function systemResources(): Promise<HealthReport["resources"]> {
  const cpus = os.cpus();
  let diskTotal = 0;
  let diskFree = 0;
  try {
    const s = await statfs(process.cwd());
    diskTotal = (Number(s.blocks) * Number(s.bsize)) / 1073741824;
    diskFree = (Number(s.bfree) * Number(s.bsize)) / 1073741824;
  } catch {
    /* غير متاح */
  }
  return {
    cpuModel: cpus[0]?.model ?? "unknown",
    cpuCores: cpus.length,
    cpuLoadPercent: null,
    memTotalMb: Math.round(os.totalmem() / 1048576),
    memFreeMb: Math.round(os.freemem() / 1048576),
    memUsedPercent: Math.round((1 - os.freemem() / os.totalmem()) * 100),
    diskTotalGb: diskTotal > 0 ? Math.round(diskTotal) : null,
    diskFreeGb: diskFree > 0 ? Math.round(diskFree) : null,
    diskUsedPercent: diskTotal > 0 ? Math.round((1 - diskFree / diskTotal) * 100) : null,
    platform: os.platform(),
    hostname: os.hostname(),
    nodeVersion: process.version,
  };
}

export async function buildHealthReport(): Promise<HealthReport> {
  const tools = await resolveTools();
  const engineOk = tools.docker
    ? await docker(["info", "--format", "{{.ServerVersion}}"], { timeoutMs: 15_000 }).then(
        (r) => r.ok,
      )
    : false;
  const engine: HealthReport["engine"] = {
    available: engineOk,
    version: engineOk ? await dockerVersion() : null,
    composeVersion: engineOk ? await composeVersion() : null,
    error: engineOk ? null : "Docker Engine غير متاح. تأكد من تشغيل Docker Desktop.",
  };

  const containers = engineOk ? await listContainers() : [];
  const byName = new Map(containers.map((c) => [c.name, c]));

  const services: ServiceHealthEntry[] = [];
  for (const def of SERVICES) {
    if (def.key === "docker") continue;
    const cName = containerName(def.service);
    const c = byName.get(cName);
    const entry = toEntry(def);
    entry.containerName = cName;
    if (c) {
      entry.state = c.state;
      entry.health = c.health;
      entry.uptimeSeconds = c.startedAt
        ? Math.round((Date.now() - new Date(c.startedAt).getTime()) / 1000)
        : null;
      entry.restartCount = c.restartCount;
      entry.image = c.image;
      entry.ports = [...entry.ports, ...c.ports];
      entry.cpuPercent = c.cpuPercent;
      entry.memUsedMb = c.memUsedMb;
      entry.memLimitMb = c.memLimitMb;
    } else {
      entry.state = "absent";
    }
    services.push(entry);
  }

  // فحوص HTTP للخدمات التي تحدد نقاط probe.
  await Promise.all(
    services.map(async (s) => {
      const def = serviceDef(s.serviceKey);
      if (!def?.httpProbe || s.state !== "running") return;
      const probe = await probeHttp(def.httpProbe);
      s.httpProbe = { url: def.httpProbe, ...probe };
      if (!probe.ok) s.health = "unhealthy";
    }),
  );

  // الاتصال بقاعدة البيانات عبر pg_isready داخل الحاوية.
  let dbConnected: boolean | null = null;
  const dbEntry = services.find((s) => s.serviceKey === "db");
  if (dbEntry && dbEntry.state === "running") {
    const res = await docker(
      ["exec", containerName("db"), "pg_isready", "-U", "postgres", "-d", "postgres"],
      { timeoutMs: 15_000 },
    );
    dbConnected = res.ok;
  } else {
    dbConnected = false;
  }

  const dockerDisk: HealthReport["dockerDisk"] = [];
  if (engineOk) {
    const dfRes = await docker(["system", "df", "--format", "{{json .}}"], { maxLines: 100 });
    for (const line of dfRes.output.split(/\r?\n/)) {
      try {
        const j = JSON.parse(line.trim()) as Record<string, string>;
        dockerDisk.push({
          type: j.Type ?? "",
          size: j.Size ?? "",
          reclaimable: j.Reclaimable ?? "",
          count: parseInt(j.Count ?? "0", 10),
        });
      } catch {
        /* تجاهل */
      }
    }
  }

  const ports: HealthReport["ports"] = [];
  for (const c of containers) {
    for (const p of c.ports) {
      const m = p.match(/0\.0\.0\.0:(\d+)/);
      if (m) ports.push({ port: parseInt(m[1], 10), container: c.name, host: m[1] });
    }
  }

  const running = services.filter((s) => s.state === "running").length;
  const stopped = services.filter((s) => s.state !== "running" && s.state !== "absent").length;
  const unhealthy = services.filter((s) => s.health === "unhealthy").length;

  return {
    generatedAt: new Date().toISOString(),
    engine,
    tools,
    services,
    resources: await systemResources(),
    dockerDisk,
    ports,
    dbConnected,
    summary: { running, stopped, unhealthy, total: services.length + 1 },
  };
}

// ---------------------------------------------------------------------------
// محرك التشخيص
// ---------------------------------------------------------------------------

function fmtUptime(sec: number | null): string {
  if (sec === null) return "غير معروف";
  if (sec < 60) return `${sec} ثانية`;
  if (sec < 3600) return `${Math.round(sec / 60)} دقيقة`;
  return `${Math.round(sec / 3600)} ساعة`;
}

export function diagnose(report: HealthReport, supabaseStopped: string[]): DiagnosisReport {
  const issues: DiagnosisIssue[] = [];

  if (!report.engine.available) {
    issues.push({
      id: "engine.down",
      severity: "critical",
      titleAr: "محرك Docker غير متاح",
      detailAr: "لا يمكن الوصول إلى Docker Engine — كل الخدمات المحلية متوقفة عنده.",
      causeAr: "Docker Desktop غير مشغّل أو لم يكتمل إقلاعه بعد إعادة تشغيل الجهاز.",
      sourceService: "docker",
      fix: {
        action: null,
        manualStepsAr: [
          "شغّل Docker Desktop يدوياً وانتظر ظهور أيقونة الحالة الخضراء.",
          "بعد جاهزية المحرك ارجع لهذه اللوحة واضغط «تشغيل Supabase» لتشغيل كل الخدمات.",
        ],
      },
    });
  }

  for (const s of report.services) {
    const isCritical = serviceDef(s.serviceKey)?.critical ?? false;
    if (s.state === "absent") continue;
    if (s.state !== "running") {
      const blockers = s.dependsOn
        .map((k) => report.services.find((x) => x.serviceKey === k))
        .filter((x) => x && x.state !== "running") as ServiceHealthEntry[];
      const cause = blockers.length
        ? `السبب الجذري المرجّح: ${blockers.map((b) => b.label).join(" و ")} غير مشغّلة — هذه الخدمة تعتمد عليها.`
        : isCritical
          ? "توقفت بعد إعادة تشغيل الجهاز أو تعطّلت داخلياً دون مانع خارجي."
          : "توقفت — تُشغَّل مع المجموعة عند الحاجة، ونقصها لا يعطّل واجهة المشروع بالضرورة.";
      issues.push({
        id: `service.${s.serviceKey}.down`,
        severity: isCritical ? "critical" : "warning",
        titleAr: `${s.label} متوقفة`,
        detailAr: `الحالة: ${s.state}${s.health === "unhealthy" ? " — غير سليمة" : ""}. الحاوية: ${s.containerName}.`,
        causeAr: cause,
        sourceService: s.serviceKey,
        fix: {
          action: blockers.length ? null : "supabase.start",
          manualStepsAr: blockers.length
            ? [`شغّل ${blockers.map((b) => b.label).join(" و ")} أولاً ثم أعد تشغيل هذه الخدمة.`]
            : undefined,
        },
      });
    } else if (s.health === "unhealthy" || s.httpProbe?.ok === false) {
      issues.push({
        id: `service.${s.serviceKey}.unhealthy`,
        severity: "warning",
        titleAr: `${s.label} مشغّلة لكنها غير مستجيبة`,
        detailAr: `تعمل منذ ${fmtUptime(s.uptimeSeconds)} لكن الفحص${s.httpProbe ? ` (${s.httpProbe.url})` : ""} غير ناجح.`,
        causeAr:
          s.httpProbe?.status === 502 || s.httpProbe?.status === 503
            ? "البوابة (Kong) تستجيب بخطأ 502/503 — إحدى الخدمات خلفها غير جاهزة بعد أو تعطلت."
            : "العملية تعمل لكن التطبيق الداخلي غير مستجيب (بدء طويل أو تعطل).",
        sourceService: s.serviceKey,
        fix: { action: "container.restart", args: { container: s.containerName ?? "" } },
      });
    } else if (s.restartCount !== null && s.restartCount > 3) {
      issues.push({
        id: `service.${s.serviceKey}.restarts`,
        severity: "info",
        titleAr: `${s.label}: ${s.restartCount} إعادة تشغيل`,
        detailAr: "عدد كبير من إعادة التشغيل يوحي بمشكلة متكررة داخل الحاوية.",
        causeAr: "تعطل متكرر داخل الحاوية — راجع سجلاتها من قسم السجلات.",
        sourceService: s.serviceKey,
        fix: {
          action: null,
          manualStepsAr: [
            "راجع السجلات، وإن تكرر التعطل استخدم Recreate لإعادة إنشاء الحاوية نظيفة.",
          ],
        },
      });
    }
  }

  // خدمات CLI متوقفة (imgproxy/pooler...) حتى لو كانت الحاويات absent.
  for (const svc of supabaseStopped) {
    const key = svc.replace(/^supabase_/, "").replace(/_[a-z0-9]{10,}$/, "");
    if (issues.some((i) => i.sourceService === key)) continue;
    issues.push({
      id: `cli.${key}.stopped`,
      severity: "warning",
      titleAr: `خدمة ${key} متوقفة (من Supabase CLI)`,
      detailAr: "Supabase status يبلّغ أن هذه الخدمة لا تعمل ضمن المجموعة.",
      causeAr: "تُشغَّل مع المجموعة الكاملة — توقفت أو لم تُشغَّل مع آخر تشغيل.",
      sourceService: key,
      fix: { action: "supabase.start" },
    });
  }

  const r = report.resources;
  if (r.diskUsedPercent !== null && r.diskUsedPercent > 90) {
    issues.push({
      id: "disk.full",
      severity: "critical",
      titleAr: `القرص ممتلئ (${r.diskUsedPercent}%)`,
      detailAr: `المتاح: ${r.diskFreeGb} GB من ${r.diskTotalGb} GB.`,
      causeAr: "تراكم صور وحاويات وأقراص Docker على القرص.",
      sourceService: "docker",
      fix: { action: "maintenance.pruneImages" },
    });
  }
  if (r.memUsedPercent > 90) {
    issues.push({
      id: "mem.full",
      severity: "warning",
      titleAr: `الذاكرة مرتفعة (${r.memUsedPercent}%)`,
      detailAr: `المستخدم: ${Math.round(r.memTotalMb - r.memFreeMb)} MB من ${r.memTotalMb} MB.`,
      causeAr: "استهلاك مرتفع — غالباً Docker Desktop أو خادم التطوير.",
      sourceService: null,
      fix: {
        action: null,
        manualStepsAr: ["أغلق التطبيقات غير المستخدمة أو أعد تشغيل Docker Desktop."],
      },
    });
  }
  if (report.dbConnected === false) {
    issues.push({
      id: "db.disconnected",
      severity: "critical",
      titleAr: "لا يوجد اتصال بقاعدة البيانات المحلية",
      detailAr: "فحص pg_isready فشل على حاوية PostgreSQL.",
      causeAr: "حاوية قاعدة البيانات متوقفة أو غير جاهزة بعد.",
      sourceService: "db",
      fix: { action: "supabase.start" },
    });
  }

  return { generatedAt: new Date().toISOString(), issues };
}
