/**
 * نقاط الخادم الوحيدة لنظام البنية التحتية — عبر createServerFn.
 * كل عملية تتحقق من الهوية (requireSupabaseAuth) ومن الدور (owner /
 * superadmin فقط) قبل التنفيذ، وتسجَّل في سجل التدقيق.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

import { buildHealthReport, diagnose } from "./health";
import { listImages, listVolumes, listNetworks } from "./docker";
import { supabaseStatus, migrationsStatus, supabaseStart, supabaseStop } from "./supabase";
import { gitStatus, gitUpdateCheck, gitAction } from "./git";
import {
  performContainerAction,
  recreateContainer,
  containerLogs,
  inspectContainer,
  runSafeProbe,
  backupDatabase,
  restoreDatabase,
  exportDump,
  resetDatabase,
  listBackups,
  deleteBackup,
  runSeedFile,
  maintenance,
} from "./actions";
import { writeAudit, readAudit } from "./tools";
import type { InfraActionId } from "./types";

// ---------------------------------------------------------------------------
// حارس الدور — owner أو مدير منصة فقط
// ---------------------------------------------------------------------------

const guard = createServerFn({ method: "GET" }).handler(async ({ context }: any) => {
  const userId: string = (context as any)?.userId ?? "anonymous";
  // تحقق من الدور: مالك المنشأة (user_roles) أو مدير منصة فائق (platform_admins).
  // التحميل الديناميكي يمنع تسريب عميل service-role إلى حزمة العميل.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const adminClient: any = supabaseAdmin;
  const [rolesRes, adminRes] = await Promise.all([
    adminClient.from("user_roles").select("role").eq("user_id", userId),
    adminClient.from("platform_admins").select("role, is_active").eq("user_id", userId),
  ]);
  const roles = (rolesRes.data ?? []) as { role: string }[];
  const isSuperadmin = ((adminRes.data ?? []) as { role: string; is_active: boolean }[]).some(
    (a) => a.role === "superadmin" && a.is_active,
  );
  return {
    userId,
    allowed: roles.some((r) => r.role === "owner") || isSuperadmin,
    role: roles[0]?.role ?? null,
  };
});

async function requireInfraAdmin() {
  const g = await guard();
  if (!g.allowed) {
    throw new Error("هذه الصلاحية لمالك المتجر فقط (Owner).");
  }
  return g;
}

/** فحص الوصول للواجهة — يُستهلك من OwnerGuard في الواجهة. */
export const getInfraAccess = guard;

// ---------------------------------------------------------------------------
// القراءات
// ---------------------------------------------------------------------------

export const getHealthReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    await requireInfraAdmin();
    const report = await buildHealthReport();
    // الإشعارات المشتقة من التقرير — الواجهة تستخدمها للتنبيه.
    return { report, issues: diagnose(report, []).issues };
  });

export const getDiagnosis = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    await requireInfraAdmin();
    const report = await buildHealthReport();
    const status = await supabaseStatus();
    return diagnose(report, status.local.running ? [] : status.local.stoppedServices);
  });

export const getDockerExplorer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    await requireInfraAdmin();
    const [images, volumes, networks] = await Promise.all([
      listImages(),
      listVolumes(),
      listNetworks(),
    ]);
    return { images, volumes, networks };
  });

export const getSupabaseStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    await requireInfraAdmin();
    return supabaseStatus();
  });

export const getMigrations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    await requireInfraAdmin();
    return migrationsStatus();
  });

export const getGitStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    await requireInfraAdmin();
    return gitStatus();
  });

export const getGitUpdateCheck = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    await requireInfraAdmin();
    return gitUpdateCheck();
  });

export const getContainerLogs = createServerFn({ method: "GET" })
  .validator(
    z.object({
      container: z.string().min(1).max(200),
      tail: z.number().int().min(10).max(5000).default(300),
    }),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data }) => {
    await requireInfraAdmin();
    return containerLogs(data.container, data.tail);
  });

export const inspectContainerFn = createServerFn({ method: "POST" })
  .validator(z.object({ container: z.string().min(1).max(200) }))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data }) => {
    await requireInfraAdmin();
    return inspectContainer(data.container);
  });

export const runProbeFn = createServerFn({ method: "POST" })
  .validator(z.object({ container: z.string().min(1).max(200), probe: z.string().min(1).max(40) }))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data }) => {
    await requireInfraAdmin();
    return runSafeProbe(
      data.container,
      data.probe as keyof typeof import("./actions").SAFE_SHELL_PROBES,
    );
  });

export const getBackups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    await requireInfraAdmin();
    return listBackups();
  });

export const getAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    await requireInfraAdmin();
    return readAudit(200);
  });

// ---------------------------------------------------------------------------
// العمليات (كلها POST + تدقيق)
// ---------------------------------------------------------------------------

async function audited<T>(
  userId: string | null,
  action: string,
  fn: () => Promise<T>,
): Promise<T & { auditId: string }> {
  const started = Date.now();
  try {
    const result = await fn();
    const auditId = await writeAudit({
      userId,
      action,
      ok: true,
      durationMs: Date.now() - started,
      argsSummary: "",
      exitCode: 0,
      outputTail: JSON.stringify(result).slice(0, 500),
    });
    return { ...result, auditId } as T & { auditId: string };
  } catch (e) {
    const auditId = await writeAudit({
      userId,
      action,
      ok: false,
      durationMs: Date.now() - started,
      argsSummary: "",
      exitCode: 1,
      outputTail: String(e).slice(0, 500),
    });
    throw e;
  }
}

