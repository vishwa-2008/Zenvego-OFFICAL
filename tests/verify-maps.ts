import assert from 'node:assert/strict';
import {
  classifyGpsAccuracy,
  computeBearingDeg,
  getLocationFreshness,
  haversineKm,
  haversineMeters,
  interpolateAngleDeg,
  interpolateCoords,
  isValidCoord,
  isValidCoords,
  shouldRefreshRoute,
} from '../src/lib/geo.ts';
import {
  evaluateAccuracyWarning,
  normalizeGeolocationPosition,
  shouldAcceptLiveFix,
} from '../src/hooks/useLiveLocation.ts';

function runMapUnitTests() {
  let passed = 0;
  function test(name: string, fn: () => void) {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  }

  test('isValidCoord validates numeric ranges and rejects null island / NaN', () => {
    assert.equal(isValidCoord(12.9784, 77.6408), true);
    assert.equal(isValidCoord(-33.8688, 151.2093), true);
    assert.equal(isValidCoord(0, 0), false);
    assert.equal(isValidCoord(0, 0, true), true);
    assert.equal(isValidCoord(91, 77.6), false);
    assert.equal(isValidCoord(12.9, 181), false);
    assert.equal(isValidCoord(NaN, 77.6), false);
    assert.equal(isValidCoords({ lat: 12.97, lng: 77.59 }), true);
    assert.equal(isValidCoords(null), false);
  });

  test('haversineKm computes accurate Bengaluru Indiranagar-Koramangala distance', () => {
    const km = haversineKm(12.9784, 77.6408, 12.9352, 77.6245);
    assert.ok(km > 4.8 && km < 5.4, `Expected ~5.1km, got ${km}`);
    assert.ok(haversineMeters({ lat: 12.9784, lng: 77.6408 }, { lat: 12.9784, lng: 77.6408 }) === 0);
  });

  test('computeBearingDeg computes cardinal bearings and ignores tiny jitter', () => {
    const north = computeBearingDeg({ lat: 12.97, lng: 77.6 }, { lat: 12.98, lng: 77.6 });
    assert.ok(north !== null && (north < 1 || north > 359), `Expected ~0 deg, got ${north}`);

    const east = computeBearingDeg({ lat: 12.97, lng: 77.6 }, { lat: 12.97, lng: 77.61 });
    assert.ok(east !== null && Math.abs(east - 90) < 1.5, `Expected ~90 deg, got ${east}`);

    const jitter = computeBearingDeg({ lat: 12.97, lng: 77.6 }, { lat: 12.970001, lng: 77.6 });
    assert.equal(jitter, null);
  });

  test('interpolateCoords and interpolateAngleDeg interpolate cleanly across 360/0 wrap', () => {
    const mid = interpolateCoords({ lat: 12.0, lng: 77.0 }, { lat: 13.0, lng: 78.0 }, 0.5);
    assert.equal(mid.lat, 12.5);
    assert.equal(mid.lng, 77.5);

    const wrapped = interpolateAngleDeg(350, 10, 0.5);
    assert.ok(wrapped < 0.01 || wrapped > 359.99, `Expected 0 deg wrap midpoint, got ${wrapped}`);
  });

  test('classifyGpsAccuracy enforces tracking threshold (>150m rejected)', () => {
    assert.equal(classifyGpsAccuracy(12).level, 'high');
    assert.equal(classifyGpsAccuracy(12).acceptableForTracking, true);
    assert.equal(classifyGpsAccuracy(75).level, 'moderate');
    assert.equal(classifyGpsAccuracy(140).acceptableForTracking, true);
    assert.equal(classifyGpsAccuracy(250).acceptableForTracking, false);
    assert.equal(classifyGpsAccuracy(null).level, 'unknown');
  });

  test('getLocationFreshness distinguishes live, stale, offline, and unknown timestamps', () => {
    const now = 1_700_000_000_000;
    assert.equal(getLocationFreshness(now - 10_000, now).status, 'live');
    assert.equal(getLocationFreshness(now - 60_000, now).status, 'stale');
    assert.equal(getLocationFreshness(now - 180_000, now).status, 'offline');
    assert.equal(getLocationFreshness(null, now).status, 'unknown');
  });

  test('shouldRefreshRoute throttles jitter and triggers on movement or destination switch', () => {
    const origin = { lat: 12.9784, lng: 77.6408 };
    const dest = { lat: 12.9352, lng: 77.6245 };
    const t0 = 1_700_000_000_000;

    // Initial request -> true
    assert.equal(
      shouldRefreshRoute({
        lastOrigin: null,
        nextOrigin: origin,
        lastDest: null,
        nextDest: dest,
        lastFetchedAtMs: 0,
        nowMs: t0,
      }),
      true
    );

    // Small 10m GPS jitter after 8s -> false
    assert.equal(
      shouldRefreshRoute({
        lastOrigin: origin,
        nextOrigin: { lat: 12.97848, lng: 77.6408 },
        lastDest: dest,
        nextDest: dest,
        lastFetchedAtMs: t0,
        nowMs: t0 + 8_000,
      }),
      false
    );

    // Significant >150m movement after 8s -> true
    assert.equal(
      shouldRefreshRoute({
        lastOrigin: origin,
        nextOrigin: { lat: 12.9802, lng: 77.6408 },
        lastDest: dest,
        nextDest: dest,
        lastFetchedAtMs: t0,
        nowMs: t0 + 8_000,
      }),
      true
    );

    // Destination stage switched (pickup -> dropoff) -> true immediately
    assert.equal(
      shouldRefreshRoute({
        lastOrigin: origin,
        nextOrigin: origin,
        lastDest: { lat: 12.9716, lng: 77.5946 },
        nextDest: dest,
        lastFetchedAtMs: t0,
        nowMs: t0 + 1_000,
      }),
      true
    );
  });

  test('normalizeGeolocationPosition captures lat/lng/accuracy/heading/speed and derives heading fallback', () => {
    const nativeFix = normalizeGeolocationPosition({
      coords: {
        latitude: 12.9784,
        longitude: 77.6408,
        accuracy: 14.5,
        heading: 125.4,
        speed: 6.2,
      },
      timestamp: 1_700_000_000_000,
    });
    assert.ok(nativeFix);
    assert.equal(nativeFix.latitude, 12.9784);
    assert.equal(nativeFix.longitude, 77.6408);
    assert.equal(nativeFix.accuracy, 14.5);
    assert.equal(nativeFix.heading, 125.4);
    assert.equal(nativeFix.speed, 6.2);

    // Derive east (~90 deg) heading from previous coordinates when native heading is null
    const derivedFix = normalizeGeolocationPosition(
      {
        coords: {
          latitude: 12.9784,
          longitude: 77.6428,
          accuracy: 20,
          heading: null,
          speed: null,
        },
        timestamp: 1_700_000_005_000,
      },
      { lat: 12.9784, lng: 77.6408 }
    );
    assert.ok(derivedFix && derivedFix.heading !== null);
    assert.ok(Math.abs(derivedFix.heading - 90) < 1.5, `Expected ~90 deg derived heading, got ${derivedFix.heading}`);

    // Reject invalid / null-island coordinates
    const invalid = normalizeGeolocationPosition({
      coords: { latitude: 0, longitude: 0, accuracy: 10, heading: null, speed: null },
    });
    assert.equal(invalid, null);
  });

  test('evaluateAccuracyWarning accepts <=20m by default and discards fixes exceeding threshold', () => {
    const high = evaluateAccuracyWarning(12);
    assert.equal(high.level, 'high');
    assert.equal(high.warning, null);
    assert.equal(high.rejectedAsTooCoarse, false);

    const exactBoundary = evaluateAccuracyWarning(20);
    assert.equal(exactBoundary.rejectedAsTooCoarse, false);

    const exceedsDefault = evaluateAccuracyWarning(25);
    assert.equal(exceedsDefault.rejectedAsTooCoarse, true);
    assert.ok(exceedsDefault.warning && exceedsDefault.warning.includes('exceeds 20m accuracy threshold'));

    const ipEstimate = evaluateAccuracyWarning(100_000);
    assert.equal(ipEstimate.rejectedAsTooCoarse, true);
    assert.ok(ipEstimate.warning && ipEstimate.warning.includes('±100 km'));

    // Explicit widened threshold still classifies low/approximate properly
    const lowCustom = evaluateAccuracyWarning(120, 500);
    assert.equal(lowCustom.level, 'low');
    assert.equal(lowCustom.rejectedAsTooCoarse, false);
    assert.ok(lowCustom.warning && lowCustom.warning.includes('±120m'));

    const wifiApproxCustom = evaluateAccuracyWarning(350, 500);
    assert.equal(wifiApproxCustom.rejectedAsTooCoarse, false);
    assert.ok(wifiApproxCustom.warning && wifiApproxCustom.warning.includes('Approximate Wi-Fi/Cell GPS'));
  });

  test('shouldAcceptLiveFix enforces 20m radius, rejects missing accuracy, bounces, and teleport spikes', () => {
    const t0 = 1_700_000_000_000;
    const goodFix = normalizeGeolocationPosition({
      coords: { latitude: 12.9784, longitude: 77.6408, accuracy: 18, heading: 90, speed: 5 },
      timestamp: t0,
    })!;
    assert.equal(shouldAcceptLiveFix(goodFix, null).accepted, true);

    // Fix exceeding 20m default radius (e.g. 24m) must be discarded
    const slightlyCoarse = normalizeGeolocationPosition({
      coords: { latitude: 12.9785, longitude: 77.6409, accuracy: 24, heading: 90, speed: 5 },
      timestamp: t0 + 2_000,
    })!;
    const coarseResult = shouldAcceptLiveFix(slightlyCoarse, goodFix);
    assert.equal(coarseResult.accepted, false);
    assert.equal(coarseResult.reason, 'TOO_COARSE');

    // Missing/zero accuracy must be discarded
    const noAccuracy = normalizeGeolocationPosition({
      coords: { latitude: 12.9785, longitude: 77.6409, accuracy: 0, heading: null, speed: null },
      timestamp: t0 + 2_000,
    })!;
    const missingAccResult = shouldAcceptLiveFix(noAccuracy, goodFix);
    assert.equal(missingAccResult.accepted, false);
    assert.equal(missingAccResult.reason, 'MISSING_ACCURACY');

    // 100 km desktop IP estimate must be strictly rejected
    const bogusIpFix = normalizeGeolocationPosition({
      coords: { latitude: 17.366, longitude: 78.427, accuracy: 100_000, heading: null, speed: null },
      timestamp: t0 + 2_000,
    })!;
    const ipResult = shouldAcceptLiveFix(bogusIpFix, null);
    assert.equal(ipResult.accepted, false);
    assert.equal(ipResult.reason, 'TOO_COARSE');

    // Noisy cell-tower bounce under a custom widened threshold must still be rejected
    const noisyBounce = normalizeGeolocationPosition({
      coords: { latitude: 12.979, longitude: 77.6415, accuracy: 320, heading: null, speed: null },
      timestamp: t0 + 5_000,
    })!;
    const bounceResult = shouldAcceptLiveFix(noisyBounce, goodFix, 500);
    assert.equal(bounceResult.accepted, false);
    assert.equal(bounceResult.reason, 'ACCURACY_DEGRADED');

    // Impossible 2 km teleport in 3s even with 15m reported accuracy must be rejected
    const teleportSpike = normalizeGeolocationPosition({
      coords: { latitude: 12.9964, longitude: 77.6408, accuracy: 15, heading: null, speed: null },
      timestamp: t0 + 3_000,
    })!;
    const spikeResult = shouldAcceptLiveFix(teleportSpike, goodFix);
    assert.equal(spikeResult.accepted, false);
    assert.equal(spikeResult.reason, 'TELEPORT_SPIKE');

    // Normal EV scooter movement (~25m in 3s, 20m exact-boundary accuracy) must be accepted
    const normalMove = normalizeGeolocationPosition({
      coords: { latitude: 12.97862, longitude: 77.6408, accuracy: 20, heading: 0, speed: 8 },
      timestamp: t0 + 3_000,
    })!;
    assert.equal(shouldAcceptLiveFix(normalMove, goodFix).accepted, true);
  });

  console.log(`\nMap unit tests summary: ${passed}/${passed} passed.`);
}

runMapUnitTests();
