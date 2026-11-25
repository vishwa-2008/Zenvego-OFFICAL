import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { GrowerProfileDoc, SellerOrderDoc } from '../types';
import { buildStoreMarketingUrl, renderDynamicQrPngDataUrl } from '../utils/qrGenerator';
import { ZenvegoLogo } from './ZenvegoLogo';

export type BillPaperFormat = 'a4' | 'thermal';
export type AutoPrintTrigger = 'on_ready' | 'on_accept' | 'both' | 'manual';

export interface BillPrintSettings {
  autoPrintTrigger: AutoPrintTrigger;
  autoPrintNewIncoming: boolean;
  format: BillPaperFormat;
  copies: 1 | 2;
  includeReorderQr: boolean;
  includeSellerSplitOnCopy2: boolean;
}

const STORAGE_KEY = 'zenvego_seller_official_bill_settings_v1';
const PRINTED_LOG_KEY = 'zenvego_seller_printed_bills_v1';

export const DEFAULT_BILL_PRINT_SETTINGS: BillPrintSettings = {
  autoPrintTrigger: 'on_ready',
  autoPrintNewIncoming: false,
  format: 'a4',
  copies: 1,
  includeReorderQr: true,
  includeSellerSplitOnCopy2: false,
};

export function loadBillPrintSettings(): BillPrintSettings {
  if (typeof window === 'undefined') return DEFAULT_BILL_PRINT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_BILL_PRINT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<BillPrintSettings>;
    return {
      autoPrintTrigger:
        parsed.autoPrintTrigger === 'on_ready' ||
        parsed.autoPrintTrigger === 'on_accept' ||
        parsed.autoPrintTrigger === 'both' ||
        parsed.autoPrintTrigger === 'manual'
          ? parsed.autoPrintTrigger
          : DEFAULT_BILL_PRINT_SETTINGS.autoPrintTrigger,
      autoPrintNewIncoming: Boolean(parsed.autoPrintNewIncoming),
      format: parsed.format === 'thermal' ? 'thermal' : 'a4',
      copies: parsed.copies === 2 ? 2 : 1,
      includeReorderQr: parsed.includeReorderQr !== false,
      includeSellerSplitOnCopy2: Boolean(parsed.includeSellerSplitOnCopy2),
    };
  } catch {
    return DEFAULT_BILL_PRINT_SETTINGS;
  }
}

