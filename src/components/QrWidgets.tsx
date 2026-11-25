import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Html5Qrcode } from 'html5-qrcode';
import { QrConsumeResponse, QrGenerateResponse, zenvegoApi } from '../lib/apiClient';
import {
  downloadQrImage,
  downloadSvgMarkup,
  generateProductMarketingQr,
  generateStoreMarketingQr,
  MarketingQrAsset,
  parseZenvegoQrPayload,
  renderDynamicQrPngDataUrl,
  renderDynamicQrSvg,
  renderPrintableProductCardPng,
} from '../utils/qrGenerator';

// ---------------------------------------------------------------------------
// 1. Unified QR Generator Modal
//    - Offline Marketing QRs (store / product): local instant dynamic PNG & SVG
//      via `qrcode` library + clean isolated print card + Print Studio handoff
//    - Single-Use Handshake QRs (pickup / delivery): signed backend tokens via /api/qr/generate
//      with reliable fallback & 4-digit PIN display
// ---------------------------------------------------------------------------
interface QrGeneratorModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  requestPayload: {
    type: 'store' | 'product' | 'pickup' | 'delivery';
    growerId?: string;
    productId?: string;
    productName?: string;
    farmName?: string;
    areaName?: string;
    price?: number;
    unit?: string;
    qty?: number;
    src?: string;
    orderId?: string;
    sellerOrderId?: string;
    orderCode?: string;
    handoverPin?: string;
  } | null;
  onOpenPrintStudio?: () => void;
  onPreviewCheckout?: () => void;
  onClose: () => void;
}

