// Toasts: short confirmations and errors that do not belong to one cell. One live region for the app;
// success and info disappear on their own, errors stay until dismissed. Use the StatusLine for the
// saving / saved state of a grid instead (it sits next to what it describes).
'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from './button';
import { IconClose, IconError, IconInfo, IconSuccess, IconWarning } from './icons';

export type ToastKind = 'success' | 'error' | 'warning' | 'info';
export interface Toast {
  id: number;
  kind: ToastKind;
  title: ReactNode;
  body?: ReactNode;
}
interface ToastApi {
  toast: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}

const Ctx = createContext<ToastApi>({ toast: () => {}, dismiss: () => {} });
export const useToast = () => useContext(Ctx);

const ICON: Record<ToastKind, ReactNode> = { success: <IconSuccess />, error: <IconError />, warning: <IconWarning />, info: <IconInfo /> };
const DWELL: Record<ToastKind, number> = { success: 4000, info: 5000, warning: 8000, error: 0 };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = next.current++;
      setItems((xs) => [...xs.slice(-3), { ...t, id }]);
      const ms = DWELL[t.kind];
      if (ms) setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );
  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="ui-toasts" aria-live="polite" aria-relevant="additions">
        {items.map((t) => (
          <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className={`ui-toast ui-toast--${t.kind}`}>
            <span className="ui-toast__icon">{ICON[t.kind]}</span>
            <div className="min-w-0">
              <div className="ui-toast__title">{t.title}</div>
              {t.body && <div className="ui-toast__body">{t.body}</div>}
            </div>
            <Button variant="tertiary" size="sm" iconOnly aria-label="Dismiss" icon={<IconClose />} onClick={() => dismiss(t.id)} />
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
