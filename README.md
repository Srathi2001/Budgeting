# Revenue Budget Tool (MJN · REHL · PMC)

Replaces the Excel round trip in the budget process. Before: PM templates (`Budget <PM> <BU> X.xlsx`) went out to property managers, came back filled in, and were pasted into the `Revenue Master` of `H.E. MJN_Budget 2026.xlsm`.

Now:
* **Units and current leases are loaded from Oracle Fusion and can be edited in the tool.** The next Fusion upload overwrites edited lease fields.
* **Property managers enter the budget assumptions** for each unit.
* **Revenue and cash are recalculated on every save.**

**Filters work like Excel:** every Lease Budget column, and the filter bars on the Dashboard, Revenue Analysis and Lease Budget, open a checkbox list. It has a search box, (Select All), counts for each value, and multiple selection.

**Stack:** Next.js 16 (App Router), PostgreSQL with Drizzle ORM, and AG Grid Community for the Lease Budget grid. The UI is dark mode.

## Where the data comes from

Every field has one owner. In the Lease Budget grid, each column group's header is colour-coded by owner:

| Owner | Fields | Editable by |
| --- | --- | --- |
| **Unit master** (grey) | BU, property, unit code, PC, bedroom, area, R/C, MF, merged unit no., unit status, unit type, Resi/Commercial (Fusion), landlord, category | Fusion Unit Dump; a few fields can be corrected by Finance or PMs |
| **Oracle Fusion** (teal) | lease number, version, tenant code and name, customer class, lease start, rent start, lease end, actual lease amount, VAT, security deposit, lease status, remarks, vacant, current-lease cheque schedule | Property managers (own properties), Finance. A Fusion upload overwrites these fields. |
| **Budget inputs** (amber) | staff/owner, renew Y/N, not re-let, budget rate, increase %, cheques per year, renewal overrides (1st, 2nd and 3rd), notes | Property managers (own properties), Finance |
| **Calculated** (violet) | RERA index row, low/high/average, old and new rent psf, % difference, increase allowed, staff discount, vacancy loss | — |

The grid follows the column order of `Consolidated Revenue Budget 2026_Template.xlsx`, plus the RERA working from the PM templates. Columns auto-fit to their content.

## Loading Fusion data (Admin → Fusion data)

Until the Fusion connection exists, Finance uploads the two standard Fusion exports. Load them in this order:

1. **Unit Dump** (`MJN+REHL+PMC … Unit Dump.xlsx`). Updates unit status, merged unit number, unit usage and landlord. Columns are found by header; values are also recognised by pattern, because some sheets in the export have shifted columns.
2. **Lease Status Summary Report.** Gives the current lease of every leased unit:
   * Fusion records a lease on merged units under the **merged unit code**. Such a lease is spread over its member units by area, or equally when area is missing.
   * A lease row whose unit isn't known yet is added as a new unit under its property.
   * For the business units in the report, units without a row lose their lease and become vacant.

Both steps recalculate the whole version. Later, a scheduled Fusion sync (BI Publisher report service) will replace the uploads and use the same mapping in [`src/lib/import/fusion.ts`](src/lib/import/fusion.ts). Cheque schedules for current leases will come from the Fusion lease Schedules.

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

Logins: `admin@budget.local`, `finance@budget.local`, and one per coordinator (`ruchi@…`, `azin@…`, `meghal@…`, `packi@…`). All use the password `SEED_PASSWORD` (default `ChangeMe!2027`). **Change these in Admin → Users.**

## Roles

* **PM:** edits the budget inputs of their own properties while those properties are in draft or returned. Submits properties to Finance.
* **Finance:** edits everything in open versions. Loads Fusion data, approves or returns submissions, and maintains assumptions, the RERA index, comparatives and users. Can lock a version.
* **Admin:** Finance, plus can create other admins.

Every change is written to `audit_log`.

## Useful scripts

| Command | |
| --- | --- |
| `npm test` | engine unit tests |
| `npm run validate:2026 -- <xlsm>` | engine vs the 2026 workbook, unit by unit |
| `npx tsx scripts/fusion-import.ts <versionId> <lease report.xlsx> [unit dump.xlsx]` | Fusion upload from the command line |
| `npx tsx scripts/clear-leases.ts <versionId>` | remove all lease details from a version, keeping its units |
| `npx tsx scripts/test-workflow.ts` | save path: edits, permissions, Fusion fields read-only, locking, audit |
| `npx tsx scripts/compare-versions.ts 1 2` | revenue by property, version 1 vs 2, plus open warnings |
| `npx tsx scripts/recalc.ts [versionId]` | recalculate versions |
| `npx tsx scripts/smoke.ts` | fetch every page and export against a running server |

## Next steps

* Fusion API connection: scheduled sync of units, leases and lease cheque schedules, plus GL actuals for comparatives.
* The cost side of the Building P&L.
* Multi-cell paste in the grid (an AG Grid Enterprise feature).
