/**
 * Zenvego Dynamic & Printable QR Code Generator Utility
 * Generates instant, high-resolution, offline-safe PNG & vector SVG QR codes
 * directly in the browser via the `qrcode` library, linking every product listing
 * to its unique direct checkout page for offline-to-online grower marketing.
 */
import QRCode from 'qrcode';

export type QrErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';
export type PrintTemplateKind = 'crate-tag' | 'standee' | 'a4-poster';

export interface QrImageOptions {
  size?: number;
  format?: 'png' | 'svg';
  color?: string; // Hex with or without '#' e.g. '#003820'
  bgColor?: string; // Hex with or without '#' e.g. '#ffffff'
  margin?: number;
  ecc?: QrErrorCorrectionLevel;
}

export interface ProductCheckoutUrlParams {
  productId: string;
  growerId?: string;
  qty?: number;
  src?: string;
  tagline?: string;
  origin?: string;
}

export interface MarketingQrAsset {
  kind: 'store' | 'product';
  title: string;
  subtitle: string;
  badge: string;
  targetUrl: string;
  pngUrl: string;
  svgUrl: string;
  filenameBase: string;
}

export interface UpiPaymentParams {
  pa: string; // Payee VPA e.g. zenvego.farm@upi
  pn: string; // Payee Display Name
  am: number; // Exact amount in INR
  tn: string; // Transaction note
  tr: string; // Order reference / transaction ref
  cu?: string; // Default 'INR'
}

export type ParsedZenvegoQr =
  | { kind: 'store'; growerId: string; raw: string }
  | {
      kind: 'product';
      productId: string;
      growerId?: string;
      qty?: number;
      src?: string;
      tagline?: string;
      directCheckout: boolean;
      raw: string;
    }
  | { kind: 'handshake_token'; token: string; raw: string }
  | { kind: 'handover_pin'; pin: string; raw: string }
  | { kind: 'unknown'; raw: string };

const PUBLIC_QR_API_ENDPOINT = 'https://api.qrserver.com/v1/create-qr-code/';

function normalizeHex(hex: string | undefined, fallback: string): string {
  const cleaned = (hex || fallback).trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(cleaned) || /^[0-9a-fA-F]{3}$/.test(cleaned)) {
    return `#${cleaned}`;
  }
  return fallback;
}

export function resolveAppOrigin(explicitOrigin?: string): string {
  if (explicitOrigin && explicitOrigin.trim()) {
    return explicitOrigin.replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, '');
  }
  return 'https://zenvego.local';
}

export function sanitizeFilename(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'zenvego-qr'
  );
}

/**
 * Generates a high-resolution local PNG Data URL directly in-browser (no external API needed).
 */
export async function renderDynamicQrPngDataUrl(
  data: string,
  options: QrImageOptions = {}
): Promise<string> {
  const width = Math.min(1600, Math.max(160, Math.round(options.size ?? 512)));
  const margin = Math.min(8, Math.max(1, Math.round(options.margin ?? 2)));
  const dark = normalizeHex(options.color, '#003820');
  const light = normalizeHex(options.bgColor, '#ffffff');
  const errorCorrectionLevel: QrErrorCorrectionLevel = options.ecc ?? 'H';

  return QRCode.toDataURL(data, {
    width,
    margin,
    errorCorrectionLevel,
    color: { dark, light },
  });
}

/**
 * Generates crisp vector SVG markup directly in-browser for lossless large-format printing.
 */
export async function renderDynamicQrSvg(
  data: string,
  options: QrImageOptions = {}
): Promise<string> {
  const margin = Math.min(8, Math.max(1, Math.round(options.margin ?? 2)));
  const dark = normalizeHex(options.color, '#003820');
  const light = normalizeHex(options.bgColor, '#ffffff');
  const errorCorrectionLevel: QrErrorCorrectionLevel = options.ecc ?? 'H';

  return QRCode.toString(data, {
    type: 'svg',
    margin,
    errorCorrectionLevel,
    color: { dark, light },
  });
}

/**
 * Fallback public QR API image URL (kept for backwards compatibility & UPI quick rendering).
 */
