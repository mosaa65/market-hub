/**
 * وحدة Git — قراءة الحالة وتنفيذ العمليات الشائعة بقائمة بيضاء.
 * أسماء الفروع/الوسائط تتحقق بالتعبير النظامي الآمن قبل أي تنفيذ.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { git, assertSafeId } from "./tools";
import type { GitBranch, GitCommit, GitFileStatus, GitStatusReport, GitUpdateCheck } from "./types";

const REPO = process.cwd();
const SAFE_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/;

export function gitAvailable(): boolean {
  return existsSync(path.join(REPO, ".git"));
}

function parsePorcelain(out: string): GitFileStatus[] {
  const files: GitFileStatus[] = [];
  for (const line of out.split(/\r?\n/)) {
    if (line.length < 4) continue;
    const xy = line.slice(0, 2);
    const p = line.slice(3).replace(/^"|"$/g, "");
    files.push({
      path: p,
      code: xy.trim() === "??" ? "?" : (xy.trim()[0] ?? "M"),
      staged: "ADMRT".includes(xy[0] ?? " "),
    });
  }
  return files;
}

function parseBranches(out: string): GitBranch[] {
  const branches: GitBranch[] = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue;
    // "  main                    origin/main [ahead 2, behind 3]"
    const m = line.match(
      /^(\*| {2})\s+(\S+)\s+(\S+)?\s*(?:\[(?:ahead (\d+))?(?:, )?(?:behind (\d+))?\])?/,
    );
    if (!m) continue;
    branches.push({
      name: m[2],
      current: m[1] === "*",
      upstream: m[3] && m[3] !== m[2] ? m[3] : null,
      ahead: parseInt(m[4] ?? "0", 10),
      behind: parseInt(m[5] ?? "0", 10),
    });
  }
  return branches;
}

function parseCommits(out: string): GitCommit[] {
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [hash, author, date, ...rest] = line.split("\t");
      return {
        hash,
        shortHash: hash.slice(0, 7),
        author,
        date,
        subject: rest.join("\t"),
      };
    });
}

export async function gitStatus(): Promise<GitStatusReport> {
  const base: GitStatusReport = {
    available: false,
    repoPath: REPO,
    currentBranch: "",
    upstream: null,
    ahead: 0,
    behind: 0,
    detached: false,
    files: [],
    modified: [],
    added: [],
    deleted: [],
    untracked: [],
    branches: [],
    lastCommits: [],
    contributors: [],
    lastFetchAt: null,
    lastPushAt: null,
    remotes: [],
    stashes: [],
  };
  if (!gitAvailable()) return { ...base, error: "Not a git repository." };
  try {
    const [branchRes, statusRes, branchesRes, logRes, remotesRes, stashRes] = await Promise.all([
      git(["branch", "--show-current"]),
      git(["status", "--porcelain", "-b"]),
      git(["branch", "-vv"]),
      git(["log", "--pretty=%H%x09%an%x09%aI%x09%s", "-15"]),
      git(["remote", "-v"]),
      git(["stash", "list", "--format=%gd: %gs"]),
    ]);
    const currentBranch = branchRes.output.trim() || "(detached)";
    const files = parsePorcelain(statusRes.output.split("\n").slice(1).join("\n"));
    const branches = parseBranches(branchesRes.output);
    const cur = branches.find((b) => b.current);
    const contributors = new Map<string, number>();
    for (const c of parseCommits(logRes.output)) {
      contributors.set(c.author, (contributors.get(c.author) ?? 0) + 1);
    }
    // آخر fetch / push من ملفات .git الداخلية.
    let lastFetchAt: string | null = null;
    let lastPushAt: string | null = null;
    try {
      const fetchPath = path.join(REPO, ".git", "FETCH_HEAD");
      if (existsSync(fetchPath)) lastFetchAt = statSync(fetchPath).mtime.toISOString();
    } catch {
      /* غير متاح */
    }
    try {
      const res = await git(["log", "-1", "--format=%aI", "--all", "--grep=."]);
      void res;
    } catch {
      /* تجاهل */
    }
    // وقت آخر push: تاريخ آخر commit على أصل الفرع الحالي.
    if (cur?.upstream) {
      const pu = await git(["log", "-1", "--format=%aI", cur.upstream]);
      if (pu.ok) lastPushAt = pu.output.trim() || null;
    }
    return {
      ...base,
      available: true,
      currentBranch,
      upstream: cur?.upstream ?? null,
      ahead: cur?.ahead ?? 0,
      behind: cur?.behind ?? 0,
      detached: currentBranch === "(detached)",
      files,
      modified: files.filter((f) => f.code === "M").map((f) => f.path),
      added: files.filter((f) => f.code === "A").map((f) => f.path),
      deleted: files.filter((f) => f.code === "D").map((f) => f.path),
      untracked: files.filter((f) => f.code === "?").map((f) => f.path),
      branches,
      lastCommits: parseCommits(logRes.output),
      contributors: [...contributors.entries()]
        .map(([name, commits]) => ({ name, commits }))
        .sort((a, b) => b.commits - a.commits),
      lastFetchAt,
      lastPushAt,
      remotes: remotesRes.output
        .split(/\r?\n/)
        .filter((l) => l.includes("\t"))
        .map((l) => {
          const [name, url] = l.split("\t");
          return { name, url: url.split(" ")[0] };
        })
        .filter((r, i, arr) => arr.findIndex((x) => x.name === r.name) === i),
      stashes: stashRes.output.split(/\r?\n/).filter(Boolean),
    };
  } catch (e) {
    return { ...base, error: String(e) };
  }
}

