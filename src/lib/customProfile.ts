import type { RoutingProfile } from './routing';

/**
 * Own routing options ("Eigene Routenoptionen").
 *
 * The rider describes what kind of ways, surfaces and climbs they like; this file turns that
 * into a complete BRouter profile script. The app uploads the script to the BRouter server
 * (POST /brouter/profile, see routing.ts) and routes with the id it gets back.
 *
 * Access rules, one-ways, turn costs and the voice-hint classifiers follow BRouter's own
 * `trekking.brf` (MIT licence, https://github.com/abrensch/brouter), so own options behave
 * like the built-in ones where the rider has no say.
 */

/** Kinds of way the rider can rank. */
export type WayKey = 'cycleway' | 'quiet' | 'track' | 'path' | 'pedestrian' | 'minor' | 'major';
/** Kinds of surface the rider can rank. */
export type SurfaceKey = 'paved' | 'pavers' | 'cobble' | 'gravel' | 'natural';

/** ok = allowed, rated by its place in the list; avoid = only when needed; never = excluded */
export type ItemStatus = 'ok' | 'avoid' | 'never';
export interface RankItem<K extends string> {
  key: K;
  status: ItemStatus;
}

/** how much the order of the list matters */
export type Strength = 'low' | 'mid' | 'high';

export interface CustomProfile {
  id: string;
  name: string;
  comment: string;
  /** glyph key, see PROFILE_GLYPHS in components/icons.tsx */
  icon: string;
  color: string;
  /** most wanted first */
  ways: RankItem<WayKey>[];
  surfaces: RankItem<SurfaceKey>[];
  strength: Strength;
  /** 0 = climbs don't matter … 3 = avoid climbing strongly */
  climbAvoid: 0 | 1 | 2 | 3;
  /** steepest climb to accept, in percent; null = no limit */
  maxUphill: number | null;
  /** steepest descent to accept, in percent; null = no limit */
  maxDownhill: number | null;
  cycleRoutes: 'ignore' | 'prefer' | 'stick';
  /** push the bike on footways without bike access and against one-ways */
  allowPush: boolean;
  allowSteps: boolean;
  allowFerries: boolean;
  /** riding pace compared to the built-in options: 0.9 relaxed, 1 normal, 1.1 brisk */
  pace: number;
}

export const WAY_LABELS: Record<WayKey, { label: string; hint: string }> = {
  cycleway: { label: 'Radwege', hint: 'Radwege, Fahrradstraßen und freigegebene Wege' },
  quiet: { label: 'Ruhige Straßen', hint: 'Wohnstraßen, Spielstraßen, Zufahrten' },
  track: { label: 'Wirtschaftswege', hint: 'Feld- und Waldwege' },
  path: { label: 'Pfade & Trails', hint: 'Schmale Wege, Fuß- und Reitwege' },
  pedestrian: { label: 'Fußgängerzonen', hint: 'Oft nur Schrittgeschwindigkeit' },
  minor: { label: 'Nebenstraßen', hint: 'Kreis- und Gemeindestraßen' },
  major: { label: 'Hauptstraßen', hint: 'Bundes- und Landesstraßen' },
};

export const SURFACE_LABELS: Record<SurfaceKey, { label: string; hint: string }> = {
  paved: { label: 'Asphalt & Beton', hint: 'Glatt und schnell' },
  pavers: { label: 'Pflaster', hint: 'Verbundpflaster, Platten' },
  cobble: { label: 'Kopfsteinpflaster', hint: 'Holprig' },
  gravel: { label: 'Schotter & Kies', hint: 'Wassergebundene Decke, Split' },
  natural: { label: 'Naturboden', hint: 'Erde, Gras, Sand, Wurzeln' },
};

