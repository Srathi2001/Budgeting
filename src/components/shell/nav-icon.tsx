// 16 px line icons for the navigation (1.5 px stroke, decorative: the link text is the label).
import type { NavIcon } from './nav';

const PATH: Record<NavIcon, string> = {
  home: 'M2 8l6-5.5L14 8M3.5 7v7h3.5v-4h2v4h3.5V7',
  dashboard: 'M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z',
  lease: 'M2 3h12M2 8h12M2 13h12M5 1v14',
  income: 'M8 2v12M2 8h12',
  analysis: 'M2 14V8M6 14V4M10 14V9M14 14V2',
  fm: 'M10 2a4 4 0 0 0-3.8 5.2L2 11.4V14h2.6l4.2-4.2A4 4 0 1 0 10 2z',
  boh: 'M2 14V6l6-4 6 4v8H2zM6 14V9h4v5',
  adminOh: 'M2 5h12v9H2zM6 5V3h4v2M2 9h12',
  summary: 'M2 3h12v11H2zM2 6h12M5 1v3M11 1v3',
  pnl: 'M3 14V2h7v12M10 6h3v8M1 14h14M5 5h2M5 8h2M5 11h2',
  consolidated: 'M2 2h12v12H2zM2 6h12M2 10h12M8 6v8',
  submissions: 'M3 8l3 3 7-7',
  imports: 'M8 2v8M4.5 6.5L8 10l3.5-3.5M2 12v2h12v-2',
  admin: 'M2 4h12M2 8h12M2 12h12M5 2.5v3M11 6.5v3M7 10.5v3',
};

export function NavGlyph({ icon, size = 16 }: { icon: NavIcon; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATH[icon]} />
    </svg>
  );
}
