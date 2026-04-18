# Theme Scout

Theme Scout is a Chrome extension that scans the current tab and turns a page's palette and typography into reusable design tokens.

## What it captures

- Colors used for text, backgrounds, borders, outlines, SVG fills, strokes, and caret styles
- Unique font stacks with their most common CSS metrics
- Loaded font file links when they can be resolved from `@font-face` rules or linked stylesheets
- Export-ready CSS variables plus reusable font utility classes

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `d:\scratch\Chrome-get-css`.

## How it works

1. Open the site you want to inspect.
2. Open the Theme Scout popup.
3. Click **Scan Page**.
4. Copy individual CSS snippets, the full theme CSS, or the JSON summary.

## Permission note

The extension uses:

- `activeTab` and `scripting` to inspect the current page on demand
- `<all_urls>` host access so it can resolve linked font stylesheets and surface font source URLs when available

## Nice next upgrades

- Export to Tailwind theme tokens or CSS custom property naming presets
- Contrast checking for the discovered palette
- Grouping fonts by likely role such as body, heading, and UI
- Screenshot-backed swatches that show where each token appeared on the page
