100% stacked horizontal bar for comparing composition across rows (cost structure by division).

**Consumer provides:** rows, categories (max four plus Other), and percentages summing to 100.

- Same segment order and shade in every row; legend above. Segments take their fixed cost-category colours (`ct-*`); each division row label carries its `.anh-key dv-<key>` colour square so the division colour still identifies the row.
- In-bar labels only where a segment is 8% or more; labels in the segment's `on-cat-*` token.
- 2px gaps between segments; axis at 0/25/50/75/100%.
