Line chart for change over time: cumulative spend against budget, with a forecast continuation.

**Consumer provides:** periods, actual to date, budget for the full period, forecast after the last actual.

- Actual `.ln-actual` (navy solid), Budget `.ln-budget` (slate dashed), Forecast `.ln-forecast` (navy dotted) inside a `.band` labelled FORECAST.
- Mark the last actual with `.dot-actual` and label it; label year-end values only.
- For divisions over time use one `ln-<division>` line per division, end-labelled (see Segment colours).
- Ship the crosshair + tooltip; it shows every series and the delta vs budget.
