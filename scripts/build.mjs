#!/usr/bin/env node
// Assembles dist/<browser> from src/ + platforms/<browser>/manifest.json.
// Usage: node scripts/build.mjs <chrome|firefox|safari|all>

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const browsers = ["chrome", "firefox", "safari"];

function buildBrowser(browser) {
  if (!browsers.includes(browser)) {
    throw new Error(`Unknown browser "${browser}". Expected one of: ${browsers.join(", ")}`);
  }

  const { version } = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
  const outDir = path.join(rootDir, "dist", browser);

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  cpSync(path.join(rootDir, "src/css/theme.css"), path.join(outDir, "theme.css"));
  cpSync(path.join(rootDir, "src/icons"), path.join(outDir, "icons"), { recursive: true });

  const manifestPath = path.join(rootDir, "platforms", browser, "manifest.json");
  const manifest = readFileSync(manifestPath, "utf8").replace("__VERSION__", version);
  writeFileSync(path.join(outDir, "manifest.json"), manifest);

  // icon.svg is a store/source asset, not part of the shipped package.
  rmSync(path.join(outDir, "icons", "icon.svg"), { force: true });

  console.log(`Built dist/${browser} (v${version})`);

  if (browser === "safari") {
    console.log(
      "Safari note: dist/safari is a plain web-extension payload. On macOS, run:\n" +
        `  xcrun safari-web-extension-converter "${outDir}"\n` +
        "to generate the Xcode project needed to build/sign/notarize the app extension."
    );
  }
}

const target = process.argv[2] || "all";
const targets = target === "all" ? browsers : [target];
for (const browser of targets) buildBrowser(browser);
