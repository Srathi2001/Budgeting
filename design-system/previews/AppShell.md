The application frame: sidebar navigation, top bar with breadcrumbs and sync status, and a main column holding the page head, KPI row and panels.

**Consumer provides:** the nav items (icon, label, optional count), the breadcrumb trail, the page eyebrow and `h1`, filter controls, and the panel content.

- Wrap everything in `.anh` then `.anh-shell`; children are `.anh-side`, `.anh-top`, `.anh-main`.
- Mark the current nav item with `aria-current="page"` — it gets the 2px ink left rule and `surface` fill.
- Close the page head with its 2px rule; put filters and the single primary action on the right of that row.
- Do: show the ERP sync time in the top bar. Don't: add a second primary button to the page head.
