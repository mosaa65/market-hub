import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

/**
 * Resilient QueryClient.
 *
 * The audit found the app had a bare `new QueryClient()` — no retry policy, no
 * offline awareness, no cache tuning. On a shop floor with flaky connectivity a
 * single dropped request showed an error immediately, and every navigation
 * refetched from scratch.
 *
 *  - retry transient failures with exponential backoff, never a 4xx
 *  - never retry while the browser reports offline — wait for reconnect
 *  - short stale window so navigation is instant, 5-minute cache
 *  - refetch on reconnect so returning from a dead zone self-heals
 *  - do NOT refetch on window focus (POS terminals keep several tabs open)
 */
function isRetryable(failureCount: number, error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  if (failureCount >= 3) return false;

  const message = error instanceof Error ? error.message : String(error ?? "");
  const status = (error as { status?: number } | null)?.status;

  // Client errors will not succeed on a second attempt.
  if (typeof status === "number" && status >= 400 && status < 500) return false;
  // Cancellation is not a failure worth retrying.
  if (/aborted|AbortError/i.test(message)) return false;

  return true;
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: isRetryable,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        // Keep the previous page visible while the next one loads instead of
        // flashing a skeleton on every filter change.
        placeholderData: (previous: unknown) => previous,
        networkMode: "online",
      },
      mutations: {
        // Mutations are not idempotent — never auto-retry.
        retry: 0,
        networkMode: "online",
      },
    },
  });
}

export const getRouter = () => {
  const queryClient = createQueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
