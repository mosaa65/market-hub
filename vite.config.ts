import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";
import { loadEnv } from "vite";

const DEVELOPMENT_SERVER_ENV_KEYS = [
  "SUPABASE_TARGET",
  "VITE_SUPABASE_TARGET",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export default defineConfig(({ mode }) => {
  // Vite exposes .env values to import.meta.env, but server functions read
  // process.env. Hydrate only the server-side Supabase allowlist for local dev;
  // production receives runtime secrets from its environment/Compose instead.
  if (mode === "development") {
    const localEnv = loadEnv(mode, process.cwd(), "");
    for (const key of DEVELOPMENT_SERVER_ENV_KEYS) {
      if (process.env[key] === undefined && localEnv[key] !== undefined) {
        process.env[key] = localEnv[key];
      }
    }
  }

  return {
    vite: {
      server: {
        host: "0.0.0.0",
        port: 3000,
        strictPort: true,
      },
    },
    plugins: [
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: "auto",
        manifest: false,
        workbox: {
          // Nitro outputs the client bundle into .output/public, not ./dist.
          // Without this, precache finds zero files (warning in build log).
          globDirectory: ".output/public",
          globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff2}"],
          navigateFallback: null,
          runtimeCaching: [
            {
              urlPattern: ({ request }) =>
                request.destination === "style" ||
                request.destination === "script" ||
                request.destination === "worker",
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "vortex-static-assets",
              },
            },
            {
              urlPattern: ({ request }) => request.destination === "image",
              handler: "CacheFirst",
              options: {
                cacheName: "vortex-images",
                expiration: {
                  maxEntries: 60,
                  maxAgeSeconds: 30 * 24 * 60 * 60,
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],
    tanstackStart: {
      server: { entry: "server" },
    },
  };
});
