import { auth } from './firebase';

export class ApiError extends Error {
  status: number;
  code?: string;
  payload?: Record<string, unknown>;

  constructor(message: string, status: number, code?: string, payload?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) {
    throw new ApiError('Please sign in with Google to perform this action.', 401, 'auth/unauthenticated');
  }
  const token = await user.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export async function apiRequest<T>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; requireAuth?: boolean } = {}
): Promise<T> {
  const { method = 'GET', body, requireAuth = true } = options;
  const headers = requireAuth ? await getAuthHeaders() : { 'Content-Type': 'application/json' };

  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(
      (typeof data.error === 'string' && data.error) || `Request failed (${res.status})`,
      res.status,
      typeof data.code === 'string' ? data.code : undefined,
      data
    );
  }
  return data as T;
}

export interface ServerHealthResponse {
  status: string;
  service: string;
  firebaseProjectConfigured: boolean;
  mapsProvider: string;
  mapsConfigured: boolean;
  customOsrmConfigured?: boolean;
  customGeocoderConfigured?: boolean;
  razorpayConfigured: boolean;
  razorpayWebhookConfigured: boolean;
  timestamp: string;
}

export interface CheckoutValidationResponse {
  checkoutId: string;
  orderCode: string;
  handoverPin: string;
  itemsTotal: number;
  itemsTotalPaise: number;
  deliveryFee: number;
  deliveryFeePaise: number;
  totalPaid: number;
  totalPaidPaise: number;
  commissionBps: number;
  quoteSignature: string;
  quoteExpiresAtMs: number;
  serviceabilityNote: string;
  validatedAt: string;
  idempotentReplay: boolean;
  sellerSplits: {
    growerId: string;
    farmName: string;
    grossAmount: number;
    grossPaise: number;
    platformFee: number;
    platformFeePaise: number;
    netPayout: number;
    netPayoutPaise: number;
    handoverPin: string;
    sealId: string;
    items: {
      productId: string;
      name: string;
      unit: string;
      unitPrice: number;
      unitPricePaise: number;
      quantity: number;
      lineTotal: number;
      lineTotalPaise: number;
    }[];
  }[];
}

export interface QrGenerateResponse {
  type: 'store' | 'product' | 'pickup' | 'delivery';
  token?: string;
  payload: string;
  orderCode?: string;
  expiresAt?: string;
  pngDataUrl: string;
  svgMarkup: string;
}

export interface QrConsumeResponse {
  consumed: boolean;
  action: 'pickup' | 'delivery';
  orderId: string;
  sellerOrderId: string | null;
  orderCode: string;
  verifiedByUid: string;
  verifiedAt: string;
}

export interface ServiceabilityResponse {
  serviceable: boolean;
  nearestCluster: string;
  distanceKm: number;
  maxRadiusKm: number;
  estimatedEtaMins: number | null;
  etaBasis?: 'distance_estimate';
  message: string;
}

export interface PlaceSearchResult {
  id: string;
  title: string;
  subtitle: string;
  formattedAddress: string;
  lat: number;
  lng: number;
}

export interface PlaceSearchResponse {
  results: PlaceSearchResult[];
  provider: string;
  attribution: string;
  cached?: boolean;
}

export interface GeocodeResponse {
  formattedAddress: string;
  placeId: string;
  lat: number;
  lng: number;
  provider?: string;
  attribution?: string;
  cached?: boolean;
}

export interface RouteResponse {
  distanceMeters: number;
  distanceKm: number;
  durationSec: number;
  durationMins: number;
  straightLineKm?: number;
  includesTraffic: false;
  etaBasis: 'route_estimate_no_traffic';
  provider: string;
  attribution: string;
  cached?: boolean;
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
}

export interface AiLocateResponse {
  cleanQuery: string;
  areaHint: string;
  deliveryNoteSuggestion: string;
  results: PlaceSearchResult[];
  provider: string;
  attribution: string;
}

export interface AiMapInsightsResponse {
  areaBrief: string;
  dropTip: string;
  etaSummary: string;
  recommendedMapStyle: 'bright' | 'liberty' | 'dark';
  recommendedStyleReason: string;
  model: string;
}

export type AssistantChatMode = 'general' | 'fast' | 'search' | 'maps';

export interface AssistantChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface AssistantSearchSource {
  title: string;
  uri: string;
}

export interface AssistantMapSource {
  title: string;
  uri: string;
  reviewSnippets: string[];
}

export interface AssistantChatResponse {
  reply: string;
  model: string;
  mode: AssistantChatMode;
  searchSources: AssistantSearchSource[];
  mapSources: AssistantMapSource[];
}

