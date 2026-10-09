// The top-bar menus on Radix DropdownMenu: version chip, theme, user. Keyboard and screen-reader
// behaviour (arrow keys, Escape, typeahead, aria-expanded) comes from the primitive.
'use client';

import * as DM from '@radix-ui/react-dropdown-menu';
import { useState, useTransition, type ReactNode } from 'react';
import { IconChevronDown } from '@/components/ui/icons';
import type { Theme } from '@/lib/theme';
import { setActiveVersion, setTheme } from '@/app/(app)/actions';

export interface VersionItem {
  id: number;
  name: string;
  status: string;
}

function MenuContent({ children, align = 'start', label }: { children: ReactNode; align?: 'start' | 'end'; label: string }) {
  return (
    <DM.Portal>
      <DM.Content className="ui-menu" align={align} sideOffset={6} aria-label={label} loop>
        {children}
      </DM.Content>
    </DM.Portal>
  );
}

/** The budget version in use: name, status tag, and the others to switch to. */
export function VersionChip({ current, versions }: { current: number | null; versions: VersionItem[] }) {
  const [pending, start] = useTransition();
  const cur = versions.find((v) => v.id === current) ?? null;
  return (
    <DM.Root>
      <DM.Trigger asChild>
        <button type="button" className="ui-chip" aria-label={`Budget version: ${cur?.name ?? 'none'}`} disabled={pending || !versions.length} aria-busy={pending || undefined}>
          <span className="ui-chip__eyebrow">Version</span>
          <span className="ui-chip__value">{cur?.name ?? 'No version'}</span>
          {cur?.status === 'LOCKED' && <span className="anh-tag anh-tag--locked">Locked</span>}
          <IconChevronDown size={14} />
        </button>
      </DM.Trigger>
      <MenuContent label="Budget version">
        <DM.RadioGroup value={current === null ? '' : String(current)} onValueChange={(v) => start(() => setActiveVersion(Number(v)))}>
          {versions.map((v) => (
            <DM.RadioItem key={v.id} value={String(v.id)} className="ui-menu__item">
              <DM.ItemIndicator className="ui-menu__check">✓</DM.ItemIndicator>
              <span className="flex-1">{v.name}</span>
              <span className={`anh-tag ${v.status === 'LOCKED' ? 'anh-tag--locked' : ''}`}>{v.status === 'LOCKED' ? 'Locked' : 'Open'}</span>
            </DM.RadioItem>
          ))}
        </DM.RadioGroup>
      </MenuContent>
    </DM.Root>
  );
}

const THEME_LABEL: Record<Theme, string> = { light: 'Light', dark: 'Dark', system: 'System' };

/** Paper / Carbon / follow the system. Applies at once; the cookie keeps it for the next visit. */
export function ThemeMenu({ initial }: { initial: Theme }) {
  const [theme, set] = useState<Theme>(initial);
  const choose = (t: Theme) => {
    set(t);
    document.documentElement.dataset.theme = t === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
    void setTheme(t);
  };
  return (
    <DM.Root>
      <DM.Trigger asChild>
        <button type="button" className="ui-btn ui-btn--tertiary ui-btn--sm" aria-label={`Theme: ${THEME_LABEL[theme]}`}>
          <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
            <circle cx="8" cy="8" r="5.5" />
            <path d="M8 2.5v11A5.5 5.5 0 0 0 8 2.5z" fill="currentColor" />
          </svg>
          <span>{THEME_LABEL[theme]}</span>
        </button>
      </DM.Trigger>
      <MenuContent label="Theme" align="end">
        <DM.RadioGroup value={theme} onValueChange={(v) => choose(v as Theme)}>
          {(['light', 'dark', 'system'] as Theme[]).map((t) => (
            <DM.RadioItem key={t} value={t} className="ui-menu__item">
              <DM.ItemIndicator className="ui-menu__check">✓</DM.ItemIndicator>
              <span>{THEME_LABEL[t]}</span>
            </DM.RadioItem>
          ))}
        </DM.RadioGroup>
      </MenuContent>
    </DM.Root>
  );
}

/** Who is signed in, their role, and sign out. `signOut` is the server action; the form posts it. */
export function UserMenu({ name, role, coordinator, signOut }: { name: string; role: string; coordinator: string | null; signOut: () => Promise<void> }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <DM.Root>
      <DM.Trigger asChild>
        <button type="button" className="ui-avatar" aria-label={`Account: ${name}, ${role}`}>
          {initials || '?'}
        </button>
      </DM.Trigger>
      <MenuContent label="Account" align="end">
        <div className="ui-menu__head">
          <b>{name}</b>
          <span>
            {role}
            {coordinator ? ` · ${coordinator}` : ''}
          </span>
        </div>
        <DM.Separator className="ui-menu__sep" />
        <form action={signOut}>
          <DM.Item asChild>
            <button type="submit" className="ui-menu__item w-full">
              Sign out
            </button>
          </DM.Item>
        </form>
      </MenuContent>
    </DM.Root>
  );
}
