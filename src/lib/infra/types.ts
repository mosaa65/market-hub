/**
 * أنواع مشتركة لنظام Development & Infrastructure Manager.
 *
 * تُستهلك من الواجهة ومن طبقة الخادم معاً — بلا استيرادات لـ Node أو React
 * حتى تبقى آمنة للطرفين.
 */

// ---------------------------------------------------------------------------
// حالة الخدمات
// ---------------------------------------------------------------------------

export type ServiceState = "running" | "stopped" | "exited" | "restarting" | "paused" | "dead";
export type ServiceHealth = "healthy" | "unhealthy" | "starting" | "none" | "unknown";

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: ServiceState;
  health: ServiceHealth;
  status: string;
  startedAt: string | null;
  restartCount: number;
  ports: string[];
  /** معرّف مشروع compose إن وُجد. */
  composeProject: string | null;
  /** اسم الخدمة المنطقية من سجل الخدمات (مثل db / kong / studio). */
  serviceKey: string | null;
  /** استخدام الموارد إن توفرت عند الفحص. */
  cpuPercent: number | null;
  memUsedMb: number | null;
  memLimitMb: number | null;
  netIO: string | null;
  blockIO: string | null;
}

export interface DockerImageInfo {
  id: string;
  repository: string;
  tag: string;
  sizeMb: number;
  createdSince: string;
  dangling: boolean;
}

export interface DockerVolumeInfo {
  name: string;
  driver: string;
  size: string | null;
}

export interface DockerNetworkInfo {
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
}

// ---------------------------------------------------------------------------
// الصحة والتشخيص
// ---------------------------------------------------------------------------

export interface ToolAvailability {
  docker: boolean;
  dockerCompose: boolean;
  git: boolean;
  supabase: boolean;
  dockerPath: string | null;
  gitPath: string | null;
  supabasePath: string | null;
  supabaseVersion: string | null;
}

export interface SystemResources {
  cpuModel: string;
  cpuCores: number;
  cpuLoadPercent: number | null;
  memTotalMb: number;
  memFreeMb: number;
  memUsedPercent: number;
  diskTotalGb: number | null;
  diskFreeGb: number | null;
  diskUsedPercent: number | null;
  platform: string;
  hostname: string;
  nodeVersion: string;
}

export interface ServiceHealthEntry {
  serviceKey: string;
  label: string;
  labelEn: string;
  containerName: string | null;
  state: ServiceState | "absent";
  health: ServiceHealth;
  uptimeSeconds: number | null;
  restartCount: number | null;
  image: string | null;
  ports: string[];
  cpuPercent: number | null;
  memUsedMb: number | null;
  memLimitMb: number | null;
  /** نقطة فحص HTTP اختيارية (Studio / Kong / API). */
  httpProbe: { url: string; ok: boolean; status: number | null; ms: number | null } | null;
  /** يعتمد على خدمات أخرى — تُملأ من رسم الاعتماد. */
  dependsOn: string[];
}

export interface DockerEngineHealth {
  available: boolean;
  version: string | null;
  composeVersion: string | null;
  error: string | null;
}

export interface HealthReport {
  generatedAt: string;
  engine: DockerEngineHealth;
  tools: ToolAvailability;
  services: ServiceHealthEntry[];
  resources: SystemResources;
  dockerDisk: { type: string; size: string; reclaimable: string; count: number }[];
  ports: { port: number; container: string | null; host: string | null }[];
  dbConnected: boolean | null;
  summary: { running: number; stopped: number; unhealthy: number; total: number };
}

export interface DiagnosisIssue {
  id: string;
  severity: "critical" | "warning" | "info";
  titleAr: string;
  detailAr: string;
  /** سبب جذر مفترض. */
  causeAr: string;
  /** الخدمة المسببة. */
  sourceService: string | null;
  /** الإصلاح المقترح. */
  fix: {
    /** إصلاح قابل للتطبيق بضغطة زر عبر actions مسجّلة في الخادم. */
    action: InfraActionId | null;
    /** وسائط الإصلاح (معرّف حاوية مثلاً). */
    args?: Record<string, string>;
    /** إصلاح يدوي — خطوات مقترحة فقط. */
    manualStepsAr?: string[];
  };
}

