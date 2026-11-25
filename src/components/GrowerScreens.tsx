import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { downloadTextFile, HOTLINK_IMAGES } from '../data/mockData';
import {
  DeliveryAssignmentDoc,
  GrowerListing,
  GrowerProfileDoc,
  LedgerEntry,
  ProduceCategory,
  ScreenId,
  SellerOrderDoc,
} from '../types';
import { getLocationFreshness, haversineKm, isValidCoord } from '../lib/geo';
import { LocationPickerMap, LocationPickerResult } from './MapLibreWidgets';
import { LiveCameraCapture } from './LiveCameraVerify';
import {
  AutoPrintTrigger,
  BillPrintSettings,
  buildOfficialInvoiceNumber,
  loadBillPrintSettings,
  loadPrintedBillLog,
  OfficialBillPreviewModal,
  OfficialBillPrintPortal,
  saveBillPrintSettings,
  savePrintedBillLog,
} from './OfficialDeliveryBill';
import { QrGeneratorModal } from './QrWidgets';
import { SmartImage } from './ZenvegoLogo';

const PRODUCE_IMAGE_PRESETS: { label: string; category: ProduceCategory; url: string }[] = [
  { label: 'Tomatoes (Nattu)', category: 'Vegetables', url: HOTLINK_IMAGES.tomatoNattu },
  { label: 'Spinach (Palak)', category: 'Leafy Greens', url: HOTLINK_IMAGES.spinachPalak },
  { label: 'Brinjal (Purple)', category: 'Vegetables', url: HOTLINK_IMAGES.brinjalPurple },
  { label: 'Okra (Bhindi)', category: 'Vegetables', url: HOTLINK_IMAGES.okraBhindi },
  { label: 'Curry Leaves', category: 'Herbs', url: HOTLINK_IMAGES.curryLeaves },
  { label: 'Hydroponic Greens', category: 'Microgreens', url: HOTLINK_IMAGES.lettuceHydro },
  { label: 'Fresh Coriander (Dhaniya)', category: 'Herbs', url: HOTLINK_IMAGES.corianderDhaniya },
  { label: 'Garden Carrots', category: 'Heirloom', url: HOTLINK_IMAGES.heroBasket },
];

// ---------------------------------------------------------------------------
// 1. Grower Dashboard (100% Real Firestore-Derived Metrics + Storefront QR)
// ---------------------------------------------------------------------------
interface CropAnalyticsProps {
  currentUid: string | null;
  growerProfile: GrowerProfileDoc | null;
  listings: GrowerListing[];
  sellerOrders: SellerOrderDoc[];
  ledger: LedgerEntry[];
  onNavigate: (screen: ScreenId) => void;
  onNotify: (msg: string) => void;
}

