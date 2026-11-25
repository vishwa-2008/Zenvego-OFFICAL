import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckoutValidationResponse, zenvegoApi } from '../lib/apiClient';
import { downloadTextFile } from '../data/mockData';
import {
  ActiveOrder,
  CartItem,
  DeliveryAssignmentDoc,
  GrowerListing,
  GrowerProfileDoc,
  OrderTrackingCurrentDoc,
  OrderTrackingEventDoc,
  ProduceCategory,
  SavedAddress,
  ScreenId,
} from '../types';
import { subscribeOrderTrackingCurrent, subscribeOrderTrackingEvents } from '../lib/firestoreService';
import type { SocketDeliveryStage } from '../lib/trackingSocket';
import { getUpiPaymentQrUrl } from '../utils/qrGenerator';
import { isValidCoord } from '../lib/geo';
import { LiveTrackingMap, LocationPickerMap, LocationPickerResult } from './MapLibreWidgets';
import { QrGeneratorModal } from './QrWidgets';
import { SmartImage } from './ZenvegoLogo';

const CATEGORIES: ('All' | ProduceCategory)[] = [
  'All',
  'Leafy Greens',
  'Vegetables',
  'Heirloom',
  'Fruits',
  'Microgreens',
  'Herbs',
];

// ---------------------------------------------------------------------------
// 1. Marketplace Produce Explorer (Real Firestore Catalog + Product QR)
// ---------------------------------------------------------------------------
interface CategoryExplorerProps {
  listings: GrowerListing[];
  cart: CartItem[];
  farmFilter: string | null;
  highlightedProductId?: string | null;
  onClearFarmFilter: () => void;
  onUpdateCart: (listingId: string, delta: number) => void;
  onOpenProductCheckout?: (product: GrowerListing) => void;
  onNavigate: (screen: ScreenId) => void;
  onNotify: (msg: string) => void;
}

