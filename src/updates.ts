import { registerSW } from 'virtual:pwa-register';
import { useStore } from './store';

/**
 * Keeping the installed app up to date.
 *
 * Android keeps an installed web app in memory; tapping its icon only brings the old page
 * back, so the browser's own update check (on page load) rarely runs. We therefore also
 * check when the app comes back to the foreground and once an hour.
 *
 * A new version takes over with a page reload. That would end a ride and lose a plan that
 * is not saved (the planner lives in memory only), so the switch waits until nothing is
 * in progress: no ride, no plan, no start dialog.
 */

/** how often to look for a new version while the app stays open */
const CHECK_EVERY_MS = 60 * 60 * 1000;
/** the visibility check runs at most this often (switching apps back and forth) */
const MIN_GAP_MS = 60 * 1000;

const idle = (s = useStore.getState()) => !s.session && !s.pendingNav && s.waypoints.length === 0 && !s.loop;

export function setupUpdates() {
  let pending = false;
  let applying = false;
  const apply = () => {
    if (!pending || applying || !idle()) return;
    applying = true;
    void updateSW(true); // activates the new service worker; the page reloads when it takes control
  };

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      pending = true;
      apply();
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      let last = Date.now();
      const check = () => {
        if (!navigator.onLine || Date.now() - last < MIN_GAP_MS) return;
        last = Date.now();
        reg.update().catch(() => {});
      };
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
        else apply(); // leaving the app is a good moment to switch quietly
      });
      setInterval(check, CHECK_EVERY_MS);
    },
  });

  // a ride ended or the plan was cleared: catch up on a waiting update
  useStore.subscribe((s) => {
    if (pending && idle(s)) apply();
  });
}
