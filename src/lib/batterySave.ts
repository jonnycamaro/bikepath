import { location } from './location';
import { useStore } from '../store';

/**
 * Battery save mode: fewer position updates, forced dark theme and a
 * simplified ("ECO") map style. 'auto' follows the device's own power saver when the
 * browser exposes it (Chrome/Android).
 */
let previousStyle: string | null = null;
const ECO_STYLE = 'light';

type BatteryLike = { addEventListener?: (t: string, fn: () => void) => void; charging?: boolean; level?: number };
let listening = false;

export async function deviceSaverActive(): Promise<boolean> {
  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
  if (!nav.getBattery) return false;
  try {
    const b = await nav.getBattery();
    if (!listening) {
      listening = true;
      b.addEventListener?.('levelchange', () => applyBatterySave(true));
      b.addEventListener?.('chargingchange', () => applyBatterySave(true));
    }
    return !b.charging && (b.level ?? 1) <= 0.2;
  } catch {
    return false;
  }
}

/** Enable or disable the mode for a ride. Call with false when the ride ends. */
export async function applyBatterySave(riding: boolean) {
  const st = useStore.getState();
  const mode = st.settings.batterySaveMode;
  const want = riding && (mode === 'on' || (mode === 'auto' && (await deviceSaverActive())));
  if (want === st.settings.batterySave) return;
  if (want) {
    previousStyle = st.settings.mapStyle;
    st.setSettings({ batterySave: true, mapStyle: ECO_STYLE, terrain3d: false });
    location.setLowPower(true);
    st.toastMsg('Batteriesparmodus aktiv');
  } else {
    st.setSettings({ batterySave: false, ...(previousStyle ? { mapStyle: previousStyle } : {}) });
    previousStyle = null;
    location.setLowPower(false);
  }
}
