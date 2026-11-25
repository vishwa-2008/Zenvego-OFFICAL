import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckoutValidationResponse, zenvegoApi } from '../lib/apiClient';
import { fetchProductById } from '../lib/firestoreService';
import { GrowerListing, ProductCheckoutDeepLink, ScreenId, UserRole } from '../types';
import { buildUpiPaymentUri, renderDynamicQrPngDataUrl } from '../utils/qrGenerator';
import { SmartImage } from './ZenvegoLogo';

interface ProductCheckoutScreenProps {
  deepLink: ProductCheckoutDeepLink | null;
  isAuthenticated: boolean;
  role: UserRole;
  marketplaceListings: GrowerListing[];
  growerListings: GrowerListing[];
  deliveryLat: number;
  deliveryLng: number;
  deliveryAddress: string;
  walletBalance: number;
  savedUpiId: string;
  onAddToBasket: (listingId: string, quantity: number) => void;
  onPayWithWallet: (amountInr: number, orderCode: string) => Promise<void>;
  onPlaceValidatedOrder: (params: {
    validation: CheckoutValidationResponse;
    paymentMethod: string;
    paymentStatus: 'verified' | 'pending_upi_review' | 'doorstep_qr';
    paymentRef?: string;
  }) => Promise<void>;
  onSignInToCheckout: () => void;
  onReturnToQrStudio?: (productId: string) => void;
  onNavigate: (screen: ScreenId) => void;
  onNotify: (msg: string) => void;
}

