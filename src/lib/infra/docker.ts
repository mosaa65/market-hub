/**
 * جامع حالة Docker — يقرأ الحاويات والصور والأقراص والشبكات من docker CLI.
 * كل أوامر هنا ثابتة الوسائط أو معرفات متحقق منها — لا مخرجات المستخدم أبداً.
 */
import { docker, resolveTools, firstExisting, dockerArgs } from "./tools";
import { DEFAULT_PROJECT_REF, containerName, serviceDef } from "./services";
import type {
  ContainerInfo,
  DockerImageInfo,
  DockerNetworkInfo,
  DockerVolumeInfo,
  ServiceHealth,
  ServiceState,
} from "./types";

interface RawContainer {
  ID: string;
  Names: string;
  Image: string;
  State: string;
  Health: string;
  Status: string;
  Ports: string;
  StartedAt: string;
  Labels: string;
}

interface RawStatsLine {
  Name: string;
  CPUPerc: string;
  MemUsage: string;
  NetIO: string;
  BlockIO: string;
}

function parseStatLine(line: string): RawStatsLine | null {
  const parts = line.split(/\s{2,}/).map((p) => p.trim());
  if (parts.length < 3) return null;
  return {
    Name: parts[0],
    CPUPerc: parts[1],
    MemUsage: parts[2] ?? "",
    NetIO: parts[3] ?? "",
    BlockIO: parts[4] ?? "",
  };
}

function parseMem(usage: string): { used: number | null; limit: number | null } {
  const m = usage.match(/([\d.]+)(MiB|GiB|kiB|B)\s*\/\s*([\d.]+)(MiB|GiB|kiB|B)/);
  if (!m) return { used: null, limit: null };
  const toMb = (v: string, unit: string) => {
    const n = parseFloat(v);
    if (unit === "GiB") return n * 1024;
    if (unit === "kiB") return n / 1024;
    if (unit === "B") return n / 1048576;
    return n;
  };
  return { used: Math.round(toMb(m[1], m[2])), limit: Math.round(toMb(m[3], m[4])) };
}

function parseState(s: string): ServiceState {
  switch (s) {
    case "running":
      return "running";
    case "exited":
      return "exited";
    case "stopped":
      return "stopped";
    case "restarting":
      return "restarting";
    case "paused":
      return "paused";
    case "dead":
      return "dead";
    default:
      return "exited";
  }
}

function parseHealth(h: string): ServiceHealth {
  if (h === "healthy") return "healthy";
  if (h === "unhealthy") return "unhealthy";
  if (h === "starting") return "starting";
  if (h === "none" || h === "") return "none";
  return "unknown";
}

function serviceKeyFor(name: string): string | null {
  const m = name.match(/^supabase_([a-z0-9_]+?)_[a-z0-9]{10,}$/);
  if (!m) return null;
  const svc = m[1];
  // البحث في التعريفات بمفتاح مساوي للاسم.
  return svc;
}

export async function listContainers(projectRef = DEFAULT_PROJECT_REF): Promise<ContainerInfo[]> {
  const fmt =
    "{{json .ID}}\t{{json .Names}}\t{{json .Image}}\t{{json .State}}\t{{json .Health}}\t{{json .Status}}\t{{json .Ports}}\t{{json .StartedAt}}\t{{json .Labels}}";
  const res = await docker(["ps", "-a", "--format", fmt], { maxLines: 1000 });
  const containers: ContainerInfo[] = [];
  const statsRes = await docker(
    [
      "stats",
      "--no-stream",
      "--format",
      "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}",
    ],
    { maxLines: 1000 },
  );
  const statMap = new Map<string, RawStatsLine>();
  for (const line of statsRes.output.split(/\r?\n/)) {
    const parsed = parseStatLine(line.trim());
    if (parsed) statMap.set(parsed.Name, parsed);
  }

  for (const line of res.output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const raw = line.split("\t").map((c) => c.replace(/^"|"$/g, "").trim());
    const [ID, Names, Image, State, Health, Status, Ports, StartedAt, Labels] = raw;
    if (!ID || !Names) continue;
    const name = Names.split(",")[0];
    const stats = statMap.get(name);
    const mem = stats ? parseMem(stats.MemUsage) : { used: null, limit: null };
    const cpu = stats ? parseFloat(stats.CPUPerc.replace("%", "")) : null;
    const labels = (Labels ?? "").split(",").reduce<Record<string, string>>((acc, l) => {
      const [k, v] = l.split("=");
      if (k && v !== undefined) acc[k.trim()] = v.trim();
      return acc;
    }, {});
    containers.push({
      id: ID,
      name,
      image: Image ?? "",
      state: parseState(State ?? "exited"),
      health: parseHealth(Health ?? "none"),
      status: Status ?? "",
      startedAt: StartedAt ?? null,
      restartCount: 0, // docker inspect يقرأها على مستوى الخدمة عند الحاجة
      ports: (Ports ?? "")
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean),
      composeProject: labels["com.docker.compose.project"] ?? null,
      serviceKey: serviceKeyFor(name),
      cpuPercent: Number.isFinite(cpu) ? cpu : null,
      memUsedMb: mem.used,
      memLimitMb: mem.limit,
      netIO: stats?.NetIO ?? null,
      blockIO: stats?.BlockIO ?? null,
    });
  }
  // عدد مرات إعادة التشغيل لكل حاوية supabase عبر inspect دفعة واحدة.
  await enrichRestartCounts(containers, projectRef);
  return containers;
}

