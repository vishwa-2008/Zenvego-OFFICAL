export interface Coords {
  lat: number;
  lng: number;
}

export const GPS_ACCURACY_THRESHOLDS = {
  GOOD_M: 35,
  ACCEPTABLE_M: 100,
  MAX_TRACKING_M: 150,
} as const;

export const LOCATION_FRESHNESS_MS = {
  STALE_MS: 45_000,
  OFFLINE_MS: 120_000,
} as const;

export const ROUTE_REFRESH_POLICY = {
  MIN_MOVE_METERS: 100,
  MIN_INTERVAL_MS: 20_000,
  MAX_BACKOFF_MS: 60_000,
} as const;

export function isValidCoord(lat: unknown, lng: unknown, allowNullIsland = false): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if (!allowNullIsland && Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return false;
  return true;
}

export function isValidCoords(coords: unknown, allowNullIsland = false): coords is Coords {
  if (!coords || typeof coords !== 'object') return false;
  const candidate = coords as { lat?: unknown; lng?: unknown };
  return isValidCoord(candidate.lat, candidate.lng, allowNullIsland);
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function haversineMeters(a: Coords, b: Coords): number {
  return haversineKm(a.lat, a.lng, b.lat, b.lng) * 1000;
}

/**
 * Computes initial compass bearing in degrees [0, 360) from `from` to `to`.
 * Returns null if the movement delta is too small (< minMeters) to infer a stable heading.
 */
export function computeBearingDeg(from: Coords, to: Coords, minMeters = 3): number | null {
  if (!isValidCoords(from) || !isValidCoords(to)) return null;
  if (haversineMeters(from, to) < minMeters) return null;

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLng = toRad(to.lng - from.lng);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function interpolateCoords(from: Coords, to: Coords, t: number): Coords {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    lat: from.lat + (to.lat - from.lat) * clamped,
    lng: from.lng + (to.lng - from.lng) * clamped,
  };
}

export function interpolateAngleDeg(fromDeg: number, toDeg: number, t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  const delta = ((((toDeg - fromDeg) % 360) + 540) % 360) - 180;
  return (fromDeg + delta * clamped + 360) % 360;
}

export type GpsAccuracyLevel = 'high' | 'moderate' | 'low' | 'unknown';

export function classifyGpsAccuracy(accuracyMeters: number | null | undefined): {
  level: GpsAccuracyLevel;
  acceptableForTracking: boolean;
  label: string;
} {
  if (typeof accuracyMeters !== 'number' || !Number.isFinite(accuracyMeters) || accuracyMeters <= 0) {
    return { level: 'unknown', acceptableForTracking: false, label: 'Accuracy unavailable' };
  }
  const rounded = Math.round(accuracyMeters);
  if (accuracyMeters <= GPS_ACCURACY_THRESHOLDS.GOOD_M) {
    return { level: 'high', acceptableForTracking: true, label: `High GPS accuracy (±${rounded}m)` };
  }
  if (accuracyMeters <= GPS_ACCURACY_THRESHOLDS.ACCEPTABLE_M) {
    return { level: 'moderate', acceptableForTracking: true, label: `Moderate GPS accuracy (±${rounded}m)` };
  }
  if (accuracyMeters <= GPS_ACCURACY_THRESHOLDS.MAX_TRACKING_M) {
    return { level: 'low', acceptableForTracking: true, label: `Low GPS accuracy (±${rounded}m)` };
  }
  return {
    level: 'low',
    acceptableForTracking: false,
    label: `Inaccurate GPS (±${rounded}m) — move to open sky`,
  };
}

export function normalizeTimestampMs(ts: unknown): number | null {
  if (ts == null) return null;
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  if (ts instanceof Date && Number.isFinite(ts.getTime())) return ts.getTime();
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof ts === 'object') {
    const record = ts as { toMillis?: () => number; seconds?: number; _seconds?: number };
    if (typeof record.toMillis === 'function') {
      const ms = record.toMillis();
      return Number.isFinite(ms) ? ms : null;
    }
    const sec = typeof record.seconds === 'number' ? record.seconds : record._seconds;
    if (typeof sec === 'number' && Number.isFinite(sec)) {
      return sec * 1000;
    }
  }
  return null;
}

export type LocationFreshnessStatus = 'live' | 'stale' | 'offline' | 'unknown';

export function getLocationFreshness(
  lastLocationAt: unknown,
  nowMs: number = Date.now(),
): {
  status: LocationFreshnessStatus;
  ageSec: number | null;
  label: string;
} {
  const tsMs = normalizeTimestampMs(lastLocationAt);
  if (tsMs === null) {
    return { status: 'unknown', ageSec: null, label: 'Awaiting GPS signal' };
  }
  const ageMs = Math.max(0, nowMs - tsMs);
  const ageSec = Math.round(ageMs / 1000);
  if (ageMs <= LOCATION_FRESHNESS_MS.STALE_MS) {
    const text = ageSec < 5 ? 'Updated just now' : `Updated ${ageSec}s ago`;
    return { status: 'live', ageSec, label: text };
  }
  if (ageMs <= LOCATION_FRESHNESS_MS.OFFLINE_MS) {
    return { status: 'stale', ageSec, label: `Signal delayed (${ageSec}s ago)` };
  }
  const mins = Math.max(2, Math.round(ageSec / 60));
  return { status: 'offline', ageSec, label: `Location paused (${mins}m ago)` };
}

/**
 * Decides whether a new route API request should be triggered based on movement distance,
 * elapsed time, or stage/destination change. Prevents unbounded route polling on every GPS tick.
 */
export function shouldRefreshRoute(params: {
  lastOrigin: Coords | null;
  nextOrigin: Coords;
  lastDest: Coords | null;
  nextDest: Coords;
  lastFetchedAtMs: number;
  nowMs?: number;
  minMoveMeters?: number;
  minIntervalMs?: number;
}): boolean {
  const {
    lastOrigin,
    nextOrigin,
    lastDest,
    nextDest,
    lastFetchedAtMs,
    nowMs = Date.now(),
    minMoveMeters = ROUTE_REFRESH_POLICY.MIN_MOVE_METERS,
    minIntervalMs = ROUTE_REFRESH_POLICY.MIN_INTERVAL_MS,
  } = params;

  if (!lastOrigin || !lastDest || lastFetchedAtMs <= 0) return true;
  if (haversineMeters(lastDest, nextDest) >= 25) return true;

  const movedMeters = haversineMeters(lastOrigin, nextOrigin);
  const elapsedMs = nowMs - lastFetchedAtMs;

  if (movedMeters >= minMoveMeters && elapsedMs >= 6_000) return true;
  if (movedMeters >= 30 && elapsedMs >= minIntervalMs) return true;
  return false;
}
