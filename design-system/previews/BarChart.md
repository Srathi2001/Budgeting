Vertical bar chart comparing actual against budget across divisions (or months, cost centres).

**Consumer provides:** categories, actual values, budget values, the unit and the source line.

- By division: each bar takes its fixed division colour (`dv-<key>`), budget is a 3px ink target tick (`.target`) across the bar. A bar under its tick is under budget.
- By anything that is not a division (months, cost lines): bars are `m-actual` (navy) for actual and `m-budget` (slate) for budget, side by side with a 2px gap.
- Square tops, value labels on actuals only, 2px `line-strong` baseline. Keep divisions in registry order, not sorted by value.
- More than 8 categories: switch to horizontal bars.
