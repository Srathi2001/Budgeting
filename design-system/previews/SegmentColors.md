The colour registries: every division, measure and cost category owns one colour, and that colour never changes or moves to anything else anywhere on the dashboard.

Measures: `m-actual` (navy — Actual, Spent, and Forecast dotted), `m-budget` (slate), `m-committed` (light navy). Cost categories: `cat-labour` (violet), `cat-materials` (green), `cat-plant` (sky), `cat-overheads` (raspberry), `cat-other` (warm gray). Divisions:

| Division | Fill | Label on fill |
| --- | --- | --- |
| Contracting | `div-contracting` (blue) | `on-div-contracting` |
| Facilities Management | `div-facilities` (saffron) | `on-div-facilities` |
| Plant & Equipment Hire | `div-plant` (teal) | `on-div-plant` |
| Real Estate | `div-realestate` (rust) | `on-div-realestate` |
| Corporate & Shared Services | `div-corporate` (orchid) | `on-div-corporate` |

**Consumer provides:** the division key of each data point; map it to the class `dv-<key>` / `m-<measure>` / `ct-<category>` (fills, legend keys, `.anh-key` table keys) or `ln-<key>` (lines). Never map by position or rank.

- One registry per chart. Status and variance stay black-and-white glyphs and words, never chart colours.
- A filter that hides divisions must not repaint the ones left. Keep the registry order (Contracting → Corporate) in legends, pies and stacks, so slices never swap places between charts.
- The five fills were validated together: every pair stays distinguishable for colour-blind readers in both themes, so any two can sit side by side. Saffron and orchid are under 3:1 on white in Paper, so always show the legend and direct labels with them.
- Inside a fill, print labels in its `on-div-*` token, never plain white.
- A new division gets a new registry entry (validated against the five), never a reused colour.
