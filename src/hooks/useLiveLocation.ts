import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  classifyGpsAccuracy,
  computeBearingDeg,
  haversineMeters,
  isValidCoords,
  type Coords,
  type GpsAccuracyLevel,
} from '../lib/geo.ts';

export type GeolocationPermissionState = 'prompt' | 'granted' | 'denied' | 'unsupported';

export type LiveLocationErrorCode =
  | 'PERMISSION_DENIED'
  | 'POSITION_UNAVAILABLE'
  | 'TIMEOUT'
  | 'INACCURATE_FIX'
  | 'UNSUPPORTED'
  | null;

export interface LiveLocationFix {
  lat: number;
  lng: number;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  timestampMs: number;
  isoTimestamp: string;
}

export interface UseLiveLocationOptions {
  enableHighAccuracy?: boolean;
  timeoutMs?: number;
  /** Maximum cached fix age in ms. Default: 0 (always request fresh GPS). */
  maximumAgeMs?: number;
  /**
   * Minimum required GPS accuracy radius in meters (alias: `maxAcceptedAccuracyM`).
   * Incoming GPS fixes with `accuracy > threshold` (or missing accuracy) are discarded
   * to prevent noisy coordinates in live delivery tracking.
   * Default: 20 meters.
   */
  minAccuracyThresholdM?: number;
  /** Alias for `minAccuracyThresholdM`. Default: 20 meters. */
  maxAcceptedAccuracyM?: number;
  /** Automatically start watchPosition on mount unless permission is denied. Default: false. */
  autoStart?: boolean;
  /** Invoked on every validated, accepted fix (initial fix and continuous watchPosition updates). */
  onFix?: (fix: LiveLocationFix, meta: { immediate: boolean }) => void;
  /** Invoked whenever the browser denies location permission. */
  onPermissionDenied?: (message: string) => void;
}

export interface UseLiveLocationResult {
  // Primary delivery-portal state contract
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  heading: number | null;
  error: string | null;
  permissionStatus: GeolocationPermissionState;

  // Extended telemetry & helpers
  location: LiveLocationFix | null;
  coords: Coords | null;
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  permissionState: GeolocationPermissionState;
  isPermissionDenied: boolean;
  isSupported: boolean;
  isWatching: boolean;
  isLocating: boolean;
  accuracyLevel: GpsAccuracyLevel;
  accuracyLabel: string | null;
  accuracyWarning: string | null;
  accuracyThresholdM: number;
  rejectedAccuracyM: number | null;
  discardedFixCount: number;
  errorCode: LiveLocationErrorCode;
  startWatching: () => void;
  stopWatching: () => void;
  requestSingleFix: (opts?: { silentOnError?: boolean }) => void;
  clearError: () => void;
}

export const DEFAULT_MIN_ACCURACY_THRESHOLD_M = 20;
export const DEFAULT_MAX_ACCEPTED_ACCURACY_M = DEFAULT_MIN_ACCURACY_THRESHOLD_M;
const MAX_PLAUSIBLE_SPEED_MPS = 55; // ~198 km/h upper bound to drop wild GPS/cell-tower jumps

export const PERMISSION_DENIED_MESSAGE =
  'Location permission is blocked by your browser. Click the lock / site-settings icon in your address bar, allow Location access, and retry.';

export function formatAccuracyMeters(accuracyMeters: number): string {
  const rounded = Math.round(accuracyMeters);
  if (rounded >= 1_000) {
    const km = rounded >= 10_000 ? Math.round(rounded / 1_000).toString() : (rounded / 1_000).toFixed(1);
    return `±${km} km`;
  }
  return `±${rounded}m`;
}

/**
 * Pure helper to normalize a browser GeolocationPosition into a validated LiveLocationFix,
 * deriving compass heading from consecutive movement when native sensor heading is absent.
 */