export function saveBillPrintSettings(settings: BillPrintSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadPrintedBillLog(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(PRINTED_LOG_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function savePrintedBillLog(log: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PRINTED_LOG_KEY, JSON.stringify(log));
  } catch {
    // Ignore storage quota errors
  }
}

export function buildOfficialInvoiceNumber(order: SellerOrderDoc): string {
  const codePart = order.orderCode.replace(/^ZVG-?/i, '').replace(/[^A-Za-z0-9]/g, '');
  const idSuffix = order.id.replace(/[^A-Za-z0-9]/g, '').slice(-4).toUpperCase() || '0001';
  return `ZVG-INV-${codePart}-${idSuffix}`;
}

export function formatBillDateTime(iso?: string): string {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatInr(amount: number): string {
  return `₹${amount.toFixed(2)}`;
}

/**
 * Generates a storefront reorder QR PNG Data URL for the seller's farm.
 */
export function useStorefrontBillQr(growerId: string | undefined, enabled: boolean): {
  qrDataUrl: string;
  qrReady: boolean;
} {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrReady, setQrReady] = useState(!enabled);

  useEffect(() => {
    if (!enabled || !growerId) {
      setQrDataUrl('');
      setQrReady(true);
      return;
    }
    let cancelled = false;
    setQrReady(false);
    const url = buildStoreMarketingUrl(growerId);
    renderDynamicQrPngDataUrl(url, {
      size: 280,
      margin: 2,
      color: '#003820',
      bgColor: '#ffffff',
      ecc: 'M',
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setQrDataUrl(dataUrl);
          setQrReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrDataUrl('');
          setQrReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [growerId, enabled]);

  return { qrDataUrl, qrReady };
}

interface OfficialBillSheetProps {
  order: SellerOrderDoc;
  growerProfile: GrowerProfileDoc | null;
  format: BillPaperFormat;
  copyLabel: string;
  isInternalCopy?: boolean;
  includeReorderQr: boolean;
  includeSellerSplit?: boolean;
  qrDataUrl: string;
  isPrinterTest?: boolean;
}

export const OfficialBillSheet: React.FC<OfficialBillSheetProps> = ({
  order,
  growerProfile,
  format,
  copyLabel,
  isInternalCopy = false,
  includeReorderQr,
  includeSellerSplit = false,
  qrDataUrl,
  isPrinterTest = false,
}) => {
  const invoiceNo = buildOfficialInvoiceNumber(order);
  const billDate = formatBillDateTime(order.createdAt);
  const totalQty = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const farmName = growerProfile?.farmName || order.farmName || 'Zenvego Verified Farm';
  const growerName = growerProfile?.growerName || 'Registered Local Grower';
  const farmArea = growerProfile?.areaName || 'Hyperlocal Farm Cluster';
  const farmType = growerProfile?.farmType || 'Local Terrace & Organic Farm';
  const sellerPhone = growerProfile?.phone?.trim();

  if (format === 'thermal') {
    return (
      <article className="zenvego-bill-thermal bg-white text-[#111914] border border-outline-variant/40 print:border-0 rounded-xl print:rounded-none p-4 print:p-1.5 font-sans text-[11px] leading-snug max-w-[300px] mx-auto">
        {/* Thermal Brand Header */}
        <div className="text-center border-b border-dashed border-[#131e17]/40 pb-2.5 space-y-1">
          <div className="flex items-center justify-center gap-1.5">
            <ZenvegoLogo variant="emblem" className="w-6 h-6" />
            <span className="text-base font-extrabold tracking-tight text-[#003820]">ZENVEGO</span>
          </div>
          <p className="text-[10px] font-extrabold tracking-wider uppercase text-[#131e17]">
            Official Delivery Bill &amp; Packing Slip
          </p>
          <p className="text-[10px] text-[#404942]">{copyLabel}</p>
          {isPrinterTest && (
            <p className="text-[10px] font-bold text-red-700">PRINTER ALIGNMENT TEST · ZERO VALUE</p>
          )}
        </div>

        {/* Bill Meta */}
        <div className="py-2 border-b border-dashed border-[#131e17]/40 space-y-0.5 font-mono text-[10px] tabular-nums">
          <div className="flex justify-between gap-2">
            <span>Bill No:</span>
            <span className="font-bold text-right">{invoiceNo}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span>Order:</span>
            <span className="font-bold">{order.orderCode}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span>Date:</span>
            <span>{billDate}</span>
          </div>
          {order.sealId && (
            <div className="flex justify-between gap-2">
              <span>Tamper Seal:</span>
              <span className="font-bold">{order.sealId}</span>
            </div>
          )}
        </div>

        {/* Seller & Customer */}
        <div className="py-2 border-b border-dashed border-[#131e17]/40 space-y-2 text-[10px]">
          <div>
            <p className="font-extrabold text-[#003820]">Sold &amp; Packed By</p>
            <p className="font-bold">{farmName}</p>
            <p className="text-[#404942]">
              {growerName} · {farmArea}
            </p>
          </div>
          <div>
            <p className="font-extrabold text-[#003820]">Deliver To</p>
            <p className="font-bold">{order.customerName}</p>
            <p className="text-[#404942]">{order.customerArea}</p>
          </div>
        </div>

        {/* Itemized Lines */}
        <div className="py-2 border-b border-dashed border-[#131e17]/40">
          <div className="grid grid-cols-12 text-[9.5px] font-extrabold border-b border-[#131e17]/20 pb-1 mb-1">
            <span className="col-span-6">Item</span>
            <span className="col-span-2 text-center">Qty</span>
            <span className="col-span-4 text-right">Amt</span>
          </div>
          <div className="space-y-1.5 tabular-nums">
            {order.items.map((item, idx) => (
              <div key={`${item.productId}-${idx}`} className="grid grid-cols-12 items-start text-[10.5px]">
                <div className="col-span-6 pr-1">
                  <p className="font-bold leading-tight">{item.name}</p>
                  <p className="text-[9.5px] text-[#404942]">
                    {item.unit} @ ₹{item.unitPrice}
                  </p>
                </div>
                <span className="col-span-2 text-center font-mono font-bold">{item.quantity}</span>
                <span className="col-span-4 text-right font-mono font-bold">{formatInr(item.lineTotal)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Totals */}
        <div className="py-2 border-b border-dashed border-[#131e17]/40 space-y-1 tabular-nums">
          <div className="flex justify-between text-[10px]">
            <span>Packs ({totalQty}) · Fresh Produce GST</span>
            <span className="font-mono">0% Exempt</span>
          </div>
          <div className="flex justify-between text-sm font-extrabold text-[#003820] pt-1">
            <span>TOTAL BILL</span>
            <span className="font-mono">{formatInr(order.grossAmount)}</span>
          </div>
          {isInternalCopy && includeSellerSplit && (
            <div className="pt-1.5 mt-1 border-t border-dotted border-[#131e17]/30 space-y-0.5 text-[9.5px] text-[#404942]">
              <div className="flex justify-between">
                <span>Platform Allocation (10%)</span>
                <span className="font-mono">-{formatInr(order.platformFee)}</span>
              </div>
              <div className="flex justify-between font-bold text-[#003820]">
                <span>Grower Net Payable (90%)</span>
                <span className="font-mono">{formatInr(order.netPayout)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Packing Checklist */}
        <div className="py-2 border-b border-dashed border-[#131e17]/40 text-[9.5px] space-y-0.5">
          <p className="font-bold text-[#003820]">Dispatch Quality Check</p>
          <p>[x] Fresh Harvest Packed · [x] Weight Verified</p>
          <p>[x] Tamper Seal {order.sealId || 'Applied'}</p>
        </div>

        {/* Storefront Reorder QR */}
        {includeReorderQr && qrDataUrl && (
          <div className="pt-2.5 text-center space-y-1">
            <img
              src={qrDataUrl}
              alt={`Reorder QR for ${farmName}`}
              className="w-24 h-24 mx-auto border border-[#131e17]/15 p-1 bg-white"
            />
            <p className="text-[9.5px] font-bold text-[#003820]">Scan to reorder directly from {farmName}</p>
          </div>
        )}

        <div className="pt-2.5 text-center text-[9px] text-[#404942] space-y-0.5">
          <p className="font-semibold">Official Zenvego Farm-to-Door Bill</p>
          <p>Queries: zenvego.in@gmail.com · IG: @zenvego.in</p>
          <p>Thank you for supporting local neighborhood growers.</p>
        </div>
      </article>
    );
  }

  // Standard Official A4 Delivery Bill & Packing Slip
  return (
    <article className="bg-white text-[#131e17] border border-[#c0c9c0] print:border-[#131e17]/25 rounded-2xl print:rounded-none overflow-hidden shadow-xs print:shadow-none max-w-[780px] mx-auto">
      {/* Official Top Letterhead */}
      <header className="px-6 py-5 border-b-2 border-[#003820] flex flex-wrap items-start justify-between gap-4 bg-[#f7fcf8] print:bg-[#f7fcf8]">
        <div className="flex items-center gap-3">
          <ZenvegoLogo variant="emblem" className="w-11 h-11 shrink-0" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-extrabold tracking-tight text-[#003820]">Zenvego</span>
              <span className="text-xs font-semibold text-[#404942]">· Hyperlocal Farm-to-Door Marketplace</span>
            </div>
            <p className="text-xs font-extrabold tracking-wide text-[#006d34] mt-0.5">
              OFFICIAL DELIVERY BILL &amp; HARVEST PACKING SLIP
            </p>
            {isPrinterTest && (
              <p className="text-[11px] font-bold text-red-700 mt-0.5">
                PRINTER TEST COPY — SAMPLE LAYOUT (ZERO COMMERCIAL VALUE)
              </p>
            )}
          </div>
        </div>

        <div className="text-left sm:text-right space-y-0.5 text-xs tabular-nums">
          <p className="font-extrabold text-[#003820]">{copyLabel}</p>
          <p className="font-mono font-bold text-[#131e17]">{invoiceNo}</p>
          <p className="text-[11px] text-[#404942]">Issued: {billDate}</p>
        </div>
      </header>

      {/* Reference Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 border-b border-[#d5e0d7] bg-white text-xs tabular-nums">
        <div className="px-5 py-3 border-r border-b sm:border-b-0 border-[#d5e0d7]">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#404942] block">Order Reference</span>
          <span className="font-mono font-extrabold text-[#003820]">{order.orderCode}</span>
        </div>
        <div className="px-5 py-3 sm:border-r border-b sm:border-b-0 border-[#d5e0d7]">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#404942] block">Tamper Seal ID</span>
          <span className="font-mono font-extrabold text-[#131e17]">{order.sealId || 'ZVG-SEAL'}</span>
        </div>
        <div className="px-5 py-3 border-r border-[#d5e0d7]">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#404942] block">Total Packs</span>
          <span className="font-bold text-[#131e17]">
            {totalQty} {totalQty === 1 ? 'Pack' : 'Packs'} ({order.items.length} {order.items.length === 1 ? 'Line' : 'Lines'})
          </span>
        </div>
        <div className="px-5 py-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#404942] block">Dispatch Status</span>
          <span className="font-bold text-[#006d34] capitalize">{order.status.replace(/_/g, ' ')}</span>
        </div>
      </div>

      {/* Seller & Customer Parties Block */}
      <div className="grid grid-cols-1 sm:grid-cols-2 border-b border-[#d5e0d7] text-xs">
        <div className="p-5 sm:border-r border-b sm:border-b-0 border-[#d5e0d7] space-y-1">
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#006d34]">
            Sold, Harvested &amp; Packed By (Seller)
          </p>
          <p className="text-sm font-extrabold text-[#003820]">{farmName}</p>
          <p className="text-[#131e17] font-medium">
            {growerName} · {farmType}
          </p>
          <p className="text-[#404942]">{farmArea}</p>
          {sellerPhone && (
            <div className="pt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[#404942]">
              <span>
                Tel: <strong className="font-mono text-[#131e17]">{sellerPhone}</strong>
              </span>
            </div>
          )}
        </div>

        <div className="p-5 space-y-1">
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#006d34]">
            Deliver To (Customer Parcel Details)
          </p>
          <p className="text-sm font-extrabold text-[#131e17]">{order.customerName}</p>
          <p className="text-[#404942] leading-relaxed">{order.customerArea}</p>
          <p className="pt-1 text-[11px] text-[#404942]">
            Fulfilment Channel: <strong className="text-[#131e17]">Zenvego Hyperlocal EV Dispatch</strong>
          </p>
          {isInternalCopy && (
            <p className="text-[11px] text-[#003820] font-semibold">
              EV Pickup Verification PIN: <span className="font-mono font-extrabold tracking-wider">{order.handoverPin}</span>
            </p>
          )}
        </div>
      </div>

      {/* Itemized Produce Table */}
      <div className="px-5 py-4">
        <table className="w-full text-xs border-collapse tabular-nums">
          <thead>
            <tr className="border-b-2 border-[#003820]/20 text-left text-[10px] uppercase tracking-wider text-[#404942]">
              <th className="py-2 pr-2 font-extrabold w-8">#</th>
              <th className="py-2 pr-3 font-extrabold">Fresh Produce Description</th>
              <th className="py-2 pr-3 font-extrabold">Unit</th>
              <th className="py-2 pr-3 font-extrabold text-right">Qty</th>
              <th className="py-2 pr-3 font-extrabold text-right">Rate (₹)</th>
              <th className="py-2 font-extrabold text-right">Amount (₹)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e4eee6]">
            {order.items.map((item, idx) => (
              <tr key={`${item.productId}-${idx}`}>
                <td className="py-2.5 pr-2 font-mono text-[#404942]">{idx + 1}</td>
                <td className="py-2.5 pr-3">
                  <span className="font-bold text-[#131e17] block">{item.name}</span>
                  <span className="text-[10px] text-[#404942]">HSN 0709 · Fresh Agricultural Produce (0% GST)</span>
                </td>
                <td className="py-2.5 pr-3 text-[#404942]">{item.unit}</td>
                <td className="py-2.5 pr-3 text-right font-mono font-bold text-[#131e17]">{item.quantity}</td>
                <td className="py-2.5 pr-3 text-right font-mono text-[#404942]">{formatInr(item.unitPrice)}</td>
                <td className="py-2.5 text-right font-mono font-bold text-[#003820]">{formatInr(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Summary & Totals */}
        <div className="mt-4 pt-3 border-t border-[#d5e0d7] flex flex-col sm:flex-row justify-between gap-4 items-start">
          {/* Packing Verification Checklist */}
          <div className="text-[11px] text-[#404942] space-y-1.5 max-w-sm">
            <p className="font-extrabold text-[#003820] uppercase tracking-wider text-[10px]">
              Parcel Quality &amp; Handover Verification
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-[#131e17]">
              <span>[✓] Freshly Harvested</span>
              <span>[✓] Net Weight Checked</span>
              <span>[✓] Chemical-Free Batch</span>
              <span>[✓] Seal {order.sealId || 'Applied'}</span>
            </div>
            <p className="text-[10.5px] text-[#404942] leading-relaxed">
              Handling: Please refrigerate leafy greens &amp; herbs within 30 minutes of receipt for peak freshness.
            </p>
          </div>

          {/* Totals Box */}
          <div className="w-full sm:w-64 space-y-1.5 text-xs tabular-nums">
            <div className="flex justify-between text-[#404942]">
              <span>Produce Subtotal</span>
              <span className="font-mono font-semibold text-[#131e17]">{formatInr(order.grossAmount)}</span>
            </div>
            <div className="flex justify-between text-[#404942]">
              <span>Tax (Fresh Produce GST)</span>
              <span className="font-mono text-[#131e17]">₹0.00 (Exempt)</span>
            </div>
            <div className="border-t-2 border-[#003820] pt-2 flex justify-between items-baseline text-sm font-extrabold text-[#003820]">
              <span>Official Bill Total</span>
              <span className="font-mono text-base">{formatInr(order.grossAmount)}</span>
            </div>
            {isInternalCopy && includeSellerSplit && (
              <div className="mt-2 pt-2 border-t border-dashed border-[#c0c9c0] space-y-1 text-[11px] text-[#404942]">
                <div className="flex justify-between">
                  <span>Marketplace Fee (10%)</span>
                  <span className="font-mono">-{formatInr(order.platformFee)}</span>
                </div>
                <div className="flex justify-between font-bold text-[#003820]">
                  <span>Grower Net Payable (90%)</span>
                  <span className="font-mono">{formatInr(order.netPayout)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer with Reorder QR & Official Signatory */}
      <footer className="px-6 py-4 bg-[#f7fcf8] print:bg-[#f7fcf8] border-t border-[#d5e0d7] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {includeReorderQr && qrDataUrl && (
            <img
              src={qrDataUrl}
              alt={`Scan to reorder from ${farmName}`}
              className="w-16 h-16 rounded-md border border-[#c0c9c0] p-1 bg-white shrink-0"
            />
          )}
          <div className="text-[11px] space-y-0.5 max-w-xs">
            <p className="font-extrabold text-[#003820]">
              {includeReorderQr ? `Scan to Reorder Directly from ${farmName}` : 'Official Zenvego Delivery Bill'}
            </p>
            <p className="text-[#404942] leading-snug">
              This is an official computer-generated Zenvego delivery bill enclosed with your fresh farm produce parcel.
              <br />
              Queries: <strong>zenvego.in@gmail.com</strong> · Instagram: <strong>@zenvego.in</strong>
            </p>
          </div>
        </div>

        <div className="text-left sm:text-right text-[11px] space-y-1">
          <p className="font-bold text-[#131e17]">For {farmName}</p>
          <div className="h-6 border-b border-[#707971]/60 w-40 sm:ml-auto" />
          <p className="text-[10px] text-[#404942]">Authorized Grower / Packing Signatory</p>
        </div>
      </footer>
    </article>
  );
};

interface OfficialBillPrintPortalProps {
  orders: SellerOrderDoc[];
  growerProfile: GrowerProfileDoc | null;
  settings: BillPrintSettings;
  isPrinterTest?: boolean;
  onReadyChange?: (ready: boolean) => void;
}

/**
 * Isolated body-level portal used strictly during `window.print()` so ONLY the official
 * delivery bills are printed (zero app sidebar, headers, modals, or toasts).
 */
export const OfficialBillPrintPortal: React.FC<OfficialBillPrintPortalProps> = ({
  orders,
  growerProfile,
  settings,
  isPrinterTest = false,
  onReadyChange,
}) => {
  const growerId = growerProfile?.ownerId || orders[0]?.growerId;
  const { qrDataUrl, qrReady } = useStorefrontBillQr(growerId, settings.includeReorderQr);

  useEffect(() => {
    onReadyChange?.(qrReady);
  }, [qrReady, onReadyChange]);

  if (typeof document === 'undefined' || orders.length === 0) return null;

  const pages: Array<{
    key: string;
    order: SellerOrderDoc;
    copyLabel: string;
    isInternalCopy: boolean;
  }> = [];

  orders.forEach((order) => {
    pages.push({
      key: `${order.id}-customer`,
      order,
      copyLabel: 'Customer Delivery Copy (Enclose with Produce)',
      isInternalCopy: false,
    });
    if (settings.copies === 2) {
      pages.push({
        key: `${order.id}-dispatch`,
        order,
        copyLabel: 'Dispatch / Rider Handover Copy',
        isInternalCopy: true,
      });
    }
  });

  return createPortal(
    <div className="zenvego-print-portal" aria-hidden="true">
      {pages.map((page) => (
        <div key={page.key} className="print-page-break print-break-avoid py-1">
          <OfficialBillSheet
            order={page.order}
            growerProfile={growerProfile}
            format={settings.format}
            copyLabel={page.copyLabel}
            isInternalCopy={page.isInternalCopy}
            includeReorderQr={settings.includeReorderQr}
            includeSellerSplit={settings.includeSellerSplitOnCopy2}
            qrDataUrl={qrDataUrl}
            isPrinterTest={isPrinterTest}
          />
        </div>
      ))}
    </div>,
    document.body
  );
};

interface OfficialBillPreviewModalProps {
  order: SellerOrderDoc | null;
  growerProfile: GrowerProfileDoc | null;
  settings: BillPrintSettings;
  isPrinterTest?: boolean;
  onUpdateSettings: (next: BillPrintSettings) => void;
  onPrintNow: (order: SellerOrderDoc, isPrinterTest?: boolean) => void;
  onClose: () => void;
}

export const OfficialBillPreviewModal: React.FC<OfficialBillPreviewModalProps> = ({
  order,
  growerProfile,
  settings,
  isPrinterTest = false,
  onUpdateSettings,
  onPrintNow,
  onClose,
}) => {
  const [previewCopy, setPreviewCopy] = useState<'customer' | 'dispatch'>('customer');
  const growerId = growerProfile?.ownerId || order?.growerId;
  const { qrDataUrl } = useStorefrontBillQr(growerId, settings.includeReorderQr);

  const invoiceNo = useMemo(() => (order ? buildOfficialInvoiceNumber(order) : ''), [order]);

  if (!order) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label={`Official Delivery Bill ${invoiceNo}`}
    >
      <div className="bg-surface-container-lowest rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl border border-outline-variant/30 overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-outline-variant/20 flex flex-wrap items-center justify-between gap-3 bg-white">
          <div className="min-w-0">
            <h3 className="text-sm sm:text-base font-extrabold text-primary truncate">
              Official Delivery Bill · {order.orderCode}
            </h3>
            <p className="text-xs text-on-surface-variant truncate">
              {invoiceNo} · Ready to enclose with delivery parcel
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onPrintNow(order, isPrinterTest)}
              className="h-10 px-4 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <span className="material-symbols-outlined text-[18px]">print</span>
              <span>Print Official Bill ({settings.copies === 2 ? '2 Copies' : '1 Copy'})</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close bill preview"
              className="w-10 h-10 rounded-xl bg-surface-container-low hover:bg-surface-container text-primary flex items-center justify-center cursor-pointer"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>

        {/* Live Print Options Toolbar */}
        <div className="px-5 py-3 bg-surface-container-low border-b border-outline-variant/20 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            {/* Paper format segmented buttons */}
            <div className="inline-flex items-center p-1 bg-white rounded-lg border border-outline-variant/30">
              <button
                type="button"
                onClick={() => onUpdateSettings({ ...settings, format: 'a4' })}
                className={`px-3 py-1 rounded-md text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                  settings.format === 'a4' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-primary'
                }`}
              >
                A4 Official Bill
              </button>
              <button
                type="button"
                onClick={() => onUpdateSettings({ ...settings, format: 'thermal' })}
                className={`px-3 py-1 rounded-md text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                  settings.format === 'thermal'
                    ? 'bg-primary text-on-primary'
                    : 'text-on-surface-variant hover:text-primary'
                }`}
              >
                80mm Thermal Slip
              </button>
            </div>

            {/* Copies segmented buttons */}
            <div className="inline-flex items-center p-1 bg-white rounded-lg border border-outline-variant/30">
              <button
                type="button"
                onClick={() => {
                  onUpdateSettings({ ...settings, copies: 1 });
                  setPreviewCopy('customer');
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                  settings.copies === 1 ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-primary'
                }`}
              >
                1 Copy
              </button>
              <button
                type="button"
                onClick={() => onUpdateSettings({ ...settings, copies: 2 })}
                className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                  settings.copies === 2 ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-primary'
                }`}
              >
                2 Copies (Customer + Rider)
              </button>
            </div>

            {settings.copies === 2 && (
              <div className="inline-flex items-center p-1 bg-white rounded-lg border border-outline-variant/30">
                <button
                  type="button"
                  onClick={() => setPreviewCopy('customer')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-bold cursor-pointer whitespace-nowrap ${
                    previewCopy === 'customer' ? 'bg-secondary text-on-secondary' : 'text-on-surface-variant'
                  }`}
                >
                  Viewing Customer Copy
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewCopy('dispatch')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-bold cursor-pointer whitespace-nowrap ${
                    previewCopy === 'dispatch' ? 'bg-secondary text-on-secondary' : 'text-on-surface-variant'
                  }`}
                >
                  Viewing Rider Copy
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-1.5 font-semibold text-on-surface cursor-pointer">
              <input
                type="checkbox"
                checked={settings.includeReorderQr}
                onChange={(e) => onUpdateSettings({ ...settings, includeReorderQr: e.target.checked })}
              />
              <span>Farm Reorder QR</span>
            </label>
            {settings.copies === 2 && (
              <label className="flex items-center gap-1.5 font-semibold text-on-surface cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.includeSellerSplitOnCopy2}
                  onChange={(e) => onUpdateSettings({ ...settings, includeSellerSplitOnCopy2: e.target.checked })}
                />
                <span>Show Payout Split on Copy 2</span>
              </label>
            )}
          </div>
        </div>

        {/* Scrollable Bill Preview Canvas */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-[#eef5ef]">
          <OfficialBillSheet
            order={order}
            growerProfile={growerProfile}
            format={settings.format}
            copyLabel={
              previewCopy === 'dispatch' && settings.copies === 2
                ? 'Dispatch / Rider Handover Copy'
                : 'Customer Delivery Copy (Enclose with Produce)'
            }
            isInternalCopy={previewCopy === 'dispatch' && settings.copies === 2}
            includeReorderQr={settings.includeReorderQr}
            includeSellerSplit={settings.includeSellerSplitOnCopy2}
            qrDataUrl={qrDataUrl}
            isPrinterTest={isPrinterTest}
          />
        </div>
      </div>
    </div>
  );
};
