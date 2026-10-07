// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const isNetlify = process.env.NETLIFY === "true";

export default defineConfig({
  nitro: isNetlify ? false : undefined,
  vite: {
    base: process.env.VITE_BASE_PATH ?? "/",
    ...(isNetlify
      ? {
          environments: {
            client: { build: { outDir: "dist/client" } },
            ssr: { build: { outDir: "dist/server" } },
          },
        }
      : {}),
  },
  tanstackStart: {
    // Emit a static client shell so direct routes can load from the service
    // worker after the first online visit.
    spa: { enabled: true },
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
