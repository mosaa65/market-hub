/**
 * سجل خدمات Supabase المحلية — المصدر الوحيد لتعريف الخدمات ورسم الاعتماد.
 *
 * بيانات محضة (لا React / لا Node) تُستهلك من الواجهة ومن جامع الحالة معاً.
 * أسماء الحاويات تتبع نمط supabase_<service>_<projectRef> القادم من Supabase
 * CLI، والمشروع الحالي kwzqvgdyadylwnvjghqn.
 */
import type { ServiceHealthEntry } from "./types";

export interface ServiceDefinition {
  key: string;
  /** الاسم القادم من Supabase CLI. */
  service: string;
  label: string;
  labelEn: string;
  /** الخدمات التي يجب أن تعمل قبلها. */
  dependsOn: string[];
  /** فحص HTTP اختياري عند تشغيل الخدمة. */
  httpProbe?: string;
  /** أهمية الخدمة لواجهة المشروع. */
  critical?: boolean;
  /** منافذ مضيفة تُعرض. */
  hostPorts?: number[];
}

export const DEFAULT_PROJECT_REF = "kwzqvgdyadylwnvjghqn";

export const SERVICES: ServiceDefinition[] = [
  {
    key: "docker",
    service: "docker",
    label: "محرك Docker",
    labelEn: "Docker Engine",
    dependsOn: [],
  },
  {
    key: "vector",
    service: "vector",
    label: "Vector (Analytics Logs)",
    labelEn: "Vector",
    dependsOn: ["docker"],
  },
  {
    key: "analytics",
    service: "analytics",
    label: "Analytics API",
    labelEn: "Analytics API",
    dependsOn: ["docker", "vector"],
  },
  {
    key: "db",
    service: "db",
    label: "PostgreSQL",
    labelEn: "PostgreSQL",
    dependsOn: ["docker"],
    critical: true,
    hostPorts: [5432],
  },
  {
    key: "pg_meta",
    service: "pg_meta",
    label: "Meta API",
    labelEn: "Meta API",
    dependsOn: ["docker", "db"],
  },
  {
    key: "rest",
    service: "rest",
    label: "REST (PostgREST)",
    labelEn: "REST API",
    dependsOn: ["docker", "db"],
    critical: true,
  },
  {
    key: "realtime",
    service: "realtime",
    label: "Realtime",
    labelEn: "Realtime",
    dependsOn: ["docker", "db"],
    critical: true,
  },
  {
    key: "storage",
    service: "storage",
    label: "Storage",
    labelEn: "Storage",
    dependsOn: ["docker", "db"],
    critical: true,
  },
  {
    key: "imgproxy",
    service: "imgproxy",
    label: "ImgProxy",
    labelEn: "ImgProxy",
    dependsOn: ["docker", "storage"],
  },
  {
    key: "kong",
    service: "kong",
    label: "Kong (API Gateway)",
    labelEn: "Kong Gateway",
    dependsOn: ["docker", "rest", "auth", "storage", "realtime"],
    critical: true,
    hostPorts: [54321],
  },
  {
    key: "auth",
    service: "auth",
    label: "GoTrue (Auth)",
    labelEn: "Auth",
    dependsOn: ["docker", "db"],
    critical: true,
  },
  {
    key: "studio",
    service: "studio",
    label: "Studio",
    labelEn: "Studio",
    dependsOn: ["docker", "db", "pg_meta"],
    critical: true,
    httpProbe: "http://127.0.0.1:54323",
    hostPorts: [54323],
  },
  {
    key: "edge_runtime",
    service: "edge_runtime",
    label: "Edge Functions",
    labelEn: "Edge Functions",
    dependsOn: ["docker", "db"],
  },
  {
    key: "inbucket",
    service: "inbucket",
    label: "Inbucket (Mail)",
    labelEn: "Mailpit",
    dependsOn: ["docker"],
    hostPorts: [54324],
  },
  {
    key: "pooler",
    service: "pooler",
    label: "Pooler (Supavisor)",
    labelEn: "Pooler",
    dependsOn: ["docker", "db"],
  },
  {
    key: "pubsub",
    service: "pubsub",
    label: "PubSub",
    labelEn: "PubSub",
    dependsOn: ["docker", "db"],
  },
];

export function containerName(service: string, projectRef = DEFAULT_PROJECT_REF): string {
  return `supabase_${service}_${projectRef}`;
}

/** رسم الاعتماد بترتيب موجّه — أعلى: docker ثم PostgreSQL ثم البوابة ثم الواجهة. */
export function dependencyOrder(): ServiceDefinition[] {
  return [...SERVICES].sort((a, b) => {
    if (a.key === "docker") return -1;
    if (b.key === "docker") return 1;
    if (a.key === "db") return -1;
    if (b.key === "db") return 1;
    if (a.key === "kong") return -1;
    if (b.key === "kong") return 1;
    return a.dependsOn.length - b.dependsOn.length;
  });
}

export function serviceDef(key: string): ServiceDefinition | undefined {
  return SERVICES.find((s) => s.key === key);
}

export function toEntry(def: ServiceDefinition): ServiceHealthEntry {
  return {
    serviceKey: def.key,
    label: def.label,
    labelEn: def.labelEn,
    containerName: null,
    state: "absent",
    health: "unknown",
    uptimeSeconds: null,
    restartCount: null,
    image: null,
    ports: (def.hostPorts ?? []).map(String),
    cpuPercent: null,
    memUsedMb: null,
    memLimitMb: null,
    httpProbe: null,
    dependsOn: def.dependsOn,
  };
}
