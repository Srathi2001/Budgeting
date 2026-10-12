# Revenue Budget Tool (MJN · REHL · PMC)

Replaces the Excel round trip in the budget process. Before: PM templates (`Budget <PM> <BU> X.xlsx`) went out to property managers, came back filled in, and were pasted into the `Revenue Master` of `H.E. MJN_Budget 2026.xlsm`.

Now:
* **Units and current leases are imported from one Oracle report, the Tenant and Lease Details Report, and can be edited in the tool.** The next import overwrites edited lease fields.
* **Property managers enter the budget assumptions** for each unit.
* **Revenue and cash are recalculated on every save.**

**Filters work like Excel:** every Lease Budget column, and the filter bars on the Dashboard, Revenue Analysis and Lease Budget, open a checkbox list. It has a search box, (Select All), counts for each value, and multiple selection.

**Stack:** Next.js 16 (App Router), PostgreSQL with Drizzle ORM, and AG Grid Community for the Lease Budget grid. The UI is dark mode.

## Where the data comes from

Every field has one owner. In the Lease Budget grid, each column group's header is colour-coded by owner:

| Owner | Fields | Editable by |
| --- | --- | --- |
| **Unit master** (grey) | BU, property, unit code, PC, bedroom, area, R/C, MF, merged unit no., unit status, unit type, Resi/Commercial (Oracle), landlord, category | Lease report import (area, status, Oracle unit type); a few fields can be corrected by Finance or PMs |
| **Oracle lease data** (teal) | lease number, tenant code and name, customer class, lease commencement, current contract year (start, end, rent), security deposit, lease status, remarks, vacant, current-lease cheque schedule | Property managers (own properties), Finance. The next import overwrites these fields. |
| **Budget inputs** (amber) | staff/owner, renew Y/N, not re-let, budget rate, increase %, cheques per year, renewal overrides (1st, 2nd and 3rd), notes | Property managers (own properties), Finance |
| **Calculated** (violet) | RERA index row, low/high/average, old and new rent psf, % difference, increase allowed, staff discount, vacancy loss | — |

The grid follows the column order of `Consolidated Revenue Budget 2026_Template.xlsx`, plus the RERA working from the PM templates. Columns auto-fit to their content.

## Importing lease data (Admin → Lease data)

**One report is the only source for units and current leases: the Tenant and Lease Details Report.** In Oracle it's under Custom Applications → Lease Reports → Reports. Export it for all business units, then choose the file in **Admin → Lease data**:

1. **Preview.** Choosing the files (and the **Contracts as of** date, today by default) shows what would change, with nothing saved: leased and vacant lines, current annual rent by business unit, matches to check, new lines and properties, budget lines that are no longer in the report, and what Oracle shows differently for submitted or approved properties. The parsed reports are kept on the server with the preview.
2. **Import.** Writes exactly what the preview showed. It is refused if any lease line or submission status changed after the preview (choose the files again), and a preview is applied once, within 6 hours.

**Safeguards (Admin only):**
* **Submitted and approved properties are not touched:** their lines, inputs, unit details and figures stay as submitted. Their Oracle differences are listed in the preview; to take them, return the property in Submissions and import again.
* **Lines are updated in place,** so their ids, history and downloaded templates stay valid. Only the lines written are recalculated.
* **Lines no longer in the report are archived** with their budget inputs (`lease_line_archive`) before they are removed.
* **Every line changed gets its own audit row** with the fields before and after (`import_update`, `import_add`, `import_remove`), plus the summary row of the import.

**The lines follow the report. Nothing is taken from the previous year's budget:**
* **One line per lease:** a lease covering several units (camps, whole buildings, merged units) is one line, held on one of its unit codes.
* **One line per available unit.**
* **Lines not in the report are archived, then removed** (submitted and approved properties excepted).
* **Unit details are derived from the Oracle unit type:** R/C/L, category, the bedroom/RERA code (STUDIO, 2BR, 3BR VILLA, OFFICE, SHOP, …), and the number of rooms for camps.
* **Fields the report doesn't have stay blank:** camp beds, budget rates, and the **RERA index**, which property managers enter in the row form for each property and RERA code.
* **Budget inputs on a line carry over** when its unit is still in the report.