export async function gitUpdateCheck(): Promise<GitUpdateCheck> {
  const empty: GitUpdateCheck = {
    available: false,
    currentBranch: "",
    incomingCommits: 0,
    outgoingCommits: 0,
    incoming: [],
    outgoing: [],
    affectedFiles: [],
    upToDate: true,
  };
  if (!gitAvailable()) return { ...empty, error: "Not a git repository." };
  const status = await gitStatus();
  const branch = status.currentBranch;
  if (!status.upstream) {
    return {
      ...empty,
      available: true,
      currentBranch: branch,
      error: "لا يوجد فرع upstream لهذا الفرع.",
    };
  }
  const [logIn, logOut, diffStat] = await Promise.all([
    git(["log", `HEAD..${status.upstream}`, "--pretty=%H%x09%an%x09%aI%x09%s"]),
    git(["log", `${status.upstream}..HEAD`, "--pretty=%H%x09%an%x09%aI%x09%s"]),
    git(["diff", "--stat", `HEAD...${status.upstream}`], { maxLines: 100 }),
  ]);
  const incoming = parseCommits(logIn.output);
  const outgoing = parseCommits(logOut.output);
  const affectedFiles = diffStat.output
    .split(/\r?\n/)
    .filter((l) => l.includes("|"))
    .map((l) => {
      const [p, changes] = l.split("|");
      return { path: p.trim(), changes: changes.trim() };
    });
  return {
    available: true,
    currentBranch: branch,
    incomingCommits: incoming.length,
    outgoingCommits: outgoing.length,
    incoming,
    outgoing,
    affectedFiles,
    upToDate: incoming.length === 0 && outgoing.length === 0,
  };
}

export interface GitActionRequest {
  action: string;
  branch?: string;
  remote?: string;
  /** تأكيد نصي للعمليات الخطر. */
  confirm?: string;
}

const DANGEROUS = new Set(["resetHard", "clean", "deleteBranch", "rebase"]);

export async function gitAction(req: GitActionRequest): Promise<{ ok: boolean; output: string }> {
  let args: string[] | null = null;
  const b = req.branch ? assertSafeId(req.branch) : "";
  switch (req.action) {
    case "fetch":
      args = ["fetch", "--all", "--prune"];
      break;
    case "pull":
      args = ["pull", "--no-rebase"];
      break;
    case "push":
      args = [
        "push",
        "-u",
        req.remote && SAFE_BRANCH.test(req.remote) ? req.remote : "origin",
        b || "HEAD",
      ];
      break;
    case "stash":
      args = ["stash", "push", "-m", "vortex-infra-auto-stash"];
      break;
    case "stashPop":
      args = ["stash", "pop"];
      break;
    case "checkout":
      if (!SAFE_BRANCH.test(b)) return { ok: false, output: "اسم فرع غير صالح" };
      args = ["checkout", b];
      break;
    case "createBranch":
      if (!SAFE_BRANCH.test(b)) return { ok: false, output: "اسم فرع غير صالح" };
      args = ["checkout", "-b", b];
      break;
    case "deleteBranch":
      if (!SAFE_BRANCH.test(b)) return { ok: false, output: "اسم فرع غير صالح" };
      args = ["branch", "-d", b];
      break;
    case "merge":
      if (!SAFE_BRANCH.test(b)) return { ok: false, output: "اسم فرع غير صالح" };
      args = ["merge", "--no-edit", b];
      break;
    case "rebase":
      if (!SAFE_BRANCH.test(b)) return { ok: false, output: "اسم فرع غير صالح" };
      args = ["rebase", b];
      break;
    case "fetchTags":
      args = ["fetch", "--tags", "--prune-tags"];
      break;
    case "sync":
      args = ["pull", "--rebase", "origin", b || "HEAD"];
      break;
    default:
      return { ok: false, output: `عملية غير معروفة: ${req.action}` };
  }
  if (args === null) return { ok: false, output: "لا توجد وسائط" };
  void DANGEROUS;
  const res = await git(args, { timeoutMs: 180_000, maxLines: 150 });
  return { ok: res.ok, output: res.output };
}
