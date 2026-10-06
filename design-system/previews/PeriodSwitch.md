Segmented control for period and comparison switching (Month / QTD / YTD / FY; vs Budget / Forecast / prior year), and page tabs.

**Consumer provides:** options, the pressed/selected one, and change handlers.

- `.anh-seg` with `button[aria-pressed]`; the active option is solid ink.
- `.anh-tabs` with `.anh-tab[aria-selected]`; the active tab gets a 2px ink underline. Counts go in `.anh-count`.
- Put these in the page head's filter row, never inside a chart card.
