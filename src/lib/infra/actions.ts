/**
 * عمليات التحكم بالبنية — كلها بقائمة بيضاء، مع تحقق من المعرفات.
 * قاعدة البيانات عبر pg_dump/psql داخل حاوية db (أدوات Docker الرسمية).
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, stat, unlink, readdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { docker, supabase, assertSafeId, backupsDir } from "./tools";
import { containerName } from "./services";
import { pruneDocker, removeDanglingImages, dockerPath } from "./docker";
import { supabaseStart, supabaseStop } from "./supabase";

/** الحاويات المسموح التحكم بها: حاويات المشروع (supabase_*) فقط. */
function validateProjectContainer(name: string): string {
  assertSafeId(name);
  if (!name.startsWith("supabase_")) {
    throw new Error(
      "لا يُسمح بالتحكم إلا بحاويات المشروع (supabase_*) — حماية من التأثير على حاويات أخرى على الجهاز.",
    );
  }
  return name;
}

export async function performContainerAction(
  action: "start" | "stop" | "restart",
  container: string,
): Promise<{ ok: boolean; output: string }> {
  const name = validateProjectContainer(container);
  const r = await docker([action, name]);
  return { ok: r.ok, output: r.output };
}

export async function recreateContainer(
  container: string,
): Promise<{ ok: boolean; output: string }> {
  const name = validateProjectContainer(container);
  // إعادة إنشاء نظيفة عبر supabase CLI: stop الخدمة ثم start المجموعة.
  const key = name.match(/^supabase_([a-z0-9_]+?)_[a-z0-9]{10,}$/)?.[1];
  if (!key) return { ok: false, output: "ليست حاوية Supabase معروفة." };
  const stop = await supabase(["stop", key], { timeoutMs: 180_000 });
  const start = await supabase(["start"], { timeoutMs: 600_000 });
  return { ok: stop.ok && start.ok, output: `${stop.output}\n${start.output}` };
}

export async function containerLogs(container: string, tail = 300): Promise<string> {
  const name = validateProjectContainer(container);
  const res = await docker(["logs", "--tail", String(Math.min(tail, 5000)), "--timestamps", name], {
    timeoutMs: 30_000,
    maxLines: 5000,
  });
  return res.output;
}

export async function inspectContainer(container: string): Promise<string> {
  const name = validateProjectContainer(container);
  const res = await docker(["inspect", name], { timeoutMs: 20_000, maxLines: 5000 });
  return res.output;
}

/** فحوص Shell آمنة محددة — لا أوامر حرة من المستخدم. */
export const SAFE_SHELL_PROBES: Record<string, string[]> = {
  pg_isready: ["pg_isready", "-U", "postgres", "-d", "postgres"],
  uptime: ["uptime"],
  df: ["df", "-h", "/var/lib/postgresql"],
};

export async function runSafeProbe(
  container: string,
  probe: keyof typeof SAFE_SHELL_PROBES,
): Promise<string> {
  const name = validateProjectContainer(container);
  const args = SAFE_SHELL_PROBES[probe];
  if (!args) return "فحص غير معروف";
  const r = await docker(["exec", name, ...args]);
  return r.output;
}

// ---------------------------------------------------------------------------
// قاعدة البيانات — نسخ/استعادة/تصدير عبر أدوات النظام
// ---------------------------------------------------------------------------

async function dumpDatabase(): Promise<{ ok: boolean; output: string; file: string | null }> {
  const db = containerName("db");
  await mkdir(backupsDir(), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `local-backup-${stamp}.sql`;
  const filePath = path.join(backupsDir(), fileName);
  return new Promise((resolve) => {
    const child = spawn(dockerPath(), ["exec", db, "pg_dump", "-U", "postgres", "-d", "postgres"], {
      windowsHide: true,
    });
    const out = createWriteStream(filePath, "utf8");
    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (e) => resolve({ ok: false, output: String(e), file: null }));
    child.on("close", (code) => {
      if (code === 0) resolve({ ok: true, output: `تم إنشاء النسخة: ${fileName}`, file: filePath });
      else resolve({ ok: false, output: stderr || `exit ${code}`, file: null });
    });
    void pipeline(child.stdout!, out).catch(() => undefined);
  });
}

export async function backupDatabase(): Promise<{
  ok: boolean;
  output: string;
  file: string | null;
}> {
  return dumpDatabase();
}

export async function exportDump(): Promise<{ ok: boolean; output: string; file: string | null }> {
  return dumpDatabase();
}

