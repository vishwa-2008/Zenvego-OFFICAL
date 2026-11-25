import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { GrowerListing, GrowerProfileDoc, ProductCheckoutDeepLink, ScreenId } from '../types';
import {
  buildProductCheckoutUrl,
  downloadQrImage,
  downloadSvgMarkup,
  PrintTemplateKind,
  QrErrorCorrectionLevel,
  renderDynamicQrPngDataUrl,
  renderDynamicQrSvg,
  renderPrintableProductCardPng,
  sanitizeFilename,
} from '../utils/qrGenerator';
import { SmartImage } from './ZenvegoLogo';

interface ProductQrStudioProps {
  listings: GrowerListing[];
  growerProfile: GrowerProfileDoc | null;
  initialProductId?: string | null;
  onPreviewCheckout: (deepLink: ProductCheckoutDeepLink) => void;
  onNavigate: (screen: ScreenId) => void;
  onNotify: (msg: string) => void;
}

const INK_THEMES: { id: string; label: string; hex: string }[] = [
  { id: 'forest', label: 'Zenvego Forest', hex: '#003820' },
  { id: 'black', label: 'Classic Black', hex: '#111827' },
  { id: 'moss', label: 'Botanical Moss', hex: '#0f5132' },
  { id: 'earth', label: 'Harvest Earth', hex: '#552100' },
];

const PLACEMENT_PRESETS: { id: string; label: string; src: string; defaultCta: string }[] = [
  {
    id: 'crate',
    label: 'Crate & Shelf Tag',
    src: 'crate_tag',
    defaultCta: 'Scan to order this harvest directly',
  },
  {
    id: 'market',
    label: 'Farmers Market Stall',
    src: 'farmers_market',
    defaultCta: 'Missed the stall? Scan for same-day doorstep delivery',
  },
  {
    id: 'counter',
    label: 'Shop Counter Stand',
    src: 'counter_stand',
    defaultCta: 'Scan to pay & checkout in 15 seconds',
  },
  {
    id: 'flyer',
    label: 'Apartment Noticeboard',
    src: 'apartment_flyer',
    defaultCta: 'Fresh neighborhood terrace harvest — scan to buy',
  },
];

const QUANTITY_PRESETS = [1, 2, 3, 5];

