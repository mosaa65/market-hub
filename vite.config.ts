import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  nitro: {
    preset: "node-server",
  },
  vite: {
    server: {
      host: "0.0.0.0",
      port: 3000,
      allowedHosts: true,
      hmr: false,
    },
    preview: {
      host: "0.0.0.0",
      port: 3000,
      allowedHosts: true,
    },
  },
});
