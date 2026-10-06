Design system for the Al Naboodah budgeting dashboard. The interface is black, white and gray. Charts are in colour, and every segment keeps one fixed colour.

## Principles

- **Minimal.** Say it once, in as few words as possible. No emoji, no decorative glyphs or icons, no helper text unless it prevents an error, no footnotes under charts.
- **Figures first.** Chrome stays quiet so `kpi-xl` and `td` figures lead.
- **Ink means attention.** Solid `ink` only for the primary action, the tier-1 header, the grand total and a breached variance.
- **Square and ruled.** `radius-0` everywhere except controls (`radius-sm`). Hairlines and rules, never shadows on cards.

## Copy

- Sentence case; uppercase only in `label`, `th` and tags.
- Short labels: "Submit", "Export", "Actual vs budget". Units once, in the subtitle: "AED M · YTD".
- Amounts: thousands separators; one decimal in millions (`85.4M`); negatives in parentheses in tables (`.anh-neg`).
- Dates "30 Sep 2026"; periods `Q1`, `YTD`, `FY 2027`.

## Colour

Themes: **Paper** (light) and **Carbon** (dark).

| Role | Tokens |
| --- | --- |
| Grounds | `ground` page, `surface` panels, `surface-sunken` sidebar |
| Text | `ink` figures, `ink-2` labels and locked cells, `ink-muted` units, `ink-inverse` on black |
| Lines | `line` dividers, `control-border` anything clickable, `line-strong` 2px rules |
| Focus | `focus`, 2px solid, 2px offset |

## Tables

`.anh-grid` in `.anh-grid-wrap`. Rows `row-compact` (28px) for entry, `.anh-grid--report` (36px) for reports.

| Element | Look |
| --- | --- |
| Column header | `header-1` black, `ink-inverse`, uppercase `th` |
| Period group header | `header-2` gray |
| Section row | `header-3` light gray, bold |
| Editable cell `td.input` | white, boxed in `control-border` |
| Locked cell `td.locked` | gray fill, `ink-2` text |
| Calculated cell `td.calc` | faint gray, no box |
| Selected / unsaved / error | 2px outline / corner notch / hatch + bold |
| Subtotal / total | `cell-subtotal` / `cell-total` black with double rule |

Numbers right-aligned with tabular figures. No zebra stripes. Never colour a cell for variance. One short cell legend above entry grids.

## Variance and status

- `.anh-var`: ▲ / ▼ for direction, underline when adverse, solid black chip past 10%.
- `.anh-tag`: Approved (black), In review (gray), Draft (outline), Locked (dashed), Returned (hatched). The word carries the meaning.

## Charts

Every presented chart is in colour. One segment, one colour, everywhere. A chart colours by one registry only.

| Divisions | Measures | Cost categories |
| --- | --- | --- |
| Contracting `div-contracting` blue | Actual · Spent `m-actual` navy | Labour `cat-labour` violet |
| Facilities `div-facilities` saffron | Forecast `m-actual` navy dotted | Materials `cat-materials` green |
| Plant hire `div-plant` teal | Budget `m-budget` slate | Plant & fleet `cat-plant` sky |
| Real Estate `div-realestate` rust | Committed `m-committed` light navy | Overheads `cat-overheads` raspberry |
| Corporate `div-corporate` orchid | Available `chart-other` gray | Other `cat-other` warm gray |

- Map colour by segment key, never by position. Keep registry order in legends, pies and stacks.
- Labels inside a fill use its `on-*` token.
- Registries are validated for colour-blind separation in both themes; keep the legend on every chart.
- `chart-1`…`chart-5` are the gray fallback for print only.

Forms: **Bar** (division colours, budget as black tick), **Line** (actual solid, budget dashed, forecast dotted), **Pie** (max five slices), **Donut** (headline in the hole), **100% stacked** (labels only on segments ≥ 8%).

Each chart card has a title, a unit subtitle and a legend. Nothing else. One y-axis. Hover tooltip on lines.

## Type

Archivo for everything; IBM Plex Mono for codes only. `h1` screen title, `h2` card title, `kpi-xl` / `kpi` figures, `label` eyebrows, `th` / `td` tables.

## Layout

232px sidebar, 56px top bar, `space-6` page padding, `space-5` gaps. Page head: `h1` left, filters and one primary button right, 2px rule below. KPI row of four, then chart and table panels.

## Icons and logo

1.5px line icons, 16px, navigation only. No emoji, no illustrations. Logo pending (see Logos); until then the `AN` block and the name in Archivo 800 uppercase.

## Avoid

Emoji, decorative symbols, helper text, chart footnotes, colour outside charts, gradients, card shadows, rounded cards, 3D pies, dual axes, numbers on every point, zebra stripes.