export const ProductQrStudio: React.FC<ProductQrStudioProps> = ({
  listings,
  growerProfile,
  initialProductId,
  onPreviewCheckout,
  onNavigate,
  onNotify,
}) => {
  const [studioMode, setStudioMode] = useState<'single' | 'batch'>('single');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>('');
  const [batchIds, setBatchIds] = useState<string[]>([]);

  // Dynamic QR checkout parameters
  const [defaultQty, setDefaultQty] = useState<number>(1);
  const [placementId, setPlacementId] = useState<string>('crate');
  const [customSource, setCustomSource] = useState<string>('');
  const [ctaLine, setCtaLine] = useState<string>(PLACEMENT_PRESETS[0].defaultCta);

  // Print template & visual styling
  const [template, setTemplate] = useState<PrintTemplateKind>('standee');
  const [inkHex, setInkHex] = useState<string>(INK_THEMES[0].hex);
  const [ecc, setEcc] = useState<QrErrorCorrectionLevel>('H');
  const [showPrice, setShowPrice] = useState(true);
  const [showPhoto, setShowPhoto] = useState(true);
  const [showFreshness, setShowFreshness] = useState(true);
  const [showUrlCaption, setShowUrlCaption] = useState(true);

  // Generated QR Data URLs mapped by productId
  const [qrPngMap, setQrPngMap] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState<'card-png' | 'qr-png' | 'qr-svg' | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Sync initial selection whenever listings or initialProductId changes
  useEffect(() => {
    if (listings.length === 0) {
      setSelectedId('');
      setBatchIds([]);
      return;
    }
    if (initialProductId && listings.some((l) => l.id === initialProductId)) {
      setSelectedId(initialProductId);
      setStudioMode('single');
    } else if (!selectedId || !listings.some((l) => l.id === selectedId)) {
      setSelectedId(listings[0].id);
    }

    setBatchIds((prev) => {
      const valid = prev.filter((id) => listings.some((l) => l.id === id));
      if (valid.length > 0) return valid;
      return listings.filter((l) => l.available).slice(0, 6).map((l) => l.id);
    });
  }, [listings, initialProductId, selectedId]);

  const activePlacement = useMemo(
    () => PLACEMENT_PRESETS.find((p) => p.id === placementId) ?? PLACEMENT_PRESETS[0],
    [placementId]
  );

  const effectiveSource = useMemo(() => {
    const cleaned = customSource.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
    return cleaned || activePlacement.src;
  }, [customSource, activePlacement.src]);

  const filteredListings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return listings;
    return listings.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.bedLabel.toLowerCase().includes(q)
    );
  }, [listings, searchQuery]);

  const selectedProduct = useMemo(
    () => listings.find((l) => l.id === selectedId) ?? listings[0] ?? null,
    [listings, selectedId]
  );

  const activeItems = useMemo(() => {
    if (studioMode === 'single') {
      return selectedProduct ? [selectedProduct] : [];
    }
    return listings.filter((l) => batchIds.includes(l.id));
  }, [studioMode, selectedProduct, listings, batchIds]);

  const checkoutUrlMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const item of activeItems) {
      map[item.id] = buildProductCheckoutUrl({
        productId: item.id,
        growerId: item.growerId || growerProfile?.ownerId,
        qty: defaultQty,
        src: effectiveSource,
      });
    }
    return map;
  }, [activeItems, growerProfile?.ownerId, defaultQty, effectiveSource]);

  // Dynamically regenerate local QR PNG data URLs whenever URL params or QR styling change
  useEffect(() => {
    let cancelled = false;
    if (activeItems.length === 0) {
      setQrPngMap({});
      return;
    }

    setGenerating(true);
    Promise.all(
      activeItems.map(async (item) => {
        const url = checkoutUrlMap[item.id];
        const dataUrl = await renderDynamicQrPngDataUrl(url, {
          size: 560,
          margin: 2,
          color: inkHex,
          bgColor: '#ffffff',
          ecc,
        });
        return [item.id, dataUrl] as const;
      })
    )
      .then((entries) => {
        if (!cancelled) {
          setQrPngMap(Object.fromEntries(entries));
        }
      })
      .catch(() => {
        if (!cancelled) {
          onNotify('Could not refresh QR code preview.');
        }
      })
      .finally(() => {
        if (!cancelled) setGenerating(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeItems, checkoutUrlMap, inkHex, ecc, onNotify]);

  // Cleanly toggle body class during native print so ONLY `.zenvego-print-portal` prints
  const handlePrint = () => {
    if (activeItems.length === 0) {
      onNotify('Select at least one product listing to print.');
      return;
    }
    document.body.classList.add('zenvego-printing');
    const cleanup = () => {
      document.body.classList.remove('zenvego-printing');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(() => {
      window.print();
      // Fallback cleanup for browsers where afterprint fires inconsistently
      setTimeout(cleanup, 1200);
    }, 60);
  };

  const handleCopyLink = async () => {
    if (!selectedProduct) return;
    const url = checkoutUrlMap[selectedProduct.id];
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(true);
      onNotify(`Copied unique checkout link for ${selectedProduct.name}`);
      setTimeout(() => setCopiedUrl(false), 1800);
    } catch {
      onNotify('Copy failed — select and copy the URL shown below the QR.');
    }
  };

  const handleDownloadPrintCardPng = async () => {
    if (!selectedProduct) return;
    const url = checkoutUrlMap[selectedProduct.id];
    if (!url) return;
    setExporting('card-png');
    try {
      const cardDataUrl = await renderPrintableProductCardPng({
        productName: selectedProduct.name,
        variety: selectedProduct.variety,
        farmName: growerProfile?.farmName || selectedProduct.farmName,
        price: selectedProduct.price,
        unit: selectedProduct.unit,
        harvestedAt: selectedProduct.harvestedAt,
        chemicalFree: selectedProduct.chemicalFree,
        targetUrl: url,
        ctaLine,
        placementLabel: activePlacement.label,
        qrColor: inkHex,
        ecc,
        showPrice,
        showFreshness,
        showUrlCaption,
      });
      await downloadQrImage(cardDataUrl, `zenvego-print-card-${sanitizeFilename(selectedProduct.name)}.png`);
      onNotify(`Downloaded high-res printable card for ${selectedProduct.name}`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not export printable card PNG.');
    } finally {
      setExporting(null);
    }
  };

  const handleDownloadRawQrPng = async () => {
    if (!selectedProduct) return;
    const url = checkoutUrlMap[selectedProduct.id];
    if (!url) return;
    setExporting('qr-png');
    try {
      const highRes = await renderDynamicQrPngDataUrl(url, {
        size: 1024,
        margin: 2,
        color: inkHex,
        bgColor: '#ffffff',
        ecc,
      });
      await downloadQrImage(highRes, `zenvego-qr-${sanitizeFilename(selectedProduct.name)}.png`);
      onNotify('Downloaded 1024px high-res QR PNG');
    } catch {
      onNotify('Could not export QR PNG.');
    } finally {
      setExporting(null);
    }
  };

  const handleDownloadRawQrSvg = async () => {
    if (!selectedProduct) return;
    const url = checkoutUrlMap[selectedProduct.id];
    if (!url) return;
    setExporting('qr-svg');
    try {
      const svg = await renderDynamicQrSvg(url, {
        margin: 2,
        color: inkHex,
        bgColor: '#ffffff',
        ecc,
      });
      downloadSvgMarkup(svg, `zenvego-qr-${sanitizeFilename(selectedProduct.name)}.svg`);
      onNotify('Downloaded lossless vector QR SVG');
    } catch {
      onNotify('Could not export vector SVG.');
    } finally {
      setExporting(null);
    }
  };

  const toggleBatchItem = (id: string) => {
    setBatchIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const farmDisplayName = growerProfile?.farmName || selectedProduct?.farmName || 'Zenvego Local Farm';

  // Reusable printable card layout rendered in BOTH live preview & `.zenvego-print-portal`
  const renderPrintableCard = (item: GrowerListing, compactBatch: boolean) => {
    const qrSrc = qrPngMap[item.id];
    const targetUrl = checkoutUrlMap[item.id] || '';
    const shortUrl = targetUrl.replace(/^https?:\/\//i, '');
    const cardTemplate = compactBatch ? 'crate-tag' : template;

    if (cardTemplate === 'crate-tag') {
      return (
        <article
          key={item.id}
          className="print-break-avoid bg-white rounded-xl border-2 border-dashed border-outline-variant/80 p-4 flex flex-col justify-between gap-3 text-left"
        >
          <div className="flex items-start justify-between gap-3 border-b border-outline-variant/25 pb-2.5">
            <div className="min-w-0">
              <p className="text-[10px] font-extrabold tracking-wider uppercase" style={{ color: inkHex }}>
                Zenvego Direct Checkout
              </p>
              <h3 className="text-base font-extrabold text-on-surface leading-tight mt-0.5 truncate">
                {item.name}
              </h3>
              <p className="text-[11px] text-on-surface-variant truncate mt-0.5">
                {growerProfile?.farmName || item.farmName} · {item.variety}
              </p>
            </div>
            {showPrice && (
              <div className="text-right shrink-0 tabular-nums">
                <span className="text-lg font-extrabold block leading-none" style={{ color: inkHex }}>
                  ₹{item.price}
                </span>
                <span className="text-[10px] font-semibold text-on-surface-variant">per {item.unit}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3.5">
            <div className="bg-white p-1.5 rounded-lg border border-outline-variant/40 shrink-0">
              {qrSrc ? (
                <img
                  src={qrSrc}
                  alt={`Checkout QR for ${item.name}`}
                  className="w-28 h-28 object-contain"
                />
              ) : (
                <div className="w-28 h-28 bg-surface-container-low rounded flex items-center justify-center text-[10px] text-on-surface-variant">
                  Generating...
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-xs font-extrabold text-on-surface leading-snug">{ctaLine}</p>
              {showFreshness && (
                <p className="text-[11px] font-semibold text-secondary">
                  {item.harvestedAt}
                  {item.chemicalFree ? ' · Chemical-Free' : ''}
                </p>
              )}
              {defaultQty > 1 && (
                <p className="text-[11px] font-bold text-on-surface tabular-nums">
                  Pre-set checkout pack: {defaultQty} × {item.unit} (₹{item.price * defaultQty})
                </p>
              )}
              <p className="text-[10px] text-on-surface-variant">
                Point phone camera to open instant checkout
              </p>
            </div>
          </div>

          {showUrlCaption && (
            <div className="pt-2 border-t border-outline-variant/20 flex items-center justify-between gap-2 text-[9px] font-mono text-on-surface-variant">
              <span className="truncate">{shortUrl}</span>
              <span className="shrink-0 uppercase font-sans font-bold">{activePlacement.label}</span>
            </div>
          )}
        </article>
      );
    }

    if (cardTemplate === 'a4-poster') {
      return (
        <article
          key={item.id}
          className="print-break-avoid bg-white rounded-2xl border-2 border-outline-variant/40 overflow-hidden shadow-xs"
        >
          <div
            className="px-6 py-4 flex items-center justify-between text-white"
            style={{ backgroundColor: inkHex }}
          >
            <div>
              <p className="text-xs font-extrabold tracking-widest uppercase">Zenvego</p>
              <p className="text-[11px] text-white/80">{farmDisplayName}</p>
            </div>
            <span className="text-[11px] font-bold tracking-wider uppercase text-white/90">
              {activePlacement.label}
            </span>
          </div>

          <div className="p-6 sm:p-8 flex flex-col items-center text-center gap-5">
            {showPhoto && item.image && (
              <div className="w-full max-w-md h-44 rounded-xl overflow-hidden border border-outline-variant/25">
                <SmartImage src={item.image} alt={item.name} className="w-full h-full object-cover" />
              </div>
            )}

            <div className="space-y-1.5 max-w-md">
              <h2 className="text-2xl sm:text-3xl font-extrabold text-on-surface tracking-tight text-balance">
                {item.name}
              </h2>
              <p className="text-xs sm:text-sm text-on-surface-variant">
                {item.variety} · {item.bedLabel}
                {growerProfile?.areaName ? ` · ${growerProfile.areaName}` : ''}
              </p>
              {showFreshness && (
                <p className="text-xs font-bold text-secondary">
                  {item.harvestedAt}
                  {item.chemicalFree ? ' · 100% Chemical-Free Grown' : ''}
                </p>
              )}
            </div>

            {showPrice && (
              <div className="tabular-nums flex items-baseline justify-center gap-2">
                <span className="text-3xl font-extrabold" style={{ color: inkHex }}>
                  ₹{item.price}
                </span>
                <span className="text-sm font-semibold text-on-surface-variant">/ {item.unit}</span>
                {defaultQty > 1 && (
                  <span className="text-xs font-bold text-secondary ml-2">
                    · Pre-filled {defaultQty} packs (₹{item.price * defaultQty})
                  </span>
                )}
              </div>
            )}

            <div
              className="p-4 rounded-2xl bg-white border-2"
              style={{ borderColor: inkHex }}
            >
              {qrSrc ? (
                <img
                  src={qrSrc}
                  alt={`Direct Checkout QR for ${item.name}`}
                  className="w-56 h-56 sm:w-64 sm:h-64 object-contain"
                />
              ) : (
                <div className="w-56 h-56 flex items-center justify-center text-xs text-on-surface-variant">
                  Generating QR...
                </div>
              )}
            </div>

            <div className="space-y-1 max-w-md">
              <p className="text-base font-extrabold text-on-surface">{ctaLine}</p>
              <p className="text-xs text-on-surface-variant">
                Open your phone camera, scan the code, and complete checkout directly with live farm stock.
              </p>
            </div>

            {showUrlCaption && (
              <div className="w-full pt-3 border-t border-outline-variant/25 text-[10px] font-mono text-on-surface-variant break-all">
                {shortUrl}
              </div>
            )}
          </div>
        </article>
      );
    }

    // Default: 'standee' (Countertop Portrait Standee)
    return (
      <article
        key={item.id}
        className="print-break-avoid max-w-md mx-auto w-full bg-white rounded-2xl border-2 border-outline-variant/40 overflow-hidden shadow-xs"
      >
        <div
          className="px-5 py-3.5 flex items-center justify-between text-white"
          style={{ backgroundColor: inkHex }}
        >
          <span className="text-xs font-extrabold tracking-widest uppercase">Zenvego · Direct Checkout</span>
          <span className="text-[11px] font-semibold text-white/85">{activePlacement.label}</span>
        </div>

        <div className="p-5 flex flex-col items-center text-center gap-4">
          {showPhoto && item.image && (
            <div className="w-full h-36 rounded-xl overflow-hidden border border-outline-variant/20">
              <SmartImage src={item.image} alt={item.name} className="w-full h-full object-cover" />
            </div>
          )}

          <div className="space-y-1">
            <h3 className="text-xl font-extrabold text-on-surface leading-tight text-balance">{item.name}</h3>
            <p className="text-xs text-on-surface-variant">
              {farmDisplayName} · {item.variety}
            </p>
            {showFreshness && (
              <p className="text-[11px] font-bold text-secondary">
                {item.harvestedAt}
                {item.chemicalFree ? ' · Chemical-Free' : ''}
              </p>
            )}
          </div>

          {showPrice && (
            <div className="tabular-nums flex items-baseline gap-1.5">
              <span className="text-2xl font-extrabold" style={{ color: inkHex }}>
                ₹{item.price}
              </span>
              <span className="text-xs font-semibold text-on-surface-variant">/ {item.unit}</span>
              {defaultQty > 1 && (
                <span className="text-xs font-bold text-secondary ml-1.5">
                  · Quick {defaultQty}-pack (₹{item.price * defaultQty})
                </span>
              )}
            </div>
          )}

          <div className="p-3.5 rounded-2xl bg-white border-2" style={{ borderColor: inkHex }}>
            {qrSrc ? (
              <img
                src={qrSrc}
                alt={`Direct Checkout QR for ${item.name}`}
                className="w-48 h-48 object-contain"
              />
            ) : (
              <div className="w-48 h-48 flex items-center justify-center text-xs text-on-surface-variant">
                Generating QR...
              </div>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-sm font-extrabold text-on-surface">{ctaLine}</p>
            <p className="text-[11px] text-on-surface-variant">
              Scan with any phone camera to open this product&apos;s unique checkout page.
            </p>
          </div>

          {showUrlCaption && (
            <div className="w-full pt-2.5 border-t border-outline-variant/20 text-[10px] font-mono text-on-surface-variant break-all">
              {shortUrl}
            </div>
          )}
        </div>
      </article>
    );
  };

  if (listings.length === 0) {
    return (
      <div className="max-w-xl mx-auto bg-surface-container-lowest rounded-2xl p-8 text-center border border-outline-variant/25 space-y-3">
        <span className="material-symbols-outlined text-4xl text-primary/60">qr_code_2</span>
        <h2 className="text-lg font-extrabold text-primary">Publish a Harvest to Generate Checkout QRs</h2>
        <p className="text-xs text-on-surface-variant leading-relaxed">
          Every produce listing gets its own dynamic, printable QR code linking directly to a dedicated checkout page for farm stalls, crate tags, and local flyers.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('grower-add-harvest')}
          className="px-5 py-2.5 rounded-xl bg-primary text-on-primary text-xs font-bold cursor-pointer"
        >
          Publish First Harvest
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full gap-5 pb-12">
      {/* Studio Top Summary & Mode Switcher */}
      <div className="bg-surface-container-lowest rounded-2xl p-5 border border-outline-variant/25 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-extrabold text-primary tracking-tight">
            Offline-to-Online Product Checkout QR Studio
          </h2>
          <p className="text-xs text-on-surface-variant">
            Generate dynamic, print-ready QR cards that take offline shoppers directly to each listing&apos;s unique checkout page.
          </p>
        </div>

        {/* Segmented Mode Control */}
        <div className="inline-flex items-center p-1 rounded-xl bg-surface-container-low border border-outline-variant/25 shrink-0 self-start sm:self-center">
          <button
            type="button"
            onClick={() => setStudioMode('single')}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
              studioMode === 'single'
                ? 'bg-primary text-on-primary shadow-xs'
                : 'text-on-surface-variant hover:text-primary'
            }`}
          >
            Single Listing
          </button>
          <button
            type="button"
            onClick={() => setStudioMode('batch')}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
              studioMode === 'batch'
                ? 'bg-primary text-on-primary shadow-xs'
                : 'text-on-surface-variant hover:text-primary'
            }`}
          >
            Batch A4 Sheet ({batchIds.length})
          </button>
        </div>
      </div>

      {/* Main 2-Column Studio Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Controls Column */}
        <section className="lg:col-span-5 bg-surface-container-lowest rounded-2xl p-5 border border-outline-variant/25 space-y-5">
          {/* 1. Product Listing Selector */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-extrabold text-primary">
                {studioMode === 'single' ? '1. Select Product Listing' : '1. Select Listings for A4 Sheet'}
              </label>
              {studioMode === 'batch' && (
                <div className="flex items-center gap-2 text-[11px] font-bold">
                  <button
                    type="button"
                    onClick={() => setBatchIds(listings.map((l) => l.id))}
                    className="text-secondary hover:underline cursor-pointer"
                  >
                    Select All
                  </button>
                  <span className="text-outline-variant">·</span>
                  <button
                    type="button"
                    onClick={() => setBatchIds([])}
                    className="text-on-surface-variant hover:text-primary cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>

            {listings.length > 4 && (
              <div className="flex items-center bg-surface-container-low rounded-xl px-3 h-9 border border-outline-variant/25">
                <span className="material-symbols-outlined text-on-surface-variant text-[17px] mr-1.5">search</span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter listings..."
                  className="w-full bg-transparent text-xs outline-none"
                />
              </div>
            )}

            <div className="max-h-56 overflow-y-auto space-y-1.5 pr-0.5">
              {filteredListings.map((item) => {
                const isSelected =
                  studioMode === 'single' ? selectedProduct?.id === item.id : batchIds.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (studioMode === 'single') {
                        setSelectedId(item.id);
                      } else {
                        toggleBatchItem(item.id);
                      }
                    }}
                    className={`w-full text-left p-2.5 rounded-xl border transition-colors flex items-center gap-3 cursor-pointer ${
                      isSelected
                        ? 'border-primary bg-surface-container-low'
                        : 'border-outline-variant/25 hover:bg-surface-container-low/50'
                    }`}
                  >
                    {studioMode === 'batch' && (
                      <span className="material-symbols-outlined text-[19px] text-primary shrink-0">
                        {isSelected ? 'check_box' : 'check_box_outline_blank'}
                      </span>
                    )}
                    <SmartImage src={item.image} alt={item.name} className="w-10 h-10 rounded-lg object-cover shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-extrabold text-on-surface truncate">{item.name}</p>
                      <p className="text-[11px] text-on-surface-variant truncate tabular-nums">
                        ₹{item.price}/{item.unit} · {item.stock} {item.unitShort} in stock
                      </p>
                    </div>
                    {studioMode === 'single' && isSelected && (
                      <span className="material-symbols-outlined text-primary text-[18px] shrink-0">
                        radio_button_checked
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <hr className="border-outline-variant/20" />

          {/* 2. Dynamic Checkout Link Parameters */}
          <div className="space-y-3">
            <h3 className="text-xs font-extrabold text-primary">2. Dynamic Checkout Parameters</h3>

            <div className="space-y-1.5">
              <span className="block text-[11px] font-semibold text-on-surface-variant">
                Pre-filled Checkout Quantity
              </span>
              <div className="grid grid-cols-4 gap-1.5 tabular-nums">
                {QUANTITY_PRESETS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setDefaultQty(q)}
                    className={`h-9 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                      defaultQty === q
                        ? 'bg-primary text-on-primary border-primary'
                        : 'bg-surface-container-low text-on-surface border-outline-variant/25 hover:border-primary/40'
                    }`}
                  >
                    {q} {q === 1 ? 'Unit' : 'Units'}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="block text-[11px] font-semibold text-on-surface-variant">
                Offline Placement &amp; Attribution Tag
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {PLACEMENT_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setPlacementId(preset.id);
                      setCtaLine(preset.defaultCta);
                    }}
                    className={`px-2.5 py-2 rounded-lg text-[11px] font-bold border text-left transition-colors cursor-pointer truncate ${
                      placementId === preset.id
                        ? 'bg-secondary-container text-on-secondary-container border-secondary/30'
                        : 'bg-surface-container-low text-on-surface-variant border-outline-variant/25'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={customSource}
                onChange={(e) => setCustomSource(e.target.value)}
                maxLength={36}
                placeholder="Optional custom campaign tag (e.g. sunday_market_nov)"
                className="w-full px-3 py-2 rounded-lg border border-outline-variant/40 bg-white text-xs focus:outline-none focus:border-primary"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-semibold text-on-surface-variant">
                Print Headline / Scan Instruction
              </label>
              <input
                type="text"
                value={ctaLine}
                onChange={(e) => setCtaLine(e.target.value)}
                maxLength={76}
                className="w-full px-3 py-2 rounded-lg border border-outline-variant/40 bg-white text-xs font-medium focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          <hr className="border-outline-variant/20" />

          {/* 3. Print Format & QR Styling */}
          <div className="space-y-3">
            <h3 className="text-xs font-extrabold text-primary">3. Print Format &amp; Styling</h3>

            {studioMode === 'single' && (
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: 'crate-tag', label: 'Crate Tag' },
                    { id: 'standee', label: 'Standee' },
                    { id: 'a4-poster', label: 'A4 Poster' },
                  ] as const
                ).map((fmt) => (
                  <button
                    key={fmt.id}
                    type="button"
                    onClick={() => setTemplate(fmt.id)}
                    className={`h-9 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                      template === fmt.id
                        ? 'bg-primary text-on-primary border-primary'
                        : 'bg-surface-container-low text-on-surface border-outline-variant/25'
                    }`}
                  >
                    {fmt.label}
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <div>
                <span className="block text-[11px] font-semibold text-on-surface-variant mb-1.5">QR Ink Color</span>
                <div className="flex items-center gap-2">
                  {INK_THEMES.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      title={theme.label}
                      aria-label={theme.label}
                      onClick={() => setInkHex(theme.hex)}
                      className={`w-7 h-7 rounded-full border-2 transition-transform cursor-pointer ${
                        inkHex === theme.hex ? 'border-primary scale-110 ring-2 ring-primary/25' : 'border-white'
                      }`}
                      style={{ backgroundColor: theme.hex }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex-1 max-w-[180px]">
                <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">
                  Error Correction
                </label>
                <select
                  value={ecc}
                  onChange={(e) => setEcc(e.target.value as QrErrorCorrectionLevel)}
                  className="w-full h-9 px-2.5 rounded-lg border border-outline-variant/40 bg-white text-xs font-semibold"
                >
                  <option value="M">M · 15% Standard</option>
                  <option value="Q">Q · 25% Resilient</option>
                  <option value="H">H · 30% Outdoor Crates</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1 text-xs font-semibold text-on-surface">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} />
                Show Price &amp; Unit
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={showFreshness} onChange={(e) => setShowFreshness(e.target.checked)} />
                Show Freshness Note
              </label>
              {studioMode === 'single' && template !== 'crate-tag' && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={showPhoto} onChange={(e) => setShowPhoto(e.target.checked)} />
                  Include Photo
                </label>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={showUrlCaption} onChange={(e) => setShowUrlCaption(e.target.checked)} />
                Show Direct URL
              </label>
            </div>
          </div>
        </section>

        {/* Right Live Print Stage & Export Toolbar */}
        <section className="lg:col-span-7 space-y-4">
          {/* Action Toolbar */}
          <div className="bg-surface-container-lowest rounded-2xl p-4 border border-outline-variant/25 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={activeItems.length === 0 || generating}
                  onClick={handlePrint}
                  className="h-10 px-4 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                >
                  <span className="material-symbols-outlined text-[18px]">print</span>
                  <span>{studioMode === 'batch' ? `Print A4 Sheet (${activeItems.length})` : 'Print QR Card'}</span>
                </button>

                {studioMode === 'single' && selectedProduct && (
                  <>
                    <button
                      type="button"
                      disabled={exporting === 'card-png' || generating}
                      onClick={handleDownloadPrintCardPng}
                      className="h-10 px-3.5 rounded-xl bg-secondary-container text-on-secondary-container text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                    >
                      <span className="material-symbols-outlined text-[17px]">download</span>
                      <span>{exporting === 'card-png' ? 'Rendering...' : 'Download Print Card'}</span>
                    </button>

                    <button
                      type="button"
                      disabled={exporting === 'qr-svg' || generating}
                      onClick={handleDownloadRawQrSvg}
                      className="h-10 px-3 rounded-xl bg-surface-container-low hover:bg-surface-container text-primary text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <span className="material-symbols-outlined text-[17px]">code</span>
                      <span>Vector SVG</span>
                    </button>

                    <button
                      type="button"
                      disabled={exporting === 'qr-png' || generating}
                      onClick={handleDownloadRawQrPng}
                      className="h-10 px-3 rounded-xl bg-surface-container-low hover:bg-surface-container text-primary text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <span className="material-symbols-outlined text-[17px]">image</span>
                      <span>QR PNG</span>
                    </button>
                  </>
                )}
              </div>

              {studioMode === 'single' && selectedProduct && (
                <button
                  type="button"
                  onClick={() =>
                    onPreviewCheckout({
                      productId: selectedProduct.id,
                      growerId: selectedProduct.growerId || growerProfile?.ownerId,
                      qty: defaultQty,
                      src: effectiveSource,
                    })
                  }
                  className="h-10 px-3.5 rounded-xl border border-primary/30 text-primary hover:bg-surface-container-low text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <span className="material-symbols-outlined text-[17px]">open_in_new</span>
                  <span>Preview Checkout Page</span>
                </button>
              )}
            </div>

            {/* Live Direct Checkout Link Bar */}
            {studioMode === 'single' && selectedProduct && (
              <div className="flex items-center gap-2 bg-surface-container-low rounded-xl px-3 py-2 border border-outline-variant/20">
                <span className="material-symbols-outlined text-secondary text-[17px] shrink-0">link</span>
                <code className="text-[11px] font-mono text-on-surface-variant truncate flex-1">
                  {checkoutUrlMap[selectedProduct.id]}
                </code>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="px-2.5 py-1 rounded-lg bg-white border border-outline-variant/30 text-primary text-[11px] font-bold cursor-pointer shrink-0 hover:bg-surface-container"
                >
                  {copiedUrl ? 'Copied' : 'Copy Link'}
                </button>
              </div>
            )}
          </div>

          {/* Paper Preview Surface */}
          <div className="bg-surface-container-low/70 rounded-2xl p-5 sm:p-6 border border-outline-variant/25">
            <div className="flex items-center justify-between text-xs text-on-surface-variant mb-4">
              <span className="font-bold text-primary">
                {studioMode === 'batch'
                  ? `A4 Printable Crate Tag Sheet · ${activeItems.length} listing${activeItems.length === 1 ? '' : 's'}`
                  : `Live Print Preview · ${
                      template === 'crate-tag'
                        ? 'Crate / Shelf Tag'
                        : template === 'a4-poster'
                          ? 'A4 Full Poster'
                          : 'Countertop Standee'
                    }`}
              </span>
              <span className="text-[11px]">{generating ? 'Updating QR...' : 'Print-ready 300 DPI vector'}</span>
            </div>

            {activeItems.length === 0 ? (
              <div className="bg-white rounded-xl p-10 text-center border border-dashed border-outline-variant text-xs text-on-surface-variant">
                Select one or more product listings on the left to build your printable QR sheet.
              </div>
            ) : studioMode === 'batch' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeItems.map((item) => renderPrintableCard(item, true))}
              </div>
            ) : (
              selectedProduct && renderPrintableCard(selectedProduct, false)
            )}
          </div>
        </section>
      </div>

      {/* Dedicated Print-Only Portal mounted directly onto document.body */}
      {typeof document !== 'undefined' &&
        activeItems.length > 0 &&
        createPortal(
          <div className="zenvego-print-portal" aria-hidden="true">
            {studioMode === 'batch' ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-outline-variant/40 pb-2 text-xs">
                  <span className="font-extrabold text-primary">{farmDisplayName} — Direct Product Checkout QR Sheet</span>
                  <span className="text-on-surface-variant">
                    Cut along dashed lines · {activeItems.length} listings
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {activeItems.map((item) => renderPrintableCard(item, true))}
                </div>
              </div>
            ) : (
              selectedProduct && (
                <div className="py-2">{renderPrintableCard(selectedProduct, false)}</div>
              )
            )}
          </div>,
          document.body
        )}
    </div>
  );
};
