import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildTrack, distanceMeters, snapToRoute } from '../../src/lib/navigation/geo';
import { stepKind } from '../../src/lib/navigation/instructions';
import { withRouteCache, type RoutingProvider } from '../../src/lib/navigation/RoutingProvider';
import type { RouteStep } from '../../src/lib/navigation/types';
import { START, makeRoute, offset } from './helpers';

const step = (maneuver: string, modifier: string | null = null): RouteStep =>
  ({ maneuver, modifier, streetName: '', distanceMeters: 0, durationSeconds: 0, location: START });

describe('geo', () => {
  it('distance', () => assert.ok(Math.abs(distanceMeters(START, offset(START, 1000)) - 1000) < 3));
  it('snap: along, offset, segment', () => {
    const track = buildTrack(makeRoute().path);
    const s = snapToRoute(track, offset(START, 350, 20));
    assert.ok(Math.abs(s.alongMeters - 350) < 3);
    assert.ok(Math.abs(s.offsetMeters - 20) < 1);
    assert.equal(s.segment, 3);
  });
  it('snap before the start / after the end clamps', () => {
    const track = buildTrack(makeRoute().path);
    assert.ok(snapToRoute(track, offset(START, -50)).alongMeters < 1);
    assert.ok(Math.abs(snapToRoute(track, offset(START, 1600)).alongMeters - 1500) < 2);
  });
  it('a route that returns along the same street does not make the customer jump back', () => {
    const out = [START, offset(START, 500), offset(START, 500, 40), offset(START, 0, 40)];   // there and back on parallel lines 40 m apart
    const track = buildTrack(out);
    const s = snapToRoute(track, offset(START, 300, 40), 2);
    assert.equal(s.segment, 2);
  });
});

describe('instructions', () => {
  it('plain wording kinds', () => {
    assert.equal(stepKind(step('turn', 'left')), 'left');
    assert.equal(stepKind(step('turn', 'right')), 'right');
    assert.equal(stepKind(step('turn', 'slight right')), 'slight_right');
    assert.equal(stepKind(step('end of road', 'left')), 'left');
    assert.equal(stepKind(step('turn', 'uturn')), 'uturn');
    assert.equal(stepKind(step('continue', 'uturn')), 'uturn');
    assert.equal(stepKind(step('fork', 'left')), 'keep_left');
    assert.equal(stepKind(step('fork', 'slight right')), 'keep_right');
    assert.equal(stepKind(step('off ramp', 'right')), 'keep_right');
    assert.equal(stepKind(step('arrive', 'left')), 'arrive');
    assert.equal(stepKind(step('roundabout', 'right')), 'roundabout');
    assert.equal(stepKind(step('turn', 'straight')), 'straight');
  });
  it('noise is skipped', () => {
    assert.equal(stepKind(step('depart', 'right')), null);
    assert.equal(stepKind(step('new name', 'straight')), null);
    assert.equal(stepKind(step('continue', 'straight')), null);
    assert.equal(stepKind(step('exit roundabout', 'right')), null);
    assert.equal(stepKind(step('notification')), null);
    assert.equal(stepKind(step('teleport', 'sideways')), null);
    assert.equal(stepKind(step('')), null);
  });
});

describe('route cache', () => {
  it('repeat request from (almost) the same spot reuses the route; a failure is not cached', async () => {
    let calls = 0; let fail = false;
    const inner: RoutingProvider = { id: 'x', getRoute: async () => { calls++; if (fail) throw new Error('down'); return makeRoute(); } };
    let t = 0;
    const cached = withRouteCache(inner, { ttlMs: 1000, now: () => t });
    const req = { from: START, to: offset(START, 1500) };
    await cached.getRoute(req);
    await cached.getRoute({ ...req, from: offset(START, 3) });
    assert.equal(calls, 1);
    t = 2000;
    fail = true;
    await assert.rejects(cached.getRoute(req));
    fail = false;
    await cached.getRoute(req);
    assert.equal(calls, 3);
    await cached.getRoute({ from: offset(START, 400), to: req.to });
    assert.equal(calls, 4);
  });
});
