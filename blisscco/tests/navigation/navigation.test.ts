import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NavigationService } from '../../src/lib/navigation/NavigationService';
import { NavigationError, type Destination } from '../../src/lib/navigation/types';
import { FakeLocation, FakeNetwork, FakeRouting, FakeWake, SHOP, START, flush, loc, makeRoute, offset } from './helpers';

const DEST: Destination = { shopId: '11111111-1111-1111-1111-111111111111', name: 'Glow Salon', address: 'MG Road, Pune', position: SHOP };

function setup(tuning = {}) {
  const location = new FakeLocation();
  const routing = new FakeRouting();
  const network = new FakeNetwork();
  const wake = new FakeWake();
  let clock = 1_000_000;
  const svc = new NavigationService({ location, routing, network, screenWake: wake, tuning, now: () => clock });
  return { svc, location, routing, network, wake, advance: (ms: number) => { clock += ms; }, st: () => svc.getSnapshot() };
}

async function ready(s: ReturnType<typeof setup>) {
  await s.svc.start(DEST);
  assert.equal(s.st().navigationStatus, 'route_ready');
  s.svc.beginNavigation();
  assert.equal(s.st().navigationStatus, 'navigating');
}

describe('1-6 start: permission, GPS, route', () => {
  it('1 permission granted -> route ready, one GPS fix, one routing request (with shop id)', async () => {
    const s = setup();
    await s.svc.start(DEST);
    assert.equal(s.st().navigationStatus, 'route_ready');
    assert.equal(s.location.locateCalls, 1);
    assert.equal(s.routing.calls.length, 1);
    assert.equal(s.routing.calls[0].shopId, DEST.shopId);
    assert.equal(s.st().remainingDistance, 1500);
  });
  it('2 permission denied -> friendly error, no GPS call, no route call', async () => {
    const s = setup();
    s.location.permission = 'denied';
    await s.svc.start(DEST);
    assert.equal(s.st().error, 'location_denied');
    assert.equal(s.location.locateCalls, 0);
    assert.equal(s.routing.calls.length, 0);
  });
  it('3 GPS unavailable', async () => {
    const s = setup();
    s.location.once = async () => { throw new NavigationError('location_unavailable'); };
    await s.svc.start(DEST);
    assert.equal(s.st().error, 'location_unavailable');
    s.location.supported = false;
    await s.svc.start(DEST);
    assert.equal(s.st().error, 'browser_unsupported');
  });
  it('4 GPS timeout', async () => {
    const s = setup();
    s.location.once = async () => { throw new NavigationError('location_timeout'); };
    await s.svc.start(DEST);
    assert.equal(s.st().error, 'location_timeout');
  });
  it('5 route success keeps total distance and time', async () => {
    const s = setup();
    await s.svc.start(DEST);
    assert.equal(s.st().routeDistance, 1500);
    assert.equal(s.st().estimatedDuration, 300);
  });
  it('6 route failure -> error, no crash; offline -> network error without calling the API', async () => {
    const s = setup();
    s.routing.next = async () => { throw new NavigationError('provider_unavailable'); };
    await s.svc.start(DEST);
    assert.equal(s.st().error, 'provider_unavailable');
    s.routing.next = async () => { throw new NavigationError('route_failed'); };
    await s.svc.start(DEST);
    assert.equal(s.st().error, 'route_failed');
    const before = s.routing.calls.length;
    s.network.online = false;
    await s.svc.start(DEST);
    assert.equal(s.st().error, 'network_unavailable');
    assert.equal(s.routing.calls.length, before);
  });
  it('double tap on Start sends one routing request', async () => {
    const s = setup();
    await Promise.all([s.svc.start(DEST), s.svc.start(DEST)]);
    assert.equal(s.routing.calls.length, 1);
  });
});