The report has one row per unit per contract year, for every unit (leased or available). The import, in [`src/lib/import/tenant-lease.ts`](src/lib/import/tenant-lease.ts):

* **Current contract:** the contract year running on the as-of date (today unless chosen). If none is running, the year that ended last (renewal pending) or, for a lease that hasn't started, its first year.
* **Contracted later years** become fixed 1st, 2nd and 3rd renewals, replacing the RERA-based calculation. A re-import replaces only these; renewals typed in by a PM stay.
* **Leases on several units** repeat the lease total on each unit. The total is spread over the budget lines it covers, by area. A unit shared by several running leases (e.g. a mezzanine) carries no rent of its own.
* **Matching** is by unit code. `P`-coded PMC units (`50B113P-…`) match their `N` units, since PMC properties were re-coded in Oracle and the old lease left *Suspended*.
* **New units and leases** become new lines. A property not in the budget is added: set its PM in Admin → Properties.
* **Other charges:** maintenance fee, utility fee and additional car park are imported per lease, separately from rent. They appear in the **Other Income** tab, by property, and aren't part of rent revenue.
* **Personal data** in the report (phone, email, passport, Emirates ID, address) is never read.

The same import runs from the command line: `npx tsx scripts/lease-import.ts <versionId> <report.xlsx>` previews, and adding `--apply` imports.

Cheque schedules aren't in the report: current leases default to equal cheques until schedules are entered in the row panel.

## Screens

| Page | What it replaces |
| --- | --- |
| **Dashboard** | New. Filters: business unit, property manager, category, property. Six headline tiles and seven charts, each with a table view. |
| **Lease Budget** | `Revenue Master` sheet and the PM template `Main` sheet. One row per unit. Click a row for its contracts and cheque schedules. |
| **Monthly Summary** | PM template `Summary` sheet and `Camps CF`. Revenue and cash inflow by property by month, plus a portfolio cash flow breakdown. |
| **Revenue Analysis** | `Revenue Analysis` sheet. 2027B vs 2026F, 2026B, 2025A, 2024A. Roll up or drill down by BU, PM, category, property and unit in any order; by year, quarter or month. |
| **Building P&L** | `Buildingwise P&L` sheet. Rental revenue only; cost columns are placeholders. |
| **Submissions** | New. PM submits a property; Admin approves it, or returns it with a reason. Includes an activity log. |
| **Admin** | Fusion data, budget versions, assumptions, RERA index, comparatives, properties, users. |

**Dashboard charts:**
* revenue by month (current vs prior budget)
* revenue vs cash inflow
* revenue mix (BU by category)
* occupancy by month
* top 10 properties
* biggest movers
* lease expiry profile by outcome (renew / new tenant / not re-let)
* rent per sq ft: one card with a summary per use group (Retail & showroom, Office & commercial, Residential, Warehouses & sheds, Whole-building leases) and three views: by building (per use group), by Oracle unit type, by location. Passing rent (current contract, annualised) ÷ let sq ft, area-weighted; leased units with an area only; camps are left out because they're priced per bed. Whole-building leases are properties whose leased lines all share one lease number, plus Mirdiff Shopping Mall, MJN Al Warqaa School and Al Rafa Building (Plaza 2). Location comes from Admin → Properties, or from the property name when left blank. Computed on the server (`src/lib/budget/rent-psf.ts`) for the page filters.

## Calculation logic

All of it lives in [`src/lib/engine/lease.ts`](src/lib/engine/lease.ts), with tests in `lease.test.ts`. Every rate and threshold is an editable assumption per budget version (Admin → Assumptions).

