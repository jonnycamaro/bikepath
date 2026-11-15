import type { TapAction } from '../lib/tapActions';

/**
 * Symbols for start, stop, destination and info – shared by the half-ring menu (TapMenu) and
 * the route list in the planner, so both speak the same visual language.
 * Glyphs are drawn in `currentColor` on a pastel background (`--seg`), 24 × 24 box.
 */
export const GLYPHS: Record<TapAction, string> = {
  start: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M10 8.2 16 12l-6 3.8Z" fill="currentColor"/>',
  end: '<path d="M6 21V4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M6 4h12v9H6" fill="currentColor"/><path d="M6 4h3v3H6zM12 4h3v3h-3zM9 7h3v3H9zM15 7h3v3h-3zM6 10h3v3H6zM12 10h3v3h-3z" fill="var(--seg)"/>',
  via: '<path d="M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11Z" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 7v6M9 10h6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  info: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 11v6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="7.6" r="1.4" fill="currentColor"/>',
  delete: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>',
};

/** pastel fill and a darker shade of the same hue: green start, blue stop, red destination, grey info */
export const SYMBOL_COLOR: Record<TapAction, { bg: string; fg: string }> = {
  start: { bg: '#bfe6cc', fg: '#1f7a43' },
  via: { bg: '#c6ddf6', fg: '#0b5bb5' },
  end: { bg: '#f7c9ca', fg: '#b3262a' },
  info: { bg: '#d6dce4', fg: '#334155' },
  delete: { bg: '#f6d3c4', fg: '#b4471c' },
};
export const SYMBOL_OFF = { bg: '#eceff3', fg: '#b3bdca' };

/** Round badge with the symbol, e.g. in the route list. */
export function RouteSymbol({ kind, size = 34 }: { kind: TapAction; size?: number }) {
  const c = SYMBOL_COLOR[kind];
  return (
    <span className="route-symbol" style={{ width: size, height: size, background: c.bg, color: c.fg, ['--seg' as string]: c.bg }} aria-hidden>
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: GLYPHS[kind] }} />
    </span>
  );
}
