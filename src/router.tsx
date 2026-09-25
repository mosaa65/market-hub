import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Phase 4 Optimization: Smart caching to eliminate redundant server queries
        staleTime: 1000 * 60 * 3, // Data stays fresh for 3 minutes
        gcTime: 1000 * 60 * 30, // Unused cache kept for 30 minutes in memory
        refetchOnWindowFocus: false, // Prevent aggressive network requests when switching tabs
        refetchOnReconnect: "always", // Ensure fresh data on network reconnect
        retry: 1, // Avoid infinite retry loops on client errors
      },
      mutations: {
        retry: 0,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 1000 * 60 * 5,
  });

  return router;
};