* **1st renewal**
  * Start: end + 1 if the tenant renews; for a new tenant, after the vacancy days entered for the lease, 60 when none are entered (Admin → Assumptions).
  * End: one calendar year, the day before the same date next year (1-Jan-2028 → 31-Dec-2028, leap years included). A term set in Admin → Assumptions that is not whole years is counted in days.
  * Rent if renewing: the current rent for a year × (1 + RERA increase). A contract that is not one year long is converted to a year's rent first (150,000 for 15 months is 119,803 a year), for the increase, the RERA comparison and the deposit; a renewal shorter or longer than a year gets its share.
    * The gap to the RERA average sets the band: ≤11% → 0%, >11% → 5%, >21% → 10%, >31% → 15%, >41% → 20%.
    * Staff rents are grossed up by 20% before comparing.
    * Labour units get 10%; camps get 20%.
  * Rent for a new tenant: the budget rate. That is annual rent for residential, AED/sq.ft for commercial, and AED/bed/month for camps.
* **2nd and 3rd renewals** are added automatically while a renewal ends before 31 December (short contracts). Each is increased like the 1st: the RERA band read again on the rent it renews (labour and camps: their fixed rates), or the increase entered for the unit.
* **Overrides:** any derived renewal value can be overridden in the grid (amber). Delete it to return to the calculated value (grey).
* **Revenue:** rent ÷ contract days × days in each month.
* **Rent cheques:**
  * Actual schedule for the current lease (Fusion).
  * Renewals default to 4 equal cheques a year. Multi-year leases get that many for every year of the term. The row panel lets you change the count or edit individual dates and amounts.
* **Cash inflow** = rent cheques + security deposits received − deposits refunded, ex VAT. VAT (5% on commercial and labour rent; residential is exempt) is worked out for reference but left out of the cash flow: it passes through to the FTA, as in the 2026 budget. Non-recoverable VAT is a G&A line (accounts 73102 / 73103) in Admin overheads.
* **Current-year forecast (e.g. 2026F)**, one rule on every screen (`src/lib/budget/forecast.ts`): Oracle's recognised rent (Revenue Recognition Summary) to the actuals cut-off month (Admin → Assumptions, September), then the leases as they run; a lease ending before December is followed by the property managers' inputs (renew, new tenant after the vacancy days, not re-let). Oracle's own forecast is not used. A property without Oracle actuals (PMC) is projected for the whole year.

**Group statements.** The business unit filter offers every entity, the Mall apart from REHL-MJN and ANPM (521) included. ANPM's PMA fee is the landlords' cost on their rent and ANPM's income; the FM staff and watchmen are ANPM's staff, recharged to the buildings at cost (ANPM shows the recharge income and the staff cost). Both sides are eliminated when both are in view; the group result is the same either way.

**Yearly rules and mappings (Admin).** Per version, Admin → Yearly rules: the G&A payroll rules by department (capitalised, MJNH, ASRE) and the FM supervisory split. For every version, Admin → Mappings: first reporting year, GL company → business unit, the Mall's property codes, whole-building leases. The 2026 fee and G&A-split figures are reference data loaded from the workbook, not code.

**ASRE** (Arabian Spaces Real Estate, the mall operator) is a group entity, entered in Admin → ASRE as one amount a year per line (rent from the mall tenants, other income, the mall lease to REHL-MJN, operating costs, G&A): blank until its finance team sends its budget. Its mall lease is eliminated against the Mall's rent when both are in view.

**Revenue actuals import:** a property with no figure at all in the report is missing (the forecast projects it); a property with figures has nothing recognised in its blank months (zero).

**PMA and AMA cash** is paid once a quarter, as in the 2026 budget: the PMA fee in advance (Jan, Apr, Jul, Oct, on both the landlords' and ANPM's side), the AMA fee at each quarter end (Mar, Jun, Sep, Dec). The expense stays monthly.

**Water & electricity** is calculated from last year's forecast; a building with no history takes the amount typed.