export const QrGeneratorModal: React.FC<QrGeneratorModalProps> = ({
  open,
  title,
  subtitle,
  requestPayload,
  onOpenPrintStudio,
  onPreviewCheckout,
  onClose,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<QrGenerateResponse | null>(null);
  const [marketingAsset, setMarketingAsset] = useState<MarketingQrAsset | null>(null);
  const [localPngDataUrl, setLocalPngDataUrl] = useState<string>('');
  const [localSvgMarkup, setLocalSvgMarkup] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [downloadingFmt, setDownloadingFmt] = useState<'png' | 'svg' | 'card' | null>(null);

  const isMarketingQr = requestPayload?.type === 'store' || requestPayload?.type === 'product';

  useEffect(() => {
    if (!open || !requestPayload) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setQr(null);
    setMarketingAsset(null);
    setLocalPngDataUrl('');
    setLocalSvgMarkup('');

    if (requestPayload.type === 'store' && requestPayload.growerId) {
      const asset = generateStoreMarketingQr({
        growerId: requestPayload.growerId,
        farmName: requestPayload.farmName || title.replace(/^Storefront QR\s*—\s*/i, ''),
        areaName: requestPayload.areaName || subtitle,
      });
      setMarketingAsset(asset);
      Promise.all([
        renderDynamicQrPngDataUrl(asset.targetUrl, { size: 512, margin: 2, color: '#003820', ecc: 'H' }),
        renderDynamicQrSvg(asset.targetUrl, { margin: 2, color: '#003820', ecc: 'H' }),
      ])
        .then(([png, svg]) => {
          if (!cancelled) {
            setLocalPngDataUrl(png);
            setLocalSvgMarkup(svg);
          }
        })
        .catch(() => {
          // Falls back cleanly to asset.pngUrl
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }

    if (requestPayload.type === 'product' && requestPayload.productId) {
      const asset = generateProductMarketingQr({
        productId: requestPayload.productId,
        productName: requestPayload.productName || title.replace(/^Product QR\s*—\s*/i, ''),
        farmName: requestPayload.farmName || 'Zenvego Local Farm',
        price: requestPayload.price ?? 0,
        unit: requestPayload.unit || 'pack',
        growerId: requestPayload.growerId,
        qty: requestPayload.qty,
        src: requestPayload.src,
      });
      setMarketingAsset(asset);
      Promise.all([
        renderDynamicQrPngDataUrl(asset.targetUrl, { size: 512, margin: 2, color: '#003820', ecc: 'H' }),
        renderDynamicQrSvg(asset.targetUrl, { margin: 2, color: '#003820', ecc: 'H' }),
      ])
        .then(([png, svg]) => {
          if (!cancelled) {
            setLocalPngDataUrl(png);
            setLocalSvgMarkup(svg);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }

    // Signed single-use pickup / delivery handshake QR
    zenvegoApi
      .generateQr({
        type: requestPayload.type,
        orderId: requestPayload.orderId,
        sellerOrderId: requestPayload.sellerOrderId,
        orderCode: requestPayload.orderCode,
        handoverPin: requestPayload.handoverPin,
      })
      .then((res) => {
        if (!cancelled) setQr(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to generate QR token.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, requestPayload, title, subtitle]);

  if (!open) return null;

  const activeImgSrc = isMarketingQr
    ? localPngDataUrl || marketingAsset?.pngUrl || qr?.pngDataUrl || ''
    : qr?.pngDataUrl || '';

  const shareText = isMarketingQr
    ? marketingAsset?.targetUrl || qr?.payload || ''
    : qr?.payload || '';

  const handleCopy = async () => {
    if (!shareText) return;
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Copy failed — please select and copy the link manually.');
    }
  };

  const handleDownload = async (format: 'png' | 'svg' | 'card') => {
    setDownloadingFmt(format);
    setError(null);
    try {
      if (isMarketingQr && marketingAsset) {
        if (format === 'card' && requestPayload?.type === 'product') {
          const cardPng = await renderPrintableProductCardPng({
            productName: requestPayload.productName || marketingAsset.title,
            farmName: requestPayload.farmName || 'Zenvego Local Farm',
            price: requestPayload.price ?? 0,
            unit: requestPayload.unit || 'pack',
            targetUrl: marketingAsset.targetUrl,
          });
          await downloadQrImage(cardPng, `${marketingAsset.filenameBase}-print-card.png`);
        } else if (format === 'svg' && localSvgMarkup) {
          downloadSvgMarkup(localSvgMarkup, `${marketingAsset.filenameBase}.svg`);
        } else {
          const png =
            localPngDataUrl ||
            (await renderDynamicQrPngDataUrl(marketingAsset.targetUrl, {
              size: 1024,
              margin: 2,
              color: '#003820',
              ecc: 'H',
            }));
          await downloadQrImage(png, `${marketingAsset.filenameBase}.png`);
        }
      } else if (qr?.pngDataUrl) {
        await downloadQrImage(
          qr.pngDataUrl,
          `zenvego-${requestPayload?.type || 'qr'}-${requestPayload?.orderCode || Date.now()}.png`
        );
      }
    } catch {
      setError('Could not download QR image. Please try again.');
    } finally {
      setDownloadingFmt(null);
    }
  };

  const handlePrintPoster = () => {
    document.body.classList.add('zenvego-printing');
    const cleanup = () => {
      document.body.classList.remove('zenvego-printing');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(() => {
      window.print();
      setTimeout(cleanup, 1200);
    }, 60);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-surface-container-lowest rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-2xl border border-outline-variant/25 space-y-4 my-auto">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-headline font-extrabold text-base text-primary leading-tight">{title}</h3>
            {subtitle && <p className="text-xs text-on-surface-variant mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close QR modal"
            className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-on-surface hover:bg-surface-container-high cursor-pointer shrink-0"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {loading && (
          <div className="py-12 flex flex-col items-center gap-2 text-on-surface-variant">
            <span className="material-symbols-outlined text-3xl animate-spin text-primary">progress_activity</span>
            <p className="text-xs font-semibold">Generating scannable QR code...</p>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-900 font-medium">
            {error}
          </div>
        )}

        {!loading && activeImgSrc && (
          <div className="flex flex-col items-center gap-3.5">
            {/* Printable Offline Marketing Poster Card (for Store/Product) OR Clean Handshake Frame */}
            <div className="w-full rounded-2xl bg-gradient-to-b from-[#f3fbf6] to-white border-2 border-primary/20 p-4 flex flex-col items-center text-center shadow-xs">
              {isMarketingQr && marketingAsset && (
                <p className="text-[10px] font-extrabold tracking-widest uppercase text-secondary mb-2">
                  {marketingAsset.badge}
                </p>
              )}

              <div className="bg-white p-3 rounded-2xl border border-outline-variant/30 shadow-xs">
                <img src={activeImgSrc} alt={title} className="w-52 h-52 object-contain" />
              </div>

              {isMarketingQr && marketingAsset && (
                <div className="mt-2.5 space-y-0.5">
                  <p className="text-sm font-extrabold text-primary">{marketingAsset.title}</p>
                  <p className="text-[11px] font-medium text-on-surface-variant tabular-nums">
                    {marketingAsset.subtitle}
                  </p>
                  <p className="text-[10px] font-semibold text-secondary pt-0.5">
                    {requestPayload?.type === 'product'
                      ? 'Links directly to this listing’s unique checkout page'
                      : 'Ready for print flyers, crate tags & shopfront stands'}
                  </p>
                </div>
              )}
            </div>

            {qr?.expiresAt && !isMarketingQr && (
              <div className="w-full px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-center justify-between">
                <span className="font-bold">Single-Use Signed Verification Token</span>
                <span>Expires {new Date(qr.expiresAt).toLocaleTimeString()}</span>
              </div>
            )}

            {requestPayload?.handoverPin && !isMarketingQr && (
              <div className="w-full px-3.5 py-2.5 rounded-xl bg-primary text-on-primary flex items-center justify-between">
                <span className="text-xs font-semibold">Backup 4-Digit Handover PIN</span>
                <span className="font-mono text-base font-extrabold tracking-widest">
                  {requestPayload.handoverPin}
                </span>
              </div>
            )}

            <div className="w-full bg-surface-container-low rounded-xl px-3 py-2 text-[11px] font-mono text-on-surface-variant break-all max-h-16 overflow-y-auto">
              {shareText}
            </div>

            {/* Action Buttons */}
            <div className="w-full grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="h-10 rounded-xl bg-surface-container hover:bg-surface-container-high text-primary text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">
                  {copied ? 'check' : 'content_copy'}
                </span>
                <span>{copied ? 'Copied!' : isMarketingQr ? 'Copy Link' : 'Copy Token'}</span>
              </button>

              <button
                type="button"
                disabled={downloadingFmt === 'png' || downloadingFmt === 'card'}
                onClick={() => handleDownload(requestPayload?.type === 'product' ? 'card' : 'png')}
                className="h-10 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-[16px]">download</span>
                <span>
                  {downloadingFmt === 'card' || downloadingFmt === 'png'
                    ? 'Saving...'
                    : requestPayload?.type === 'product'
                      ? 'Save Print Card'
                      : 'Download PNG'}
                </span>
              </button>

              {isMarketingQr && (
                <>
                  <button
                    type="button"
                    disabled={downloadingFmt === 'svg'}
                    onClick={() => handleDownload('svg')}
                    className="h-10 rounded-xl bg-secondary-container text-on-secondary-container text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    <span className="material-symbols-outlined text-[16px]">code</span>
                    <span>{downloadingFmt === 'svg' ? 'Saving...' : 'Vector SVG'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handlePrintPoster}
                    className="h-10 rounded-xl bg-surface-container-low border border-outline-variant/40 text-primary text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer hover:bg-surface-container"
                  >
                    <span className="material-symbols-outlined text-[16px]">print</span>
                    <span>Print Card</span>
                  </button>
                </>
              )}
            </div>

            {/* Optional Deep Studio / Live Checkout Preview Buttons */}
            {(onOpenPrintStudio || onPreviewCheckout) && (
              <div className="w-full flex flex-col sm:flex-row gap-2 pt-1 border-t border-outline-variant/20">
                {onOpenPrintStudio && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenPrintStudio();
                    }}
                    className="flex-1 h-10 rounded-xl bg-surface-container-low hover:bg-surface-container text-primary text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">tune</span>
                    <span>Customize in Print Studio</span>
                  </button>
                )}
                {onPreviewCheckout && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onPreviewCheckout();
                    }}
                    className="flex-1 h-10 rounded-xl border border-primary/30 text-primary hover:bg-surface-container-low text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                    <span>Open Checkout Page</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Dedicated Isolated Print Portal for this Modal */}
      {typeof document !== 'undefined' &&
        isMarketingQr &&
        marketingAsset &&
        activeImgSrc &&
        createPortal(
          <div className="zenvego-print-portal" aria-hidden="true">
            <div className="max-w-md mx-auto bg-white border-2 border-primary/30 rounded-2xl overflow-hidden text-center">
              <div className="bg-primary text-white px-6 py-4 flex items-center justify-between">
                <span className="text-sm font-extrabold tracking-widest uppercase">Zenvego</span>
                <span className="text-xs font-semibold">{marketingAsset.badge}</span>
              </div>
              <div className="p-8 flex flex-col items-center gap-4">
                <div>
                  <h2 className="text-2xl font-extrabold text-primary">{marketingAsset.title}</h2>
                  <p className="text-sm text-on-surface-variant mt-1">{marketingAsset.subtitle}</p>
                </div>
                <div className="p-4 border-2 border-primary rounded-2xl bg-white">
                  <img src={activeImgSrc} alt={marketingAsset.title} className="w-64 h-64 object-contain" />
                </div>
                <p className="text-sm font-bold text-on-surface">
                  Scan with your phone camera to open direct checkout
                </p>
                <p className="text-[10px] font-mono text-on-surface-variant break-all">
                  {marketingAsset.targetUrl}
                </p>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// 2. Real Camera QR Scanner + Manual Token / PIN Verification Modal
//    Supports BOTH:
//    - Handshake verification mode ('pickup' | 'delivery') -> consumes on backend
//    - Universal discovery mode ('universal') -> opens ?checkout=product&product= / ?store= deep links
// ---------------------------------------------------------------------------
interface QrScannerModalProps {
  open: boolean;
  title: string;
  expectedAction: 'pickup' | 'delivery' | 'universal';
  expectedOrderId?: string;
  onVerified?: (result: QrConsumeResponse) => void;
  onDeepLinkScanned?: (parsed: {
    kind: 'store' | 'product';
    growerId?: string;
    productId?: string;
    qty?: number;
    src?: string;
  }) => void;
  onClose: () => void;
}

export const QrScannerModal: React.FC<QrScannerModalProps> = ({
  open,
  title,
  expectedAction,
  expectedOrderId = '',
  onVerified,
  onDeepLinkScanned,
  onClose,
}) => {
  const regionIdRef = useRef(`zvg-qr-reader-${Math.random().toString(36).slice(2, 8)}`);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const stopCamera = async () => {
    const inst = scannerRef.current;
    scannerRef.current = null;
    if (inst) {
      try {
        if (inst.isScanning) {
          await inst.stop();
        }
        inst.clear();
      } catch {
        // Ignore teardown errors when unmounting
      }
    }
    setCameraActive(false);
  };

  useEffect(() => {
    if (!open) {
      stopCamera();
      setManualInput('');
      setErrorMsg(null);
      setStatusMsg(null);
      setCameraError(null);
    }
    return () => {
      stopCamera();
    };
  }, [open]);

  const handlePayload = async (rawValue: string) => {
    const trimmed = rawValue.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    setStatusMsg('Processing QR payload...');

    try {
      const parsed = parseZenvegoQrPayload(trimmed);

      // Universal mode (Customer/Profile QR scanner for storefront or direct product checkout QRs)
      if (expectedAction === 'universal') {
        if (parsed.kind === 'store' || parsed.kind === 'product') {
          await stopCamera();
          setStatusMsg(
            parsed.kind === 'store'
              ? 'Grower Storefront QR recognized! Opening farm...'
              : 'Direct Product Checkout QR recognized! Opening checkout...'
          );
          onDeepLinkScanned?.({
            kind: parsed.kind,
            growerId: parsed.growerId,
            productId: parsed.kind === 'product' ? parsed.productId : undefined,
            qty: parsed.kind === 'product' ? parsed.qty : undefined,
            src: parsed.kind === 'product' ? parsed.src : undefined,
          });
          return;
        }
        setErrorMsg(
          'Unrecognized QR link. Scan a Zenvego Product Checkout QR (?checkout=product&product=...) or Storefront QR (?store=...).'
        );
        setStatusMsg(null);
        return;
      }

      // Pickup / Delivery Handshake verification mode
      setStatusMsg('Verifying cryptographically with Zenvego server...');
      const isPin = /^\d{4}$/.test(trimmed);
      const res = await zenvegoApi.consumeQr(
        isPin
          ? { manualPin: trimmed, expectedAction, expectedOrderId }
          : { scannedPayload: trimmed, expectedAction, expectedOrderId }
      );
      await stopCamera();
      setStatusMsg(`Verified ${res.action.toUpperCase()} for ${res.orderCode}!`);
      onVerified?.(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'QR verification rejected by server.');
      setStatusMsg(null);
    } finally {
      setSubmitting(false);
    }
  };

  const startCamera = async () => {
    setCameraError(null);
    setErrorMsg(null);
    try {
      const scanner = new Html5Qrcode(regionIdRef.current);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decodedText) => {
          handlePayload(decodedText);
        },
        () => {
          // Ignore per-frame decode misses
        }
      );
      setCameraActive(true);
    } catch (err) {
      setCameraError(
        err instanceof Error
          ? `Camera unavailable (${err.message}). Use the manual input below.`
          : 'Camera permission unavailable. Paste the QR link/token or enter the 4-digit PIN below.'
      );
      await stopCamera();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-surface-container-lowest rounded-3xl max-w-md w-full p-5 shadow-2xl border border-outline-variant/25 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-headline font-extrabold text-base text-primary">{title}</h3>
            <p className="text-xs text-on-surface-variant">
              {expectedAction === 'universal'
                ? 'Scan any Zenvego Product Checkout QR or Storefront QR to jump straight to checkout or that farm.'
                : 'Scan the signed verification QR via camera, paste the token, or enter the 4-digit handover PIN.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center cursor-pointer shrink-0"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Camera Viewport */}
        <div className="rounded-2xl overflow-hidden bg-surface-container-low border border-outline-variant/30">
          <div id={regionIdRef.current} className={cameraActive ? 'w-full min-h-[240px]' : 'hidden'} />
          {!cameraActive && (
            <div className="p-6 flex flex-col items-center gap-3 text-center">
              <span className="material-symbols-outlined text-4xl text-primary">qr_code_scanner</span>
              <button
                type="button"
                onClick={startCamera}
                className="px-4 py-2.5 rounded-xl bg-primary text-on-primary text-xs font-bold flex items-center gap-1.5 cursor-pointer hover:bg-primary-container"
              >
                <span className="material-symbols-outlined text-[18px]">photo_camera</span>
                <span>Start Live Camera Scanner</span>
              </button>
              {cameraError && <p className="text-[11px] text-amber-800">{cameraError}</p>}
            </div>
          )}
        </div>

        {/* Manual Token / URL / 4-Digit PIN Fallback */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handlePayload(manualInput);
          }}
          className="space-y-2"
        >
          <label className="block text-xs font-bold text-on-surface">
            {expectedAction === 'universal'
              ? 'Or Paste Product Checkout / Storefront QR Link'
              : 'Or Enter 4-Digit Handover PIN / Signed Token'}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder={
                expectedAction === 'universal'
                  ? 'Paste ?checkout=product&product=... or ?store=... URL'
                  : '4-digit PIN (e.g. 4821) or zvg_qr_v1:...'
              }
              className="flex-1 px-3 py-2.5 rounded-xl border border-outline-variant bg-surface-container-lowest text-sm font-mono focus:outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={submitting || !manualInput.trim()}
              className="px-4 rounded-xl bg-secondary text-on-secondary text-xs font-bold disabled:opacity-50 cursor-pointer"
            >
              {submitting ? 'Checking...' : expectedAction === 'universal' ? 'Open' : 'Verify'}
            </button>
          </div>
        </form>

        {statusMsg && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 font-semibold">
            {statusMsg}
          </div>
        )}
        {errorMsg && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-900 font-semibold">
            {errorMsg}
          </div>
        )}
      </div>
    </div>
  );
};
