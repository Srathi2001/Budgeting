// Status pieces: the saving / saved / error line next to a grid, an inline message banner, a status tag.
// Meaning is carried by the word and an icon; colour comes with them, never alone.
import type { CSSProperties, ReactNode } from 'react';
import { Button } from './button';
import { IconError, IconInfo, IconSpinner, IconSuccess, IconWarning } from './icons';

export type StatusKind = 'idle' | 'saving' | 'saved' | 'error' | 'unsaved';

/** The state of a grid's autosave, as a live region. `unsaved` counts edits waiting to be sent. */
export function StatusLine({ kind, text, unsaved = 0, onRetry, className = '' }: { kind: StatusKind; text?: ReactNode; unsaved?: number; onRetry?: () => void; className?: string }) {
  const icon = kind === 'saving' ? <IconSpinner size={14} /> : kind === 'saved' ? <IconSuccess size={14} /> : kind === 'error' ? <IconError size={14} /> : kind === 'unsaved' ? <IconWarning size={14} /> : null;
  const label = text ?? (kind === 'saving' ? 'Saving…' : kind === 'saved' ? 'Saved' : kind === 'unsaved' ? `${unsaved} unsaved change${unsaved === 1 ? '' : 's'}` : '');
  return (
    <span role="status" aria-live="polite" className={`ui-status ui-status--${kind} ${className}`}>
      {icon}
      <span>{label}</span>
      {kind === 'error' && onRetry && unsaved > 0 && (
        <Button size="sm" onClick={onRetry}>
          Retry {unsaved} unsaved
        </Button>
      )}
    </span>
  );
}

export type BannerKind = 'error' | 'warning' | 'success' | 'info';
const BANNER_ICON: Record<BannerKind, ReactNode> = { error: <IconError />, warning: <IconWarning />, success: <IconSuccess />, info: <IconInfo /> };

/** A message block in the page flow: a rule and an icon in the status colour, text in ink. */
export function Banner({ kind, title, children, actions, className = '' }: { kind: BannerKind; title?: ReactNode; children?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`ui-banner ui-banner--${kind} ${className}`}>
      <span className="ui-banner__icon">{BANNER_ICON[kind]}</span>
      <div className="min-w-0 flex-1">
        {title && <div className="ui-banner__title">{title}</div>}
        {children && <div className="ui-banner__body">{children}</div>}
      </div>
      {actions && <div className="ui-banner__actions">{actions}</div>}
    </div>
  );
}

/** Nothing to show yet: say why and what to do next. */
export function EmptyState({ title, children, action, className = '' }: { title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`ui-empty ${className}`}>
      <div className="ui-empty__title">{title}</div>
      {children && <div className="ui-empty__body">{children}</div>}
      {action && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}

/** Loading placeholders: a tile, a table, a chart, or a plain bar. */
export function Skeleton({ kind = 'bar', rows = 6, className = '', style }: { kind?: 'bar' | 'tile' | 'table' | 'chart'; rows?: number; className?: string; style?: CSSProperties }) {
  if (kind === 'tile')
    return (
      <div className={`ui-skel-tile ${className}`} aria-hidden="true">
        <span className="ui-skel" style={{ width: '40%', height: 10 }} />
        <span className="ui-skel" style={{ width: '60%', height: 28 }} />
        <span className="ui-skel" style={{ width: '50%', height: 10 }} />
      </div>
    );
  if (kind === 'table')
    return (
      <div className={`ui-skel-table ${className}`} aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <span key={i} className="ui-skel" style={{ height: 14, width: `${70 + ((i * 13) % 30)}%` }} />
        ))}
      </div>
    );
  if (kind === 'chart') return <div className={`ui-skel ui-skel-chart ${className}`} style={style} aria-hidden="true" />;
  return <span className={`ui-skel ${className}`} style={style} aria-hidden="true" />;
}
