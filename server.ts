import crypto from 'crypto';
import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import QRCode from 'qrcode';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { initializeApp as initializeAdminApp, getApps } from 'firebase-admin/app';
import { getAuth as getAdminAuth, type DecodedIdToken } from 'firebase-admin/auth';
import {
  attachTrackingSocket,
  verifyFirestoreTrackingAuthorization,
  type TrackingServerHandle,
} from './server/trackingSocket.ts';
import {
  attachLiveVoiceServer,
  runAssistantChat,
  type AssistantChatMessageInput,
  type AssistantMode,
  type AssistantUserRole,
} from './server/geminiAssistant.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load Firebase projectId & firestoreDatabaseId from firebase-applet-config.json (verifyIdToken works on all tiers without IAM)
let firebaseProjectId = process.env.FIREBASE_PROJECT_ID || '';
let firestoreDatabaseId = process.env.FIRESTORE_DATABASE_ID || '(default)';
try {
  const cfgPath = path.resolve(__dirname, 'firebase-applet-config.json');
  if (fs.existsSync(cfgPath)) {
    const rawCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (rawCfg.projectId) firebaseProjectId = rawCfg.projectId;
    if (rawCfg.firestoreDatabaseId) firestoreDatabaseId = rawCfg.firestoreDatabaseId;
  }
} catch {
  // Handled below
}

if (getApps().length === 0 && firebaseProjectId) {
  initializeAdminApp({ projectId: firebaseProjectId });
}

// Single authoritative platform commission rate: 1000 bps = 10.00% fee, 90.00% grower share
const PLATFORM_COMMISSION_BPS = 1000;
const QUOTE_TTL_MS = 15 * 60_000;

// Ephemeral fallback signing key per process if QR_SIGNING_SECRET not provided in env
const PROCESS_SIGNING_KEY = crypto.randomBytes(32).toString('hex');

function getSigningSecret(): string {
  const envSecret = process.env.QR_SIGNING_SECRET?.trim();
  return envSecret && envSecret.length >= 16 ? envSecret : PROCESS_SIGNING_KEY;
}

let cachedGeminiClient: GoogleGenAI | null = null;
let cachedGeminiKey = '';

function getServerGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || '';
  if (!apiKey) return null;
  if (!cachedGeminiClient || cachedGeminiKey !== apiKey) {
    cachedGeminiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    cachedGeminiKey = apiKey;
  }
  return cachedGeminiClient;
}

function toPaise(amountInr: number): number {
  return Math.round(amountInr * 100);
}

function fromPaise(paise: number): number {
  return Math.round(paise) / 100;
}