export const CategoryExplorerScreen: React.FC<CategoryExplorerProps> = ({
  listings,
  cart,
  farmFilter,
  highlightedProductId,
  onClearFarmFilter,
  onUpdateCart,
  onOpenProductCheckout,
  onNavigate,
  onNotify,
}) => {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'All' | ProduceCategory>('All');
  const [within5Km, setWithin5Km] = useState(false);
  const [harvestedToday, setHarvestedToday] = useState(false);
  const [chemicalFree, setChemicalFree] = useState(false);
  const [sortBy, setSortBy] = useState<'nearest' | 'price-low' | 'price-high'>('nearest');
  const [qrProduct, setQrProduct] = useState<GrowerListing | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return listings
      .filter((item) => item.available && item.stock > 0)
      .filter((item) => {
        if (highlightedProductId && item.id === highlightedProductId) return true;
        if (farmFilter && item.farmName !== farmFilter && item.growerId !== farmFilter) return false;
        if (selectedCategory !== 'All' && item.category !== selectedCategory) return false;
        if (within5Km && item.distanceKm > 5) return false;
        if (harvestedToday && !item.harvestedToday) return false;
        if (chemicalFree && !item.chemicalFree) return false;
        if (
          q &&
          !item.name.toLowerCase().includes(q) &&
          !item.farmName.toLowerCase().includes(q) &&
          !item.variety.toLowerCase().includes(q)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (highlightedProductId) {
          if (a.id === highlightedProductId) return -1;
          if (b.id === highlightedProductId) return 1;
        }
        if (sortBy === 'price-low') return a.price - b.price;
        if (sortBy === 'price-high') return b.price - a.price;
        return a.distanceKm - b.distanceKm;
      });
  }, [listings, farmFilter, highlightedProductId, selectedCategory, within5Km, harvestedToday, chemicalFree, search, sortBy]);

  const cartSummary = useMemo(() => {
    let count = 0;
    let total = 0;
    for (const c of cart) {
      const item = listings.find((l) => l.id === c.listingId);
      if (item) {
        count += c.quantity;
        total += c.quantity * item.price;
      }
    }
    return { count, total };
  }, [cart, listings]);

  const getQty = (id: string) => cart.find((c) => c.listingId === id)?.quantity ?? 0;

  return (
    <div className="flex flex-col w-full gap-4 pb-24">
      {/* Search + Sort Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
        <div className="relative flex-1 flex items-center bg-surface-container-lowest rounded-full shadow-sm px-4 h-12 border border-outline-variant/20">
          <span className="material-symbols-outlined text-on-surface-variant text-[20px] mr-2">search</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search fresh greens, vegetables, growers..."
            className="w-full bg-transparent text-sm text-on-surface placeholder:text-outline focus:outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="text-on-surface-variant hover:text-primary cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          )}
        </div>

        <select
          aria-label="Sort produce"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'nearest' | 'price-low' | 'price-high')}
          className="h-12 px-4 rounded-full bg-surface-container-lowest border border-outline-variant/20 text-xs font-bold text-primary shadow-sm outline-none cursor-pointer"
        >
          <option value="nearest">Sort: Nearest First</option>
          <option value="price-low">Sort: Price Low → High</option>
          <option value="price-high">Sort: Price High → Low</option>
        </select>
      </div>

      {/* Category Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
        {CATEGORIES.map((cat) => {
          const active = selectedCategory === cat;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`px-3.5 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                active
                  ? 'bg-primary text-on-primary shadow-xs'
                  : 'bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low'
              }`}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {/* Filter Toggles + Active Farm Filter */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setWithin5Km((v) => !v)}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors cursor-pointer ${
            within5Km
              ? 'bg-secondary-container text-on-secondary-container border-secondary/30'
              : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant/30'
          }`}
        >
          Within 5 km
        </button>
        <button
          type="button"
          onClick={() => setHarvestedToday((v) => !v)}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors cursor-pointer ${
            harvestedToday
              ? 'bg-secondary-container text-on-secondary-container border-secondary/30'
              : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant/30'
          }`}
        >
          Harvested Today
        </button>
        <button
          type="button"
          onClick={() => setChemicalFree((v) => !v)}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors cursor-pointer ${
            chemicalFree
              ? 'bg-secondary-container text-on-secondary-container border-secondary/30'
              : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant/30'
          }`}
        >
          Chemical-Free
        </button>

        {farmFilter && (
          <button
            type="button"
            onClick={onClearFarmFilter}
            className="px-3 py-1.5 rounded-full text-xs font-bold bg-primary text-on-primary flex items-center gap-1 cursor-pointer"
          >
            <span>Grower Filter Active</span>
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        )}
      </div>

      {/* Real Firestore Product Grid */}
      {filtered.length === 0 ? (
        <div className="bg-surface-container-lowest rounded-2xl p-8 text-center border border-outline-variant/25 space-y-3">
          <span className="material-symbols-outlined text-4xl text-primary/60">eco</span>
          <h3 className="text-base font-extrabold text-primary">
            {listings.length === 0 ? 'No harvests published in your area yet' : 'No produce matches your filters'}
          </h3>
          <p className="text-xs text-on-surface-variant max-w-md mx-auto">
            {listings.length === 0
              ? 'This marketplace displays live harvests published by verified local growers in Cloud Firestore. Check back shortly or explore nearby growers.'
              : 'Try clearing category or distance filters to see all available local produce.'}
          </p>
          {listings.length === 0 ? (
            <button
              type="button"
              onClick={() => onNavigate('buyer-growers')}
              className="px-5 py-2.5 rounded-xl bg-primary text-on-primary text-xs font-bold cursor-pointer"
            >
              Browse Registered Growers
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setSelectedCategory('All');
                setSearch('');
                setWithin5Km(false);
                setHarvestedToday(false);
                setChemicalFree(false);
                onClearFarmFilter();
              }}
              className="px-4 py-2 rounded-xl bg-surface-container text-primary text-xs font-bold cursor-pointer"
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((item) => {
            const qty = getQty(item.id);
            const isHighlighted = highlightedProductId === item.id;
            return (
              <article
                key={item.id}
                className={`bg-surface-container-lowest rounded-2xl overflow-hidden shadow-sm border flex flex-col ${
                  isHighlighted ? 'border-primary ring-2 ring-primary/30' : 'border-outline-variant/20'
                }`}
              >
                <div className="relative h-44 bg-surface-container">
                  <SmartImage src={item.image} alt={item.name} className="w-full h-full object-cover" />
                  <div className="absolute top-2.5 left-2.5 flex flex-wrap gap-1.5">
                    {item.chemicalFree && (
                      <span className="px-2 py-0.5 rounded-full bg-surface-container-lowest/95 text-primary text-[10px] font-bold shadow-xs">
                        Chemical-Free
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded-full bg-primary/90 text-on-primary text-[10px] font-bold">
                      {item.stock} {item.unitShort} left
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setQrProduct(item)}
                    title="Product QR Code"
                    className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-white/95 text-primary flex items-center justify-center shadow-xs hover:bg-white cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[18px]">qr_code_2</span>
                  </button>
                </div>

                <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-[15px] font-extrabold text-on-surface leading-snug">{item.name}</h3>
                      <span className="text-[11px] font-bold text-secondary shrink-0">{item.distanceKm} km</span>
                    </div>
                    <p className="text-xs text-on-surface-variant mt-0.5">
                      {item.farmName} · {item.variety}
                    </p>
                    <p className="text-[11px] text-secondary font-semibold mt-1">{item.harvestedAt}</p>
                    {item.growerNote && (
                      <p className="text-[11px] text-on-surface-variant mt-1 line-clamp-2">{item.growerNote}</p>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-outline-variant/15">
                    <div className="tabular-nums">
                      <span className="text-base font-extrabold text-primary">₹{item.price}</span>
                      <span className="text-xs text-on-surface-variant"> / {item.unit}</span>
                    </div>

                    {qty === 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          onUpdateCart(item.id, 1);
                          onNotify(`Added ${item.name} to basket`);
                        }}
                        className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-xs font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[16px]">add</span>
                        Add
                      </button>
                    ) : (
                      <div className="flex items-center gap-2 bg-primary text-on-primary rounded-xl px-2 py-1 tabular-nums">
                        <button
                          type="button"
                          onClick={() => onUpdateCart(item.id, -1)}
                          className="w-6 h-6 flex items-center justify-center font-bold cursor-pointer"
                        >
                          −
                        </button>
                        <span className="text-xs font-extrabold min-w-[16px] text-center">{qty}</span>
                        <button
                          type="button"
                          onClick={() => {
                            if (qty >= item.stock) {
                              onNotify(`Only ${item.stock} available in stock`);
                              return;
                            }
                            onUpdateCart(item.id, 1);
                          }}
                          className="w-6 h-6 flex items-center justify-center font-bold cursor-pointer"
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Floating Cart Summary Bar */}
      {cartSummary.count > 0 && (
        <div className="fixed bottom-16 lg:bottom-6 left-4 right-4 lg:left-[284px] lg:right-6 z-30 max-w-2xl mx-auto">
          <button
            type="button"
            onClick={() => onNavigate('buyer-cart')}
            className="w-full bg-primary text-on-primary rounded-2xl px-4 py-3.5 shadow-xl flex items-center justify-between cursor-pointer hover:bg-primary-container transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="px-2.5 py-1 rounded-lg bg-white/15 text-xs font-extrabold tabular-nums">
                {cartSummary.count} {cartSummary.count === 1 ? 'item' : 'items'}
              </span>
              <span className="text-sm font-extrabold tabular-nums">₹{cartSummary.total}</span>
            </div>
            <div className="flex items-center gap-1 text-xs font-bold">
              <span>View Harvest Basket</span>
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </div>
          </button>
        </div>
      )}

      <QrGeneratorModal
        open={Boolean(qrProduct)}
        title={qrProduct ? `Checkout QR — ${qrProduct.name}` : 'Checkout QR'}
        subtitle={qrProduct ? `${qrProduct.farmName} · ₹${qrProduct.price}/${qrProduct.unit}` : undefined}
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
        onPreviewCheckout={
          qrProduct && onOpenProductCheckout ? () => onOpenProductCheckout(qrProduct) : undefined
        }
        onClose={() => setQrProduct(null)}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// 2. Nearby Growers Directory (Real Firestore grower_profiles + Storefront QR + Favorites)
// ---------------------------------------------------------------------------
interface NearbyGrowersScreenProps {
  growers: GrowerProfileDoc[];
  favoriteGrowerIds?: string[];
  onToggleFavoriteGrower?: (growerId: string) => void;
  onSelectFarm: (farmNameOrId: string) => void;
  onNavigate: (screen: ScreenId) => void;
}

export const NearbyGrowersScreen: React.FC<NearbyGrowersScreenProps> = ({
  growers,
  favoriteGrowerIds = [],
  onToggleFavoriteGrower,
  onSelectFarm,
  onNavigate,
}) => {
  const [qrGrower, setQrGrower] = useState<GrowerProfileDoc | null>(null);

  return (
    <div className="flex flex-col w-full gap-4 pb-10">
      <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-3 border border-outline-variant/20">
        <div>
          <h2 className="text-lg font-extrabold text-primary">Registered Neighborhood Growers</h2>
          <p className="text-xs text-on-surface-variant mt-0.5">
            {growers.length} registered local farm{growers.length === 1 ? '' : 's'} connected to Cloud Firestore
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('buyer-location')}
          className="px-3.5 py-2 rounded-xl bg-secondary-container text-on-secondary-container text-xs font-bold flex items-center gap-1.5 cursor-pointer"
        >
          <span className="material-symbols-outlined text-[16px]">my_location</span>
          Delivery Zone Map
        </button>
      </div>

      {growers.length === 0 ? (
        <div className="bg-surface-container-lowest rounded-2xl p-8 text-center border border-outline-variant/20 space-y-2">
          <span className="material-symbols-outlined text-4xl text-outline">potted_plant</span>
          <p className="text-sm font-bold text-primary">No growers registered yet</p>
          <p className="text-xs text-on-surface-variant">
            Verified neighborhood growers appear here automatically once they complete live photo verification in the Grower Portal.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {growers.map((g) => {
            const isFav = favoriteGrowerIds.includes(g.ownerId);
            return (
              <article
                key={g.ownerId}
                className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/20 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-3 min-w-0">
                    {g.liveSelfieData ? (
                      <img
                        src={g.liveSelfieData}
                        alt={g.growerName}
                        className="w-12 h-12 rounded-xl object-cover border border-emerald-600/30 shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-surface-container text-primary flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-[22px]">potted_plant</span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h3 className="text-[15px] font-extrabold text-primary truncate">{g.farmName}</h3>
                        {g.verificationStatus === 'verified' && (
                          <span className="material-symbols-outlined material-symbols-filled text-secondary text-[17px]">
                            verified
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        {g.growerName} · {g.farmType}
                      </p>
                      <p className="text-xs text-on-surface-variant mt-0.5 truncate">{g.areaName}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {onToggleFavoriteGrower && (
                      <button
                        type="button"
                        onClick={() => onToggleFavoriteGrower(g.ownerId)}
                        title={isFav ? 'Remove from Favourite Farms' : 'Save to Favourite Farms'}
                        className={`w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer transition-colors ${
                          isFav
                            ? 'bg-red-50 text-red-600'
                            : 'bg-surface-container-low text-on-surface-variant hover:text-primary'
                        }`}
                      >
                        <span
                          className={`material-symbols-outlined text-[20px] ${
                            isFav ? 'material-symbols-filled' : ''
                          }`}
                        >
                          favorite
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setQrGrower(g)}
                      title="Storefront Marketing QR"
                      className="w-9 h-9 rounded-xl bg-surface-container-low text-primary flex items-center justify-center hover:bg-surface-container cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[20px]">qr_code_2</span>
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-outline-variant/15 flex-wrap">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] font-bold text-secondary bg-surface-container-low px-2.5 py-0.5 rounded-full">
                      {g.chemicalFree ? 'Chemical-Free' : g.verificationStatus}
                    </span>
                    {g.liveSelfieData && (
                      <span className="text-[10px] font-extrabold text-emerald-900 bg-emerald-100 px-2 py-0.5 rounded-full">
                        Live Photo Verified
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelectFarm(g.farmName)}
                    className="text-xs font-bold text-primary hover:underline cursor-pointer"
                  >
                    Browse Produce →
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <QrGeneratorModal
        open={Boolean(qrGrower)}
        title={qrGrower ? `Storefront QR — ${qrGrower.farmName}` : 'Storefront QR'}
        subtitle={qrGrower ? `${qrGrower.growerName} · ${qrGrower.areaName}` : undefined}
        requestPayload={
          qrGrower
            ? {
                type: 'store',
                growerId: qrGrower.ownerId,
                farmName: qrGrower.farmName,
                areaName: qrGrower.areaName,
              }
            : null
        }
        onClose={() => setQrGrower(null)}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// 3. Multi-Grower Cart Review Screen
// ---------------------------------------------------------------------------
interface CartReviewScreenProps {
  listings: GrowerListing[];
  cart: CartItem[];
  deliveryAddress: string;
  onUpdateCart: (listingId: string, delta: number) => void;
  onNavigate: (screen: ScreenId) => void;
}

export const CartReviewScreen: React.FC<CartReviewScreenProps> = ({
  listings,
  cart,
  deliveryAddress,
  onUpdateCart,
  onNavigate,
}) => {
  const grouped = useMemo(() => {
    const map = new Map<string, { item: GrowerListing; quantity: number }[]>();
    for (const c of cart) {
      const item = listings.find((l) => l.id === c.listingId);
      if (!item) continue;
      const existing = map.get(item.farmName) ?? [];
      existing.push({ item, quantity: c.quantity });
      map.set(item.farmName, existing);
    }
    return Array.from(map.entries());
  }, [cart, listings]);

  const itemsTotal = useMemo(
    () =>
      grouped.reduce(
        (sum, [, rows]) => sum + rows.reduce((s, r) => s + r.item.price * r.quantity, 0),
        0
      ),
    [grouped]
  );

  const estDeliveryFee = itemsTotal === 0 ? 0 : itemsTotal >= 499 ? 0 : 15 + Math.max(0, grouped.length - 1) * 5;

  if (grouped.length === 0) {
    return (
      <div className="max-w-lg mx-auto bg-surface-container-lowest rounded-2xl p-8 text-center shadow-sm space-y-3 border border-outline-variant/20">
        <span className="material-symbols-outlined text-4xl text-outline">shopping_basket</span>
        <h2 className="text-lg font-extrabold text-primary">Your Harvest Basket is Empty</h2>
        <p className="text-xs text-on-surface-variant">
          Add fresh harvests from one or multiple local growers. Zenvego automatically splits fulfilment per grower.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('buyer-explore')}
          className="px-5 py-2.5 rounded-xl bg-primary text-on-primary text-xs font-bold cursor-pointer"
        >
          Explore Local Produce
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4 pb-10">
      {/* Delivery Address Strip */}
      <div className="bg-surface-container-lowest rounded-xl p-4 shadow-sm border border-outline-variant/20 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-[11px] font-bold uppercase text-secondary block">Delivering To</span>
          <p className="text-sm font-bold text-on-surface truncate">{deliveryAddress}</p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('buyer-location')}
          className="px-3 py-1.5 rounded-lg bg-surface-container text-primary text-xs font-bold shrink-0 cursor-pointer"
        >
          Change
        </button>
      </div>

      {/* Multi-Grower Grouped Items */}
      {grouped.map(([farmName, rows]) => (
        <section
          key={farmName}
          className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/20 space-y-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary text-[18px]">agriculture</span>
              <h3 className="text-sm font-extrabold text-primary">{farmName}</h3>
            </div>
            <span className="text-[11px] font-semibold text-on-surface-variant">
              Independent seller fulfilment
            </span>
          </div>

          <div className="divide-y divide-outline-variant/15">
            {rows.map(({ item, quantity }) => (
              <div key={item.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <SmartImage src={item.image} alt={item.name} className="w-12 h-12 rounded-xl object-cover shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-on-surface truncate">{item.name}</p>
                    <p className="text-xs text-on-surface-variant">
                      ₹{item.price} / {item.unit} · {item.stock} in stock
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="flex items-center gap-2 bg-surface-container rounded-lg px-2 py-1 tabular-nums">
                    <button
                      type="button"
                      onClick={() => onUpdateCart(item.id, -1)}
                      className="w-6 h-6 font-bold text-primary cursor-pointer"
                    >
                      −
                    </button>
                    <span className="text-xs font-extrabold">{quantity}</span>
                    <button
                      type="button"
                      disabled={quantity >= item.stock}
                      onClick={() => onUpdateCart(item.id, 1)}
                      className="w-6 h-6 font-bold text-primary disabled:opacity-30 cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                  <span className="text-sm font-extrabold text-primary w-14 text-right tabular-nums">
                    ₹{item.price * quantity}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {/* Bill Estimate */}
      <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/20 space-y-2 text-sm tabular-nums">
        <div className="flex justify-between text-on-surface-variant">
          <span>Items Subtotal ({grouped.length} grower{grouped.length === 1 ? '' : 's'})</span>
          <span className="font-semibold text-on-surface">₹{itemsTotal}</span>
        </div>
        <div className="flex justify-between text-on-surface-variant">
          <span>Estimated EV Delivery {itemsTotal >= 499 ? '(Free above ₹499)' : ''}</span>
          <span className="font-semibold text-on-surface">₹{estDeliveryFee}</span>
        </div>
        <div className="border-t border-outline-variant/25 pt-2 flex justify-between font-extrabold text-primary text-base">
          <span>Estimated Total</span>
          <span>₹{itemsTotal + estDeliveryFee}</span>
        </div>
        <p className="text-[11px] text-on-surface-variant">
          Final prices, seller splits, and stock availability are validated server-side before order placement.
        </p>
      </div>

      <button
        type="button"
        onClick={() => onNavigate('buyer-payment')}
        className="w-full h-13 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-sm font-bold flex items-center justify-center gap-2 shadow-md cursor-pointer"
      >
        <span>Proceed to Verified Checkout</span>
        <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// 4. Interactive Google Maps Location & Serviceability Screen
// ---------------------------------------------------------------------------
interface LocationDetectorProps {
  addresses: SavedAddress[];
  selectedAddressId: string;
  onSelectAddress: (id: string) => void;
  onAddAddress: (payload: {
    label: string;
    formattedAddress: string;
    lat: number;
    lng: number;
    serviceable: boolean;
  }) => Promise<void>;
  onDeleteAddress?: (id: string) => Promise<void>;
  onConfirm: (payload: { address: string; lat: number; lng: number }) => void;
}

export const LocationDetectorScreen: React.FC<LocationDetectorProps> = ({
  addresses,
  selectedAddressId,
  onSelectAddress,
  onAddAddress,
  onDeleteAddress,
  onConfirm,
}) => {
  const activeAddr = addresses.find((a) => a.id === selectedAddressId) ?? addresses[0];
  const [picked, setPicked] = useState<LocationPickerResult>({
    address: activeAddr?.address || 'Indiranagar, Bengaluru',
    lat: activeAddr?.lat || 12.9784,
    lng: activeAddr?.lng || 77.6408,
    serviceability: null,
  });
  const [label, setLabel] = useState('Home');
  const [saving, setSaving] = useState(false);

  const handleSaveAndConfirm = async () => {
    setSaving(true);
    try {
      await onAddAddress({
        label: label.trim() || 'Home',
        formattedAddress: picked.address,
        lat: picked.lat,
        lng: picked.lng,
        serviceable: picked.serviceability ? picked.serviceability.serviceable : true,
      });
      onConfirm({ address: picked.address, lat: picked.lat, lng: picked.lng });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col w-full gap-4 pb-10 max-w-2xl mx-auto">
      <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/20 space-y-3">
        <div>
          <h2 className="text-base font-extrabold text-primary">Pin Your Delivery Location</h2>
          <p className="text-xs text-on-surface-variant">
            Search OpenStreetMap addresses, use browser GPS, or drag the pin to check hyperlocal 10 km serviceability.
          </p>
        </div>

        <LocationPickerMap
          initialLat={picked.lat}
          initialLng={picked.lng}
          initialAddress={picked.address}
          autoDetectOnMount={true}
          onLocationChange={setPicked}
        />

        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <select
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="px-3 py-2.5 rounded-xl border border-outline-variant text-xs font-bold bg-surface-container-low"
          >
            <option value="Home">Save as: Home</option>
            <option value="Office">Save as: Office</option>
            <option value="Kitchen">Save as: Kitchen</option>
            <option value="Other">Save as: Other</option>
          </select>
          <button
            type="button"
            disabled={saving || !picked.address}
            onClick={handleSaveAndConfirm}
            className="flex-1 h-11 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[18px]">check_circle</span>
            <span>{saving ? 'Saving to Firestore...' : 'Save Address & Confirm Location'}</span>
          </button>
        </div>
      </div>

      {/* Saved Firestore Addresses */}
      {addresses.length > 0 && (
        <div className="space-y-2.5">
          <h3 className="text-sm font-extrabold text-primary px-1">Saved Addresses ({addresses.length})</h3>
          {addresses.map((addr) => {
            const isSelected = addr.id === selectedAddressId;
            return (
              <div
                key={addr.id}
                className={`w-full flex items-center justify-between gap-2 rounded-xl p-3.5 shadow-sm transition-all ${
                  isSelected ? 'bg-surface-container-lowest ring-2 ring-primary/25' : 'bg-surface-container-low'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelectAddress(addr.id);
                    setPicked({
                      address: addr.address,
                      lat: addr.lat,
                      lng: addr.lng,
                      serviceability: null,
                    });
                  }}
                  className="flex-1 flex items-center gap-3 min-w-0 text-left cursor-pointer"
                >
                  <span className="material-symbols-outlined text-primary text-[22px] shrink-0">{addr.icon}</span>
                  <div className="min-w-0">
                    <span className="text-sm font-bold text-on-surface block">{addr.label}</span>
                    <span className="text-xs text-on-surface-variant block truncate">{addr.address}</span>
                  </div>
                </button>
                <div className="flex items-center gap-1.5 shrink-0">
                  {onDeleteAddress && (
                    <button
                      type="button"
                      onClick={() => onDeleteAddress(addr.id)}
                      aria-label={`Delete ${addr.label} address`}
                      className="w-8 h-8 rounded-lg hover:bg-red-50 text-on-surface-variant hover:text-red-700 flex items-center justify-center cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  )}
                  <span className="material-symbols-outlined text-primary text-[22px]">
                    {isSelected ? 'radio_button_checked' : 'radio_button_unchecked'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// 5. Server-Validated Checkout & Complete Real-Time Payment Gateway Screen
//    Supports: Direct UPI QR (NPCI upi://pay + UTR Verify), Green Escrow Wallet,
//    Razorpay Online (HMAC Verified), and Verified Doorstep QR / Cash on Delivery
// ---------------------------------------------------------------------------
interface PaymentGatewayProps {
  listings: GrowerListing[];
  cart: CartItem[];
  deliveryLat: number;
  deliveryLng: number;
  deliveryAddress: string;
  walletBalance?: number;
  savedUpiId?: string;
  onPayWithWallet?: (amountInr: number, orderCode: string) => Promise<void>;
  onPlaceValidatedOrder: (params: {
    validation: CheckoutValidationResponse;
    paymentMethod: string;
    paymentStatus: 'verified' | 'doorstep_qr';
    paymentRef?: string;
  }) => Promise<void>;
  onNavigate: (screen: ScreenId) => void;
  onNotify: (msg: string) => void;
}

export const PaymentGatewayScreen: React.FC<PaymentGatewayProps> = ({
  listings,
  cart,
  deliveryLat,
  deliveryLng,
  deliveryAddress,
  walletBalance = 0,
  savedUpiId = '',
  onPayWithWallet,
  onPlaceValidatedOrder,
  onNavigate,
  onNotify,
}) => {
  const idempotencyKeyRef = useRef(`chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const [validation, setValidation] = useState<CheckoutValidationResponse | null>(null);
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<'upi_qr' | 'wallet' | 'razorpay' | 'doorstep_qr'>('upi_qr');
  const [upiUtr, setUpiUtr] = useState('');
  const [payerUpi, setPayerUpi] = useState(savedUpiId);
  const [submitting, setSubmitting] = useState(false);
  const [gatewayNotice, setGatewayNotice] = useState<string | null>(null);

  const cartPayload = useMemo(() => {
    return cart
      .map((c) => {
        const item = listings.find((l) => l.id === c.listingId);
        if (!item) return null;
        return {
          productId: item.id,
          growerId: item.growerId || 'unknown',
          farmName: item.farmName,
          name: item.name,
          unit: item.unit,
          unitPrice: item.price,
          quantity: c.quantity,
          availableStock: item.stock,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  }, [cart, listings]);

  const runServerValidation = async () => {
    if (cartPayload.length === 0) return;
    setValidating(true);
    setValidationError(null);
    try {
      const res = await zenvegoApi.validateCheckout({
        idempotencyKey: idempotencyKeyRef.current,
        deliveryLat,
        deliveryLng,
        items: cartPayload,
      });
      setValidation(res);
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : 'Checkout validation failed.');
    } finally {
      setValidating(false);
    }
  };

  useEffect(() => {
    runServerValidation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartPayload.length]);

  const upiQrBundle = useMemo(() => {
    if (!validation) return null;
    return getUpiPaymentQrUrl(
      {
        pa: 'zenvego.escrow@upi',
        pn: 'Zenvego Hyperlocal Produce',
        am: validation.totalPaid,
        tn: `Zenvego Fresh Order ${validation.orderCode}`,
        tr: validation.orderCode.replace(/[^A-Za-z0-9]/g, ''),
      },
      260
    );
  }, [validation]);

  if (cartPayload.length === 0) {
    return (
      <div className="max-w-lg mx-auto bg-surface-container-lowest rounded-2xl p-6 text-center space-y-3 shadow-sm">
        <p className="text-sm font-bold text-primary">Your basket is empty</p>
        <button
          type="button"
          onClick={() => onNavigate('buyer-explore')}
          className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold cursor-pointer"
        >
          Browse Produce
        </button>
      </div>
    );
  }

  const walletCanCover = validation ? walletBalance >= validation.totalPaid : false;

  const handleConfirmOrder = async () => {
    if (!validation || submitting) return;
    setSubmitting(true);
    setGatewayNotice(null);

    try {
      if (payMethod === 'upi_qr') {
        const cleanedUtr = upiUtr.replace(/\s+/g, '').trim();
        if (!cleanedUtr) {
          throw new Error(
            'Scan the UPI QR using GPay / PhonePe / Paytm / BHIM and enter your 12-digit UPI UTR Reference number below to confirm payment.'
          );
        }
        const verified = await zenvegoApi.verifyUpiPayment({
          orderCode: validation.orderCode,
          amountInr: validation.totalPaid,
          utrNumber: cleanedUtr,
          payerUpiId: payerUpi.trim() || undefined,
        });
        await onPlaceValidatedOrder({
          validation,
          paymentMethod: `Direct UPI QR Verified (${cleanedUtr.slice(-6)})`,
          paymentStatus: 'verified',
          paymentRef: verified.paymentId,
        });
      } else if (payMethod === 'wallet') {
        if (!onPayWithWallet || !walletCanCover) {
          throw new Error(
            `Insufficient Green Escrow Wallet balance (₹${walletBalance.toFixed(2)}). Add funds in Profile → Green Escrow Wallet or pay via Direct UPI QR.`
          );
        }
        await onPayWithWallet(validation.totalPaid, validation.orderCode);
        await onPlaceValidatedOrder({
          validation,
          paymentMethod: 'Green Escrow Wallet (1-Tap)',
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
            description: `Fresh Produce Order ${validation.orderCode}`,
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
                  paymentMethod: 'Razorpay Verified Online Payment',
                  paymentStatus: 'verified',
                  paymentRef: verified.paymentId,
                });
                resolve();
              } catch (e) {
                reject(e);
              }
            },
            modal: {
              ondismiss: () =>
                reject(new Error('Payment cancelled by customer. Order was not marked paid.')),
            },
          });
          rzp.open();
        });
      } else {
        await onPlaceValidatedOrder({
          validation,
          paymentMethod: 'Verified Doorstep QR / Pay on Delivery',
          paymentStatus: 'doorstep_qr',
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Checkout failed.';
      setGatewayNotice(msg);
      onNotify(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4 pb-10">
      {validating && (
        <div className="bg-surface-container-lowest rounded-xl p-5 text-center text-xs text-on-surface-variant">
          Validating live stock and server-side multi-grower pricing...
        </div>
      )}

      {validationError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-900 space-y-2">
          <p className="font-bold">{validationError}</p>
          <button type="button" onClick={runServerValidation} className="underline font-bold cursor-pointer">
            Retry Validation
          </button>
        </div>
      )}

      {validation && (
        <>
          {/* Server-Calculated Multi-Grower Summary */}
          <div className="bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-outline-variant/25 space-y-3 tabular-nums">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold uppercase text-secondary">Server-Validated Order</span>
                <h2 className="text-lg font-extrabold text-primary">{validation.orderCode}</h2>
              </div>
              <span className="text-xl font-extrabold text-primary">₹{validation.totalPaid}</span>
            </div>

            <p className="text-xs text-on-surface-variant">
              Delivering to: <strong className="text-on-surface">{deliveryAddress}</strong> ({validation.serviceabilityNote})
            </p>

            <div className="bg-surface-container-low rounded-xl p-3 space-y-2 text-xs">
              {validation.sellerSplits.map((s) => (
                <div key={s.growerId} className="flex items-center justify-between">
                  <span className="font-semibold text-on-surface">
                    {s.farmName} ({s.items.length} item{s.items.length === 1 ? '' : 's'})
                  </span>
                  <span className="font-bold text-primary">
                    ₹{s.grossAmount}{' '}
                    <span className="text-[10px] text-on-surface-variant">(Grower payable ₹{s.netPayout})</span>
                  </span>
                </div>
              ))}
              <div className="border-t border-outline-variant/30 pt-2 flex justify-between text-on-surface-variant">
                <span>Hyperlocal EV Delivery</span>
                <span className="font-bold text-on-surface">₹{validation.deliveryFee}</span>
              </div>
            </div>
          </div>

          {/* Complete 4-Method Payment Gateway */}
          <div className="bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-outline-variant/25 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-primary">Payment Gateway</h3>
              <span className="text-[11px] font-bold text-secondary bg-secondary-container/60 px-2.5 py-0.5 rounded-full">
                Zero Hidden Fees
              </span>
            </div>

            {/* Option 1: Direct NPCI UPI QR Payment */}
            <div
              className={`rounded-xl border transition-all ${
                payMethod === 'upi_qr'
                  ? 'border-primary bg-surface-container-low ring-2 ring-primary/20'
                  : 'border-outline-variant/30 bg-white'
              }`}
            >
              <button
                type="button"
                onClick={() => setPayMethod('upi_qr')}
                className="w-full text-left p-4 flex items-start gap-3 cursor-pointer"
              >
                <span className="material-symbols-outlined text-primary text-[22px] mt-0.5">qr_code_2</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-on-surface">Instant Direct UPI QR (Zero-Fee)</span>
                    <span className="text-[10px] font-extrabold text-emerald-900 bg-emerald-100 px-2 py-0.5 rounded-full">
                      GPay · PhonePe · Paytm
                    </span>
                  </div>
                  <span className="text-xs text-on-surface-variant">
                    Scan live dynamic NPCI UPI QR for exact ₹{validation.totalPaid} and verify with your 12-digit UTR reference.
                  </span>
                </div>
              </button>

              {payMethod === 'upi_qr' && upiQrBundle && (
                <div className="px-4 pb-4 pt-1 border-t border-outline-variant/20 space-y-3">
                  <div className="flex flex-col sm:flex-row items-center gap-4 bg-white rounded-xl p-3.5 border border-outline-variant/25">
                    <img
                      src={upiQrBundle.qrImageUrl}
                      alt={`UPI Payment QR for ₹${validation.totalPaid}`}
                      className="w-40 h-40 rounded-xl border border-outline-variant/20 shrink-0"
                    />
                    <div className="space-y-2 text-xs flex-1 w-full">
                      <p className="font-extrabold text-primary text-sm">
                        Pay Exact Amount: ₹{validation.totalPaid}
                      </p>
                      <p className="text-on-surface-variant">
                        Merchant VPA: <strong className="font-mono text-on-surface">zenvego.escrow@upi</strong>
                      </p>
                      <a
                        href={upiQrBundle.upiUri}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary-container text-on-secondary-container font-bold text-[11px]"
                      >
                        <span className="material-symbols-outlined text-[15px]">open_in_new</span>
                        Open UPI App on Mobile
                      </a>
                      <div className="pt-1 space-y-1.5">
                        <input
                          type="text"
                          value={upiUtr}
                          onChange={(e) => setUpiUtr(e.target.value)}
                          placeholder="Enter 12-digit UPI UTR / Ref ID (e.g. 432619820411)"
                          className="w-full px-3 py-2 rounded-lg border border-outline-variant text-xs font-mono bg-surface-container-low focus:outline-none focus:border-primary"
                        />
                        <input
                          type="text"
                          value={payerUpi}
                          onChange={(e) => setPayerUpi(e.target.value)}
                          placeholder="Your UPI ID (optional, e.g. name@okaxis)"
                          className="w-full px-3 py-2 rounded-lg border border-outline-variant text-xs bg-surface-container-low focus:outline-none focus:border-primary"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Option 2: Green Escrow Wallet */}
            <button
              type="button"
              onClick={() => setPayMethod('wallet')}
              className={`w-full text-left p-4 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
                payMethod === 'wallet'
                  ? 'border-primary bg-surface-container-low ring-2 ring-primary/20'
                  : 'border-outline-variant/30 bg-white'
              }`}
            >
              <span className="material-symbols-outlined text-primary text-[22px] mt-0.5">
                account_balance_wallet
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-on-surface">Green Escrow Wallet (1-Tap)</span>
                  <span className="text-xs font-extrabold text-primary tabular-nums">
                    Bal: ₹{walletBalance.toFixed(2)}
                  </span>
                </div>
                <span className="text-xs text-on-surface-variant">
                  {walletCanCover
                    ? `Instant escrow hold of ₹${validation.totalPaid}. Protected until verified doorstep QR delivery.`
                    : `Need ₹${Math.max(0, validation.totalPaid - walletBalance).toFixed(2)} more — add funds in Profile Wallet or use Direct UPI QR.`}
                </span>
              </div>
            </button>

            {/* Option 3: Verified Doorstep QR / Cash on Delivery */}
            <button
              type="button"
              onClick={() => setPayMethod('doorstep_qr')}
              className={`w-full text-left p-4 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
                payMethod === 'doorstep_qr'
                  ? 'border-primary bg-surface-container-low ring-2 ring-primary/20'
                  : 'border-outline-variant/30 bg-white'
              }`}
            >
              <span className="material-symbols-outlined text-primary text-[22px] mt-0.5">payments</span>
              <div className="min-w-0 flex-1">
                <span className="text-sm font-bold text-on-surface block">
                  Verified Doorstep QR / Pay on Delivery
                </span>
                <span className="text-xs text-on-surface-variant">
                  Reserves live grower stock atomically in Firestore now. Settle directly upon verified QR delivery handover.
                </span>
              </div>
            </button>

            {/* Option 4: Razorpay Online Checkout */}
            <button
              type="button"
              onClick={() => setPayMethod('razorpay')}
              className={`w-full text-left p-4 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
                payMethod === 'razorpay'
                  ? 'border-primary bg-surface-container-low ring-2 ring-primary/20'
                  : 'border-outline-variant/30 bg-white'
              }`}
            >
              <span className="material-symbols-outlined text-primary text-[22px] mt-0.5">credit_card</span>
              <div className="min-w-0 flex-1">
                <span className="text-sm font-bold text-on-surface block">
                  Cards / NetBanking via Razorpay (HMAC Verified)
                </span>
                <span className="text-xs text-on-surface-variant">
                  Live Razorpay Checkout SDK with server-side HMAC-SHA256 signature verification (when server keys configured).
                </span>
              </div>
            </button>

            {gatewayNotice && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 font-medium">
                {gatewayNotice}
              </div>
            )}

            <button
              type="button"
              disabled={submitting}
              onClick={handleConfirmOrder}
              className="w-full h-13 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-sm font-bold flex items-center justify-center gap-2 shadow-md cursor-pointer disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[20px]">lock</span>
              <span>
                {submitting
                  ? 'Verifying & Confirming Order...'
                  : payMethod === 'upi_qr'
                    ? `Verify UPI UTR & Place Order (₹${validation.totalPaid})`
                    : payMethod === 'wallet'
                      ? `Pay ₹${validation.totalPaid} from Green Escrow Wallet`
                      : payMethod === 'razorpay'
                        ? `Pay ₹${validation.totalPaid} via Razorpay`
                        : `Confirm Doorstep QR Order (₹${validation.totalPaid})`}
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// 6. Real-Time Live Order Tracking, Delivery Verification QR & Route Map
// ---------------------------------------------------------------------------
interface OrderReceiptProps {
  currentUid?: string | null;
  orders: ActiveOrder[];
  deliveryAssignments?: DeliveryAssignmentDoc[];
  onNotify: (msg: string) => void;
  onNavigate: (screen: ScreenId) => void;
}

export const OrderReceiptScreen: React.FC<OrderReceiptProps> = ({
  currentUid = null,
  orders,
  deliveryAssignments = [],
  onNotify,
  onNavigate,
}) => {
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(true);
  const [deliveryQrOpen, setDeliveryQrOpen] = useState(false);
  const [trackingCurrent, setTrackingCurrent] = useState<OrderTrackingCurrentDoc | null>(null);
  const [orderEvents, setOrderEvents] = useState<OrderTrackingEventDoc[]>([]);
  const [socketLiveStage, setSocketLiveStage] = useState<SocketDeliveryStage | null>(null);

  const order = orders.find((o) => o.id === selectedOrderId) || orders[0] || null;
  const liveAssignment = order
    ? deliveryAssignments.find((a) => a.parentOrderId === order.id) || null
    : null;

  // Subscribe to durable Firestore tracking/current & orderEvents for selected order
  useEffect(() => {
    setTrackingCurrent(null);
    setOrderEvents([]);
    setSocketLiveStage(null);
    if (!order?.id) return;

    const unsubTracking = subscribeOrderTrackingCurrent(order.id, setTrackingCurrent);
    const uid = currentUid || order.customerId;
    const unsubEvents = uid
      ? subscribeOrderTrackingEvents(order.id, 'customerId', uid, setOrderEvents)
      : () => {};

    return () => {
      unsubTracking();
      unsubEvents();
    };
  }, [order?.id, order?.customerId, currentUid]);

  if (!order) {
    return (
      <div className="max-w-lg mx-auto bg-white rounded-2xl p-8 text-center shadow-xs space-y-3 border border-slate-200">
        <span className="material-symbols-outlined text-4xl text-slate-400">receipt_long</span>
        <h2 className="text-lg font-extrabold text-primary">No Orders Placed Yet</h2>
        <p className="text-xs text-slate-600">
          When you place an order from the marketplace, its live GPS map, delivery partner location, and verification QR appear here automatically.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('buyer-explore')}
          className="px-5 py-2.5 rounded-xl bg-primary text-on-primary text-xs font-bold cursor-pointer"
        >
          Browse Fresh Harvests
        </button>
      </div>
    );
  }

  const effectiveStatus =
    liveAssignment?.status === 'delivered' || socketLiveStage === 'DELIVERED' || trackingCurrent?.stage === 'delivered'
      ? 'delivered'
      : liveAssignment?.status === 'picked_up'
        ? 'out_for_delivery'
        : order.status;

  const isLiveActive = effectiveStatus !== 'delivered' && effectiveStatus !== 'cancelled';

  const recordedEventTypes = new Set(orderEvents.map((e) => e.eventType));
  const eventTimeByType = new Map<string, string>();
  for (const ev of orderEvents) {
    eventTimeByType.set(ev.eventType, ev.createdAtText);
  }

  const isDelivered = effectiveStatus === 'delivered' || recordedEventTypes.has('DELIVERED');
  const isArrived =
    isDelivered ||
    socketLiveStage === 'ARRIVED' ||
    trackingCurrent?.stage === 'arrived' ||
    recordedEventTypes.has('ARRIVED');
  const isNearDestination =
    isArrived ||
    socketLiveStage === 'NEAR_DESTINATION' ||
    trackingCurrent?.stage === 'near_destination' ||
    recordedEventTypes.has('NEAR_DESTINATION');
  const isOutForDelivery =
    isNearDestination ||
    ['picked_up', 'out_for_delivery'].includes(effectiveStatus) ||
    liveAssignment?.status === 'picked_up' ||
    socketLiveStage === 'OUT_FOR_DELIVERY' ||
    recordedEventTypes.has('OUT_FOR_DELIVERY');
  const isPickedUp =
    isOutForDelivery ||
    Boolean(liveAssignment?.pickupVerifiedAt) ||
    socketLiveStage === 'PICKED_UP' ||
    recordedEventTypes.has('PICKED_UP');
  const isPartnerAssigned =
    isPickedUp ||
    Boolean(liveAssignment?.partnerId) ||
    socketLiveStage === 'PARTNER_ASSIGNED' ||
    recordedEventTypes.has('PARTNER_ASSIGNED');
  const isGrowerPreparing =
    isPartnerAssigned ||
    ['preparing', 'ready_for_pickup'].includes(effectiveStatus) ||
    Boolean(liveAssignment) ||
    recordedEventTypes.has('GROWER_PREPARING') ||
    recordedEventTypes.has('READY_FOR_PICKUP');

  // Complete 8-Stage Real-Time Delivery Lifecycle
  const deliveryStages = [
    {
      step: 1,
      label: 'Order Confirmed',
      done: true,
      time: eventTimeByType.get('ORDER_CONFIRMED') || order.createdAtText,
      sub: `${order.paymentMethod}${order.paymentRef ? ` · Ref ${order.paymentRef.slice(0, 16)}` : ''}`,
    },
    {
      step: 2,
      label: 'Grower Preparing Order',
      done: isGrowerPreparing,
      time: eventTimeByType.get('GROWER_PREPARING') || eventTimeByType.get('READY_FOR_PICKUP'),
      sub: isGrowerPreparing ? 'Harvested & packed at local farm' : 'Waiting for grower confirmation',
    },
    {
      step: 3,
      label: 'Delivery Partner Assigned',
      done: isPartnerAssigned,
      time: eventTimeByType.get('PARTNER_ASSIGNED'),
      sub: liveAssignment?.partnerName
        ? `${liveAssignment.partnerName} assigned for EV pickup`
        : 'Matching nearest verified EV partner',
    },
    {
      step: 4,
      label: 'Order Picked Up',
      done: isPickedUp,
      time:
        eventTimeByType.get('PICKED_UP') ||
        (liveAssignment?.pickupVerifiedAt
          ? new Date(liveAssignment.pickupVerifiedAt).toLocaleTimeString('en-IN', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : undefined),
      sub: isPickedUp ? `Pickup QR verified at ${liveAssignment?.farmName || 'grower farm'}` : 'Pending farm handover scan',
    },
    {
      step: 5,
      label: 'Out for Delivery',
      done: isOutForDelivery,
      time: eventTimeByType.get('OUT_FOR_DELIVERY'),
      sub: isOutForDelivery ? 'Live EV scooter location active on map' : 'Starts once crate leaves farm',
    },
    {
      step: 6,
      label: 'Near Destination',
      done: isNearDestination,
      time: eventTimeByType.get('NEAR_DESTINATION'),
      sub: isNearDestination ? 'Partner is within 500 m of your address' : 'Updates automatically as partner approaches',
    },
    {
      step: 7,
      label: 'Arrived',
      done: isArrived,
      time: eventTimeByType.get('ARRIVED'),
      sub: isArrived ? 'Partner arrived at your doorstep' : `Keep Delivery PIN ${order.handoverPin} ready`,
    },
    {
      step: 8,
      label: 'Delivered',
      done: isDelivered,
      time:
        eventTimeByType.get('DELIVERED') ||
        (liveAssignment?.deliveredAt
          ? new Date(liveAssignment.deliveredAt).toLocaleTimeString('en-IN', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : undefined),
      sub: isDelivered ? 'Verified handover complete · live GPS ended' : 'Confirm via Delivery QR or PIN',
    },
  ];

  const currentStageObj = [...deliveryStages].reverse().find((s) => s.done) || deliveryStages[0];

  const handleDownloadReceipt = () => {
    const lines = [
      `ZENVEGO ORDER RECEIPT`,
      `Order Code: ${order.orderCode}`,
      `Status: ${effectiveStatus}`,
      `Payment: ${order.paymentMethod} (${order.paymentStatus || 'doorstep_qr'})`,
      ...(order.paymentRef ? [`Payment Ref: ${order.paymentRef}`] : []),
      `Delivery Address: ${order.customerArea}`,
      `----------------------------------------`,
      ...order.items.map((i) => `${i.quantity} ${i.unit} ${i.name} (${i.farmName}) - INR ${i.lineTotal}`),
      `----------------------------------------`,
      `Items Total: INR ${order.itemsTotal}`,
      `Delivery Fee: INR ${order.deliveryFee}`,
      `Total: INR ${order.totalPaid}`,
    ].join('\n');
    downloadTextFile(`Zenvego_Receipt_${order.orderCode}.txt`, lines);
    onNotify(`Receipt ${order.orderCode} downloaded`);
  };

  const pickupCoords =
    liveAssignment && isValidCoord(liveAssignment.pickupLat, liveAssignment.pickupLng)
      ? { lat: liveAssignment.pickupLat, lng: liveAssignment.pickupLng }
      : null;

  const dropoffCoords =
    liveAssignment && isValidCoord(liveAssignment.dropoffLat, liveAssignment.dropoffLng)
      ? { lat: liveAssignment.dropoffLat, lng: liveAssignment.dropoffLng }
      : isValidCoord(order.deliveryLat, order.deliveryLng)
        ? { lat: order.deliveryLat as number, lng: order.deliveryLng as number }
        : null;

  const livePartnerPos =
    liveAssignment &&
    liveAssignment.partnerId &&
    liveAssignment.status !== 'open' &&
    isValidCoord(liveAssignment.partnerLat, liveAssignment.partnerLng)
      ? { lat: liveAssignment.partnerLat as number, lng: liveAssignment.partnerLng as number }
      : null;

  return (
    <div className="flex flex-col w-full gap-4 pb-10 max-w-3xl mx-auto">
      {/* Order Switcher */}
      {orders.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {orders.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setSelectedOrderId(o.id || null)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 cursor-pointer border ${
                o.id === order.id
                  ? 'bg-[#003820] text-white border-[#003820]'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {o.orderCode} · {o.status.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      )}

      {/* Clean Compact Order Status Header (Mobile-First, No Heavy Gradients) */}
      <section className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isLiveActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
              }`}
            />
            <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-800">
              {isLiveActive ? `Step ${currentStageObj.step}/8 · ${currentStageObj.label}` : 'Delivery Completed'}
            </span>
          </div>
          <span className="text-xs font-mono font-bold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-lg">
            {order.orderCode}
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold text-slate-900">{currentStageObj.label}</h2>
            <p className="text-xs text-slate-600 truncate mt-0.5">{order.customerArea}</p>
          </div>

          {liveAssignment?.partnerName && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200/80 text-xs">
              <span className="material-symbols-outlined text-[18px] text-[#003820]">electric_moped</span>
              <div className="min-w-0">
                <p className="font-bold text-slate-900 leading-tight truncate">{liveAssignment.partnerName}</p>
                <p className="text-[10px] text-emerald-800 font-semibold">Assigned EV Partner</p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Primary Interactive Live Map Viewport */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between px-0.5">
          <h3 className="text-sm font-extrabold text-slate-900">Live Delivery Map</h3>
          <button
            type="button"
            onClick={() => setShowMap((v) => !v)}
            className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-700 cursor-pointer"
          >
            {showMap ? 'Hide Map' : 'Show Map'}
          </button>
        </div>

        {showMap &&
          (liveAssignment && pickupCoords && dropoffCoords ? (
            <LiveTrackingMap
              orderId={order.id}
              assignmentId={liveAssignment.id}
              socketRole="customer"
              pickup={pickupCoords}
              dropoff={dropoffCoords}
              farmName={liveAssignment.farmName || order.items[0]?.farmName || 'Grower Hub'}
              dropoffLabel={order.customerArea}
              stage={liveAssignment.status}
              livePartnerPos={livePartnerPos}
              lastLocationAt={trackingCurrent?.lastUpdatedAt || liveAssignment.lastLocationAt}
              trackingCurrent={trackingCurrent}
              partnerName={trackingCurrent?.partnerName || liveAssignment.partnerName}
              onLiveStageChange={setSocketLiveStage}
              heightClass="h-80 sm:h-[420px]"
            />
          ) : (
            <div className="rounded-2xl bg-white border border-slate-200 p-5 text-slate-700 space-y-2.5 shadow-xs">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[20px] text-[#003820]">schedule</span>
                </div>
                <div>
                  <p className="text-xs font-extrabold text-slate-900">
                    {effectiveStatus === 'delivered'
                      ? 'Order Delivered'
                      : 'Awaiting Grower Dispatch & EV Partner Assignment'}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {effectiveStatus === 'delivered'
                      ? 'Live partner location sharing has ended for this completed delivery.'
                      : 'The interactive OpenFreeMap road route and live EV scooter marker activate automatically once your crate is ready for pickup.'}
                  </p>
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-200/80 px-3 py-2 text-[11px] text-slate-700 flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px] text-emerald-700 shrink-0">home_pin</span>
                <span className="truncate">Confirmed Drop-off: {order.customerArea}</span>
              </div>
            </div>
          ))}
      </section>

      {/* 8-Stage Delivery Status Timeline */}
      <section className="rounded-2xl bg-white p-4 sm:p-5 shadow-xs border border-slate-200 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-extrabold text-slate-900">Delivery Progress</h3>
          <span className="text-[11px] font-semibold text-slate-500">
            {deliveryStages.filter((s) => s.done).length} of {deliveryStages.length} completed
          </span>
        </div>

        <ol className="space-y-2.5">
          {deliveryStages.map((st) => {
            const isCurrent = st.step === currentStageObj.step && isLiveActive;
            return (
              <li key={st.step} className="flex items-start gap-3">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[11px] font-extrabold ${
                    st.done
                      ? isCurrent
                        ? 'bg-[#003820] text-white ring-4 ring-emerald-100'
                        : 'bg-emerald-600 text-white'
                      : 'bg-slate-100 text-slate-400 border border-slate-200'
                  }`}
                >
                  {st.done ? (
                    <span className="material-symbols-outlined text-[14px]">check</span>
                  ) : (
                    <span>{st.step}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-xs sm:text-sm font-bold ${
                        st.done ? 'text-slate-900' : 'text-slate-500'
                      }`}
                    >
                      {st.step}. {st.label}
                    </span>
                    {st.time && (
                      <span className="text-[10px] font-mono text-slate-500 shrink-0">{st.time}</span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500">{st.sub}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {/* Delivery Verification QR + PIN */}
      {isLiveActive && (
        <section className="rounded-2xl bg-primary-container text-on-primary p-5 shadow-md space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-on-primary-container">
                Doorstep Delivery Verification
              </span>
              <p className="text-xs text-primary-fixed mt-0.5">
                Let the Delivery Partner scan your single-use Delivery QR or enter PIN {order.handoverPin}.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(order.handoverPin).catch(() => {});
                onNotify(`Copied Delivery PIN ${order.handoverPin}`);
              }}
              className="px-3 py-1.5 rounded-xl bg-white text-primary font-mono text-lg font-extrabold tracking-widest shrink-0 cursor-pointer"
            >
              {order.handoverPin}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setDeliveryQrOpen(true)}
            className="w-full h-11 rounded-xl bg-white text-primary text-xs font-extrabold flex items-center justify-center gap-2 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">qr_code_2</span>
            <span>Show Signed Delivery Verification QR</span>
          </button>
        </section>
      )}

      {/* Items & Receipt Totals */}
      <section className="rounded-2xl bg-surface-container-lowest p-5 shadow-sm border border-outline-variant/20 space-y-3 tabular-nums">
        <h3 className="text-sm font-extrabold text-primary">Ordered Produce ({order.items.length})</h3>
        <div className="divide-y divide-outline-variant/15">
          {order.items.map((item, idx) => (
            <div key={`${item.listingId}-${idx}`} className="py-2 flex items-center justify-between text-xs">
              <div>
                <p className="font-bold text-on-surface">
                  {item.quantity} × {item.name} ({item.unit})
                </p>
                <p className="text-on-surface-variant">{item.farmName}</p>
              </div>
              <span className="font-bold text-primary">₹{item.lineTotal}</span>
            </div>
          ))}
        </div>
        <div className="border-t border-outline-variant/20 pt-2 text-xs space-y-1">
          <div className="flex justify-between text-on-surface-variant">
            <span>Items Total</span>
            <span>₹{order.itemsTotal}</span>
          </div>
          <div className="flex justify-between text-on-surface-variant">
            <span>Delivery Fee</span>
            <span>₹{order.deliveryFee}</span>
          </div>
          <div className="flex justify-between font-extrabold text-sm text-primary pt-1">
            <span>Total</span>
            <span>₹{order.totalPaid}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDownloadReceipt}
          className="w-full h-11 rounded-xl bg-surface-container-low hover:bg-surface-container text-primary text-xs font-bold cursor-pointer"
        >
          Download Receipt (.txt)
        </button>
      </section>

      <QrGeneratorModal
        open={deliveryQrOpen}
        title={`Delivery Verification QR — ${order.orderCode}`}
        subtitle="Single-use backend-signed token for Delivery Partner scan"
        requestPayload={
          order.id
            ? {
                type: 'delivery',
                orderId: order.id,
                orderCode: order.orderCode,
                handoverPin: order.handoverPin,
              }
            : null
        }
        onClose={() => setDeliveryQrOpen(false)}
      />
    </div>
  );
};

