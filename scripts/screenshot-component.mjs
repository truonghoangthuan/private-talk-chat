#!/usr/bin/env node
// Dev-only tool: screenshots one component from harness.html in isolation,
// for PR before/after visual diffs. Not part of the shipped app.
//
// Usage:
//   node scripts/screenshot-component.mjs \
//     --component /src/components/layout/Sidebar.tsx \
//     --export Sidebar \
//     --props '{"currentUserId":"u1", ...}' \
//     --out .pr-screenshots/sidebar-filter/after.png
//
// Run once with the pre-change code checked out (--out .../before.png),
// then again after implementing the change (--out .../after.png).

import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, "");
    args[key] = argv[i + 1];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const componentPath = args.component;
  const exportName = args.export || "default";
  const props = args.props || "{}";
  const outPath = args.out;
  const width = Number(args.width || 480);

  if (!componentPath || !outPath) {
    console.error(
      "Usage: node scripts/screenshot-component.mjs --component /src/components/X.tsx --export X --props '{...}' --out path/to.png",
    );
    process.exit(1);
  }

  // Validate props JSON early with a clear error.
  JSON.parse(props);

  const server = await createServer({
    root: repoRoot,
    configFile: resolve(repoRoot, "vite.config.ts"),
    server: { port: 0, strictPort: false, host: "127.0.0.1" },
    logLevel: "error",
  });
  await server.listen();
  const resolvedPort = server.config.server.port;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: width + 32, height: 900 } });
    page.on("console", (msg) => console.error(`[console:${msg.type()}] ${msg.text()}`));
    page.on("pageerror", (err) => console.error(`[pageerror] ${err.message}`));
    const url = `http://127.0.0.1:${resolvedPort}/harness.html?component=${encodeURIComponent(componentPath)}&export=${encodeURIComponent(exportName)}&props=${encodeURIComponent(props)}`;
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForFunction(
      () => Boolean(window.__harnessReady) || Boolean(window.__harnessError),
      { timeout: 15000 },
    );
    const harnessError = await page.evaluate(() => window.__harnessError);
    if (harnessError) {
      throw new Error(`Harness error: ${harnessError}`);
    }
    await mkdir(dirname(resolve(repoRoot, outPath)), { recursive: true });
    await page.locator("#harness-frame").screenshot({ path: resolve(repoRoot, outPath) });
    console.log(`Screenshot saved: ${outPath}`);
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((err) => {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
});
