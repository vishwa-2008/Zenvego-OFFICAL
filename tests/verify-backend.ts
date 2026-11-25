import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { createApp } from '../server.ts';

async function runTests() {
  const results: Array<{ name: string; status: 'PASS' | 'FAIL'; detail: string }> = [];

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

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
    // 1. Health check returns 200 without leaking secrets
    await test('GET /api/health returns live config flags without secrets', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body.status, 'ok');
      assert.equal(body.service, 'zenvego-api');
      assert.equal(body.firebaseProjectConfigured, true);
      assert.equal(body.mapsProvider, 'maplibre-osm');
      assert.equal(body.mapsConfigured, true);
      assert.equal(body.socketIoEnabled, true);
      assert.equal(body.mapStyleDefault, 'openfreemap-liberty');
      assert.equal('googleMapsConfigured' in body, false);
      assert.equal('keySecret' in body, false);
      assert.equal('apiKey' in body, false);
      return `firebaseProjectConfigured=${body.firebaseProjectConfigured}, mapsProvider=${body.mapsProvider}, socketIoEnabled=${body.socketIoEnabled}`;
    });

    // 2. Protected routes reject unauthenticated calls with 401
    await test('Protected endpoints reject missing Bearer token with 401', async () => {
      const protectedCalls: Array<[string, string, unknown?]> = [
        ['GET', '/api/auth/me'],
        ['GET', '/api/tracking/ord_test_1'],
        ['POST', '/api/checkout/validate', { idempotencyKey: 'k1', items: [] }],
        ['POST', '/api/qr/generate', { type: 'store', growerId: 'g1' }],
        ['POST', '/api/qr/verify', { scannedPayload: 'abc' }],
        ['POST', '/api/qr/consume', { scannedPayload: 'abc' }],
        ['POST', '/api/maps/serviceability', { lat: 12.9784, lng: 77.6408 }],
        ['POST', '/api/maps/search', { query: 'Indiranagar' }],
        ['POST', '/api/maps/geocode', { lat: 12.9784, lng: 77.6408 }],
        ['POST', '/api/maps/route', { origin: { lat: 12.9784, lng: 77.6408 }, destination: { lat: 12.9352, lng: 77.6245 } }],
        ['POST', '/api/maps/ai-locate', { description: 'near Indiranagar metro' }],
        ['POST', '/api/maps/ai-insights', { mode: 'location', lat: 12.9784, lng: 77.6408 }],
        ['POST', '/api/payments/create', { amountInr: 100, orderCode: 'ZVG-1' }],
        ['POST', '/api/payments/verify', { razorpay_order_id: 'o', razorpay_payment_id: 'p', razorpay_signature: 's' }],
        ['POST', '/api/refunds', { paymentId: 'pay_1', amountInr: 100, reason: 'test' }],
      ];
      for (const [method, urlPath, body] of protectedCalls) {
        const res = await fetch(`${baseUrl}${urlPath}`, {
          method,
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        assert.equal(res.status, 401, `Expected 401 on ${method} ${urlPath}, got ${res.status}`);
      }
      return `Verified 401 on all ${protectedCalls.length} protected endpoints`;
    });

    // 3. Forged/malformed Bearer token rejected with 401
    await test('Forged Bearer JWT rejected by firebase-admin verifyIdToken', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: 'Bearer forged.jwt.token' },
      });
      assert.equal(res.status, 401);
      return 'HTTP 401 returned for forged JWT';
    });

    // 4. Admin Portal API explicitly disabled (returns 404)
    await test('Admin portal routes (/api/admin/*) explicitly return 404', async () => {
      const res = await fetch(`${baseUrl}/api/admin/dashboard`);
      assert.equal(res.status, 404);
      const body = (await res.json()) as { error?: string };
      assert.equal(body.error, 'Endpoint not enabled.');
      return 'HTTP 404 confirmed (Admin Portal strictly excluded)';
    });

    // 5. Webhook fails closed (503) when secret is unconfigured
    await test('POST /api/webhooks/payment returns 503 when RAZORPAY_WEBHOOK_SECRET unset', async () => {
      const prev = process.env.RAZORPAY_WEBHOOK_SECRET;
      delete process.env.RAZORPAY_WEBHOOK_SECRET;
      try {
        const res = await fetch(`${baseUrl}/api/webhooks/payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'payment.captured' }),
        });
        assert.equal(res.status, 503);
        return 'HTTP 503 returned honestly when unconfigured';
      } finally {
        if (prev !== undefined) process.env.RAZORPAY_WEBHOOK_SECRET = prev;
      }
    });

    // 6. Webhook rejects bad HMAC signature with 401, accepts valid HMAC with 200, and blocks duplicate replay
    await test('POST /api/webhooks/payment verifies HMAC-SHA256 & deduplicates replay', async () => {
      const prev = process.env.RAZORPAY_WEBHOOK_SECRET;
      const testSecret = 'whsec_zenvego_automated_test_secret';
      process.env.RAZORPAY_WEBHOOK_SECRET = testSecret;
      try {
        const rawPayload = JSON.stringify({
          event: 'payment.captured',
          payload: { payment: { entity: { id: 'pay_test_123', amount: 15000 } } },
        });

        // 6a. Invalid signature -> 401
        const badRes = await fetch(`${baseUrl}/api/webhooks/payment`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-razorpay-signature': 'deadbeef',
            'x-razorpay-event-id': 'evt_test_replay_1',
          },
          body: rawPayload,
        });
        assert.equal(badRes.status, 401);

        // 6b. Valid signature -> 200 duplicate: false
        const validSig = crypto.createHmac('sha256', testSecret).update(rawPayload).digest('hex');
        const goodRes = await fetch(`${baseUrl}/api/webhooks/payment`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-razorpay-signature': validSig,
            'x-razorpay-event-id': 'evt_test_replay_1',
          },
          body: rawPayload,
        });
        assert.equal(goodRes.status, 200);
        const goodBody = (await goodRes.json()) as { received: boolean; duplicate: boolean; eventType: string };
        assert.equal(goodBody.received, true);
        assert.equal(goodBody.duplicate, false);
        assert.equal(goodBody.eventType, 'payment.captured');

        // 6c. Duplicate replay of same event -> 200 duplicate: true
        const replayRes = await fetch(`${baseUrl}/api/webhooks/payment`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-razorpay-signature': validSig,
            'x-razorpay-event-id': 'evt_test_replay_1',
          },
          body: rawPayload,
        });
        assert.equal(replayRes.status, 200);
        const replayBody = (await replayRes.json()) as { received: boolean; duplicate: boolean };
        assert.equal(replayBody.received, true);
        assert.equal(replayBody.duplicate, true);

        return 'Bad sig=401, valid HMAC=200 (duplicate=false), replay=200 (duplicate=true)';
      } finally {
        if (prev === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
        else process.env.RAZORPAY_WEBHOOK_SECRET = prev;
      }
    });
  } finally {
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
