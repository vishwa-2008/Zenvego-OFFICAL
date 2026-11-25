import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, LngLatBoundsLike, Map as MapLibreMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  ApiError,
  zenvegoApi,
  type AiMapInsightsResponse,
  type PlaceSearchResult,
  type RouteResponse,
  type ServiceabilityResponse,
} from '../lib/apiClient';
import {
  classifyGpsAccuracy,
  computeBearingDeg,
  getLocationFreshness,
  haversineKm,
  interpolateAngleDeg,
  interpolateCoords,
  isValidCoords,
  ROUTE_REFRESH_POLICY,
  shouldRefreshRoute,
  type Coords,
} from '../lib/geo';
import {
  BENGALURU_VIEWPORT_CENTER,
  ensureMapLibreWorkerConfigured,
  formatMapLibreError,
  getMapStyleUrlForPreset,
  MAP_ATTRIBUTION,
  MAP_STYLE_PRESETS,
  MAP_THEME,
  ROUTE_ETA_DISCLAIMER,
  type MapStylePresetId,
} from '../lib/mapConfig';
import {
  useOrderTrackingSocket,
  type SocketDeliveryStage,
  type SocketTrackingRole,
} from '../lib/trackingSocket';
import { useLiveLocation, type LiveLocationFix } from '../hooks/useLiveLocation';
import type { OrderTrackingCurrentDoc } from '../types';

export interface LocationPickerResult {
  address: string;
  lat: number;
  lng: number;
  serviceability: ServiceabilityResponse | null;
}

export type TrackingStage = 'open' | 'accepted' | 'picked_up' | 'delivered' | 'issue_reported' | 'awaiting_dispatch';

export interface PartnerGpsTelemetry {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
  speed: number | null;
  timestamp: string;
  stage: SocketDeliveryStage;
}

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  useEffect(() => {
    const onUp = () => setOnline(true);
    const onDown = () => setOnline(false);
    window.addEventListener('online', onUp);
    window.addEventListener('offline', onDown);
    return () => {
      window.removeEventListener('online', onUp);
      window.removeEventListener('offline', onDown);
    };
  }, []);
  return online;
}

function parseTimestampMs(val: unknown): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function mapStageToSocketStage(stage: TrackingStage): SocketDeliveryStage {
  switch (stage) {
    case 'delivered':
      return 'DELIVERED';
    case 'picked_up':
      return 'OUT_FOR_DELIVERY';
    case 'accepted':
      return 'PARTNER_ASSIGNED';
    default:
      return 'ORDER_CONFIRMED';
  }
}

/**
 * Google-Maps-style glowing blue live-GPS position dot with translucent halo.
 */
function createBlueGpsDotElement(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = 'position:relative;width:36px;height:36px;display:flex;align-items:center;justify-content:center;pointer-events:none;';
  el.innerHTML = `
    <div class="animate-ping" style="position:absolute;inset:2px;border-radius:9999px;background:rgba(26,115,232,0.32);"></div>
    <div style="position:absolute;inset:6px;border-radius:9999px;background:rgba(26,115,232,0.18);"></div>
    <div style="position:relative;width:15px;height:15px;border-radius:9999px;background:#1A73E8;border:2.5px solid #FFFFFF;box-shadow:0 2px 8px rgba(26,115,232,0.55);"></div>
  `;
  return el;
}

/**
 * Reusable Google-Maps-inspired floating Layers & 3D Tilt control widget.
 */
