// The one page header: eyebrow (the navigation group), the h1, a one-line subtitle that states the
// basis and units, then the actions on the right (one primary at most). A 2 px rule closes it.
import type { ReactNode } from 'react';

export function PageHeader({ eyebrow, title, sub, actions, tabs, className = '' }: { eyebrow?: ReactNode; title: ReactNode; sub?: ReactNode; actions?: ReactNode; tabs?: ReactNode; className?: string }) {
  return (
    <header className={`ui-pagehead ${className}`}>
      <div className="ui-pagehead__row">
        <div className="min-w-0">
          {eyebrow && <span className="anh-eyebrow">{eyebrow}</span>}
          <h1 className="ui-pagehead__title">{title}</h1>
          {sub && <p className="ui-pagehead__sub">{sub}</p>}
        </div>
        {actions && <div className="ui-pagehead__actions">{actions}</div>}
      </div>
      {tabs}
    </header>
  );
}
