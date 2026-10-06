'use client';

import { useState } from 'react';
import type { Theme } from '@/lib/theme';
import { setTheme } from './actions';

/** Paper / Carbon switch. Applies at once; the cookie keeps it for the next visit. */
export function ThemeSwitch({ initial }: { initial: Theme }) {
  const [theme, set] = useState<Theme>(initial);
  const choose = (t: Theme) => {
    set(t);
    document.documentElement.dataset.theme = t;
    void setTheme(t);
  };
  return (
    <div className="anh-seg" role="group" aria-label="Theme">
      <button type="button" aria-pressed={theme === 'light'} onClick={() => choose('light')}>
        Light
      </button>
      <button type="button" aria-pressed={theme === 'dark'} onClick={() => choose('dark')}>
        Dark
      </button>
    </div>
  );
}