**GL actuals import.** Run the Account Analysis Report for all accounts. A data set the file does not carry is kept; building overhead and G&A actuals are replaced only for the accounts in the file; a part that would replace its rows with fewer than half as many is held until an admin confirms; what an import replaced is kept (`import_history`) and the last import of a ledger can be undone.
  * Deposits: 5% of annual rent from each new tenant (the median across Fusion leases), refunded the month after a tenant leaves.

**Service contracts (AMC tabs, audit FIN-008).** A contract has a start and an end date (blank: the 1st of its start month for a year, or, paid monthly, for the number of months in Quantity). Its value (quantity × rate) is spread over the months of its own period, a part month for its days, and only the months inside the budget year are booked: a 12-month contract from 1-Apr books 9 months. Payments: monthly in advance, quarterly and half-yearly at the end of each part, yearly and one-off at the start. A contract ending before 31 December is flagged to the property manager, who says whether it is renewed and, if so, at what rate and terms (it then repeats for the same length until the year is covered) or ends; a property cannot be submitted while a flag is open. The Excel template carries the same columns.

**Finance → Treasury** (entered by Finance): shareholder loans (lender, borrowing entity, balance at 1 January, rate, day basis, interest and repayment terms, drawdowns and custom repayments, interest capitalised to a project, repayments returned as contributions after a lag), fixed deposits (bank, entity, amount, placement and maturity, rate, interest at maturity / monthly / quarterly, rollover) and contingencies. Loan interest and contingencies go below EBITDA, deposit interest is the entity's other income (52201, in place of the figure typed before), and loan interest paid and contingencies are in the cash flow. Principal, drawdowns and deposit placements are worked out on the tab but not yet in the cash flow (to be agreed). Corporate tax has its line, blank until its rules are agreed.

**Statements, as the 2026 budget:** income, operating costs, gross profit, major repairs, G&A, **EBITDA**, then depreciation (Depreciation-group G&A accounts), loan interest, the IFRS 16 lines (on hold) and contingencies, **PBT**, corporate tax, **PAT**, then cash profit (PAT + depreciation), capex and **cash for distribution**.

**Input forms.** Every input page has the Lease Budget's side form: click a property, building, department, fee, team or record and it opens on the right with its fields in sections, Save / Cancel and ↑ ↓ (`src/components/record-form.tsx`). Typing in the grids still works.

**Validation:** `npm run validate:2026 -- "<path to H.E. MJN_Budget 2026.xlsm>"` recomputes every 2026 unit against the workbook. Revenue matches to within AED 1 in total (255,776,650).

## Budget versions

* **2026 Budget (imported):** locked baseline, reproducing the workbook. It supplies the 2026B comparison at unit level.
* **2027 Budget:** the units of 2026, with **no lease details**. Leases come only from the Fusion upload.
* **Roll forward** (Admin → Budget versions) creates next year in the same way: units, the comparatives and the RERA ranges carry over (property managers update the ranges); leases do not. A property cannot be submitted while a renewal has no RERA range or increase. `scripts/copy-rera.ts` copied the 2026 ranges into the 2027 budget, translated to the codes the units carry now.
* **Last year's budget** is the one approved (locked) version of the year before, on every screen; only one version of a year can be locked.

## Getting started

Requirements: Node 20.9+, and Postgres via Docker or any Postgres server.

```powershell
copy .env.example .env          # then set AUTH_SECRET (32+ random chars) and the file paths
docker compose up -d            # Postgres 17 on localhost:5432
npm install
npm run db:push                 # create tables
npm run db:import               # import the 2026 workbook + PM templates, create the 2027 version
npm run dev                     # http://localhost:3000
```

**No Docker?** `npm run db:dev` starts an embedded Postgres (PGlite) on port 5433, with data in `.pgdata/`. Point `DATABASE_URL` at `postgres://postgres:postgres@127.0.0.1:5433/postgres` and set `DB_POOL_MAX=1`. This is for development only.