export const STRENGTH_STEP: Record<Strength, number> = { low: 0.12, mid: 0.3, high: 0.6 };
/** BRouter uphillcost per climb level (meters of detour accepted per meter climbed, roughly) */
export const CLIMB_COST = [0, 30, 70, 140] as const;
/** a costfactor of 10000 means "never" in BRouter */
const NEVER = 10000;

/** Cost factor per item: 1 for the first allowed item, rising with each place; ×3 when avoided. */
export function rankFactors<K extends string>(items: RankItem<K>[], strength: Strength): Record<K, number> {
  const out = {} as Record<K, number>;
  let rank = 0;
  for (const it of items) {
    if (it.status === 'never') {
      out[it.key] = NEVER;
      continue;
    }
    const f = 1 + rank * STRENGTH_STEP[strength];
    out[it.key] = Math.round((it.status === 'avoid' ? f * 3 : f) * 100) / 100;
    rank++;
  }
  return out;
}

/** What makes a profile unusable, or null. */
export function validateProfile(p: CustomProfile): string | null {
  if (!p.name.trim()) return 'Bitte einen Namen eingeben.';
  if (!p.ways.some((w) => w.status !== 'never')) return 'Mindestens eine Wegart muss erlaubt sein.';
  if (!p.surfaces.some((s) => s.status !== 'never')) return 'Mindestens ein Untergrund muss erlaubt sein.';
  return null;
}

const ALL_WAYS: WayKey[] = ['cycleway', 'quiet', 'track', 'minor', 'path', 'pedestrian', 'major'];
const ALL_SURFACES: SurfaceKey[] = ['paved', 'pavers', 'gravel', 'cobble', 'natural'];

/** The routing option the planner and the router work with. */
export function toRoutingProfile(p: CustomProfile): RoutingProfile {
  return {
    id: p.id,
    label: p.name || 'Eigene Routenoption',
    description: p.comment || 'Eigene Routenoption',
    brouter: 'custom',
    script: brouterScript(p),
    icon: p.icon,
    color: p.color,
    speedKmh: 18,
    paceFactor: p.pace,
  };
}

/** Starting points for a new option. */
export const TEMPLATES: { id: string; label: string; make: () => Omit<CustomProfile, 'id' | 'name' | 'comment'> }[] = [
  {
    id: 'touring',
    label: 'Ausgewogen',
    make: () => ({
      icon: 'balanced', color: '#0b6bd6', strength: 'mid', climbAvoid: 1, maxUphill: null, maxDownhill: null,
      cycleRoutes: 'prefer', allowPush: true, allowSteps: false, allowFerries: true, pace: 1,
      ways: ['cycleway', 'quiet', 'track', 'minor', 'path', 'pedestrian', 'major'].map((key) => ({ key: key as WayKey, status: key === 'major' ? 'avoid' : 'ok' })),
      surfaces: ['paved', 'pavers', 'gravel', 'cobble', 'natural'].map((key) => ({ key: key as SurfaceKey, status: key === 'natural' ? 'avoid' : 'ok' })),
    }),
  },
  {
    id: 'road',
    label: 'Rennrad',
    make: () => ({
      icon: 'road', color: '#7b3fe4', strength: 'mid', climbAvoid: 0, maxUphill: null, maxDownhill: null,
      cycleRoutes: 'ignore', allowPush: false, allowSteps: false, allowFerries: true, pace: 1.1,
      ways: ['quiet', 'minor', 'cycleway', 'major', 'track', 'pedestrian', 'path'].map((key) => ({ key: key as WayKey, status: key === 'path' ? 'never' : key === 'track' || key === 'pedestrian' ? 'avoid' : 'ok' })),
      surfaces: ['paved', 'pavers', 'cobble', 'gravel', 'natural'].map((key) => ({ key: key as SurfaceKey, status: key === 'gravel' || key === 'natural' ? 'never' : key === 'cobble' ? 'avoid' : 'ok' })),
    }),
  },
  {
    id: 'gravel',
    label: 'Gravel',
    make: () => ({
      icon: 'gravel', color: '#a0662b', strength: 'mid', climbAvoid: 1, maxUphill: null, maxDownhill: null,
      cycleRoutes: 'ignore', allowPush: true, allowSteps: false, allowFerries: true, pace: 1,
      ways: ['track', 'cycleway', 'path', 'quiet', 'minor', 'pedestrian', 'major'].map((key) => ({ key: key as WayKey, status: key === 'major' ? 'avoid' : 'ok' })),
      surfaces: ['gravel', 'paved', 'natural', 'pavers', 'cobble'].map((key) => ({ key: key as SurfaceKey, status: key === 'cobble' ? 'avoid' : 'ok' })),
    }),
  },
  {
    id: 'family',
    label: 'Familie',
    make: () => ({
      icon: 'family', color: '#22a35a', strength: 'high', climbAvoid: 3, maxUphill: 6, maxDownhill: 8,
      cycleRoutes: 'prefer', allowPush: true, allowSteps: false, allowFerries: true, pace: 0.85,
      ways: ['cycleway', 'quiet', 'track', 'pedestrian', 'path', 'minor', 'major'].map((key) => ({ key: key as WayKey, status: key === 'major' ? 'never' : key === 'minor' ? 'avoid' : 'ok' })),
      surfaces: ['paved', 'pavers', 'gravel', 'cobble', 'natural'].map((key) => ({ key: key as SurfaceKey, status: key === 'natural' || key === 'cobble' ? 'avoid' : 'ok' })),
    }),
  },
];

