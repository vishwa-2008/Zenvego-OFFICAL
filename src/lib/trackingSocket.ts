import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { auth } from './firebase';

export type SocketConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export type SocketTrackingRole = 'customer' | 'partner' | 'grower';

export type SocketDeliveryStage =
  | 'ORDER_CONFIRMED'
  | 'ORDER_ACCEPTED'
  | 'PARTNER_ASSIGNED'
  | 'PICKED_UP'
  | 'OUT_FOR_DELIVERY'
  | 'NEAR_DESTINATION'
  | 'ARRIVED'
  | 'DELIVERED'
  | 'CANCELLED';

export interface LiveSocketLocationPacket {
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
  deliveryStage: SocketDeliveryStage;
}

export interface LiveSocketSnapshot {
  orderId: string;
  assignmentId?: string;
  deliveryPartnerId?: string;
  partnerName?: string;
  trackingActive: boolean;
  ended: boolean;
  endedReason?: 'DELIVERED' | 'CANCELLED';
  deliveryStage: SocketDeliveryStage;
  lastLocation: LiveSocketLocationPacket | null;
  partnerOnline: boolean;
}

export interface UseOrderTrackingSocketOptions {
  orderId?: string | null;
  assignmentId?: string | null;
  role: SocketTrackingRole;
  enabled?: boolean;
}

export interface UseOrderTrackingSocketResult {
  connectionState: SocketConnectionState;
  joined: boolean;
  errorMessage: string | null;
  errorCode: string | null;
  liveLocation: LiveSocketLocationPacket | null;
  liveStage: SocketDeliveryStage | null;
  partnerOnline: boolean;
  trackingActive: boolean;
  trackingEnded: boolean;
  endedReason: 'DELIVERED' | 'CANCELLED' | null;
  emitLocation: (payload: {
    latitude: number;
    longitude: number;
    accuracy?: number;
    heading?: number | null;
    speed?: number | null;
    timestamp?: string | number;
    deliveryStage?: SocketDeliveryStage;
  }) => Promise<{ ok: boolean; error?: string; code?: string; deliveryStage?: SocketDeliveryStage }>;
  emitStatus: (
    deliveryStage: SocketDeliveryStage,
    note?: string
  ) => Promise<{ ok: boolean; error?: string; code?: string }>;
  emitStop: () => Promise<boolean>;
  reconnect: () => void;
}

