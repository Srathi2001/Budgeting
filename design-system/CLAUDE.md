# Design system — Al Naboodah Budget

All UI in this project follows the design system in this folder. Before building or changing any screen, table or chart:

1. Read `README.md` (the rules) and the matching `previews/<Component>.md` + `previews/<Component>.html` (reference markup).
2. Load `tokens.css` then `components.css` once at the app root. Use the CSS variables and `anh-*` classes; never hard-code a hex value, font or spacing.
3. Interface is black, white and gray. Colour appears only in chart marks and segment keys.
4. Chart colours are fixed per segment — map by key, never by index:
   - Divisions: `--div-contracting`, `--div-facilities`, `--div-plant`, `--div-realestate`, `--div-corporate`
   - Measures: `--m-actual` (actual, spent; forecast dotted), `--m-budget`, `--m-committed`, `--chart-other` (available)
   - Cost categories: `--cat-labour`, `--cat-materials`, `--cat-plant`, `--cat-overheads`, `--cat-other`
   - Labels inside a fill use its `--on-*` token.
5. Tables: `table.anh-grid` with `tr.h2` / `tr.h1` headers; cells `td.input` (editable), `td.locked`, `td.calc`; rows `section`, `child`, `subtotal`, `total`.
6. Minimal: no emoji, no decorative icons or symbols, no helper text, no chart footnotes. Short sentence-case labels.
7. Dark mode: set `data-theme="dark"` on `<html>`.
