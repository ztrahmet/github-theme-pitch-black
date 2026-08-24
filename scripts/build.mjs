#!/usr/bin/env node
// Assembles dist/<browser> from src/ + platforms/<browser>/manifest.json.
// Usage: node scripts/build.mjs <chrome|firefox|safari|all>

import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { transform } from "lightningcss";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const browsers = ["chrome", "firefox", "safari"];

/* Chrome rejects SVG icons, so it and Safari ship the PNGs that npm run icons
   generates. Firefox scales one SVG instead. Only what a manifest declares is
   copied, so nothing unused reaches the package. */
const ICONS = {
  chrome: ["icon16.png", "icon32.png", "icon48.png", "icon128.png"],
  safari: ["icon16.png", "icon32.png", "icon48.png", "icon128.png"],
  firefox: [["icon.min.svg", "icon.svg"]],
};

/* Chrome validates _locales directory names against its own supported list and
   rejects anything outside it at upload, so that list is the shared baseline:
   Firefox and Safari accept every code in it. Region variants Chrome already
   resolves by fallback are left out (en_AU/en_GB/en_US -> en, es_419 -> es);
   pt and zh ship both variants because Chrome has no bare code for either. */
const DEFAULT_LOCALE = "en";
const LOCALES = [
  "am", "ar", "bg", "bn", "ca", "cs", "da", "de", "el", "en", "es", "et", "fa",
  "fi", "fil", "fr", "gu", "he", "hi", "hr", "hu", "id", "it", "ja", "kn", "ko",
  "lt", "lv", "ml", "mr", "ms", "nl", "no", "pl", "pt_BR", "pt_PT", "ro", "ru",
  "sk", "sl", "sr", "sv", "sw", "ta", "te", "th", "tr", "uk", "vi", "zh_CN",
  "zh_TW",
];

/* Chrome caps these manifest fields and only reports an overflow at upload,
   which is far too late; the other stores are looser, so Chrome's limits bind.
   Translations run longer than the English source, so this is worth checking. */
const LIMITS = { extName: 75, extDescription: 132 };

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

/* Every custom property and its value, sorted but keeping duplicates, for
   comparing the stylesheet before and after minification. Multiplicity matters:
   the palette is emitted once per media state, so a whole dropped block would
   otherwise hide behind its identical siblings. Values are normalised for the
   rewrites lightningcss is allowed to make: shortened hex, dropped quotes. */