async function enrichRestartCounts(containers: ContainerInfo[], projectRef: string): Promise<void> {
  const supa = containers.filter((c) => c.serviceKey);
  if (supa.length === 0) return;
  const args = [
    "inspect",
    "--format",
    "{{.Name}}\t{{.RestartCount}}\t{{.HostConfig.RestartPolicy.Name}}",
  ];
  for (const c of supa) args.push(c.name);
  const res = await docker(args, { maxLines: 1000 });
  for (const line of res.output.split(/\r?\n/)) {
    const parts = line.trim().split("\t");
    if (parts.length < 2) continue;
    const name = parts[0];
    const count = parseInt(parts[1] ?? "0", 10);
    const target = supa.find((c) => c.name === name);
    if (target && Number.isFinite(count)) target.restartCount = count;
  }
}

export async function listImages(): Promise<DockerImageInfo[]> {
  const res = await docker(
    [
      "images",
      "--format",
      "{{.ID}}\t{{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}\t{{.Dangling}}",
    ],
    { maxLines: 1000 },
  );
  const images: DockerImageInfo[] = [];
  for (const line of res.output.split(/\r?\n/)) {
    const [id, repo, tag, size, created, dangling] = line.trim().split("\t");
    if (!id || !repo) continue;
    const mb = size?.endsWith("GB")
      ? parseFloat(size) * 1024
      : size?.endsWith("MB")
        ? parseFloat(size)
        : 0;
    images.push({
      id,
      repository: repo,
      tag: tag ?? "",
      sizeMb: Math.round(mb),
      createdSince: created ?? "",
      dangling: dangling === "true" || repo === "<none>",
    });
  }
  return images;
}

export async function listVolumes(): Promise<DockerVolumeInfo[]> {
  const res = await docker(["volume", "ls", "--format", "{{.Name}}\t{{.Driver}}"], {
    maxLines: 1000,
  });
  const volumes: DockerVolumeInfo[] = [];
  for (const line of res.output.split(/\r?\n/)) {
    const [name, driver] = line.trim().split("\t");
    if (!name) continue;
    volumes.push({ name, driver: driver ?? "local", size: null });
  }
  // أقراص الجلسة المحلية تكبر بحجم قاعدة البيانات — قياس حجم محدودة.
  const sized = volumes.filter((v) => v.name.includes("db") || v.name.includes("storage"));
  for (const v of sized.slice(0, 20)) {
    const du = await docker(
      ["run", "--rm", "-v", `${v.name}:/vol:ro`, "alpine", "du", "-sh", "/vol"],
      { timeoutMs: 20_000 },
    );
    if (du.ok) v.size = du.output.trim().split("\t")[0] ?? null;
  }
  return volumes;
}

export async function listNetworks(): Promise<DockerNetworkInfo[]> {
  const res = await docker(
    ["network", "ls", "--format", "{{.Name}}\t{{.Driver}}\t{{.Scope}}\t{{.Internal}}"],
    { maxLines: 500 },
  );
  const networks: DockerNetworkInfo[] = [];
  for (const line of res.output.split(/\r?\n/)) {
    const [name, driver, scope, internal] = line.trim().split("\t");
    if (!name) continue;
    networks.push({
      name,
      driver: driver ?? "bridge",
      scope: scope ?? "local",
      internal: internal === "true",
    });
  }
  return networks;
}

/** أعمال صيانة — كلها بقائمة بيضاء. */
export async function pruneDocker(
  kind: "images" | "containers" | "networks" | "volumes",
  force = true,
): Promise<string> {
  switch (kind) {
    case "images":
      return (await docker(["image", "prune", "-a", ...(force ? ["-f"] : [])])).output;
    case "containers":
      return (await docker(["container", "prune", ...(force ? ["-f"] : [])])).output;
    case "networks":
      return (await docker(["network", "prune", ...(force ? ["-f"] : [])])).output;
    case "volumes":
      return (await docker(["volume", "prune", "-a", ...(force ? ["-f"] : [])])).output;
  }
}

export async function removeDanglingImages(): Promise<string> {
  const ids = await docker(["images", "-q", "-f", "dangling=true"], { maxLines: 500 });
  const list = ids.output.trim().split(/\r?\n/).filter(Boolean);
  if (list.length === 0) return "No dangling images.";
  const res = await docker(["rmi", ...list]);
  return res.output;
}

export function dockerPath(): string {
  return dockerArgs(); // يبحث في المواقع المعروفة ثم في PATH ويطرح رسالة عربية واضحة
}

export async function dockerVersion(): Promise<string | null> {
  const res = await docker(["version", "--format", "{{.Server.Version}}"], { timeoutMs: 10_000 });
  return res.ok ? res.output.trim() : null;
}

export async function composeVersion(): Promise<string | null> {
  const res = await docker(["compose", "version", "--short"], { timeoutMs: 10_000 });
  return res.ok ? res.output.trim() : null;
}

/** إعادة إنشاء حاوية supabase — عبر supabase CLI فقط (لا docker rm يدوي). */
export async function recreateSupabaseService(
  service: string,
  projectRef = DEFAULT_PROJECT_REF,
): Promise<{ ok: boolean; output: string }> {
  const def = serviceDef(service);
  if (!def) return { ok: false, output: `Unknown service: ${service}` };
  // supabase stop <service> ثم start — إعادة إنشاء نظيفة عبر الأداة الرسمية.
  const { supabase } = await import("./tools");
  const stop = await supabase(["stop", def.service], { timeoutMs: 120_000 });
  const start = await supabase(["start"], { timeoutMs: 300_000 });
  void projectRef;
  return { ok: stop.ok && start.ok, output: stop.output + "\n" + start.output };
}

export async function engineAvailable(): Promise<boolean> {
  const tools = await resolveTools();
  if (!tools.docker) return false;
  const res = await docker(["info", "--format", "{{.ServerVersion}}"], { timeoutMs: 15_000 });
  return res.ok;
}
