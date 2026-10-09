// ⌘K / Ctrl+K: jump to a page or a property. Pages come from the navigation map; a property opens
// its Lease Budget and becomes the shared Property filter (AdoptPropertyFilter on /master).
'use client';

import * as RD from '@radix-ui/react-dialog';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconSearch } from '@/components/ui/icons';
import { NavGlyph } from './nav-icon';
import { navFor, type NavPage, type NavViewer } from './nav';

export interface PaletteProperty {
  id: number;
  code: string;
  name: string;
  buName: string;
}

type Hit = { kind: 'page'; page: NavPage; group: string } | { kind: 'property'; prop: PaletteProperty };

const match = (hay: string, q: string) => {
  const h = hay.toLowerCase();
  return q.split(/\s+/).every((w) => h.includes(w));
};

export function CommandPalette({ viewer, properties, open, onOpenChange }: { viewer: NavViewer; properties: PaletteProperty[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const hits = useMemo<Hit[]>(() => {
    const query = q.trim().toLowerCase();
    const pages: Hit[] = navFor(viewer).flatMap((g) => g.pages.map((page) => ({ kind: 'page' as const, page, group: g.label })));
    if (!query) return pages;
    const p = pages.filter((h) => h.kind === 'page' && match(`${h.group} ${h.page.label} ${h.page.hint}`, query));
    const props: Hit[] = viewer.fm
      ? []
      : properties
          .filter((x) => match(`${x.code} ${x.name} ${x.buName}`, query))
          .slice(0, 12)
          .map((prop) => ({ kind: 'property', prop }));
    return [...p, ...props];
  }, [q, viewer, properties]);

  // the palette opens blank: the query and cursor are cleared whenever it closes
  const setOpen = (o: boolean) => {
    if (!o) {
      setQ('');
      setCursor(0);
    }
    onOpenChange(o);
  };
  const type = (v: string) => {
    setQ(v);
    setCursor(0);
  };
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const go = (h: Hit) => {
    setOpen(false);
    router.push(h.kind === 'page' ? h.page.href : `/master?p=${h.prop.id}`);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter' && hits[cursor]) {
      e.preventDefault();
      go(hits[cursor]);
    }
  };

  return (
    <RD.Root open={open} onOpenChange={setOpen}>
      <RD.Portal>
        <RD.Overlay className="ui-scrim" />
        <RD.Content className="ui-palette" onKeyDown={onKey}>
          <RD.Title className="sr-only">Go to a page or property</RD.Title>
          <RD.Description className="sr-only">Type to search; use the arrow keys and Enter to open.</RD.Description>
          <div className="ui-palette__input">
            <IconSearch />
            <input
              type="search"
              value={q}
              onChange={(e) => type(e.target.value)}
              placeholder={viewer.fm ? 'Go to a page…' : 'Go to a page or property…'}
              aria-label="Search pages and properties"
              role="combobox"
              aria-expanded="true"
              aria-controls="ui-palette-list"
              aria-activedescendant={hits[cursor] ? `ui-palette-${cursor}` : undefined}
              autoFocus
              autoComplete="off"
            />
            <kbd>Esc</kbd>
          </div>
          <ul id="ui-palette-list" role="listbox" className="ui-palette__list" ref={listRef}>
            {hits.map((h, i) => (
              <li
                key={h.kind === 'page' ? h.page.href : `p${h.prop.id}`}
                id={`ui-palette-${i}`}
                data-i={i}
                role="option"
                aria-selected={i === cursor}
                className={`ui-palette__item ${i === cursor ? 'is-active' : ''}`}
                onMouseEnter={() => setCursor(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(h)}
              >
                {h.kind === 'page' ? (
                  <>
                    <NavGlyph icon={h.page.icon} />
                    <span className="ui-palette__label">{h.page.label}</span>
                    <span className="ui-palette__hint">{h.page.hint}</span>
                    <span className="ui-palette__group">{h.group}</span>
                  </>
                ) : (
                  <>
                    <span className="ui-palette__code">{h.prop.code}</span>
                    <span className="ui-palette__label">{h.prop.name}</span>
                    <span className="ui-palette__hint">{h.prop.buName}</span>
                    <span className="ui-palette__group">Lease Budget</span>
                  </>
                )}
              </li>
            ))}
            {!hits.length && <li className="ui-palette__empty">Nothing matches “{q}”.</li>}
          </ul>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