export function normalizeGeolocationPosition(
  pos: {
    coords: {
      latitude: number;
      longitude: number;
      accuracy: number;
      heading: number | null;
      speed: number | null;
    };
    timestamp?: number;
  },
  previousCoords?: Coords | null
): LiveLocationFix | null {
  const latitude = pos.coords.latitude;
  const longitude = pos.coords.longitude;
  if (!isValidCoords({ lat: latitude, lng: longitude })) {
    return null;
  }

  const accuracy =
    typeof pos.coords.accuracy === 'number' && Number.isFinite(pos.coords.accuracy) && pos.coords.accuracy > 0
      ? pos.coords.accuracy
      : null;

  const nativeHeading =
    typeof pos.coords.heading === 'number' &&
    Number.isFinite(pos.coords.heading) &&
    pos.coords.heading >= 0 &&
    pos.coords.heading <= 360
      ? pos.coords.heading % 360
      : null;

  const derivedHeading =
    nativeHeading === null && previousCoords
      ? computeBearingDeg(previousCoords, { lat: latitude, lng: longitude }, 3)
      : null;

  const heading = nativeHeading ?? derivedHeading;

  const speed =
    typeof pos.coords.speed === 'number' && Number.isFinite(pos.coords.speed) && pos.coords.speed >= 0
      ? pos.coords.speed
      : null;

  const timestampMs =
    typeof pos.timestamp === 'number' && Number.isFinite(pos.timestamp) && pos.timestamp > 0
      ? pos.timestamp
      : Date.now();

  return {
    lat: latitude,
    lng: longitude,
    latitude,
    longitude,
    accuracy,
    heading,
    speed,
    timestampMs,
    isoTimestamp: new Date(timestampMs).toISOString(),
  };
}

/**
 * Evaluates GPS accuracy into structured level, label, warning text, and coarse-rejection flag.
 */
export function evaluateAccuracyWarning(
  accuracyMeters: number | null | undefined,
  maxAcceptedAccuracyM: number = DEFAULT_MAX_ACCEPTED_ACCURACY_M
): {
  level: GpsAccuracyLevel;
  label: string | null;
  warning: string | null;
  rejectedAsTooCoarse: boolean;
} {
  if (typeof accuracyMeters !== 'number' || !Number.isFinite(accuracyMeters) || accuracyMeters <= 0) {
    return {
      level: 'unknown',
      label: null,
      warning: null,
      rejectedAsTooCoarse: false,
    };
  }

  const formatted = formatAccuracyMeters(accuracyMeters);
  const info = classifyGpsAccuracy(accuracyMeters);

  if (accuracyMeters > maxAcceptedAccuracyM) {
    const isIpLevel = accuracyMeters >= 1_000;
    return {
      level: 'low',
      label: isIpLevel ? `Rough IP Estimate (${formatted})` : `Low Precision (${formatted})`,
      warning: isIpLevel
        ? `Discarded rough network/IP estimate (${formatted} > ${maxAcceptedAccuracyM}m threshold) to prevent a wrong location. Search your street on desktop, or enable Precise GPS outdoors on mobile.`
        : `Discarded GPS fix (${formatted} exceeds ${maxAcceptedAccuracyM}m accuracy threshold). Waiting for a sharper ≤${maxAcceptedAccuracyM}m GPS lock.`,
      rejectedAsTooCoarse: true,
    };
  }

  if (!info.acceptableForTracking) {
    return {
      level: info.level,
      label: `Approx GPS (${formatted})`,
      warning: `Approximate Wi-Fi/Cell GPS (${formatted}). Fine-tune your pin manually or move outdoors for sharper lock.`,
      rejectedAsTooCoarse: false,
    };
  }

  if (info.level === 'low') {
    return {
      level: info.level,
      label: info.label,
      warning: `Moderate-low GPS precision (${formatted}). Accuracy will sharpen outdoors.`,
      rejectedAsTooCoarse: false,
    };
  }

  return {
    level: info.level,
    label: info.label,
    warning: null,
    rejectedAsTooCoarse: false,
  };
}

/**
 * Strict accuracy & anti-teleportation filter for incoming watchPosition / getCurrentPosition readings.
 * Discards fixes with missing accuracy, accuracy > threshold (default 20m), coarse bounces, or teleport spikes.
 */
