#!/usr/bin/env node
// Regenerates src/icons/* from src/icons/icon.svg. Run after changing the art:
//   npm run icons
// The results are committed, so the normal build needs neither sharp nor svgo.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";
import { optimize } from "svgo";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const iconDir = path.join(rootDir, "src/icons");

/* Chrome needs 128 (install and store), 48 (extensions page) and 16 (favicon);
   32 covers Windows and HiDPI 16. Chrome rejects SVG, so it and Safari ship
   these. Firefox takes icon.min.svg instead and scales it itself. */
const SIZES = [16, 32, 48, 128];

const source = readFileSync(path.join(iconDir, "icon.svg"), "utf8");
if (!/viewBox=/.test(source)) {
  throw new Error("icon.svg needs a viewBox; Firefox will not scale it without one.");
}

const { data: minified } = optimize(source, { multipass: true });
writeFileSync(path.join(iconDir, "icon.min.svg"), minified);
console.log(`icon.min.svg  ${source.length} -> ${minified.length} bytes`);

// density keeps the rasteriser sampling well above the largest target
const svg = Buffer.from(minified);
let total = 0;
for (const size of SIZES) {
  const png = await sharp(svg, { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  writeFileSync(path.join(iconDir, `icon${size}.png`), png);
  total += png.length;
  console.log(`icon${size}.png`.padEnd(14) + `${png.length} bytes`);
}
console.log(`${SIZES.length} PNGs, ${total} bytes total`);
