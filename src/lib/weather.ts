import type { LngLat } from './geo';

export interface Weather {
  temperature: number;
  windSpeed: number; // km/h
  windDirection: number; // deg, where wind comes FROM
  precipitationProbability: number;
  code: number;
  hourly: { time: string; temp: number; rain: number; wind: number }[];
}

export async function fetchWeather(p: LngLat, signal?: AbortSignal): Promise<Weather> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${p[1].toFixed(3)}&longitude=${p[0].toFixed(3)}` +
    `&current=temperature_2m,wind_speed_10m,wind_direction_10m,weather_code&hourly=temperature_2m,precipitation_probability,wind_speed_10m&forecast_hours=12&timezone=auto`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('Wetter nicht verfügbar');
  const j = await res.json();
  const h = j.hourly;
  return {
    temperature: j.current.temperature_2m,
    windSpeed: j.current.wind_speed_10m,
    windDirection: j.current.wind_direction_10m,
    precipitationProbability: h.precipitation_probability?.[0] ?? 0,
    code: j.current.weather_code,
    hourly: h.time.map((t: string, i: number) => ({ time: t, temp: h.temperature_2m[i], rain: h.precipitation_probability[i], wind: h.wind_speed_10m[i] })),
  };
}

export function weatherLabel(code: number): string {
  if (code === 0) return 'Klar';
  if (code <= 3) return 'Bewölkt';
  if (code <= 48) return 'Nebel';
  if (code <= 67) return 'Regen';
  if (code <= 77) return 'Schnee';
  if (code <= 82) return 'Schauer';
  return 'Gewitter';
}

/** Share of the route with headwind (wind from within ±60° of travel direction). */
export function headwindShare(bearings: { bearing: number; len: number }[], windFrom: number): { head: number; tail: number; cross: number } {
  let head = 0, tail = 0, cross = 0, tot = 0;
  for (const b of bearings) {
    const d = Math.abs(((windFrom - b.bearing + 540) % 360) - 180);
    if (d < 60) head += b.len; else if (d > 120) tail += b.len; else cross += b.len;
    tot += b.len;
  }
  return tot ? { head: head / tot, tail: tail / tot, cross: cross / tot } : { head: 0, tail: 0, cross: 0 };
}