export function shouldAcceptLiveFix(
  nextFix: LiveLocationFix,
  previousFix: LiveLocationFix | null,
  maxAcceptedAccuracyM: number = DEFAULT_MAX_ACCEPTED_ACCURACY_M
): {
  accepted: boolean;
  reason?: 'MISSING_ACCURACY' | 'TOO_COARSE' | 'ACCURACY_DEGRADED' | 'TELEPORT_SPIKE';
  warning?: string;
} {
  if (nextFix.accuracy === null || !Number.isFinite(nextFix.accuracy) || nextFix.accuracy <= 0) {
    return {
      accepted: false,
      reason: 'MISSING_ACCURACY',
      warning: `Discarded GPS fix without accuracy telemetry (requires ≤${maxAcceptedAccuracyM}m).`,
    };
  }

  const accEval = evaluateAccuracyWarning(nextFix.accuracy, maxAcceptedAccuracyM);
  if (accEval.rejectedAsTooCoarse) {
    return {
      accepted: false,
      reason: 'TOO_COARSE',
      warning: accEval.warning ?? undefined,
    };
  }

  if (!previousFix) {
    return { accepted: true };
  }

  const dtMs = Math.max(0, nextFix.timestampMs - previousFix.timestampMs);

  // Guard 1: Do not overwrite a recent accurate fix with a much coarser bounce (relevant when caller widens threshold)
  if (
    dtMs < 45_000 &&
    previousFix.accuracy !== null &&
    previousFix.accuracy <= 100 &&
    nextFix.accuracy > 150 &&
    nextFix.accuracy > previousFix.accuracy * 2.5
  ) {
    return {
      accepted: false,
      reason: 'ACCURACY_DEGRADED',
      warning: `Ignored noisy GPS bounce (${formatAccuracyMeters(nextFix.accuracy)}) to keep your sharper ${formatAccuracyMeters(previousFix.accuracy)} lock.`,
    };
  }

  // Guard 2: Reject impossible teleportation jumps (> ~200 km/h within 15s)
  if (dtMs > 0 && dtMs < 15_000) {
    const distMeters = haversineMeters(
      { lat: previousFix.lat, lng: previousFix.lng },
      { lat: nextFix.lat, lng: nextFix.lng }
    );
    const impliedSpeedMps = distMeters / (dtMs / 1_000);
    if (impliedSpeedMps > MAX_PLAUSIBLE_SPEED_MPS) {
      return {
        accepted: false,
        reason: 'TELEPORT_SPIKE',
        warning: `Ignored sudden GPS jump (${Math.round(distMeters)}m spike) — keeping your verified location.`,
      };
    }
  }

  return { accepted: true };
}

/**
 * Custom React hook wrapping the browser Geolocation `watchPosition` API with strict
 * accuracy validation, anti-jump filtering, permission state tracking (`granted`, `denied`, `prompt`),
 * and structured error/warning reporting for both delivery partners and address pickers.
 */
