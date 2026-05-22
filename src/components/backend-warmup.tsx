'use client';

import { useEffect } from 'react';

// Cold-starts backends on app mount and keeps them warm via a 12-min
// keep-alive ping. Render's free/Starter inactivity timer is 15 min, so
// 12 min has 3 min of safety margin against scheduling jitter.
//
// Active-only: skip the ping if the user hasn't interacted with the page
// in the last 10 min. Stops a tab left open over the weekend from holding
// backends warm forever (especially on usage-billed platforms).
const KEEP_ALIVE_INTERVAL_MS = 12 * 60 * 1000;
const ACTIVE_WINDOW_MS = 10 * 60 * 1000;

let lastActivityAt = Date.now();

async function pingWarmup() {
  try {
    const res = await fetch('/api/warmup', { cache: 'no-store' });
    const data = await res.json();
    console.log('[warmup]', data?.results);
  } catch (err) {
    console.warn('[warmup] failed:', err);
  }
}

export function BackendWarmup() {
  useEffect(() => {
    pingWarmup();

    const markActive = () => {
      lastActivityAt = Date.now();
    };
    const activityEvents = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'] as const;
    activityEvents.forEach((evt) =>
      window.addEventListener(evt, markActive, { passive: true }),
    );

    const interval = setInterval(() => {
      // Skip the keep-alive if the user has been idle past the active window.
      // Cold-start latency on next interaction is acceptable; wasting backend
      // uptime on an abandoned tab is not.
      if (Date.now() - lastActivityAt > ACTIVE_WINDOW_MS) return;
      pingWarmup();
    }, KEEP_ALIVE_INTERVAL_MS);

    // When the tab becomes visible again after being hidden, treat it as
    // activity and warm up immediately so the user doesn't hit a cold start.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        markActive();
        pingWarmup();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(interval);
      activityEvents.forEach((evt) =>
        window.removeEventListener(evt, markActive),
      );
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return null;
}
