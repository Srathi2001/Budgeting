Workflow status tags and variance chips; the word carries the state, never colour or symbols.

**Consumer provides:** the state and label text.

- Tags: `.anh-tag--approved`, `--review`, `--draft`, `--locked`, `--rejected` (label it "Returned").
- Variance: `.anh-var--up` / `--down` for direction; add `.is-adverse` when unfavourable to plan and `.is-breach` past tolerance.
- Favourable vs adverse depends on the line: overspend on a cost is adverse, a revenue shortfall is adverse.