export function newCustomProfile(templateId = 'touring'): CustomProfile {
  const t = TEMPLATES.find((x) => x.id === templateId) ?? TEMPLATES[0];
  return { id: `c-${Math.random().toString(36).slice(2, 9)}`, name: '', comment: '', ...t.make() };
}

/** Keeps a stored profile usable when new way or surface kinds are added later. */
export function normalizeProfile(p: CustomProfile): CustomProfile {
  const ways = p.ways.filter((w) => ALL_WAYS.includes(w.key));
  for (const k of ALL_WAYS) if (!ways.some((w) => w.key === k)) ways.push({ key: k, status: 'ok' });
  const surfaces = p.surfaces.filter((s) => ALL_SURFACES.includes(s.key));
  for (const k of ALL_SURFACES) if (!surfaces.some((s) => s.key === k)) surfaces.push({ key: k, status: 'ok' });
  return { ...p, ways, surfaces };
}

const num = (n: number) => String(Math.round(n * 1000) / 1000);

/** The BRouter profile script for an own routing option. */
export function brouterScript(p: CustomProfile): string {
  const w = rankFactors(p.ways, p.strength);
  const s = rankFactors(p.surfaces, p.strength);
  const routePenalty = p.cycleRoutes === 'stick' ? 0.6 : p.cycleRoutes === 'prefer' ? 0.15 : 0;
  const push = p.allowPush ? 4 : NEVER;
  const slope = (name: 'uphill' | 'downhill', max: number | null) =>
    max == null ? '' : `assign ${name}maxslope = ${num(max)}\nassign ${name}maxslopecost = 600\n`;

  return `# Bikepath – eigene Routenoption „${p.name.replace(/[\r\n]/g, ' ')}“ (erzeugt)
---context:global
assign validForBikes = true
assign processUnusedTags = false
assign turnInstructionMode = 1
assign turnInstructionCatchingRange = 40
assign turnInstructionRoundabouts = true
assign considerTurnRestrictions = true
assign correctMisplacedViaPoints = false
assign avoid_unsafe = false
assign stick_to_cycleroutes = false
assign uphillcost = ${CLIMB_COST[p.climbAvoid]}
assign uphillcutoff = 1.5
assign downhillcost = ${p.maxDownhill == null ? 0 : 30}
assign downhillcutoff = 1.5
${slope('uphill', p.maxUphill)}${slope('downhill', p.maxDownhill)}assign totalMass = 90
assign maxSpeed = 45
assign S_C_x = 0.225
assign C_r = 0.01
assign bikerPower = 100

---context:way
assign any_cycleroute =
  or route_bicycle_icn=yes or route_bicycle_ncn=yes or route_bicycle_rcn=yes route_bicycle_lcn=yes
assign nodeaccessgranted = or any_cycleroute lcn=yes
assign hascycleway = not
  and ( or cycleway= cycleway=no|none ) and ( or cycleway:left= cycleway:left=no ) and ( or cycleway:right= cycleway:right=no ) ( or cycleway:both= cycleway:both=no )
assign bikeroad = or bicycle_road=yes cyclestreet=yes
assign isbike = or bikeroad or bicycle=yes|permissive|designated or lcn=yes hascycleway
assign turncost = if junction=roundabout then 0 else 90
assign initialclassifier = if route=ferry then 2 else 1
assign initialcost = if route=ferry then 10000 else 0

assign defaultaccess =
  if access= then not motorroad=yes
  else if access=private|no then false
  else true
assign bikeaccess =
  if bicycle= then
  (
    if bicycle_road=yes then true
    else if vehicle= then ( if highway=footway then false else defaultaccess )
    else not vehicle=private|no
  )
  else not bicycle=private|no|dismount|use_sidepath
assign footaccess =
  if bicycle=dismount then true
  else if foot= then defaultaccess
  else not foot=private|no|use_sidepath
assign accesspenalty =
  if bikeaccess then 0
  else if footaccess then ${push}
  else if any_cycleroute then 15
  else if bicycle=use_sidepath then 25
  else 10000

assign badoneway =
  if reversedirection=yes then
    if oneway:bicycle=yes then true
    else if oneway= then junction=roundabout
    else oneway=yes|true|1
  else oneway=-1
assign onewaypenalty =
  if badoneway then
  (
    if ( or hascycleway or cycleway=opposite|opposite_lane|opposite_track or cycleway:left=opposite|opposite_lane|opposite_track cycleway:right=opposite|opposite_lane|opposite_track ) then 0
    else if oneway:bicycle=no then 0
    else if not footaccess then 100
    else if junction=roundabout|circular then 60
    else if highway=primary|primary_link then 50
    else if highway=secondary|secondary_link then 30
    else if highway=tertiary|tertiary_link then 20
    else ${push}
  )
  else 0

# kind of way, ranked by the rider
assign wayfactor =
  if highway=cycleway then ${num(w.cycleway)}
  else if bikeroad then ${num(w.cycleway)}
  else if and highway=path|footway|bridleway|track bicycle=designated then ${num(w.cycleway)}
  else if highway=residential|living_street|service then ${num(w.quiet)}
  else if highway=pedestrian then ${num(w.pedestrian)}
  else if highway=track|road then ${num(w.track)}
  else if highway=path|footway|bridleway then ${num(w.path)}
  else if highway=unclassified|tertiary|tertiary_link then ( if hascycleway then min ${num(w.minor)} ${num(w.cycleway + 0.2)} else ${num(w.minor)} )
  else if highway=secondary|secondary_link|primary|primary_link then ( if hascycleway then min ${num(w.major)} ${num(w.cycleway + 0.3)} else ${num(w.major)} )
  else if highway=trunk|trunk_link then ( if hascycleway then min ${num(w.major * 2)} ${num(w.cycleway + 0.5)} else ${num(w.major * 3)} )
  else 2

# surface, ranked by the rider; without a surface tag it is guessed from the grade or the kind of way.
# Only BRouter's main lookup values may appear here: an alias (see lookups.dat) is a parse error.
assign surfacefactor =
  if surface=asphalt|concrete|paved|metal|wood then ${num(s.paved)}
  else if surface=paving_stones|sett then ${num(s.pavers)}
  else if surface=cobblestone then ${num(s.cobble)}
  else if surface=compacted|fine_gravel|gravel|pebblestone|grass_paver then ${num(s.gravel)}
  else if surface=ground|dirt|earth|grass|sand|mud|unpaved|clay|rock|stone then ${num(s.natural)}
  else if tracktype=grade1 then ${num(s.paved)}
  else if tracktype=grade2 then ${num(s.gravel)}
  else if tracktype=grade3|grade4|grade5 then ${num(s.natural)}
  else if highway=track then ${num(s.gravel)}
  else if highway=path|bridleway then ${num(s.natural)}
  else ${num(s.paved)}

assign basefactor =
  if or greater wayfactor 9999 greater surfacefactor 9999 then 10000
  else multiply wayfactor surfacefactor

assign routepenalty =
  if any_cycleroute then 0
  else add ${num(routePenalty)} ( if stick_to_cycleroutes then 0.5 else 0 )

assign unsafepenalty = if and avoid_unsafe not isbike then ( if highway=primary|primary_link|secondary|secondary_link|trunk|trunk_link then 2 else 0 ) else 0

assign costfactor =
  if ( and highway= not route=ferry ) then 10000
  else if highway=motorway|motorway_link|proposed|abandoned|construction|platform|raceway then 10000
  else if highway=steps then ${p.allowSteps ? 40 : NEVER}
  else if route=ferry then ${p.allowFerries ? 5.67 : NEVER}
  else min 10000 ( add basefactor ( add routepenalty ( add unsafepenalty ( max onewaypenalty accesspenalty ) ) ) )

# for voice hints (as in trekking.brf)
assign isresidentialorliving = or highway=residential|living_street living_street=yes
assign priorityclassifier =
  if      highway=motorway then 30
  else if highway=motorway_link then 29
  else if highway=trunk then 28
  else if highway=trunk_link then 27
  else if highway=primary then 26
  else if highway=primary_link then 25
  else if highway=secondary then 24
  else if highway=secondary_link then 23
  else if highway=tertiary then 22
  else if highway=tertiary_link then 21
  else if highway=unclassified then 20
  else if isresidentialorliving then 6
  else if highway=service then 6
  else if highway=cycleway then 6
  else if or bicycle=designated bicycle_road=yes then 6
  else if highway=track then ( if tracktype=grade1 then 6 else 4 )
  else if highway=bridleway|road|path|footway then 4
  else if highway=steps then 2
  else if highway=pedestrian then 2
  else 0
assign isbadoneway = not equal onewaypenalty 0
assign isgoodoneway = if reversedirection=yes then oneway=-1 else if oneway= then junction=roundabout else oneway=yes|true|1
assign isroundabout = junction=roundabout
assign islinktype = highway=motorway_link|trunk_link|primary_link|secondary_link|tertiary_link
assign isgoodforcars = if greater priorityclassifier 6 then true
  else if ( or isresidentialorliving highway=service ) then true
  else if ( and highway=track tracktype=grade1 ) then true
  else false
assign classifiermask add isbadoneway add multiply isgoodoneway 2 add multiply isroundabout 4 add multiply islinktype 8 multiply isgoodforcars 16
# keep these tags in the answer: the app reads them for surface and way-type statistics
assign dummyUsage = or smoothness= tracktype=

---context:node
assign defaultaccess =
  if access= then true
  else if access=private|no then false
  else true
assign bikeaccess =
  if nodeaccessgranted=yes then true
  else if bicycle= then ( if vehicle= then defaultaccess else not vehicle=private|no )
  else not bicycle=private|no|dismount
assign footaccess =
  if bicycle=dismount then true
  else if foot= then defaultaccess
  else not foot=private|no
assign initialcost =
  if or highway=traffic_signals and highway=crossing crossing=traffic_signals then 20
  else if bikeaccess then 0
  else ( if footaccess then ${p.allowPush ? 100 : 1000000} else 1000000 )
`;
}
