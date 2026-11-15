import { profileById } from './routing';
/**
 * The rider's bike. It sets the pace that durations, arrival times and time-based round trips
 * are calculated with; the routing option only nudges it (trails are slower than tarmac).
 */
export interface BikeType {
  id: string;
  label: string;
  description: string;
  /** typical average on a mixed tour, km/h */
  speedKmh: number;
  /** glyph name in ProfileBadge */
  icon: string;
}

export const BIKE_TYPES: BikeType[] = [
  { id: 'city', label: 'Citybike', description: 'Stadt- und Hollandrad, aufrecht und gemütlich', speedKmh: 15, icon: 'city' },
  { id: 'trekking', label: 'Trekkingrad', description: 'Touren- und Alltagsrad für längere Strecken', speedKmh: 18, icon: 'trekking' },
  { id: 'gravel', label: 'Gravelbike', description: 'Sportlich auf Asphalt und Schotter', speedKmh: 22, icon: 'gravel' },
  { id: 'road', label: 'Rennrad', description: 'Schnell auf glattem Asphalt', speedKmh: 26, icon: 'road' },
  { id: 'mtb', label: 'Mountainbike', description: 'Breite Reifen, gemacht fürs Gelände', speedKmh: 16, icon: 'mtb' },
  { id: 'ebike', label: 'E-Bike', description: 'Pedelec mit Unterstützung bis 25 km/h', speedKmh: 22, icon: 'ebike' },
  { id: 'cargo', label: 'Lastenrad', description: 'Mit Kindern oder Gepäck unterwegs', speedKmh: 14, icon: 'cargo' },
];

export const DEFAULT_BIKE = 'trekking';
export const bikeById = (id: string | undefined): BikeType => BIKE_TYPES.find((b) => b.id === id) ?? BIKE_TYPES.find((b) => b.id === DEFAULT_BIKE)!;

/** How much faster or slower a routing option rides than the bike's average. */
const OPTION_FACTOR: Record<string, number> = {
  fastest: 1.05,
  road: 1.05,
  smooth: 1.03,
  cyclepaths: 0.96,
  shortest: 0.95,
  gravel: 0.93,
  mtb: 0.8,
};

export interface PaceSettings {
  bikeType?: string;
  /** own average in km/h; null = the bike type's usual pace */
  bikeSpeed?: number | null;
}

/** The rider's average on flat, mixed ground. */
export const bikeSpeed = (s: PaceSettings): number => s.bikeSpeed ?? bikeById(s.bikeType).speedKmh;

/** Pace used for a route planned with the routing option `profileId`. */
export const rideSpeed = (s: PaceSettings, profileId: string): number =>
  Math.round(bikeSpeed(s) * (OPTION_FACTOR[profileId] ?? profileById(profileId).paceFactor ?? 1) * 10) / 10;
