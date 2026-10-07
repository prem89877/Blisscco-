import type { InstructionKind, NavInstruction, Route, RouteStep } from './types';
import { buildTrack, snapToRoute, type RouteTrack } from './geo';

// Turns the routing provider's manoeuvres into plain Blisscco instructions. Provider words ("end of road", "off ramp", ...)
// are only read here and never shown. A manoeuvre this file does not understand is skipped, and if none are understood the
// screen falls back to route-progress information.

const MODIFIER: Record<string, InstructionKind> = {
  left: 'left', right: 'right',
  'slight left': 'slight_left', 'slight right': 'slight_right',
  'sharp left': 'sharp_left', 'sharp right': 'sharp_right',
  straight: 'straight', uturn: 'uturn',
};

/** Plain instruction kind for one routing step; null when the step carries nothing worth telling the customer. */
export function stepKind(step: RouteStep): InstructionKind | null {
  const type = step.maneuver.toLowerCase();
  const mod = (step.modifier ?? '').toLowerCase();
  if (type === 'arrive') return 'arrive';
  if (type === 'depart' || type === 'notification' || type === '') return null;
  if (mod === 'uturn') return 'uturn';
  if (type.includes('roundabout') || type.includes('rotary')) return type.startsWith('exit') ? null : 'roundabout';
  if (type === 'fork' || type === 'off ramp' || type === 'merge') {
    if (mod.includes('left')) return 'keep_left';
    if (mod.includes('right')) return 'keep_right';
    return null;
  }
  if (type === 'new name' || type === 'continue') return mod === 'straight' || mod === '' ? null : MODIFIER[mod] ?? null;
  const kind = MODIFIER[mod];
  return kind ?? null;
}

export interface RouteGuidance {
  track: RouteTrack;
  /** Steps worth announcing, with where along the route each happens. */
  steps: { index: number; kind: InstructionKind; streetName: string; alongMeters: number }[];
}

/** Built once per route. `steps` is empty when the provider gave no usable instructions. */
export function buildGuidance(route: Route): RouteGuidance {
  const track = buildTrack(route.path);
  const steps: RouteGuidance['steps'] = [];
  let lastAlong = -1;
  route.steps.forEach((s, index) => {
    const kind = stepKind(s);
    if (!kind) return;
    if (!Number.isFinite(s.location.lat) || !Number.isFinite(s.location.lng)) return;
    let along = kind === 'arrive' ? track.totalMeters : snapToRoute(track, s.location, 0).alongMeters;
    if (along < lastAlong) along = lastAlong;   // keep manoeuvres in route order even if a point snapped to an earlier pass
    lastAlong = along;
    steps.push({ index, kind, streetName: s.streetName, alongMeters: along });
  });
  // a route whose only usable "instruction" is the arrival has no turn-by-turn worth showing
  return { track, steps };
}

/** Next manoeuvre for a customer who has travelled `alongMeters`. */
export function nextInstruction(g: RouteGuidance, alongMeters: number): { instruction: NavInstruction; stepIndex: number } | null {
  const next = g.steps.find((s) => s.alongMeters - alongMeters > 8) ?? g.steps[g.steps.length - 1];
  if (!next) return null;
  return {
    stepIndex: next.index,
    instruction: { kind: next.kind, distanceMeters: Math.max(0, next.alongMeters - alongMeters), streetName: next.streetName },
  };
}
