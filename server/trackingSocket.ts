import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { getAuth as getAdminAuth, type DecodedIdToken } from 'firebase-admin/auth';

export type TrackingRole = 'customer' | 'partner' | 'grower';

export type TrackingStageEvent =
  | 'ORDER_CONFIRMED'
  | 'ORDER_ACCEPTED'
  | 'PARTNER_ASSIGNED'
  | 'PICKED_UP'
  | 'OUT_FOR_DELIVERY'
  | 'NEAR_DESTINATION'
  | 'ARRIVED'
  | 'DELIVERED'
  | 'CANCELLED';

export interface LiveLocationPayload {
  orderId: string;
  assignmentId?: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  heading: number | null;
  speed: number | null;
  timestamp: string;
  deliveryPartnerId: string;
  partnerName?: string;
  trackingActive: boolean;
  deliveryStage: TrackingStageEvent;
}

export interface TrackingAuthorizationResult {
  authorized: boolean;
  reason?: string;
  code?: 'FORBIDDEN' | 'NOT_FOUND' | 'ORDER_ENDED' | 'UPSTREAM_ERROR';
  orderId: string;
  assignmentId?: string;
  customerId?: string;
  growerId?: string;
  partnerId?: string;
  partnerName?: string;
  orderStatus?: string;
  assignmentStatus?: string;
  dropoffLat?: number;
  dropoffLng?: number;
}

export interface TrackingSocketOptions {
  firebaseProjectId: string;
  firestoreDatabaseId: string;
  allowedCorsOrigins?: Set<string>;
  verifyIdToken?: (token: string) => Promise<DecodedIdToken>;
  authorizeSession?: (params: {
    idToken: string;
    uid: string;
    orderId: string;
    assignmentId?: string;
    role: TrackingRole;
  }) => Promise<TrackingAuthorizationResult>;
  logEvent?: (level: 'info' | 'warn' | 'error', event: string, meta?: Record<string, unknown>) => void;
}

interface ActiveOrderTrackingState {
  orderId: string;
  assignmentId?: string;
  deliveryPartnerId?: string;
  partnerName?: string;
  trackingActive: boolean;
  ended: boolean;
  endedReason?: 'DELIVERED' | 'CANCELLED';
  deliveryStage: TrackingStageEvent;
  dropoffLat?: number;
  dropoffLng?: number;
  lastLocation: LiveLocationPayload | null;
  partnerOnline: boolean;
  partnerSocketId: string | null;
  updatedAtMs: number;
}

interface SocketSessionMeta {
  uid: string;
  idToken: string;
  emailVerified: boolean;
  joinedRooms: Map<string, { role: TrackingRole; assignmentId?: string; auth: TrackingAuthorizationResult }>;
  lastLocationEmitMs: number;
}

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{3,128}$/;
const ALLOWED_STATUS_EVENTS = new Set<TrackingStageEvent>([
  'ORDER_CONFIRMED',
  'ORDER_ACCEPTED',
  'PARTNER_ASSIGNED',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'NEAR_DESTINATION',
  'ARRIVED',
  'DELIVERED',
  'CANCELLED',
]);
const TERMINAL_ORDER_STATUSES = new Set(['delivered', 'cancelled']);
const MIN_LOCATION_INTERVAL_MS = 1_500;
const NEAR_DESTINATION_METERS = 500;
const ARRIVED_METERS = 80;

