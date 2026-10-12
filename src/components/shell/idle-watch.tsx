'use client';

// Signs the user out after 15 minutes without keyboard or mouse activity, and keeps the session alive
// while they work without saving (the server ends an idle session on its own as well).
import { useEffect } from 'react';

const IDLE_MS = 15 * 60_000;
const PING_EVERY_MS = 2 * 60_000;

export function IdleWatch() {
  useEffect(() => {
    let last = Date.now();
    let pinged = Date.now();
    const seen = () => {
      last = Date.now();
    };
    const events = ['keydown', 'mousedown', 'mousemove', 'wheel', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, seen, { passive: true });
    const leave = () => {
      const next = window.location.pathname + window.location.search;
      // a full page load: nothing from the session stays in the browser
      window.location.replace(new URL(`/login?idle=1&next=${encodeURIComponent(next)}`, window.location.origin).href);
    };
    const timer = window.setInterval(async () => {
      const now = Date.now();
      if (now - last >= IDLE_MS) return leave();
      if (last > pinged && now - pinged >= PING_EVERY_MS) {
        pinged = now;
        try {
          const r = await fetch('/api/session/ping', { cache: 'no-store' });
          if (r.status === 401) leave();
        } catch {
          // offline for a moment: the next tick tries again
        }
      }
    }, 30_000);
    return () => {
      window.clearInterval(timer);
      for (const e of events) window.removeEventListener(e, seen);
    };
  }, []);
  return null;
}