const MapLayersControl: React.FC<{
  stylePreset: MapStylePresetId;
  onSelectPreset: (preset: MapStylePresetId) => void;
  is3D: boolean;
  onToggle3D: () => void;
  compact?: boolean;
}> = ({ stylePreset, onSelectPreset, is3D, onToggle3D, compact = false }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative flex flex-col items-start gap-1.5">
      {open && (
        <div className="w-56 rounded-2xl bg-white/98 backdrop-blur-md border border-slate-200 shadow-xl p-2.5 space-y-2 text-slate-900">
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
              Map View (Free Vector)
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close map layers"
              className="w-5 h-5 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {MAP_STYLE_PRESETS.map((preset) => {
              const active = preset.id === stylePreset;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    onSelectPreset(preset.id);
                    setOpen(false);
                  }}
                  className={`text-left p-2 rounded-xl border transition-all cursor-pointer ${
                    active
                      ? 'border-[#1A73E8] bg-blue-50/70 ring-1 ring-[#1A73E8]/30'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div
                    className="h-7 rounded-lg mb-1.5 border border-black/10 relative overflow-hidden"
                    style={{ background: preset.previewBg }}
                  >
                    <div
                      className="absolute inset-x-1 top-2.5 h-1 rounded-full opacity-85"
                      style={{ background: preset.previewAccent }}
                    />
                    <div
                      className="absolute right-2 bottom-1.5 w-2 h-2 rounded-full"
                      style={{ background: preset.previewAccent }}
                    />
                  </div>
                  <p className="text-[11px] font-extrabold text-slate-900 leading-tight">{preset.label}</p>
                  <p className="text-[9px] text-slate-500 leading-tight truncate">{preset.shortDesc}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title="Change map style (Street / 3D Detail / Clean / Night)"
          aria-label="Map layers"
          className={`h-9 ${compact ? 'px-2.5' : 'px-3'} rounded-xl bg-white/95 hover:bg-white border border-slate-200/90 shadow-md text-slate-800 text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-colors`}
        >
          <span className="material-symbols-outlined text-[17px] text-[#1A73E8]">layers</span>
          <span>{MAP_STYLE_PRESETS.find((p) => p.id === stylePreset)?.label || 'Layers'}</span>
        </button>

        <button
          type="button"
          onClick={onToggle3D}
          title={is3D ? 'Switch to 2D top-down view' : 'Tilt into 3D street perspective'}
          aria-label="Toggle 3D map tilt"
          className={`h-9 px-2.5 rounded-xl border shadow-md text-[11px] font-extrabold flex items-center gap-1 cursor-pointer transition-colors ${
            is3D
              ? 'bg-[#1A73E8] border-[#1A73E8] text-white'
              : 'bg-white/95 hover:bg-white border-slate-200/90 text-slate-800'
          }`}
        >
          <span className="material-symbols-outlined text-[15px]">view_in_ar</span>
          <span>3D</span>
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// 1. Device Location Permission Prompt Modal
// ---------------------------------------------------------------------------
interface DeviceLocationPromptProps {
  open: boolean;
  permissionState: 'prompt' | 'denied' | 'granted' | 'unsupported';
  busy: boolean;
  onAllow: () => void;
  onClose: () => void;
}

export const DeviceLocationPromptModal: React.FC<DeviceLocationPromptProps> = ({
  open,
  permissionState,
  busy,
  onAllow,
  onClose,
}) => {
  if (!open) return null;
  const isDenied = permissionState === 'denied';
  const isUnsupported = permissionState === 'unsupported';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="device-location-modal-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white text-slate-900 border border-slate-200 shadow-2xl overflow-hidden">
        <div className="bg-emerald-50/80 p-4 border-b border-emerald-100">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#003820] text-white flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[22px]">
                  {isDenied ? 'location_off' : 'my_location'}
                </span>
              </div>
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700">
                  Device GPS Location
                </span>
                <h3 id="device-location-modal-title" className="text-base font-extrabold text-slate-900">
                  {isDenied
                    ? 'Location Permission Is Blocked'
                    : isUnsupported
                      ? 'Browser GPS Not Available'
                      : 'Allow ZENVEGO to Detect Your Location'}
                </h3>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close location prompt"
              className="w-8 h-8 rounded-full bg-white border border-slate-200 hover:bg-slate-50 flex items-center justify-center cursor-pointer text-slate-500"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {isDenied ? (
            <div className="space-y-2.5 text-xs text-slate-600">
              <p>
                Your browser has blocked GPS access for this site. You can search for your street or drag the map pin
                manually, or re-enable GPS:
              </p>
              <ol className="list-decimal pl-4 space-y-1 text-slate-800 font-medium">
                <li>Click the lock / site-settings icon in your browser address bar.</li>
                <li>Change <strong>Location</strong> permission to <strong>Allow</strong>.</li>
                <li>Tap <strong>Retry GPS</strong> below.</li>
              </ol>
            </div>
          ) : isUnsupported ? (
            <p className="text-xs text-slate-600">
              This browser does not expose device GPS. Use the address search bar or drag the map pin directly.
            </p>
          ) : (
            <div className="space-y-2.5">
              <p className="text-xs text-slate-600 leading-relaxed">
                We read your live GPS coordinates once to pin your address accurately and verify our 10 km hyperlocal
                grower network.
              </p>
              <div className="grid grid-cols-1 gap-2 text-xs">
                <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200/80">
                  <span className="material-symbols-outlined text-[18px] text-emerald-700">gps_fixed</span>
                  <span className="text-slate-700 font-medium">Checks GPS accuracy before pinning</span>
                </div>
                <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200/80">
                  <span className="material-symbols-outlined text-[18px] text-emerald-700">verified_user</span>
                  <span className="text-slate-700 font-medium">Only saved when you confirm your address</span>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            {!isUnsupported && (
              <button
                type="button"
                disabled={busy}
                onClick={onAllow}
                className="flex-1 h-10 rounded-xl bg-[#003820] hover:bg-[#0f5132] text-white text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-[18px]">my_location</span>
                <span>{busy ? 'Requesting GPS...' : isDenied ? 'Retry GPS' : 'Allow & Detect Location'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="h-10 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
            >
              Enter Manually
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// 2. Interactive OpenFreeMap Liberty Location Picker (Customer / Profile / Grower)
// ---------------------------------------------------------------------------
interface LocationPickerMapProps {
  initialLat?: number;
  initialLng?: number;
  initialAddress?: string;
  autoDetectOnMount?: boolean;
  onLocationChange: (result: LocationPickerResult) => void;
  heightClass?: string;
}

export const LocationPickerMap: React.FC<LocationPickerMapProps> = ({
  initialLat,
  initialLng,
  initialAddress = '',
  autoDetectOnMount = false,
  onLocationChange,
  heightClass = 'h-72 sm:h-80',
}) => {
  const hasInitialValid = isValidCoords(
    initialLat !== undefined && initialLng !== undefined ? { lat: initialLat, lng: initialLng } : null
  );

  const [pinPos, setPinPos] = useState<Coords>(() =>
    hasInitialValid ? { lat: initialLat as number, lng: initialLng as number } : BENGALURU_VIEWPORT_CENTER
  );
  const [hasConfirmedPin, setHasConfirmedPin] = useState<boolean>(hasInitialValid);
  const [address, setAddress] = useState<string>(initialAddress);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<PlaceSearchResult[]>([]);
  const [searchBusy, setSearchBusy] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);

  const [serviceability, setServiceability] = useState<ServiceabilityResponse | null>(null);
  const [checkingService, setCheckingService] = useState<boolean>(false);
  const [reverseBusy, setReverseBusy] = useState<boolean>(false);
  const [pinIsFromGps, setPinIsFromGps] = useState<boolean>(false);
  const [geocodeWarn, setGeocodeWarn] = useState<string | null>(null);
  const [showLocationPrompt, setShowLocationPrompt] = useState<boolean>(false);
  const [mapStylePreset, setMapStylePreset] = useState<MapStylePresetId>('bright');
  const [is3D, setIs3D] = useState<boolean>(false);
  const [mapLoading, setMapLoading] = useState<boolean>(true);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapRetryKey, setMapRetryKey] = useState<number>(0);

  // Server-side Gemini AI Location & Map Insights state
  const [aiLocateBusy, setAiLocateBusy] = useState<boolean>(false);
  const [aiLocateNote, setAiLocateNote] = useState<{ areaHint: string; deliveryNoteSuggestion: string } | null>(null);
  const [aiInsights, setAiInsights] = useState<AiMapInsightsResponse | null>(null);
  const [aiInsightsBusy, setAiInsightsBusy] = useState<boolean>(false);
  const [aiInsightsError, setAiInsightsError] = useState<string | null>(null);

  const isOnline = useOnlineStatus();
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const gpsDotMarkerRef = useRef<Marker | null>(null);
  const lastWatchCommitMsRef = useRef<number>(0);
  const manualGpsTriggerRef = useRef<boolean>(false);
  const onChangeRef = useRef(onLocationChange);
  onChangeRef.current = onLocationChange;

  const autoDetectRanRef = useRef(false);
  const searchAbortRef = useRef<number>(0);

  const commitLocation = useCallback(
    async (lat: number, lng: number, explicitAddress?: string, shouldReverseGeocode = true) => {
      if (!isValidCoords({ lat, lng })) return;
      setPinPos({ lat, lng });
      setHasConfirmedPin(true);
      setGeocodeWarn(null);

      let resolvedAddr = explicitAddress?.trim() || '';
      if (!resolvedAddr && shouldReverseGeocode) {
        setReverseBusy(true);
        try {
          const geo = await zenvegoApi.geocode({ lat, lng });
          resolvedAddr = geo.formattedAddress;
        } catch (err) {
          if (err instanceof ApiError && err.status === 429) {
            setGeocodeWarn('Reverse geocoding is rate-limited. Pin saved — type your street address below.');
          }
          resolvedAddr = address.trim() || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        } finally {
          setReverseBusy(false);
        }
      }

      if (resolvedAddr) {
        setAddress(resolvedAddr);
      }

      setCheckingService(true);
      let svc: ServiceabilityResponse | null = null;
      try {
        svc = await zenvegoApi.checkServiceability(lat, lng);
        setServiceability(svc);
      } catch {
        setServiceability(null);
      } finally {
        setCheckingService(false);
      }

      onChangeRef.current({
        address: resolvedAddr || address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        lat,
        lng,
        serviceability: svc,
      });
    },
    [address]
  );

  const commitLocationRef = useRef(commitLocation);
  commitLocationRef.current = commitLocation;

  const handlePickerLiveFix = useCallback((fix: LiveLocationFix, meta: { immediate: boolean }) => {
    setShowLocationPrompt(false);
    setPinIsFromGps(true);
    const now = Date.now();
    if (meta.immediate || now - lastWatchCommitMsRef.current >= 5_000) {
      lastWatchCommitMsRef.current = now;
      void commitLocationRef.current(fix.latitude, fix.longitude, undefined, true);
    }
  }, []);

  const handlePickerPermissionDenied = useCallback(() => {
    if (manualGpsTriggerRef.current) {
      setShowLocationPrompt(true);
    }
  }, []);

  const liveLoc = useLiveLocation({
    enableHighAccuracy: true,
    timeoutMs: 12_000,
    maximumAgeMs: 0,
    minAccuracyThresholdM: 20,
    onFix: handlePickerLiveFix,
    onPermissionDenied: handlePickerPermissionDenied,
  });

  const pinPosRef = useRef<Coords>(pinPos);
  pinPosRef.current = pinPos;

  // Sync external initial props if caller switches saved address (skip if coords already match to prevent feedback loops)
  useEffect(() => {
    if (isValidCoords(initialLat !== undefined && initialLng !== undefined ? { lat: initialLat, lng: initialLng } : null)) {
      const nextLat = initialLat as number;
      const nextLng = initialLng as number;
      const coordsChanged =
        Math.abs(nextLat - pinPosRef.current.lat) > 1e-6 ||
        Math.abs(nextLng - pinPosRef.current.lng) > 1e-6;
      if (coordsChanged) {
        setPinPos({ lat: nextLat, lng: nextLng });
        if (mapRef.current) {
          mapRef.current.flyTo({ center: [nextLng, nextLat], zoom: Math.max(mapRef.current.getZoom(), 14), duration: 450 });
        }
        if (markerRef.current) {
          markerRef.current.setLngLat([nextLng, nextLat]);
        }
      }
      setHasConfirmedPin(true);
      if (initialAddress) setAddress(initialAddress);
    }
  }, [initialLat, initialLng, initialAddress]);

  // Initialize MapLibre GL JS with free Google-Maps-like OpenFreeMap vector style
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    setMapError(null);
    setMapLoading(true);
    let map: MapLibreMap;
    try {
      ensureMapLibreWorkerConfigured();
      map = new maplibregl.Map({
        container,
        style: getMapStyleUrlForPreset(mapStylePreset),
        center: [pinPos.lng, pinPos.lat],
        zoom: hasConfirmedPin ? 15.5 : 12.5,
        pitch: is3D ? 52 : 0,
        attributionControl: false,
      });
    } catch (err) {
      setMapLoading(false);
      setMapError(formatMapLibreError(err));
      return;
    }

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');

    const pinEl = document.createElement('div');
    pinEl.className = 'zenvego-picker-pin';
    pinEl.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;cursor:grab;">
        <div style="width:38px;height:38px;border-radius:9999px;background:#003820;border:3px solid #FFFFFF;box-shadow:0 4px 16px rgba(0,56,32,0.42);display:flex;align-items:center;justify-content:center;color:#FFFFFF;">
          <span class="material-symbols-outlined" style="font-size:21px;">location_on</span>
        </div>
        <div style="width:3px;height:9px;background:#003820;"></div>
        <div style="width:12px;height:4px;border-radius:9999px;background:rgba(0,56,32,0.32);"></div>
      </div>
    `;

    const marker = new maplibregl.Marker({ element: pinEl, draggable: true, anchor: 'bottom' })
      .setLngLat([pinPos.lng, pinPos.lat])
      .addTo(map);
    markerRef.current = marker;

    marker.on('dragend', () => {
      const lngLat = marker.getLngLat();
      setPinIsFromGps(false);
      void commitLocationRef.current(lngLat.lat, lngLat.lng, undefined, true);
    });

    map.on('click', (e) => {
      marker.setLngLat(e.lngLat);
      setPinIsFromGps(false);
      void commitLocationRef.current(e.lngLat.lat, e.lngLat.lng, undefined, true);
    });

    map.on('load', () => {
      setMapLoading(false);
      setMapError(null);
      map.resize();
    });

    map.on('style.load', () => {
      setMapLoading(false);
    });

    map.on('error', (evt) => {
      const errObj = evt?.error;
      if (!errObj) return;
      const msg = errObj instanceof Error ? errObj.message : String(errObj);
      if (/worker/i.test(msg) || !map.isStyleLoaded()) {
        setMapLoading(false);
        setMapError(formatMapLibreError(errObj));
      }
    });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        map.resize();
      });
      resizeObserver.observe(container);
    }

    return () => {
      resizeObserver?.disconnect();
      gpsDotMarkerRef.current?.remove();
      gpsDotMarkerRef.current = null;
      marker.remove();
      map.remove();
      markerRef.current = null;
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRetryKey]);

  // Switch OpenFreeMap style live (Street / 3D Detail / Clean / Night)
  const handleSelectPickerStyle = useCallback((next: MapStylePresetId) => {
    setMapStylePreset(next);
    const map = mapRef.current;
    if (map) {
      setMapLoading(true);
      setMapError(null);
      map.setStyle(getMapStyleUrlForPreset(next));
    }
  }, []);

  const handleTogglePicker3D = useCallback(() => {
    setIs3D((prev) => {
      const next = !prev;
      const map = mapRef.current;
      if (map) {
        map.easeTo({ pitch: next ? 52 : 0, bearing: next ? -15 : 0, duration: 500 });
      }
      return next;
    });
  }, []);

  // Sync Google-Maps-style pulsing blue GPS dot when liveLoc.coords updates
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!liveLoc.coords) {
      gpsDotMarkerRef.current?.remove();
      gpsDotMarkerRef.current = null;
      return;
    }
    if (!gpsDotMarkerRef.current) {
      gpsDotMarkerRef.current = new maplibregl.Marker({ element: createBlueGpsDotElement(), anchor: 'center' })
        .setLngLat([liveLoc.coords.lng, liveLoc.coords.lat])
        .addTo(map);
    } else {
      gpsDotMarkerRef.current.setLngLat([liveLoc.coords.lng, liveLoc.coords.lat]);
    }
  }, [liveLoc.coords, mapRetryKey]);

  useEffect(() => {
    if (markerRef.current) {
      markerRef.current.setLngLat([pinPos.lng, pinPos.lat]);
    }
    if (mapRef.current && hasConfirmedPin) {
      mapRef.current.flyTo({ center: [pinPos.lng, pinPos.lat], zoom: Math.max(mapRef.current.getZoom(), 15), duration: 500 });
    }
  }, [pinPos.lat, pinPos.lng, hasConfirmedPin]);

  useEffect(() => {
    if (hasInitialValid && initialLat !== undefined && initialLng !== undefined) {
      void zenvegoApi
        .checkServiceability(initialLat, initialLng)
        .then((svc) => setServiceability(svc))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced server-proxied OSM address autocomplete
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setSearchError(null);
      setSearchBusy(false);
      return;
    }
    if (!isOnline) {
      setSearchError('You appear offline. Reconnect or enter your street address manually below.');
      return;
    }

    const requestId = ++searchAbortRef.current;
    const timer = window.setTimeout(async () => {
      setSearchBusy(true);
      setSearchError(null);
      try {
        const res = await zenvegoApi.searchAddresses({
          query: trimmed,
          biasLat: pinPos.lat,
          biasLng: pinPos.lng,
          limit: 5,
        });
        if (requestId !== searchAbortRef.current) return;
        setSearchResults(res.results);
        setDropdownOpen(true);
        if (res.results.length === 0) {
          setSearchError('No matching streets found. Try a nearby landmark or drag the map pin.');
        }
      } catch (err) {
        if (requestId !== searchAbortRef.current) return;
        if (err instanceof ApiError && err.status === 429) {
          setSearchError('Address search is temporarily rate-limited. Wait a few seconds or drag the pin.');
        } else {
          setSearchError(err instanceof Error ? err.message : 'Unable to search addresses right now.');
        }
      } finally {
        if (requestId === searchAbortRef.current) setSearchBusy(false);
      }
    }, 380);

    return () => window.clearTimeout(timer);
  }, [searchQuery, isOnline, pinPos.lat, pinPos.lng]);

  const {
    isWatching: pickerIsWatching,
    isSupported: pickerGpsSupported,
    isPermissionDenied: pickerGpsDenied,
    stopWatching: stopPickerWatching,
    startWatching: startPickerWatching,
    requestSingleFix: requestPickerSingleFix,
  } = liveLoc;

  // Continuous live GPS watchPosition toggle powered by useLiveLocation
  const togglePickerLiveGps = useCallback(() => {
    if (pickerIsWatching) {
      stopPickerWatching();
      return;
    }
    if (!pickerGpsSupported || pickerGpsDenied) {
      setShowLocationPrompt(true);
      return;
    }
    manualGpsTriggerRef.current = true;
    startPickerWatching();
  }, [pickerIsWatching, pickerGpsSupported, pickerGpsDenied, stopPickerWatching, startPickerWatching]);

  // Trigger real browser GPS permission prompt on mount when autoDetectOnMount is enabled
  useEffect(() => {
    if (!autoDetectOnMount || hasInitialValid || autoDetectRanRef.current) return;
    if (!pickerGpsSupported || pickerGpsDenied) return;
    autoDetectRanRef.current = true;
    manualGpsTriggerRef.current = false;
    requestPickerSingleFix({ silentOnError: true });
  }, [autoDetectOnMount, hasInitialValid, pickerGpsSupported, pickerGpsDenied, requestPickerSingleFix]);

  // Directly invoke native browser geolocation prompt on click (only open help modal if already denied/unsupported)
  const handleUseGpsClick = () => {
    if (!liveLoc.isSupported || liveLoc.isPermissionDenied) {
      setShowLocationPrompt(true);
      return;
    }
    manualGpsTriggerRef.current = true;
    liveLoc.requestSingleFix({ silentOnError: false });
  };

  // Server-side Gemini AI natural-language landmark finder
  const handleAiSmartLocate = async () => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < 3) {
      setSearchError('Type a landmark or description (e.g. "near Indiranagar metro 100ft road") for AI Find.');
      return;
    }
    setAiLocateBusy(true);
    setSearchError(null);
    setAiLocateNote(null);
    try {
      const res = await zenvegoApi.aiLocate({
        description: trimmed,
        biasLat: pinPos.lat,
        biasLng: pinPos.lng,
      });
      setAiLocateNote({
        areaHint: res.areaHint,
        deliveryNoteSuggestion: res.deliveryNoteSuggestion,
      });
      setSearchResults(res.results);
      setDropdownOpen(true);
      if (res.results.length === 0) {
        setSearchError(`AI searched "${res.cleanQuery}" on OpenStreetMap but found no exact street pin. Try refining or dragging the pin.`);
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'AI location search is unavailable right now.');
    } finally {
      setAiLocateBusy(false);
    }
  };

  // Server-side Gemini AI area & map visibility assistant
  const handleFetchPickerAiInsights = async () => {
    setAiInsightsBusy(true);
    setAiInsightsError(null);
    try {
      const res = await zenvegoApi.aiMapInsights({
        mode: 'location',
        address: address || `${pinPos.lat.toFixed(5)}, ${pinPos.lng.toFixed(5)}`,
        lat: pinPos.lat,
        lng: pinPos.lng,
        serviceable: serviceability ? serviceability.serviceable : null,
        localHour: new Date().getHours(),
      });
      setAiInsights(res);
    } catch (err) {
      setAiInsightsError(err instanceof Error ? err.message : 'Unable to fetch AI location insights right now.');
    } finally {
      setAiInsightsBusy(false);
    }
  };

  const handleSelectSearchResult = (item: PlaceSearchResult) => {
    setDropdownOpen(false);
    setSearchQuery(item.title);
    setSearchResults([]);
    setPinIsFromGps(false);
    void commitLocation(item.lat, item.lng, item.formattedAddress, false);
  };

  const handleManualAddressChange = (val: string) => {
    setAddress(val);
    onChangeRef.current({
      address: val,
      lat: pinPos.lat,
      lng: pinPos.lng,
      serviceability,
    });
  };

  const pickerGpsBanner = liveLoc.error || geocodeWarn;

  return (
    <div className="space-y-3">
      <DeviceLocationPromptModal
        open={showLocationPrompt}
        permissionState={liveLoc.permissionState}
        busy={liveLoc.isLocating}
        onAllow={() => {
          manualGpsTriggerRef.current = true;
          liveLoc.requestSingleFix({ silentOnError: false });
        }}
        onClose={() => setShowLocationPrompt(false)}
      />

      {/* Google-Maps-Style Search + AI Find + Direct Live GPS Row */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <span className="material-symbols-outlined text-[18px] text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
            search
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && searchQuery.trim().length >= 3 && searchResults.length === 0) {
                e.preventDefault();
                void handleAiSmartLocate();
              }
            }}
            onFocus={() => {
              if (searchResults.length > 0) setDropdownOpen(true);
            }}
            placeholder="Search street, landmark, or describe (e.g. near Metro Gate 2)..."
            aria-label="Search delivery address"
            className="w-full pl-9 pr-24 py-2.5 rounded-xl bg-white text-slate-900 placeholder:text-slate-400 border border-slate-200 text-xs font-medium outline-none focus:ring-2 focus:ring-[#1A73E8]/30 focus:border-[#1A73E8] shadow-2xs"
          />

          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {(searchBusy || aiLocateBusy) && (
              <span className="material-symbols-outlined text-[16px] text-[#1A73E8] animate-spin mr-1">
                progress_activity
              </span>
            )}
            {!searchBusy && !aiLocateBusy && searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSearchResults([]);
                  setDropdownOpen(false);
                  setSearchError(null);
                  setAiLocateNote(null);
                }}
                aria-label="Clear address search"
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[15px]">close</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleAiSmartLocate()}
              disabled={aiLocateBusy || searchQuery.trim().length < 3}
              title="Use Gemini AI to find natural-language landmarks on OpenStreetMap"
              className="h-7 px-2 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200/80 text-[#1A73E8] text-[10px] font-extrabold flex items-center gap-1 cursor-pointer disabled:opacity-45 transition-colors"
            >
              <span className="material-symbols-outlined text-[13px]">auto_awesome</span>
              <span>AI Find</span>
            </button>
          </div>

          {dropdownOpen && searchResults.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1.5 z-30 rounded-xl bg-white border border-slate-200 shadow-xl overflow-hidden divide-y divide-slate-100">
              {aiLocateNote?.areaHint && (
                <div className="px-3.5 py-2 bg-blue-50/80 text-[11px] text-blue-950 flex items-center gap-1.5 font-semibold">
                  <span className="material-symbols-outlined text-[14px] text-[#1A73E8] shrink-0">auto_awesome</span>
                  <span className="truncate">{aiLocateNote.areaHint}</span>
                </div>
              )}
              {searchResults.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectSearchResult(item)}
                  className="w-full text-left px-3.5 py-2.5 hover:bg-blue-50/60 transition-colors flex items-start gap-2.5 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[18px] text-[#1A73E8] mt-0.5 shrink-0">
                    location_on
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 truncate">{item.title}</p>
                    {item.subtitle && <p className="text-[11px] text-slate-500 truncate">{item.subtitle}</p>}
                  </div>
                </button>
              ))}
              <div className="px-3 py-1.5 bg-slate-50 text-[10px] text-slate-500 flex justify-between">
                <span>OpenStreetMap Search</span>
                <span>© OpenStreetMap contributors</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleUseGpsClick}
            disabled={liveLoc.isLocating}
            className="flex-1 sm:flex-none h-10 px-3.5 rounded-xl bg-[#1A73E8] hover:bg-[#1557B0] text-white text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 transition-colors shadow-xs"
          >
            <span className="material-symbols-outlined text-[17px]">my_location</span>
            <span>{liveLoc.isLocating ? 'Locating...' : 'Detect GPS'}</span>
          </button>

          <button
            type="button"
            onClick={togglePickerLiveGps}
            title={liveLoc.isWatching ? 'Stop live GPS tracking' : 'Continuously track your live GPS movement'}
            className={`h-10 px-3 rounded-xl border text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
              liveLoc.isWatching
                ? 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-white border-slate-200 text-slate-800 hover:bg-slate-50'
            }`}
          >
            <span className={`material-symbols-outlined text-[16px] ${liveLoc.isWatching ? 'animate-pulse' : 'text-emerald-700'}`}>
              sensors
            </span>
            <span>{liveLoc.isWatching ? 'Live On' : 'Live GPS'}</span>
          </button>
        </div>
      </div>

      {!isOnline && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold">
          <span className="material-symbols-outlined text-[16px] shrink-0">wifi_off</span>
          <span>You are offline. Map tiles and address lookup require an internet connection.</span>
        </div>
      )}

      {searchError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 text-xs">
          <span className="material-symbols-outlined text-[16px] text-amber-600 shrink-0">info</span>
          <span>{searchError}</span>
        </div>
      )}

      {pickerGpsBanner && (
        <div
          className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs ${
            liveLoc.isPermissionDenied
              ? 'bg-red-50 border-red-200 text-red-900'
              : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`material-symbols-outlined text-[16px] shrink-0 ${
                liveLoc.isPermissionDenied ? 'text-red-700' : 'text-amber-700'
              }`}
            >
              {liveLoc.isPermissionDenied ? 'location_disabled' : 'gps_off'}
            </span>
            <span>{pickerGpsBanner}</span>
          </div>
          {liveLoc.isPermissionDenied && (
            <button
              type="button"
              onClick={() => setShowLocationPrompt(true)}
              className="px-2.5 py-1 rounded-lg bg-red-100 hover:bg-red-200/80 text-red-950 font-bold text-[11px] shrink-0 cursor-pointer"
            >
              How to Enable
            </button>
          )}
        </div>
      )}

      {liveLoc.accuracyWarning && !liveLoc.error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs">
          <span className="material-symbols-outlined text-[16px] text-amber-700 shrink-0">warning</span>
          <span>{liveLoc.accuracyWarning}</span>
        </div>
      )}

      {/* Free Google-Maps-Style OpenFreeMap Vector Viewport */}
      <div
        className={`relative w-full ${heightClass} rounded-2xl overflow-hidden border border-slate-200 bg-[#F4F7F5] shadow-sm zenvego-maplibre`}
      >
        <div ref={mapContainerRef} className="w-full h-full" />

        {/* Top-left Instruction, Live GPS Accuracy & Compass Heading Strip */}
        <div className="pointer-events-none absolute top-3 left-3 z-10 flex flex-wrap items-center gap-1.5 max-w-[74%]">
          <div className="px-2.5 py-1 rounded-lg bg-white/95 backdrop-blur-xs border border-slate-200/90 text-[10px] font-bold text-slate-800 flex items-center gap-1.5 shadow-sm">
            <span
              className={`w-2 h-2 rounded-full ${
                liveLoc.isWatching
                  ? liveLoc.coords
                    ? 'bg-[#1A73E8] animate-pulse'
                    : 'bg-amber-500 animate-pulse'
                  : 'bg-emerald-600'
              }`}
            />
            <span>
              {liveLoc.isWatching
                ? liveLoc.coords
                  ? 'Live GPS locked'
                  : `Waiting for accurate GPS (≤${liveLoc.accuracyThresholdM}m)...`
                : 'Tap map or drag pin'}
            </span>
          </div>
          {pinIsFromGps && liveLoc.accuracyLabel && (
            <div
              className={`px-2.5 py-1 rounded-lg border text-[10px] font-bold shadow-xs ${
                liveLoc.accuracyLevel === 'high'
                  ? 'bg-emerald-50/95 border-emerald-200 text-emerald-900'
                  : liveLoc.accuracyLevel === 'moderate'
                    ? 'bg-sky-50/95 border-sky-200 text-sky-900'
                    : 'bg-amber-50/95 border-amber-200 text-amber-900'
              }`}
            >
              {liveLoc.accuracyLabel}
            </div>
          )}
          {liveLoc.isWatching && liveLoc.heading !== null && (
            <div className="px-2 py-1 rounded-lg bg-white/95 border border-slate-200/90 text-[10px] font-mono font-bold text-slate-700 shadow-xs inline-flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px] text-[#1A73E8]">explore</span>
              <span>{Math.round(liveLoc.heading)}°</span>
            </div>
          )}
        </div>

        {/* Bottom-left Google-Maps-Style Layers + 3D Control */}
        <div className="absolute bottom-8 left-3 z-10">
          <MapLayersControl
            stylePreset={mapStylePreset}
            onSelectPreset={handleSelectPickerStyle}
            is3D={is3D}
            onToggle3D={handleTogglePicker3D}
            compact
          />
        </div>

        {/* Bottom-right Google-Maps-Style Floating "My Location" FAB */}
        <div className="absolute bottom-3 right-3 z-10 flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={handleUseGpsClick}
            disabled={liveLoc.isLocating}
            title="Center on my current live GPS location"
            aria-label="Center on my current GPS location"
            className={`w-10 h-10 rounded-full border shadow-md flex items-center justify-center cursor-pointer transition-all ${
              liveLoc.coords
                ? 'bg-[#1A73E8] border-[#1A73E8] text-white hover:bg-[#1557B0]'
                : 'bg-white/95 border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span className={`material-symbols-outlined text-[20px] ${liveLoc.isLocating ? 'animate-spin' : ''}`}>
              {liveLoc.isLocating ? 'progress_activity' : 'my_location'}
            </span>
          </button>
        </div>

        <div className="pointer-events-none absolute bottom-2 left-2 z-10 px-2 py-0.5 rounded bg-white/90 border border-slate-200/80 text-[9px] font-medium text-slate-600">
          {MAP_ATTRIBUTION}
        </div>

        {mapLoading && !mapError && (
          <div className="pointer-events-none absolute inset-0 z-15 flex flex-col items-center justify-center bg-[#F4F7F5]/85 backdrop-blur-[1px] gap-2">
            <span className="material-symbols-outlined text-2xl text-[#003820] animate-spin">progress_activity</span>
            <p className="text-[11px] font-bold text-slate-700">Loading OpenFreeMap street tiles...</p>
          </div>
        )}

        {mapError && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-white/95 p-5 text-center gap-3">
            <span className="material-symbols-outlined text-3xl text-amber-600">map</span>
            <p className="text-xs font-semibold text-slate-700 max-w-xs">{mapError}</p>
            <button
              type="button"
              onClick={() => setMapRetryKey((k) => k + 1)}
              className="px-4 py-2 rounded-xl bg-[#003820] text-white text-xs font-extrabold cursor-pointer"
            >
              Retry Map Load
            </button>
          </div>
        )}
      </div>

      {/* Confirmed / Editable Street Address + Coordinates + AI Map Assistant */}
      <div className="rounded-xl bg-white border border-slate-200 p-3 space-y-2.5 text-slate-900 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-800">
            Selected Street Address {reverseBusy ? '(Resolving...)' : ''}
          </label>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-slate-500 tabular-nums">
              {pinPos.lat.toFixed(5)}, {pinPos.lng.toFixed(5)}
            </span>
            <button
              type="button"
              onClick={() => void handleFetchPickerAiInsights()}
              disabled={aiInsightsBusy}
              className="h-6 px-2 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 text-[#1A73E8] text-[10px] font-extrabold inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
            >
              <span className={`material-symbols-outlined text-[13px] ${aiInsightsBusy ? 'animate-spin' : ''}`}>
                {aiInsightsBusy ? 'progress_activity' : 'auto_awesome'}
              </span>
              <span>{aiInsightsBusy ? 'Analyzing...' : 'AI Map Assist'}</span>
            </button>
          </div>
        </div>

        <input
          type="text"
          value={address}
          onChange={(e) => handleManualAddressChange(e.target.value)}
          placeholder="Type house / flat no., street, and locality manually if needed..."
          className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-emerald-600/30"
        />

        {aiLocateNote?.deliveryNoteSuggestion && (
          <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-blue-50/70 border border-blue-200/80 text-[11px] text-blue-950">
            <span className="truncate">
              <strong>AI Delivery Note:</strong> {aiLocateNote.deliveryNoteSuggestion}
            </span>
            <button
              type="button"
              onClick={() => {
                const merged = address
                  ? `${address} (${aiLocateNote.deliveryNoteSuggestion})`
                  : aiLocateNote.deliveryNoteSuggestion;
                handleManualAddressChange(merged);
                setAiLocateNote(null);
              }}
              className="px-2 py-0.5 rounded bg-[#1A73E8] text-white text-[10px] font-bold shrink-0 cursor-pointer"
            >
              Add Note
            </button>
          </div>
        )}

        {aiInsightsError && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px]">
            <span className="material-symbols-outlined text-[14px] shrink-0">info</span>
            <span>{aiInsightsError}</span>
          </div>
        )}

        {aiInsights && (
          <div className="rounded-xl bg-gradient-to-br from-blue-50/80 to-emerald-50/60 border border-blue-200/80 p-3 space-y-1.5 text-[11px] text-slate-800">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 font-extrabold text-[#1A73E8] uppercase tracking-wider text-[10px]">
                <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
                <span>AI Location & Map Guide</span>
              </span>
              {aiInsights.recommendedMapStyle !== mapStylePreset && (
                <button
                  type="button"
                  onClick={() => handleSelectPickerStyle(aiInsights.recommendedMapStyle)}
                  className="px-2 py-0.5 rounded-md bg-white border border-blue-200 text-[#1A73E8] font-bold text-[10px] cursor-pointer hover:bg-blue-50"
                >
                  Switch to {MAP_STYLE_PRESETS.find((p) => p.id === aiInsights.recommendedMapStyle)?.label} View
                </button>
              )}
            </div>
            {aiInsights.areaBrief && <p className="text-slate-700 leading-snug">{aiInsights.areaBrief}</p>}
            {aiInsights.dropTip && (
              <p className="text-slate-900 font-semibold leading-snug">
                <span className="text-emerald-800">Tip:</span> {aiInsights.dropTip}
              </p>
            )}
            {aiInsights.etaSummary && <p className="text-[10px] text-slate-600">{aiInsights.etaSummary}</p>}
          </div>
        )}

        {checkingService ? (
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <span className="material-symbols-outlined text-[15px] animate-spin text-emerald-700">progress_activity</span>
            <span>Checking 10 km hyperlocal serviceability...</span>
          </div>
        ) : serviceability ? (
          <div
            className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-semibold border ${
              serviceability.serviceable
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="material-symbols-outlined text-[16px] shrink-0">
                {serviceability.serviceable ? 'check_circle' : 'warning'}
              </span>
              <span className="truncate">{serviceability.message}</span>
            </div>
            {serviceability.serviceable && serviceability.estimatedEtaMins && (
              <span className="text-[10px] font-mono font-bold text-emerald-800 shrink-0 tabular-nums">
                ~{serviceability.estimatedEtaMins}m est.
              </span>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// 3. Real-Time Two-Way Live Delivery Tracking Map (MapLibre GL JS + OpenFreeMap + Socket.IO)
// ---------------------------------------------------------------------------
interface LiveTrackingMapProps {
  orderId?: string;
  assignmentId?: string;
  socketRole?: SocketTrackingRole;
  pickup?: Coords | null;
  dropoff?: Coords | null;
  farmName: string;
  dropoffLabel: string;
  stage?: TrackingStage;
  allowLiveLocationShare?: boolean;
  livePartnerPos?: Coords | null;
  lastLocationAt?: unknown;
  trackingCurrent?: OrderTrackingCurrentDoc | null;
  partnerName?: string;
  onPartnerCoordsUpdate?: (lat: number, lng: number) => void;
  onPartnerTelemetryUpdate?: (telemetry: PartnerGpsTelemetry) => void;
  onLiveStageChange?: (stage: SocketDeliveryStage) => void;
  onMarkMilestone?: (stage: 'NEAR_DESTINATION' | 'ARRIVED') => void;
  heightClass?: string;
}

const ROUTE_SOURCE_ID = 'zenvego-active-route';
const SECONDARY_ROUTE_SOURCE_ID = 'zenvego-secondary-leg';

export const LiveTrackingMap: React.FC<LiveTrackingMapProps> = ({
  orderId,
  assignmentId,
  socketRole,
  pickup,
  dropoff,
  farmName,
  dropoffLabel,
  stage = 'accepted',
  allowLiveLocationShare = false,
  livePartnerPos = null,
  lastLocationAt,
  trackingCurrent = null,
  partnerName,
  onPartnerCoordsUpdate,
  onPartnerTelemetryUpdate,
  onLiveStageChange,
  onMarkMilestone,
  heightClass = 'h-80 sm:h-96',
}) => {
  const isOnline = useOnlineStatus();
  const validPickup = isValidCoords(pickup) ? pickup : null;
  const validDropoff = isValidCoords(dropoff) ? dropoff : null;
  const validExternalPartner = isValidCoords(livePartnerPos) ? livePartnerPos : null;
  const validFirestoreTrackingPos =
    trackingCurrent && isValidCoords({ lat: trackingCurrent.lat, lng: trackingCurrent.lng })
      ? { lat: trackingCurrent.lat, lng: trackingCurrent.lng }
      : null;

  const resolvedRole: SocketTrackingRole = socketRole || (allowLiveLocationShare ? 'partner' : 'customer');
  const socketEnabled = Boolean(orderId && stage !== 'awaiting_dispatch');

  const socket = useOrderTrackingSocket({
    orderId: orderId || null,
    assignmentId: assignmentId || null,
    role: resolvedRole,
    enabled: socketEnabled,
  });

  const [terminalNote, setTerminalNote] = useState<string | null>(null);
  const [autoFollow, setAutoFollow] = useState<boolean>(true);
  const [milestoneBusy, setMilestoneBusy] = useState<boolean>(false);

  const [routeData, setRouteData] = useState<RouteResponse | null>(null);
  const [routeLoading, setRouteLoading] = useState<boolean>(false);
  const [routeError, setRouteError] = useState<{ message: string; straightLineKm?: number; rateLimited?: boolean } | null>(null);
  const [mapStylePreset, setMapStylePreset] = useState<MapStylePresetId>('bright');
  const [is3D, setIs3D] = useState<boolean>(false);
  const [aiInsights, setAiInsights] = useState<AiMapInsightsResponse | null>(null);
  const [aiInsightsBusy, setAiInsightsBusy] = useState<boolean>(false);
  const [aiInsightsError, setAiInsightsError] = useState<string | null>(null);
  const [mapLoading, setMapLoading] = useState<boolean>(true);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapRetryKey, setMapRetryKey] = useState<number>(0);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const styleLoadedRef = useRef<boolean>(false);
  const pickupMarkerRef = useRef<Marker | null>(null);
  const dropoffMarkerRef = useRef<Marker | null>(null);
  const partnerMarkerRef = useRef<Marker | null>(null);
  const viewerGpsMarkerRef = useRef<Marker | null>(null);
  const partnerHeadingElRef = useRef<HTMLDivElement | null>(null);

  const animatedPartnerPosRef = useRef<Coords | null>(null);
  const animatedHeadingRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);

  const lastRouteOriginRef = useRef<Coords | null>(null);
  const lastRouteDestRef = useRef<Coords | null>(null);
  const lastRouteFetchedAtRef = useRef<number>(0);
  const retryAfterMsRef = useRef<number>(0);
  const backoffAttemptRef = useRef<number>(0);
  const initialFitDoneRef = useRef<boolean>(false);
  const autoFollowRef = useRef<boolean>(autoFollow);
  autoFollowRef.current = autoFollow;
  const syncRouteLayersRef = useRef<() => void>(() => {});
  const fitMapToPointsRef = useRef<() => void>(() => {});

  const stageRef = useRef<TrackingStage>(stage);
  stageRef.current = stage;
  const socketRef = useRef(socket);
  socketRef.current = socket;
  const lastSocketEmitMsRef = useRef<number>(0);
  const lastFirestoreSyncMsRef = useRef<number>(0);
  const onPartnerCoordsUpdateRef = useRef(onPartnerCoordsUpdate);
  onPartnerCoordsUpdateRef.current = onPartnerCoordsUpdate;
  const onPartnerTelemetryUpdateRef = useRef(onPartnerTelemetryUpdate);
  onPartnerTelemetryUpdateRef.current = onPartnerTelemetryUpdate;
  const onLiveStageChangeRef = useRef(onLiveStageChange);
  onLiveStageChangeRef.current = onLiveStageChange;

  // Delivery Partner Live GPS Watch (useLiveLocation -> Socket.IO + Firestore)
  const handlePartnerGpsFix = useCallback((fix: LiveLocationFix, meta: { immediate: boolean }) => {
    const nowMs = Date.now();
    const activeSocketStage = mapStageToSocketStage(stageRef.current);

    // 1. Real-time Socket.IO stream (throttled ~2s to stay well inside server 1.5s guard)
    if (meta.immediate || nowMs - lastSocketEmitMsRef.current >= 2_000) {
      lastSocketEmitMsRef.current = nowMs;
      void socketRef.current.emitLocation({
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracy: fix.accuracy ?? 0,
        heading: fix.heading,
        speed: fix.speed,
        timestamp: fix.isoTimestamp,
        deliveryStage: activeSocketStage,
      });
    }

    // 2. Durable Firestore persistence (throttled ~6s)
    if (meta.immediate || nowMs - lastFirestoreSyncMsRef.current >= 6_000) {
      lastFirestoreSyncMsRef.current = nowMs;
      onPartnerCoordsUpdateRef.current?.(fix.latitude, fix.longitude);
      onPartnerTelemetryUpdateRef.current?.({
        lat: fix.latitude,
        lng: fix.longitude,
        accuracy: fix.accuracy ?? 0,
        heading: fix.heading,
        speed: fix.speed,
        timestamp: fix.isoTimestamp,
        stage: activeSocketStage,
      });
    }
  }, []);

  const handlePartnerPermissionDenied = useCallback(() => {
    if (allowLiveLocationShare) {
      void socketRef.current.emitStop();
    }
  }, [allowLiveLocationShare]);

  const partnerLiveLoc = useLiveLocation({
    enableHighAccuracy: true,
    timeoutMs: 12_000,
    maximumAgeMs: 0,
    minAccuracyThresholdM: 20,
    onFix: handlePartnerGpsFix,
    onPermissionDenied: handlePartnerPermissionDenied,
  });

  // Viewer / Customer "My Location" blue-dot GPS fix powered by useLiveLocation
  const handleViewerGpsFix = useCallback((fix: LiveLocationFix) => {
    setAutoFollow(false);
    mapRef.current?.flyTo({
      center: [fix.lng, fix.lat],
      zoom: Math.max(mapRef.current.getZoom(), 15),
      duration: 500,
    });
  }, []);

  const viewerLiveLoc = useLiveLocation({
    enableHighAccuracy: true,
    timeoutMs: 12_000,
    maximumAgeMs: 0,
    minAccuracyThresholdM: 20,
    onFix: handleViewerGpsFix,
  });

  // Propagate live Socket.IO stage changes to parent screens (e.g., Customer 8-step bar)
  useEffect(() => {
    if (socket.liveStage) {
      onLiveStageChangeRef.current?.(socket.liveStage);
    }
  }, [socket.liveStage]);

  // Select the freshest verified partner position across local GPS, Socket.IO, Firestore tracking/current, and delivery_assignments
  const freshestPartnerTelemetry = useMemo(() => {
    const candidates: Array<{
      coords: Coords;
      tsMs: number;
      accuracy: number | null;
      heading: number | null;
      speed: number | null;
      source: 'local_gps' | 'socket' | 'firestore_tracking' | 'firestore_assignment';
    }> = [];

    if (partnerLiveLoc.location) {
      candidates.push({
        coords: { lat: partnerLiveLoc.location.latitude, lng: partnerLiveLoc.location.longitude },
        tsMs: partnerLiveLoc.location.timestampMs,
        accuracy: partnerLiveLoc.location.accuracy,
        heading: partnerLiveLoc.location.heading,
        speed: partnerLiveLoc.location.speed,
        source: 'local_gps',
      });
    }
    if (
      socket.liveLocation &&
      isValidCoords({ lat: socket.liveLocation.latitude, lng: socket.liveLocation.longitude })
    ) {
      candidates.push({
        coords: { lat: socket.liveLocation.latitude, lng: socket.liveLocation.longitude },
        tsMs: parseTimestampMs(socket.liveLocation.timestamp) || Date.now(),
        accuracy: socket.liveLocation.accuracy ?? null,
        heading: socket.liveLocation.heading ?? null,
        speed: socket.liveLocation.speed ?? null,
        source: 'socket',
      });
    }
    if (validFirestoreTrackingPos && trackingCurrent) {
      candidates.push({
        coords: validFirestoreTrackingPos,
        tsMs: parseTimestampMs(trackingCurrent.lastUpdatedAt),
        accuracy: trackingCurrent.accuracy ?? null,
        heading: trackingCurrent.heading ?? null,
        speed: trackingCurrent.speed ?? null,
        source: 'firestore_tracking',
      });
    }
    if (validExternalPartner) {
      candidates.push({
        coords: validExternalPartner,
        tsMs: parseTimestampMs(lastLocationAt),
        accuracy: null,
        heading: null,
        speed: null,
        source: 'firestore_assignment',
      });
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.tsMs - a.tsMs);
    return candidates[0];
  }, [partnerLiveLoc.location, socket.liveLocation, validFirestoreTrackingPos, trackingCurrent, validExternalPartner, lastLocationAt]);

  const effectivePartnerPos = freshestPartnerTelemetry?.coords || null;
  const effectiveAccuracy = freshestPartnerTelemetry?.accuracy ?? null;
  const effectiveHeading = freshestPartnerTelemetry?.heading ?? null;
  const effectiveSpeedMps = freshestPartnerTelemetry?.speed ?? null;
  const effectiveLastTs = freshestPartnerTelemetry?.tsMs || lastLocationAt;

  const isOrderTerminal = stage === 'delivered' || socket.trackingEnded;

  // Periodic tick every 5s so "Updated Xs ago" stays fresh
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, []);

  // Compute route endpoints based on active stage
  const routeEndpoints = useMemo<{
    origin: Coords | null;
    destination: Coords | null;
    stageLabel: string;
    destinationTitle: string;
    secondaryLeg: [Coords, Coords] | null;
  }>(() => {
    if (isOrderTerminal) {
      return {
        origin: validPickup,
        destination: validDropoff,
        stageLabel: socket.endedReason === 'CANCELLED' ? 'Order Cancelled' : 'Delivered',
        destinationTitle: dropoffLabel,
        secondaryLeg: null,
      };
    }
    if (socket.liveStage === 'ARRIVED') {
      return {
        origin: effectivePartnerPos || validPickup,
        destination: validDropoff,
        stageLabel: 'Arrived at Destination',
        destinationTitle: dropoffLabel,
        secondaryLeg: null,
      };
    }
    if (socket.liveStage === 'NEAR_DESTINATION') {
      return {
        origin: effectivePartnerPos || validPickup,
        destination: validDropoff,
        stageLabel: 'Near Destination',
        destinationTitle: dropoffLabel,
        secondaryLeg: null,
      };
    }
    if (stage === 'accepted' && effectivePartnerPos && validPickup) {
      return {
        origin: effectivePartnerPos,
        destination: validPickup,
        stageLabel: 'Partner Heading to Pickup',
        destinationTitle: farmName,
        secondaryLeg: validDropoff ? [validPickup, validDropoff] : null,
      };
    }
    if (stage === 'picked_up' && effectivePartnerPos && validDropoff) {
      return {
        origin: effectivePartnerPos,
        destination: validDropoff,
        stageLabel: 'Out for Delivery',
        destinationTitle: dropoffLabel,
        secondaryLeg: null,
      };
    }
    if (validPickup && validDropoff) {
      return {
        origin: effectivePartnerPos || validPickup,
        destination: validDropoff,
        stageLabel:
          stage === 'accepted'
            ? 'Partner Assigned'
            : stage === 'picked_up'
              ? 'Out for Delivery'
              : 'Pickup to Doorstep Route',
        destinationTitle: dropoffLabel,
        secondaryLeg: null,
      };
    }
    return {
      origin: null,
      destination: null,
      stageLabel: 'Awaiting Route Coordinates',
      destinationTitle: dropoffLabel,
      secondaryLeg: null,
    };
  }, [isOrderTerminal, socket.endedReason, socket.liveStage, stage, effectivePartnerPos, validPickup, validDropoff, farmName, dropoffLabel]);

  // Direct Haversine straight-line distance (explicitly separated from OSRM road distance)
  const straightLineKm = useMemo(() => {
    if (!routeEndpoints.origin || !routeEndpoints.destination) return null;
    return (
      Math.round(
        haversineKm(
          routeEndpoints.origin.lat,
          routeEndpoints.origin.lng,
          routeEndpoints.destination.lat,
          routeEndpoints.destination.lng
        ) * 100
      ) / 100
    );
  }, [routeEndpoints.origin, routeEndpoints.destination]);

  const fitMapToPoints = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const pts: [number, number][] = [];
    if (validPickup) pts.push([validPickup.lng, validPickup.lat]);
    if (validDropoff) pts.push([validDropoff.lng, validDropoff.lat]);
    if (effectivePartnerPos) pts.push([effectivePartnerPos.lng, effectivePartnerPos.lat]);
    if (routeData?.geometry?.coordinates?.length) {
      for (const c of routeData.geometry.coordinates) pts.push(c);
    }
    if (pts.length === 0) return;
    if (pts.length === 1) {
      map.flyTo({ center: pts[0], zoom: 15, duration: 450 });
      return;
    }
    let minLng = pts[0][0];
    let maxLng = pts[0][0];
    let minLat = pts[0][1];
    let maxLat = pts[0][1];
    for (const [lng, lat] of pts) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    const bounds: LngLatBoundsLike = [
      [minLng, minLat],
      [maxLng, maxLat],
    ];
    map.fitBounds(bounds, { padding: { top: 64, bottom: 72, left: 42, right: 42 }, maxZoom: 15.8, duration: 550 });
  }, [validPickup, validDropoff, effectivePartnerPos, routeData]);

  const syncRouteLayers = useCallback(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;

    const primaryGeoJson = routeData?.geometry?.coordinates?.length
      ? {
          type: 'FeatureCollection' as const,
          features: [
            {
              type: 'Feature' as const,
              properties: {},
              geometry: routeData.geometry,
            },
          ],
        }
      : { type: 'FeatureCollection' as const, features: [] };

    const primarySrc = map.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined;
    if (primarySrc) {
      primarySrc.setData(primaryGeoJson);
    }

    const secondaryGeoJson = routeEndpoints.secondaryLeg
      ? {
          type: 'FeatureCollection' as const,
          features: [
            {
              type: 'Feature' as const,
              properties: {},
              geometry: {
                type: 'LineString' as const,
                coordinates: [
                  [routeEndpoints.secondaryLeg[0].lng, routeEndpoints.secondaryLeg[0].lat],
                  [routeEndpoints.secondaryLeg[1].lng, routeEndpoints.secondaryLeg[1].lat],
                ],
              },
            },
          ],
        }
      : { type: 'FeatureCollection' as const, features: [] };

    const secondarySrc = map.getSource(SECONDARY_ROUTE_SOURCE_ID) as GeoJSONSource | undefined;
    if (secondarySrc) {
      secondarySrc.setData(secondaryGeoJson);
    }
  }, [routeData, routeEndpoints.secondaryLeg]);

  syncRouteLayersRef.current = syncRouteLayers;
  fitMapToPointsRef.current = fitMapToPoints;

  // Initialize MapLibre GL JS with free Google-Maps-like OpenFreeMap vector style
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    setMapError(null);
    setMapLoading(true);
    styleLoadedRef.current = false;
    initialFitDoneRef.current = false;

    const initialCenter = effectivePartnerPos || validPickup || validDropoff || BENGALURU_VIEWPORT_CENTER;

    let map: MapLibreMap;
    try {
      ensureMapLibreWorkerConfigured();
      map = new maplibregl.Map({
        container,
        style: getMapStyleUrlForPreset(mapStylePreset),
        center: [initialCenter.lng, initialCenter.lat],
        zoom: 14,
        pitch: is3D ? 52 : 0,
        attributionControl: false,
      });
    } catch (err) {
      setMapLoading(false);
      setMapError(formatMapLibreError(err));
      return;
    }

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');

    // Pause auto-follow if the user manually drags the map
    map.on('dragstart', () => {
      if (autoFollowRef.current) {
        setAutoFollow(false);
      }
    });

    map.on('style.load', () => {
      styleLoadedRef.current = true;

      if (!map.getSource(SECONDARY_ROUTE_SOURCE_ID)) {
        map.addSource(SECONDARY_ROUTE_SOURCE_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: 'zenvego-secondary-leg-line',
          type: 'line',
          source: SECONDARY_ROUTE_SOURCE_ID,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': MAP_THEME.routeSecondary,
            'line-width': 3,
            'line-dasharray': [2, 2.5],
            'line-opacity': 0.65,
          },
        });
      }

      if (!map.getSource(ROUTE_SOURCE_ID)) {
        map.addSource(ROUTE_SOURCE_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: 'zenvego-route-glow',
          type: 'line',
          source: ROUTE_SOURCE_ID,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': MAP_THEME.routePrimary,
            'line-width': 12,
            'line-blur': 5,
            'line-opacity': 0.22,
          },
        });
        map.addLayer({
          id: 'zenvego-route-casing',
          type: 'line',
          source: ROUTE_SOURCE_ID,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': MAP_THEME.routeCasing,
            'line-width': 7.5,
            'line-opacity': 0.96,
          },
        });
        map.addLayer({
          id: 'zenvego-route-line',
          type: 'line',
          source: ROUTE_SOURCE_ID,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': MAP_THEME.routePrimary,
            'line-width': 4.5,
            'line-opacity': 1,
          },
        });
      }

      syncRouteLayersRef.current();
      if (!initialFitDoneRef.current) {
        fitMapToPointsRef.current();
        initialFitDoneRef.current = true;
      }
      setMapLoading(false);
    });

    map.on('load', () => {
      setMapLoading(false);
      setMapError(null);
      map.resize();
    });

    map.on('error', (evt) => {
      const errObj = evt?.error;
      if (!errObj) return;
      const msg = errObj instanceof Error ? errObj.message : String(errObj);
      if (/worker/i.test(msg) || !map.isStyleLoaded()) {
        setMapLoading(false);
        setMapError(formatMapLibreError(errObj));
      }
    });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        map.resize();
      });
      resizeObserver.observe(container);
    }

    return () => {
      resizeObserver?.disconnect();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      pickupMarkerRef.current?.remove();
      dropoffMarkerRef.current?.remove();
      partnerMarkerRef.current?.remove();
      viewerGpsMarkerRef.current?.remove();
      pickupMarkerRef.current = null;
      dropoffMarkerRef.current = null;
      partnerMarkerRef.current = null;
      viewerGpsMarkerRef.current = null;
      partnerHeadingElRef.current = null;
      map.remove();
      mapRef.current = null;
      styleLoadedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRetryKey]);

  const handleSelectTrackingStyle = useCallback((next: MapStylePresetId) => {
    setMapStylePreset(next);
    const map = mapRef.current;
    if (map) {
      styleLoadedRef.current = false;
      setMapLoading(true);
      setMapError(null);
      map.setStyle(getMapStyleUrlForPreset(next));
    }
  }, []);

  const handleToggleTracking3D = useCallback(() => {
    setIs3D((prev) => {
      const next = !prev;
      const map = mapRef.current;
      if (map) {
        map.easeTo({ pitch: next ? 52 : 0, bearing: next ? -15 : 0, duration: 500 });
      }
      return next;
    });
  }, []);

  // Sync viewer/customer live GPS blue dot on tracking map
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!viewerLiveLoc.coords) {
      viewerGpsMarkerRef.current?.remove();
      viewerGpsMarkerRef.current = null;
      return;
    }
    if (!viewerGpsMarkerRef.current) {
      viewerGpsMarkerRef.current = new maplibregl.Marker({ element: createBlueGpsDotElement(), anchor: 'center' })
        .setLngLat([viewerLiveLoc.coords.lng, viewerLiveLoc.coords.lat])
        .addTo(map);
    } else {
      viewerGpsMarkerRef.current.setLngLat([viewerLiveLoc.coords.lng, viewerLiveLoc.coords.lat]);
    }
  }, [viewerLiveLoc.coords, mapRetryKey]);

  // Pickup & Destination Markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (validPickup) {
      if (!pickupMarkerRef.current) {
        const el = document.createElement('div');
        el.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;" title="${farmName.replace(/"/g, '&quot;')}">
            <div style="padding:2px 7px;border-radius:6px;background:#FFFFFF;border:1px solid #F59E0B;color:#92400E;font-size:10px;font-weight:800;margin-bottom:3px;white-space:nowrap;box-shadow:0 2px 8px rgba(15,23,42,0.16);">
              PICKUP
            </div>
            <div style="width:30px;height:30px;border-radius:9999px;background:#D97706;border:2.5px solid #FFFFFF;box-shadow:0 3px 10px rgba(217,119,6,0.42);display:flex;align-items:center;justify-content:center;color:#FFFFFF;">
              <span class="material-symbols-outlined" style="font-size:17px;">storefront</span>
            </div>
          </div>
        `;
        pickupMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([validPickup.lng, validPickup.lat])
          .addTo(map);
      } else {
        pickupMarkerRef.current.setLngLat([validPickup.lng, validPickup.lat]);
      }
    } else if (pickupMarkerRef.current) {
      pickupMarkerRef.current.remove();
      pickupMarkerRef.current = null;
    }

    if (validDropoff) {
      if (!dropoffMarkerRef.current) {
        const el = document.createElement('div');
        el.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;" title="${dropoffLabel.replace(/"/g, '&quot;')}">
            <div style="padding:2px 7px;border-radius:6px;background:#FFFFFF;border:1px solid #059669;color:#065F46;font-size:10px;font-weight:800;margin-bottom:3px;white-space:nowrap;box-shadow:0 2px 8px rgba(15,23,42,0.16);">
              DROP-OFF
            </div>
            <div style="width:30px;height:30px;border-radius:9999px;background:#059669;border:2.5px solid #FFFFFF;box-shadow:0 3px 10px rgba(5,150,105,0.42);display:flex;align-items:center;justify-content:center;color:#FFFFFF;">
              <span class="material-symbols-outlined" style="font-size:17px;">home</span>
            </div>
          </div>
        `;
        dropoffMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([validDropoff.lng, validDropoff.lat])
          .addTo(map);
      } else {
        dropoffMarkerRef.current.setLngLat([validDropoff.lng, validDropoff.lat]);
      }
    } else if (dropoffMarkerRef.current) {
      dropoffMarkerRef.current.remove();
      dropoffMarkerRef.current = null;
    }
  }, [validPickup, validDropoff, farmName, dropoffLabel, mapRetryKey]);

  // Custom EV Delivery Scooter Marker with Smooth Interpolation & Auto-Follow Camera
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!effectivePartnerPos) {
      partnerMarkerRef.current?.remove();
      partnerMarkerRef.current = null;
      partnerHeadingElRef.current = null;
      animatedPartnerPosRef.current = null;
      return;
    }

    if (!partnerMarkerRef.current) {
      const wrapper = document.createElement('div');
      wrapper.style.display = 'flex';
      wrapper.style.flexDirection = 'column';
      wrapper.style.alignItems = 'center';

      const beaconWrap = document.createElement('div');
      beaconWrap.style.cssText = 'position:relative;width:44px;height:44px;display:flex;align-items:center;justify-content:center;';

      // Directional heading ring
      const headingRing = document.createElement('div');
      headingRing.style.cssText =
        'position:absolute;inset:0;display:flex;align-items:flex-start;justify-content:center;transition:transform 150ms linear;';
      headingRing.innerHTML = `<div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:8px solid #003820;margin-top:-4px;"></div>`;
      beaconWrap.appendChild(headingRing);

      // EV Scooter Badge
      const scooterBadge = document.createElement('div');
      scooterBadge.style.cssText =
        'width:38px;height:38px;border-radius:9999px;background:#003820;border:2.5px solid #FFFFFF;box-shadow:0 0 0 5px rgba(5,150,105,0.22),0 6px 16px rgba(0,56,32,0.38);display:flex;align-items:center;justify-content:center;';
      scooterBadge.innerHTML = `
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M19 7C19 5.9 18.1 5 17 5H14V7H17V9.65L13.52 14H10V9H6C3.79 9 2 10.79 2 13V16H4C4 17.66 5.34 19 7 19C8.66 19 10 17.66 10 16H14.48L19 10.35V7ZM7 17C6.45 17 6 16.55 6 16H8C8 16.55 7.55 17 7 17Z" fill="#8AF6A4"/>
          <path d="M5 6H10V8H5V6Z" fill="#FFFFFF"/>
          <path d="M19 13C17.34 13 16 14.34 16 16C16 17.66 17.34 19 19 19C20.66 19 22 17.66 22 16C22 14.34 20.66 13 19 13ZM19 17C18.45 17 18 16.55 18 16C18 15.45 18.45 15 19 15C19.55 15 20 15.45 20 16C20 16.55 19.55 17 19 17Z" fill="#8AF6A4"/>
        </svg>
      `;
      beaconWrap.appendChild(scooterBadge);
      wrapper.appendChild(beaconWrap);

      const tag = document.createElement('div');
      tag.textContent = partnerName ? `EV · ${partnerName.split(' ')[0]}` : 'EV SCOOTER';
      tag.style.cssText =
        'margin-top:2px;padding:1px 7px;border-radius:6px;background:#003820;border:1px solid #FFFFFF;color:#FFFFFF;font-size:9px;font-weight:800;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.2);';
      wrapper.appendChild(tag);

      partnerHeadingElRef.current = headingRing;
      animatedPartnerPosRef.current = effectivePartnerPos;
      if (effectiveHeading !== null) {
        animatedHeadingRef.current = effectiveHeading;
        headingRing.style.transform = `rotate(${Math.round(effectiveHeading)}deg)`;
      }
      partnerMarkerRef.current = new maplibregl.Marker({ element: wrapper, anchor: 'center' })
        .setLngLat([effectivePartnerPos.lng, effectivePartnerPos.lat])
        .addTo(map);
      return;
    }

    const fromPos = animatedPartnerPosRef.current || effectivePartnerPos;
    const fromHeading = animatedHeadingRef.current;
    const computedBearing = computeBearingDeg(fromPos, effectivePartnerPos, 2.5);
    const targetHeading =
      effectiveHeading !== null
        ? effectiveHeading
        : computedBearing !== null
          ? computedBearing
          : fromHeading;

    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    const startTime = performance.now();
    const durationMs = 750;

    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const nextPos = interpolateCoords(fromPos, effectivePartnerPos, eased);
      const nextHeading = interpolateAngleDeg(fromHeading, targetHeading, eased);

      animatedPartnerPosRef.current = nextPos;
      animatedHeadingRef.current = nextHeading;
      partnerMarkerRef.current?.setLngLat([nextPos.lng, nextPos.lat]);
      if (partnerHeadingElRef.current) {
        partnerHeadingElRef.current.style.transform = `rotate(${Math.round(nextHeading)}deg)`;
      }

      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(step);
      }
    };

    animFrameRef.current = requestAnimationFrame(step);

    // Automatic map camera tracking when Auto-Follow is enabled
    if (autoFollowRef.current && initialFitDoneRef.current) {
      map.easeTo({
        center: [effectivePartnerPos.lng, effectivePartnerPos.lat],
        duration: 750,
      });
    }
  }, [effectivePartnerPos, effectiveHeading, partnerName, mapRetryKey]);

  useEffect(() => {
    syncRouteLayers();
    if (routeData && !initialFitDoneRef.current) {
      fitMapToPointsRef.current();
      initialFitDoneRef.current = true;
    }
  }, [routeData, syncRouteLayers]);

  // Distance-gated, time-throttled OSRM road route request
  const fetchRoadRoute = useCallback(
    async (force = false) => {
      const { origin, destination } = routeEndpoints;
      if (!origin || !destination) return;
      if (!isOnline) {
        setRouteError({
          message: 'Offline — road route will refresh when your connection returns.',
          straightLineKm: Math.round(haversineKm(origin.lat, origin.lng, destination.lat, destination.lng) * 100) / 100,
        });
        return;
      }

      const now = Date.now();
      if (!force && now < retryAfterMsRef.current) return;
      if (
        !force &&
        !shouldRefreshRoute({
          lastOrigin: lastRouteOriginRef.current,
          nextOrigin: origin,
          lastDest: lastRouteDestRef.current,
          nextDest: destination,
          lastFetchedAtMs: lastRouteFetchedAtRef.current,
          nowMs: now,
        })
      ) {
        return;
      }

      setRouteLoading(true);
      setRouteError(null);
      try {
        const res = await zenvegoApi.computeRoute(origin, destination);
        setRouteData(res);
        lastRouteOriginRef.current = origin;
        lastRouteDestRef.current = destination;
        lastRouteFetchedAtRef.current = Date.now();
        backoffAttemptRef.current = 0;
        retryAfterMsRef.current = 0;
      } catch (err) {
        const straight =
          Math.round(haversineKm(origin.lat, origin.lng, destination.lat, destination.lng) * 100) / 100;
        backoffAttemptRef.current = Math.min(4, backoffAttemptRef.current + 1);
        const backoffMs = Math.min(ROUTE_REFRESH_POLICY.MAX_BACKOFF_MS, 5_000 * 2 ** backoffAttemptRef.current);
        retryAfterMsRef.current = Date.now() + backoffMs;

        if (err instanceof ApiError && err.status === 429) {
          setRouteError({
            message: 'Routing service rate-limited. Showing straight-line distance until retry.',
            straightLineKm: straight,
            rateLimited: true,
          });
        } else if (err instanceof ApiError && err.status === 404) {
          setRouteError({
            message: 'No drivable road route found between these coordinates.',
            straightLineKm: straight,
          });
        } else {
          setRouteError({
            message: err instanceof Error ? err.message : 'Unable to compute road route right now.',
            straightLineKm: straight,
          });
        }
      } finally {
        setRouteLoading(false);
      }
    },
    [routeEndpoints, isOnline]
  );

  useEffect(() => {
    void fetchRoadRoute(false);
  }, [fetchRoadRoute]);

  const stopPartnerWatching = partnerLiveLoc.stopWatching;

  // Stop Delivery Partner Live GPS Sharing via useLiveLocation
  const stopLiveGps = useCallback(
    (notifySocket = true) => {
      stopPartnerWatching();
      if (notifySocket && allowLiveLocationShare) {
        void socketRef.current.emitStop();
      }
    },
    [allowLiveLocationShare, stopPartnerWatching]
  );

  // Stop sharing immediately when order completes or is cancelled
  useEffect(() => {
    if (isOrderTerminal && partnerLiveLoc.isWatching) {
      stopLiveGps(false);
      if (stage === 'delivered') {
        void socketRef.current.emitStatus('DELIVERED');
      }
    }
  }, [isOrderTerminal, partnerLiveLoc.isWatching, stage, stopLiveGps]);

  const handleLocateViewerClick = () => {
    viewerLiveLoc.requestSingleFix({ silentOnError: false });
  };

  const handleFetchTrackingAiInsights = async () => {
    const refCoord = effectivePartnerPos || validDropoff || validPickup;
    if (!refCoord) return;
    setAiInsightsBusy(true);
    setAiInsightsError(null);
    try {
      const res = await zenvegoApi.aiMapInsights({
        mode: 'delivery',
        address: dropoffLabel,
        lat: refCoord.lat,
        lng: refCoord.lng,
        farmName,
        dropoffLabel,
        distanceKm: routeData?.distanceKm ?? straightLineKm ?? null,
        durationMins: routeData?.durationMins ?? null,
        stage: routeEndpoints.stageLabel,
        localHour: new Date().getHours(),
      });
      setAiInsights(res);
    } catch (err) {
      setAiInsightsError(err instanceof Error ? err.message : 'Unable to fetch AI route brief right now.');
    } finally {
      setAiInsightsBusy(false);
    }
  };

  const toggleLiveShare = () => {
    setTerminalNote(null);
    if (partnerLiveLoc.isWatching) {
      stopLiveGps(true);
      partnerLiveLoc.clearError();
      return;
    }

    if (isOrderTerminal) {
      setTerminalNote('This delivery has ended. GPS sharing is disabled.');
      return;
    }

    partnerLiveLoc.startWatching();
  };

  const handleMilestoneClick = async (milestone: 'NEAR_DESTINATION' | 'ARRIVED') => {
    setMilestoneBusy(true);
    try {
      await socket.emitStatus(milestone);
      onMarkMilestone?.(milestone);
    } finally {
      setMilestoneBusy(false);
    }
  };

  const freshness = useMemo(() => getLocationFreshness(effectiveLastTs, nowTick), [effectiveLastTs, nowTick]);
  const gpsAccuracyInfo = effectiveAccuracy !== null ? classifyGpsAccuracy(effectiveAccuracy) : null;
  const speedKmh = effectiveSpeedMps !== null ? Math.round(effectiveSpeedMps * 3.6) : null;

  const socketBadge = useMemo(() => {
    if (!socketEnabled) return { label: 'Awaiting Dispatch', tone: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' };
    if (isOrderTerminal) return { label: 'Tracking Ended', tone: 'bg-slate-100 text-slate-700 border-slate-200', dot: 'bg-slate-500' };
    if (socket.connectionState === 'connected' && socket.joined) {
      return { label: 'Live Socket', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500 animate-pulse' };
    }
    if (socket.connectionState === 'reconnecting' || socket.connectionState === 'connecting') {
      return { label: 'Reconnecting...', tone: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500 animate-pulse' };
    }
    return { label: 'Socket Offline', tone: 'bg-red-50 text-red-800 border-red-200', dot: 'bg-red-500' };
  }, [socketEnabled, isOrderTerminal, socket.connectionState, socket.joined]);

  return (
    <div className="rounded-2xl overflow-hidden bg-white border border-slate-200 shadow-xs text-slate-900">
      {/* Interactive OpenFreeMap Liberty Viewport */}
      <div className={`relative w-full ${heightClass} bg-[#F4F7F5] zenvego-maplibre`}>
        <div ref={mapContainerRef} className="w-full h-full" />

        {/* Top-left Compact Status Strip + Google-Maps-Style Floating ETA Callout */}
        <div className="pointer-events-none absolute top-3 left-3 right-14 z-10 flex flex-wrap items-center gap-1.5">
          <div className="pointer-events-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/95 backdrop-blur-xs border border-slate-200 shadow-sm text-[11px] font-extrabold text-slate-900">
            <span
              className={`w-2 h-2 rounded-full ${
                isOrderTerminal
                  ? 'bg-emerald-600'
                  : stage === 'picked_up'
                    ? 'bg-emerald-500 animate-pulse'
                    : 'bg-amber-500 animate-pulse'
              }`}
            />
            <span>{routeEndpoints.stageLabel}</span>
          </div>

          {routeData && !isOrderTerminal && (
            <div className="pointer-events-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#1A73E8] text-white shadow-sm text-[11px] font-extrabold tabular-nums">
              <span className="material-symbols-outlined text-[14px]">directions</span>
              <span>{routeData.durationMins} min</span>
              <span className="opacity-75">·</span>
              <span>{routeData.distanceKm} km</span>
            </div>
          )}

          <div
            className={`pointer-events-auto inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[10px] font-bold shadow-xs ${socketBadge.tone}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${socketBadge.dot}`} />
            <span>{socketBadge.label}</span>
          </div>

          {!isOnline && (
            <div className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-red-50 border border-red-200 text-red-800 text-[10px] font-bold shadow-xs">
              <span className="material-symbols-outlined text-[13px]">wifi_off</span>
              <span>Offline</span>
            </div>
          )}
        </div>

        {/* Bottom-left Google-Maps-Style Layers + 3D Control */}
        <div className="absolute bottom-8 left-3 z-10">
          <MapLayersControl
            stylePreset={mapStylePreset}
            onSelectPreset={handleSelectTrackingStyle}
            is3D={is3D}
            onToggle3D={handleToggleTracking3D}
            compact
          />
        </div>

        {/* Bottom-right Camera Controls: My Location Blue Dot, Auto-Follow EV & Fit Route */}
        <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleLocateViewerClick}
            disabled={viewerLiveLoc.isLocating}
            title="Show my live GPS position on map"
            aria-label="Show my live GPS position"
            className={`w-8 h-8 rounded-full border shadow-md flex items-center justify-center cursor-pointer transition-colors ${
              viewerLiveLoc.coords
                ? 'bg-[#1A73E8] border-[#1A73E8] text-white'
                : 'bg-white/95 border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span className={`material-symbols-outlined text-[16px] ${viewerLiveLoc.isLocating ? 'animate-spin' : ''}`}>
              {viewerLiveLoc.isLocating ? 'progress_activity' : 'my_location'}
            </span>
          </button>

          {effectivePartnerPos && !isOrderTerminal && (
            <button
              type="button"
              onClick={() => {
                const next = !autoFollow;
                setAutoFollow(next);
                if (next && mapRef.current) {
                  mapRef.current.flyTo({
                    center: [effectivePartnerPos.lng, effectivePartnerPos.lat],
                    zoom: Math.max(mapRef.current.getZoom(), 15),
                    duration: 500,
                  });
                }
              }}
              title={autoFollow ? 'Auto-following EV scooter' : 'Resume following EV scooter'}
              className={`h-8 px-2.5 rounded-lg border text-[11px] font-bold flex items-center gap-1 shadow-xs cursor-pointer transition-colors ${
                autoFollow
                  ? 'bg-[#003820] border-[#003820] text-white'
                  : 'bg-white/95 border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span className="material-symbols-outlined text-[15px]">
                {autoFollow ? 'gps_fixed' : 'gps_not_fixed'}
              </span>
              <span className="hidden sm:inline">{autoFollow ? 'Following EV' : 'Follow EV'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setAutoFollow(false);
              fitMapToPoints();
            }}
            title="Fit full route"
            aria-label="Fit full route on map"
            className="h-8 px-2.5 rounded-lg bg-white/95 hover:bg-slate-50 border border-slate-200 text-slate-800 text-[11px] font-bold flex items-center gap-1 shadow-xs cursor-pointer"
          >
            <span className="material-symbols-outlined text-[15px] text-emerald-700">fit_screen</span>
            <span className="hidden sm:inline">Fit Route</span>
          </button>
        </div>

        {/* Bottom-left OSM + OpenFreeMap Attribution */}
        <div className="pointer-events-none absolute bottom-2 left-2 z-10 px-2 py-0.5 rounded bg-white/90 border border-slate-200/80 text-[9px] text-slate-600">
          {routeData?.attribution || MAP_ATTRIBUTION}
        </div>

        {mapLoading && !mapError && (
          <div className="pointer-events-none absolute inset-0 z-15 flex flex-col items-center justify-center bg-[#F4F7F5]/85 backdrop-blur-[1px] gap-2">
            <span className="material-symbols-outlined text-2xl text-[#003820] animate-spin">progress_activity</span>
            <p className="text-[11px] font-bold text-slate-700">Loading live tracking map...</p>
          </div>
        )}

        {mapError && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-white/95 p-5 text-center gap-3">
            <span className="material-symbols-outlined text-3xl text-amber-600">map</span>
            <p className="text-xs font-semibold text-slate-700 max-w-xs">{mapError}</p>
            <button
              type="button"
              onClick={() => setMapRetryKey((k) => k + 1)}
              className="px-4 py-2 rounded-xl bg-[#003820] text-white text-xs font-extrabold cursor-pointer"
            >
              Retry Map Load
            </button>
          </div>
        )}
      </div>

      {/* Clean Mobile-First Telemetry & Control Deck */}
      <div className="p-3.5 sm:p-4 bg-white border-t border-slate-200 space-y-3">
        {/* Metrics Row: ETA, Actual Road Distance (OSRM), Straight-Line Distance (Haversine) */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid grid-cols-3 gap-2.5 sm:gap-4 flex-1 min-w-[220px]">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Est. Arrival</p>
              <p className="text-lg sm:text-xl font-extrabold text-[#003820] tabular-nums leading-tight mt-0.5">
                {routeLoading && !routeData
                  ? '...'
                  : routeData
                    ? `${routeData.durationMins} min`
                    : '—'}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Road Distance</p>
              <p className="text-base sm:text-lg font-extrabold text-slate-900 tabular-nums leading-tight mt-0.5">
                {routeData ? `${routeData.distanceKm} km` : '—'}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Direct Line</p>
              <p className="text-base sm:text-lg font-bold text-slate-600 tabular-nums leading-tight mt-0.5">
                {straightLineKm !== null ? `${straightLineKm} km` : '—'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleFetchTrackingAiInsights()}
              disabled={aiInsightsBusy}
              className="h-9 px-3 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-200 text-[#1A73E8] text-xs font-extrabold flex items-center gap-1 cursor-pointer disabled:opacity-60"
            >
              <span className={`material-symbols-outlined text-[15px] ${aiInsightsBusy ? 'animate-spin' : ''}`}>
                {aiInsightsBusy ? 'progress_activity' : 'auto_awesome'}
              </span>
              <span>{aiInsightsBusy ? 'Analyzing...' : 'AI Route Brief'}</span>
            </button>

            {routeError && (
              <button
                type="button"
                onClick={() => void fetchRoadRoute(true)}
                className="h-9 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-800 flex items-center gap-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[15px]">refresh</span>
                <span>Retry Route</span>
              </button>
            )}

            {allowLiveLocationShare && !isOrderTerminal && (
              <button
                type="button"
                onClick={toggleLiveShare}
                className={`h-9 px-3.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 cursor-pointer transition-colors ${
                  partnerLiveLoc.isWatching
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'bg-[#1A73E8] text-white hover:bg-[#1557B0]'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">
                  {partnerLiveLoc.isWatching ? 'sensors' : 'my_location'}
                </span>
                <span>{partnerLiveLoc.isWatching ? 'GPS Active · Stop' : 'Share Live GPS'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Route ETA Disclaimer + Live GPS Freshness, Accuracy, Heading & Speed */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 pt-1 border-t border-slate-100">
          <span>{ROUTE_ETA_DISCLAIMER}</span>
          <div className="flex flex-wrap items-center gap-2">
            {effectivePartnerPos ? (
              <span
                className={`inline-flex items-center gap-1 font-semibold ${
                  freshness.status === 'live'
                    ? 'text-emerald-700'
                    : freshness.status === 'stale'
                      ? 'text-amber-700'
                      : 'text-slate-600'
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">
                  {freshness.status === 'live' ? 'sensors' : 'schedule'}
                </span>
                <span>{freshness.label}</span>
              </span>
            ) : (
              <span>Waiting for partner GPS fix</span>
            )}
            {gpsAccuracyInfo && (
              <span className="text-slate-500 font-mono text-[10px]">
                ±{Math.round(effectiveAccuracy || 0)}m
              </span>
            )}
            {effectiveHeading !== null && (
              <span className="text-slate-500 font-mono text-[10px] inline-flex items-center gap-0.5">
                <span className="material-symbols-outlined text-[12px]">explore</span>
                <span>{Math.round(effectiveHeading)}°</span>
              </span>
            )}
            {speedKmh !== null && speedKmh > 0 && (
              <span className="text-slate-600 font-mono text-[10px] font-semibold">
                {speedKmh} km/h
              </span>
            )}
          </div>
        </div>

        {aiInsightsError && (
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px]">
            <span className="material-symbols-outlined text-[14px] shrink-0">info</span>
            <span>{aiInsightsError}</span>
          </div>
        )}

        {aiInsights && (
          <div className="rounded-xl bg-gradient-to-br from-blue-50/80 to-emerald-50/60 border border-blue-200/80 p-3 space-y-1.5 text-[11px] text-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 font-extrabold text-[#1A73E8] uppercase tracking-wider text-[10px]">
                <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
                <span>AI Live Delivery Brief</span>
              </span>
              {aiInsights.recommendedMapStyle !== mapStylePreset && (
                <button
                  type="button"
                  onClick={() => handleSelectTrackingStyle(aiInsights.recommendedMapStyle)}
                  className="px-2 py-0.5 rounded-md bg-white border border-blue-200 text-[#1A73E8] font-bold text-[10px] cursor-pointer hover:bg-blue-50"
                >
                  Apply {MAP_STYLE_PRESETS.find((p) => p.id === aiInsights.recommendedMapStyle)?.label} View
                </button>
              )}
            </div>
            {aiInsights.areaBrief && <p className="text-slate-700 leading-snug">{aiInsights.areaBrief}</p>}
            {aiInsights.dropTip && (
              <p className="text-slate-900 font-semibold leading-snug">
                <span className="text-emerald-800">Tip:</span> {aiInsights.dropTip}
              </p>
            )}
            {aiInsights.etaSummary && <p className="text-[10px] text-slate-600">{aiInsights.etaSummary}</p>}
          </div>
        )}

        {/* Route Error Banner */}
        {routeError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-medium">
            <span className="material-symbols-outlined text-[15px] text-amber-700 shrink-0">alt_route</span>
            <span>{routeError.message}</span>
          </div>
        )}

        {/* Viewer GPS Permission-Denied / Error & Accuracy Warning Banners */}
        {!allowLiveLocationShare && viewerLiveLoc.error && (
          <div
            className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-[11px] font-medium border ${
              viewerLiveLoc.isPermissionDenied
                ? 'bg-red-50 border-red-200 text-red-800'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="material-symbols-outlined text-[15px] shrink-0">
                {viewerLiveLoc.isPermissionDenied ? 'location_disabled' : 'info'}
              </span>
              <span>{viewerLiveLoc.error}</span>
            </div>
            <button
              type="button"
              onClick={handleLocateViewerClick}
              className={`px-2 py-1 rounded-lg font-bold text-[10px] shrink-0 cursor-pointer ${
                viewerLiveLoc.isPermissionDenied
                  ? 'bg-red-100 hover:bg-red-200/80 text-red-950'
                  : 'bg-amber-200/70 text-amber-950'
              }`}
            >
              Retry
            </button>
          </div>
        )}
        {!allowLiveLocationShare && viewerLiveLoc.accuracyWarning && !viewerLiveLoc.error && (
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-medium">
            <span className="material-symbols-outlined text-[15px] text-amber-700 shrink-0">warning</span>
            <span>{viewerLiveLoc.accuracyWarning}</span>
          </div>
        )}

        {/* Socket Error Banner (with Retry button) */}
        {socket.errorMessage && !isOrderTerminal && (
          <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-medium">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="material-symbols-outlined text-[15px] text-amber-700 shrink-0">sync_problem</span>
              <span className="truncate">{socket.errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={socket.reconnect}
              className="px-2 py-1 rounded-lg bg-amber-200/70 text-amber-950 font-bold text-[10px] shrink-0 cursor-pointer"
            >
              Reconnect
            </button>
          </div>
        )}

        {/* Pickup & Dropoff Endpoints */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-slate-100 text-[11px]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-black flex items-center justify-center shrink-0">
              P
            </span>
            <span className="text-slate-700 truncate font-medium">{farmName}</span>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-black flex items-center justify-center shrink-0">
              D
            </span>
            <span className="text-slate-700 truncate font-medium">{dropoffLabel}</span>
          </div>
        </div>

        {/* Partner Controls: Milestone Updates + GPS Status + Foreground Limitation Disclosure */}
        {allowLiveLocationShare && !isOrderTerminal && (
          <div className="space-y-2 pt-1 border-t border-slate-100">
            {stage === 'picked_up' && onMarkMilestone && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={milestoneBusy || socket.liveStage === 'NEAR_DESTINATION' || socket.liveStage === 'ARRIVED'}
                  onClick={() => void handleMilestoneClick('NEAR_DESTINATION')}
                  className="h-8 px-3 rounded-lg bg-slate-100 hover:bg-emerald-50 border border-slate-200 text-[11px] font-bold text-slate-800 disabled:opacity-50 cursor-pointer"
                >
                  Mark Near Destination
                </button>
                <button
                  type="button"
                  disabled={milestoneBusy || socket.liveStage === 'ARRIVED'}
                  onClick={() => void handleMilestoneClick('ARRIVED')}
                  className="h-8 px-3 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-[11px] font-bold text-emerald-900 disabled:opacity-50 cursor-pointer"
                >
                  Mark Arrived at Doorstep
                </button>
              </div>
            )}

            {(partnerLiveLoc.error || terminalNote) && (
              <div
                className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border ${
                  partnerLiveLoc.isPermissionDenied
                    ? 'bg-red-50 border-red-200 text-red-800'
                    : 'bg-amber-50 border-amber-200 text-amber-900'
                }`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="material-symbols-outlined text-[15px] shrink-0">
                    {partnerLiveLoc.isPermissionDenied ? 'location_disabled' : 'info'}
                  </span>
                  <span>{partnerLiveLoc.error || terminalNote}</span>
                </div>
                {partnerLiveLoc.isPermissionDenied && (
                  <button
                    type="button"
                    onClick={toggleLiveShare}
                    className="px-2 py-0.5 rounded bg-red-100 hover:bg-red-200/80 text-red-950 font-bold text-[10px] shrink-0 cursor-pointer"
                  >
                    Retry GPS
                  </button>
                )}
              </div>
            )}

            {partnerLiveLoc.accuracyWarning && !partnerLiveLoc.error && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border bg-amber-50 border-amber-200 text-amber-900">
                <span className="material-symbols-outlined text-[15px] text-amber-700 shrink-0">warning</span>
                <span>{partnerLiveLoc.accuracyWarning}</span>
              </div>
            )}

            {partnerLiveLoc.isWatching && partnerLiveLoc.isLocating && !partnerLiveLoc.location && !partnerLiveLoc.error && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border bg-blue-50 border-blue-200 text-blue-900">
                <span className="material-symbols-outlined text-[15px] animate-spin shrink-0">progress_activity</span>
                <span>Acquiring live GPS fix from your browser...</span>
              </div>
            )}

            <p className="text-[10px] text-slate-500 flex items-start gap-1.5 leading-snug">
              <span className="material-symbols-outlined text-[14px] text-slate-400 shrink-0 mt-0.5">smartphone</span>
              <span>
                Browser GPS shares updates only while this page stays active in the foreground. Reliable background or
                screen-locked tracking on mobile requires a native Android/iOS partner app with foreground location service.
              </span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