* **Start on this PC:** opening new windows is blocked here, and so are `npm` (a `.ps1`/`.cmd` wrapper, stopped by the script execution policy and the disabled command prompt). Use two VS Code terminals in the project folder and call `node` directly:
  * Terminal 1: `node node_modules\tsx\dist\cli.mjs scripts\dev-db.ts`
  * Terminal 2: `node node_modules\next\dist\bin\next dev -p 3000`

  They run until you stop them. On a PC that allows it, `scripts\start-dev.ps1` opens the two windows instead.
* **Stop:** press Ctrl+C in each terminal, the app first and the database last.
* **Native PostgreSQL can't run on this PC:** its setup and start tools need the command prompt, which group policy disables.

**PGlite has no crash recovery**, so `scripts/dev-db.ts` protects the data itself:
* **It takes a CHECKPOINT every minute.**
* **It snapshots the whole database consistently** into `.pgdata-snapshots/`: at start, every 10 minutes when something changed, and on a clean stop. It keeps the newest 36.
* **If `.pgdata` won't open after a hard stop**, it's moved to `.pgdata-damaged-<time>` and the newest snapshot is restored automatically. At most the last 10 minutes of edits are lost.
* **Settings:** `DEV_DB_SNAPSHOT_MINUTES` and `DEV_DB_SNAPSHOTS_KEPT`.

For use by several people, move to a hosted PostgreSQL (e.g. Azure Database for PostgreSQL, UAE North); the app only needs a new `DATABASE_URL`.

Logins: `admin@budget.local`, `finance@budget.local`, and one per coordinator (`ruchi@…`, `azin@…`, `meghal@…`, `packi@…`). All use the password `SEED_PASSWORD` (default `ChangeMe!2027`). **Change these in Admin → Users.**

## Lease Budget: grid and row form

* **The grid** is a list to scan and filter (about 25 columns): unit, current lease, outcome, budget rate, increase %, renewal start and rent, and the year's revenue, cash and vacancy loss. Monthly columns are a checkbox away. Double-click a cell to edit in place.
* **Clicking a row** opens its form on the right half of the screen. Sections:
  * Unit and Current lease (Oracle)
  * Contracted later years
  * Budget decision
  * Renewals
  * Cheque schedules
  * RERA check
  * Result
  * Notes

  The form has Save / Cancel and ↑ ↓ to move between rows.
* **Outcome** is one field: Renew / New tenant / Not re-let. A vacant unit can only be let to a new tenant.

## Roles and what can be edited

| Fields | PM (own properties, draft or returned) | Finance | Admin |
| --- | --- | --- | --- |
| Oracle fields: unit type, area, unit status, tenant, lease no., customer class, commencement, contract dates and amount, security deposit | locked | locked | yes |
| Contracted later years, and the outcome they settle | locked | locked | yes |
| Outcome, increase %, budget rate, new-tenant start, renewal overrides, cheques, schedules, staff/owner, bedroom/RERA code, R/C/L, category, camp beds and rooms, notes | yes | locked | yes |

The rule is enforced on save, not only in the screens. Oracle fields are corrected in Oracle and arrive with the next import.

**Each department enters its own data; everything else is Admin's** (decision of 11-Oct-2026, in `src/lib/auth/permissions.ts`):
* **PM:** the inputs of their own properties (Lease Budget, RERA, Other Income property rows, their building overhead accounts and service contracts) while the property is in draft or returned. Submits the property.
* **Facilities management:** the FM budget (works and staff), and submits each facility.
* **Finance:** Finance's inputs: Treasury (shareholder loans, fixed deposits, contingencies), Admin overheads, payroll and the PMA / AMA fees, the Finance building overhead accounts, insurance and the security allocation, the Other Income General rows. Comments in Revenue Analysis. Finance's inputs on a property stay open until Admin approves the property. Sees every screen except Imports and Admin.
* **Admin:** approves, or returns with a reason; locks versions and reopens them with a reason; assumptions, imports, comparatives, the vacancy-loss override, properties and users. May also enter any data.
* **Nobody changes a submitted or approved property or facility;** Admin returns it first. The imported baseline (2026 Budget) cannot be reopened or recalculated.

