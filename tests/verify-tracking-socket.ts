import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as createClient, type Socket } from 'socket.io-client';
import type { DecodedIdToken } from 'firebase-admin/auth';
import {
  attachTrackingSocket,
  type LiveLocationPayload,
  type TrackingAuthorizationResult,
} from '../server/trackingSocket.ts';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connectSocket(baseUrl: string, token?: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createClient(baseUrl, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: false,
      auth: token !== undefined ? { token } : {},
    });
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Socket connect timed out'));
    }, 5_000);

    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      socket.disconnect();
      reject(err);
    });
  });
}

async function runTests() {
  const results: Array<{ name: string; status: 'PASS' | 'FAIL'; detail: string }> = [];

  const VALID_TOKENS: Record<string, { uid: string; email_verified: boolean }> = {
    'tok-cust-a': { uid: 'uid_cust_a', email_verified: true },
    'tok-cust-b': { uid: 'uid_cust_b', email_verified: true },
    'tok-partner-1': { uid: 'uid_partner_1', email_verified: true },
    'tok-partner-2': { uid: 'uid_partner_2', email_verified: true },
  };

  // Simulated order registry evaluated by the server's authorization callback
  const ORDERS: Record<
    string,
    {
      customerId: string;
      growerId: string;
      partnerId: string;
      partnerName: string;
      orderStatus: string;
      assignmentStatus: string;
      dropoffLat: number;
      dropoffLng: number;
    }
  > = {
    ord_live_1: {
      customerId: 'uid_cust_a',
      growerId: 'uid_grower_1',
      partnerId: 'uid_partner_1',
      partnerName: 'Ramesh EV',
      orderStatus: 'out_for_delivery',
      assignmentStatus: 'picked_up',
      dropoffLat: 12.9784,
      dropoffLng: 77.6408,
    },
    ord_other_2: {
      customerId: 'uid_cust_b',
      growerId: 'uid_grower_1',
      partnerId: 'uid_partner_2',
      partnerName: 'Kiran EV',
      orderStatus: 'out_for_delivery',
      assignmentStatus: 'picked_up',
      dropoffLat: 12.9352,
      dropoffLng: 77.6245,
    },
  };

  const server = http.createServer((_req, res) => {
    res.writeHead(200);
    res.end('ok');
  });

  const handle = attachTrackingSocket(server, {
    firebaseProjectId: 'test-project',
    firestoreDatabaseId: '(default)',
    verifyIdToken: async (token: string) => {
      const entry = VALID_TOKENS[token];
      if (!entry) throw new Error('Invalid token');
      return {
        uid: entry.uid,
        email_verified: entry.email_verified,
      } as unknown as DecodedIdToken;
    },
    authorizeSession: async ({ uid, orderId, assignmentId, role }): Promise<TrackingAuthorizationResult> => {
      const ord = ORDERS[orderId];
      if (!ord) {
        return { authorized: false, orderId, code: 'NOT_FOUND', reason: 'Order not found.' };
      }
      if (role === 'customer' && ord.customerId !== uid) {
        return { authorized: false, orderId, code: 'FORBIDDEN', reason: 'Not the order customer.' };
      }
      if (role === 'partner' && ord.partnerId !== uid) {
        return { authorized: false, orderId, code: 'FORBIDDEN', reason: 'Not the assigned partner.' };
      }
      return {
        authorized: true,
        orderId,
        assignmentId,
        customerId: ord.customerId,
        growerId: ord.growerId,
        partnerId: ord.partnerId,
        partnerName: ord.partnerName,
        orderStatus: ord.orderStatus,
        assignmentStatus: ord.assignmentStatus,
        dropoffLat: ord.dropoffLat,
        dropoffLng: ord.dropoffLng,
      };
    },
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  const openSockets: Socket[] = [];

  async function test(name: string, fn: () => Promise<string>) {
    try {
      const detail = await fn();
      results.push({ name, status: 'PASS', detail });
      console.log(`PASS: ${name} — ${detail}`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      results.push({ name, status: 'FAIL', detail });
      console.error(`FAIL: ${name} — ${detail}`);
    }
  }

  try {
    // 1. Unauthenticated connection rejected
    await test('Unauthenticated Socket.IO connection rejected with AUTH_REQUIRED', async () => {
      let rejected = false;
      try {
        await connectSocket(baseUrl);
      } catch (err) {
        rejected = true;
        assert.ok(String(err).includes('AUTH_REQUIRED'));
      }
      assert.equal(rejected, true);
      return 'Missing token rejected before connection';
    });

    // 2. Invalid token rejected
    await test('Invalid Firebase token rejected with AUTH_INVALID', async () => {
      let rejected = false;
      try {
        await connectSocket(baseUrl, 'forged-token-123');
      } catch (err) {
        rejected = true;
        assert.ok(String(err).includes('AUTH_INVALID'));
      }
      assert.equal(rejected, true);
      return 'Forged token rejected cleanly';
    });

    const custA = await connectSocket(baseUrl, 'tok-cust-a');
    const custB = await connectSocket(baseUrl, 'tok-cust-b');
    const partner1 = await connectSocket(baseUrl, 'tok-partner-1');
    const partner2 = await connectSocket(baseUrl, 'tok-partner-2');
    openSockets.push(custA, custB, partner1, partner2);

    // 3. Unauthorized customer & unassigned partner rejected from order room
    await test('Unauthorized customer and unassigned partner rejected from ord_live_1', async () => {
      const custBJoin = await new Promise<{ ok: boolean; code?: string }>((resolve) =>
        custB.emit('tracking:join', { orderId: 'ord_live_1', role: 'customer' }, resolve)
      );
      assert.equal(custBJoin.ok, false);
      assert.equal(custBJoin.code, 'FORBIDDEN');

      const partner2Join = await new Promise<{ ok: boolean; code?: string }>((resolve) =>
        partner2.emit('tracking:join', { orderId: 'ord_live_1', role: 'partner' }, resolve)
      );
      assert.equal(partner2Join.ok, false);
      assert.equal(partner2Join.code, 'FORBIDDEN');

      const unauthorizedEmit = await new Promise<{ ok: boolean; code?: string }>((resolve) =>
        partner2.emit(
          'tracking:location_update',
          { orderId: 'ord_live_1', latitude: 12.9716, longitude: 77.5946, accuracy: 8 },
          resolve
        )
      );
      assert.equal(unauthorizedEmit.ok, false);
      assert.equal(unauthorizedEmit.code, 'FORBIDDEN');
      return 'Customer B & Partner 2 blocked with FORBIDDEN';
    });

    // 4. Authorized join & isolated room broadcast
    await test('Authorized partner GPS broadcasts live to Customer A only (isolated from Customer B)', async () => {
      // Customer B joins their own separate order room ord_other_2
      const custBOwn = await new Promise<{ ok: boolean }>((resolve) =>
        custB.emit('tracking:join', { orderId: 'ord_other_2', role: 'customer' }, resolve)
      );
      assert.equal(custBOwn.ok, true);

      const custAJoin = await new Promise<{ ok: boolean }>((resolve) =>
        custA.emit('tracking:join', { orderId: 'ord_live_1', role: 'customer' }, resolve)
      );
      assert.equal(custAJoin.ok, true);

      const partner1Join = await new Promise<{ ok: boolean }>((resolve) =>
        partner1.emit('tracking:join', { orderId: 'ord_live_1', role: 'partner' }, resolve)
      );
      assert.equal(partner1Join.ok, true);

      let custBReceivedLeak = false;
      custB.on('tracking:location', () => {
        custBReceivedLeak = true;
      });

      const receivedPromise = new Promise<LiveLocationPayload>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Did not receive tracking:location')), 3_000);
        custA.once('tracking:location', (pkt: LiveLocationPayload) => {
          clearTimeout(t);
          resolve(pkt);
        });
      });

      const emitAck = await new Promise<{ ok: boolean; deliveryStage?: string }>((resolve) =>
        partner1.emit(
          'tracking:location_update',
          {
            orderId: 'ord_live_1',
            latitude: 12.968,
            longitude: 77.632,
            accuracy: 11.4,
            heading: 42,
            speed: 6.5,
            deliveryStage: 'OUT_FOR_DELIVERY',
          },
          resolve
        )
      );
      assert.equal(emitAck.ok, true);
      assert.equal(emitAck.deliveryStage, 'OUT_FOR_DELIVERY');

      const pkt = await receivedPromise;
      assert.equal(pkt.orderId, 'ord_live_1');
      assert.equal(pkt.latitude, 12.968);
      assert.equal(pkt.longitude, 77.632);
      assert.equal(pkt.accuracy, 11.4);
      assert.equal(pkt.heading, 42);
      assert.equal(pkt.speed, 6.5);
      assert.equal(pkt.deliveryPartnerId, 'uid_partner_1');
      assert.equal(custBReceivedLeak, false);
      return `Customer A received live packet (${pkt.latitude}, ${pkt.longitude}); zero leak to Customer B`;
    });

    // 5. Rate limit & invalid coordinate validation
    await test('Rate limiter blocks <1.5s burst & rejects invalid GPS coordinates', async () => {
      const rapidAck = await new Promise<{ ok: boolean; code?: string }>((resolve) =>
        partner1.emit(
          'tracking:location_update',
          { orderId: 'ord_live_1', latitude: 12.969, longitude: 77.633, accuracy: 10 },
          resolve
        )
      );
      assert.equal(rapidAck.ok, false);
      assert.equal(rapidAck.code, 'RATE_LIMITED');

      await sleep(1_600);

      const invalidAck = await new Promise<{ ok: boolean; code?: string }>((resolve) =>
        partner1.emit(
          'tracking:location_update',
          { orderId: 'ord_live_1', latitude: 999, longitude: 77.633, accuracy: 10 },
          resolve
        )
      );
      assert.equal(invalidAck.ok, false);
      assert.equal(invalidAck.code, 'INVALID_COORDS');
      return 'RATE_LIMITED and INVALID_COORDS enforced cleanly';
    });

    // 6. Automatic proximity transitions: NEAR_DESTINATION (<=500m) and ARRIVED (<=80m)
    await test('Proximity detection auto-transitions to NEAR_DESTINATION (<=500m) and ARRIVED (<=80m)', async () => {
      // ~250m from dropoff (12.9784, 77.6408)
      const nearStatusPromise = new Promise<{ deliveryStage: string }>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Missed NEAR_DESTINATION status')), 3_000);
        custA.once('tracking:status', (ev) => {
          clearTimeout(t);
          resolve(ev);
        });
      });

      const nearAck = await new Promise<{ ok: boolean; deliveryStage?: string }>((resolve) =>
        partner1.emit(
          'tracking:location_update',
          { orderId: 'ord_live_1', latitude: 12.9765, longitude: 77.6408, accuracy: 9 },
          resolve
        )
      );
      assert.equal(nearAck.ok, true);
      assert.equal(nearAck.deliveryStage, 'NEAR_DESTINATION');
      const nearEv = await nearStatusPromise;
      assert.equal(nearEv.deliveryStage, 'NEAR_DESTINATION');

      await sleep(1_600);

      // ~22m from dropoff
      const arrivedStatusPromise = new Promise<{ deliveryStage: string }>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Missed ARRIVED status')), 3_000);
        custA.once('tracking:status', (ev) => {
          clearTimeout(t);
          resolve(ev);
        });
      });

      const arrivedAck = await new Promise<{ ok: boolean; deliveryStage?: string }>((resolve) =>
        partner1.emit(
          'tracking:location_update',
          { orderId: 'ord_live_1', latitude: 12.9786, longitude: 77.6408, accuracy: 6 },
          resolve
        )
      );
      assert.equal(arrivedAck.ok, true);
      assert.equal(arrivedAck.deliveryStage, 'ARRIVED');
      const arrivedEv = await arrivedStatusPromise;
      assert.equal(arrivedEv.deliveryStage, 'ARRIVED');
      return 'Auto-transitioned NEAR_DESTINATION -> ARRIVED based on real Haversine proximity';
    });

    // 7. Terminal DELIVERED shuts down tracking and rejects further GPS updates
    await test('DELIVERED status emits tracking:ended and rejects further GPS updates', async () => {
      const endedPromise = new Promise<{ orderId: string; reason: string }>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Missed tracking:ended')), 3_000);
        custA.once('tracking:ended', (ev) => {
          clearTimeout(t);
          resolve(ev);
        });
      });

      const doneAck = await new Promise<{ ok: boolean }>((resolve) =>
        partner1.emit('tracking:status_update', { orderId: 'ord_live_1', deliveryStage: 'DELIVERED' }, resolve)
      );
      assert.equal(doneAck.ok, true);

      const endedEv = await endedPromise;
      assert.equal(endedEv.orderId, 'ord_live_1');
      assert.equal(endedEv.reason, 'DELIVERED');

      await sleep(1_600);

      const postEndAck = await new Promise<{ ok: boolean; code?: string }>((resolve) =>
        partner1.emit(
          'tracking:location_update',
          { orderId: 'ord_live_1', latitude: 12.9786, longitude: 77.6408, accuracy: 6 },
          resolve
        )
      );
      assert.equal(postEndAck.ok, false);
      assert.equal(postEndAck.code, 'TRACKING_ENDED');

      const snap = handle.getOrderSnapshot('ord_live_1');
      assert.equal(snap?.ended, true);
      assert.equal(snap?.trackingActive, false);
      return 'tracking:ended received by customer; subsequent GPS rejected with TRACKING_ENDED';
    });
  } finally {
    for (const s of openSockets) s.disconnect();
    handle.io.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed.`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
