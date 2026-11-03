export type SupabaseTarget = "docker" | "cloud";

export function parseSupabaseTarget(value: string | undefined): SupabaseTarget {
  const target = value?.trim().toLowerCase();
  if (target === "docker" || target === "cloud") return target;
  throw new Error("Set Supabase target explicitly to `docker` or `cloud`.");
}

export function validateSupabaseTargetUrl(target: SupabaseTarget, value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Supabase URL is missing or invalid for the selected target.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Supabase URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Supabase URL cannot contain credentials, query parameters, or a fragment.");
  }

  const host = url.hostname.toLowerCase();
  const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const isDockerInternal = host === "api-gw" || host.endsWith(".supabase.internal");

  if (target === "cloud" && (isLoopback || isDockerInternal || url.protocol !== "https:")) {
    throw new Error("Cloud target must use an explicit public HTTPS Supabase endpoint.");
  }
  if (target === "docker" && host.endsWith(".supabase.co")) {
    throw new Error("Docker target cannot point to a managed Supabase cloud project.");
  }

  return url.toString().replace(/\/$/, "");
}

export function isPrivilegedSupabaseKey(key: string): boolean {
  if (/^sb_secret_/i.test(key.trim())) return true;
  const payload = key.trim().split(".")[1];
  if (!payload || typeof atob !== "function") return false;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(normalized)) as { role?: unknown };
    return claims.role === "service_role";
  } catch {
    return false;
  }
}
