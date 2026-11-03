/**
 * جامع حالة Supabase المحلية + عمليات CLI (بقائمة بيضاء).
 * يدعم الوضعين تلقائياً: local (Docker) و cloud (ربط رسمي فقط —
 * لا محاولة لإدارة الخدمات السحابية لأنها خارج نطاق Docker المحلي).
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { supabase } from "./tools";
import { DEFAULT_PROJECT_REF, SERVICES } from "./services";
import type { MigrationInfo, MigrationStatusReport, SupabaseStatusReport } from "./types";

interface LocalStatusJson {
  [key: string]: string;
}

async function readProjectRef(): Promise<string | null> {
  try {
    const ref = await readFile(
      path.join(process.cwd(), "supabase", ".temp", "project-ref"),
      "utf8",
    );
    return ref.trim() || null;
  } catch {
    return null;
  }
}

export async function supabaseStatus(): Promise<SupabaseStatusReport> {
  const projectRef = await readProjectRef();
  const res = await supabase(["status", "--output", "json"], { timeoutMs: 60_000, maxLines: 500 });
  const text = res.output;
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  const running = res.ok && jsonStart >= 0;
  let urls: Record<string, string> = {};
  let stoppedServices: string[] = [];
  if (running) {
    try {
      const json = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as LocalStatusJson;
      urls = Object.fromEntries(Object.entries(json).map(([k, v]) => [k.toLowerCase(), String(v)]));
    } catch {
      /* التحليل البسيط يكفي — النص الأصلي معروض في السجلات */
    }
  } else {
    // supabase status يطبع الخدمات المتوقفة عندما يكون المحرك جزئياً.
    const m = text.match(/Stopped services:\s*\[([^\]]*)\]/);
    if (m) stoppedServices = m[1].split(/\s+/).filter(Boolean);
  }
  const linked = Boolean(projectRef);
  return {
    available: true,
    mode: running ? (linked ? "linked-both" : "local") : linked ? "cloud" : "unknown",
    local: {
      running,
      stoppedServices,
      urls,
      projectRef: DEFAULT_PROJECT_REF,
    },
    cloud: {
      linked,
      projectRef,
      projectName: projectRef ? "market-hub" : null,
    },
  };
}

/** تشغيل/إيقاف كل الخدمات المحلية — عبر CLI الرسمي. */
export async function supabaseStart(): Promise<{ ok: boolean; output: string }> {
  const res = await supabase(["start"], { timeoutMs: 600_000, maxLines: 400 });
  return { ok: res.ok, output: res.output };
}
export async function supabaseStop(): Promise<{ ok: boolean; output: string }> {
  const res = await supabase(["stop"], { timeoutMs: 300_000, maxLines: 400 });
  return { ok: res.ok, output: res.output };
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

function parseMigrationList(output: string): MigrationInfo[] {
  // إخراج supabase migration list:
  // LOCAL          │ REMOTE │ INSERTED ...
  // 20261012000001 │ 2026...│ ...
  const lines = output.split(/\r?\n/);
  const result: MigrationInfo[] = [];
  for (const line of lines) {
    if (!line.includes("│")) continue;
    const cols = line.split("│").map((c) => c.trim());
    if (cols.length < 2) continue;
    const [local, remote] = cols;
    if (!/^\d{6,}$/.test(local) && !/^\d{6,}$/.test(remote)) continue;
    const version = /^\d{6,}$/.test(local) ? local : remote;
    result.push({
      version,
      name: version,
      location:
        /^\d{6,}$/.test(local) && /^\d{6,}$/.test(remote)
          ? "both"
          : /^\d{6,}$/.test(local)
            ? "local"
            : "remote",
    });
  }
  return result;
}

export async function migrationsStatus(): Promise<MigrationStatusReport> {
  const res = await supabase(["migration", "list"], { timeoutMs: 120_000 });
  if (!res.ok) {
    return {
      available: false,
      error: res.output.slice(0, 2000),
      migrations: [],
      pending: 0,
      appliedRemoteOnly: 0,
      seedFiles: [],
    };
  }
  const migrations = parseMigrationList(res.output);
  const pending = migrations.filter((m) => m.location === "local").length;
  const appliedRemoteOnly = migrations.filter((m) => m.location === "remote").length;
  return {
    available: true,
    migrations,
    pending,
    appliedRemoteOnly,
    seedFiles: await listSeeds(),
  };
}

export interface SeedFileInfo {
  name: string;
  path: string;
  kind: "system" | "company" | "samples" | "tests" | "other";
}

async function listSeeds(): Promise<SeedFileInfo[]> {
  const seedsDir = path.join(process.cwd(), "supabase", "seeds");
  const files: SeedFileInfo[] = [];
  const walk = async (dir: string, kind: SeedFileInfo["kind"], depth = 0): Promise<void> => {
    if (depth > 3) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        const sub = e.name;
        const subKind: SeedFileInfo["kind"] =
          sub === "01_system"
            ? "system"
            : sub === "02_company"
              ? "company"
              : sub === "03_samples"
                ? "samples"
                : sub === "04_tests"
                  ? "tests"
                  : kind;
        await walk(full, subKind, depth + 1);
      } else if (e.name.endsWith(".sql")) {
        files.push({ name: e.name, path: path.relative(process.cwd(), full), kind });
      }
    }
  };
  await walk(seedsDir, "other");
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
