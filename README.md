# Revenue Budget Tool (MJN · REHL · PMC)

Replaces the Excel round trip in the budget process. Before: PM templates (`Budget <PM> <BU> X.xlsx`) went out to property managers, came back filled in, and were pasted into the `Revenue Master` of `H.E. MJN_Budget 2026.xlsm`. Now property managers enter and edit lease data directly. Revenue, cash, and lease fees are recalculated on every save, and the analysis pages update immediately.

**Stack:** Next.js 16 (App Router), PostgreSQL with Drizzle ORM, and AG Grid Community for the spreadsheet-style Revenue Master.

## Screens

| Page | What it replaces |
| --- | --- |
| **Revenue Master** | `Revenue Master` sheet and the PM template `Main` sheet. One row per unit: current contract, 1st and 2nd renewal, budget rate, cheques. Revenue and cash by month are calculated. |
| **Other Income** | `Other Income` sheet. Admin fee, agency commission, MF, and Ejari are calculated from leases. Other GL lines are entered by month. |
| **Monthly Summary** | PM template `Summary` sheet and `Camps CF`. Revenue, cash, and other income by property by month. |
| **Revenue Analysis** | `Revenue Analysis` sheet. Budget vs comparatives (2026B, 2025F, 2025B, 2024A…), escalation, vacancy loss, comments. |
| **Building P&L** | `Buildingwise P&L` sheet. Revenue side only; cost columns are placeholders for now. |
| **Submissions** | New. PM submits a property; Finance approves or returns it with a note. Includes an activity log. |
| **Admin** | Versions (lock, roll forward, recalculate), assumptions, RERA index, properties and coordinators, users. |

Every page exports to Excel. The Revenue Master export uses the same column layout (A–BF) as the finance workbook's `Revenue Master` sheet, so rows can be pasted straight across while both run in parallel.

## Calculation logic (from the PM templates)

All of it lives in [`src/lib/engine/lease.ts`](src/lib/engine/lease.ts), with tests in `lease.test.ts`. Every rate and threshold is an editable assumption per budget version (Admin → Assumptions).

* **1st renewal**
  * Start date: end + 1 if the tenant renews. Otherwise end + 60 days (vacancy gap) for a new tenant.
  * End date: start + 364.
  * Rent if renewing: current rent × (1 + increase). The increase comes from the RERA index.
    * The gap between the current rent and the RERA average sets the band: ≤11% → 0%, >11% → 5%, >21% → 10%, >31% → 15%, >41% → 20%.
    * Staff rents are grossed up by 20% before comparing.
    * Labour (`L`) units get a flat 10%; camps get 20%.
  * Rent for a new tenant: the budget rate. That is annual rent for residential, AED/sq.ft for commercial, and AED/bed/month for camps.
  * MF: commercial never; residential keeps MF, or gets MF when a new tenant comes in.
* **2nd renewal** is created automatically when the 1st renewal ends before 31 December.
* **Overrides:** every derived renewal value (rent, dates, MF, increase %) can be overridden in the grid (bold yellow). Delete the value to go back to the calculated one (grey).
* **Revenue:** daily rate (rent ÷ contract days) × days falling in each month, for each contract.
* **Cash:** equal cheques, the first on the start date, then every 370 ÷ n days (default 4 cheques). Dates are whole days, so the Excel issue where a cheque landing on the last day of a month at 12:00 was dropped does not occur.
* **Fees, booked in the contract start month:**
  * Admin fee: 500 residential / 1,000 commercial; not charged on a new-tenant 1st renewal.
  * Ejari: 200.
  * MF: 5% of rent.
  * Agency: 2.5% of rent on new-tenant leases.
* **Vacancy loss:** days between a lease ending and the new tenant starting × the new daily rate. Can be overridden per property in Revenue Analysis.

**Validation:** `npm run validate:2026 -- "<path to H.E. MJN_Budget 2026.xlsm>"` recomputes every 2026 unit (1,217 leases + 204 camp contracts) and compares the results with the workbook.
* **Revenue:** matches to within AED 1 in total (255,776,650).
* **Cash:** differs only where the workbook dropped a cheque (formula issue above), on two rows with inconsistent dates, and on the mall, which has no cash schedule in the workbook.

## Getting started

Requirements: Node 20.9+, and Postgres via Docker or any Postgres server.

```powershell
copy .env.example .env          # then set AUTH_SECRET (32+ random chars) and the file paths
docker compose up -d            # Postgres 17 on localhost:5432
npm install
npm run db:push                 # create tables
npm run db:import               # import the 2026 workbook + PM templates, roll forward to 2027
npm run dev                     # http://localhost:3000
```

**No Docker?** `npm run db:dev` starts an embedded Postgres (PGlite) on port 5433, with data in `.pgdata/`. Point `DATABASE_URL` at `postgres://postgres:postgres@127.0.0.1:5433/postgres` and set `DB_POOL_MAX=1`. This is for development only; use a real Postgres server for the shared deployment.

### What the import does (`scripts/import-2026.ts`)
1. **Properties and units.** Business units (501 REHL, 502 MJN, 522 PMC), 44 properties, and 1,421 units come from `Revenue Master` and `Camps New`. The coordinator (PC) on each property decides which property manager may edit it.
2. **2026 baseline.** A locked **2026 Budget (imported)** version holds the workbook's values exactly, so it reproduces the 2026 figures.
3. **Reference data:**
   * The RERA index, from the `RERA Index Range` sheets of the PM templates in `PM_TEMPLATES_DIR`.
   * Other income GL lines.
   * Revenue Analysis comparatives and comments.
4. **Users.** One login each for admin, finance, and each coordinator (`ruchi@budget.local`, …), all with the password from `SEED_PASSWORD` (default `ChangeMe!2027`). **Change these in Admin → Users.**
5. **2027 roll forward.** An open **2027 Budget** is rolled forward from 2026. For each unit, the contract in force on 1 January 2027 becomes the current contract, and renewals are derived again. The approved 2026 budget (Revenue Analysis) becomes the 2026B comparative.

Re-run from scratch with `npm run db:import -- --reset`.

## Roles

* **PM:** sees and edits only the properties where they are the coordinator, while the property is in draft or returned. Submits properties to Finance.
* **Finance:** sees and edits everything in open versions. Approves or returns submissions, maintains assumptions, the RERA index, comparatives, properties, and users. Can lock a version.
* **Admin:** Finance, plus can create other admins.

Every change is written to `audit_log`, showing who changed what, from which value to which value.

## Useful scripts

| Command | |
| --- | --- |
| `npm test` | engine unit tests |
| `npm run validate:2026 -- <xlsm>` | engine vs the 2026 workbook, unit by unit |
| `npx tsx scripts/test-workflow.ts` | save path: edits, overrides, permissions, locking, audit (restores data afterwards) |
| `npx tsx scripts/compare-versions.ts 1 2` | revenue by property, version 1 vs 2, plus open warnings |
| `npx tsx scripts/recalc.ts` | recalculate the open version |
| `npx tsx scripts/smoke.ts` | fetch every page and export against a running server |

## Not built yet / next steps

* The cost side of the Building P&L (columns are in place but empty).
* Uploading a filled-in Excel template back into the tool, for PMs who prefer to work offline.
* Loading the current lease status from Fusion, to refresh "current contract" before a budget round.
* Multi-cell paste in the grid (an AG Grid Enterprise feature; Community edits one cell at a time).
