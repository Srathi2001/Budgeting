A headline-figure tile for the dashboard KPI row, with optional budget progress bar and variance chip.

**Consumer provides:** eyebrow label, value (currency prefix in `small`), optional progress (% consumed and % of year elapsed for the target tick), a short footer and a variance chip. No tags or icons in the tile.

- `.anh-kpi` default uses `kpi-xl`; `.anh-kpi--compact` uses `kpi` for rows of four.
- `.anh-kpi--inverse` (solid ink) is for the one tile that needs action — at most one per row.
- The progress bar's tick (`i`) marks where spend should be today; the fill is `m-actual` on a `chart-other` track.
- No icons, sparklines or trend arrows beyond the variance chip.