export function useOrderTrackingSocket({
  orderId,
  assignmentId,
  role,
  enabled = true,
}: UseOrderTrackingSocketOptions): UseOrderTrackingSocketResult {
  const [connectionState, setConnectionState] = useState<SocketConnectionState>('idle');
  const [joined, setJoined] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [liveLocation, setLiveLocation] = useState<LiveSocketLocationPacket | null>(null);
  const [liveStage, setLiveStage] = useState<SocketDeliveryStage | null>(null);
  const [partnerOnline, setPartnerOnline] = useState<boolean>(false);
  const [trackingActive, setTrackingActive] = useState<boolean>(false);
  const [trackingEnded, setTrackingEnded] = useState<boolean>(false);
  const [endedReason, setEndedReason] = useState<'DELIVERED' | 'CANCELLED' | null>(null);
  const [reconnectTick, setReconnectTick] = useState<number>(0);

  const socketRef = useRef<Socket | null>(null);
  const orderIdRef = useRef<string | null | undefined>(orderId);
  orderIdRef.current = orderId;

  useEffect(() => {
    const cleanOrderId = typeof orderId === 'string' ? orderId.trim() : '';
    if (!enabled || !cleanOrderId || typeof window === 'undefined') {
      setConnectionState('idle');
      setJoined(false);
      return;
    }

    let disposed = false;
    setConnectionState('connecting');
    setJoined(false);
    setErrorMessage(null);
    setErrorCode(null);

    const socket = io(window.location.origin, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1_500,
      reconnectionDelayMax: 10_000,
      timeout: 12_000,
      auth: (cb) => {
        const user = auth.currentUser;
        if (!user) {
          cb({ token: '' });
          return;
        }
        user
          .getIdToken()
          .then((token) => cb({ token }))
          .catch(() => cb({ token: '' }));
      },
    });

    socketRef.current = socket;

    const joinOrderRoom = () => {
      if (disposed || !socket.connected) return;
      socket.emit(
        'tracking:join',
        {
          orderId: cleanOrderId,
          assignmentId: assignmentId || undefined,
          role,
        },
        (ack?: { ok: boolean; error?: string; code?: string; snapshot?: LiveSocketSnapshot | null }) => {
          if (disposed) return;
          if (!ack?.ok) {
            setJoined(false);
            setErrorCode(ack?.code || 'FORBIDDEN');
            setErrorMessage(ack?.error || 'Could not join live tracking room.');
            if (ack?.code === 'ORDER_ENDED') {
              setTrackingEnded(true);
              setTrackingActive(false);
            }
            return;
          }
          setJoined(true);
          setErrorMessage(null);
          setErrorCode(null);
          if (ack.snapshot) {
            setLiveStage(ack.snapshot.deliveryStage);
            setPartnerOnline(Boolean(ack.snapshot.partnerOnline));
            setTrackingActive(Boolean(ack.snapshot.trackingActive));
            setTrackingEnded(Boolean(ack.snapshot.ended));
            setEndedReason(ack.snapshot.endedReason || null);
            if (ack.snapshot.lastLocation) {
              setLiveLocation(ack.snapshot.lastLocation);
            }
          }
        }
      );
    };

    socket.on('connect', () => {
      if (disposed) return;
      setConnectionState('connected');
      setErrorMessage(null);
      setErrorCode(null);
      joinOrderRoom();
    });

    socket.on('disconnect', (reason) => {
      if (disposed) return;
      setJoined(false);
      if (reason === 'io client disconnect') {
        setConnectionState('disconnected');
      } else {
        setConnectionState('reconnecting');
      }
    });

    socket.io.on('reconnect_attempt', () => {
      if (disposed) return;
      setConnectionState('reconnecting');
    });

    socket.io.on('reconnect_failed', () => {
      if (disposed) return;
      setConnectionState('error');
      setErrorMessage('Unable to reconnect to live tracking server.');
    });

    socket.on('connect_error', (err) => {
      if (disposed) return;
      const msg = err?.message || 'Live tracking connection error.';
      if (msg.includes('AUTH_REQUIRED') || msg.includes('AUTH_INVALID')) {
        setConnectionState('error');
        setErrorCode('AUTH_ERROR');
        setErrorMessage('Sign in with your verified account to connect to live tracking.');
      } else {
        setConnectionState('reconnecting');
        setErrorMessage('Connecting to real-time tracking stream...');
      }
    });

    socket.on('tracking:snapshot', (snap: LiveSocketSnapshot) => {
      if (disposed || snap.orderId !== cleanOrderId) return;
      setLiveStage(snap.deliveryStage);
      setPartnerOnline(Boolean(snap.partnerOnline));
      setTrackingActive(Boolean(snap.trackingActive));
      setTrackingEnded(Boolean(snap.ended));
      setEndedReason(snap.endedReason || null);
      if (snap.lastLocation) {
        setLiveLocation(snap.lastLocation);
      }
    });

    socket.on('tracking:location', (packet: LiveSocketLocationPacket) => {
      if (disposed || packet.orderId !== cleanOrderId) return;
      setLiveLocation(packet);
      setLiveStage(packet.deliveryStage);
      setTrackingActive(Boolean(packet.trackingActive));
      setPartnerOnline(true);
    });

    socket.on(
      'tracking:status',
      (evt: { orderId: string; deliveryStage: SocketDeliveryStage; trackingActive: boolean }) => {
        if (disposed || evt.orderId !== cleanOrderId) return;
        setLiveStage(evt.deliveryStage);
        setTrackingActive(Boolean(evt.trackingActive));
      }
    );

    socket.on(
      'tracking:partner_presence',
      (evt: { orderId: string; partnerOnline: boolean; trackingActive: boolean }) => {
        if (disposed || evt.orderId !== cleanOrderId) return;
        setPartnerOnline(Boolean(evt.partnerOnline));
        setTrackingActive(Boolean(evt.trackingActive));
      }
    );

    socket.on(
      'tracking:ended',
      (evt: { orderId: string; reason: 'DELIVERED' | 'CANCELLED'; deliveryStage: SocketDeliveryStage }) => {
        if (disposed || evt.orderId !== cleanOrderId) return;
        setTrackingEnded(true);
        setEndedReason(evt.reason);
        setTrackingActive(false);
        setPartnerOnline(false);
        setLiveStage(evt.deliveryStage);
      }
    );

    socket.on('tracking:error', (err: { code?: string; error?: string }) => {
      if (disposed) return;
      if (err?.code === 'RATE_LIMITED') return; // Non-fatal throttle notice
      setErrorCode(err?.code || 'TRACKING_ERROR');
      setErrorMessage(err?.error || 'Live tracking error.');
      if (err?.code === 'TRACKING_ENDED' || err?.code === 'ORDER_ENDED') {
        setTrackingEnded(true);
        setTrackingActive(false);
      }
    });

    return () => {
      disposed = true;
      try {
        if (socket.connected) {
          socket.emit('tracking:leave', { orderId: cleanOrderId });
        }
        socket.removeAllListeners();
        socket.disconnect();
      } catch {
        // Ignore cleanup errors
      }
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [orderId, assignmentId, role, enabled, reconnectTick]);

  const emitLocation = useCallback<UseOrderTrackingSocketResult['emitLocation']>(
    (payload) =>
      new Promise((resolve) => {
        const socket = socketRef.current;
        const cleanOrderId = typeof orderIdRef.current === 'string' ? orderIdRef.current.trim() : '';
        if (!socket || !socket.connected || !cleanOrderId) {
          resolve({ ok: false, code: 'DISCONNECTED', error: 'Socket not connected.' });
          return;
        }
        socket.emit(
          'tracking:location_update',
          {
            orderId: cleanOrderId,
            assignmentId: assignmentId || undefined,
            ...payload,
          },
          (ack?: { ok: boolean; error?: string; code?: string; deliveryStage?: SocketDeliveryStage }) => {
            resolve(ack || { ok: false, error: 'No server acknowledgement.' });
          }
        );
      }),
    [assignmentId]
  );

  const emitStatus = useCallback<UseOrderTrackingSocketResult['emitStatus']>(
    (deliveryStage, note) =>
      new Promise((resolve) => {
        const socket = socketRef.current;
        const cleanOrderId = typeof orderIdRef.current === 'string' ? orderIdRef.current.trim() : '';
        if (!socket || !socket.connected || !cleanOrderId) {
          resolve({ ok: false, code: 'DISCONNECTED', error: 'Socket not connected.' });
          return;
        }
        socket.emit(
          'tracking:status_update',
          { orderId: cleanOrderId, deliveryStage, note },
          (ack?: { ok: boolean; error?: string; code?: string }) => {
            resolve(ack || { ok: false, error: 'No server acknowledgement.' });
          }
        );
      }),
    []
  );

  const emitStop = useCallback<UseOrderTrackingSocketResult['emitStop']>(
    () =>
      new Promise((resolve) => {
        const socket = socketRef.current;
        const cleanOrderId = typeof orderIdRef.current === 'string' ? orderIdRef.current.trim() : '';
        if (!socket || !socket.connected || !cleanOrderId) {
          resolve(false);
          return;
        }
        socket.emit('tracking:stop', { orderId: cleanOrderId }, (ack?: { ok: boolean }) => {
          resolve(Boolean(ack?.ok));
        });
      }),
    []
  );

  const reconnect = useCallback(() => {
    setReconnectTick((n) => n + 1);
  }, []);

  return useMemo(
    () => ({
      connectionState,
      joined,
      errorMessage,
      errorCode,
      liveLocation,
      liveStage,
      partnerOnline,
      trackingActive,
      trackingEnded,
      endedReason,
      emitLocation,
      emitStatus,
      emitStop,
      reconnect,
    }),
    [
      connectionState,
      joined,
      errorMessage,
      errorCode,
      liveLocation,
      liveStage,
      partnerOnline,
      trackingActive,
      trackingEnded,
      endedReason,
      emitLocation,
      emitStatus,
      emitStop,
      reconnect,
    ]
  );
}
