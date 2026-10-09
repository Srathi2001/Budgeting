// The app shell: a navigation rail (collapsible to icons from the top bar), a top bar with the breadcrumb, the version
// chip, search (⌘K), theme and account; under 1024 px the rail becomes a drawer behind a menu button.
// Server data (user, versions, properties) arrives as props; the layout keeps the data fetching.
'use client';

import * as RD from '@radix-ui/react-dialog';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { IconClose, IconMenu, IconSearch, IconSidebar } from '@/components/ui/icons';
import type { Theme } from '@/lib/theme';
import { CommandPalette, type PaletteProperty } from './command-palette';
import { ThemeMenu, UserMenu, VersionChip, type VersionItem } from './menus';
import { NavGlyph } from './nav-icon';
import { crumbFor, isActivePath, navFor, type NavViewer } from './nav';

const RAIL_KEY = 'anh.rail';

// the rail width is a per-browser convenience kept in localStorage; it may be unavailable (private
// windows, blocked storage), so reads fall back to "open" and writes may silently do nothing
const railListeners = new Set<() => void>();
const readRail = () => {
  try {
    return localStorage.getItem(RAIL_KEY) === 'collapsed';
  } catch {
    return false;
  }
};
const subscribeRail = (cb: () => void) => {
  railListeners.add(cb);
  window.addEventListener('storage', cb);
  return () => {
    railListeners.delete(cb);
    window.removeEventListener('storage', cb);
  };
};
const writeRail = (collapsed: boolean) => {
  try {
    localStorage.setItem(RAIL_KEY, collapsed ? 'collapsed' : 'open');
  } catch {}
  railListeners.forEach((l) => l());
};

export interface AppShellProps {
  user: { name: string; role: string; coordinator: string | null };
  viewer: NavViewer;
  versions: VersionItem[];
  currentVersion: number | null;
  theme: Theme;
  properties: PaletteProperty[];
  signOut: () => Promise<void>;
  /** right-hand top-bar slot (export buttons) */
  tools?: ReactNode;
  children: ReactNode;
}

function NavList({ viewer, onNavigate, compact }: { viewer: NavViewer; onNavigate?: () => void; compact: boolean }) {
  const path = usePathname();
  return (
    <nav className="ui-nav" aria-label="Main">
      {navFor(viewer).map((g) => (
        <div key={g.label} className="ui-nav__group">
          <span className="ui-nav__label">{g.label}</span>
          {g.pages.map((p) => {
            const active = isActivePath(p.href, path);
            return (
              <Link key={p.href} href={p.href} aria-current={active ? 'page' : undefined} className="ui-nav__link" title={compact ? p.label : undefined} onClick={onNavigate}>
                <NavGlyph icon={p.icon} />
                <span className="ui-nav__text">{p.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function Brand({ onClick }: { onClick?: () => void }) {
  return (
    <Link href="/" className="ui-brand" aria-label="Al Naboodah Revenue budget, home" onClick={onClick}>
      <span className="ui-brand__mark" aria-hidden="true">
        AN
      </span>
      <span className="ui-brand__text">
        <b>Al Naboodah</b>
        <span>Revenue budget</span>
      </span>
    </Link>
  );
}

export function AppShell({ user, viewer, versions, currentVersion, theme, properties, signOut, tools, children }: AppShellProps) {
  const path = usePathname();
  // the server renders the rail open; the browser's remembered width applies after hydration
  const collapsed = useSyncExternalStore(subscribeRail, readRail, () => false);
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const toggleRail = () => writeRail(!collapsed);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const crumb = crumbFor(path);
  const versionName = versions.find((v) => v.id === currentVersion)?.name;

  return (
    <div className={`ui-shell ${collapsed ? 'is-collapsed' : ''}`}>
      <a href="#main" className="ui-skip">
        Skip to content
      </a>

      <aside className="ui-rail" aria-label="Navigation">
        <Brand />
        <NavList viewer={viewer} compact={collapsed} />
      </aside>

      <header className="ui-top">
        <RD.Root open={drawer} onOpenChange={setDrawer}>
          <RD.Trigger asChild>
            <button type="button" className="ui-btn ui-btn--tertiary ui-btn--sm ui-btn--icon ui-top__menu" aria-label="Open the navigation">
              <IconMenu />
            </button>
          </RD.Trigger>
          <RD.Portal>
            <RD.Overlay className="ui-scrim" />
            <RD.Content className="ui-drawer" aria-label="Navigation">
              <RD.Title className="sr-only">Navigation</RD.Title>
              <RD.Description className="sr-only">Pages of the budget tool.</RD.Description>
              <div className="ui-drawer__head">
                <Brand onClick={() => setDrawer(false)} />
                <RD.Close asChild>
                  <button type="button" className="ui-btn ui-btn--tertiary ui-btn--sm ui-btn--icon" aria-label="Close the navigation">
                    <IconClose />
                  </button>
                </RD.Close>
              </div>
              <NavList viewer={viewer} compact={false} onNavigate={() => setDrawer(false)} />
            </RD.Content>
          </RD.Portal>
        </RD.Root>
        <button
          type="button"
          className="ui-btn ui-btn--tertiary ui-btn--sm ui-btn--icon ui-top__rail"
          onClick={toggleRail}
          aria-pressed={collapsed}
          aria-label={collapsed ? 'Expand the navigation' : 'Collapse the navigation'}
          title={collapsed ? 'Expand the navigation' : 'Collapse the navigation'}
        >
          <IconSidebar />
        </button>

        <nav className="ui-crumbs" aria-label="Breadcrumb">
          <ol>
            <li>MJN · REHL · PMC</li>
            {crumb && crumb.page.href !== '/' && <li>{crumb.group}</li>}
            <li aria-current="page">{crumb?.page.label ?? 'Page'}</li>
          </ol>
        </nav>

        <div className="ui-top__tools">
          <VersionChip current={currentVersion} versions={versions} />
          <button type="button" className="ui-btn ui-btn--tertiary ui-btn--sm ui-top__search" onClick={() => setPalette(true)} aria-label="Search pages and properties (Ctrl K)" aria-keyshortcuts="Control+K Meta+K">
            <IconSearch />
            <span className="ui-top__search-text">Search</span>
            <kbd>⌘K</kbd>
          </button>
          {tools && <span className="ui-top__extra">{tools}</span>}
          <ThemeMenu initial={theme} />
          <UserMenu name={user.name} role={user.role} coordinator={user.coordinator} signOut={signOut} />
        </div>
      </header>

      <main id="main" className="ui-main" tabIndex={-1} aria-label={versionName ? `${crumb?.page.label ?? 'Page'} · ${versionName}` : undefined}>
        {children}
      </main>

      <CommandPalette viewer={viewer} properties={properties} open={palette} onOpenChange={setPalette} />
    </div>
  );
}