export const CropAnalyticsScreen: React.FC<CropAnalyticsProps> = ({
  currentUid,
  growerProfile,
  listings,
  sellerOrders,
  ledger,
  onNavigate,
  onNotify,
}) => {
  const [storeQrOpen, setStoreQrOpen] = useState(false);

  const metrics = useMemo(() => {
    const activeListings = listings.filter((l) => l.available && l.stock > 0).length;
    const totalUnitsAvailable = listings.reduce((s, l) => s + l.stock, 0);
    const pendingOrders = sellerOrders.filter(
      (o) => o.status === 'awaiting_acceptance' || o.status === 'preparing' || o.status === 'ready_for_pickup'
    ).length;
    const deliveredOrders = sellerOrders.filter((o) => o.status === 'delivered').length;
    const totalNetPayable = ledger.reduce((s, e) => s + e.net, 0);
    return { activeListings, totalUnitsAvailable, pendingOrders, deliveredOrders, totalNetPayable };
  }, [listings, sellerOrders, ledger]);

  const handleExportCsv = () => {
    const csv = [
      'OrderCode,Status,GrossINR,PlatformFeeINR,NetPayableINR',
      ...sellerOrders.map((o) => `${o.orderCode},${o.status},${o.grossAmount},${o.platformFee},${o.netPayout}`),
    ].join('\n');
    downloadTextFile(`Zenvego_Grower_Orders.csv`, csv, 'text/csv');
    onNotify('Exported real grower order history (CSV)');
  };

  return (
    <div className="flex flex-col w-full gap-4 pb-10">
      {/* Farm Banner */}
      <div className="bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-outline-variant/20 flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-secondary">
            {growerProfile ? `${growerProfile.farmType} · ${growerProfile.verificationStatus}` : 'Grower Profile Setup'}
          </span>
          <h2 className="text-xl font-extrabold text-primary mt-0.5">
            {growerProfile?.farmName || 'Complete Your Farm Profile'}
          </h2>
          <p className="text-xs text-on-surface-variant mt-0.5">
            {growerProfile?.areaName || 'Add your terrace/farm location & verification details so nearby buyers can discover you.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {currentUid && (
            <button
              type="button"
              onClick={() => setStoreQrOpen(true)}
              className="px-3.5 py-2 rounded-xl bg-secondary-container text-on-secondary-container text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">qr_code_2</span>
              Storefront QR
            </button>
          )}
          <button
            type="button"
            onClick={() => onNavigate('grower-kyc')}
            className="px-3.5 py-2 rounded-xl bg-surface-container-low text-primary text-xs font-bold cursor-pointer"
          >
            {growerProfile ? 'Edit Farm Profile' : 'Set Up Farm Profile'}
          </button>
        </div>
      </div>

      {/* Real Firestore KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 tabular-nums">
        <div className="bg-surface-container-lowest p-4 rounded-2xl shadow-sm border border-outline-variant/20">
          <span className="text-xs text-on-surface-variant font-semibold">Live Listings</span>
          <p className="text-2xl font-extrabold text-primary mt-1">{metrics.activeListings}</p>
          <span className="text-[11px] text-secondary font-semibold">{metrics.totalUnitsAvailable} units in stock</span>
        </div>
        <div className="bg-surface-container-lowest p-4 rounded-2xl shadow-sm border border-outline-variant/20">
          <span className="text-xs text-on-surface-variant font-semibold">Open Fulfilments</span>
          <p className="text-2xl font-extrabold text-amber-800 mt-1">{metrics.pendingOrders}</p>
          <span className="text-[11px] text-on-surface-variant">Awaiting action / pickup</span>
        </div>
        <div className="bg-surface-container-lowest p-4 rounded-2xl shadow-sm border border-outline-variant/20">
          <span className="text-xs text-on-surface-variant font-semibold">Delivered Orders</span>
          <p className="text-2xl font-extrabold text-secondary mt-1">{metrics.deliveredOrders}</p>
          <span className="text-[11px] text-on-surface-variant">QR verified completions</span>
        </div>
        <div className="bg-surface-container-lowest p-4 rounded-2xl shadow-sm border border-outline-variant/20">
          <span className="text-xs text-on-surface-variant font-semibold">Ledger Net Payable</span>
          <p className="text-2xl font-extrabold text-primary mt-1">₹{metrics.totalNetPayable.toFixed(0)}</p>
          <span className="text-[11px] text-on-surface-variant">90% grower allocation</span>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <button
          type="button"
          onClick={() => onNavigate('grower-add-harvest')}
          className="p-4 rounded-2xl bg-primary text-on-primary text-left shadow-sm hover:bg-primary-container transition-colors cursor-pointer space-y-1"
        >
          <span className="material-symbols-outlined text-[24px]">add_circle</span>
          <p className="text-sm font-bold">Publish Fresh Harvest</p>
          <p className="text-xs text-white/80">Add live produce stock to Cloud Firestore</p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('grower-qr-studio')}
          className="p-4 rounded-2xl bg-surface-container-lowest border border-outline-variant/25 text-left shadow-sm hover:bg-surface-container-low transition-colors cursor-pointer space-y-1"
        >
          <span className="material-symbols-outlined text-[24px] text-secondary">qr_code_2</span>
          <p className="text-sm font-bold text-primary">Product Checkout QRs</p>
          <p className="text-xs text-on-surface-variant">Print crate tags, standees &amp; A4 sheets</p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('grower-orders')}
          className="p-4 rounded-2xl bg-surface-container-lowest border border-outline-variant/25 text-left shadow-sm hover:bg-surface-container-low transition-colors cursor-pointer space-y-1"
        >
          <span className="material-symbols-outlined text-[24px] text-primary">local_shipping</span>
          <p className="text-sm font-bold text-primary">Fulfilment Queue ({metrics.pendingOrders})</p>
          <p className="text-xs text-on-surface-variant">Auto-print official bills, dispatch &amp; Pickup QR</p>
        </button>

        <button
          type="button"
          onClick={handleExportCsv}
          className="p-4 rounded-2xl bg-surface-container-lowest border border-outline-variant/25 text-left shadow-sm hover:bg-surface-container-low transition-colors cursor-pointer space-y-1"
        >
          <span className="material-symbols-outlined text-[24px] text-secondary">download</span>
          <p className="text-sm font-bold text-primary">Export Orders CSV</p>
          <p className="text-xs text-on-surface-variant">Download verified seller order report</p>
        </button>
      </div>

      <QrGeneratorModal
        open={storeQrOpen}
        title={`Storefront QR — ${growerProfile?.farmName || 'My Farm'}`}
        subtitle="Customers scanning this QR open your live Zenvego grower storefront"
        requestPayload={
          currentUid
            ? {
                type: 'store',
                growerId: currentUid,
                farmName: growerProfile?.farmName || 'My Terrace Farm',
                areaName: growerProfile?.areaName,
              }
            : null
        }
        onClose={() => setStoreQrOpen(false)}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// 2. Grower Live Inventory + Per-Product QR
// ---------------------------------------------------------------------------
interface InventoryScreenProps {
  listings: GrowerListing[];
  onAdjustStock: (id: string, nextStock: number) => Promise<void>;
  onToggleAvailable: (id: string, nextAvailable: boolean) => Promise<void>;
  onUpdatePrice: (id: string, price: number) => Promise<void>;
  onDeleteListing: (id: string) => Promise<void>;
  onOpenQrStudio: (productId?: string) => void;
  onPreviewProductCheckout: (product: GrowerListing) => void;
  onNavigate: (screen: ScreenId) => void;
  onNotify: (msg: string) => void;
}

export const InventoryScreen: React.FC<InventoryScreenProps> = ({
  listings,
  onAdjustStock,
  onToggleAvailable,
  onUpdatePrice,
  onDeleteListing,
  onOpenQrStudio,
  onPreviewProductCheckout,
  onNavigate,
  onNotify,
}) => {
  const [search, setSearch] = useState('');
  const [editingItem, setEditingItem] = useState<GrowerListing | null>(null);
  const [editPriceVal, setEditPriceVal] = useState('');
  const [qrProduct, setQrProduct] = useState<GrowerListing | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return listings.filter(
      (item) => !q || item.name.toLowerCase().includes(q) || item.bedLabel.toLowerCase().includes(q)
    );
  }, [listings, search]);

  const handleSaveEditPrice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    const parsed = Number(editPriceVal);
    if (!parsed || parsed <= 0) return;
    await onUpdatePrice(editingItem.id, parsed);
    setEditingItem(null);
  };

  return (
    <div className="flex flex-col w-full gap-4 pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 flex items-center bg-surface-container-lowest rounded-xl px-3.5 h-11 border border-outline-variant/25">
          <span className="material-symbols-outlined text-on-surface-variant text-[20px] mr-2">search</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter your harvests..."
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {listings.length > 0 && (
            <button
              type="button"
              onClick={() => onOpenQrStudio()}
              className="h-11 px-3.5 rounded-xl bg-secondary-container text-on-secondary-container text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <span className="material-symbols-outlined text-[18px]">print</span>
              <span>Print QR Sheet</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onNavigate('grower-add-harvest')}
            className="h-11 px-4 rounded-xl bg-primary text-on-primary text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            <span>Add New Harvest</span>
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-surface-container-lowest rounded-2xl p-8 text-center border border-outline-variant/20 space-y-3">
          <span className="material-symbols-outlined text-4xl text-outline">inventory_2</span>
          <h3 className="text-base font-extrabold text-primary">No harvests listed yet</h3>
          <p className="text-xs text-on-surface-variant">
            Add your fresh produce batches to make them immediately discoverable in the Customer Marketplace.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('grower-add-harvest')}
            className="px-5 py-2.5 rounded-xl bg-primary text-on-primary text-xs font-bold cursor-pointer"
          >
            Publish First Harvest
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {filtered.map((item) => (
            <div
              key={item.id}
              className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/20 flex flex-col gap-3"
            >
              <div className="flex items-start gap-3">
                <SmartImage src={item.image} alt={item.name} className="w-16 h-16 rounded-xl object-cover shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-extrabold text-on-surface truncate">{item.name}</h3>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => onOpenQrStudio(item.id)}
                        title="Customize & Print Checkout QR"
                        className="h-8 px-2.5 rounded-lg bg-secondary-container/80 text-on-secondary-container hover:bg-secondary-container text-[11px] font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        <span className="material-symbols-outlined text-[15px]">qr_code_2</span>
                        <span>Print QR</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setQrProduct(item)}
                        title="Quick Checkout QR Preview"
                        className="w-8 h-8 rounded-lg bg-surface-container-low text-primary flex items-center justify-center cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[17px]">share</span>
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-on-surface-variant">
                    {item.category} · {item.bedLabel} · {item.harvestedAt}
                  </p>
                  <div className="flex items-center gap-3 mt-1.5 tabular-nums">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingItem(item);
                        setEditPriceVal(String(item.price));
                      }}
                      className="text-sm font-extrabold text-primary hover:underline cursor-pointer"
                    >
                      ₹{item.price}/{item.unit} ✎
                    </button>
                    <span className="text-[11px] font-semibold text-on-surface-variant">
                      Reserved: {item.reserved}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-outline-variant/15">
                <div className="flex items-center gap-2 bg-surface-container-low rounded-xl px-2 py-1 tabular-nums">
                  <button
                    type="button"
                    onClick={() => onAdjustStock(item.id, Math.max(0, item.stock - 1))}
                    className="w-7 h-7 rounded-lg bg-white text-primary font-bold cursor-pointer"
                  >
                    −
                  </button>
                  <span className="text-xs font-extrabold min-w-[44px] text-center">
                    {item.stock} {item.unitShort}
                  </span>
                  <button
                    type="button"
                    onClick={() => onAdjustStock(item.id, item.stock + 1)}
                    className="w-7 h-7 rounded-lg bg-white text-primary font-bold cursor-pointer"
                  >
                    +
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onToggleAvailable(item.id, !item.available)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer ${
                      item.available
                        ? 'bg-secondary-container text-on-secondary-container'
                        : 'bg-surface-container text-on-surface-variant'
                    }`}
                  >
                    {item.available ? 'Visible' : 'Paused'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onDeleteListing(item.id);
                      onNotify(`Removed ${item.name}`);
                    }}
                    title="Delete listing"
                    className="w-8 h-8 rounded-lg bg-red-50 text-red-700 flex items-center justify-center cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Price Edit Modal */}
      {editingItem && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form onSubmit={handleSaveEditPrice} className="bg-white rounded-2xl p-5 max-w-xs w-full space-y-3 shadow-xl">
            <h3 className="text-sm font-extrabold text-primary">Update Price — {editingItem.name}</h3>
            <input
              type="number"
              min={1}
              max={100000}
              required
              value={editPriceVal}
              onChange={(e) => setEditPriceVal(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant text-sm font-bold"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="px-3.5 py-2 rounded-xl bg-surface-container text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold cursor-pointer">
                Save
              </button>
            </div>
          </form>
        </div>
      )}

      <QrGeneratorModal
        open={Boolean(qrProduct)}
        title={qrProduct ? `Checkout QR — ${qrProduct.name}` : 'Checkout QR'}
        subtitle={qrProduct ? `₹${qrProduct.price}/${qrProduct.unit} · Links directly to this listing’s checkout page` : undefined}
        requestPayload={
          qrProduct
            ? {
                type: 'product',
                productId: qrProduct.id,
                productName: qrProduct.name,
                farmName: qrProduct.farmName,
                price: qrProduct.price,
                unit: qrProduct.unit,
                growerId: qrProduct.growerId,
              }
            : null
        }
        onOpenPrintStudio={qrProduct ? () => onOpenQrStudio(qrProduct.id) : undefined}
        onPreviewCheckout={qrProduct ? () => onPreviewProductCheckout(qrProduct) : undefined}
        onClose={() => setQrProduct(null)}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// 3. Add Fresh Harvest Screen (Writes directly to Firestore products/)
// ---------------------------------------------------------------------------
interface AddHarvestProps {
  growerProfile: GrowerProfileDoc | null;
  onPublish: (listing: Omit<GrowerListing, 'id' | 'growerId' | 'distanceKm'>) => Promise<void>;
  onNotify: (msg: string) => void;
}

export const AddHarvestScreen: React.FC<AddHarvestProps> = ({
  growerProfile,
  onPublish,
  onNotify,
}) => {
  const [name, setName] = useState('');
  const [variety, setVariety] = useState('');
  const [category, setCategory] = useState<ProduceCategory>('Leafy Greens');
  const [price, setPrice] = useState('45');
  const [unit, setUnit] = useState('500g');
  const [stock, setStock] = useState('15');
  const [bedLabel, setBedLabel] = useState('Terrace Bed #1');
  const [chemicalFree, setChemicalFree] = useState(true);
  const [harvestedToday, setHarvestedToday] = useState(true);
  const [growerNote, setGrowerNote] = useState('');
  const [selectedPresetIdx, setSelectedPresetIdx] = useState(0);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numPrice = Number(price);
    const numStock = Number(stock);
    if (!name.trim() || !numPrice || numPrice <= 0 || numStock < 0) {
      onNotify('Enter valid produce name, price, and stock');
      return;
    }
    setSaving(true);
    try {
      await onPublish({
        name: name.trim(),
        variety: variety.trim() || 'Fresh Terrace Variety',
        category,
        bedLabel: bedLabel.trim() || 'Bed #1',
        price: numPrice,
        unit: unit.trim() || '500g',
        unitShort: unit.toLowerCase().includes('kg') ? 'kg' : unit.toLowerCase().includes('bunch') ? 'bn' : 'pk',
        stock: numStock,
        reserved: 0,
        harvestedAt: harvestedToday ? 'Harvested Today' : 'Fresh Batch',
        available: numStock > 0,
        image: PRODUCE_IMAGE_PRESETS[selectedPresetIdx].url,
        farmName: growerProfile?.farmName || 'Neighborhood Terrace Farm',
        lat: growerProfile?.lat ?? 12.9784,
        lng: growerProfile?.lng ?? 77.6408,
        chemicalFree,
        harvestedToday,
        growerNote: growerNote.trim() || undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto flex flex-col gap-4 pb-10">
      <div className="bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-outline-variant/20 space-y-4">
        <div>
          <h2 className="text-base font-extrabold text-primary">Publish Real Harvest to Marketplace</h2>
          <p className="text-xs text-on-surface-variant">
            Farm: <strong>{growerProfile?.farmName || 'Neighborhood Terrace Farm'}</strong>
          </p>
        </div>

        {/* Produce Photo Preset Picker */}
        <div>
          <label className="block text-xs font-bold text-on-surface mb-2">Produce Image</label>
          <div className="grid grid-cols-4 gap-2">
            {PRODUCE_IMAGE_PRESETS.map((p, idx) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setSelectedPresetIdx(idx);
                  setCategory(p.category);
                  if (!name) setName(p.label);
                }}
                className={`rounded-xl overflow-hidden border-2 transition-all cursor-pointer ${
                  selectedPresetIdx === idx ? 'border-primary ring-2 ring-primary/25' : 'border-transparent'
                }`}
              >
                <SmartImage src={p.url} alt={p.label} className="w-full h-16 object-cover" />
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-on-surface mb-1">Produce Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Organic Baby Spinach"
              className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ProduceCategory)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant text-sm bg-white"
            >
              <option value="Leafy Greens">Leafy Greens</option>
              <option value="Vegetables">Vegetables</option>
              <option value="Heirloom">Heirloom</option>
              <option value="Fruits">Fruits</option>
              <option value="Microgreens">Microgreens</option>
              <option value="Herbs">Herbs</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface mb-1">Price (₹)</label>
            <input
              type="number"
              min={1}
              max={100000}
              required
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface mb-1">Unit</label>
            <input
              type="text"
              required
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="500g / 1 kg / bunch"
              className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface mb-1">Available Stock</label>
            <input
              type="number"
              min={1}
              max={100000}
              required
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface mb-1">Variety / Bed Label</label>
            <input
              type="text"
              value={variety}
              onChange={(e) => setVariety(e.target.value)}
              placeholder="e.g., Desi Heirloom · Bed #2"
              className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant text-sm"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-4 pt-1">
          <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
            <input type="checkbox" checked={chemicalFree} onChange={(e) => setChemicalFree(e.target.checked)} />
            Chemical-Free Grown
          </label>
          <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
            <input type="checkbox" checked={harvestedToday} onChange={(e) => setHarvestedToday(e.target.checked)} />
            Harvested Today
          </label>
        </div>

        <div>
          <label className="block text-xs font-bold text-on-surface mb-1">Grower Note (Optional)</label>
          <textarea
            rows={2}
            value={growerNote}
            onChange={(e) => setGrowerNote(e.target.value)}
            placeholder="Harvest time, soil details, or packaging note..."
            className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant text-xs"
          />
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full h-12 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-sm font-bold shadow-md cursor-pointer disabled:opacity-60"
        >
          {saving ? 'Publishing to Firestore...' : 'Publish Live to Marketplace'}
        </button>
      </div>
    </form>
  );
};

// ---------------------------------------------------------------------------
// 4. Grower Seller Order Fulfilment, Automatic Official Delivery Bill Print & Pickup QR
// ---------------------------------------------------------------------------
interface OrderHandoverProps {
  sellerOrders: SellerOrderDoc[];
  growerProfile: GrowerProfileDoc | null;
  growerAssignments?: DeliveryAssignmentDoc[];
  onAcceptOrder: (order: SellerOrderDoc) => Promise<void>;
  onRejectOrder: (order: SellerOrderDoc, reason: string) => Promise<void>;
  onMarkReadyForPickup: (order: SellerOrderDoc) => Promise<void>;
  onNotify: (msg: string) => void;
}

export const OrderHandoverScreen: React.FC<OrderHandoverProps> = ({
  sellerOrders,
  growerProfile,
  growerAssignments = [],
  onAcceptOrder,
  onRejectOrder,
  onMarkReadyForPickup,
  onNotify,
}) => {
  const [pickupQrOrder, setPickupQrOrder] = useState<SellerOrderDoc | null>(null);
  const [rejectTarget, setRejectTarget] = useState<SellerOrderDoc | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Official Delivery Bill Auto-Print settings & printed state
  const [billSettings, setBillSettings] = useState<BillPrintSettings>(() => loadBillPrintSettings());
  const [printedLog, setPrintedLog] = useState<Record<string, string>>(() => loadPrintedBillLog());
  const [previewBillTarget, setPreviewBillTarget] = useState<{
    order: SellerOrderDoc;
    isPrinterTest?: boolean;
  } | null>(null);
  const [printJob, setPrintJob] = useState<{
    orders: SellerOrderDoc[];
    isPrinterTest?: boolean;
    nonce: number;
  } | null>(null);
  const [portalQrReady, setPortalQrReady] = useState(true);
  const activePrintNonceRef = useRef<number | null>(null);
  const knownOrderIdsRef = useRef<Set<string> | null>(null);

  const updateBillSettings = useCallback((next: BillPrintSettings) => {
    setBillSettings(next);
    saveBillPrintSettings(next);
  }, []);

  const markOrdersAsPrinted = useCallback((ordersToMark: SellerOrderDoc[]) => {
    const timeLabel = new Date().toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    });
    setPrintedLog((prev) => {
      const next = { ...prev };
      ordersToMark.forEach((o) => {
        next[o.id] = timeLabel;
      });
      savePrintedBillLog(next);
      return next;
    });
  }, []);

  const triggerOfficialBillPrint = useCallback(
    (ordersToPrint: SellerOrderDoc[], isPrinterTest = false, customNotice?: string) => {
      if (ordersToPrint.length === 0) return;
      const nonce = Date.now() + Math.floor(Math.random() * 1000);
      setPortalQrReady(!billSettings.includeReorderQr);
      setPrintJob({ orders: ordersToPrint, isPrinterTest, nonce });
      if (!isPrinterTest) {
        markOrdersAsPrinted(ordersToPrint);
      }
      if (customNotice) {
        onNotify(customNotice);
      } else if (isPrinterTest) {
        onNotify('Opening print dialog for Official Delivery Bill printer alignment test');
      } else if (ordersToPrint.length === 1) {
        onNotify(`Printing Official Delivery Bill for ${ordersToPrint[0].orderCode}`);
      } else {
        onNotify(`Printing ${ordersToPrint.length} Official Delivery Bills`);
      }
    },
    [billSettings.includeReorderQr, markOrdersAsPrinted, onNotify]
  );

  // Execute isolated window.print() cleanly once the portal QR asset is ready
  useEffect(() => {
    if (!printJob || !portalQrReady) return;
    if (activePrintNonceRef.current === printJob.nonce) return;
    activePrintNonceRef.current = printJob.nonce;

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      document.body.classList.remove('zenvego-printing');
      setPrintJob(null);
      window.removeEventListener('afterprint', cleanup);
    };

    document.body.classList.add('zenvego-printing');
    window.addEventListener('afterprint', cleanup);

    const printTimer = window.setTimeout(() => {
      window.print();
    }, 180);

    // Fallback cleanup for browsers/environments where afterprint does not fire
    const fallbackTimer = window.setTimeout(cleanup, 12000);

    return () => {
      window.clearTimeout(printTimer);
      window.clearTimeout(fallbackTimer);
      window.removeEventListener('afterprint', cleanup);
    };
  }, [printJob, portalQrReady]);

  // Optional auto-print when a brand-new order arrives in real time while Seller Orders page is open
  useEffect(() => {
    if (knownOrderIdsRef.current === null) {
      knownOrderIdsRef.current = new Set(sellerOrders.map((o) => o.id));
      return;
    }
    const known = knownOrderIdsRef.current;
    const newlyArrived = sellerOrders.filter(
      (o) => !known.has(o.id) && o.status === 'awaiting_acceptance'
    );
    sellerOrders.forEach((o) => known.add(o.id));

    if (billSettings.autoPrintNewIncoming && newlyArrived.length > 0) {
      triggerOfficialBillPrint(
        newlyArrived,
        false,
        `New order received — auto-printing Official Delivery Bill (${newlyArrived
          .map((o) => o.orderCode)
          .join(', ')})`
      );
    }
  }, [sellerOrders, billSettings.autoPrintNewIncoming, triggerOfficialBillPrint]);

  const activePrintableOrders = useMemo(
    () =>
      sellerOrders.filter(
        (o) => o.status === 'accepted' || o.status === 'preparing' || o.status === 'ready_for_pickup'
      ),
    [sellerOrders]
  );

  const buildPrinterTestOrder = useCallback((): SellerOrderDoc => {
    return {
      id: 'test-bill-0001',
      parentOrderId: 'test-parent',
      orderCode: 'ZVG-TEST01',
      customerId: 'printer-test',
      customerName: 'Printer Alignment Verification',
      customerArea: growerProfile?.areaName || 'Local Delivery Cluster',
      growerId: growerProfile?.ownerId || 'grower-test',
      farmName: growerProfile?.farmName || 'Zenvego Verified Farm',
      status: 'ready_for_pickup',
      handoverPin: '4829',
      sealId: 'SL-TEST',
      grossAmount: 0,
      platformFee: 0,
      netPayout: 0,
      items: [
        {
          productId: 'test-item',
          name: 'Printer Test Line (Fresh Produce Sample)',
          unit: '500g',
          unitPrice: 0,
          quantity: 1,
          lineTotal: 0,
        },
      ],
      createdAt: new Date().toISOString(),
    };
  }, [growerProfile]);

  const handleRejectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectTarget || !rejectReason.trim()) return;
    setBusyId(rejectTarget.id);
    try {
      await onRejectOrder(rejectTarget, rejectReason.trim());
      setRejectTarget(null);
      setRejectReason('');
    } finally {
      setBusyId(null);
    }
  };

  const willAutoPrintOnAccept =
    billSettings.autoPrintTrigger === 'on_accept' || billSettings.autoPrintTrigger === 'both';
  const willAutoPrintOnReady =
    billSettings.autoPrintTrigger === 'on_ready' || billSettings.autoPrintTrigger === 'both';

  const autoPrintSummary =
    billSettings.autoPrintTrigger === 'manual'
      ? 'Manual Print Only'
      : billSettings.autoPrintTrigger === 'on_ready'
        ? 'Auto-prints on Mark Ready for Pickup'
        : billSettings.autoPrintTrigger === 'on_accept'
          ? 'Auto-prints on Accept Order'
          : 'Auto-prints on Accept & Mark Ready';

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4 pb-10">
      {/* Header Summary */}
      <div className="bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-outline-variant/20 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-extrabold text-primary">Your Seller Fulfilment Orders</h2>
          <p className="text-xs text-on-surface-variant mt-0.5">
            Accept orders, automatically print official Zenvego delivery bills to enclose with each parcel, and verify EV pickup handovers.
          </p>
        </div>
        <div className="text-xs font-bold text-primary tabular-nums whitespace-nowrap">
          {sellerOrders.length} Total · {activePrintableOrders.length} Ready / Packing
        </div>
      </div>

      {/* Automatic Official Bill Print Desk Controls */}
      <section
        aria-label="Automatic Official Delivery Bill Print Settings"
        className="bg-surface-container-lowest rounded-2xl p-4 sm:p-5 shadow-sm border border-outline-variant/25 space-y-3.5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-0.5">
            <h3 className="text-sm font-extrabold text-primary">Official Delivery Bill Auto-Print</h3>
            <p className="text-xs text-on-surface-variant">
              {autoPrintSummary} · {billSettings.format === 'a4' ? 'A4 Official Bill' : '80mm Thermal Slip'} ·{' '}
              {billSettings.copies === 2 ? '2 Copies (Customer + Rider)' : '1 Copy (Customer)'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {activePrintableOrders.length > 0 && (
              <button
                type="button"
                onClick={() => triggerOfficialBillPrint(activePrintableOrders)}
                className="h-9 px-3.5 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <span className="material-symbols-outlined text-[16px]">print</span>
                <span>Print All Active Bills ({activePrintableOrders.length})</span>
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                setPreviewBillTarget({
                  order: activePrintableOrders[0] || sellerOrders[0] || buildPrinterTestOrder(),
                  isPrinterTest: sellerOrders.length === 0,
                })
              }
              className="h-9 px-3.5 rounded-xl bg-surface-container-low hover:bg-surface-container text-primary text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <span className="material-symbols-outlined text-[16px]">receipt_long</span>
              <span>{sellerOrders.length === 0 ? 'Preview / Test Print Bill' : 'Preview Bill Layout'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 border-t border-outline-variant/15 text-xs">
          <div>
            <label htmlFor="auto-print-trigger" className="block text-[11px] font-bold text-on-surface-variant mb-1">
              Automatic Print Trigger
            </label>
            <select
              id="auto-print-trigger"
              value={billSettings.autoPrintTrigger}
              onChange={(e) =>
                updateBillSettings({
                  ...billSettings,
                  autoPrintTrigger: e.target.value as AutoPrintTrigger,
                })
              }
              className="w-full h-9 px-3 rounded-lg border border-outline-variant/40 bg-white text-xs font-semibold text-on-surface focus:outline-none focus:border-primary"
            >
              <option value="on_ready">Auto-print on Mark Ready (Recommended)</option>
              <option value="on_accept">Auto-print on Accept Order</option>
              <option value="both">Auto-print on Accept &amp; Mark Ready</option>
              <option value="manual">Manual Print Only</option>
            </select>
          </div>

          <div>
            <span className="block text-[11px] font-bold text-on-surface-variant mb-1">Paper Format</span>
            <div className="grid grid-cols-2 p-0.5 bg-surface-container-low rounded-lg border border-outline-variant/25 h-9">
              <button
                type="button"
                onClick={() => updateBillSettings({ ...billSettings, format: 'a4' })}
                className={`rounded-md text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                  billSettings.format === 'a4'
                    ? 'bg-white text-primary shadow-xs'
                    : 'text-on-surface-variant hover:text-primary'
                }`}
              >
                A4 Bill
              </button>
              <button
                type="button"
                onClick={() => updateBillSettings({ ...billSettings, format: 'thermal' })}
                className={`rounded-md text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                  billSettings.format === 'thermal'
                    ? 'bg-white text-primary shadow-xs'
                    : 'text-on-surface-variant hover:text-primary'
                }`}
              >
                80mm Thermal
              </button>
            </div>
          </div>

          <div>
            <span className="block text-[11px] font-bold text-on-surface-variant mb-1">Copies per Parcel</span>
            <div className="grid grid-cols-2 p-0.5 bg-surface-container-low rounded-lg border border-outline-variant/25 h-9">
              <button
                type="button"
                onClick={() => updateBillSettings({ ...billSettings, copies: 1 })}
                className={`rounded-md text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                  billSettings.copies === 1
                    ? 'bg-white text-primary shadow-xs'
                    : 'text-on-surface-variant hover:text-primary'
                }`}
              >
                1 Copy
              </button>
              <button
                type="button"
                onClick={() => updateBillSettings({ ...billSettings, copies: 2 })}
                className={`rounded-md text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                  billSettings.copies === 2
                    ? 'bg-white text-primary shadow-xs'
                    : 'text-on-surface-variant hover:text-primary'
                }`}
              >
                2 Copies
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 text-xs text-on-surface-variant">
          <label className="flex items-center gap-2 font-semibold text-on-surface cursor-pointer">
            <input
              type="checkbox"
              checked={billSettings.autoPrintNewIncoming}
              onChange={(e) =>
                updateBillSettings({ ...billSettings, autoPrintNewIncoming: e.target.checked })
              }
            />
            <span>Auto-print immediately when a new order arrives live</span>
          </label>

          <label className="flex items-center gap-2 font-semibold text-on-surface cursor-pointer">
            <input
              type="checkbox"
              checked={billSettings.includeReorderQr}
              onChange={(e) =>
                updateBillSettings({ ...billSettings, includeReorderQr: e.target.checked })
              }
            />
            <span>Include Farm Storefront Reorder QR on bill</span>
          </label>
        </div>
      </section>

      {sellerOrders.length === 0 ? (
        <div className="bg-surface-container-lowest rounded-2xl p-8 text-center border border-outline-variant/20 space-y-2">
          <span className="material-symbols-outlined text-4xl text-outline">local_shipping</span>
          <p className="text-sm font-bold text-primary">No incoming seller orders yet</p>
          <p className="text-xs text-on-surface-variant max-w-md mx-auto">
            When a customer checks out any of your published products, the seller fulfilment order appears here in real time and automatically prints your official Zenvego delivery bill based on your settings above.
          </p>
        </div>
      ) : (
        sellerOrders.map((so) => {
          const printedAt = printedLog[so.id];
          const invoiceNo = buildOfficialInvoiceNumber(so);
          return (
            <div
              key={so.id}
              className="bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-outline-variant/25 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-sm font-extrabold text-primary font-mono">{so.orderCode}</span>
                    <span aria-hidden="true" className="text-outline-variant">·</span>
                    <span
                      className={`font-bold capitalize ${
                        so.status === 'delivered'
                          ? 'text-emerald-800'
                          : so.status === 'rejected'
                            ? 'text-red-700'
                            : so.status === 'ready_for_pickup' || so.status === 'picked_up'
                              ? 'text-secondary'
                              : 'text-amber-800'
                      }`}
                    >
                      {so.status.replace(/_/g, ' ')}
                    </span>
                    {so.sealId && (
                      <>
                        <span aria-hidden="true" className="text-outline-variant">·</span>
                        <span className="font-mono text-on-surface-variant">Seal {so.sealId}</span>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-on-surface-variant mt-0.5">
                    Customer: <strong className="text-on-surface">{so.customerName}</strong> · {so.customerArea}
                  </p>
                </div>

                {so.status !== 'rejected' && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPreviewBillTarget({ order: so, isPrinterTest: false })}
                      className="h-9 px-3 rounded-lg bg-surface-container-low hover:bg-surface-container text-primary text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <span className="material-symbols-outlined text-[16px]">visibility</span>
                      <span>Preview Bill</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => triggerOfficialBillPrint([so])}
                      className="h-9 px-3 rounded-lg bg-secondary-container hover:bg-secondary-container/80 text-on-secondary-container text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <span className="material-symbols-outlined text-[16px]">print</span>
                      <span>{printedAt ? 'Reprint Bill' : 'Print Official Bill'}</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Official Bill Reference Metadata Line */}
              {so.status !== 'rejected' && (
                <div className="text-[11px] text-on-surface-variant flex flex-wrap items-center gap-2 tabular-nums">
                  <span className="font-mono font-semibold text-primary">{invoiceNo}</span>
                  <span aria-hidden="true">·</span>
                  <span className={printedAt ? 'text-secondary font-semibold' : 'text-on-surface-variant'}>
                    {printedAt
                      ? `Official bill printed at ${printedAt}`
                      : 'Attach printed official bill with delivery produce'}
                  </span>
                </div>
              )}

              <div className="bg-surface-container-low rounded-xl p-3 space-y-1.5 text-xs tabular-nums">
                {so.items.map((item, idx) => (
                  <div key={`${item.productId}-${idx}`} className="flex justify-between gap-2">
                    <span className="font-semibold text-on-surface">
                      {item.quantity} × {item.name} ({item.unit})
                    </span>
                    <span className="font-bold text-primary font-mono">₹{item.lineTotal}</span>
                  </div>
                ))}
                <div className="border-t border-outline-variant/25 pt-1.5 flex justify-between text-on-surface-variant">
                  <span>Official Customer Bill Total</span>
                  <span className="font-mono font-bold text-on-surface">₹{so.grossAmount}</span>
                </div>
                <div className="flex justify-between font-bold text-primary">
                  <span>Grower Net Payable (90%)</span>
                  <span className="font-mono">₹{so.netPayout}</span>
                </div>
              </div>

              {so.rejectionReason && (
                <p className="text-xs text-red-700 font-medium">Rejection reason: {so.rejectionReason}</p>
              )}

              {/* Lifecycle Action Controls */}
              <div className="flex flex-wrap gap-2 pt-1">
                {so.status === 'awaiting_acceptance' && (
                  <>
                    <button
                      type="button"
                      disabled={busyId === so.id}
                      onClick={async () => {
                        setBusyId(so.id);
                        try {
                          await onAcceptOrder(so);
                          if (willAutoPrintOnAccept) {
                            triggerOfficialBillPrint(
                              [{ ...so, status: 'preparing' }],
                              false,
                              `Order ${so.orderCode} accepted — auto-printing Official Delivery Bill`
                            );
                          }
                        } finally {
                          setBusyId(null);
                        }
                      }}
                      className="flex-1 h-11 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-xs font-bold cursor-pointer disabled:opacity-60 px-4"
                    >
                      {willAutoPrintOnAccept
                        ? 'Accept & Auto-Print Official Bill'
                        : 'Accept & Start Preparing'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRejectTarget(so)}
                      className="h-11 px-4 rounded-xl bg-red-50 text-red-800 border border-red-200 text-xs font-bold cursor-pointer"
                    >
                      Reject
                    </button>
                  </>
                )}

                {(so.status === 'accepted' || so.status === 'preparing') && (
                  <button
                    type="button"
                    disabled={busyId === so.id}
                    onClick={async () => {
                      setBusyId(so.id);
                      try {
                        await onMarkReadyForPickup(so);
                        if (willAutoPrintOnReady) {
                          triggerOfficialBillPrint(
                            [{ ...so, status: 'ready_for_pickup' }],
                            false,
                            `Order ${so.orderCode} ready — auto-printing Official Delivery Bill for parcel`
                          );
                        }
                      } finally {
                        setBusyId(null);
                      }
                    }}
                    className="w-full h-11 rounded-xl bg-secondary hover:bg-primary text-on-secondary text-xs font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 px-4"
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {willAutoPrintOnReady ? 'print' : 'local_shipping'}
                    </span>
                    <span>
                      {willAutoPrintOnReady
                        ? 'Mark Ready for Pickup & Auto-Print Official Bill'
                        : 'Mark Ready for Pickup & Dispatch EV Partner'}
                    </span>
                  </button>
                )}

                {so.status === 'ready_for_pickup' && (() => {
                  const linkedAssignment = growerAssignments.find((a) => a.sellerOrderId === so.id);
                  const partnerAtPickupKm =
                    linkedAssignment &&
                    linkedAssignment.status === 'accepted' &&
                    isValidCoord(linkedAssignment.partnerLat, linkedAssignment.partnerLng) &&
                    isValidCoord(linkedAssignment.pickupLat, linkedAssignment.pickupLng)
                      ? Math.round(
                          haversineKm(
                            linkedAssignment.partnerLat as number,
                            linkedAssignment.partnerLng as number,
                            linkedAssignment.pickupLat,
                            linkedAssignment.pickupLng
                          ) * 10
                        ) / 10
                      : null;
                  const freshness = linkedAssignment?.lastLocationAt
                    ? getLocationFreshness(linkedAssignment.lastLocationAt)
                    : null;

                  return (
                    <div className="w-full space-y-2">
                      {/* Scoped EV Pickup Dispatch Status (Grower sees pickup arrival only — no exact customer GPS) */}
                      <div className="rounded-xl bg-[#0D1628] text-slate-100 border border-slate-700/80 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="material-symbols-outlined text-[18px] text-emerald-400 shrink-0">
                            electric_moped
                          </span>
                          <div className="min-w-0">
                            <p className="font-bold text-white truncate">
                              {linkedAssignment?.partnerName
                                ? `EV Courier: ${linkedAssignment.partnerName}`
                                : 'Dispatched to EV Partner Queue'}
                            </p>
                            <p className="text-[11px] text-slate-400 truncate">
                              {linkedAssignment?.status === 'accepted'
                                ? partnerAtPickupKm !== null
                                  ? `${partnerAtPickupKm} km from your farm pickup · ${freshness?.label || 'En route'}`
                                  : 'Partner claimed pickup — en route to your farm'
                                : 'Waiting for nearest verified EV courier to claim pickup'}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase shrink-0 ${
                            linkedAssignment?.status === 'accepted'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          }`}
                        >
                          {linkedAssignment?.status === 'accepted' ? 'En Route to Pickup' : 'Open Dispatch'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between bg-primary text-on-primary rounded-xl px-4 py-2.5 text-xs">
                        <span>Handover PIN for EV Partner:</span>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard?.writeText(so.handoverPin).catch(() => {});
                            onNotify(`Copied Handover PIN ${so.handoverPin}`);
                          }}
                          className="font-mono text-base font-extrabold tracking-widest cursor-pointer"
                        >
                          {so.handoverPin}
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => triggerOfficialBillPrint([so])}
                          className="h-11 rounded-xl bg-secondary-container text-on-secondary-container text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[18px]">print</span>
                          <span>{printedAt ? 'Reprint Official Delivery Bill' : 'Print Official Delivery Bill'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPickupQrOrder(so)}
                          className="h-11 rounded-xl bg-primary-container text-on-primary text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[18px]">qr_code_2</span>
                          <span>Generate Signed Pickup QR</span>
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          );
        })
      )}

      {/* Isolated Body Portal for Clean Official Delivery Bill Printing */}
      {printJob && (
        <OfficialBillPrintPortal
          orders={printJob.orders}
          growerProfile={growerProfile}
          settings={billSettings}
          isPrinterTest={printJob.isPrinterTest}
          onReadyChange={setPortalQrReady}
        />
      )}

      {/* Official Delivery Bill Preview Modal */}
      <OfficialBillPreviewModal
        order={previewBillTarget?.order ?? null}
        growerProfile={growerProfile}
        settings={billSettings}
        isPrinterTest={previewBillTarget?.isPrinterTest}
        onUpdateSettings={updateBillSettings}
        onPrintNow={(targetOrder, isTest) => triggerOfficialBillPrint([targetOrder], Boolean(isTest))}
        onClose={() => setPreviewBillTarget(null)}
      />

      {/* Pickup Verification Single-Use QR Modal */}
      <QrGeneratorModal
        open={Boolean(pickupQrOrder)}
        title={pickupQrOrder ? `Pickup Verification QR — ${pickupQrOrder.orderCode}` : 'Pickup QR'}
        subtitle="Single-use token scanned by Delivery Partner at pickup"
        requestPayload={
          pickupQrOrder
            ? {
                type: 'pickup',
                orderId: pickupQrOrder.parentOrderId,
                sellerOrderId: pickupQrOrder.id,
                orderCode: pickupQrOrder.orderCode,
                handoverPin: pickupQrOrder.handoverPin,
              }
            : null
        }
        onClose={() => setPickupQrOrder(null)}
      />

      {/* Reject Reason Modal */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form onSubmit={handleRejectSubmit} className="bg-white rounded-2xl p-5 max-w-sm w-full space-y-3 shadow-xl">
            <h3 className="text-sm font-extrabold text-primary">Reject Order {rejectTarget.orderCode}</h3>
            <p className="text-xs text-on-surface-variant">A reason is required and shared with the customer.</p>
            <textarea
              required
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g., Morning harvest damaged by rain"
              className="w-full p-3 rounded-xl border border-outline-variant text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                className="px-3.5 py-2 rounded-xl bg-surface-container text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-red-700 text-white text-xs font-bold cursor-pointer">
                Confirm Reject
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// 5. Grower Settlement & Payable Ledger (100% Real Firestore Settlements)
// ---------------------------------------------------------------------------
interface EarningsLedgerProps {
  ledger: LedgerEntry[];
  onReconcilePayable: (entry: LedgerEntry) => Promise<void>;
  onNotify: (msg: string) => void;
}

export const EarningsLedgerScreen: React.FC<EarningsLedgerProps> = ({
  ledger,
  onReconcilePayable,
  onNotify,
}) => {
  const payableTotal = ledger.filter((l) => l.status !== 'settled').reduce((s, l) => s + l.net, 0);
  const settledTotal = ledger.filter((l) => l.status === 'settled').reduce((s, l) => s + l.net, 0);

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4 pb-10">
      <div className="grid grid-cols-2 gap-3 tabular-nums">
        <div className="bg-primary text-on-primary rounded-2xl p-5 shadow-md">
          <span className="text-xs text-white/80 font-semibold">Payable Balance (90% Share)</span>
          <p className="text-2xl font-extrabold mt-1">₹{payableTotal.toFixed(2)}</p>
        </div>
        <div className="bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-outline-variant/20">
          <span className="text-xs text-on-surface-variant font-semibold">Reconciled / Settled</span>
          <p className="text-2xl font-extrabold text-secondary mt-1">₹{settledTotal.toFixed(2)}</p>
        </div>
      </div>

      {/* Honest Marketplace Settlement Disclosure */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-950">
        <strong>Settlement Policy Notice:</strong> Under standard merchant accounts, automatic split-payout escrow is not assumed. Verified deliveries record exact grower payable allocations here for authorized bank/UPI settlement reconciliation.
      </div>

      {ledger.length === 0 ? (
        <div className="bg-surface-container-lowest rounded-2xl p-8 text-center border border-outline-variant/20 space-y-1.5">
          <span className="material-symbols-outlined text-4xl text-outline">account_balance_wallet</span>
          <p className="text-sm font-bold text-primary">No settlement entries yet</p>
          <p className="text-xs text-on-surface-variant">
            Once a Delivery Partner completes QR-verified delivery for your order, your 90% payable allocation is logged here automatically.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {ledger.map((entry) => (
            <div
              key={entry.id}
              className="bg-surface-container-lowest rounded-xl p-4 shadow-sm border border-outline-variant/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 tabular-nums"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-extrabold text-primary">{entry.orderCode}</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      entry.status === 'settled'
                        ? 'bg-emerald-100 text-emerald-900'
                        : 'bg-amber-100 text-amber-900'
                    }`}
                  >
                    {entry.status}
                  </span>
                </div>
                <p className="text-xs text-on-surface mt-0.5">{entry.summary}</p>
                <p className="text-[11px] text-on-surface-variant">
                  Gross ₹{entry.gross} · Fee ₹{entry.fee} · {entry.refNote}
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <span className="text-base font-extrabold text-primary">₹{entry.net}</span>
                {entry.status !== 'settled' && (
                  <button
                    type="button"
                    onClick={async () => {
                      await onReconcilePayable(entry);
                      onNotify(`Marked ${entry.orderCode} settlement reconciled`);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-bold cursor-pointer"
                  >
                    Mark Reconciled
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// 6. Grower Profile, Live Photo Verification & Full Seller KYC (Firestore grower_profiles/{uid})
// ---------------------------------------------------------------------------
interface GrowerComplianceProps {
  profile: GrowerProfileDoc | null;
  defaultGrowerName: string;
  onSaveProfile: (profile: Omit<GrowerProfileDoc, 'ownerId'>) => Promise<void>;
  onComplete: () => void;
  onNotify: (msg: string) => void;
}

export const GrowerComplianceScreen: React.FC<GrowerComplianceProps> = ({
  profile,
  defaultGrowerName,
  onSaveProfile,
  onComplete,
  onNotify,
}) => {
  const [farmName, setFarmName] = useState(profile?.farmName || '');
  const [growerName, setGrowerName] = useState(profile?.growerName || defaultGrowerName || '');
  const [farmType, setFarmType] = useState(profile?.farmType || 'Terrace Garden');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [govIdType, setGovIdType] = useState<'aadhaar' | 'pan' | 'voter_id'>(
    profile?.govIdType || 'aadhaar'
  );
  const [govIdLast4, setGovIdLast4] = useState(profile?.govIdLast4 || '');
  const [liveSelfieData, setLiveSelfieData] = useState(profile?.liveSelfieData || '');
  const [farmPhotoData, setFarmPhotoData] = useState(profile?.farmPhotoData || '');
  const [livePhotoCapturedAt, setLivePhotoCapturedAt] = useState(profile?.livePhotoCapturedAt || '');
  const [livenessConfirmed, setLivenessConfirmed] = useState(Boolean(profile?.livenessConfirmed));
  const [chemicalFree, setChemicalFree] = useState(profile?.chemicalFree ?? true);
  const [loc, setLoc] = useState<LocationPickerResult>({
    address: profile?.areaName || 'Indiranagar, Bengaluru',
    lat: profile?.lat ?? 12.9784,
    lng: profile?.lng ?? 77.6408,
    serviceability: null,
  });
  const [saving, setSaving] = useState(false);

  const checklist = [
    { label: 'Farm & Grower Identity', ok: farmName.trim().length >= 2 && growerName.trim().length >= 2 },
    { label: 'Mobile Phone & Gov ID (Last 4)', ok: phone.trim().length >= 8 && govIdLast4.trim().length >= 4 },
    { label: 'Live Person Selfie Captured', ok: liveSelfieData.startsWith('data:image/') },
    { label: 'Live Terrace / Farm Proof Photo', ok: farmPhotoData.startsWith('data:image/') },
    { label: 'Liveness & Authentic Seller Pledge', ok: livenessConfirmed },
    { label: 'Pickup Farm GPS Location Set', ok: loc.address.trim().length >= 3 },
  ];
  const allVerified = checklist.every((c) => c.ok);
  const completedChecks = checklist.filter((c) => c.ok).length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!farmName.trim() || !growerName.trim()) {
      onNotify('Enter your farm name and full grower name.');
      return;
    }
    if (phone.trim().length < 8) {
      onNotify('Enter a valid contact mobile number for EV pickup coordination.');
      return;
    }
    if (govIdLast4.trim().length < 4) {
      onNotify('Enter the last 4 characters of your Government ID for KYC verification.');
      return;
    }
    if (!liveSelfieData.startsWith('data:image/')) {
      onNotify('Live person selfie capture via camera is required for Seller verification.');
      return;
    }
    if (!farmPhotoData.startsWith('data:image/')) {
      onNotify('Live terrace or farm proof photo via camera is required for Seller verification.');
      return;
    }
    if (!livenessConfirmed) {
      onNotify('Please confirm the live identity & authentic produce declaration.');
      return;
    }

    setSaving(true);
    try {
      await onSaveProfile({
        farmName: farmName.trim(),
        growerName: growerName.trim(),
        farmType,
        areaName: loc.address,
        lat: loc.lat,
        lng: loc.lng,
        phone: phone.trim(),
        govIdType,
        govIdLast4: govIdLast4.trim().toUpperCase().slice(-4),
        liveSelfieData,
        farmPhotoData,
        livePhotoCapturedAt: livePhotoCapturedAt || new Date().toISOString(),
        livenessConfirmed: true,
        verificationStatus: 'verified',
        chemicalFree,
      });
      onComplete();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto flex flex-col gap-4 pb-10">
      {/* Verification Progress Banner */}
      <div className="rounded-2xl bg-gradient-to-br from-primary to-primary-container text-on-primary p-5 shadow-md space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/15 text-[11px] font-bold">
              <span className="material-symbols-outlined text-[14px]">verified_user</span>
              Full Seller KYC &amp; Live Photo Verification
            </span>
            <h2 className="text-lg font-extrabold mt-1.5">Grower Identity, Live Camera &amp; Farm Verification</h2>
            <p className="text-xs text-white/85 mt-0.5">
              Real-time live camera selfie and terrace/farm proof protect neighborhood buyers and verify every seller account on Zenvego.
            </p>
          </div>
          <span className="px-3 py-1 rounded-full bg-secondary-container text-on-secondary-container text-xs font-extrabold shrink-0 tabular-nums">
            {completedChecks}/{checklist.length} Done
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {checklist.map((item) => (
            <div
              key={item.label}
              className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1.5 ${
                item.ok ? 'bg-emerald-500/25 text-emerald-100' : 'bg-white/10 text-white/75'
              }`}
            >
              <span className="material-symbols-outlined text-[15px] shrink-0">
                {item.ok ? 'check_circle' : 'radio_button_unchecked'}
              </span>
              <span className="truncate">{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Step 1: Grower & Government ID Details */}
      <div className="bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-outline-variant/20 space-y-4">
        <div>
          <h3 className="text-sm font-extrabold text-primary">1. Grower Identity, Contact &amp; Government ID</h3>
          <p className="text-xs text-on-surface-variant">
            Only the last 4 characters of your Government ID are stored in Firestore for privacy.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-on-surface mb-1">Farm / Terrace Name *</label>
            <input
              type="text"
              required
              value={farmName}
              onChange={(e) => setFarmName(e.target.value)}
              placeholder="e.g., Green Roof Terrace Farm"
              className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface mb-1">Full Grower / Farmer Name *</label>
            <input
              type="text"
              required
              value={growerName}
              onChange={(e) => setGrowerName(e.target.value)}
              placeholder="Name matching Government ID"
              className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface mb-1">Mobile Phone Number *</label>
            <input
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98765 43210"
              className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface mb-1">Growing Setup</label>
            <select
              value={farmType}
              onChange={(e) => setFarmType(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant text-sm bg-white"
            >
              <option value="Terrace Garden">Terrace Garden</option>
              <option value="Rooftop Polyhouse">Rooftop Polyhouse</option>
              <option value="Balcony Micro-Farm">Balcony Micro-Farm</option>
              <option value="Small / Marginal Farm">Small / Marginal Farm</option>
              <option value="Women-Led Agri Group">Women-Led Agri Group</option>
              <option value="Community Garden">Community Garden</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface mb-1">Government ID Type *</label>
            <select
              value={govIdType}
              onChange={(e) =>
                setGovIdType(e.target.value as 'aadhaar' | 'pan' | 'voter_id')
              }
              className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant text-sm bg-white"
            >
              <option value="aadhaar">Aadhaar Card</option>
              <option value="pan">PAN Card</option>
              <option value="voter_id">Voter ID</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface mb-1">Gov ID Last 4 Characters *</label>
            <input
              type="text"
              required
              maxLength={4}
              value={govIdLast4}
              onChange={(e) => setGovIdLast4(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 4))}
              placeholder="e.g., 4821"
              className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant text-sm font-mono uppercase tracking-widest"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
          <input type="checkbox" checked={chemicalFree} onChange={(e) => setChemicalFree(e.target.checked)} />
          Certified / Practice Chemical-Free Cultivation
        </label>
      </div>

      {/* Step 2: Mandatory Live Camera Photo Verification */}
      <div className="bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-outline-variant/20 space-y-4">
        <div>
          <h3 className="text-sm font-extrabold text-primary">2. Real-Time Live Camera Photo Verification</h3>
          <p className="text-xs text-on-surface-variant">
            Gallery uploads are disabled for verification. Capture authentic live photos using your device camera — each photo is automatically stamped with the live UTC/local verification timestamp.
          </p>
        </div>

        <LiveCameraCapture
          title="Live Person Selfie Verification"
          subtitle="Look directly into the front camera in good lighting so buyers know their local grower."
          mode="selfie"
          value={liveSelfieData}
          capturedAt={livePhotoCapturedAt}
          required
          onCapture={(dataUrl, iso) => {
            setLiveSelfieData(dataUrl);
            setLivePhotoCapturedAt(iso);
            onNotify('Live seller selfie captured & stamped');
          }}
          onClear={() => setLiveSelfieData('')}
        />

        <LiveCameraCapture
          title="Live Terrace / Farm Proof Photo"
          subtitle="Point your camera at your live terrace beds, polyhouse, or harvest space."
          mode="document"
          value={farmPhotoData}
          capturedAt={livePhotoCapturedAt}
          required
          onCapture={(dataUrl, iso) => {
            setFarmPhotoData(dataUrl);
            if (!livePhotoCapturedAt) setLivePhotoCapturedAt(iso);
            onNotify('Live terrace/farm proof photo captured');
          }}
          onClear={() => setFarmPhotoData('')}
        />

        <label className="flex items-start gap-2.5 p-3.5 rounded-xl bg-surface-container-low border border-outline-variant/25 text-xs text-on-surface cursor-pointer">
          <input
            type="checkbox"
            checked={livenessConfirmed}
            onChange={(e) => setLivenessConfirmed(e.target.checked)}
            className="mt-0.5 shrink-0"
          />
          <span>
            <strong>Live Identity &amp; Harvest Declaration:</strong> I confirm that the live selfie and farm proof photo were captured in real time by me, match my Government ID ({govIdType === 'aadhaar' ? 'Aadhaar' : govIdType === 'pan' ? 'PAN' : 'Voter ID'} ending in {govIdLast4 || '____'}), and all listed produce is freshly harvested from my verified local growing space.
          </span>
        </label>
      </div>

      {/* Step 3: Pickup Location */}
      <div className="bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-outline-variant/20 space-y-4">
        <div>
          <h3 className="text-sm font-extrabold text-primary">3. Verified Pickup Farm Location (OpenStreetMap)</h3>
          <p className="text-xs text-on-surface-variant">
            Used by EV delivery partners for hyperlocal pickup routing and 10 km customer serviceability.
          </p>
        </div>

        <LocationPickerMap
          initialLat={loc.lat}
          initialLng={loc.lng}
          initialAddress={loc.address}
          onLocationChange={setLoc}
        />

        <button
          type="submit"
          disabled={saving || !allVerified}
          className="w-full h-12 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-sm font-bold shadow-md cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined text-[19px]">verified_user</span>
          <span>
            {saving
              ? 'Verifying & Saving Seller KYC...'
              : allVerified
                ? 'Complete Full Seller Verification & Publish Storefront'
                : `Complete All ${checklist.length} Verification Steps (${completedChecks}/${checklist.length})`}
          </span>
        </button>
      </div>
    </form>
  );
};
