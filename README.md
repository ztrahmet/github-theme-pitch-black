# GitHub Pitch Black Theme

![Open Source Love](https://badges.frapsoft.com/os/v1/open-source.svg?v=103)
[![Chrome](https://img.shields.io/badge/Chrome_Web_Store-Available-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/oipinkhefglinifinekdbanfmblfniao)
[![Firefox](https://img.shields.io/badge/Firefox_Add--ons-Available-FF7139?logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/en-US/firefox/addon/github-theme-pitch-black/)
[![Safari](https://img.shields.io/badge/Safari_Extensions-Build_from_Source-000000?logo=safari&logoColor=white)](#build-from-source)

A zero-latency, native **Pitch Black** theme for GitHub.

Unlike style managers or JavaScript-based themes, this is a native browser extension: pure CSS, injected at `document_start`. No flash of unstyled content, no runtime overhead, no JavaScript execution at all.

![Screenshot](store-assets/screenshot.png)

## Features

- **True Pitch Black** — replaces GitHub's default dark tint (`#0d1117`) with pure `#000000`
- **Neutral Palette** — desaturated borders, buttons, and text for a clean, distraction-free look
- **High Contrast UI** — lighter surfaces (`#161616`) for inputs, dropdowns, and buttons to preserve visual hierarchy
- **Zero Latency** — pure CSS content script, applied before first paint
- **Privacy First** — no JavaScript, no analytics, no network calls, no background processes

## Install

| Browser | Source |
|---|---|
| Chrome, Edge, Brave, Opera, Vivaldi, Arc | [Chrome Web Store](https://chromewebstore.google.com/detail/oipinkhefglinifinekdbanfmblfniao) |
| Firefox | [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/github-theme-pitch-black/) |
| Safari | [Build from source](#build-from-source) — not yet on the App Store |

### Build from source

```bash
git clone https://github.com/ztrahmet/github-theme-pitch-black.git
cd github-theme-pitch-black
npm run build:chrome   # or build:firefox / build:safari / build:all
```

Each target is built independently from the same `src/` files into `dist/<browser>/`. Load it unpacked:

| Browser | Steps |
|---|---|
| Chrome / Edge / Brave / Opera / Vivaldi / Arc | `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `dist/chrome` |
| Firefox | `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → select `dist/firefox/manifest.json` |
| Safari | requires macOS + Xcode: `xcrun safari-web-extension-converter dist/safari`, then build/run the generated project from Xcode |

## Customization

1. Edit `src/css/theme.css` — the single source file shared by every browser build.
2. Re-run the relevant `npm run build:*` command.
3. Reload the extension from your browser's extension page and refresh GitHub.

## Development

### Project structure

```
src/css/theme.css          single source of truth for the theme
src/icons/                  shared icon set
platforms/<browser>/        per-browser manifest.json (chrome, firefox, safari)
scripts/build.mjs           assembles dist/<browser> from src/ + platforms/<browser>
store-assets/               screenshots and store listing assets
dist/                       build output (gitignored)
```

### Commands

| Command | Output |
|---|---|
| `npm run build:chrome` / `build:firefox` / `build:safari` / `build:all` | Unpacked build in `dist/<browser>/`, for local testing |
| `npm run package:chrome` / `package:firefox` / `package:all` | Zipped store package in `dist/artifacts/<browser>/*.zip` |
| `npm run lint:firefox` | Runs `web-ext lint` against the Firefox build (AMO validation) |

Safari has no `package:safari` script — the Mac App Store requires a signed, notarized Xcode archive rather than a `.zip`, so packaging there is the `xcrun` step above followed by a submission through Xcode/App Store Connect.

## Contributing

Found a UI element that's still blue or lacks contrast? Contributions are welcome.

1. Fork the project
2. Create a feature branch (`git checkout -b feature/fix-button-color`)
3. Commit your changes
4. Push to the branch
5. Open a pull request

## License

Distributed under the MIT License. See `LICENSE` for details.