export function useLiveLocation(options: UseLiveLocationOptions = {}): UseLiveLocationResult {
  const {
    enableHighAccuracy = true,
    timeoutMs = 12_000,
    maximumAgeMs = 0,
    minAccuracyThresholdM,
    maxAcceptedAccuracyM,
    autoStart = false,
    onFix,
    onPermissionDenied,
  } = options;

  const accuracyThresholdM =
    typeof minAccuracyThresholdM === 'number' && Number.isFinite(minAccuracyThresholdM) && minAccuracyThresholdM > 0
      ? minAccuracyThresholdM
      : typeof maxAcceptedAccuracyM === 'number' && Number.isFinite(maxAcceptedAccuracyM) && maxAcceptedAccuracyM > 0
        ? maxAcceptedAccuracyM
        : DEFAULT_MIN_ACCURACY_THRESHOLD_M;

  const isSupported = typeof navigator !== 'undefined' && Boolean(navigator.geolocation);

  const [location, setLocation] = useState<LiveLocationFix | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<GeolocationPermissionState>(() =>
    isSupported ? 'prompt' : 'unsupported'
  );
  const [isWatching, setIsWatching] = useState<boolean>(false);
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<LiveLocationErrorCode>(null);
  const [rejectedWarning, setRejectedWarning] = useState<string | null>(null);
  const [rejectedAccuracyM, setRejectedAccuracyM] = useState<number | null>(null);
  const [discardedFixCount, setDiscardedFixCount] = useState<number>(0);

  const watchIdRef = useRef<number | null>(null);
  const lastAcceptedFixRef = useRef<LiveLocationFix | null>(null);
  const onFixRef = useRef(onFix);
  onFixRef.current = onFix;
  const onPermissionDeniedRef = useRef(onPermissionDenied);
  onPermissionDeniedRef.current = onPermissionDenied;

  const stopWatching = useCallback(() => {
    if (watchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsWatching(false);
    setIsLocating(false);
  }, []);

  const handlePosition = useCallback(
    (pos: GeolocationPosition, immediate: boolean, silentOnError = false) => {
      const prevFix = lastAcceptedFixRef.current;
      const normalized = normalizeGeolocationPosition(
        pos,
        prevFix ? { lat: prevFix.lat, lng: prevFix.lng } : null
      );
      setIsLocating(false);
      setPermissionStatus('granted');

      if (!normalized) {
        return;
      }

      const gate = shouldAcceptLiveFix(normalized, prevFix, accuracyThresholdM);
      if (!gate.accepted) {
        const msg = gate.warning || `Discarded inaccurate GPS sample (requires ≤${accuracyThresholdM}m).`;
        setRejectedAccuracyM(normalized.accuracy);
        setDiscardedFixCount((count) => count + 1);
        if (!silentOnError) {
          setRejectedWarning(msg);
          // Surface an explicit error when no valid fix has been locked yet so UI explains why fix was discarded
          if (!prevFix && (gate.reason === 'TOO_COARSE' || gate.reason === 'MISSING_ACCURACY')) {
            setErrorCode('INACCURATE_FIX');
            setError(msg);
          }
        }
        return;
      }

      setRejectedWarning(null);
      setRejectedAccuracyM(null);
      setError(null);
      setErrorCode(null);
      lastAcceptedFixRef.current = normalized;
      setLocation(normalized);
      onFixRef.current?.(normalized, { immediate });
    },
    [accuracyThresholdM]
  );

  const handleGeoError = useCallback(
    (err: GeolocationPositionError, opts?: { silentOnError?: boolean; stopWatchOnDeny?: boolean }) => {
      setIsLocating(false);
      if (err.code === err.PERMISSION_DENIED) {
        setPermissionStatus('denied');
        setErrorCode('PERMISSION_DENIED');
        setError(PERMISSION_DENIED_MESSAGE);
        if (opts?.stopWatchOnDeny) {
          stopWatching();
        }
        onPermissionDeniedRef.current?.(PERMISSION_DENIED_MESSAGE);
        return;
      }

      if (opts?.silentOnError) return;

      if (err.code === err.TIMEOUT) {
        setErrorCode('TIMEOUT');
        setError('GPS fix timed out — keep this tab open near a window, or search your street manually.');
      } else {
        setErrorCode('POSITION_UNAVAILABLE');
        setError('Live GPS signal is temporarily unavailable. Check device location services and retry.');
      }
    },
    [stopWatching]
  );

  const requestReliableFix = useCallback(
    (silentOnError = false, stopWatchOnDeny = false) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        setPermissionStatus('unsupported');
        setErrorCode('UNSUPPORTED');
        if (!silentOnError) {
          setError('Geolocation is not supported in this browser.');
        }
        return;
      }

      setIsLocating(true);
      if (!silentOnError) {
        setError(null);
        setErrorCode(null);
        setRejectedWarning(null);
        setRejectedAccuracyM(null);
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => handlePosition(pos, true, silentOnError),
        (err) => {
          if (err.code === err.PERMISSION_DENIED || accuracyThresholdM <= 50) {
            handleGeoError(err, { silentOnError, stopWatchOnDeny });
            return;
          }
          // Fallback to standard/Wi-Fi triangulation only when caller allows >50m fixes
          navigator.geolocation.getCurrentPosition(
            (pos) => handlePosition(pos, true, silentOnError),
            (fallbackErr) => handleGeoError(fallbackErr, { silentOnError, stopWatchOnDeny }),
            {
              enableHighAccuracy: false,
              timeout: Math.max(timeoutMs, 15_000),
              maximumAge: 0,
            }
          );
        },
        {
          enableHighAccuracy,
          timeout: timeoutMs,
          maximumAge: maximumAgeMs,
        }
      );
    },
    [enableHighAccuracy, timeoutMs, maximumAgeMs, accuracyThresholdM, handlePosition, handleGeoError]
  );

  const requestSingleFix = useCallback(
    (opts?: { silentOnError?: boolean }) => {
      requestReliableFix(Boolean(opts?.silentOnError), false);
    },
    [requestReliableFix]
  );

  const startWatching = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setPermissionStatus('unsupported');
      setErrorCode('UNSUPPORTED');
      setError('Geolocation is not supported in this browser.');
      return;
    }

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    setError(null);
    setErrorCode(null);
    setRejectedWarning(null);
    setRejectedAccuracyM(null);
    setIsWatching(true);
    setIsLocating(true);

    // Attach continuous high-accuracy watchPosition stream (fresh fixes only, maximumAge: 0)
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => handlePosition(pos, lastAcceptedFixRef.current === null),
      (err) => {
        setIsLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          handleGeoError(err, { silentOnError: false, stopWatchOnDeny: true });
        } else if (err.code === err.TIMEOUT) {
          setErrorCode('TIMEOUT');
          setError('Waiting for accurate GPS lock — move near a window or outdoors...');
        } else {
          setErrorCode('POSITION_UNAVAILABLE');
          setError('GPS signal temporarily unavailable — retrying automatically...');
        }
      },
      {
        enableHighAccuracy,
        timeout: Math.max(timeoutMs, 15_000),
        maximumAge: maximumAgeMs,
      }
    );
  }, [enableHighAccuracy, timeoutMs, maximumAgeMs, handlePosition, handleGeoError]);

  const clearError = useCallback(() => {
    setError(null);
    setErrorCode(null);
    setRejectedWarning(null);
    setRejectedAccuracyM(null);
  }, []);

  // Track browser geolocation permission state reactively (granted / denied / prompt)
  useEffect(() => {
    if (!isSupported) {
      setPermissionStatus('unsupported');
      return;
    }

    let active = true;
    let observedStatus: PermissionStatus | null = null;
    const syncPermission = async () => {
      try {
        if (navigator.permissions?.query) {
          const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
          if (!active) return;
          observedStatus = status;
          const mapped = status.state as GeolocationPermissionState;
          setPermissionStatus(mapped);
          status.onchange = () => {
            if (!active) return;
            const next = status.state as GeolocationPermissionState;
            setPermissionStatus(next);
            if (next === 'denied') {
              setErrorCode('PERMISSION_DENIED');
              setError(PERMISSION_DENIED_MESSAGE);
              stopWatching();
            } else if (next === 'granted') {
              setError((prev) => (prev === PERMISSION_DENIED_MESSAGE ? null : prev));
              setErrorCode((prev) => (prev === 'PERMISSION_DENIED' ? null : prev));
            }
          };
          if (autoStart && mapped !== 'denied') {
            startWatching();
          }
        } else if (autoStart) {
          startWatching();
        }
      } catch {
        if (autoStart) {
          startWatching();
        }
      }
    };

    void syncPermission();
    return () => {
      active = false;
      if (observedStatus) {
        observedStatus.onchange = null;
      }
    };
  }, [isSupported, autoStart, startWatching, stopWatching]);

  // Clean up active watchPosition listener on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  const accuracySummary = useMemo(
    () => evaluateAccuracyWarning(location?.accuracy ?? null, accuracyThresholdM),
    [location?.accuracy, accuracyThresholdM]
  );

  const coords = useMemo<Coords | null>(
    () => (location ? { lat: location.lat, lng: location.lng } : null),
    [location]
  );

  return useMemo(
    () => ({
      // Primary requested delivery-portal state object
      lat: location?.lat ?? null,
      lng: location?.lng ?? null,
      accuracy: location?.accuracy ?? null,
      heading: location?.heading ?? null,
      error,
      permissionStatus,

      // Extended helpers & backward-compatible aliases
      location,
      coords,
      latitude: location?.lat ?? null,
      longitude: location?.lng ?? null,
      speed: location?.speed ?? null,
      permissionState: permissionStatus,
      isPermissionDenied: permissionStatus === 'denied' || errorCode === 'PERMISSION_DENIED',
      isSupported,
      isWatching,
      isLocating,
      accuracyLevel: accuracySummary.level,
      accuracyLabel: accuracySummary.label,
      accuracyWarning: rejectedWarning ?? accuracySummary.warning,
      accuracyThresholdM,
      rejectedAccuracyM,
      discardedFixCount,
      errorCode,
      startWatching,
      stopWatching,
      requestSingleFix,
      clearError,
    }),
    [
      location,
      coords,
      error,
      permissionStatus,
      errorCode,
      isSupported,
      isWatching,
      isLocating,
      accuracySummary.level,
      accuracySummary.label,
      accuracySummary.warning,
      rejectedWarning,
      accuracyThresholdM,
      rejectedAccuracyM,
      discardedFixCount,
      startWatching,
      stopWatching,
      requestSingleFix,
      clearError,
    ]
  );
}