function logSecurityEvent(level: 'info' | 'warn' | 'error', event: string, meta: Record<string, unknown> = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    service: 'zenvego-api',
    event,
    ...meta,
  };
  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else if (level === 'warn') {
    console.warn(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

function signCheckoutQuote(params: {
  uid: string;
  orderCode: string;
  totalPaidPaise: number;
  expiresAtMs: number;
}): string {
  const canonical = `${params.uid}|${params.orderCode}|${params.totalPaidPaise}|${params.expiresAtMs}`;
  return crypto.createHmac('sha256', getSigningSecret()).update(canonical).digest('hex');
}

function verifyCheckoutQuoteSignature(params: {
  uid: string;
  orderCode: string;
  totalPaidPaise: number;
  expiresAtMs: number;
  signature: string;
}): boolean {
  if (!Number.isFinite(params.expiresAtMs) || Date.now() > params.expiresAtMs) {
    return false;
  }
  const expected = signCheckoutQuote(params);
  const sigBuf = Buffer.from(params.signature, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
}

function getAllowedAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_ALLOWED_EMAILS || 'asvikaravi519@gmail.com';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

function getAllowedCorsOrigins(): Set<string> {
  const origins = new Set<string>();
  const sources = [
    process.env.APP_URL,
    process.env.ALLOWED_PUBLIC_ORIGINS,
    process.env.ALLOWED_ADMIN_ORIGINS,
  ];
  for (const src of sources) {
    if (!src) continue;
    for (const item of src.split(',')) {
      const cleaned = item.trim().replace(/\/+$/, '');
      if (cleaned) origins.add(cleaned);
    }
  }
  return origins;
}

interface AuthedRequest extends Request {
  user?: DecodedIdToken;
}

// ---------------------------------------------------------------------------
// In-Memory Operational Guards (Rate Limiters, Idempotency, QR Nonce Store, Replay Guard)
// NOTE: Move to persistent Firestore / Redis once user-owned IAM project is connected.
// ---------------------------------------------------------------------------
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function createRateLimiter(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip || 'unknown'}:${req.path}`;
    const now = Date.now();
    const bucket = rateLimitBuckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (bucket.count >= maxRequests) {
      logSecurityEvent('warn', 'rate_limit_exceeded', { path: req.path });
      res.status(429).json({
        error: 'Too many requests. Please wait a moment and try again.',
        retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000),
      });
      return;
    }
    bucket.count += 1;
    next();
  };
}

// Firebase ID Token verification middleware (server-side cryptographic JWT check)
async function requireFirebaseAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Missing Bearer ID token.' });
    return;
  }
  const idToken = authHeader.slice(7).trim();
  if (!idToken || idToken.length > 4096) {
    res.status(401).json({ error: 'Invalid authentication token format.' });
    return;
  }
  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({
      error: 'Invalid or expired Firebase ID token.',
      code: (err as { code?: string })?.code || 'auth/invalid-token',
    });
  }
}

// Restricted operator authorization middleware (blocks all non-admin marketplace accounts)
function requireOperatorAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  const user = req.user;
  if (!user || !user.email_verified) {
    logSecurityEvent('warn', 'operator_auth_denied_unverified', { path: req.path, uid: user?.uid || null });
    res.status(403).json({
      error: 'Forbidden: Verified operator authorization is required for this action.',
      code: 'ADMIN_REQUIRED',
    });
    return;
  }
  const hasAdminClaim = (user as Record<string, unknown>).admin === true;
  const emailLower = (user.email || '').toLowerCase();
  const isAllowlisted = Boolean(emailLower && getAllowedAdminEmails().has(emailLower));

  if (!hasAdminClaim && !isAllowlisted) {
    logSecurityEvent('warn', 'operator_auth_denied_role', { path: req.path, uid: user.uid });
    res.status(403).json({
      error: 'Forbidden: Operator admin privileges are required for this action.',
      code: 'ADMIN_REQUIRED',
    });
    return;
  }
  next();
}

// Cryptographically signed single-use QR token store
interface QrTokenRecord {
  token: string;
  nonce: string;
  action: 'pickup' | 'delivery';
  orderId: string;
  sellerOrderId?: string;
  assignmentId?: string;
  orderCode: string;
  handoverPin: string;
  issuedByUid: string;
  createdAt: number;
  expiresAt: number;
  consumedAt?: number;
  consumedByUid?: string;
}

const qrTokenStore = new Map<string, QrTokenRecord>();
const consumedQrNonces = new Set<string>();

function createSignedQrToken(payload: {
  n: string;
  a: 'pickup' | 'delivery';
  o: string;
  s?: string;
  c: string;
  u: string;
  e: number;
}): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSigningSecret()).update(encoded).digest('base64url');
  return `zvg_qr_v2.${encoded}.${sig}`;
}

function verifySignedQrToken(token: string): {
  valid: boolean;
  expired?: boolean;
  payload?: { n: string; a: 'pickup' | 'delivery'; o: string; s?: string; c: string; u: string; e: number };
} {
  if (!token.startsWith('zvg_qr_v2.')) return { valid: false };
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false };
  const [, encoded, sig] = parts;
  const expected = crypto.createHmac('sha256', getSigningSecret()).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false };
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      n: string;
      a: 'pickup' | 'delivery';
      o: string;
      s?: string;
      c: string;
      u: string;
      e: number;
    };
    if (!parsed.n || !parsed.o || (parsed.a !== 'pickup' && parsed.a !== 'delivery')) {
      return { valid: false };
    }
    if (Date.now() > parsed.e) {
      return { valid: false, expired: true, payload: parsed };
    }
    return { valid: true, payload: parsed };
  } catch {
    return { valid: false };
  }
}

// Registered order handover PINs (so 4-digit PIN verification works before QR modal is opened)
const registeredOrderPinStore = new Map<
  string,
  {
    orderId: string;
    sellerOrderId?: string;
    orderCode: string;
    handoverPin: string;
    action: 'pickup' | 'delivery';
    registeredByUid: string;
    consumedAt?: number;
    createdAt: number;
  }
>();

// Submitted UPI UTR references for replay protection
const submittedUpiUtrStore = new Set<string>();

// Idempotency store for checkout validation (prevents duplicate submissions)
const checkoutIdempotencyStore = new Map<string, { createdAt: number; response: Record<string, unknown> }>();

// Processed webhook IDs for replay protection
const processedWebhookEvents = new Set<string>();

// Active Bengaluru hyperlocal freshness clusters (10 km hyperlocal serviceability radius)
const SERVICE_CLUSTERS = [
  { id: 'indiranagar', name: 'Indiranagar & Domlur Hub', lat: 12.9784, lng: 77.6408, radiusKm: 10 },
  { id: 'koramangala', name: 'Koramangala & HSR Hub', lat: 12.9352, lng: 77.6245, radiusKm: 10 },
  { id: 'whitefield', name: 'Whitefield Terrace Cluster', lat: 12.9698, lng: 77.7500, radiusKm: 10 },
  { id: 'jayanagar', name: 'Jayanagar & JP Nagar Hub', lat: 12.9250, lng: 77.5938, radiusKm: 10 },
  { id: 'malleswaram', name: 'Malleswaram & Hebbal Hub', lat: 13.0068, lng: 77.5692, radiusKm: 10 },
];

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface MapCacheEntry<T> {
  value: T;
  expiresAt: number;
}

function createBoundedTtlCache<T>(maxEntries: number, ttlMs: number) {
  const store = new Map<string, MapCacheEntry<T>>();
  return {
    get(key: string): T | null {
      const hit = store.get(key);
      if (!hit) return null;
      if (hit.expiresAt < Date.now()) {
        store.delete(key);
        return null;
      }
      return hit.value;
    },
    set(key: string, value: T) {
      if (store.size >= maxEntries) {
        const oldestKey = store.keys().next().value;
        if (oldestKey !== undefined) store.delete(oldestKey);
      }
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
  };
}

function getMapsProviderConfig() {
  const osrmBaseUrl = (process.env.OSRM_BASE_URL || 'https://router.project-osrm.org').replace(/\/+$/, '');
  const geocoderBaseUrl = (process.env.GEOCODER_BASE_URL || 'https://photon.komoot.io').replace(/\/+$/, '');
  const nominatimBaseUrl = (process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org').replace(/\/+$/, '');
  const userAgent = (process.env.OSM_USER_AGENT || 'ZenvegoHyperlocal/1.0 (+https://zenvego.app)').trim();
  return {
    osrmBaseUrl,
    geocoderBaseUrl,
    nominatimBaseUrl,
    userAgent,
    isCustomOsrm: Boolean(process.env.OSRM_BASE_URL?.trim()),
    isCustomGeocoder: Boolean(process.env.GEOCODER_BASE_URL?.trim()),
  };
}

function isValidLatLng(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001)
  );
}

interface NormalizedPlaceResult {
  id: string;
  title: string;
  subtitle: string;
  formattedAddress: string;
  lat: number;
  lng: number;
}

function formatPhotonFeature(feature: {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, unknown>;
}): NormalizedPlaceResult | null {
  const coords = feature.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  const [lng, lat] = coords;
  if (!isValidLatLng(lat, lng)) return null;
  const p = feature.properties || {};
  const str = (key: string) => (typeof p[key] === 'string' ? (p[key] as string).trim() : '');
  const name = str('name');
  const houseNumber = str('housenumber');
  const street = str('street');
  const locality = str('locality') || str('district') || str('suburb');
  const city = str('city') || str('county');
  const state = str('state');
  const postcode = str('postcode');
  const country = str('country');

  const streetLine = [houseNumber, street].filter(Boolean).join(' ');
  const parts = Array.from(new Set([name, streetLine, locality, city, state, postcode, country].filter(Boolean)));
  const formattedAddress = parts.join(', ') || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const title = name || streetLine || locality || city || formattedAddress;
  const subtitle = parts.filter((part) => part !== title).join(', ');
  const osmId = p.osm_id != null ? String(p.osm_id) : `${lat.toFixed(5)}_${lng.toFixed(5)}`;
  const osmType = str('osm_type') || 'p';

  return {
    id: `osm_${osmType}_${osmId}`,
    title,
    subtitle,
    formattedAddress,
    lat,
    lng,
  };
}

const mapSearchCache = createBoundedTtlCache<NormalizedPlaceResult[]>(400, 10 * 60_000);
const mapReverseCache = createBoundedTtlCache<NormalizedPlaceResult>(500, 15 * 60_000);
const mapRouteCache = createBoundedTtlCache<{
  distanceMeters: number;
  distanceKm: number;
  durationSec: number;
  durationMins: number;
  geometry: { type: 'LineString'; coordinates: [number, number][] };
}>(300, 25_000);

function getRazorpayConfig() {
  const keyId = process.env.RAZORPAY_KEY_ID || '';
  const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
  return {
    keyId,
    keySecret,
    webhookSecret,
    isConfigured: Boolean(keyId && keySecret),
  };
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  // Security headers middleware (baseline hardening across all API and static responses)
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');
    res.setHeader('X-XSS-Protection', '0');
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  // Strict CORS allowlist for cross-origin API requests (never wildcard '*' with Bearer auth)
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (!origin) {
      return next();
    }
    const cleanOrigin = origin.replace(/\/+$/, '');
    const requestHostOrigin = `${req.protocol}://${req.get('host')}`;
    const allowlist = getAllowedCorsOrigins();
    const isLocalDev = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(cleanOrigin);
    const isSameHost = cleanOrigin === requestHostOrigin || cleanOrigin === requestHostOrigin.replace('http://', 'https://');

    if (isSameHost || isLocalDev || allowlist.has(cleanOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      return next();
    }

    logSecurityEvent('warn', 'cors_origin_blocked', { origin: cleanOrigin, path: req.path });
    res.status(403).json({ error: 'CORS origin not permitted.' });
  });

  // Razorpay Webhook MUST receive raw body BEFORE express.json() for HMAC signature verification
  app.post(
    '/api/webhooks/payment',
    createRateLimiter(60, 60_000),
    express.raw({ type: 'application/json', limit: '256kb' }),
    (req: Request, res: Response) => {
      const { webhookSecret } = getRazorpayConfig();
      if (!webhookSecret) {
        res.status(503).json({
          error: 'Payment webhook secret is not configured on the server.',
          configured: false,
        });
        return;
      }

      const signature = req.headers['x-razorpay-signature'];
      const eventId = req.headers['x-razorpay-event-id'];
      if (typeof signature !== 'string' || !signature) {
        res.status(401).json({ error: 'Missing X-Razorpay-Signature header.' });
        return;
      }

      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || ''));
      const expectedSig = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

      const sigBuf = Buffer.from(signature, 'utf8');
      const expBuf = Buffer.from(expectedSig, 'utf8');
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        logSecurityEvent('warn', 'webhook_invalid_signature');
        res.status(401).json({ error: 'Invalid webhook signature.' });
        return;
      }

      const dedupeKey =
        typeof eventId === 'string' && eventId ? eventId : crypto.createHash('sha256').update(rawBody).digest('hex');
      if (processedWebhookEvents.has(dedupeKey)) {
        res.status(200).json({ received: true, duplicate: true, eventId: dedupeKey });
        return;
      }
      processedWebhookEvents.add(dedupeKey);

      let parsedEvent: Record<string, unknown> = {};
      try {
        parsedEvent = JSON.parse(rawBody.toString('utf8'));
      } catch {
        res.status(400).json({ error: 'Malformed webhook JSON payload.' });
        return;
      }

      const eventType = typeof parsedEvent.event === 'string' ? parsedEvent.event : 'unknown';
      logSecurityEvent('info', 'webhook_verified', { eventId: dedupeKey, eventType });

      res.status(200).json({
        received: true,
        duplicate: false,
        eventId: dedupeKey,
        eventType,
        verifiedAt: new Date().toISOString(),
      });
    }
  );

  app.use(express.json({ limit: '512kb' }));

  // -------------------------------------------------------------------------
  // 1. Health & Configuration Diagnostics (Zero Secrets Exposed)
  // -------------------------------------------------------------------------
  app.get('/api/health', (_req: Request, res: Response) => {
    const rzp = getRazorpayConfig();
    const mapsCfg = getMapsProviderConfig();
    res.json({
      status: 'ok',
      service: 'zenvego-api',
      firebaseProjectConfigured: Boolean(firebaseProjectId),
      mapsProvider: 'maplibre-osm',
      mapStyleDefault: 'openfreemap-liberty',
      mapsConfigured: true,
      socketIoEnabled: true,
      customOsrmConfigured: mapsCfg.isCustomOsrm,
      customGeocoderConfigured: mapsCfg.isCustomGeocoder,
      razorpayConfigured: rzp.isConfigured,
      razorpayWebhookConfigured: Boolean(rzp.webhookSecret),
      commissionBps: PLATFORM_COMMISSION_BPS,
      timestamp: new Date().toISOString(),
    });
  });

  // -------------------------------------------------------------------------
  // 2. Auth Verification Endpoint
  // -------------------------------------------------------------------------
  app.get('/api/auth/me', createRateLimiter(120, 60_000), requireFirebaseAuth, (req: AuthedRequest, res: Response) => {
    res.json({
      uid: req.user!.uid,
      email: req.user!.email || null,
      emailVerified: Boolean(req.user!.email_verified),
      name: req.user!.name || null,
      picture: req.user!.picture || null,
    });
  });

  // -------------------------------------------------------------------------
  // 3. Authoritative Checkout & Multi-Grower Integer-Paise Pricing Validation (Signed & Idempotent)
  // -------------------------------------------------------------------------
  app.post(
    '/api/checkout/validate',
    createRateLimiter(30, 60_000),
    requireFirebaseAuth,
    (req: AuthedRequest, res: Response) => {
      const { idempotencyKey, items, deliveryLat, deliveryLng } = req.body as {
        idempotencyKey?: string;
        items?: Array<{
          productId: string;
          growerId: string;
          farmName: string;
          name: string;
          unit: string;
          unitPrice: number;
          quantity: number;
          availableStock: number;
        }>;
        deliveryLat?: number;
        deliveryLng?: number;
      };

      if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.length > 128) {
        res.status(400).json({ error: 'Valid idempotencyKey is required.' });
        return;
      }

      const existingSession = checkoutIdempotencyStore.get(`${req.user!.uid}:${idempotencyKey}`);
      if (existingSession && Date.now() - existingSession.createdAt < QUOTE_TTL_MS) {
        res.status(200).json({ ...existingSession.response, idempotentReplay: true });
        return;
      }

      if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
        res.status(400).json({ error: 'Cart must contain between 1 and 50 valid items.' });
        return;
      }

      let itemsTotalPaise = 0;
      const byGrower = new Map<
        string,
        {
          growerId: string;
          farmName: string;
          grossPaise: number;
          items: Array<{
            productId: string;
            name: string;
            unit: string;
            unitPrice: number;
            unitPricePaise: number;
            quantity: number;
            lineTotal: number;
            lineTotalPaise: number;
          }>;
        }
      >();

      for (const item of items) {
        if (
          !item.productId ||
          !item.growerId ||
          typeof item.quantity !== 'number' ||
          !Number.isInteger(item.quantity) ||
          item.quantity < 1 ||
          item.quantity > 500 ||
          typeof item.unitPrice !== 'number' ||
          !Number.isFinite(item.unitPrice) ||
          item.unitPrice <= 0 ||
          item.unitPrice > 100000
        ) {
          res.status(400).json({ error: `Invalid line item parameters for ${item.name || item.productId || 'item'}.` });
          return;
        }
        if (typeof item.availableStock === 'number' && item.quantity > item.availableStock) {
          res.status(409).json({
            error: `Insufficient stock for ${item.name}. Available: ${item.availableStock}.`,
            productId: item.productId,
            availableStock: item.availableStock,
          });
          return;
        }

        const unitPricePaise = toPaise(item.unitPrice);
        const lineTotalPaise = unitPricePaise * item.quantity;
        itemsTotalPaise += lineTotalPaise;

        const existingGroup = byGrower.get(item.growerId) || {
          growerId: item.growerId,
          farmName: item.farmName || 'Local Grower',
          grossPaise: 0,
          items: [],
        };
        existingGroup.grossPaise += lineTotalPaise;
        existingGroup.items.push({
          productId: item.productId,
          name: item.name,
          unit: item.unit,
          unitPrice: fromPaise(unitPricePaise),
          unitPricePaise,
          quantity: item.quantity,
          lineTotal: fromPaise(lineTotalPaise),
          lineTotalPaise,
        });
        byGrower.set(item.growerId, existingGroup);
      }

      // Compute multi-grower seller allocations in integer paise (1000 bps = 10% platform commission, 90% grower net)
      const sellerSplits = Array.from(byGrower.values()).map((group) => {
        const feePaise = Math.round((group.grossPaise * PLATFORM_COMMISSION_BPS) / 10000);
        const netPaise = group.grossPaise - feePaise;
        return {
          growerId: group.growerId,
          farmName: group.farmName,
          grossAmount: fromPaise(group.grossPaise),
          grossPaise: group.grossPaise,
          platformFee: fromPaise(feePaise),
          platformFeePaise: feePaise,
          netPayout: fromPaise(netPaise),
          netPayoutPaise: netPaise,
          handoverPin: String(crypto.randomInt(1000, 9999)),
          sealId: `SL-${crypto.randomInt(1000, 9999)}`,
          items: group.items,
        };
      });

      // Hyperlocal EV delivery charge in integer paise: ₹15 base + ₹5 per extra grower pickup (waived >= ₹499)
      const deliveryFeePaise = itemsTotalPaise >= 49900 ? 0 : 1500 + Math.max(0, sellerSplits.length - 1) * 500;
      const totalPaidPaise = itemsTotalPaise + deliveryFeePaise;

      let serviceabilityNote = 'Verified hyperlocal delivery zone';
      if (typeof deliveryLat === 'number' && typeof deliveryLng === 'number') {
        const nearest = SERVICE_CLUSTERS.map((c) => ({
          ...c,
          distanceKm: Math.round(haversineKm(deliveryLat, deliveryLng, c.lat, c.lng) * 10) / 10,
        })).sort((a, b) => a.distanceKm - b.distanceKm)[0];
        if (nearest && nearest.distanceKm > nearest.radiusKm) {
          serviceabilityNote = `Outside standard 10 km cluster (${nearest.distanceKm} km from ${nearest.name})`;
        } else if (nearest) {
          serviceabilityNote = `${nearest.name} (${nearest.distanceKm} km)`;
        }
      }

      const orderCode = `ZVG-${crypto.randomInt(10000, 99999)}`;
      const handoverPin = sellerSplits[0]?.handoverPin || String(crypto.randomInt(1000, 9999));
      const quoteExpiresAtMs = Date.now() + QUOTE_TTL_MS;
      const quoteSignature = signCheckoutQuote({
        uid: req.user!.uid,
        orderCode,
        totalPaidPaise,
        expiresAtMs: quoteExpiresAtMs,
      });

      const responsePayload = {
        checkoutId: `chk_${crypto.randomBytes(8).toString('hex')}`,
        orderCode,
        handoverPin,
        itemsTotal: fromPaise(itemsTotalPaise),
        itemsTotalPaise,
        deliveryFee: fromPaise(deliveryFeePaise),
        deliveryFeePaise,
        totalPaid: fromPaise(totalPaidPaise),
        totalPaidPaise,
        commissionBps: PLATFORM_COMMISSION_BPS,
        quoteSignature,
        quoteExpiresAtMs,
        sellerSplits,
        serviceabilityNote,
        validatedAt: new Date().toISOString(),
        idempotentReplay: false,
      };

      checkoutIdempotencyStore.set(`${req.user!.uid}:${idempotencyKey}`, {
        createdAt: Date.now(),
        response: responsePayload,
      });

      res.status(200).json(responsePayload);
    }
  );

  // -------------------------------------------------------------------------
  // 4. Cryptographic HMAC-Signed QR Generation, Verification & Single-Use Consumption
  // -------------------------------------------------------------------------
  app.post(
    '/api/qr/generate',
    createRateLimiter(40, 60_000),
    requireFirebaseAuth,
    async (req: AuthedRequest, res: Response) => {
      const { type, growerId, productId, qty, src, orderId, sellerOrderId, assignmentId, orderCode, handoverPin } = req.body as {
        type?: 'store' | 'product' | 'pickup' | 'delivery';
        growerId?: string;
        productId?: string;
        qty?: number;
        src?: string;
        orderId?: string;
        sellerOrderId?: string;
        assignmentId?: string;
        orderCode?: string;
        handoverPin?: string;
      };

      const origin = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;

      try {
        if (type === 'store') {
          if (!growerId || !/^[a-zA-Z0-9_-]{1,128}$/.test(growerId)) {
            res.status(400).json({ error: 'Valid growerId is required for store QR.' });
            return;
          }
          const payloadUrl = `${origin}/?store=${encodeURIComponent(growerId)}`;
          const [pngDataUrl, svgMarkup] = await Promise.all([
            QRCode.toDataURL(payloadUrl, { width: 320, margin: 2, color: { dark: '#002113', light: '#FFFFFF' } }),
            QRCode.toString(payloadUrl, { type: 'svg', margin: 2, color: { dark: '#002113', light: '#FFFFFF' } }),
          ]);
          res.json({ type, payload: payloadUrl, pngDataUrl, svgMarkup, generatedAt: new Date().toISOString() });
          return;
        }

        if (type === 'product') {
          if (!productId || !/^[a-zA-Z0-9_-]{1,128}$/.test(productId)) {
            res.status(400).json({ error: 'Valid productId is required for product QR.' });
            return;
          }
          const query = new URLSearchParams({
            checkout: 'product',
            product: productId,
          });
          if (growerId && /^[a-zA-Z0-9_-]{1,128}$/.test(growerId)) {
            query.set('store', growerId);
          }
          if (typeof qty === 'number' && Number.isFinite(qty) && qty > 1) {
            query.set('qty', String(Math.min(50, Math.round(qty))));
          }
          if (typeof src === 'string' && src.trim()) {
            query.set('src', src.trim().slice(0, 40));
          }
          const payloadUrl = `${origin}/?${query.toString()}`;
          const [pngDataUrl, svgMarkup] = await Promise.all([
            QRCode.toDataURL(payloadUrl, { width: 512, margin: 2, errorCorrectionLevel: 'H', color: { dark: '#003820', light: '#FFFFFF' } }),
            QRCode.toString(payloadUrl, { type: 'svg', margin: 2, errorCorrectionLevel: 'H', color: { dark: '#003820', light: '#FFFFFF' } }),
          ]);
          res.json({ type, payload: payloadUrl, pngDataUrl, svgMarkup, generatedAt: new Date().toISOString() });
          return;
        }

        if (type === 'pickup' || type === 'delivery') {
          if (!orderId || !orderCode) {
            res.status(400).json({ error: 'orderId and orderCode are required for verification QR tokens.' });
            return;
          }
          const nonce = crypto.randomBytes(16).toString('base64url');
          const ttlMs = type === 'pickup' ? 30 * 60_000 : 60 * 60_000;
          const now = Date.now();
          const expiresAt = now + ttlMs;
          const signedToken = createSignedQrToken({
            n: nonce,
            a: type,
            o: orderId,
            s: sellerOrderId,
            c: orderCode,
            u: req.user!.uid,
            e: expiresAt,
          });

          const record: QrTokenRecord = {
            token: signedToken,
            nonce,
            action: type,
            orderId,
            sellerOrderId,
            assignmentId,
            orderCode,
            handoverPin: handoverPin && /^\d{4}$/.test(handoverPin) ? handoverPin : String(crypto.randomInt(1000, 9999)),
            issuedByUid: req.user!.uid,
            createdAt: now,
            expiresAt,
          };
          qrTokenStore.set(signedToken, record);

          // Safe opaque signed QR payload — zero PII, zero payment secrets
          const qrPayload = JSON.stringify({ v: 2, t: type, k: signedToken });
          const [pngDataUrl, svgMarkup] = await Promise.all([
            QRCode.toDataURL(qrPayload, { width: 320, margin: 2, color: { dark: '#002113', light: '#FFFFFF' } }),
            QRCode.toString(qrPayload, { type: 'svg', margin: 2, color: { dark: '#002113', light: '#FFFFFF' } }),
          ]);

          res.json({
            type,
            token: signedToken,
            payload: qrPayload,
            orderCode,
            expiresAt: new Date(record.expiresAt).toISOString(),
            pngDataUrl,
            svgMarkup,
          });
          return;
        }

        res.status(400).json({ error: 'Invalid QR type. Expected store, product, pickup, or delivery.' });
      } catch (err) {
        res.status(500).json({ error: 'Failed to generate QR image.', detail: (err as Error).message });
      }
    }
  );

  function extractTokenFromScan(rawInput: string): string {
    const trimmed = rawInput.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as { k?: string; token?: string };
        if (typeof parsed.k === 'string') return parsed.k;
        if (typeof parsed.token === 'string') return parsed.token;
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }

  app.post('/api/qr/verify', createRateLimiter(40, 60_000), requireFirebaseAuth, (req: AuthedRequest, res: Response) => {
    const { scannedPayload, expectedAction, expectedOrderId } = req.body as {
      scannedPayload?: string;
      expectedAction?: 'pickup' | 'delivery';
      expectedOrderId?: string;
    };
    if (!scannedPayload || typeof scannedPayload !== 'string') {
      res.status(400).json({ valid: false, error: 'scannedPayload is required.' });
      return;
    }
    const tokenKey = extractTokenFromScan(scannedPayload);
    const record = qrTokenStore.get(tokenKey);

    if (record) {
      if (record.consumedAt || consumedQrNonces.has(record.nonce)) {
        res.status(409).json({ valid: false, code: 'QR_ALREADY_USED', error: 'This single-use QR token has already been consumed.' });
        return;
      }
      if (Date.now() > record.expiresAt) {
        res.status(410).json({ valid: false, code: 'QR_EXPIRED', error: 'This verification QR token has expired. Generate a fresh code.' });
        return;
      }
      if (expectedAction && record.action !== expectedAction) {
        res.status(403).json({ valid: false, code: 'QR_WRONG_ACTION', error: `Token is for ${record.action}, not ${expectedAction}.` });
        return;
      }
      if (expectedOrderId && record.orderId !== expectedOrderId && record.sellerOrderId !== expectedOrderId) {
        res.status(403).json({ valid: false, code: 'QR_WRONG_ORDER', error: 'QR token does not match the active order.' });
        return;
      }

      res.json({
        valid: true,
        action: record.action,
        orderId: record.orderId,
        sellerOrderId: record.sellerOrderId || null,
        orderCode: record.orderCode,
        expiresAt: new Date(record.expiresAt).toISOString(),
      });
      return;
    }

    // Stateless HMAC fallback if signed with persistent QR_SIGNING_SECRET across restarts
    const verified = verifySignedQrToken(tokenKey);
    if (verified.expired) {
      res.status(410).json({ valid: false, code: 'QR_EXPIRED', error: 'This verification QR token has expired.' });
      return;
    }
    if (!verified.valid || !verified.payload) {
      res.status(404).json({ valid: false, code: 'QR_NOT_FOUND', error: 'Unrecognized or invalid QR token.' });
      return;
    }
    if (consumedQrNonces.has(verified.payload.n)) {
      res.status(409).json({ valid: false, code: 'QR_ALREADY_USED', error: 'This single-use QR token has already been consumed.' });
      return;
    }
    if (expectedAction && verified.payload.a !== expectedAction) {
      res.status(403).json({ valid: false, code: 'QR_WRONG_ACTION', error: `Token is for ${verified.payload.a}, not ${expectedAction}.` });
      return;
    }
    if (expectedOrderId && verified.payload.o !== expectedOrderId && verified.payload.s !== expectedOrderId) {
      res.status(403).json({ valid: false, code: 'QR_WRONG_ORDER', error: 'QR token does not match the active order.' });
      return;
    }

    res.json({
      valid: true,
      action: verified.payload.a,
      orderId: verified.payload.o,
      sellerOrderId: verified.payload.s || null,
      orderCode: verified.payload.c,
      expiresAt: new Date(verified.payload.e).toISOString(),
    });
  });

  app.post('/api/qr/register-handover', createRateLimiter(60, 60_000), requireFirebaseAuth, (req: AuthedRequest, res: Response) => {
    const { action, orderId, sellerOrderId, orderCode, handoverPin } = req.body as {
      action?: 'pickup' | 'delivery';
      orderId?: string;
      sellerOrderId?: string;
      orderCode?: string;
      handoverPin?: string;
    };
    const cleanOrderId = typeof orderId === 'string' ? orderId.trim().slice(0, 128) : '';
    const cleanPin = typeof handoverPin === 'string' ? handoverPin.trim() : '';
    const cleanCode = typeof orderCode === 'string' && orderCode.trim() ? orderCode.trim().slice(0, 32) : cleanOrderId;

    if ((action !== 'pickup' && action !== 'delivery') || !cleanOrderId || !/^\d{4}$/.test(cleanPin)) {
      res.status(400).json({ error: 'Valid action (pickup/delivery), orderId, and 4-digit handoverPin are required.' });
      return;
    }

    const key = `${action}:${cleanOrderId}:${cleanPin}`;
    if (!registeredOrderPinStore.has(key)) {
      registeredOrderPinStore.set(key, {
        orderId: cleanOrderId,
        sellerOrderId: typeof sellerOrderId === 'string' ? sellerOrderId.trim().slice(0, 128) : undefined,
        orderCode: cleanCode,
        handoverPin: cleanPin,
        action,
        registeredByUid: req.user!.uid,
        createdAt: Date.now(),
      });
    }
    res.json({ registered: true, action, orderId: cleanOrderId, orderCode: cleanCode });
  });

  app.post('/api/qr/consume', createRateLimiter(40, 60_000), requireFirebaseAuth, (req: AuthedRequest, res: Response) => {
    const { scannedPayload, manualPin, expectedAction, expectedOrderId } = req.body as {
      scannedPayload?: string;
      manualPin?: string;
      expectedAction?: 'pickup' | 'delivery';
      expectedOrderId?: string;
    };

    let record: QrTokenRecord | undefined;

    if (scannedPayload && typeof scannedPayload === 'string') {
      const tokenKey = extractTokenFromScan(scannedPayload);
      record = qrTokenStore.get(tokenKey);

      if (!record) {
        const verified = verifySignedQrToken(tokenKey);
        if (verified.expired) {
          res.status(410).json({ consumed: false, code: 'QR_EXPIRED', error: 'Verification QR token expired.' });
          return;
        }
        if (verified.valid && verified.payload) {
          if (consumedQrNonces.has(verified.payload.n)) {
            res.status(409).json({ consumed: false, code: 'QR_ALREADY_USED', error: 'Replay blocked: QR token already used.' });
            return;
          }
          if (expectedAction && verified.payload.a !== expectedAction) {
            res.status(403).json({ consumed: false, code: 'QR_WRONG_ACTION', error: `Expected ${expectedAction} token.` });
            return;
          }
          if (expectedOrderId && verified.payload.o !== expectedOrderId && verified.payload.s !== expectedOrderId) {
            res.status(403).json({ consumed: false, code: 'QR_WRONG_ORDER', error: 'QR token belongs to a different order.' });
            return;
          }
          consumedQrNonces.add(verified.payload.n);
          const nowIso = new Date().toISOString();
          logSecurityEvent('info', 'qr_consumed_stateless', {
            action: verified.payload.a,
            orderId: verified.payload.o,
            consumedByUid: req.user!.uid,
          });
          res.json({
            consumed: true,
            action: verified.payload.a,
            orderId: verified.payload.o,
            sellerOrderId: verified.payload.s || null,
            orderCode: verified.payload.c,
            verifiedByUid: req.user!.uid,
            verifiedAt: nowIso,
          });
          return;
        }
      }
    } else if (manualPin && expectedOrderId && /^\d{4}$/.test(manualPin)) {
      for (const candidate of qrTokenStore.values()) {
        if (
          (candidate.orderId === expectedOrderId || candidate.sellerOrderId === expectedOrderId) &&
          (!expectedAction || candidate.action === expectedAction) &&
          !candidate.consumedAt &&
          !consumedQrNonces.has(candidate.nonce) &&
          Date.now() <= candidate.expiresAt &&
          candidate.handoverPin === manualPin
        ) {
          record = candidate;
          break;
        }
      }

      if (!record && expectedAction) {
        const regKey = `${expectedAction}:${expectedOrderId}:${manualPin}`;
        const reg = registeredOrderPinStore.get(regKey);
        if (reg) {
          if (reg.consumedAt) {
            res.status(409).json({
              consumed: false,
              code: 'QR_ALREADY_USED',
              error: 'Replay blocked: this handover PIN was already verified.',
            });
            return;
          }
          reg.consumedAt = Date.now();
          logSecurityEvent('info', 'qr_pin_consumed', {
            action: reg.action,
            orderId: reg.orderId,
            consumedByUid: req.user!.uid,
          });
          res.json({
            consumed: true,
            action: reg.action,
            orderId: reg.orderId,
            sellerOrderId: reg.sellerOrderId || null,
            orderCode: reg.orderCode,
            verifiedByUid: req.user!.uid,
            verifiedAt: new Date(reg.consumedAt).toISOString(),
          });
          return;
        }
      }

      if (!record) {
        res.status(403).json({
          consumed: false,
          code: 'INVALID_PIN',
          error: '4-digit handover PIN did not match an active verification token for this order.',
        });
        return;
      }
    } else {
      res.status(400).json({ consumed: false, error: 'Provide either scannedPayload or manualPin with expectedOrderId.' });
      return;
    }

    if (!record) {
      res.status(404).json({ consumed: false, code: 'QR_NOT_FOUND', error: 'Invalid or unknown verification QR code.' });
      return;
    }
    if (record.consumedAt || consumedQrNonces.has(record.nonce)) {
      res.status(409).json({
        consumed: false,
        code: 'QR_ALREADY_USED',
        error: 'Replay blocked: this single-use verification QR was already consumed.',
      });
      return;
    }
    if (Date.now() > record.expiresAt) {
      res.status(410).json({
        consumed: false,
        code: 'QR_EXPIRED',
        error: 'Verification QR token expired. Request a newly generated code.',
      });
      return;
    }
    if (expectedAction && record.action !== expectedAction) {
      res.status(403).json({ consumed: false, code: 'QR_WRONG_ACTION', error: `Expected ${expectedAction} token.` });
      return;
    }
    if (expectedOrderId && record.orderId !== expectedOrderId && record.sellerOrderId !== expectedOrderId) {
      res.status(403).json({ consumed: false, code: 'QR_WRONG_ORDER', error: 'QR token belongs to a different order.' });
      return;
    }

    record.consumedAt = Date.now();
    record.consumedByUid = req.user!.uid;
    consumedQrNonces.add(record.nonce);

    logSecurityEvent('info', 'qr_token_consumed', {
      action: record.action,
      orderId: record.orderId,
      issuedByUid: record.issuedByUid,
      consumedByUid: req.user!.uid,
    });

    res.json({
      consumed: true,
      action: record.action,
      orderId: record.orderId,
      sellerOrderId: record.sellerOrderId || null,
      orderCode: record.orderCode,
      verifiedByUid: req.user!.uid,
      verifiedAt: new Date(record.consumedAt).toISOString(),
    });
  });

  // -------------------------------------------------------------------------
  // 5. Payments API (Real Razorpay + Signed Checkout Quotes + Honest Manual UPI Review)
  // -------------------------------------------------------------------------
  app.post(
    '/api/payments/create',
    createRateLimiter(20, 60_000),
    requireFirebaseAuth,
    async (req: AuthedRequest, res: Response) => {
      const { amountInr, totalPaidPaise, orderCode, receipt, quoteSignature, quoteExpiresAtMs } = req.body as {
        amountInr?: number;
        totalPaidPaise?: number;
        orderCode?: string;
        receipt?: string;
        quoteSignature?: string;
        quoteExpiresAtMs?: number;
      };

      const resolvedPaise =
        typeof totalPaidPaise === 'number' && Number.isInteger(totalPaidPaise)
          ? totalPaidPaise
          : typeof amountInr === 'number'
            ? toPaise(amountInr)
            : 0;

      if (!orderCode || resolvedPaise <= 0 || resolvedPaise > 50_500_000) {
        res.status(400).json({ error: 'Valid positive amount and orderCode are required.' });
        return;
      }

      // Require server-signed checkout quote so clients cannot tamper payment amounts
      if (
        !quoteSignature ||
        typeof quoteSignature !== 'string' ||
        typeof quoteExpiresAtMs !== 'number' ||
        !verifyCheckoutQuoteSignature({
          uid: req.user!.uid,
          orderCode,
          totalPaidPaise: resolvedPaise,
          expiresAtMs: quoteExpiresAtMs,
          signature: quoteSignature,
        })
      ) {
        logSecurityEvent('warn', 'payment_create_invalid_quote_signature', { uid: req.user!.uid, orderCode });
        res.status(400).json({
          error: 'Checkout quote signature is invalid or expired. Please re-validate your basket.',
          code: 'QUOTE_TAMPERED_OR_EXPIRED',
        });
        return;
      }

      const rzp = getRazorpayConfig();
      if (!rzp.isConfigured) {
        res.status(503).json({
          configured: false,
          error:
            'Razorpay server credentials (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET) are not configured. Online card/UPI gateway is disabled; select Verified Doorstep QR / Cash on Delivery instead.',
        });
        return;
      }

      try {
        const authBasic = Buffer.from(`${rzp.keyId}:${rzp.keySecret}`).toString('base64');
        const upstream = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            Authorization: `Basic ${authBasic}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount: resolvedPaise,
            currency: 'INR',
            receipt: (receipt || orderCode).slice(0, 40),
            notes: {
              orderCode,
              customerUid: req.user!.uid,
            },
          }),
        });

        const payload = (await upstream.json()) as Record<string, unknown>;
        if (!upstream.ok) {
          res.status(upstream.status).json({
            error: 'Razorpay order creation failed.',
            providerError: payload,
          });
          return;
        }

        res.json({
          configured: true,
          keyId: rzp.keyId,
          razorpayOrderId: payload.id,
          amount: payload.amount,
          currency: payload.currency,
          orderCode,
        });
      } catch (err) {
        res.status(502).json({
          error: 'Could not reach Razorpay payment gateway.',
          detail: (err as Error).message,
        });
      }
    }
  );

  app.post(
    '/api/payments/verify',
    createRateLimiter(20, 60_000),
    requireFirebaseAuth,
    (req: AuthedRequest, res: Response) => {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body as {
        razorpay_order_id?: string;
        razorpay_payment_id?: string;
        razorpay_signature?: string;
      };

      const rzp = getRazorpayConfig();
      if (!rzp.isConfigured) {
        res.status(503).json({ verified: false, error: 'Razorpay verification secret is not configured on server.' });
        return;
      }

      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        res.status(400).json({ verified: false, error: 'Missing razorpay_order_id, razorpay_payment_id, or razorpay_signature.' });
        return;
      }

      const expectedSig = crypto
        .createHmac('sha256', rzp.keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

      const sigBuf = Buffer.from(razorpay_signature, 'utf8');
      const expBuf = Buffer.from(expectedSig, 'utf8');
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        logSecurityEvent('warn', 'razorpay_signature_mismatch', { uid: req.user!.uid, orderId: razorpay_order_id });
        res.status(400).json({ verified: false, error: 'Payment cryptographic signature mismatch.' });
        return;
      }

      res.json({
        verified: true,
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id,
        verifiedAt: new Date().toISOString(),
      });
    }
  );

  // Honest Manual Direct UPI UTR Submission — NEVER auto-marks verified without bank/gateway confirmation
  app.post(
    '/api/payments/upi-verify',
    createRateLimiter(25, 60_000),
    requireFirebaseAuth,
    (req: AuthedRequest, res: Response) => {
      const { orderCode, amountInr, utrNumber, payerUpiId } = req.body as {
        orderCode?: string;
        amountInr?: number;
        utrNumber?: string;
        payerUpiId?: string;
      };
      const cleanCode = typeof orderCode === 'string' ? orderCode.trim().slice(0, 32) : '';
      const amountPaise = typeof amountInr === 'number' && Number.isFinite(amountInr) ? toPaise(amountInr) : 0;
      const cleanUtr = typeof utrNumber === 'string' ? utrNumber.replace(/\s+/g, '').toUpperCase() : '';

      if (!cleanCode || amountPaise <= 0 || amountPaise > 50_500_000) {
        res.status(400).json({ submitted: false, verified: false, error: 'Valid orderCode and positive amountInr are required.' });
        return;
      }
      if (!/^[A-Z0-9]{12,22}$/.test(cleanUtr)) {
        res.status(400).json({
          submitted: false,
          verified: false,
          code: 'INVALID_UPI_UTR',
          error: 'Enter the valid 12-digit UPI UTR / Reference ID from your GPay, PhonePe, Paytm, or BHIM payment receipt.',
        });
        return;
      }
      if (submittedUpiUtrStore.has(cleanUtr)) {
        res.status(409).json({
          submitted: false,
          verified: false,
          code: 'DUPLICATE_UPI_UTR',
          error: 'This UPI UTR reference has already been submitted for another payment.',
        });
        return;
      }

      submittedUpiUtrStore.add(cleanUtr);
      logSecurityEvent('info', 'upi_utr_submitted_pending_review', {
        uid: req.user!.uid,
        orderCode: cleanCode,
        amountPaise,
      });

      res.status(202).json({
        submitted: true,
        verified: false,
        paymentStatus: 'pending_upi_review',
        paymentId: `upi_pending_${cleanUtr}`,
        orderCode: cleanCode,
        amountInr: fromPaise(amountPaise),
        payerUpiId: typeof payerUpiId === 'string' ? payerUpiId.trim().slice(0, 80) : undefined,
        message: 'UTR logged for bank statement reconciliation. Payment will be confirmed once verified.',
        submittedAt: new Date().toISOString(),
      });
    }
  );

  // Honest Wallet Top-Up UTR Submission — NEVER auto-credits walletBalance without verified bank credit
  app.post(
    '/api/wallet/verify-topup',
    createRateLimiter(25, 60_000),
    requireFirebaseAuth,
    (req: AuthedRequest, res: Response) => {
      const { amountInr, method, utrNumber } = req.body as {
        amountInr?: number;
        method?: string;
        utrNumber?: string;
      };
      const amountPaise = typeof amountInr === 'number' && Number.isFinite(amountInr) ? toPaise(amountInr) : 0;
      const cleanMethod = typeof method === 'string' && method.trim() ? method.trim().slice(0, 60) : 'Direct UPI QR';
      const cleanUtr = typeof utrNumber === 'string' ? utrNumber.replace(/\s+/g, '').toUpperCase() : '';

      if (amountPaise < 1000 || amountPaise > 5_000_000) {
        res.status(400).json({ submitted: false, verified: false, error: 'Top-up amount must be between ₹10 and ₹50,000.' });
        return;
      }
      if (!/^[A-Z0-9]{12,22}$/.test(cleanUtr)) {
        res.status(400).json({
          submitted: false,
          verified: false,
          error: 'Enter a valid 12-digit UPI UTR / Reference ID to submit your wallet top-up for verification.',
        });
        return;
      }
      if (submittedUpiUtrStore.has(cleanUtr)) {
        res.status(409).json({ submitted: false, verified: false, error: 'This UTR reference has already been submitted.' });
        return;
      }

      submittedUpiUtrStore.add(cleanUtr);
      logSecurityEvent('info', 'wallet_topup_submitted_pending', {
        uid: req.user!.uid,
        amountPaise,
      });

      res.status(202).json({
        submitted: true,
        verified: false,
        status: 'pending_verification',
        amountInr: fromPaise(amountPaise),
        method: cleanMethod,
        referenceId: `wlt_pending_${cleanUtr}`,
        message: 'Top-up UTR submitted for bank verification. Your wallet balance will be credited once confirmed.',
        submittedAt: new Date().toISOString(),
      });
    }
  );

  // Restricted Refund Endpoint — Strictly requires verified Operator Admin authorization
  app.post(
    '/api/refunds',
    createRateLimiter(15, 60_000),
    requireFirebaseAuth,
    requireOperatorAdmin,
    async (req: AuthedRequest, res: Response) => {
      const { paymentId, amountInr, reason } = req.body as {
        paymentId?: string;
        amountInr?: number;
        reason?: string;
      };
      if (!paymentId || typeof amountInr !== 'number' || amountInr <= 0 || !reason) {
        res.status(400).json({ error: 'paymentId, positive amountInr, and reason are required.' });
        return;
      }
      const rzp = getRazorpayConfig();
      if (!rzp.isConfigured) {
        res.status(503).json({
          configured: false,
          error: 'Razorpay credentials not configured. Refund cannot be issued via gateway.',
        });
        return;
      }

      try {
        const authBasic = Buffer.from(`${rzp.keyId}:${rzp.keySecret}`).toString('base64');
        const upstream = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refund`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${authBasic}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount: toPaise(amountInr),
            notes: { reason: reason.slice(0, 200), requestedBy: req.user!.uid },
          }),
        });
        const data = (await upstream.json()) as Record<string, unknown>;
        if (!upstream.ok) {
          res.status(upstream.status).json({ error: 'Gateway refund failed.', providerError: data });
          return;
        }
        logSecurityEvent('info', 'refund_issued', {
          operatorUid: req.user!.uid,
          paymentId,
          amountPaise: toPaise(amountInr),
        });
        res.json({ refundId: data.id, status: data.status, amount: data.amount });
      } catch (err) {
        res.status(502).json({ error: 'Unable to contact Razorpay refund endpoint.', detail: (err as Error).message });
      }
    }
  );

  // -------------------------------------------------------------------------
  // 6. OpenStreetMap / OSRM / Photon & Hyperlocal Serviceability Endpoints
  // -------------------------------------------------------------------------
  app.post(
    '/api/maps/serviceability',
    createRateLimiter(60, 60_000),
    requireFirebaseAuth,
    (req: AuthedRequest, res: Response) => {
      const { lat, lng } = req.body as { lat?: number; lng?: number };
      if (!isValidLatLng(lat, lng)) {
        res.status(400).json({ error: 'Valid numeric lat and lng coordinates are required.' });
        return;
      }

      const ranked = SERVICE_CLUSTERS.map((cluster) => ({
        ...cluster,
        distanceKm: Math.round(haversineKm(lat, lng as number, cluster.lat, cluster.lng) * 100) / 100,
      })).sort((a, b) => a.distanceKm - b.distanceKm);

      const nearest = ranked[0];
      const serviceable = nearest.distanceKm <= nearest.radiusKm;

      res.json({
        serviceable,
        nearestCluster: nearest.name,
        distanceKm: nearest.distanceKm,
        maxRadiusKm: nearest.radiusKm,
        estimatedEtaMins: serviceable ? Math.max(15, Math.round(12 + nearest.distanceKm * 4)) : null,
        etaBasis: 'distance_estimate',
        message: serviceable
          ? `Serviceable via ${nearest.name} (${nearest.distanceKm} km away).`
          : `Location is ${nearest.distanceKm} km from ${nearest.name} (exceeds 10 km hyperlocal freshness radius).`,
      });
    }
  );

  app.post(
    '/api/maps/search',
    createRateLimiter(45, 60_000),
    requireFirebaseAuth,
    async (req: AuthedRequest, res: Response) => {
      const { query, biasLat, biasLng, limit } = req.body as {
        query?: string;
        biasLat?: number;
        biasLng?: number;
        limit?: number;
      };

      const trimmed = typeof query === 'string' ? query.trim() : '';
      if (trimmed.length < 2 || trimmed.length > 160) {
        res.status(400).json({ error: 'Search query must be between 2 and 160 characters.' });
        return;
      }

      const safeLimit = Math.min(8, Math.max(1, Number.isFinite(limit) ? Number(limit) : 5));
      const useBias = isValidLatLng(biasLat, biasLng);
      const latBias = useBias ? (biasLat as number) : 12.9716;
      const lngBias = useBias ? (biasLng as number) : 77.5946;
      const cacheKey = `${trimmed.toLowerCase()}|${latBias.toFixed(2)},${lngBias.toFixed(2)}|${safeLimit}`;

      const cached = mapSearchCache.get(cacheKey);
      if (cached) {
        res.json({
          results: cached,
          provider: 'photon-osm',
          attribution: '© OpenStreetMap contributors',
          cached: true,
        });
        return;
      }

      const cfg = getMapsProviderConfig();
      const headers = {
        Accept: 'application/json',
        'User-Agent': cfg.userAgent,
      };

      // Primary: Photon (OSM-based autocomplete)
      try {
        const photonUrl = new URL(`${cfg.geocoderBaseUrl}/api/`);
        photonUrl.searchParams.set('q', trimmed);
        photonUrl.searchParams.set('limit', String(safeLimit));
        photonUrl.searchParams.set('lang', 'en');
        photonUrl.searchParams.set('lat', String(latBias));
        photonUrl.searchParams.set('lon', String(lngBias));

        const upstream = await fetch(photonUrl.toString(), {
          headers,
          signal: AbortSignal.timeout(6500),
        });

        if (upstream.status === 429) {
          res.status(429).json({
            error: 'Address search provider is temporarily rate-limited. Please wait a moment or enter address manually.',
            code: 'maps/rate-limited',
          });
          return;
        }

        if (upstream.ok) {
          const data = (await upstream.json()) as {
            features?: Array<{
              geometry?: { coordinates?: [number, number] };
              properties?: Record<string, unknown>;
            }>;
          };
          const normalized = (data.features || [])
            .map(formatPhotonFeature)
            .filter((item): item is NormalizedPlaceResult => item !== null)
            .slice(0, safeLimit);

          mapSearchCache.set(cacheKey, normalized);
          res.json({
            results: normalized,
            provider: 'photon-osm',
            attribution: '© OpenStreetMap contributors',
            cached: false,
          });
          return;
        }
      } catch {
        // Fall through to Nominatim fallback below
      }

      // Secondary fallback: Nominatim search
      try {
        const nomUrl = new URL(`${cfg.nominatimBaseUrl}/search`);
        nomUrl.searchParams.set('q', trimmed);
        nomUrl.searchParams.set('format', 'jsonv2');
        nomUrl.searchParams.set('addressdetails', '1');
        nomUrl.searchParams.set('countrycodes', 'in');
        nomUrl.searchParams.set('limit', String(safeLimit));

        const nomRes = await fetch(nomUrl.toString(), {
          headers,
          signal: AbortSignal.timeout(7000),
        });

        if (nomRes.status === 429) {
          res.status(429).json({
            error: 'Geocoding service is rate-limited. Please retry shortly or drag the map pin manually.',
            code: 'maps/rate-limited',
          });
          return;
        }

        if (!nomRes.ok) {
          res.status(502).json({ error: 'Unable to reach address search service right now.', code: 'maps/upstream-error' });
          return;
        }

        const items = (await nomRes.json()) as Array<{
          place_id?: number | string;
          display_name?: string;
          name?: string;
          lat?: string;
          lon?: string;
        }>;

        const normalized: NormalizedPlaceResult[] = [];
        for (const item of items) {
          const parsedLat = Number(item.lat);
          const parsedLng = Number(item.lon);
          if (!isValidLatLng(parsedLat, parsedLng) || !item.display_name) continue;
          const parts = item.display_name.split(',').map((s) => s.trim()).filter(Boolean);
          const title = item.name?.trim() || parts[0] || item.display_name;
          const subtitle = parts.slice(1).join(', ');
          normalized.push({
            id: `nom_${item.place_id ?? `${parsedLat.toFixed(5)}_${parsedLng.toFixed(5)}`}`,
            title,
            subtitle,
            formattedAddress: item.display_name,
            lat: parsedLat,
            lng: parsedLng,
          });
        }

        mapSearchCache.set(cacheKey, normalized);
        res.json({
          results: normalized,
          provider: 'nominatim-osm',
          attribution: '© OpenStreetMap contributors',
          cached: false,
        });
      } catch (err) {
        res.status(502).json({
          error: 'Failed to contact OpenStreetMap address search service.',
          code: 'maps/network-error',
          detail: (err as Error).message,
        });
      }
    }
  );

  app.post(
    '/api/maps/geocode',
    createRateLimiter(30, 60_000),
    requireFirebaseAuth,
    async (req: AuthedRequest, res: Response) => {
      const { address, lat, lng } = req.body as { address?: string; lat?: number; lng?: number };
      const cfg = getMapsProviderConfig();
      const headers = {
        Accept: 'application/json',
        'User-Agent': cfg.userAgent,
      };

      // Reverse geocoding: lat/lng -> formattedAddress
      if (isValidLatLng(lat, lng)) {
        const safeLat = lat as number;
        const safeLng = lng as number;
        const revKey = `${safeLat.toFixed(4)},${safeLng.toFixed(4)}`;
        const cached = mapReverseCache.get(revKey);
        if (cached) {
          res.json({
            formattedAddress: cached.formattedAddress,
            placeId: cached.id,
            lat: safeLat,
            lng: safeLng,
            provider: 'photon-osm',
            attribution: '© OpenStreetMap contributors',
            cached: true,
          });
          return;
        }

        try {
          const photonRev = new URL(`${cfg.geocoderBaseUrl}/reverse`);
          photonRev.searchParams.set('lat', String(safeLat));
          photonRev.searchParams.set('lon', String(safeLng));
          photonRev.searchParams.set('lang', 'en');

          const upstream = await fetch(photonRev.toString(), {
            headers,
            signal: AbortSignal.timeout(6500),
          });
          if (upstream.ok) {
            const data = (await upstream.json()) as {
              features?: Array<{
                geometry?: { coordinates?: [number, number] };
                properties?: Record<string, unknown>;
              }>;
            };
            const first = (data.features || []).map(formatPhotonFeature).find((x): x is NormalizedPlaceResult => x !== null);
            if (first) {
              mapReverseCache.set(revKey, first);
              res.json({
                formattedAddress: first.formattedAddress,
                placeId: first.id,
                lat: safeLat,
                lng: safeLng,
                provider: 'photon-osm',
                attribution: '© OpenStreetMap contributors',
                cached: false,
              });
              return;
            }
          }
        } catch {
          // Fallback to Nominatim reverse below
        }

        try {
          const nomRev = new URL(`${cfg.nominatimBaseUrl}/reverse`);
          nomRev.searchParams.set('lat', String(safeLat));
          nomRev.searchParams.set('lon', String(safeLng));
          nomRev.searchParams.set('format', 'jsonv2');
          nomRev.searchParams.set('zoom', '18');

          const nomRes = await fetch(nomRev.toString(), {
            headers,
            signal: AbortSignal.timeout(7000),
          });
          if (nomRes.status === 429) {
            res.status(429).json({ error: 'Reverse geocoding rate-limited. You can type your street address directly.', code: 'maps/rate-limited' });
            return;
          }
          if (nomRes.ok) {
            const item = (await nomRes.json()) as { place_id?: number | string; display_name?: string };
            if (item.display_name) {
              const result: NormalizedPlaceResult = {
                id: `nom_${item.place_id ?? revKey}`,
                title: item.display_name.split(',')[0] || item.display_name,
                subtitle: '',
                formattedAddress: item.display_name,
                lat: safeLat,
                lng: safeLng,
              };
              mapReverseCache.set(revKey, result);
              res.json({
                formattedAddress: result.formattedAddress,
                placeId: result.id,
                lat: safeLat,
                lng: safeLng,
                provider: 'nominatim-osm',
                attribution: '© OpenStreetMap contributors',
                cached: false,
              });
              return;
            }
          }
          res.status(404).json({ error: 'No street address found for these coordinates.', code: 'maps/no-result' });
          return;
        } catch (err) {
          res.status(502).json({
            error: 'Unable to resolve street address for this pin right now.',
            code: 'maps/network-error',
            detail: (err as Error).message,
          });
          return;
        }
      }

      // Forward geocoding: address string -> coordinates
      if (typeof address === 'string' && address.trim().length >= 3) {
        const trimmed = address.trim();
        const cacheKey = `${trimmed.toLowerCase()}|12.97,77.59|1`;
        const cachedList = mapSearchCache.get(cacheKey);
        if (cachedList && cachedList.length > 0) {
          const top = cachedList[0];
          res.json({
            formattedAddress: top.formattedAddress,
            placeId: top.id,
            lat: top.lat,
            lng: top.lng,
            provider: 'photon-osm',
            attribution: '© OpenStreetMap contributors',
            cached: true,
          });
          return;
        }

        try {
          const photonUrl = new URL(`${cfg.geocoderBaseUrl}/api/`);
          photonUrl.searchParams.set('q', trimmed);
          photonUrl.searchParams.set('limit', '1');
          photonUrl.searchParams.set('lang', 'en');
          photonUrl.searchParams.set('lat', '12.9716');
          photonUrl.searchParams.set('lon', '77.5946');

          const upstream = await fetch(photonUrl.toString(), {
            headers,
            signal: AbortSignal.timeout(6500),
          });
          if (upstream.status === 429) {
            res.status(429).json({ error: 'Geocoding service rate-limited. Please retry shortly.', code: 'maps/rate-limited' });
            return;
          }
          if (upstream.ok) {
            const data = (await upstream.json()) as {
              features?: Array<{
                geometry?: { coordinates?: [number, number] };
                properties?: Record<string, unknown>;
              }>;
            };
            const top = (data.features || []).map(formatPhotonFeature).find((x): x is NormalizedPlaceResult => x !== null);
            if (top) {
              mapSearchCache.set(cacheKey, [top]);
              res.json({
                formattedAddress: top.formattedAddress,
                placeId: top.id,
                lat: top.lat,
                lng: top.lng,
                provider: 'photon-osm',
                attribution: '© OpenStreetMap contributors',
                cached: false,
              });
              return;
            }
          }
          res.status(404).json({ error: 'No matching address found on OpenStreetMap.', code: 'maps/no-result' });
          return;
        } catch (err) {
          res.status(502).json({
            error: 'Failed to contact OpenStreetMap geocoding service.',
            code: 'maps/network-error',
            detail: (err as Error).message,
          });
          return;
        }
      }

      res.status(400).json({ error: 'Provide either a valid address string (3+ chars) or valid numeric lat/lng.' });
    }
  );

  app.post(
    '/api/maps/route',
    createRateLimiter(40, 60_000),
    requireFirebaseAuth,
    async (req: AuthedRequest, res: Response) => {
      const { origin, destination } = req.body as {
        origin?: { lat: number; lng: number };
        destination?: { lat: number; lng: number };
      };
      if (!origin || !destination || !isValidLatLng(origin.lat, origin.lng) || !isValidLatLng(destination.lat, destination.lng)) {
        res.status(400).json({ error: 'Valid numeric origin and destination { lat, lng } are required.' });
        return;
      }

      const straightLineKm = Math.round(haversineKm(origin.lat, origin.lng, destination.lat, destination.lng) * 100) / 100;
      const routeKey = `${origin.lat.toFixed(4)},${origin.lng.toFixed(4)}->${destination.lat.toFixed(4)},${destination.lng.toFixed(4)}`;

      const cached = mapRouteCache.get(routeKey);
      if (cached) {
        res.json({
          ...cached,
          straightLineKm,
          includesTraffic: false,
          etaBasis: 'route_estimate_no_traffic',
          provider: 'osrm',
          attribution: 'Routing by OSRM · Map data © OpenStreetMap contributors',
          cached: true,
        });
        return;
      }

      const cfg = getMapsProviderConfig();
      const osrmUrl = `${cfg.osrmBaseUrl}/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=false`;

      try {
        const upstream = await fetch(osrmUrl, {
          headers: {
            Accept: 'application/json',
            'User-Agent': cfg.userAgent,
          },
          signal: AbortSignal.timeout(8000),
        });

        if (upstream.status === 429) {
          res.status(429).json({
            error: 'Routing provider rate-limited. Retrying automatically shortly.',
            code: 'maps/rate-limited',
            straightLineKm,
          });
          return;
        }

        const data = (await upstream.json().catch(() => ({}))) as {
          code?: string;
          message?: string;
          routes?: Array<{
            distance?: number;
            duration?: number;
            geometry?: {
              type?: string;
              coordinates?: [number, number][];
            };
          }>;
        };

        if (!upstream.ok || data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
          const isNoRoute = data.code === 'NoRoute' || data.code === 'NoSegment';
          res.status(isNoRoute ? 404 : 502).json({
            error: isNoRoute
              ? 'No drivable road route found between these coordinates.'
              : data.message || 'OSRM routing service did not return a valid route.',
            code: isNoRoute ? 'maps/no-route' : 'maps/upstream-error',
            straightLineKm,
          });
          return;
        }

        const route = data.routes[0];
        const coords =
          route.geometry?.type === 'LineString' && Array.isArray(route.geometry.coordinates)
            ? route.geometry.coordinates
            : [];

        if (coords.length < 2) {
          res.status(404).json({
            error: 'Road geometry unavailable for these coordinates.',
            code: 'maps/no-route',
            straightLineKm,
          });
          return;
        }

        const distanceMeters = Math.round(route.distance ?? straightLineKm * 1000);
        const distanceKm = Math.round((distanceMeters / 1000) * 100) / 100;
        const durationSec = Math.max(60, Math.round(route.duration ?? distanceKm * 180));
        const durationMins = Math.max(1, Math.round(durationSec / 60));

        const payload = {
          distanceMeters,
          distanceKm,
          durationSec,
          durationMins,
          geometry: {
            type: 'LineString' as const,
            coordinates: coords,
          },
        };

        mapRouteCache.set(routeKey, payload);

        res.json({
          ...payload,
          straightLineKm,
          includesTraffic: false,
          etaBasis: 'route_estimate_no_traffic',
          provider: 'osrm',
          attribution: 'Routing by OSRM · Map data © OpenStreetMap contributors',
          cached: false,
        });
      } catch (err) {
        res.status(502).json({
          error: 'Failed to contact road routing service.',
          code: 'maps/network-error',
          straightLineKm,
          detail: (err as Error).message,
        });
      }
    }
  );

  // -------------------------------------------------------------------------
  // 6b. Server-Side Gemini AI Map & Location Intelligence (@google/genai)
  // -------------------------------------------------------------------------
  app.post(
    '/api/maps/ai-locate',
    createRateLimiter(20, 60_000),
    requireFirebaseAuth,
    async (req: AuthedRequest, res: Response) => {
      const { description, biasLat, biasLng } = req.body as {
        description?: string;
        biasLat?: number;
        biasLng?: number;
      };

      const trimmed = typeof description === 'string' ? description.trim() : '';
      if (trimmed.length < 3 || trimmed.length > 240) {
        res.status(400).json({ error: 'Describe a street, landmark, or area (3–240 characters).' });
        return;
      }

      const ai = getServerGeminiClient();
      if (!ai) {
        res.status(503).json({
          error: 'AI location search is not configured on the server yet. Use standard OSM search or drag the map pin.',
          code: 'ai/not-configured',
        });
        return;
      }

      try {
        const useBias = isValidLatLng(biasLat, biasLng);
        const latBias = useBias ? (biasLat as number) : 12.9716;
        const lngBias = useBias ? (biasLng as number) : 77.5946;

        const aiResp = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `User location description: "${trimmed}". Reference area bias coordinates: ${latBias.toFixed(4)}, ${lngBias.toFixed(4)} (India / Bengaluru hyperlocal context unless another city is named).`,
          config: {
            systemInstruction:
              'You normalize natural-language delivery location descriptions into clean OpenStreetMap geocoding search queries. Never invent coordinates. Keep strings concise and factual.',
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                cleanQuery: {
                  type: Type.STRING,
                  description: 'Clean street/landmark + locality + city query suitable for OpenStreetMap Photon/Nominatim search.',
                },
                areaHint: {
                  type: Type.STRING,
                  description: 'Short neighborhood or landmark summary (max 12 words).',
                },
                deliveryNoteSuggestion: {
                  type: Type.STRING,
                  description: 'Short practical delivery instruction extracted from the description (max 16 words).',
                },
              },
              required: ['cleanQuery', 'areaHint', 'deliveryNoteSuggestion'],
            },
          },
        });

        const parsed = JSON.parse((aiResp.text ?? '{}').trim()) as {
          cleanQuery?: string;
          areaHint?: string;
          deliveryNoteSuggestion?: string;
        };
        const cleanQuery = (parsed.cleanQuery || trimmed).trim().slice(0, 140);

        // Execute real OSM search (Photon primary, Nominatim fallback) using the AI-normalized query
        const cfg = getMapsProviderConfig();
        const headers = { Accept: 'application/json', 'User-Agent': cfg.userAgent };
        let results: NormalizedPlaceResult[] = [];

        try {
          const photonUrl = new URL(`${cfg.geocoderBaseUrl}/api/`);
          photonUrl.searchParams.set('q', cleanQuery);
          photonUrl.searchParams.set('limit', '5');
          photonUrl.searchParams.set('lang', 'en');
          photonUrl.searchParams.set('lat', String(latBias));
          photonUrl.searchParams.set('lon', String(lngBias));

          const pRes = await fetch(photonUrl.toString(), { headers, signal: AbortSignal.timeout(6500) });
          if (pRes.ok) {
            const pData = (await pRes.json()) as {
              features?: Array<{ geometry?: { coordinates?: [number, number] }; properties?: Record<string, unknown> }>;
            };
            results = (pData.features || [])
              .map(formatPhotonFeature)
              .filter((item): item is NormalizedPlaceResult => item !== null)
              .slice(0, 5);
          }
        } catch {
          // Fall through to Nominatim
        }

        if (results.length === 0) {
          try {
            const nomUrl = new URL(`${cfg.nominatimBaseUrl}/search`);
            nomUrl.searchParams.set('q', cleanQuery);
            nomUrl.searchParams.set('format', 'jsonv2');
            nomUrl.searchParams.set('addressdetails', '1');
            nomUrl.searchParams.set('countrycodes', 'in');
            nomUrl.searchParams.set('limit', '5');
            const nRes = await fetch(nomUrl.toString(), { headers, signal: AbortSignal.timeout(7000) });
            if (nRes.ok) {
              const nData = (await nRes.json()) as Array<{
                place_id?: number;
                display_name?: string;
                lat?: string;
                lon?: string;
                name?: string;
              }>;
              results = (Array.isArray(nData) ? nData : [])
                .map((row) => {
                  const lat = Number(row.lat);
                  const lng = Number(row.lon);
                  if (!isValidLatLng(lat, lng)) return null;
                  const full = String(row.display_name || '').trim();
                  const parts = full.split(',').map((s) => s.trim()).filter(Boolean);
                  return {
                    id: `nom-${row.place_id ?? `${lat},${lng}`}`,
                    title: row.name?.trim() || parts[0] || full,
                    subtitle: parts.slice(1, 4).join(', '),
                    formattedAddress: full,
                    lat,
                    lng,
                  };
                })
                .filter((item): item is NormalizedPlaceResult => item !== null)
                .slice(0, 5);
            }
          } catch {
            // Return empty verified results cleanly
          }
        }

        res.json({
          cleanQuery,
          areaHint: parsed.areaHint || '',
          deliveryNoteSuggestion: parsed.deliveryNoteSuggestion || '',
          results,
          provider: 'gemini+osm',
          attribution: 'AI Query Assist · Map search © OpenStreetMap contributors',
        });
      } catch (err) {
        logSecurityEvent('warn', 'ai_locate_error', { message: (err as Error).message });
        res.status(502).json({
          error: 'AI location assist failed right now. Please try standard address search.',
          code: 'ai/upstream-error',
        });
      }
    }
  );

  app.post(
    '/api/maps/ai-insights',
    createRateLimiter(25, 60_000),
    requireFirebaseAuth,
    async (req: AuthedRequest, res: Response) => {
      const {
        mode,
        address,
        lat,
        lng,
        farmName,
        dropoffLabel,
        distanceKm,
        durationMins,
        stage,
        serviceable,
        localHour,
      } = req.body as {
        mode?: 'location' | 'delivery';
        address?: string;
        lat?: number;
        lng?: number;
        farmName?: string;
        dropoffLabel?: string;
        distanceKm?: number | null;
        durationMins?: number | null;
        stage?: string;
        serviceable?: boolean | null;
        localHour?: number;
      };

      if (!isValidLatLng(lat, lng)) {
        res.status(400).json({ error: 'Valid latitude and longitude are required.' });
        return;
      }

      const ai = getServerGeminiClient();
      if (!ai) {
        res.status(503).json({
          error: 'AI map insights are not configured on the server yet.',
          code: 'ai/not-configured',
        });
        return;
      }

      const hour = typeof localHour === 'number' && Number.isFinite(localHour) ? Math.max(0, Math.min(23, Math.round(localHour))) : 12;
      const safeMode = mode === 'delivery' ? 'delivery' : 'location';

      const promptContext =
        safeMode === 'delivery'
          ? `Mode: Live fresh-produce EV delivery tracking.
Pickup: ${farmName || 'Grower Hub'}.
Drop-off: ${dropoffLabel || address || 'Customer doorstep'}.
Coordinates: ${lat!.toFixed(5)}, ${lng!.toFixed(5)}.
Delivery stage: ${stage || 'active'}.
OSRM Road Distance: ${typeof distanceKm === 'number' ? `${distanceKm} km` : 'calculating'}.
OSRM Route ETA (excludes live traffic): ${typeof durationMins === 'number' ? `${durationMins} min` : 'calculating'}.
Local hour (24h): ${hour}.`
          : `Mode: Customer/Grower doorstep location selection.
Pinned address: ${address || 'Selected map pin'}.
Coordinates: ${lat!.toFixed(5)}, ${lng!.toFixed(5)}.
Within 10 km hyperlocal service zone: ${serviceable === true ? 'Yes' : serviceable === false ? 'No' : 'Checking'}.
Local hour (24h): ${hour}.`;

      try {
        const aiResp = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: promptContext,
          config: {
            systemInstruction:
              'You are a hyperlocal fresh-produce delivery map assistant for Zenvego. Provide concise, practical, truthful guidance strictly based on the provided address, coordinates, and route metrics. Never invent traffic conditions, fake partner names, or fake ETAs. Recommend map style "dark" when localHour >= 19 or localHour <= 5, "liberty" for detailed 3D landmark orientation, or "bright" for clear daytime street visibility.',
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                areaBrief: {
                  type: Type.STRING,
                  description: 'One concise sentence summarizing the pinned area or active route leg.',
                },
                dropTip: {
                  type: Type.STRING,
                  description: 'One concise, actionable doorstep pin or EV scooter handover tip.',
                },
                etaSummary: {
                  type: Type.STRING,
                  description: 'Short factual freshness/ETA summary grounded strictly in the provided numbers.',
                },
                recommendedMapStyle: {
                  type: Type.STRING,
                  description: 'One of: bright, liberty, dark',
                },
                recommendedStyleReason: {
                  type: Type.STRING,
                  description: 'Brief 4-8 word reason for the suggested map view style.',
                },
              },
              required: ['areaBrief', 'dropTip', 'etaSummary', 'recommendedMapStyle', 'recommendedStyleReason'],
            },
          },
        });

        const parsed = JSON.parse((aiResp.text ?? '{}').trim()) as {
          areaBrief?: string;
          dropTip?: string;
          etaSummary?: string;
          recommendedMapStyle?: string;
          recommendedStyleReason?: string;
        };

        const rawStyle = (parsed.recommendedMapStyle || '').toLowerCase();
        const recommendedMapStyle: 'bright' | 'liberty' | 'dark' =
          rawStyle === 'dark' ? 'dark' : rawStyle === 'liberty' ? 'liberty' : 'bright';

        res.json({
          areaBrief: parsed.areaBrief || '',
          dropTip: parsed.dropTip || '',
          etaSummary: parsed.etaSummary || '',
          recommendedMapStyle,
          recommendedStyleReason: parsed.recommendedStyleReason || 'Best visibility for current view',
          model: 'gemini-4-hydrogen',
        });
      } catch (err) {
        logSecurityEvent('warn', 'ai_insights_error', { message: (err as Error).message });
        res.status(502).json({
          error: 'Unable to fetch AI map insights right now. Please retry.',
          code: 'ai/upstream-error',
        });
      }
    }
  );

  // -------------------------------------------------------------------------
  // 7. Authorized Live Tracking Snapshot Endpoint (REST companion to Socket.IO)
  // -------------------------------------------------------------------------
  app.get(
    '/api/tracking/:orderId',
    createRateLimiter(60, 60_000),
    requireFirebaseAuth,
    async (req: AuthedRequest, res: Response) => {
      const orderId = String(req.params.orderId || '').trim();
      const assignmentId = typeof req.query.assignmentId === 'string' ? req.query.assignmentId.trim() : undefined;
      const roleParam = req.query.role === 'partner' || req.query.role === 'grower' ? req.query.role : 'customer';
      const idToken = (req.headers.authorization || '').slice(7).trim();

      const authRes = await verifyFirestoreTrackingAuthorization({
        projectId: firebaseProjectId,
        databaseId: firestoreDatabaseId,
        idToken,
        uid: req.user!.uid,
        orderId,
        assignmentId,
        role: roleParam,
      });

      if (!authRes.authorized) {
        const status = authRes.code === 'NOT_FOUND' ? 404 : authRes.code === 'UPSTREAM_ERROR' ? 502 : 403;
        res.status(status).json({ error: authRes.reason || 'Not authorized for this order.', code: authRes.code });
        return;
      }

      const liveHandle = app.locals.trackingHandle as TrackingServerHandle | undefined;
      const snapshot = liveHandle?.getOrderSnapshot(orderId) || null;

      res.json({
        orderId,
        authorized: true,
        snapshot,
      });
    }
  );

  // -------------------------------------------------------------------------
  // 8. Zenvego Marketplace Assistant (Multi-turn Chat + Search & Maps Grounding)
  // -------------------------------------------------------------------------
  app.post(
    '/api/assistant/chat',
    createRateLimiter(30, 60_000),
    requireFirebaseAuth,
    async (req: AuthedRequest, res: Response) => {
      const { messages, mode, userRole, lat, lng, contextSummary } = req.body as {
        messages?: AssistantChatMessageInput[];
        mode?: AssistantMode;
        userRole?: AssistantUserRole;
        lat?: number;
        lng?: number;
        contextSummary?: string;
      };

      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: 'At least one message is required.' });
        return;
      }

      const ai = getServerGeminiClient();
      if (!ai) {
        res.status(503).json({
          error: 'Assistant service is not configured on the server yet.',
          code: 'ai/not-configured',
        });
        return;
      }

      try {
        const result = await runAssistantChat(ai, {
          messages,
          mode: mode || 'general',
          userRole: userRole || 'customer',
          lat,
          lng,
          contextSummary,
        });
        res.json(result);
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : 'Assistant request failed.';
        logSecurityEvent('warn', 'assistant_chat_error', {
          uid: req.user?.uid,
          mode: mode || 'general',
          message: errMessage,
        });
        const status = errMessage.includes('non-empty user message') ? 400 : 502;
        res.status(status).json({
          error: status === 400 ? errMessage : 'Unable to reach the assistant right now. Please try again.',
          code: status === 400 ? 'assistant/invalid-input' : 'assistant/upstream-error',
        });
      }
    }
  );

  // Explicitly block any admin API path on Application A public server
  app.use('/api/admin', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Endpoint not enabled.' });
  });

  // Unknown API 404 handler
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API route not found.' });
  });

  return app;
}