export function getPublicQrImageUrl(data: string, options: QrImageOptions = {}): string {
  const size = Math.min(1000, Math.max(120, Math.round(options.size ?? 320)));
  const format = options.format ?? 'png';
  const color = (options.color ?? '003820').replace(/^#/, '');
  const bgColor = (options.bgColor ?? 'FFFFFF').replace(/^#/, '');
  const margin = Math.min(20, Math.max(0, options.margin ?? 12));
  const ecc = options.ecc ?? 'M';

  const params = new URLSearchParams({
    data,
    size: `${size}x${size}`,
    format,
    color,
    bgcolor: bgColor,
    margin: String(margin),
    ecc,
  });

  return `${PUBLIC_QR_API_ENDPOINT}?${params.toString()}`;
}

/**
 * Builds the deep-link URL for a specific Grower Storefront.
 */
export function buildStoreMarketingUrl(growerId: string, origin?: string): string {
  const base = resolveAppOrigin(origin);
  return `${base}/?store=${encodeURIComponent(growerId.trim())}`;
}

/**
 * Builds the unique direct-to-checkout deep-link URL for a specific Produce Listing.
 * Scanning this URL lands buyers straight on the product's dedicated checkout page
 * with optional pre-filled quantity and offline campaign source attribution.
 */
export function buildProductCheckoutUrl(params: ProductCheckoutUrlParams): string {
  const base = resolveAppOrigin(params.origin);
  const query = new URLSearchParams({
    checkout: 'product',
    product: params.productId.trim(),
  });
  if (params.growerId?.trim()) {
    query.set('store', params.growerId.trim());
  }
  if (typeof params.qty === 'number' && Number.isFinite(params.qty) && params.qty > 1) {
    query.set('qty', String(Math.min(50, Math.max(1, Math.round(params.qty)))));
  }
  if (params.src?.trim()) {
    query.set('src', params.src.trim().slice(0, 40));
  }
  if (params.tagline?.trim()) {
    query.set('note', params.tagline.trim().slice(0, 80));
  }
  return `${base}/?${query.toString()}`;
}

/**
 * Alias kept for existing callers — now links directly to the product's unique checkout page.
 */
export function buildProductMarketingUrl(
  productId: string,
  growerId?: string,
  origin?: string,
  qty?: number,
  src?: string
): string {
  return buildProductCheckoutUrl({ productId, growerId, origin, qty, src });
}

/**
 * Generates a complete Storefront Offline Marketing QR Asset.
 */
export function generateStoreMarketingQr(params: {
  growerId: string;
  farmName: string;
  areaName?: string;
  origin?: string;
  size?: number;
}): MarketingQrAsset {
  const targetUrl = buildStoreMarketingUrl(params.growerId, params.origin);
  return {
    kind: 'store',
    title: params.farmName || 'Zenvego Local Grower',
    subtitle: params.areaName
      ? `${params.areaName} · Scan to order same-day terrace harvests`
      : 'Scan to browse live fresh produce directly from this local farm',
    badge: 'OFFICIAL ZENVEGO STOREFRONT QR',
    targetUrl,
    pngUrl: getPublicQrImageUrl(targetUrl, { size: params.size ?? 360, format: 'png', color: '003820' }),
    svgUrl: getPublicQrImageUrl(targetUrl, { size: params.size ?? 360, format: 'svg', color: '003820' }),
    filenameBase: `zenvego-store-${sanitizeFilename(params.farmName)}`,
  };
}

/**
 * Generates a complete Product-Specific Direct Checkout QR Asset.
 */
export function generateProductMarketingQr(params: {
  productId: string;
  productName: string;
  farmName: string;
  price: number;
  unit: string;
  growerId?: string;
  qty?: number;
  src?: string;
  origin?: string;
  size?: number;
}): MarketingQrAsset {
  const targetUrl = buildProductCheckoutUrl({
    productId: params.productId,
    growerId: params.growerId,
    qty: params.qty,
    src: params.src,
    origin: params.origin,
  });
  return {
    kind: 'product',
    title: params.productName,
    subtitle: `${params.farmName} · ₹${params.price} / ${params.unit}`,
    badge: 'DIRECT PRODUCT CHECKOUT QR',
    targetUrl,
    pngUrl: getPublicQrImageUrl(targetUrl, { size: params.size ?? 360, format: 'png', color: '003820' }),
    svgUrl: getPublicQrImageUrl(targetUrl, { size: params.size ?? 360, format: 'svg', color: '003820' }),
    filenameBase: `zenvego-checkout-${sanitizeFilename(params.productName)}`,
  };
}

/**
 * Renders a high-DPI print-ready branded marketing card PNG on an offscreen HTML5 canvas
 * (1200 x 1600 px) with product title, price, farm origin, freshness info, QR code, and direct URL.
 */
export async function renderPrintableProductCardPng(params: {
  productName: string;
  variety?: string;
  farmName: string;
  price: number;
  unit: string;
  harvestedAt?: string;
  chemicalFree?: boolean;
  targetUrl: string;
  ctaLine?: string;
  placementLabel?: string;
  qrColor?: string;
  ecc?: QrErrorCorrectionLevel;
  showPrice?: boolean;
  showFreshness?: boolean;
  showUrlCaption?: boolean;
}): Promise<string> {
  const width = 1200;
  const height = 1600;
  const ink = normalizeHex(params.qrColor, '#003820');

  const qrDataUrl = await renderDynamicQrPngDataUrl(params.targetUrl, {
    size: 720,
    margin: 2,
    color: ink,
    bgColor: '#ffffff',
    ecc: params.ecc ?? 'H',
  });

  const qrImg = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not render QR image onto print canvas.'));
    img.src = qrDataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context is unavailable.');
  }

  // Crisp white printable paper background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Outer trim hairline border
  ctx.strokeStyle = '#d1ddd3';
  ctx.lineWidth = 4;
  ctx.strokeRect(36, 36, width - 72, height - 72);

  // Top forest header band
  ctx.fillStyle = ink;
  ctx.fillRect(36, 36, width - 72, 136);

  ctx.fillStyle = '#ffffff';
  ctx.font = '800 38px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('ZENVEGO', 88, 118);

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '600 24px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText((params.placementLabel || 'DIRECT FARM CHECKOUT').toUpperCase(), width - 88, 114);

  // Product Title (wrapped up to 2 lines)
  ctx.textAlign = 'center';
  ctx.fillStyle = '#131e17';
  ctx.font = '800 62px "Plus Jakarta Sans", system-ui, sans-serif';
  const words = params.productName.trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > width - 190 && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  const titleLines = lines.slice(0, 2);
  let y = 264;
  for (const line of titleLines) {
    ctx.fillText(line, width / 2, y);
    y += 74;
  }

  // Farm origin + variety metadata line
  ctx.fillStyle = '#404942';
  ctx.font = '600 30px "Plus Jakarta Sans", system-ui, sans-serif';
  const metaParts = [params.farmName, params.variety].filter(Boolean);
  ctx.fillText(metaParts.join(' · ').slice(0, 62), width / 2, y + 6);
  y += 56;

  // Freshness line
  if (params.showFreshness !== false) {
    const freshParts = [
      params.harvestedAt || 'Fresh Local Harvest',
      params.chemicalFree ? 'Chemical-Free Grown' : '',
    ].filter(Boolean);
    ctx.fillStyle = '#006d34';
    ctx.font = '700 26px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(freshParts.join('  ·  '), width / 2, y + 6);
    y += 52;
  }

  // Price callout
  if (params.showPrice !== false) {
    ctx.fillStyle = ink;
    ctx.font = '800 56px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(`₹${params.price} / ${params.unit}`, width / 2, y + 28);
    y += 74;
  }

  // QR Container Frame
  const qrBoxSize = 680;
  const qrX = (width - qrBoxSize) / 2;
  const qrY = Math.max(y + 12, 530);

  ctx.fillStyle = '#f8fcf9';
  ctx.fillRect(qrX - 24, qrY - 24, qrBoxSize + 48, qrBoxSize + 48);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 4;
  ctx.strokeRect(qrX - 24, qrY - 24, qrBoxSize + 48, qrBoxSize + 48);

  ctx.drawImage(qrImg, qrX, qrY, qrBoxSize, qrBoxSize);

  // Scan CTA footer
  const ctaY = qrY + qrBoxSize + 96;
  ctx.fillStyle = '#131e17';
  ctx.font = '800 34px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(params.ctaLine || 'Scan with phone camera to checkout instantly', width / 2, ctaY);

  ctx.fillStyle = '#404942';
  ctx.font = '500 24px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText('Direct hyperlocal order · Live stock · Verified doorstep delivery', width / 2, ctaY + 46);

  if (params.showUrlCaption !== false) {
    const compactUrl = params.targetUrl.replace(/^https?:\/\//i, '');
    const displayUrl = compactUrl.length > 74 ? `${compactUrl.slice(0, 71)}...` : compactUrl;
    ctx.fillStyle = '#5c665e';
    ctx.font = '500 20px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(displayUrl, width / 2, height - 76);
  }

  return canvas.toDataURL('image/png');
}

/**
 * Builds an NPCI-compliant UPI Deep Link URI (`upi://pay?...`) for instant zero-fee UPI QR payments.
 */
export function buildUpiPaymentUri(params: UpiPaymentParams): string {
  const amount = Math.max(1, Math.round(params.am * 100) / 100).toFixed(2);
  const query = new URLSearchParams({
    pa: params.pa.trim(),
    pn: params.pn.trim().slice(0, 60),
    am: amount,
    cu: params.cu || 'INR',
    tn: params.tn.trim().slice(0, 80),
    tr: params.tr.trim().slice(0, 35),
  });
  return `upi://pay?${query.toString()}`;
}

/**
 * Generates a scannable UPI Payment QR image URL via the public QR API.
 */
export function getUpiPaymentQrUrl(
  params: UpiPaymentParams,
  size = 280
): {
  upiUri: string;
  qrImageUrl: string;
} {
  const upiUri = buildUpiPaymentUri(params);
  return {
    upiUri,
    qrImageUrl: getPublicQrImageUrl(upiUri, {
      size,
      format: 'png',
      color: '002b19',
      bgColor: 'ffffff',
      margin: 10,
      ecc: 'M',
    }),
  };
}

/**
 * Downloads raw SVG markup cleanly as a `.svg` file.
 */
export function downloadSvgMarkup(svgMarkup: string, filename: string): void {
  const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename.endsWith('.svg') ? filename : `${filename}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  }
}

/**
 * Downloads any QR image (PNG/SVG or data URL) cleanly via Blob so cross-origin `download` attributes always work.
 */
export async function downloadQrImage(imageUrl: string, filename: string): Promise<void> {
  if (imageUrl.startsWith('data:')) {
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return;
  }

  const res = await fetch(imageUrl, { mode: 'cors' });
  if (!res.ok) {
    throw new Error('Could not download QR image from QR API.');
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  }
}

/**
 * Parses any scanned QR code string or browser URL into a typed Zenvego action
 * (unique product checkout link, storefront link, signed handshake token, or 4-digit PIN).
 */
export function parseZenvegoQrPayload(rawInput: string): ParsedZenvegoQr {
  const raw = rawInput.trim();
  if (!raw) return { kind: 'unknown', raw };

  if (
    raw.startsWith('zvg_qr_v1:') ||
    raw.startsWith('zvg_qr_v2.') ||
    raw.startsWith('zvg_pickup_') ||
    raw.startsWith('zvg_delivery_')
  ) {
    return { kind: 'handshake_token', token: raw, raw };
  }

  if (raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw) as { k?: string; token?: string };
      const tok = typeof obj.k === 'string' ? obj.k : typeof obj.token === 'string' ? obj.token : '';
      if (tok) {
        return { kind: 'handshake_token', token: tok, raw };
      }
    } catch {
      // Fall through
    }
  }

  if (/^\d{4}$/.test(raw)) {
    return { kind: 'handover_pin', pin: raw, raw };
  }

  // Try parsing as a URL or query string containing ?checkout=product&product=... / ?product=... / ?store=...
  try {
    const parsed =
      raw.startsWith('http://') || raw.startsWith('https://')
        ? new URL(raw)
        : raw.includes('?') || raw.startsWith('/')
          ? new URL(raw, 'https://zenvego.local')
          : null;

    if (parsed) {
      const pathMatch = parsed.pathname.match(/^\/checkout\/product\/([a-zA-Z0-9_-]{1,128})$/);
      const productId = (parsed.searchParams.get('product') || pathMatch?.[1] || '').trim();
      const growerId = parsed.searchParams.get('store')?.trim() || undefined;
      const checkoutMode = parsed.searchParams.get('checkout')?.trim();
      const qtyRaw = Number(parsed.searchParams.get('qty') || '');
      const qty = Number.isFinite(qtyRaw) && qtyRaw >= 1 ? Math.min(50, Math.round(qtyRaw)) : undefined;
      const src = parsed.searchParams.get('src')?.trim() || undefined;
      const tagline = parsed.searchParams.get('note')?.trim() || undefined;

      if (productId) {
        return {
          kind: 'product',
          productId,
          growerId,
          qty,
          src,
          tagline,
          directCheckout: checkoutMode === 'product' || Boolean(pathMatch) || true,
          raw,
        };
      }
      if (growerId) {
        return { kind: 'store', growerId, raw };
      }
    }
  } catch {
    // Fall through to unknown
  }

  return { kind: 'unknown', raw };
}