function isValidCoordinate(lat: unknown, lng: unknown): lat is number {
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

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseFirestoreValue(field: Record<string, unknown> | undefined): unknown {
  if (!field || typeof field !== 'object') return undefined;
  if ('stringValue' in field) return field.stringValue;
  if ('doubleValue' in field) return Number(field.doubleValue);
  if ('integerValue' in field) return Number(field.integerValue);
  if ('booleanValue' in field) return Boolean(field.booleanValue);
  if ('timestampValue' in field) return field.timestampValue;
  if ('arrayValue' in field) {
    const values = (field.arrayValue as { values?: Record<string, unknown>[] })?.values || [];
    return values.map(parseFirestoreValue);
  }
  return undefined;
}

async function fetchFirestoreDocumentWithCallerToken(params: {
  projectId: string;
  databaseId: string;
  collection: string;
  docId: string;
  idToken: string;
}): Promise<{ ok: boolean; status: number; fields: Record<string, unknown> }> {
  const dbId = params.databaseId || '(default)';
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(params.projectId)}/databases/${encodeURIComponent(dbId)}/documents/${encodeURIComponent(params.collection)}/${encodeURIComponent(params.docId)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${params.idToken}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(6_000),
  });

  if (!res.ok) {
    return { ok: false, status: res.status, fields: {} };
  }

  const json = (await res.json().catch(() => ({}))) as {
    fields?: Record<string, Record<string, unknown>>;
  };
  const parsed: Record<string, unknown> = {};
  if (json.fields) {
    for (const [key, val] of Object.entries(json.fields)) {
      parsed[key] = parseFirestoreValue(val);
    }
  }
  return { ok: true, status: 200, fields: parsed };
}

/**
 * Zero-trust order/assignment authorization using the caller's own verified Firebase ID token
 * against Firestore REST API (evaluates firestore.rules AND verifies explicit ownership fields).
 * Works on both AI Studio Starter Tier and user-owned Firebase projects without requiring IAM keys.
 */