export async function restoreDatabase(dumpFile: string): Promise<{ ok: boolean; output: string }> {
  assertSafeId(dumpFile);
  if (!dumpFile.endsWith(".sql")) return { ok: false, output: "الملف يجب أن يكون .sql" };
  const filePath = path.join(backupsDir(), dumpFile);
  try {
    await stat(filePath);
  } catch {
    return { ok: false, output: `الملف غير موجود: ${dumpFile}` };
  }
  const db = containerName("db");
  const cp = await docker(["cp", filePath, `${db}:/tmp/restore.sql`], { timeoutMs: 120_000 });
  if (!cp.ok) return { ok: false, output: cp.output };
  const ps = await docker(
    ["exec", db, "psql", "-U", "postgres", "-d", "postgres", "-f", "/tmp/restore.sql"],
    { timeoutMs: 600_000, maxLines: 50 },
  );
  await docker(["exec", db, "rm", "-f", "/tmp/restore.sql"]);
  return { ok: ps.ok, output: ps.output };
}

export async function listBackups(): Promise<{ name: string; sizeKb: number; modified: string }[]> {
  try {
    await mkdir(backupsDir(), { recursive: true });
    const files = await readdir(backupsDir());
    const result: { name: string; sizeKb: number; modified: string }[] = [];
    for (const f of files.filter(
      (f) => f.endsWith(".sql") || f.endsWith(".sql.gz") || f.endsWith(".dump"),
    )) {
      const s = await stat(path.join(backupsDir(), f));
      result.push({ name: f, sizeKb: Math.round(s.size / 1024), modified: s.mtime.toISOString() });
    }
    return result.sort((a, b) => b.modified.localeCompare(a.modified));
  } catch {
    return [];
  }
}

export async function deleteBackup(name: string): Promise<boolean> {
  assertSafeId(name);
  try {
    await unlink(path.join(backupsDir(), name));
    return true;
  } catch {
    return false;
  }
}

/**
 * Reset Database — إعادة إنشاء القاعدة المحلية من الصفر عبر supabase stop
 * (بإزالة الأقراص) ثم start. تتطلب تأكيداً نصياً حرفياً.
 */
export async function resetDatabase(confirm: string): Promise<{ ok: boolean; output: string }> {
  const expected = "RESET";
  if (confirm !== expected) {
    return { ok: false, output: `التأكيد مطلوب: اكتب "${expected}" حرفياً في حقل التأكيد.` };
  }
  const stop = await supabase(["stop", "--no-backup"], { timeoutMs: 300_000 });
  const start = await supabaseStart();
  return { ok: stop.ok && start.ok, output: `${stop.output}\n${start.output}` };
}

// ---------------------------------------------------------------------------
// Seeds — تنفيذ ملفات supabase/seeds عبر psql داخل الحاوية
// ---------------------------------------------------------------------------

export async function runSeedFile(relPath: string): Promise<{ ok: boolean; output: string }> {
  if (!relPath.endsWith(".sql") || relPath.includes("..")) {
    return { ok: false, output: "مسار غير صالح للملف" };
  }
  const abs = path.resolve(process.cwd(), relPath);
  if (!abs.startsWith(path.join(process.cwd(), "supabase", "seeds"))) {
    return { ok: false, output: "خارج مجلد Seeds" };
  }
  const db = containerName("db");
  const cp = await docker(["cp", abs, `${db}:/tmp/seed.sql`], { timeoutMs: 60_000 });
  if (!cp.ok) return { ok: false, output: cp.output };
  const res = await docker(
    ["exec", db, "psql", "-U", "postgres", "-d", "postgres", "-f", "/tmp/seed.sql"],
    { timeoutMs: 300_000, maxLines: 60 },
  );
  await docker(["exec", db, "rm", "-f", "/tmp/seed.sql"]);
  return { ok: res.ok, output: res.output };
}

// ---------------------------------------------------------------------------
// صيانة
// ---------------------------------------------------------------------------

export async function maintenance(
  op:
    | "pruneImages"
    | "pruneContainers"
    | "pruneNetworks"
    | "pruneVolumes"
    | "removeDangling"
    | "restartAll",
): Promise<{ ok: boolean; output: string }> {
  switch (op) {
    case "pruneImages":
      return { ok: true, output: await pruneDocker("images") };
    case "pruneContainers":
      return { ok: true, output: await pruneDocker("containers") };
    case "pruneNetworks":
      return { ok: true, output: await pruneDocker("networks") };
    case "pruneVolumes":
      return { ok: true, output: await pruneDocker("volumes") };
    case "removeDangling":
      return { ok: true, output: await removeDanglingImages() };
    case "restartAll": {
      const stop = await supabaseStop();
      const start = await supabaseStart();
      return { ok: stop.ok && start.ok, output: `${stop.output}\n${start.output}` };
    }
  }
}