const containerActionSchema = z.object({
  action: z.enum(["start", "stop", "restart", "recreate"]),
  container: z.string().min(1).max(200),
});

export const containerAction = createServerFn({ method: "POST" })
  .validator(containerActionSchema)
  .middleware([requireSupabaseAuth])
  .handler(async ({ data }) => {
    const g = await requireInfraAdmin();
    return audited(g.userId, `container.${data.action}`, async () => {
      if (data.action === "recreate") return recreateContainer(data.container);
      return performContainerAction(data.action, data.container);
    });
  });

export const supabaseAction = createServerFn({ method: "POST" })
  .validator(z.object({ action: z.enum(["start", "stop"]) }))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data }) => {
    const g = await requireInfraAdmin();
    return audited(g.userId, `supabase.${data.action}`, async () => {
      if (data.action === "start") return supabaseStart();
      return supabaseStop();
    });
  });

export const dbAction = createServerFn({ method: "POST" })
  .validator(
    z.object({
      action: z.enum(["backup", "restore", "exportDump", "reset", "deleteBackup"]),
      file: z.string().max(300).optional(),
      confirm: z.string().max(120).optional(),
    }),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data }) => {
    const g = await requireInfraAdmin();
    return audited(g.userId, `db.${data.action}`, async () => {
      switch (data.action) {
        case "backup":
          return backupDatabase();
        case "exportDump":
          return exportDump();
        case "restore": {
          if (!data.file) return { ok: false, output: "اسم الملف مطلوب" };
          return restoreDatabase(data.file);
        }
        case "reset":
          return resetDatabase(data.confirm ?? "");
        case "deleteBackup": {
          if (!data.file) return { ok: false, output: "اسم الملف مطلوب" };
          const ok = await deleteBackup(data.file);
          return { ok, output: ok ? "تم الحذف" : "تعذر الحذف", file: null };
        }
      }
    });
  });

export const seedAction = createServerFn({ method: "POST" })
  .validator(z.object({ file: z.string().min(1).max(300) }))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data }) => {
    const g = await requireInfraAdmin();
    return audited(g.userId, "seed.run", async () => runSeedFile(data.file));
  });

export const migrationAction = createServerFn({ method: "POST" })
  .validator(
    z.object({
      action: z.enum(["list", "repair", "diff", "push", "pull"]),
      confirm: z.string().max(120).optional(),
    }),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data }) => {
    const g = await requireInfraAdmin();
    return audited(g.userId, `migrations.${data.action}`, async () => {
      const { supabase } = await import("./tools");
      switch (data.action) {
        case "list": {
          // التحديث يتم عبر getMigrations — هنا نُعيد فقط تأكيد التنفيذ.
          const r = await migrationsStatus();
          return {
            ok: r.available,
            output: r.available
              ? `الترحيلات: ${r.pending} معلقة، ${r.appliedRemoteOnly} سحابية فقط`
              : (r.error ?? "فشل"),
          };
        }
        case "repair": {
          if (data.confirm !== "REPAIR") return { ok: false, output: "التأكيد مطلوب: اكتب REPAIR" };
          const r = await supabase(["migration", "repair", "--status", "reverted"], {
            timeoutMs: 120_000,
          });
          return { ok: r.ok, output: r.output };
        }
        case "diff": {
          const r = await supabase(["db", "diff", "-f", "vortex_diff"], { timeoutMs: 300_000 });
          return { ok: r.ok, output: r.output };
        }
        case "push": {
          if (data.confirm !== "PUSH")
            return { ok: false, output: "التأكيد مطلوب: اكتب PUSH لتطبيق الترحيلات على السحابة" };
          const r = await supabase(["db", "push"], { timeoutMs: 600_000 });
          return { ok: r.ok, output: r.output };
        }
        case "pull": {
          const r = await supabase(["db", "pull"], { timeoutMs: 600_000 });
          return { ok: r.ok, output: r.output };
        }
      }
    });
  });

export const gitActionFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      action: z.string().min(1).max(40),
      branch: z.string().max(120).optional(),
      remote: z.string().max(60).optional(),
      confirm: z.string().max(120).optional(),
    }),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data }) => {
    const g = await requireInfraAdmin();
    return audited(g.userId, `git.${data.action}`, async () => gitAction(data));
  });

export const maintenanceAction = createServerFn({ method: "POST" })
  .validator(
    z.object({
      op: z.enum([
        "pruneImages",
        "pruneContainers",
        "pruneNetworks",
        "pruneVolumes",
        "removeDangling",
        "restartAll",
      ]),
      confirm: z.string().max(40).optional(),
    }),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data }) => {
    const g = await requireInfraAdmin();
    const dangerous: Record<string, string> = {
      pruneImages: "PRUNE IMAGES",
      pruneContainers: "PRUNE CONTAINERS",
      pruneVolumes: "PRUNE VOLUMES",
      restartAll: "",
    };
    const need = dangerous[data.op];
    if (need && data.confirm !== need) {
      return {
        ok: false,
        output: `عملية خطر — اكتب "${need}" في حقل التأكيد.`,
        auditId: "",
      };
    }
    return audited(g.userId, `maintenance.${data.op}`, async () => maintenance(data.op));
  });

// إشارة النوع للواجهة — تُستخدم في state typing فقط.
export type InfraActionType = InfraActionId;
