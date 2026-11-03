/**
 * طبقة تنفيذ الأوامر الخادمية لنظام البنية التحتية.
 *
 * القواعد الصارمة هنا:
 *  1. لا تُنفَّذ أي أمر إلا من القائمة البيضاء — الواجهة تمرّر `InfraActionId`
 *     ومعرفات مُتحقَّق منها بالتعبير النظامي فقط، لا سلاسل حرة أبداً.
 *  2. كل تنفيذ يُسجَّل في سجل التدقيق (JSON Lines) ضمن `.output/infra-audit.log`
 *     بمعرف المستخدم والمدة والنتيجة.
 *  3. مسارات الأدوات (docker / git / node / supabase CLI) تُكشف تلقائياً من
 *     المواقع المعروفة على Windows ثم من PATH — لأن سكربتات المشروع السابقة
 *     كانت تفترض PATH سليماً وهو ما يفشل على أجهزة كثيرة.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, appendFile } from "node:fs/promises";
import { homedir, tmpdir, platform } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { ToolAvailability } from "./types";

// ---------------------------------------------------------------------------
// كشف الأدوات — عابر للأنظمة (Windows / macOS / Linux)
// ---------------------------------------------------------------------------

const IS_WINDOWS = platform() === "win32";
const PROGRAM_FILES = IS_WINDOWS ? process.env.ProgramFiles || "C:\\Program Files" : "/usr";
const PROGRAM_FILES_X86 = IS_WINDOWS
  ? process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)"
  : "/usr";

/** يحول مسار Windows إلى مسار WSL إن كنا داخل WSL — يحل مشكلة Docker على WSL. */
function toWslPath(winPath: string): string {
  const m = winPath.match(/^([A-Za-z]):\\(.*)$/);
  if (!m) return winPath;
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}`;
}

const DOCKER_CANDIDATES = IS_WINDOWS
  ? [
      path.join(PROGRAM_FILES, "Docker", "Docker", "resources", "bin", "docker.exe"),
      "C:\\ProgramData\\DockerDesktop\\version-bin\\docker.exe",
    ]
  : ["/usr/local/bin/docker", "/usr/bin/docker", "/opt/homebrew/bin/docker", "/snap/bin/docker"];

const GIT_CANDIDATES = IS_WINDOWS
  ? [
      path.join(PROGRAM_FILES, "Git", "cmd", "git.exe"),
      path.join(PROGRAM_FILES, "Git", "bin", "git.exe"),
      path.join(PROGRAM_FILES_X86, "Git", "cmd", "git.exe"),
    ]
  : ["/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"];

const NODE_CANDIDATES = IS_WINDOWS
  ? [path.join(PROGRAM_FILES, "nodejs", "node.exe")]
  : ["/usr/bin/node", "/usr/local/bin/node", "/opt/homebrew/bin/node"];

/** npm global shim + حزمة supabase CLI — على كل الأنظمة. */
const NPM_GLOBAL_DIR = IS_WINDOWS
  ? path.join(homedir(), "AppData", "Roaming", "npm")
  : path.join(homedir(), ".npm-global");

function npmGlobalCandidates(): string[] {
  const dirs = [
    NPM_GLOBAL_DIR,
    IS_WINDOWS ? path.join(homedir(), "AppData", "Roaming", "npm") : "/usr/lib/node_modules",
    "/usr/local/lib/node_modules",
    "/opt/homebrew/lib/node_modules",
  ];
  return dirs;
}

function findSupabaseJs(): string | null {
  for (const dir of npmGlobalCandidates()) {
    const p = path.join(dir, "node_modules", "supabase", "dist", "supabase.js");
    if (existsSync(p)) return p;
  }
  return null;
}

export function firstExisting(candidates: string[]): string | null {
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

let nodePath: string | null = null;
const supabasePath: string | null = null;
let supabaseJsPath: string | null = null;

/** يضبط مسارات الأدوات مرة واحدة. */
export async function resolveTools(): Promise<ToolAvailability> {
  let dockerPath = firstExisting(DOCKER_CANDIDATES);
  const gitPath = firstExisting(GIT_CANDIDATES);
  nodePath ??= firstExisting(NODE_CANDIDATES);
  supabaseJsPath ??= findSupabaseJs();
  const supabaseUsable = Boolean(nodePath && supabaseJsPath);
  // Docker قد يكون في PATH لكن ليس في المواقع المعروفة (الأنظمة غير Windows).
  if (!dockerPath) dockerPath = whichDocker();
  return {
    docker: Boolean(dockerPath),
    dockerCompose: Boolean(dockerPath), // docker compose متضمّن في CLI الحديث
    git: Boolean(gitPath) || Boolean(whichGit()),
    supabase: supabaseUsable,
    dockerPath,
    gitPath: gitPath || whichGit(),
    supabasePath: supabaseUsable ? supabaseJsPath : null,
    supabaseVersion: null,
  };
}

/** يبحث عن ملف تنفيذي في PATH عبر where/which — احتياط للمواقع المعروفة. */
function which(exe: string): string | null {
  try {
    const cmd = IS_WINDOWS ? "where" : "which";
    const out = execFileSync(cmd, [exe], { encoding: "utf8", timeout: 5000 });
    const first = out.trim().split(/\r?\n/)[0];
    return first && existsSync(first) ? first : null;
  } catch {
    return null;
  }
}

function whichDocker(): string | null {
  return which(IS_WINDOWS ? "docker.exe" : "docker");
}
function whichGit(): string | null {
  return which(IS_WINDOWS ? "git.exe" : "git");
}

// ---------------------------------------------------------------------------
// تنفيذ أوامر — بقائمة بيضاء
// ---------------------------------------------------------------------------

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}$/;

/** يرفض أي معرف لا يطابق النمط الآمن — الحماية الأساسية من الحقن. */
export function assertSafeId(id: string): string {
  if (!SAFE_ID.test(id)) throw new Error(`Invalid identifier: ${id}`);
  return id;
}

export class CommandError extends Error {
  exitCode: number | null;
  output: string;
  constructor(message: string, exitCode: number | null, output: string) {
    super(message);
    this.exitCode = exitCode;
    this.output = output;
  }
}

interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  /** أقصى عدد أسطر محفوظة في المخرجات (الافتراضي 200). */
  maxLines?: number;
}

export interface RunResult {
  ok: boolean;
  exitCode: number | null;
  output: string;
  durationMs: number;
}

/** تنفيذ خام — يستخدم فقط داخل هذه الوحدة بوسائط ثابتة من القائمة البيضاء. */
export async function runCommand(
  exe: string,
  args: string[],
  options: RunOptions = {},
): Promise<RunResult> {
  const started = Date.now();
  const { cwd = process.cwd(), timeoutMs = 120_000, maxLines = 200 } = options;
  return new Promise<RunResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let done = false;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(exe, args, { cwd, windowsHide: true });
    } catch {
      resolve({
        ok: false,
        exitCode: null,
        output: "spawn failed",
        durationMs: Date.now() - started,
      });
      return;
    }
    const timer = setTimeout(() => {
      if (!done) {
        child.kill("SIGKILL");
        stderr += "\n[timeout]";
      }
    }, timeoutMs);
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    const finish = (ok: boolean, code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const raw = (stdout + "\n" + stderr).trim();
      // لا تسجّل الأسرار في المخرجات.
      const sanitized = raw
        .split(/\r?\n/)
        .filter(
          (l) =>
            !/ANON_KEY|SERVICE_ROLE|SECRET|JWT_SECRET|PUBLISHABLE_KEY|S3_PROTOCOL_ACCESS/.test(l),
        )
        .slice(-maxLines)
        .join("\n");
      resolve({ ok, exitCode: code, output: sanitized, durationMs: Date.now() - started });
    };
    child.on("error", (e) => {
      stderr += String(e);
      finish(false, null);
    });
    child.on("close", (code) => finish((code ?? 1) === 0, code));
  });
}

// docker -------------------------------------------------------------------
export function dockerArgs(): string {
  const p = firstExisting(DOCKER_CANDIDATES) || whichDocker();
  if (!p)
    throw new Error("Docker CLI غير مثبت أو غير موجود في PATH. ثبّت Docker Desktop من docker.com");
  return p;
}
export async function docker(args: string[], options: RunOptions = {}): Promise<RunResult> {
  try {
    return await runCommand(dockerArgs(), args, options);
  } catch (e) {
    return { ok: false, exitCode: null, output: String(e), durationMs: 0 };
  }
}

// git ----------------------------------------------------------------------
export function gitExe(): string {
  const p = firstExisting(GIT_CANDIDATES) || whichGit();
  if (!p) throw new Error("Git غير مثبت أو غير موجود في PATH. ثبّت Git من git-scm.com");
  return p;
}
export async function git(args: string[], options: RunOptions = {}): Promise<RunResult> {
  try {
    return await runCommand(gitExe(), args, options);
  } catch (e) {
    return { ok: false, exitCode: null, output: String(e), durationMs: 0 };
  }
}

// supabase -----------------------------------------------------------------
export async function supabase(args: string[], options: RunOptions = {}): Promise<RunResult> {
  nodePath ??= firstExisting(NODE_CANDIDATES) || which(IS_WINDOWS ? "node.exe" : "node");
  supabaseJsPath ??= findSupabaseJs();
  if (!nodePath || !supabaseJsPath) {
    return {
      ok: false,
      exitCode: null,
      output: "Supabase CLI غير متاح. ثبّته بـ: npm install -g supabase (يتطلب Node.js مثبتاً)",
      durationMs: 0,
    };
  }
  return runCommand(nodePath, [supabaseJsPath, ...args], {
    timeoutMs: 180_000,
    ...options,
  });
}

// ---------------------------------------------------------------------------
// سجل التدقيق
// ---------------------------------------------------------------------------

function auditFile(): string {
  return path.join(process.cwd(), ".output", "infra-audit.log");
}

export async function writeAudit(entry: {
  userId?: string | null;
  action: string;
  ok: boolean;
  durationMs: number;
  argsSummary: string;
  exitCode: number | null;
  outputTail: string;
}): Promise<string> {
  const id = randomUUID();
  const line =
    JSON.stringify({ id, at: new Date().toISOString(), userId: entry.userId ?? null, ...entry }) +
    "\n";
  try {
    await mkdir(path.dirname(auditFile()), { recursive: true });
    await appendFile(auditFile(), line, "utf8");
  } catch {
    // التدقيق لا يفشل العملية أبداً.
  }
  return id;
}

export async function readAudit(limit = 200): Promise<string> {
  try {
    const raw = await readFile(auditFile(), "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    return lines.slice(-limit).join("\n");
  } catch {
    return "";
  }
}

/** مجلد النسخ الاحتياطية للقاعدة المحلية. */
export function backupsDir(): string {
  return path.join(process.cwd(), "backups");
}

export function tempDir(): string {
  return path.join(tmpdir(), "vortex-infra");
}