describe('live tracking and progress', () => {
  it('beginNavigation starts one watcher + wake lock + network listener, no routing request', async () => {
    const s = setup();
    await ready(s);
    assert.equal(s.location.watchers.size, 1);
    assert.equal(s.wake.held, 1);
    assert.equal(s.network.listeners, 1);
    assert.equal(s.routing.calls.length, 1);
  });
  it('progress, remaining distance/time, segment, instruction', async () => {
    const s = setup();
    await ready(s);
    s.location.emit(loc(offset(START, 500)));
    const x = s.st();
    assert.ok(Math.abs((x.remainingDistance ?? 0) - 1000) < 15, `remaining ${x.remainingDistance}`);
    assert.ok(Math.abs((x.remainingDuration ?? 0) - 200) < 5);
    assert.ok(Math.abs(x.progressPercent - 33) <= 1);
    assert.equal(x.currentSegment, 4);
    assert.equal(x.instruction?.kind, 'right');
    assert.ok(Math.abs((x.instruction?.distanceMeters ?? 0) - 200) < 10);
    assert.equal(x.offRoute, false);
  });
  it('after the turn the next instruction is arrival', async () => {
    const s = setup();
    await ready(s);
    s.location.emit(loc(offset(START, 900)));
    assert.equal(s.st().instruction?.kind, 'arrive');
  });
  it('GPS jitter (<3 m) and very poor fixes do not move the state', async () => {
    const s = setup();
    await ready(s);
    s.location.emit(loc(offset(START, 500)));
    const a = s.st();
    s.location.emit(loc(offset(START, 501)));
    assert.equal(s.st(), a);
    s.location.emit(loc(offset(START, 900), 400));
    assert.equal(s.st().userLocation, a.userLocation);
    assert.equal(s.st().locationIssue, 'location_unavailable');
    s.location.emit(loc(offset(START, 600)));
    assert.equal(s.st().locationIssue, null);
  });
  it('provider gave no usable steps -> instruction null, progress still works', async () => {
    const s = setup();
    s.routing.next = async () => makeRoute(START, false);
    await ready(s);
    s.location.emit(loc(offset(START, 500)));
    assert.equal(s.st().instruction, null);
    assert.ok((s.st().progressPercent ?? 0) > 30);
  });
  it('unknown provider manoeuvres are never shown', async () => {
    const s = setup();
    const r = makeRoute();
    r.steps = r.steps.map((x, i) => (i === 1 ? { ...x, maneuver: 'teleport', modifier: 'sideways' } : x));
    s.routing.next = async () => r;
    await ready(s);
    s.location.emit(loc(offset(START, 500)));
    assert.equal(s.st().instruction?.kind, 'arrive');
  });
});

describe('8 arrival', () => {
  it('arrives near the shop, stops tracking, shows completed', async () => {
    const s = setup();
    await ready(s);
    s.location.emit(loc(offset(START, 1485)));
    assert.equal(s.st().navigationStatus, 'completed');
    assert.equal(s.st().remainingDistance, 0);
    assert.equal(s.st().progressPercent, 100);
    assert.equal(s.st().instruction?.kind, 'arrive');
    assert.equal(s.location.watchers.size, 0);
    assert.equal(s.wake.held, 0);
    assert.equal(s.network.listeners, 0);
  });
  it('does not arrive 100 m away', async () => {
    const s = setup();
    await ready(s);
    s.location.emit(loc(offset(START, 1400)));
    assert.equal(s.st().navigationStatus, 'navigating');
  });
});

describe('7 off route recalculation', () => {
  it('needs several fixes in a row; one stray fix is ignored', async () => {
    const s = setup();
    await ready(s);
    s.location.emit(loc(offset(START, 400, 300)));
    assert.equal(s.st().offRoute, false);
    s.location.emit(loc(offset(START, 450)));   // back on route resets the count
    s.location.emit(loc(offset(START, 500, 300)));
    s.location.emit(loc(offset(START, 520, 300)));
    assert.equal(s.st().offRoute, false);
    assert.equal(s.routing.calls.length, 1);
  });
  it('recalculates once, swaps in the new route and continues', async () => {
    const s = setup();
    await ready(s);
    const newRoute = makeRoute(offset(START, 400, 300));
    s.routing.next = async () => newRoute;
    for (let i = 0; i < 3; i++) s.location.emit(loc(offset(START, 400 + i * 10, 300)));
    assert.equal(s.st().offRoute, true);
    assert.equal(s.st().rerouting, true);
    assert.equal(s.routing.calls.length, 2);
    await flush();
    assert.equal(s.st().route, newRoute);
    assert.equal(s.st().offRoute, false);
    assert.equal(s.st().rerouting, false);
    assert.equal(s.st().navigationStatus, 'navigating');
    s.location.emit(loc(offset(START, 700, 300)));
    assert.equal(s.st().offRoute, false);
  });
  it('is debounced: many off-route fixes cause one request', async () => {
    const s = setup();
    await ready(s);
    s.routing.next = () => new Promise(() => undefined);   // never answers
    for (let i = 0; i < 30; i++) s.location.emit(loc(offset(START, 400 + i * 5, 300)));
    assert.equal(s.routing.calls.length, 2);
  });
  it('keeps the last valid route when recalculation fails, retries with backoff, then recovers', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const s = setup();
    await ready(s);
    const original = s.st().route;
    s.routing.next = async () => { throw new NavigationError('provider_unavailable'); };
    for (let i = 0; i < 3; i++) s.location.emit(loc(offset(START, 400 + i * 10, 300)));
    await flush();
    assert.equal(s.st().route, original);
    assert.equal(s.st().connectionLost, true);
    assert.equal(s.st().offRoute, true);
    assert.equal(s.st().navigationStatus, 'navigating');
    assert.equal(s.routing.calls.length, 2);

    s.advance(5_000); t.mock.timers.tick(5_000); await flush();   // 1st backoff = 5 s
    assert.equal(s.routing.calls.length, 3);
    s.advance(10_000); t.mock.timers.tick(10_000); await flush();   // 2nd backoff = 10 s
    assert.equal(s.routing.calls.length, 4);

    const fresh = makeRoute(offset(START, 460, 300));
    s.routing.next = async () => fresh;
    s.advance(20_000); t.mock.timers.tick(20_000); await flush();
    assert.equal(s.st().route, fresh);
    assert.equal(s.st().connectionLost, false);
    assert.equal(s.st().offRoute, false);
  });
  it('returning to the route cancels a pending recalculation', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const s = setup();
    await ready(s);
    s.routing.next = async () => { throw new NavigationError('provider_unavailable'); };
    for (let i = 0; i < 3; i++) s.location.emit(loc(offset(START, 400 + i * 10, 300)));
    await flush();
    s.location.emit(loc(offset(START, 600)));
    assert.equal(s.st().offRoute, false);
    s.advance(60_000); t.mock.timers.tick(60_000); await flush();
    assert.equal(s.routing.calls.length, 2);
  });
});

