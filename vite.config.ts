import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// Only engaged by `playwright.config.ts` (E2E_MOCK=1). Never set during
// `npm run dev`/`npm run build`/`npm run tauri *`, so the production app and
// its Tauri IPC calls are completely unaffected.
const e2eMock = process.env.E2E_MOCK === "1";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: e2eMock
    ? {
        alias: {
          "@tauri-apps/api/core": fileURLToPath(new URL("./e2e/mocks/tauri-core.ts", import.meta.url)),
          "@tauri-apps/api/event": fileURLToPath(new URL("./e2e/mocks/tauri-event.ts", import.meta.url)),
        },
      }
    : undefined,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    // vitest's default include glob (**/*.{test,spec}.*) also matches the
    // Playwright e2e specs under e2e/tests/*.spec.ts; keep the two runners
    // separate (`npm test` = vitest unit tests, `npm run test:e2e` = Playwright).
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.{idea,git,cache,output,temp}/**",
      "e2e/**",
    ],
  },
});