**2026B reference on the cost tabs.** Building Overheads, Other Income and Admin Overheads show last year's approved budget (2026B) and "2027B vs 2026B", read-only, from the 2026 workbook (`budget_reference`, loaded by `scripts/load-reference-budget.ts`). Building overheads and other income are by building and account; admin overheads by department (the workbook budgets them by cost line, not GL account); payroll is cost to company by department. Insurance is one figure per building in 2026 (shown on the PAR line), and four workbook codes that are not buildings in the tool (551A01, 90A002, AMJN PER, AMJN PER 1: AED 32,225.44) are kept but not shown. 2026B is not in the statements.

**Audit trail.** Every change is written to `audit_log` with who, when, and each field before and after (one row per line, contract, FM line, cell or setting), in the same transaction as the change. When two people edit the same thing, the last save wins and both saves are in the trail. The table is append-only: a database trigger refuses any update, delete or truncate, and a reset keeps it. Scripts that write need `BUDGET_ACTOR` set to the email of the user running them.

**Sessions.** A session ends after 15 minutes without keyboard or mouse activity, after 12 hours in any case, and on sign-out (the server revokes it, so a copied cookie stops working).

**Locking a version freezes its figures.** The comparatives, the current-year rent forecast, the building overhead cells (water & electricity, municipal charges, phasing, contracts) and the PMA / AMA fees are stored as they show at lock (`version_snapshots`), so later actuals and imports do not move them; lease figures are stored per line already. Reopening (Admin, with a reason) drops the snapshot. GL imports into a locked version are refused.

## Useful scripts

| Command | |
| --- | --- |
| `npm test` | engine unit tests |
| `npm run validate:2026 -- <xlsm>` | engine vs the 2026 workbook, unit by unit |
| `npx tsx scripts/lease-import.ts <versionId> <report.xlsx> [--apply]` | Tenant and Lease Details import from the command line (preview without `--apply`) |
| `npx tsx scripts/reconcile.ts [versionId] [--app <url>]` | reconciliation: every screen (and, with `--app`, the Excel exports) against the stored lease results; the statements and Group P&L add up; exits 1 on a break |
| `npx tsx scripts/copy-rera.ts <from> <to> [--workbook <xlsm>] [--apply]` | copy RERA ranges between versions (2026 codes translated to today's unit codes) |
| `npx tsx scripts/load-reference-budget.ts [workbook] [--apply]` | load 2026B from the 2026 workbook as reference for the cost tabs; prints the tie-out to the workbook's totals |
| `npx tsx scripts/fusion-rest.ts [resource]` / `fusion-catalog.ts [folder]` | read-only probes of the Oracle Fusion REST and report catalog services |
| `npx tsx scripts/clear-leases.ts <versionId>` | remove all lease details from a version, keeping its units |
| `npx tsx scripts/test-workflow.ts` | save path: edits, permissions, Fusion fields read-only, locking, audit |
| `npx tsx scripts/compare-versions.ts 1 2` | revenue by property, version 1 vs 2, plus open warnings |
| `npx tsx scripts/recalc.ts [versionId]` | recalculate versions |
| `npx tsx scripts/smoke.ts` | fetch every page and export against a running server |

## Next steps

* Automatic lease feed: the lease data lives in the custom ReportsApp (paasprod.alnaboodah.com), which has no API yet. Its vendor would need to provide read-only views or REST.
* Fusion actuals (GL, Receivables) for comparatives: works with the existing login once it has read access to the REHL and PMC business units and ledgers.
* The cost side of the Building P&L.
* Multi-cell paste in the grid (an AG Grid Enterprise feature).
