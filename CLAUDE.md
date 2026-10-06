@AGENTS.md
@design-system/CLAUDE.md

## UI: Al Naboodah design system

`design-system/` is the design system exactly as delivered (rules in its `README.md`, reference markup in `previews/`). Keep it unmodified so a new release can be copied over; adapt it in `src/app/globals.css`, which:

- loads `tokens.css` (layer base) and `components.css` (layer components), so the `anh-*` classes work everywhere and Tailwind utilities can still adjust layout;
- points Tailwind's palette (`slate`, `white`, and the `sky` / `emerald` / `amber` / `red` accents) at the tokens, so utility classes follow Paper and Carbon and the interface stays black, white and gray;
- restyles the shared classes (`.btn`, `.input`, `.card`, `.seg`, `.tbl`, `.cell-edit`) and the AG Grid cell states in design-system terms;
- defines this tool's chart registries (`--seg-*` for property categories and lease outcomes). Charts take colours from `src/lib/segments.ts` by key, never by position.

The theme is a `theme` cookie (`light` | `dark`) read in the root layout and set by the switch in the top bar.