export async function verifyFirestoreTrackingAuthorization(params: {
  projectId: string;
  databaseId: string;
  idToken: string;
  uid: string;
  orderId: string;
  assignmentId?: string;
  role: TrackingRole;
}): Promise<TrackingAuthorizationResult> {
  if (!params.projectId) {
    return { authorized: false, orderId: params.orderId, code: 'UPSTREAM_ERROR', reason: 'Firebase project not configured.' };
  }
  if (!VALID_ID_REGEX.test(params.orderId)) {
    return { authorized: false, orderId: params.orderId, code: 'FORBIDDEN', reason: 'Invalid order identifier.' };
  }
  if (params.assignmentId && !VALID_ID_REGEX.test(params.assignmentId)) {
    return { authorized: false, orderId: params.orderId, code: 'FORBIDDEN', reason: 'Invalid assignment identifier.' };
  }

  try {
    // When assignmentId is supplied, verify assignment doc directly (covers delivery_assignments rules & coordinates)
    let assignmentFields: Record<string, unknown> | null = null;
    if (params.assignmentId) {
      const aRes = await fetchFirestoreDocumentWithCallerToken({
        projectId: params.projectId,
        databaseId: params.databaseId,
        collection: 'delivery_assignments',
        docId: params.assignmentId,
        idToken: params.idToken,
      });
      if (aRes.status === 403 || aRes.status === 401) {
        return {
          authorized: false,
          orderId: params.orderId,
          code: 'FORBIDDEN',
          reason: 'Not authorized to access this delivery assignment.',
        };
      }
      if (aRes.status === 404) {
        return {
          authorized: false,
          orderId: params.orderId,
          code: 'NOT_FOUND',
          reason: 'Delivery assignment not found.',
        };
      }
      if (!aRes.ok) {
        return {
          authorized: false,
          orderId: params.orderId,
          code: 'UPSTREAM_ERROR',
          reason: 'Unable to verify assignment authorization right now.',
        };
      }
      assignmentFields = aRes.fields;
      if (assignmentFields.parentOrderId && assignmentFields.parentOrderId !== params.orderId) {
        return {
          authorized: false,
          orderId: params.orderId,
          code: 'FORBIDDEN',
          reason: 'Assignment does not match requested order.',
        };
      }
    }

    // Verify parent order document
    const oRes = await fetchFirestoreDocumentWithCallerToken({
      projectId: params.projectId,
      databaseId: params.databaseId,
      collection: 'orders',
      docId: params.orderId,
      idToken: params.idToken,
    });

    // If partner accepted assignment before assignedPartnerId synced on parent order, allow assignment doc proof for partner
    const orderFields = oRes.ok ? oRes.fields : null;
    if (!orderFields && !assignmentFields) {
      if (oRes.status === 403 || oRes.status === 401) {
        return {
          authorized: false,
          orderId: params.orderId,
          code: 'FORBIDDEN',
          reason: 'You are not authorized to access tracking for this order.',
        };
      }
      if (oRes.status === 404) {
        return {
          authorized: false,
          orderId: params.orderId,
          code: 'NOT_FOUND',
          reason: 'Order not found.',
        };
      }
      return {
        authorized: false,
        orderId: params.orderId,
        code: 'UPSTREAM_ERROR',
        reason: 'Could not verify order ownership.',
      };
    }

    const customerId = String(orderFields?.customerId || assignmentFields?.customerId || '');
    const growerIds = Array.isArray(orderFields?.growerIds)
      ? (orderFields.growerIds as unknown[]).map(String)
      : assignmentFields?.growerId
        ? [String(assignmentFields.growerId)]
        : [];
    const partnerId = String(assignmentFields?.partnerId || orderFields?.assignedPartnerId || '');
    const partnerName = typeof assignmentFields?.partnerName === 'string' ? assignmentFields.partnerName : undefined;
    const orderStatus = String(orderFields?.status || '');
    const assignmentStatus = String(assignmentFields?.status || '');

    const rawDropLat = assignmentFields?.dropoffLat ?? orderFields?.deliveryLat;
    const rawDropLng = assignmentFields?.dropoffLng ?? orderFields?.deliveryLng;
    const dropoffLat = typeof rawDropLat === 'number' && Number.isFinite(rawDropLat) ? rawDropLat : undefined;
    const dropoffLng = typeof rawDropLng === 'number' && Number.isFinite(rawDropLng) ? rawDropLng : undefined;

    if (params.role === 'customer') {
      if (!customerId || customerId !== params.uid) {
        return {
          authorized: false,
          orderId: params.orderId,
          code: 'FORBIDDEN',
          reason: 'Only the order customer can subscribe to this live tracking room.',
        };
      }
    } else if (params.role === 'partner') {
      if (!partnerId || partnerId !== params.uid) {
        return {
          authorized: false,
          orderId: params.orderId,
          code: 'FORBIDDEN',
          reason: 'Only the assigned delivery partner can broadcast GPS for this order.',
        };
      }
      if (TERMINAL_ORDER_STATUSES.has(orderStatus) || TERMINAL_ORDER_STATUSES.has(assignmentStatus)) {
        return {
          authorized: false,
          orderId: params.orderId,
          code: 'ORDER_ENDED',
          reason: 'This delivery is already completed or cancelled.',
          orderStatus,
          assignmentStatus,
        };
      }
    } else if (params.role === 'grower') {
      if (!growerIds.includes(params.uid)) {
        return {
          authorized: false,
          orderId: params.orderId,
          code: 'FORBIDDEN',
          reason: 'Only a participating grower can view pickup tracking for this order.',
        };
      }
    } else {
      return {
        authorized: false,
        orderId: params.orderId,
        code: 'FORBIDDEN',
        reason: 'Unsupported tracking role.',
      };
    }

    return {
      authorized: true,
      orderId: params.orderId,
      assignmentId: params.assignmentId,
      customerId,
      growerId: growerIds[0],
      partnerId: partnerId || undefined,
      partnerName,
      orderStatus,
      assignmentStatus,
      dropoffLat,
      dropoffLng,
    };
  } catch {
    return {
      authorized: false,
      orderId: params.orderId,
      code: 'UPSTREAM_ERROR',
      reason: 'Authorization check failed due to upstream error.',
    };
  }
}

export interface TrackingServerHandle {
  io: SocketIOServer;
  getOrderSnapshot: (orderId: string) => ActiveOrderTrackingState | null;
  markOrderEnded: (orderId: string, reason: 'DELIVERED' | 'CANCELLED') => void;
}

