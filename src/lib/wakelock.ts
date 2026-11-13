let lock: WakeLockSentinel | null = null;
let wanted = false;

export async function keepAwake(on: boolean) {
  wanted = on;
  try {
    if (on && 'wakeLock' in navigator && !lock) {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => (lock = null));
    } else if (!on && lock) {
      await lock.release();
      lock = null;
    }
  } catch {
    /* not allowed (e.g. battery saver) */
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wanted) keepAwake(true);
  });
}
