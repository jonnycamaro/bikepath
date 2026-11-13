import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { Fix } from '../src/lib/navigation';

const { useStore } = await import('../src/store');
const { restoreRide, startFreeRide, stopRide } = await import('../src/session');
const { Recorder } = await import('../src/lib/recording');
const { location } = await import('../src/lib/location');
const { kvSet } = await import('../src/lib/storage');

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Push a position straight into the location service, bypassing the GPS hardware. */
const emit = (accuracy: number) =>
  (location as unknown as { emit: (f: Fix) => void }).emit({
    lngLat: [11.5755, 48.1372],
    accuracy,
    speed: 0,
    heading: 0,
    altitude: 515,
    time: Date.now(),
  });

/** The watchdog ticks every 3 s; wait a little longer so a tick has certainly run. */
const TICK = 3400;

describe('ride session', () => {
  it('restores a ride together with its GPS watchdog', async () => {
    // a ride that was cut short by the app being closed
    const rec = new Recorder({ autoPause: false });
    rec.start();
    rec.add({ lngLat: [11.5755, 48.1372], accuracy: 6, speed: 4, heading: 0, altitude: 515, time: Date.now() });
    await kvSet('activeRide', { rec: rec.snapshot(), route: null });

    useStore.setState({ gpsStatus: 'waiting' }); // the value a ride starts from
    expect(await restoreRide()).toBe(true);
    emit(6);
    await wait(TICK);
    // without the watchdog the status stays on its initial 'waiting' forever
    expect(useStore.getState().gpsStatus).toBe('ok');
    await stopRide(false);
  }, 15000);

  it('warns about weak GPS only after a sustained poor fix, and clears on a good one', async () => {
    startFreeRide();
    emit(6);
    await wait(TICK);
    expect(useStore.getState().gpsStatus).toBe('ok');

    // a single poor sample must not flip the hint — accuracy fluctuates by tens of metres
    emit(60);
    await wait(TICK);
    expect(useStore.getState().gpsStatus).toBe('ok');

    // still poor one tick later: now it is worth telling the rider
    await wait(TICK);
    expect(useStore.getState().gpsStatus).toBe('weak');

    emit(6);
    await wait(TICK);
    expect(useStore.getState().gpsStatus).toBe('ok');
    await stopRide(false);
  }, 30000);
});