export function attachTrackingSocket(httpServer: HttpServer, options: TrackingSocketOptions): TrackingServerHandle {
  const verifyToken =
    options.verifyIdToken ||
    (async (token: string) => {
      return getAdminAuth().verifyIdToken(token);
    });

  const authorize =
    options.authorizeSession ||
    (async (params) =>
      verifyFirestoreTrackingAuthorization({
        projectId: options.firebaseProjectId,
        databaseId: options.firestoreDatabaseId,
        ...params,
      }));

  const log = options.logEvent || (() => {});
  const orderStates = new Map<string, ActiveOrderTrackingState>();

  const io = new SocketIOServer(httpServer, {
    path: '/socket.io',
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const clean = origin.replace(/\/+$/, '');
        const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(clean);
        const isAiStudio = /^https:\/\/[a-z0-9-]+\.run\.app$/i.test(clean);
        if (isLocal || isAiStudio || options.allowedCorsOrigins?.has(clean)) {
          return callback(null, true);
        }
        return callback(new Error('CORS origin not permitted for Socket.IO'));
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 20_000,
    pingInterval: 10_000,
  });

  // Periodic cleanup of stale finished order states (>6h) to keep server memory bounded
  const cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - 6 * 60 * 60_000;
    for (const [id, st] of orderStates.entries()) {
      if (st.updatedAtMs < cutoff) {
        orderStates.delete(id);
      }
    }
  }, 15 * 60_000);
  cleanupTimer.unref?.();

  // 1. Socket.IO Firebase Authentication Middleware
  io.use(async (socket, next) => {
    try {
      const authTokenRaw =
        (typeof socket.handshake.auth?.token === 'string' && socket.handshake.auth.token) ||
        (typeof socket.handshake.headers.authorization === 'string' &&
        socket.handshake.headers.authorization.startsWith('Bearer ')
          ? socket.handshake.headers.authorization.slice(7).trim()
          : '');

      if (!authTokenRaw || authTokenRaw.length > 4096) {
        log('warn', 'socket_auth_missing_token', { socketId: socket.id });
        return next(new Error('AUTH_REQUIRED: Firebase ID token required for live tracking.'));
      }

      const decoded = await verifyToken(authTokenRaw);
      const meta: SocketSessionMeta = {
        uid: decoded.uid,
        idToken: authTokenRaw,
        emailVerified: Boolean(decoded.email_verified),
        joinedRooms: new Map(),
        lastLocationEmitMs: 0,
      };
      (socket.data as { session?: SocketSessionMeta }).session = meta;
      next();
    } catch {
      log('warn', 'socket_auth_invalid_token', { socketId: socket.id });
      next(new Error('AUTH_INVALID: Invalid or expired Firebase ID token.'));
    }
  });

  function getOrInitOrderState(auth: TrackingAuthorizationResult): ActiveOrderTrackingState {
    let existing = orderStates.get(auth.orderId);
    if (!existing) {
      const isTerminal =
        TERMINAL_ORDER_STATUSES.has(auth.orderStatus || '') ||
        TERMINAL_ORDER_STATUSES.has(auth.assignmentStatus || '');
      const initialStage: TrackingStageEvent =
        auth.orderStatus === 'delivered' || auth.assignmentStatus === 'delivered'
          ? 'DELIVERED'
          : auth.orderStatus === 'cancelled'
            ? 'CANCELLED'
            : auth.assignmentStatus === 'picked_up' || auth.orderStatus === 'out_for_delivery'
              ? 'OUT_FOR_DELIVERY'
              : auth.partnerId
                ? 'PARTNER_ASSIGNED'
                : 'ORDER_CONFIRMED';

      existing = {
        orderId: auth.orderId,
        assignmentId: auth.assignmentId,
        deliveryPartnerId: auth.partnerId,
        partnerName: auth.partnerName,
        trackingActive: false,
        ended: isTerminal,
        endedReason:
          initialStage === 'DELIVERED' ? 'DELIVERED' : initialStage === 'CANCELLED' ? 'CANCELLED' : undefined,
        deliveryStage: initialStage,
        dropoffLat: auth.dropoffLat,
        dropoffLng: auth.dropoffLng,
        lastLocation: null,
        partnerOnline: false,
        partnerSocketId: null,
        updatedAtMs: Date.now(),
      };
      orderStates.set(auth.orderId, existing);
    } else {
      if (auth.assignmentId && !existing.assignmentId) existing.assignmentId = auth.assignmentId;
      if (auth.partnerId && !existing.deliveryPartnerId) existing.deliveryPartnerId = auth.partnerId;
      if (auth.partnerName && !existing.partnerName) existing.partnerName = auth.partnerName;
      if (auth.dropoffLat !== undefined && auth.dropoffLng !== undefined) {
        existing.dropoffLat = auth.dropoffLat;
        existing.dropoffLng = auth.dropoffLng;
      }
    }
    return existing;
  }

  function roomName(orderId: string): string {
    return `order:${orderId}`;
  }

  function markOrderEnded(orderId: string, reason: 'DELIVERED' | 'CANCELLED') {
    const state = orderStates.get(orderId);
    if (state) {
      state.ended = true;
      state.endedReason = reason;
      state.trackingActive = false;
      state.deliveryStage = reason;
      state.partnerOnline = false;
      state.updatedAtMs = Date.now();
      if (state.lastLocation) {
        state.lastLocation = {
          ...state.lastLocation,
          trackingActive: false,
          deliveryStage: reason,
        };
      }
    }
    io.to(roomName(orderId)).emit('tracking:ended', {
      orderId,
      reason,
      deliveryStage: reason,
      endedAt: new Date().toISOString(),
    });
  }

  io.on('connection', (socket: Socket) => {
    const session = (socket.data as { session?: SocketSessionMeta }).session;
    if (!session) {
      socket.disconnect(true);
      return;
    }

    // 2. Join an authorized order-specific tracking room
    socket.on(
      'tracking:join',
      async (
        payload: { orderId?: string; assignmentId?: string; role?: TrackingRole },
        ack?: (res: { ok: boolean; error?: string; code?: string; snapshot?: ActiveOrderTrackingState | null }) => void
      ) => {
        const orderId = typeof payload?.orderId === 'string' ? payload.orderId.trim() : '';
        const assignmentId = typeof payload?.assignmentId === 'string' ? payload.assignmentId.trim() : undefined;
        const role = payload?.role;

        if (!orderId || !VALID_ID_REGEX.test(orderId) || (role !== 'customer' && role !== 'partner' && role !== 'grower')) {
          const errObj = { ok: false, code: 'INVALID_REQUEST', error: 'Valid orderId and role are required.' };
          ack?.(errObj);
          socket.emit('tracking:error', errObj);
          return;
        }

        const authResult = await authorize({
          idToken: session.idToken,
          uid: session.uid,
          orderId,
          assignmentId,
          role,
        });

        if (!authResult.authorized) {
          log('warn', 'socket_tracking_join_denied', {
            uid: session.uid,
            orderId,
            role,
            code: authResult.code,
          });
          const errObj = {
            ok: false,
            code: authResult.code || 'FORBIDDEN',
            error: authResult.reason || 'Access denied for this order tracking session.',
          };
          ack?.(errObj);
          socket.emit('tracking:error', errObj);
          return;
        }

        const room = roomName(orderId);
        await socket.join(room);
        session.joinedRooms.set(orderId, { role, assignmentId: authResult.assignmentId, auth: authResult });

        const state = getOrInitOrderState(authResult);
        if (role === 'partner') {
          state.partnerOnline = true;
          state.partnerSocketId = socket.id;
          state.updatedAtMs = Date.now();
          socket.to(room).emit('tracking:partner_presence', {
            orderId,
            partnerOnline: true,
            trackingActive: state.trackingActive,
            timestamp: new Date().toISOString(),
          });
        }

        log('info', 'socket_tracking_joined', { uid: session.uid, orderId, role });
        socket.emit('tracking:snapshot', state);
        ack?.({ ok: true, snapshot: state });
      }
    );

    // 3. Leave tracking room cleanly
    socket.on('tracking:leave', async (payload: { orderId?: string }) => {
      const orderId = typeof payload?.orderId === 'string' ? payload.orderId.trim() : '';
      if (!orderId) return;
      const joined = session.joinedRooms.get(orderId);
      session.joinedRooms.delete(orderId);
      await socket.leave(roomName(orderId));

      if (joined?.role === 'partner') {
        const state = orderStates.get(orderId);
        if (state && state.partnerSocketId === socket.id) {
          state.partnerOnline = false;
          state.partnerSocketId = null;
          io.to(roomName(orderId)).emit('tracking:partner_presence', {
            orderId,
            partnerOnline: false,
            trackingActive: state.trackingActive,
            timestamp: new Date().toISOString(),
          });
        }
      }
    });

    // 4. Receive actual GPS coordinates from authorized Delivery Partner & broadcast to order room
    socket.on(
      'tracking:location_update',
      (
        payload: {
          orderId?: string;
          assignmentId?: string;
          latitude?: number;
          longitude?: number;
          accuracy?: number;
          heading?: number | null;
          speed?: number | null;
          timestamp?: string | number;
          deliveryStage?: TrackingStageEvent;
        },
        ack?: (res: { ok: boolean; error?: string; code?: string; deliveryStage?: TrackingStageEvent }) => void
      ) => {
        const orderId = typeof payload?.orderId === 'string' ? payload.orderId.trim() : '';
        const membership = session.joinedRooms.get(orderId);

        if (!membership || membership.role !== 'partner') {
          const errObj = {
            ok: false,
            code: 'FORBIDDEN',
            error: 'Unauthorized: only the assigned delivery partner joined to this order may transmit GPS.',
          };
          ack?.(errObj);
          socket.emit('tracking:error', errObj);
          return;
        }

        const state = orderStates.get(orderId);
        if (!state || state.ended) {
          const errObj = {
            ok: false,
            code: 'TRACKING_ENDED',
            error: 'Delivery is completed or cancelled. Location updates are no longer accepted.',
          };
          ack?.(errObj);
          socket.emit('tracking:error', errObj);
          return;
        }

        // Per-socket flood / rate-limit guard
        const now = Date.now();
        if (now - session.lastLocationEmitMs < MIN_LOCATION_INTERVAL_MS) {
          ack?.({ ok: false, code: 'RATE_LIMITED', error: 'Location update rate limit exceeded. Wait 1.5s.' });
          return;
        }

        const { accuracy, heading, speed } = payload || {};
        const rawLat = payload?.latitude;
        const rawLng = payload?.longitude;
        if (!isValidCoordinate(rawLat, rawLng)) {
          const errObj = {
            ok: false,
            code: 'INVALID_COORDS',
            error: 'Invalid GPS coordinates supplied.',
          };
          ack?.(errObj);
          socket.emit('tracking:error', errObj);
          return;
        }
        const latitude = Number(rawLat);
        const longitude = Number(rawLng);

        const safeAccuracy =
          typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 5000
            ? Math.round(accuracy * 10) / 10
            : 0;
        const safeHeading =
          typeof heading === 'number' && Number.isFinite(heading) && heading >= 0 && heading <= 360
            ? Math.round(heading * 10) / 10
            : null;
        const safeSpeed =
          typeof speed === 'number' && Number.isFinite(speed) && speed >= 0 && speed <= 80
            ? Math.round(speed * 100) / 100
            : null;

        session.lastLocationEmitMs = now;

        // Derive proximity delivery milestones ONLY when already out for delivery (picked_up / out_for_delivery)
        let nextStage: TrackingStageEvent =
          payload.deliveryStage && ALLOWED_STATUS_EVENTS.has(payload.deliveryStage) && payload.deliveryStage !== 'DELIVERED' && payload.deliveryStage !== 'CANCELLED'
            ? payload.deliveryStage
            : state.deliveryStage;

        if (
          (nextStage === 'PICKED_UP' || nextStage === 'OUT_FOR_DELIVERY' || nextStage === 'NEAR_DESTINATION') &&
          isValidCoordinate(state.dropoffLat, state.dropoffLng)
        ) {
          const distToDropM = haversineMeters(latitude, longitude, state.dropoffLat, Number(state.dropoffLng));
          if (distToDropM <= ARRIVED_METERS) {
            nextStage = 'ARRIVED';
          } else if (distToDropM <= NEAR_DESTINATION_METERS) {
            nextStage = 'NEAR_DESTINATION';
          }
        }

        const isoTs =
          typeof payload.timestamp === 'string' && Number.isFinite(Date.parse(payload.timestamp))
            ? new Date(payload.timestamp).toISOString()
            : typeof payload.timestamp === 'number' && Number.isFinite(payload.timestamp)
              ? new Date(payload.timestamp).toISOString()
              : new Date(now).toISOString();

        const locationPacket: LiveLocationPayload = {
          orderId,
          assignmentId: membership.assignmentId || state.assignmentId,
          latitude,
          longitude,
          accuracy: safeAccuracy,
          heading: safeHeading,
          speed: safeSpeed,
          timestamp: isoTs,
          deliveryPartnerId: session.uid,
          partnerName: state.partnerName,
          trackingActive: true,
          deliveryStage: nextStage,
        };

        const stageChanged = nextStage !== state.deliveryStage;
        state.deliveryStage = nextStage;
        state.trackingActive = true;
        state.partnerOnline = true;
        state.partnerSocketId = socket.id;
        state.lastLocation = locationPacket;
        state.updatedAtMs = now;

        // Emit immediately to all authorized clients in this isolated order room
        io.to(roomName(orderId)).emit('tracking:location', locationPacket);
        if (stageChanged) {
          io.to(roomName(orderId)).emit('tracking:status', {
            orderId,
            deliveryStage: nextStage,
            trackingActive: true,
            updatedAt: isoTs,
          });
        }

        ack?.({ ok: true, deliveryStage: nextStage });
      }
    );

    // 5. Partner / authorized status transition broadcast (e.g. PICKED_UP, OUT_FOR_DELIVERY, NEAR_DESTINATION, ARRIVED, DELIVERED, CANCELLED)
    socket.on(
      'tracking:status_update',
      (
        payload: { orderId?: string; deliveryStage?: TrackingStageEvent; note?: string },
        ack?: (res: { ok: boolean; error?: string; code?: string }) => void
      ) => {
        const orderId = typeof payload?.orderId === 'string' ? payload.orderId.trim() : '';
        const stage = payload?.deliveryStage;
        const membership = session.joinedRooms.get(orderId);

        if (!membership || membership.role !== 'partner') {
          ack?.({ ok: false, code: 'FORBIDDEN', error: 'Only the assigned partner may push live status updates.' });
          return;
        }
        if (!stage || !ALLOWED_STATUS_EVENTS.has(stage)) {
          ack?.({ ok: false, code: 'INVALID_STATUS', error: 'Unsupported delivery status event.' });
          return;
        }

        const state = orderStates.get(orderId);
        if (!state || state.ended) {
          ack?.({ ok: false, code: 'TRACKING_ENDED', error: 'Order tracking has already ended.' });
          return;
        }

        if (stage === 'DELIVERED' || stage === 'CANCELLED') {
          markOrderEnded(orderId, stage);
          ack?.({ ok: true });
          return;
        }

        state.deliveryStage = stage;
        state.updatedAtMs = Date.now();
        io.to(roomName(orderId)).emit('tracking:status', {
          orderId,
          deliveryStage: stage,
          note: typeof payload.note === 'string' ? payload.note.slice(0, 200) : undefined,
          trackingActive: state.trackingActive,
          updatedAt: new Date().toISOString(),
        });
        ack?.({ ok: true });
      }
    );

    // 6. Explicit GPS stop by Delivery Partner
    socket.on('tracking:stop', (payload: { orderId?: string }, ack?: (res: { ok: boolean }) => void) => {
      const orderId = typeof payload?.orderId === 'string' ? payload.orderId.trim() : '';
      const membership = session.joinedRooms.get(orderId);
      if (!membership || membership.role !== 'partner') {
        ack?.({ ok: false });
        return;
      }
      const state = orderStates.get(orderId);
      if (state) {
        state.trackingActive = false;
        state.updatedAtMs = Date.now();
        if (state.lastLocation) {
          state.lastLocation = { ...state.lastLocation, trackingActive: false };
        }
        io.to(roomName(orderId)).emit('tracking:status', {
          orderId,
          deliveryStage: state.deliveryStage,
          trackingActive: false,
          updatedAt: new Date().toISOString(),
        });
      }
      ack?.({ ok: true });
    });

    // 7. Disconnect handling
    socket.on('disconnect', () => {
      for (const [orderId, membership] of session.joinedRooms.entries()) {
        if (membership.role === 'partner') {
          const state = orderStates.get(orderId);
          if (state && state.partnerSocketId === socket.id) {
            state.partnerOnline = false;
            state.partnerSocketId = null;
            io.to(roomName(orderId)).emit('tracking:partner_presence', {
              orderId,
              partnerOnline: false,
              trackingActive: state.trackingActive,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
      session.joinedRooms.clear();
    });
  });

  return {
    io,
    getOrderSnapshot: (orderId: string) => orderStates.get(orderId) || null,
    markOrderEnded,
  };
}
