// Dev-only UI screenshot harness. Renders a single component in isolation
// with caller-supplied mock props, so `scripts/screenshot-component.mjs`
// (Playwright) can capture before/after PNGs for PR visual diffs.
//
// NOT part of the shipped app: `vite build` only processes index.html
// (src/main.tsx), this file/harness.html are only served by `vite dev`.
// Also outside tsconfig.json's "include" (src-only), so it isn't part of
// the `tsc --noEmit` gate either; this reference keeps editor tooling sane.
/// <reference types="vite/client" />
import { createRoot } from "react-dom/client";
import "../src/styles/globals.css";

// Bounded dynamic import set — only files under src/ are reachable here,
// resolved by Vite at build/dev time via import.meta.glob.
const modules = import.meta.glob("/src/**/*.tsx") as Record<
  string,
  () => Promise<Record<string, unknown>>
>;

declare global {
  interface Window {
    __harnessReady?: boolean;
    __harnessError?: string;
  }
}

async function main() {
  const params = new URLSearchParams(window.location.search);
  const componentPath = params.get("component"); // e.g. /src/components/layout/Sidebar.tsx
  const exportName = params.get("export") || "default";
  let props: Record<string, unknown> = {};
  try {
    const rawProps = params.get("props");
    if (rawProps) props = JSON.parse(rawProps);
  } catch (err) {
    window.__harnessError = `Failed to parse props JSON: ${String(err)}`;
    return;
  }

  if (!componentPath || !modules[componentPath]) {
    window.__harnessError = `Unknown component path: ${componentPath}. Available: ${Object.keys(modules).join(", ")}`;
    return;
  }

  try {
    const mod = await modules[componentPath]();
    const Comp = mod[exportName] as React.ComponentType<Record<string, unknown>> | undefined;
    if (!Comp) {
      window.__harnessError = `Export "${exportName}" not found in ${componentPath}. Available exports: ${Object.keys(mod).join(", ")}`;
      return;
    }
    const root = createRoot(document.getElementById("harness-root")!);
    root.render(
      <div
        id="harness-frame"
        style={{
          display: "inline-block",
          background: "var(--bg-canvas, #0b0e14)",
          padding: 16,
        }}
      >
        <Comp {...props} />
      </div>,
    );
    window.__harnessReady = true;
  } catch (err) {
    window.__harnessError = `Render failed: ${String(err)}`;
  }
}

void main();