function formatSourceLabel(src?: string): string | null {
  if (!src) return null;
  return src
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export const ProductCheckoutScreen: React.FC<ProductCheckoutScreenProps> = ({
  deepLink,
  isAuthenticated,
  role,
  marketplaceListings,
  growerListings,
  deliveryLat,
  deliveryLng,
  deliveryAddress,
  walletBalance,
  savedUpiId,
  onAddToBasket,
  onPayWithWallet,
  onPlaceValidatedOrder,
  onSignInToCheckout,
  onReturnToQrStudio,
  onNavigate,
  onNotify,
}) => {
  const [fetchedListing, setFetchedListing] = useState<GrowerListing | null>(null);
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [quantity, setQuantity] = useState<number>(Math.max(1, deepLink?.qty ?? 1));

  // Express direct checkout state
  const [checkoutStep, setCheckoutStep] = useState<'configure' | 'pay'>('configure');
  const [validation, setValidation] = useState<CheckoutValidationResponse | null>(null);
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<'upi_qr' | 'wallet' | 'doorstep_qr' | 'razorpay'>('upi_qr');
  const [upiUtr, setUpiUtr] = useState('');
  const [payerUpi, setPayerUpi] = useState(savedUpiId);
  const [localUpiQrDataUrl, setLocalUpiQrDataUrl] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [gatewayNotice, setGatewayNotice] = useState<string | null>(null);
  const idempotencyNonceRef = useRef(0);

  const isGrowerPreview = isAuthenticated && role === 'grower';
  const isDeliveryRole = isAuthenticated && role === 'delivery';

  // Resolve product from live state first, then fall back to direct Firestore document lookup
  const resolvedListing = useMemo(() => {
    if (!deepLink?.productId) return null;
    return (
      marketplaceListings.find((l) => l.id === deepLink.productId) ||
      growerListings.find((l) => l.id === deepLink.productId) ||
      (fetchedListing?.id === deepLink.productId ? fetchedListing : null)
    );
  }, [deepLink?.productId, marketplaceListings, growerListings, fetchedListing]);

  useEffect(() => {
    setQuantity(Math.max(1, deepLink?.qty ?? 1));
    setCheckoutStep('configure');
    setValidation(null);
    setValidationError(null);
    setGatewayNotice(null);
  }, [deepLink?.productId, deepLink?.qty]);

  useEffect(() => {
    if (!isAuthenticated || !deepLink?.productId || resolvedListing) return;
    let cancelled = false;
    setLoadingProduct(true);
    fetchProductById(deepLink.productId, deliveryLat, deliveryLng)
      .then((doc) => {
        if (!cancelled) setFetchedListing(doc);
      })
      .catch(() => {
        // Error surfaced cleanly via not-found state
      })
      .finally(() => {
        if (!cancelled) setLoadingProduct(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, deepLink?.productId, resolvedListing, deliveryLat, deliveryLng]);

  // Clamp quantity to available stock once product resolves
  useEffect(() => {
    if (resolvedListing && resolvedListing.stock > 0) {
      setQuantity((prev) => Math.min(resolvedListing.stock, Math.max(1, prev)));
    }
  }, [resolvedListing]);

  // Render local dynamic UPI QR image whenever server validation succeeds
  const upiUri = useMemo(() => {
    if (!validation) return '';
    return buildUpiPaymentUri({
      pa: 'zenvego.escrow@upi',
      pn: 'Zenvego Hyperlocal Produce',
      am: validation.totalPaid,
      tn: `Zenvego Direct Order ${validation.orderCode}`,
      tr: validation.orderCode.replace(/[^A-Za-z0-9]/g, ''),
    });
  }, [validation]);

  useEffect(() => {
    if (!upiUri) {
      setLocalUpiQrDataUrl('');
      return;
    }
    let cancelled = false;
    renderDynamicQrPngDataUrl(upiUri, {
      size: 320,
      margin: 2,
      color: '#002b19',
      bgColor: '#ffffff',
      ecc: 'M',
    })
      .then((url) => {
        if (!cancelled) setLocalUpiQrDataUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [upiUri]);

  const sourceLabel = formatSourceLabel(deepLink?.src);

  // 1. Unauthenticated shopper who scanned an offline printed QR code
  if (!isAuthenticated) {
    return (
      <div className="max-w-lg mx-auto bg-surface-container-lowest rounded-2xl p-6 sm:p-8 border border-outline-variant/25 shadow-sm space-y-5 text-center">
        <div className="w-14 h-14 rounded-2xl bg-surface-container-low text-primary flex items-center justify-center mx-auto">
          <span className="material-symbols-outlined text-3xl">qr_code_scanner</span>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-bold text-secondary">
            Direct Farm Checkout{sourceLabel ? ` · ${sourceLabel}` : ''}
          </p>
          <h2 className="text-xl font-extrabold text-primary text-balance">
            Sign In to Open Your Direct Product Checkout
          </h2>
          <p className="text-xs text-on-surface-variant leading-relaxed max-w-sm mx-auto">
            You scanned a Zenvego grower&apos;s product QR code. Sign in to your Customer account to see live farm stock, pricing, and complete express checkout in seconds.
          </p>
        </div>

        {deepLink?.productId && (
          <div className="bg-surface-container-low rounded-xl px-4 py-3 text-xs text-left space-y-1">
            <div className="flex justify-between">
              <span className="text-on-surface-variant">Product Reference</span>
              <span className="font-mono font-bold text-primary">{deepLink.productId}</span>
            </div>
            {deepLink.qty && deepLink.qty > 1 && (
              <div className="flex justify-between tabular-nums">
                <span className="text-on-surface-variant">Pre-selected Quantity</span>
                <span className="font-bold text-primary">{deepLink.qty} packs</span>
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={onSignInToCheckout}
          className="w-full h-12 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
        >
          <span className="material-symbols-outlined text-[19px]">login</span>
          <span>Sign In &amp; Continue to Product Checkout</span>
        </button>
      </div>
    );
  }

  // 2. Loading product from Firestore
  if (loadingProduct) {
    return (
      <div className="max-w-lg mx-auto bg-surface-container-lowest rounded-2xl p-10 text-center border border-outline-variant/25 space-y-2">
        <span className="material-symbols-outlined text-3xl text-primary animate-spin">progress_activity</span>
        <p className="text-xs font-bold text-primary">Loading live harvest &amp; stock for direct checkout...</p>
      </div>
    );
  }

  // 3. Product not found or invalid ID
  if (!resolvedListing) {
    return (
      <div className="max-w-lg mx-auto bg-surface-container-lowest rounded-2xl p-8 text-center border border-outline-variant/25 space-y-3">
        <span className="material-symbols-outlined text-4xl text-outline">inventory_2</span>
        <h2 className="text-lg font-extrabold text-primary">Harvest Listing Unavailable</h2>
        <p className="text-xs text-on-surface-variant">
          This QR code&apos;s harvest batch may have sold out or been removed by the grower. Explore fresh produce currently harvested near you.
        </p>
        <button
          type="button"
          onClick={() => onNavigate(isGrowerPreview ? 'grower-qr-studio' : 'buyer-explore')}
          className="px-5 py-2.5 rounded-xl bg-primary text-on-primary text-xs font-bold cursor-pointer"
        >
          {isGrowerPreview ? 'Back to QR Print Studio' : 'Browse Live Marketplace'}
        </button>
      </div>
    );
  }

  const itemSubtotal = resolvedListing.price * quantity;
  const estDeliveryFee = itemSubtotal >= 499 ? 0 : 15;
  const estTotal = itemSubtotal + estDeliveryFee;
  const outOfStock = !resolvedListing.available || resolvedListing.stock <= 0;
  const walletCanCover = validation ? walletBalance >= validation.totalPaid : false;

  const handleStartExpressCheckout = async () => {
    if (isGrowerPreview) {
      onNotify('Grower Preview Mode: Customers scanning this QR will proceed straight to live payment.');
      return;
    }
    if (isDeliveryRole) {
      onNotify('Sign out and log into a Customer account to place orders.');
      return;
    }
    if (outOfStock) {
      onNotify('This harvest is currently out of stock.');
      return;
    }

    setValidating(true);
    setValidationError(null);
    setGatewayNotice(null);
    idempotencyNonceRef.current += 1;
    const idempotencyKey = `direct_${resolvedListing.id}_${quantity}_${Date.now()}_${idempotencyNonceRef.current}`;

    try {
      const res = await zenvegoApi.validateCheckout({
        idempotencyKey,
        deliveryLat,
        deliveryLng,
        items: [
          {
            productId: resolvedListing.id,
            growerId: resolvedListing.growerId || 'unknown',
            farmName: resolvedListing.farmName,
            name: resolvedListing.name,
            unit: resolvedListing.unit,
            unitPrice: resolvedListing.price,
            quantity,
            availableStock: resolvedListing.stock,
          },
        ],
      });
      setValidation(res);
      setCheckoutStep('pay');
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : 'Could not validate live checkout.');
    } finally {
      setValidating(false);
    }
  };

  const handleConfirmDirectOrder = async () => {
    if (!validation || submitting) return;
    setSubmitting(true);
    setGatewayNotice(null);

    try {
      if (payMethod === 'upi_qr') {
        const cleanedUtr = upiUtr.replace(/\s+/g, '').trim();
        if (!cleanedUtr) {
          throw new Error('Scan the UPI QR and enter your 12-digit UPI UTR reference number to submit payment.');
        }
        const verified = await zenvegoApi.verifyUpiPayment({
          orderCode: validation.orderCode,
          amountInr: validation.totalPaid,
          utrNumber: cleanedUtr,
          payerUpiId: payerUpi.trim() || undefined,
        });
        await onPlaceValidatedOrder({
          validation,
          paymentMethod: `Direct Product QR · UPI (${cleanedUtr.slice(-6)})`,
          paymentStatus: verified.paymentStatus,
          paymentRef: verified.paymentId,
        });
      } else if (payMethod === 'wallet') {
        if (!walletCanCover) {
          throw new Error(
            `Insufficient Green Escrow Wallet balance (₹${walletBalance.toFixed(2)}). Choose UPI QR or Doorstep QR.`
          );
        }
        await onPayWithWallet(validation.totalPaid, validation.orderCode);
        await onPlaceValidatedOrder({
          validation,
          paymentMethod: 'Direct Product QR · Green Escrow Wallet',
          paymentStatus: 'verified',
          paymentRef: `wallet_${validation.orderCode}`,
        });
      } else if (payMethod === 'razorpay') {
        const rzpOrder = await zenvegoApi.createRazorpayOrder({
          amountInr: validation.totalPaid,
          totalPaidPaise: validation.totalPaidPaise,
          orderCode: validation.orderCode,
          quoteSignature: validation.quoteSignature,
          quoteExpiresAtMs: validation.quoteExpiresAtMs,
        });

        await new Promise<void>((resolve, reject) => {
          if ((window as unknown as { Razorpay?: unknown }).Razorpay) {
            resolve();
            return;
          }
          const script = document.createElement('script');
          script.src = 'https://checkout.razorpay.com/v1/checkout.js';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed to load Razorpay Checkout SDK.'));
          document.body.appendChild(script);
        });

        const RazorpayCtor = (
          window as unknown as { Razorpay: new (opts: Record<string, unknown>) => { open: () => void } }
        ).Razorpay;
        await new Promise<void>((resolve, reject) => {
          const rzp = new RazorpayCtor({
            key: rzpOrder.keyId,
            amount: rzpOrder.amount,
            currency: rzpOrder.currency,
            name: 'Zenvego',
            description: `Direct Checkout · ${resolvedListing.name} (${validation.orderCode})`,
            order_id: rzpOrder.razorpayOrderId,
            handler: async (response: {
              razorpay_order_id: string;
              razorpay_payment_id: string;
              razorpay_signature: string;
            }) => {
              try {
                const verified = await zenvegoApi.verifyRazorpayPayment(response);
                await onPlaceValidatedOrder({
                  validation,
                  paymentMethod: 'Direct Product QR · Razorpay',
                  paymentStatus: 'verified',
                  paymentRef: verified.paymentId,
                });
                resolve();
              } catch (e) {
                reject(e);
              }
            },
            modal: {
              ondismiss: () => reject(new Error('Payment cancelled by customer.')),
            },
          });
          rzp.open();
        });
      } else {
        await onPlaceValidatedOrder({
          validation,
          paymentMethod: 'Direct Product QR · Verified Doorstep QR / Pay on Delivery',
          paymentStatus: 'doorstep_qr',
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Direct checkout failed.';
      setGatewayNotice(msg);
      onNotify(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-5 pb-12">
      {/* Grower Preview Banner */}
      {isGrowerPreview && (
        <div className="bg-surface-container-lowest rounded-2xl px-4 py-3.5 border border-primary/30 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-on-surface">
            <strong className="text-primary">Grower Preview Mode</strong> · Customers who scan your printed QR code land directly on this unique checkout page.
          </div>
          {onReturnToQrStudio && (
            <button
              type="button"
              onClick={() => onReturnToQrStudio(resolvedListing.id)}
              className="px-3.5 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              Back to QR Print Studio
            </button>
          )}
        </div>
      )}

      {/* Contiguous 2-Column Direct Product Checkout Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Product Showcase & Provenance */}
        <section className="lg:col-span-6 bg-surface-container-lowest rounded-2xl overflow-hidden border border-outline-variant/25 shadow-sm">
          <div className="aspect-4/3 bg-surface-container relative">
            <SmartImage
              src={resolvedListing.image}
              alt={resolvedListing.name}
              className="w-full h-full object-cover"
            />
          </div>

          <div className="p-5 space-y-3">
            <div className="flex items-center gap-2 text-xs text-secondary font-semibold">
              <span>{resolvedListing.category}</span>
              <span aria-hidden="true">·</span>
              <span>{resolvedListing.harvestedAt}</span>
              {resolvedListing.chemicalFree && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Chemical-Free</span>
                </>
              )}
            </div>

            <div>
              <h2 className="text-2xl font-extrabold text-primary leading-tight text-balance">
                {resolvedListing.name}
              </h2>
              <p className="text-xs text-on-surface-variant mt-1">
                Grown by <strong className="text-on-surface">{resolvedListing.farmName}</strong> · {resolvedListing.variety} · {resolvedListing.bedLabel}
              </p>
            </div>

            {resolvedListing.growerNote && (
              <p className="text-xs text-on-surface-variant leading-relaxed pt-2 border-t border-outline-variant/15">
                {resolvedListing.growerNote}
              </p>
            )}

            <div className="pt-2 border-t border-outline-variant/15 flex items-center justify-between text-xs text-on-surface-variant tabular-nums">
              <span>Distance: {resolvedListing.distanceKm} km from delivery pin</span>
              <span className={outOfStock ? 'text-red-700 font-bold' : 'text-secondary font-bold'}>
                {outOfStock
                  ? 'Currently Sold Out'
                  : `${resolvedListing.stock} ${resolvedListing.unitShort} available live`}
              </span>
            </div>
          </div>
        </section>

        {/* Right: Contiguous Purchase & Express Checkout Module */}
        <section className="lg:col-span-6 bg-surface-container-lowest rounded-2xl p-5 sm:p-6 border border-outline-variant/25 shadow-sm space-y-4">
          <div className="flex items-start justify-between gap-3 border-b border-outline-variant/20 pb-4 tabular-nums">
            <div>
              <p className="text-xs font-bold text-secondary">
                Direct Farm Checkout{sourceLabel ? ` · ${sourceLabel}` : ''}
              </p>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-3xl font-extrabold text-primary">₹{resolvedListing.price}</span>
                <span className="text-xs font-semibold text-on-surface-variant">/ {resolvedListing.unit}</span>
              </div>
            </div>

            {checkoutStep === 'pay' && (
              <button
                type="button"
                onClick={() => {
                  setCheckoutStep('configure');
                  setValidation(null);
                  setGatewayNotice(null);
                }}
                className="text-xs font-bold text-primary hover:underline cursor-pointer"
              >
                Edit Qty
              </button>
            )}
          </div>

          {/* Delivery Destination Strip */}
          <div className="bg-surface-container-low rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="text-[11px] font-bold text-secondary block">Delivering To</span>
              <p className="text-xs font-bold text-on-surface truncate">{deliveryAddress}</p>
            </div>
            {!isGrowerPreview && !isDeliveryRole && (
              <button
                type="button"
                onClick={() => onNavigate('buyer-location')}
                className="text-xs font-bold text-primary hover:underline shrink-0 cursor-pointer"
              >
                Change
              </button>
            )}
          </div>

          {checkoutStep === 'configure' ? (
            <>
              {/* Quantity Selector */}
              <div className="flex items-center justify-between gap-3 py-1 tabular-nums">
                <div>
                  <p className="text-xs font-extrabold text-on-surface">Quantity ({resolvedListing.unit})</p>
                  <p className="text-[11px] text-on-surface-variant">
                    Live farm stock reserved upon confirmation
                  </p>
                </div>
                <div className="flex items-center gap-2.5 bg-surface-container-low rounded-xl px-2.5 py-1.5 border border-outline-variant/25">
                  <button
                    type="button"
                    disabled={quantity <= 1 || outOfStock}
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    className="w-8 h-8 rounded-lg bg-white text-primary font-extrabold text-sm cursor-pointer disabled:opacity-40"
                  >
                    −
                  </button>
                  <span className="text-sm font-extrabold text-primary min-w-[24px] text-center">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    disabled={outOfStock || quantity >= resolvedListing.stock}
                    onClick={() => setQuantity((q) => Math.min(resolvedListing.stock, q + 1))}
                    className="w-8 h-8 rounded-lg bg-white text-primary font-extrabold text-sm cursor-pointer disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Price Summary */}
              <div className="bg-surface-container-low rounded-xl p-3.5 space-y-2 text-xs tabular-nums">
                <div className="flex justify-between text-on-surface-variant">
                  <span>
                    {quantity} × {resolvedListing.name} ({resolvedListing.unit})
                  </span>
                  <span className="font-bold text-on-surface">₹{itemSubtotal}</span>
                </div>
                <div className="flex justify-between text-on-surface-variant">
                  <span>Hyperlocal EV Delivery {itemSubtotal >= 499 ? '(Free above ₹499)' : ''}</span>
                  <span className="font-bold text-on-surface">₹{estDeliveryFee}</span>
                </div>
                <div className="border-t border-outline-variant/25 pt-2 flex justify-between text-sm font-extrabold text-primary">
                  <span>Total Payable</span>
                  <span>₹{estTotal}</span>
                </div>
              </div>

              {validationError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-900 font-medium">
                  {validationError}
                </div>
              )}

              <div className="space-y-2.5 pt-1">
                <button
                  type="button"
                  disabled={outOfStock || validating}
                  onClick={handleStartExpressCheckout}
                  className="w-full h-12 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-sm font-bold flex items-center justify-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[19px]">bolt</span>
                  <span>
                    {validating
                      ? 'Validating Live Stock...'
                      : outOfStock
                        ? 'Out of Stock'
                        : `Express Checkout · ₹${estTotal}`}
                  </span>
                </button>

                {!isGrowerPreview && !isDeliveryRole && !outOfStock && (
                  <button
                    type="button"
                    onClick={() => {
                      onAddToBasket(resolvedListing.id, quantity);
                      onNotify(`Added ${quantity} × ${resolvedListing.name} to your Harvest Basket`);
                      onNavigate('buyer-cart');
                    }}
                    className="w-full h-11 rounded-xl bg-surface-container-low hover:bg-surface-container text-primary text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[18px]">shopping_basket</span>
                    <span>Add to Basket &amp; Combine with Other Farms</span>
                  </button>
                )}
              </div>
            </>
          ) : (
            validation && (
              <div className="space-y-3.5">
                <div className="flex items-center justify-between text-xs bg-surface-container-low rounded-xl px-3.5 py-2.5 tabular-nums">
                  <div>
                    <span className="font-extrabold text-primary block">{validation.orderCode}</span>
                    <span className="text-on-surface-variant">{validation.serviceabilityNote}</span>
                  </div>
                  <span className="text-base font-extrabold text-primary">₹{validation.totalPaid}</span>
                </div>

                {/* Payment Methods */}
                <div className="space-y-2">
                  {/* UPI QR */}
                  <div
                    className={`rounded-xl border transition-colors ${
                      payMethod === 'upi_qr' ? 'border-primary bg-surface-container-low' : 'border-outline-variant/30 bg-white'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setPayMethod('upi_qr')}
                      className="w-full text-left p-3 flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="material-symbols-outlined text-primary text-[20px]">qr_code_2</span>
                        <div>
                          <span className="text-xs font-extrabold text-on-surface block">Direct UPI QR (Zero-Fee)</span>
                          <span className="text-[11px] text-on-surface-variant">GPay · PhonePe · Paytm · BHIM</span>
                        </div>
                      </div>
                      <span className="material-symbols-outlined text-primary text-[18px]">
                        {payMethod === 'upi_qr' ? 'radio_button_checked' : 'radio_button_unchecked'}
                      </span>
                    </button>

                    {payMethod === 'upi_qr' && (
                      <div className="px-3 pb-3 pt-1 border-t border-outline-variant/20 space-y-2.5">
                        <div className="flex items-center gap-3 bg-white rounded-xl p-2.5 border border-outline-variant/25">
                          {localUpiQrDataUrl && (
                            <img
                              src={localUpiQrDataUrl}
                              alt={`UPI QR ₹${validation.totalPaid}`}
                              className="w-24 h-24 rounded-lg shrink-0"
                            />
                          )}
                          <div className="space-y-1.5 flex-1 min-w-0">
                            <p className="text-xs font-extrabold text-primary tabular-nums">
                              Pay ₹{validation.totalPaid}
                            </p>
                            <p className="text-[10px] font-mono text-on-surface-variant truncate">
                              zenvego.escrow@upi
                            </p>
                            <a
                              href={upiUri}
                              className="inline-flex items-center gap-1 text-[11px] font-bold text-secondary hover:underline"
                            >
                              Open UPI App →
                            </a>
                          </div>
                        </div>
                        <input
                          type="text"
                          value={upiUtr}
                          onChange={(e) => setUpiUtr(e.target.value)}
                          placeholder="Enter 12-digit UPI UTR / Ref ID"
                          className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-white text-xs font-mono focus:outline-none focus:border-primary"
                        />
                        <input
                          type="text"
                          value={payerUpi}
                          onChange={(e) => setPayerUpi(e.target.value)}
                          placeholder="Your UPI ID (optional)"
                          className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-white text-xs focus:outline-none focus:border-primary"
                        />
                      </div>
                    )}
                  </div>

                  {/* Doorstep QR / Pay on Delivery */}
                  <button
                    type="button"
                    onClick={() => setPayMethod('doorstep_qr')}
                    className={`w-full text-left p-3 rounded-xl border flex items-center justify-between gap-2 cursor-pointer ${
                      payMethod === 'doorstep_qr'
                        ? 'border-primary bg-surface-container-low'
                        : 'border-outline-variant/30 bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="material-symbols-outlined text-primary text-[20px]">payments</span>
                      <div>
                        <span className="text-xs font-extrabold text-on-surface block">
                          Verified Doorstep QR / Pay on Delivery
                        </span>
                        <span className="text-[11px] text-on-surface-variant">
                          Reserve live harvest stock now, pay upon doorstep handover
                        </span>
                      </div>
                    </div>
                    <span className="material-symbols-outlined text-primary text-[18px]">
                      {payMethod === 'doorstep_qr' ? 'radio_button_checked' : 'radio_button_unchecked'}
                    </span>
                  </button>

                  {/* Green Escrow Wallet */}
                  <button
                    type="button"
                    onClick={() => setPayMethod('wallet')}
                    className={`w-full text-left p-3 rounded-xl border flex items-center justify-between gap-2 cursor-pointer ${
                      payMethod === 'wallet'
                        ? 'border-primary bg-surface-container-low'
                        : 'border-outline-variant/30 bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="material-symbols-outlined text-primary text-[20px]">account_balance_wallet</span>
                      <div>
                        <span className="text-xs font-extrabold text-on-surface block">
                          Green Escrow Wallet (Bal ₹{walletBalance.toFixed(0)})
                        </span>
                        <span className="text-[11px] text-on-surface-variant">
                          {walletCanCover ? '1-tap instant checkout' : 'Insufficient balance'}
                        </span>
                      </div>
                    </div>
                    <span className="material-symbols-outlined text-primary text-[18px]">
                      {payMethod === 'wallet' ? 'radio_button_checked' : 'radio_button_unchecked'}
                    </span>
                  </button>

                  {/* Razorpay */}
                  <button
                    type="button"
                    onClick={() => setPayMethod('razorpay')}
                    className={`w-full text-left p-3 rounded-xl border flex items-center justify-between gap-2 cursor-pointer ${
                      payMethod === 'razorpay'
                        ? 'border-primary bg-surface-container-low'
                        : 'border-outline-variant/30 bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="material-symbols-outlined text-primary text-[20px]">credit_card</span>
                      <div>
                        <span className="text-xs font-extrabold text-on-surface block">Cards / NetBanking (Razorpay)</span>
                        <span className="text-[11px] text-on-surface-variant">HMAC-verified online payment</span>
                      </div>
                    </div>
                    <span className="material-symbols-outlined text-primary text-[18px]">
                      {payMethod === 'razorpay' ? 'radio_button_checked' : 'radio_button_unchecked'}
                    </span>
                  </button>
                </div>

                {gatewayNotice && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 font-medium">
                    {gatewayNotice}
                  </div>
                )}

                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleConfirmDirectOrder}
                  className="w-full h-12 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-sm font-bold flex items-center justify-center gap-2 shadow-sm cursor-pointer disabled:opacity-60"
                >
                  <span className="material-symbols-outlined text-[19px]">lock</span>
                  <span>
                    {submitting
                      ? 'Confirming Order...'
                      : payMethod === 'doorstep_qr'
                        ? `Confirm Direct Order · ₹${validation.totalPaid}`
                        : `Pay & Place Order · ₹${validation.totalPaid}`}
                  </span>
                </button>
              </div>
            )
          )}
        </section>
      </div>
    </div>
  );
};