export const zenvegoApi = {
  health: () => apiRequest<ServerHealthResponse>('/api/health', { requireAuth: false }),

  validateCheckout: (payload: {
    idempotencyKey: string;
    deliveryLat?: number;
    deliveryLng?: number;
    items: {
      productId: string;
      growerId: string;
      farmName: string;
      name: string;
      unit: string;
      unitPrice: number;
      quantity: number;
      availableStock: number;
    }[];
  }) => apiRequest<CheckoutValidationResponse>('/api/checkout/validate', { method: 'POST', body: payload }),

  generateQr: (payload: {
    type: 'store' | 'product' | 'pickup' | 'delivery';
    growerId?: string;
    productId?: string;
    qty?: number;
    src?: string;
    orderId?: string;
    sellerOrderId?: string;
    assignmentId?: string;
    orderCode?: string;
    handoverPin?: string;
  }) => apiRequest<QrGenerateResponse>('/api/qr/generate', { method: 'POST', body: payload }),

  consumeQr: (payload: {
    scannedPayload?: string;
    manualPin?: string;
    expectedAction: 'pickup' | 'delivery';
    expectedOrderId: string;
  }) => apiRequest<QrConsumeResponse>('/api/qr/consume', { method: 'POST', body: payload }),

  checkServiceability: (lat: number, lng: number) =>
    apiRequest<ServiceabilityResponse>('/api/maps/serviceability', { method: 'POST', body: { lat, lng } }),

  searchAddresses: (payload: { query: string; biasLat?: number; biasLng?: number; limit?: number }) =>
    apiRequest<PlaceSearchResponse>('/api/maps/search', {
      method: 'POST',
      body: payload,
    }),

  geocode: (payload: { address?: string; lat?: number; lng?: number }) =>
    apiRequest<GeocodeResponse>('/api/maps/geocode', {
      method: 'POST',
      body: payload,
    }),

  computeRoute: (origin: { lat: number; lng: number }, destination: { lat: number; lng: number }) =>
    apiRequest<RouteResponse>('/api/maps/route', { method: 'POST', body: { origin, destination } }),

  aiLocate: (payload: { description: string; biasLat?: number; biasLng?: number }) =>
    apiRequest<AiLocateResponse>('/api/maps/ai-locate', { method: 'POST', body: payload }),

  aiMapInsights: (payload: {
    mode: 'location' | 'delivery';
    address?: string;
    lat: number;
    lng: number;
    farmName?: string;
    dropoffLabel?: string;
    distanceKm?: number | null;
    durationMins?: number | null;
    stage?: string;
    serviceable?: boolean | null;
    localHour?: number;
  }) => apiRequest<AiMapInsightsResponse>('/api/maps/ai-insights', { method: 'POST', body: payload }),

  assistantChat: (payload: {
    messages: AssistantChatMessage[];
    mode: AssistantChatMode;
    userRole: 'customer' | 'grower' | 'delivery' | 'bulk';
    lat?: number;
    lng?: number;
    contextSummary?: string;
  }) => apiRequest<AssistantChatResponse>('/api/assistant/chat', { method: 'POST', body: payload }),

  createRazorpayOrder: (payload: {
    amountInr: number;
    totalPaidPaise: number;
    orderCode: string;
    quoteSignature: string;
    quoteExpiresAtMs: number;
    receipt?: string;
  }) =>
    apiRequest<{
      configured: boolean;
      keyId: string;
      razorpayOrderId: string;
      amount: number;
      currency: string;
      orderCode: string;
    }>('/api/payments/create', { method: 'POST', body: payload }),

  verifyRazorpayPayment: (payload: {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  }) =>
    apiRequest<{ verified: boolean; paymentId: string; orderId: string; verifiedAt: string }>('/api/payments/verify', {
      method: 'POST',
      body: payload,
    }),

  registerQrHandover: (payload: {
    action: 'pickup' | 'delivery';
    orderId: string;
    sellerOrderId?: string;
    orderCode: string;
    handoverPin: string;
  }) =>
    apiRequest<{ registered: boolean; action: string; orderId: string; orderCode: string }>(
      '/api/qr/register-handover',
      {
        method: 'POST',
        body: payload,
      }
    ),

  verifyUpiPayment: (payload: {
    orderCode: string;
    amountInr: number;
    utrNumber: string;
    payerUpiId?: string;
  }) =>
    apiRequest<{
      submitted: boolean;
      verified: boolean;
      paymentStatus: 'pending_upi_review';
      paymentId: string;
      orderCode: string;
      amountInr: number;
      message: string;
      submittedAt: string;
    }>('/api/payments/upi-verify', {
      method: 'POST',
      body: payload,
    }),

  verifyWalletTopUp: (payload: { amountInr: number; method: string; utrNumber: string }) =>
    apiRequest<{
      submitted: boolean;
      verified: boolean;
      status: 'pending_verification';
      amountInr: number;
      method: string;
      referenceId: string;
      message: string;
      submittedAt: string;
    }>('/api/wallet/verify-topup', {
      method: 'POST',
      body: payload,
    }),
};

