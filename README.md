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

1. **Preview.** Choosing the file shows what would change, with nothing saved: leased and vacant lines, current annual rent by business unit, matches to check, new lines and properties, and budget lines that are no longer in the report.
2. **Import.** Writes the leases and recalculates every unit. Budget inputs (renew Y/N, budget rate, cheques, notes) are kept.

**The import rebuilds the version's lines from the report. Nothing is taken from the previous year's budget:**
* **One line per lease:** a lease covering several units (camps, whole buildings, merged units) is one line, held on one of its unit codes.
* **One line per available unit.**
* **Lines not in the report are removed.**
* **Unit details are derived from the Oracle unit type:** R/C/L, category, the bedroom/RERA code (STUDIO, 2BR, 3BR VILLA, OFFICE, SHOP, …), and the number of rooms for camps.
* **Fields the report doesn't have stay blank:** camp beds, budget rates, and the **RERA index**, which property managers enter in the row form for each property and RERA code.
* **Budget inputs on a line carry over** when its unit is still in the report.

The report has one row per unit per contract year, for every unit (leased or available). The import, in [`src/lib/import/tenant-lease.ts`](src/lib/import/tenant-lease.ts):

* **Current contract:** the contract year running today. If none is running, the year that ended last (renewal pending) or, for a lease that hasn't started, its first year.
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
| **Submissions** | New. PM submits a property; Finance approves or returns it. Includes an activity log. |
| **Admin** | Fusion data, budget versions, assumptions, RERA index, comparatives, properties, users. |

**Dashboard charts:**
* revenue by month (current vs prior budget)
* revenue vs cash inflow
* revenue mix (BU by category)
* occupancy by month
* top 10 properties
* biggest movers
* lease expiry profile by outcome (renew / new tenant / not re-let)
* rent per sq ft by building, by location, by unit type, and by unit size and category. Passing rent (current contract, annualised) ÷ let sq ft, area-weighted; camps are left out because they're priced per bed. Location comes from Admin → Properties, or from the property name when left blank.

## Calculation logic

All of it lives in [`src/lib/engine/lease.ts`](src/lib/engine/lease.ts), with tests in `lease.test.ts`. Every rate and threshold is an editable assumption per budget version (Admin → Assumptions).

* **1st renewal**
  * Start: end + 1 if the tenant renews; otherwise end + 60 days (vacancy gap) for a new tenant.
  * End: start + 364.
  * Rent if renewing: current rent × (1 + RERA increase).
    * The gap to the RERA average sets the band: ≤11% → 0%, >11% → 5%, >21% → 10%, >31% → 15%, >41% → 20%.
    * Staff rents are grossed up by 20% before comparing.
    * Labour units get 10%; camps get 20%.
  * Rent for a new tenant: the budget rate. That is annual rent for residential, AED/sq.ft for commercial, and AED/bed/month for camps.
* **2nd and 3rd renewals** are added automatically while a renewal ends before 31 December (short contracts).
* **Overrides:** any derived renewal value can be overridden in the grid (amber). Delete it to return to the calculated value (grey).
* **Revenue:** rent ÷ contract days × days in each month.
* **Rent cheques:**
  * Actual schedule for the current lease (Fusion).
  * Renewals default to 4 equal cheques a year. Multi-year leases get that many for every year of the term. The row panel lets you change the count or edit individual dates and amounts.
* **Cash inflow** = rent cheques + 5% VAT on commercial and labour rent (residential is exempt) + security deposits received − deposits refunded.
  * Deposits: 5% of annual rent from each new tenant (the median across Fusion leases), refunded the month after a tenant leaves.

**Validation:** `npm run validate:2026 -- "<path to H.E. MJN_Budget 2026.xlsm>"` recomputes every 2026 unit against the workbook. Revenue matches to within AED 1 in total (255,776,650).

## Budget versions

* **2026 Budget (imported):** locked baseline, reproducing the workbook. It supplies the 2026B comparison at unit level.
* **2027 Budget:** the units of 2026, with **no lease details**. Leases come only from the Fusion upload.
* **Roll forward** (Admin → Budget versions) creates next year in the same way: units, budget rates, cheque counts and the RERA index carry over; leases do not.

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

* **Start on this PC:** opening new windows is blocked here, so use two VS Code terminals in the project folder:
  * Terminal 1: `npm run db:dev`
  * Terminal 2: `npm run dev`

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
| Outcome, increase %, budget rate, new-tenant start, renewal overrides, cheques, schedules, staff/owner, bedroom/RERA code, R/C/L, category, camp beds and rooms, notes | yes | yes | yes |

The rule is enforced on save, not only in the screens. Oracle fields are corrected in Oracle and arrive with the next import.

* **PM:** edits the budget inputs of their own properties while those properties are in draft or returned. Submits properties to Finance.
* **Finance:** edits budget inputs in open versions. Imports lease data, approves or returns submissions, and maintains assumptions, the RERA index, comparatives and users. Can lock a version.
* **Admin:** Finance, plus Oracle fields and creating other admins.

Every change is written to `audit_log`.

## Useful scripts

| Command | |
| --- | --- |
| `npm test` | engine unit tests |
| `npm run validate:2026 -- <xlsm>` | engine vs the 2026 workbook, unit by unit |
| `npx tsx scripts/lease-import.ts <versionId> <report.xlsx> [--apply]` | Tenant and Lease Details import from the command line (preview without `--apply`) |
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