function declarations(css) {
  return [...css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)]
    .map(([, name, value]) => {
      const normalised = value
        .replace(/!important/g, "")
        .replace(/#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3\b/gi, "#$1$2$3")
        .replace(/#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3([0-9a-f])\4\b/gi, "#$1$2$3$4")
        .replace(/\btransparent\b/g, "#0000")
        .replace(/["']/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      return `${name}:${normalised}`;
    })
    .sort();
}

/* Whitespace, comments and colour shortening only. No targets, so lightningcss
   leaves the CSS nesting alone instead of flattening it for older browsers. */
function minifyCss(css, browser) {
  const { code } = transform({
    filename: `${browser}/theme.css`,
    code: Buffer.from(css),
    minify: true,
  });
  const out = code.toString();

  const before = declarations(css);
  const after = declarations(out);
  if (before.join("\n") === after.join("\n")) return out;

  const tally = new Map();
  for (const d of before) tally.set(d, (tally.get(d) ?? 0) + 1);
  for (const d of after) tally.set(d, (tally.get(d) ?? 0) - 1);
  const diff = [...tally]
    .filter(([, n]) => n !== 0)
    .map(([d, n]) => `${n > 0 ? "lost:  " : "gained:"} ${d}`);

  throw new Error(
    `minify changed ${diff.length} declarations in ${browser} ` +
      `(${before.length} before, ${after.length} after).\n` +
      diff.slice(0, 10).map((d) => `  ${d}`).join("\n")
  );
}

function readMessages(locale) {
  const file = path.join(rootDir, "src/_locales", locale, "messages.json");
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    throw new Error(`_locales/${locale}/messages.json is missing, but LOCALES lists "${locale}".`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`_locales/${locale}/messages.json is not valid JSON: ${error.message}`);
  }
}

/* A broken _locales tree makes the extension fail to load outright, and an
   overlong string is only rejected once the store has it, so both are caught
   here. Every locale must define exactly the keys the default locale defines:
   the browser would fall back for a missing one, but the Chrome Web Store's
   upload validator requires every __MSG_ key used in a listing field to be
   present in every locale and rejects the package otherwise. */
function copyLocales(outDir) {
  const present = readdirSync(path.join(rootDir, "src/_locales"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const unlisted = present.filter((locale) => !LOCALES.includes(locale));
  if (unlisted.length) {
    throw new Error(
      `src/_locales holds directories LOCALES does not list: ${unlisted.join(", ")}.\n` +
        "Chrome rejects locale codes outside its supported list, so add them to LOCALES deliberately."
    );
  }

  const base = readMessages(DEFAULT_LOCALE);
  for (const key of Object.keys(LIMITS)) {
    if (!base[key]) throw new Error(`_locales/${DEFAULT_LOCALE}/messages.json is missing "${key}".`);
  }

  for (const locale of LOCALES) {
    const messages = readMessages(locale);
    for (const key of Object.keys(base)) {
      if (!messages[key]) {
        throw new Error(
          `_locales/${locale}/messages.json is missing "${key}", which _locales/${DEFAULT_LOCALE} defines. ` +
            "The Chrome Web Store rejects an upload where a listing field's message is absent from any locale, " +
            "even one the browser would resolve by fallback."
        );
      }
    }

    for (const [key, entry] of Object.entries(messages)) {
      if (!(key in base)) {
        throw new Error(
          `_locales/${locale}/messages.json defines "${key}", which _locales/${DEFAULT_LOCALE} does not. ` +
            "A message the default locale lacks has nothing to fall back to."
        );
      }
      const message = entry?.message;
      if (typeof message !== "string" || message.trim() === "") {
        throw new Error(`_locales/${locale}/messages.json: "${key}" has no message string.`);
      }
      if (message.length > LIMITS[key]) {
        throw new Error(
          `_locales/${locale}/messages.json: "${key}" is ${message.length} characters, ` +
            `over Chrome's limit of ${LIMITS[key]}.`
        );
      }
    }

    const dir = path.join(outDir, "_locales", locale);
    mkdirSync(dir, { recursive: true });
    copyFileSync(
      path.join(rootDir, "src/_locales", locale, "messages.json"),
      path.join(dir, "messages.json")
    );
  }

  return LOCALES.length;
}

function buildBrowser(browser) {
  if (!browsers.includes(browser)) {
    throw new Error(`Unknown browser "${browser}". Expected one of: ${browsers.join(", ")}`);
  }

  const { version } = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
  const outDir = path.join(rootDir, "dist", browser);

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  /* Normalised so the wrapper match works on CRLF checkouts (core.autocrlf). */
  const theme = readFileSync(path.join(rootDir, "src/css/theme.css"), "utf8").replaceAll("\r\n", "\n");
  const expanded = expandThemeScope(theme);
  const minified = minifyCss(expanded, browser);
  writeFileSync(path.join(outDir, "theme.css"), minified);

  mkdirSync(path.join(outDir, "icons"), { recursive: true });
  for (const entry of ICONS[browser]) {
    const [from, to] = Array.isArray(entry) ? entry : [entry, entry];
    copyFileSync(path.join(rootDir, "src/icons", from), path.join(outDir, "icons", to));
  }

  const locales = copyLocales(outDir);

  const manifestPath = path.join(rootDir, "platforms", browser, "manifest.json");
  const manifest = readFileSync(manifestPath, "utf8").replace("__VERSION__", version);
  writeFileSync(path.join(outDir, "manifest.json"), manifest);

  const saved = Math.round((1 - minified.length / expanded.length) * 100);
  const css = `${expanded.length} -> ${minified.length} bytes (-${saved}%)`;
  console.log(`Built dist/${browser} (v${version})  css ${css}  locales ${locales}`);

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
