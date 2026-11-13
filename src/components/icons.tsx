import type { CSSProperties } from 'react';
import type { Maneuver } from '../lib/instructions';

type P = { size?: number; style?: CSSProperties; className?: string };
const S = ({ size = 24, style, className, children }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={style} className={className} aria-hidden>
    {children}
  </svg>
);

export const IconMap = (p: P) => <S {...p}><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" /><path d="M9 4v14M15 6v14" /></S>;
export const IconPlan = (p: P) => <S {...p}><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5" /></S>;
export const IconRecord = (p: P) => <S {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" fill="currentColor" /></S>;
export const IconRoutes = (p: P) => <S {...p}><path d="M5 4h14v16l-7-4-7 4Z" /></S>;
export const IconProfile = (p: P) => <S {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></S>;
export const IconSearch = (p: P) => <S {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></S>;
export const IconLocate = (p: P) => <S {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></S>;
export const IconHeading = (p: P) => <S {...p}><path d="M12 2 19 21l-7-4-7 4Z" fill="currentColor" /></S>;
export const IconLayers = (p: P) => <S {...p}><path d="m12 3 9 5-9 5-9-5Z" /><path d="m3 13 9 5 9-5" /></S>;
export const IconClose = (p: P) => <S {...p}><path d="M6 6l12 12M18 6 6 18" /></S>;
export const IconUndo = (p: P) => <S {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></S>;
export const IconRedo = (p: P) => <S {...p}><path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h3" /></S>;
export const IconSwap = (p: P) => <S {...p}><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" /></S>;
export const IconTrash = (p: P) => <S {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></S>;
export const IconLoop = (p: P) => <S {...p}><path d="M20 12a8 8 0 1 1-3-6.2" /><path d="M20 4v5h-5" /></S>;
export const IconSave = (p: P) => <S {...p}><path d="M5 3h11l3 3v15H5Z" /><path d="M8 3v5h7V3M8 21v-7h8v7" /></S>;
export const IconNavigate = (p: P) => <S {...p}><path d="M3 11 21 3l-8 18-2-8Z" fill="currentColor" /></S>;
export const IconPlay = (p: P) => <S {...p}><path d="M7 4v16l13-8Z" fill="currentColor" /></S>;
export const IconPause = (p: P) => <S {...p}><path d="M7 4h3v16H7zM14 4h3v16h-3z" fill="currentColor" /></S>;
export const IconStop = (p: P) => <S {...p}><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" /></S>;
export const IconVolume = (p: P) => <S {...p}><path d="M4 9v6h4l5 4V5L8 9Z" /><path d="M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12" /></S>;
export const IconMute = (p: P) => <S {...p}><path d="M4 9v6h4l5 4V5L8 9Z" /><path d="m17 9 5 6M22 9l-5 6" /></S>;
export const IconList = (p: P) => <S {...p}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></S>;
export const IconDownload = (p: P) => <S {...p}><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></S>;
export const IconUpload = (p: P) => <S {...p}><path d="M12 21V9M7 14l5-5 5 5M4 3h16" /></S>;
export const IconShare = (p: P) => <S {...p}><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" /></S>;
export const IconStar = ({ filled, ...p }: P & { filled?: boolean }) => <S {...p}><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9Z" fill={filled ? 'currentColor' : 'none'} /></S>;
export const IconFolder = (p: P) => <S {...p}><path d="M3 6h6l2 2h10v11H3Z" /></S>;
export const IconEdit = (p: P) => <S {...p}><path d="M4 20h4L19 9l-4-4L4 16Z" /></S>;
export const IconSettings = (p: P) => <S {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></S>;
export const IconCloud = (p: P) => <S {...p}><path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1 0 8Z" /></S>;
export const IconMountain = (p: P) => <S {...p}><path d="m3 20 6-11 4 6 2-3 6 8Z" /></S>;
export const IconClock = (p: P) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></S>;
export const IconRuler = (p: P) => <S {...p}><path d="M3 17 17 3l4 4L7 21Z" /><path d="m7 13 2 2M10 10l2 2M13 7l2 2" /></S>;
export const IconPlus = (p: P) => <S {...p}><path d="M12 5v14M5 12h14" /></S>;
export const IconChevron = (p: P) => <S {...p}><path d="m9 6 6 6-6 6" /></S>;
export const IconUp = (p: P) => <S {...p}><path d="m6 15 6-6 6 6" /></S>;
export const IconDown = (p: P) => <S {...p}><path d="m6 9 6 6 6-6" /></S>;
export const IconBike = (p: P) => <S {...p}><circle cx="5.5" cy="16.5" r="3.5" /><circle cx="18.5" cy="16.5" r="3.5" /><path d="M5.5 16.5 9 9h6l3.5 7.5M9 9 12 16.5h6.5M14 5h2.5l-1.5 4" /></S>;
export const IconWind = (p: P) => <S {...p}><path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8" /></S>;
export const IconPen = (p: P) => <S {...p}><path d="M3 21c3-1 5-6 9-6s4 4 9 2" /><path d="m14 4 6 6-8 3 2-9Z" /></S>;
export const IconCompass = (p: P) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="m12 5 3 7h-6Z" fill="#e53935" stroke="#e53935" /><path d="m12 19-3-7h6Z" /></S>;
export const Icon3D = (p: P) => <S {...p}><path d="M12 3 4 7.5v9L12 21l8-4.5v-9Z" /><path d="M4 7.5 12 12l8-4.5M12 12v9" /></S>;
export const IconOffline = (p: P) => <S {...p}><path d="M12 3v10M8 9l4 4 4-4" /><path d="M5 15v4h14v-4" /></S>;
export const IconFlag = (p: P) => <S {...p}><path d="M5 21V4h11l-2 4 2 4H5" /></S>;
export const IconHome = (p: P) => <S {...p}><path d="m3 11 9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></S>;
export const IconWork = (p: P) => <S {...p}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 12h18" /></S>;
export const IconSim = (p: P) => <S {...p}><path d="M5 3v18l15-9Z" /><path d="M2 12h3" /></S>;

/** Turn arrows for the navigation banner. */
export function ManeuverIcon({ m, size = 48, exit }: { m: Maneuver; size?: number; exit?: number }) {
  const rot: Partial<Record<Maneuver, number>> = {
    straight: 0, depart: 0, 'slight-left': -45, left: -90, 'sharp-left': -135, 'slight-right': 45, right: 90, 'sharp-right': 135, 'keep-left': -25, 'keep-right': 25,
  };
  if (m === 'arrive' || m === 'waypoint') return <IconFlag size={size} />;
  if (m === 'uturn')
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M30 42V18a8 8 0 0 0-16 0v6" /><path d="m8 18 6 7 6-7" />
      </svg>
    );
  if (m === 'roundabout')
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={4.5} strokeLinecap="round">
        <circle cx="24" cy="22" r="8" /><path d="M24 44V30M30 16l7-7M31 9h6v6" />
        {exit ? <text x="24" y="26" fontSize="10" fill="currentColor" stroke="none" textAnchor="middle" fontWeight="700">{exit}</text> : null}
      </svg>
    );
  const r = rot[m] ?? 0;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round">
      <g transform={`rotate(${r} 24 30)`}>
        <path d="M24 44V30" />
        <path d="M24 30V8M14 18l10-10 10 10" />
      </g>
      {Math.abs(r) > 0 && <path d="M24 44V31" />}
    </svg>
  );
}