describe('14 network interruption', () => {
  it('offline during navigation: banner flag, progress continues locally, no API call', async () => {
    const s = setup();
    await ready(s);
    s.network.set(false);
    assert.equal(s.st().connectionLost, true);
    s.location.emit(loc(offset(START, 500)));
    assert.ok((s.st().progressPercent ?? 0) > 30);
    assert.equal(s.routing.calls.length, 1);
    s.network.set(true);
    assert.equal(s.st().connectionLost, false);
  });
  it('off route while offline: waits, then recalculates when the connection returns', async () => {
    const s = setup();
    await ready(s);
    s.network.set(false);
    s.advance(15_000);
    for (let i = 0; i < 3; i++) s.location.emit(loc(offset(START, 400 + i * 10, 300)));
    assert.equal(s.routing.calls.length, 1);
    assert.equal(s.st().offRoute, true);
    assert.equal(s.st().connectionLost, true);
    assert.equal(s.st().navigationStatus, 'navigating');
    s.advance(15_000);
    s.network.set(true);
    await flush();
    assert.equal(s.routing.calls.length, 2);
    assert.equal(s.st().offRoute, false);
  });
});

describe('location errors while navigating', () => {
  it('timeout / lost signal: temporary notice, tracking continues, clears by itself', async () => {
    const s = setup();
    await ready(s);
    s.location.emitError('location_timeout');
    assert.equal(s.st().locationIssue, 'location_timeout');
    assert.equal(s.st().navigationStatus, 'navigating');
    assert.equal(s.location.watchers.size, 1);
    s.location.emit(loc(offset(START, 300)));
    assert.equal(s.st().locationIssue, null);
  });
  it('permission revoked mid-way: error screen and tracking stops', async () => {
    const s = setup();
    await ready(s);
    s.location.emitError('location_denied');
    assert.equal(s.st().navigationStatus, 'error');
    assert.equal(s.st().error, 'location_denied');
    assert.equal(s.location.watchers.size, 0);
  });
});

describe('10-12 cancel, unmount', () => {
  it('11 end navigation: back to route preview, watcher and wake lock released, late fixes ignored', async () => {
    const s = setup();
    await ready(s);
    const route = s.st().route;
    s.svc.endNavigation();
    assert.equal(s.st().navigationStatus, 'route_ready');
    assert.equal(s.st().route, route);
    assert.equal(s.location.watchers.size, 0);
    assert.equal(s.wake.held, 0);
    assert.equal(s.network.listeners, 0);
    s.location.emit(loc(offset(START, 500)));
    assert.equal(s.st().progressPercent, 0);
  });
  it('12 unmount (stop): everything cleaned, in-flight route request aborted, timers cleared', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const s = setup();
    await ready(s);
    s.routing.next = () => new Promise(() => undefined);
    for (let i = 0; i < 3; i++) s.location.emit(loc(offset(START, 400 + i * 10, 300)));
    const signal = s.routing.calls[1].signal!;
    assert.equal(signal.aborted, false);
    s.svc.stop();
    assert.equal(signal.aborted, true);
    assert.equal(s.location.watchers.size, 0);
    assert.equal(s.wake.held, 0);
    assert.equal(s.network.listeners, 0);
    assert.equal(s.st().navigationStatus, 'idle');
    s.svc.stop();   // twice is fine
    s.advance(120_000); t.mock.timers.tick(120_000); await flush();
    assert.equal(s.routing.calls.length, 2);
  });
  it('stop during route calculation aborts the request', async () => {
    const s = setup();
    s.routing.next = () => new Promise(() => undefined);
    const p = s.svc.start(DEST);
    await flush();
    const signal = s.routing.calls[0].signal!;
    s.svc.stop();
    assert.equal(signal.aborted, true);
    await p;
    assert.equal(s.st().navigationStatus, 'idle');
  });
  it('arrival then unmount is safe', async () => {
    const s = setup();
    await ready(s);
    s.location.emit(loc(offset(START, 1490)));
    s.svc.stop();
    assert.equal(s.location.watchers.size, 0);
  });
});
