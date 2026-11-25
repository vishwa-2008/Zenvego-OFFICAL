import * as maplibregl from 'maplibre-gl';
import type { Coords } from './geo';

/**
 * Default OpenFreeMap Liberty vector style for MapLibre GL JS.
 * Production deployments can override via VITE_MAP_STYLE_URL to point to a
 * self-hosted Protomaps / OpenFreeMap mirror or commercial SLA vector tile server.
 */
export const DEFAULT_OPENFREEMAP_STYLE_URL =
  'https://tiles.openfreemap.org/styles/liberty';

let configuredWorkerUrl: string | null = null;

/**
 * Resolves the MapLibre GL JS v6 standalone ES module worker URL relative to
 * Vite's configured BASE_URL. Served raw (untransformed) in dev by
 * `maplibreWorkerAssetPlugin` in vite.config.ts and emitted into
 * `dist/assets/maplibre-gl-worker.mjs` during production builds.
 */
export function getMapLibreWorkerUrl(): string {
  const base = (import.meta.env.BASE_URL as string | undefined) || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const relativePath = `${normalizedBase}assets/maplibre-gl-worker.mjs`;
  if (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null') {
    return new URL(relativePath, window.location.origin).href;
  }
  return relativePath;
}

/**
 * Configures MapLibre GL JS v6's separate ES module worker URL once before
 * constructing any MapLibre Map instance.
 */
export function ensureMapLibreWorkerConfigured(): string {
  const workerUrl = getMapLibreWorkerUrl();
  if (configuredWorkerUrl !== workerUrl || maplibregl.getWorkerUrl() !== workerUrl) {
    maplibregl.setWorkerUrl(workerUrl);
    configuredWorkerUrl = workerUrl;
  }
  return workerUrl;
}

export function formatMapLibreError(err: unknown): string {
  const rawMessage =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : typeof err === 'object' && err !== null && 'message' in err && typeof (err as { message?: unknown }).message === 'string'
          ? (err as { message: string }).message
          : '';

  if (/worker/i.test(rawMessage)) {
    return 'Map rendering worker failed to load. Please retry or refresh the page.';
  }
  if (/webgl|gpu|context/i.test(rawMessage)) {
    return 'Unable to initialize WebGL map renderer. Ensure hardware acceleration is enabled and retry.';
  }
  if (rawMessage && /style|tile|openfreemap|fetch|network|cors|status|404|50\d/i.test(rawMessage)) {
    return 'Unable to load OpenFreeMap street vector tiles. Check your connection and retry.';
  }
  return 'Unable to load OpenFreeMap street vector tiles. Check your connection and retry.';
}

export type MapStylePresetId = 'bright' | 'liberty' | 'positron' | 'dark';

export interface MapStylePreset {
  id: MapStylePresetId;
  label: string;
  shortDesc: string;
  url: string;
  previewBg: string;
  previewAccent: string;
  isDark: boolean;
}

/**
 * Free, zero-API-key OpenFreeMap vector map styles providing a Google-Maps-like
 * layered viewing experience (Street, Detailed 3D, Minimal Clean, Night Navigation).
 */
export const MAP_STYLE_PRESETS: readonly MapStylePreset[] = [
  {
    id: 'bright',
    label: 'Street',
    shortDesc: 'Crisp Google-like streets & POIs',
    url: 'https://tiles.openfreemap.org/styles/bright',
    previewBg: '#EEF4EE',
    previewAccent: '#1A73E8',
    isDark: false,
  },
  {
    id: 'liberty',
    label: '3D Detail',
    shortDesc: 'Rich landmarks & 3D buildings',
    url: DEFAULT_OPENFREEMAP_STYLE_URL,
    previewBg: '#F4F1EA',
    previewAccent: '#059669',
    isDark: false,
  },
  {
    id: 'positron',
    label: 'Clean',
    shortDesc: 'Minimal focus for routes',
    url: 'https://tiles.openfreemap.org/styles/positron',
    previewBg: '#F8FAFC',
    previewAccent: '#475569',
    isDark: false,
  },
  {
    id: 'dark',
    label: 'Night',
    shortDesc: 'Dark navigation contrast',
    url: 'https://tiles.openfreemap.org/styles/dark',
    previewBg: '#0F172A',
    previewAccent: '#34D399',
    isDark: true,
  },
] as const;

export function getMapStyleUrl(): string {
  const configured = (import.meta.env.VITE_MAP_STYLE_URL as string | undefined)?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_OPENFREEMAP_STYLE_URL;
}

export function getMapStyleUrlForPreset(preset: MapStylePresetId): string {
  const configured = (import.meta.env.VITE_MAP_STYLE_URL as string | undefined)?.trim();
  if (configured && configured.length > 0 && preset === 'liberty') {
    return configured;
  }
  const found = MAP_STYLE_PRESETS.find((p) => p.id === preset);
  return found ? found.url : DEFAULT_OPENFREEMAP_STYLE_URL;
}

export function isCustomMapStyleConfigured(): boolean {
  return Boolean((import.meta.env.VITE_MAP_STYLE_URL as string | undefined)?.trim());
}

/**
 * Viewport-only initial camera center (Bengaluru metro) when no saved or GPS coordinate
 * is available yet. Never persist this constant as a real user, order, or drop-off location.
 */
export const BENGALURU_VIEWPORT_CENTER: Coords = {
  lat: 12.9716,
  lng: 77.5946,
};

export const MAP_ATTRIBUTION = '© OpenStreetMap contributors · OpenFreeMap';
export const ROUTE_ETA_DISCLAIMER = 'Route-based estimate · excludes live traffic';

export const MAP_THEME = {
  surfaceBg: '#F4F7F5',
  routeGlow: 'rgba(26, 115, 232, 0.24)',
  routeCasing: '#FFFFFF',
  routePrimary: '#1A73E8',
  routeEco: '#059669',
  routeSecondary: '#64748B',
  pickupAccent: '#D97706',
  dropoffAccent: '#059669',
  partnerAccent: '#003820',
  gpsBlue: '#1A73E8',
} as const;