export function createServerWithSocket(trackingOverrides?: {
  verifyIdToken?: (token: string) => Promise<DecodedIdToken>;
  authorizeSession?: Parameters<typeof attachTrackingSocket>[1]['authorizeSession'];
}) {
  const app = createApp();
  const httpServer = http.createServer(app);
  const tracking = attachTrackingSocket(httpServer, {
    firebaseProjectId,
    firestoreDatabaseId,
    allowedCorsOrigins: getAllowedCorsOrigins(),
    verifyIdToken: trackingOverrides?.verifyIdToken,
    authorizeSession: trackingOverrides?.authorizeSession,
    logEvent: logSecurityEvent,
  });
  const liveVoice = attachLiveVoiceServer(httpServer, {
    getGeminiClient: getServerGeminiClient,
    verifyIdToken: trackingOverrides?.verifyIdToken,
    logEvent: logSecurityEvent,
  });
  app.locals.trackingHandle = tracking;
  app.locals.liveVoiceHandle = liveVoice;
  return { app, httpServer, tracking, liveVoice };
}

async function startServer() {
  const { app, httpServer } = createServerWithSocket();
  const PORT = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(
      express.static(distDir, {
        setHeaders(res, filePath) {
          if (filePath.endsWith('.mjs') || filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          }
        },
      })
    );
    app.get('*', (req, res) => {
      const pathname = req.path || '';
      if (
        pathname.startsWith('/assets/') ||
        /\.(?:m?js|cjs|css|map|wasm|json|png|jpe?g|webp|svg|ico|woff2?|ttf|pbf)$/i.test(pathname)
      ) {
        res.status(404).type('text/plain').send('Asset not found');
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrDisabled ? false : { server: httpServer },
        ...(hmrDisabled ? { ws: false } : {}),
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    logSecurityEvent('info', 'server_started', { port: PORT, socketIoEnabled: true });
  });
}

// Start only when executed directly (allows test harness to import createApp/createServerWithSocket without port bind conflicts)
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  startServer().catch((err) => {
    console.error('Failed to start Zenvego server:', err);
    process.exit(1);
  });
}
