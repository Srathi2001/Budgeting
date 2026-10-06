The budget entry and reporting grid: two-tier headers, section/child/subtotal/total rows, and editable, locked and calculated cells.

**Consumer provides:** column definitions (which are input, locked, calculated), row hierarchy, values already formatted, and the edit/selection state classes.

- Table: `table.anh-grid` inside `.anh-grid-wrap`. Header rows: `tr.h2` (period groups) then `tr.h1` (column names).
- Body rows: `tr.section`, `tr.child`, `tr.subtotal`, `tr.total`. Cells: `td.input`, `td.locked`, `td.calc`, plus `.is-selected`, `.is-dirty`, `.is-error`.
- Numbers: `td.anh-num`; negatives wrapped in `.anh-neg` render in parentheses.
- Always show the cell legend (`.anh-legend-cells`) above an entry grid and the unit at its right.
- Don't zebra-stripe, don't colour cells for variance, don't make calculated cells editable-looking.