export interface DiagnosisReport {
  generatedAt: string;
  issues: DiagnosisIssue[];
}

// ---------------------------------------------------------------------------
// العمليات
// ---------------------------------------------------------------------------

/** كل عمليات البنية المسموحة — القائمة البيضاء. لا تُقبل سلاسل أوامر حرة. */
export type InfraActionId =
  // حاويات
  | "container.start"
  | "container.stop"
  | "container.restart"
  | "container.recreate"
  | "container.remove"
  // قاعدة البيانات
  | "db.start"
  | "db.stop"
  | "db.restart"
  | "db.reset"
  | "db.dump"
  | "db.restore"
  // Supabase
  | "supabase.start"
  | "supabase.stop"
  | "supabase.status"
  | "migrations.list"
  | "migrations.repair"
  | "migrations.diff"
  | "migrations.push"
  | "migrations.pull"
  // Seeds
  | "seed.list"
  // Git
  | "git.fetch"
  | "git.pull"
  | "git.push"
  | "git.status"
  | "git.stash"
  | "git.stashPop"
  | "git.checkout"
  | "git.createBranch"
  | "git.deleteBranch"
  | "git.merge"
  | "git.log"
  // صيانة
  | "maintenance.pruneImages"
  | "maintenance.pruneContainers"
  | "maintenance.pruneNetworks"
  | "maintenance.pruneVolumes"
  | "maintenance.removeDangling"
  | "maintenance.rebuildImages";

export interface ActionResult {
  ok: boolean;
  action: InfraActionId;
  output: string;
  durationMs: number;
  auditId: string;
  /** عمليات خطر تتطلب تأكيداً نصياً إضافياً. */
  requiredConfirmation?: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  userId: string | null;
  action: string;
  ok: boolean;
  durationMs: number;
  argsSummary: string;
  exitCode: number | null;
  outputTail: string;
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

export interface GitFileStatus {
  path: string;
  /** M / A / D / R / ? وغيرها. */
  code: string;
  staged: boolean;
}

export interface GitBranch {
  name: string;
  current: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

export interface GitStatusReport {
  available: boolean;
  error?: string;
  repoPath: string;
  currentBranch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  detached: boolean;
  files: GitFileStatus[];
  modified: string[];
  added: string[];
  deleted: string[];
  untracked: string[];
  branches: GitBranch[];
  lastCommits: GitCommit[];
  contributors: { name: string; commits: number }[];
  lastFetchAt: string | null;
  lastPushAt: string | null;
  remotes: { name: string; url: string }[];
  stashes: string[];
}

export interface GitUpdateCheck {
  available: boolean;
  error?: string;
  currentBranch: string;
  /** عدد الـ commits الجديدة على الأصل بعد آخر fetch. */
  incomingCommits: number;
  /** commits محلية غير مرفوعة. */
  outgoingCommits: number;
  incoming: GitCommit[];
  outgoing: GitCommit[];
  /** ملفات تتأثر بالسحب (diff --stat مقابل الأصل). */
  affectedFiles: { path: string; changes: string }[];
  upToDate: boolean;
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

export type SupabaseMode = "local" | "cloud" | "linked-both" | "unknown";

export interface SupabaseStatusReport {
  available: boolean;
  error?: string;
  mode: SupabaseMode;
  /** حالة الخدمات المحلية (supabase status). */
  local: {
    running: boolean;
    stoppedServices: string[];
    urls: Record<string, string>;
    /** مفتاح مشروع محلي من config.toml. */
    projectRef: string | null;
  };
  /** حالة الارتباط بالسحابة إن وُجد. */
  cloud: {
    linked: boolean;
    projectRef: string | null;
    projectName: string | null;
  };
}

export interface MigrationInfo {
  version: string;
  name: string;
  /** local = موجودة محلياً فقط، remote = مطبقة سحابياً فقط، both. */
  location: "local" | "remote" | "both";
}

export interface MigrationStatusReport {
  available: boolean;
  error?: string;
  /** مخرجات supabase migration list مجردة. */
  migrations: MigrationInfo[];
  pending: number;
  appliedRemoteOnly: number;
  seedFiles: {
    name: string;
    path: string;
    kind: "system" | "company" | "samples" | "tests" | "other";
  }[];
}
