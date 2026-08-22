#!/usr/bin/env node
// Assembles dist/<browser> from src/ + platforms/<browser>/manifest.json.
// Usage: node scripts/build.mjs <chrome|firefox|safari|all>

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const browsers = ["chrome", "firefox", "safari"];

/* theme.css is authored against one wrapper selector, but the clauses need
   different gating, and CSS can't share a declaration block across a gated and
   an ungated selector, so the build splits it rather than the source repeating.
   Single mode uses the slot named by data-color-mode; auto mode uses the day
   slot when the OS is light and the night slot when it is dark. Every slot can
   hold a dark theme, so all four combinations need covering. */
const SLOTS = [
  { media: null, pairs: [["light", "light"], ["dark", "dark"]] },
  { media: "(prefers-color-scheme: light)", pairs: [["auto", "light"]] },
  { media: "(prefers-color-scheme: dark)", pairs: [["auto", "dark"]] },
];

/* theme.css carries two wrappers: the palette, and the high-contrast tier layered
   on top of it for GitHub's *_high_contrast themes. Both need the same gating, so
   both are generated from SLOTS with an extra attribute clause for the second. */
const WRAPPERS = ["", "high_contrast"];

const selectorFor = (mode, slot, extra) =>
  `[data-color-mode="${mode}"][data-${slot}-theme*="dark"]` +
  (extra ? `[data-${slot}-theme*="${extra}"]` : "");

const scopesFor = (extra) =>
  SLOTS.map(({ media, pairs }) => ({
    media,
    selectors: pairs.map(([mode, slot]) => selectorFor(mode, slot, extra)),
  }));

const headerFor = (extra) =>
  `${scopesFor(extra).flatMap((s) => s.selectors).join(",\n")} {`;

// Index of the "}" closing the rule at openBrace. Skips comments.
function findRuleEnd(css, openBrace) {
  let depth = 0;
  for (let i = openBrace; i < css.length; i += 1) {
    if (css.startsWith("/*", i)) {
      const end = css.indexOf("*/", i + 2);
      if (end === -1) break;
      i = end + 1;
    } else if (css[i] === "{") {
      depth += 1;
    } else if (css[i] === "}" && (depth -= 1) === 0) {
      return i;
    }
  }
  throw new Error("theme.css: unbalanced braces in the wrapper rule.");
}

function expandThemeScope(css) {
  let out = "";
  let rest = css;

  for (const extra of WRAPPERS) {
    const header = headerFor(extra);
    const start = rest.indexOf(header);
    if (start === -1) {
      throw new Error(
        `theme.css: wrapper selector not found. Expected:\n${header}\n` +
          "If it was renamed, update SLOTS/WRAPPERS in scripts/build.mjs."
      );
    }
    if (rest.includes(header, start + 1)) {
      throw new Error(`theme.css: wrapper "${extra || "palette"}" appears more than once.`);
    }

    const openBrace = start + header.length - 1;
    const closeBrace = findRuleEnd(rest, openBrace);
    const body = rest.slice(openBrace + 1, closeBrace);

    out +=
      rest.slice(0, start) +
      (out ? "" : "/* Wrapper expanded by scripts/build.mjs — edit src/css/theme.css instead. */\n") +
      scopesFor(extra)
        .map(({ selectors, media }) => {
          const rule = `${selectors.join(",\n")} {${body}}\n`;
          return media ? `@media ${media} {\n${rule}}\n` : rule;
        })
        .join("\n");
    rest = rest.slice(closeBrace + 1);
  }

  return out + rest;
}

function buildBrowser(browser) {
  if (!browsers.includes(browser)) {
    throw new Error(`Unknown browser "${browser}". Expected one of: ${browsers.join(", ")}`);
  }

  const { version } = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
  const outDir = path.join(rootDir, "dist", browser);

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const theme = readFileSync(path.join(rootDir, "src/css/theme.css"), "utf8");
  writeFileSync(path.join(outDir, "theme.css"), expandThemeScope(theme));
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
