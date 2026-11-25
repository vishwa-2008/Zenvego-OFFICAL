import React, { useState } from 'react';
import { BulkEnquiryDoc, UserRole } from '../types';

interface BulkProcurementScreenProps {
  role: UserRole;
  currentUid: string | null;
  growerFarmName: string;
  enquiries: BulkEnquiryDoc[];
  onCreateEnquiry: (payload: {
    organizationName: string;
    produceName: string;
    quantityKg: number;
    frequency: 'one_time' | 'daily' | 'weekly';
    deliveryArea: string;
  }) => Promise<void>;
  onSubmitQuote: (enquiry: BulkEnquiryDoc, pricePerKg: number, notes: string) => Promise<void>;
  onRespondQuote: (enquiry: BulkEnquiryDoc, decision: 'accepted' | 'rejected') => Promise<void>;
}

export function BulkProcurementScreen({
  role,
  currentUid,
  growerFarmName,
  enquiries,
  onCreateEnquiry,
  onSubmitQuote,
  onRespondQuote,
}: BulkProcurementScreenProps) {
  const [orgName, setOrgName] = useState('');
  const [produceName, setProduceName] = useState('');
  const [quantityKg, setQuantityKg] = useState('25');
  const [frequency, setFrequency] = useState<'one_time' | 'daily' | 'weekly'>('weekly');
  const [deliveryArea, setDeliveryArea] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [activeQuoteId, setActiveQuoteId] = useState<string | null>(null);
  const [quotePrice, setQuotePrice] = useState('');
  const [quoteNotes, setQuoteNotes] = useState('');

  const handleSubmitEnquiry = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = Number(quantityKg);
    if (!orgName.trim() || !produceName.trim() || !deliveryArea.trim() || !qty || qty < 1) return;
    setSubmitting(true);
    try {
      await onCreateEnquiry({
        organizationName: orgName.trim(),
        produceName: produceName.trim(),
        quantityKg: qty,
        frequency,
        deliveryArea: deliveryArea.trim(),
      });
      setOrgName('');
      setProduceName('');
      setQuantityKg('25');
      setDeliveryArea('');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendQuote = async (enquiry: BulkEnquiryDoc) => {
    const price = Number(quotePrice);
    if (!price || price <= 0) return;
    setSubmitting(true);
    try {
      await onSubmitQuote(enquiry, price, quoteNotes.trim() || `Direct farm-gate supply from ${growerFarmName}`);
      setActiveQuoteId(null);
      setQuotePrice('');
      setQuoteNotes('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="bg-white rounded-2xl border border-[#bfc9c1]/40 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-[#005232]">
            Institutional & HoReCa Direct Supply
          </span>
          <h1 className="font-headline font-bold text-xl text-[#002113] mt-1">
            Bulk Enquiries & Grower Quotations
          </h1>
          <p className="text-xs text-[#404943] mt-1">
            Restaurants, cafés, hostels, and institutional kitchens request wholesale harvests directly from verified local growers.
          </p>
        </div>
        <div className="px-3.5 py-2 rounded-xl bg-[#eff5ef] text-xs font-semibold text-[#005232] shrink-0">
          {enquiries.length} Live {enquiries.length === 1 ? 'Enquiry' : 'Enquiries'}
        </div>
      </div>

      {/* Institutional Buyer Request Form */}
      {role !== 'grower' && (
        <form
          onSubmit={handleSubmitEnquiry}
          className="bg-white rounded-2xl border border-[#bfc9c1]/40 p-5 shadow-xs space-y-4"
        >
          <h2 className="font-headline font-bold text-base text-[#002113]">
            Submit New Institutional Requirement
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-semibold text-[#404943] mb-1">
                Restaurant / Café / Hostel Name
              </label>
              <input
                type="text"
                required
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="e.g., Green Bowl Café"
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#bfc9c1] text-sm outline-none focus:border-[#005232]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#404943] mb-1">Produce Required</label>
              <input
                type="text"
                required
                value={produceName}
                onChange={(e) => setProduceName(e.target.value)}
                placeholder="e.g., Baby Spinach & Heirloom Tomatoes"
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#bfc9c1] text-sm outline-none focus:border-[#005232]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#404943] mb-1">Quantity (kg)</label>
              <input
                type="number"
                min={1}
                max={50000}
                required
                value={quantityKg}
                onChange={(e) => setQuantityKg(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#bfc9c1] text-sm outline-none focus:border-[#005232]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#404943] mb-1">Supply Frequency</label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as 'one_time' | 'daily' | 'weekly')}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#bfc9c1] text-sm bg-white outline-none focus:border-[#005232]"
              >
                <option value="one_time">One-Time Harvest Drop</option>
                <option value="daily">Daily Morning Delivery</option>
                <option value="weekly">Weekly Standing Contract</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#404943] mb-1">Delivery Area / Kitchen Address</label>
              <input
                type="text"
                required
                value={deliveryArea}
                onChange={(e) => setDeliveryArea(e.target.value)}
                placeholder="e.g., 100ft Road, Indiranagar, Bengaluru"
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#bfc9c1] text-sm outline-none focus:border-[#005232]"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={submitting || !currentUid}
            className="px-5 py-2.5 rounded-xl bg-[#005232] text-white text-sm font-semibold hover:bg-[#003d25] disabled:opacity-50 cursor-pointer"
          >
            {submitting ? 'Publishing Requirement...' : 'Broadcast Bulk Enquiry to Local Growers'}
          </button>
        </form>
      )}

      {/* Live Enquiries & Quotations List */}
      <div className="space-y-3">
        <h2 className="font-headline font-bold text-base text-[#002113]">
          {role === 'grower' ? 'Open & Quoted Institutional Enquiries' : 'Your Bulk Enquiries & Grower Quotes'}
        </h2>

        {enquiries.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#bfc9c1]/40 p-8 text-center space-y-2">
            <span className="material-symbols-outlined text-4xl text-[#404943]/50">storefront</span>
            <p className="text-sm font-semibold text-[#002113]">No bulk enquiries yet</p>
            <p className="text-xs text-[#404943]">
              {role === 'grower'
                ? 'When local restaurants, cafés, or hostels post bulk produce requirements, they appear here in real time.'
                : 'Submit your first institutional produce requirement above to receive direct farm-gate quotations.'}
            </p>
          </div>
        ) : (
          enquiries.map((enq) => {
            const isOwner = currentUid && enq.buyerId === currentUid;
            const totalQuoted = enq.quotedPricePerKg ? enq.quotedPricePerKg * enq.quantityKg : null;

            return (
              <div
                key={enq.id}
                className="bg-white rounded-2xl border border-[#bfc9c1]/40 p-4 sm:p-5 shadow-xs space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-headline font-bold text-sm sm:text-base text-[#002113]">
                        {enq.produceName} — {enq.quantityKg} kg
                      </h3>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase ${
                          enq.status === 'accepted'
                            ? 'bg-emerald-100 text-emerald-900'
                            : enq.status === 'quoted'
                              ? 'bg-amber-100 text-amber-900'
                              : enq.status === 'rejected'
                                ? 'bg-red-100 text-red-900'
                                : 'bg-[#eff5ef] text-[#005232]'
                        }`}
                      >
                        {enq.status}
                      </span>
                    </div>
                    <p className="text-xs text-[#404943] mt-1">
                      {enq.organizationName} · {enq.frequency.replace('_', ' ')} · {enq.deliveryArea}
                    </p>
                  </div>
                  <span className="text-[11px] text-[#404943]">{enq.createdAt || 'Just now'}</span>
                </div>

                {enq.quotedPricePerKg && (
                  <div className="bg-[#f5fbf5] rounded-xl p-3 border border-[#005232]/15 text-xs space-y-1">
                    <p className="font-bold text-[#002113]">
                      Quote from {enq.quotedFarmName}: ₹{enq.quotedPricePerKg}/kg (Total ₹{totalQuoted?.toLocaleString('en-IN')})
                    </p>
                    {enq.quoteNotes && <p className="text-[#404943]">{enq.quoteNotes}</p>}
                  </div>
                )}

                {/* Grower Action: Submit Quote on Open Enquiry */}
                {enq.status === 'open' && role === 'grower' && (
                  <div>
                    {activeQuoteId === enq.id ? (
                      <div className="flex flex-col sm:flex-row gap-2 pt-1">
                        <input
                          type="number"
                          min={1}
                          value={quotePrice}
                          onChange={(e) => setQuotePrice(e.target.value)}
                          placeholder="Price ₹/kg"
                          className="w-full sm:w-32 px-3 py-2 rounded-xl border border-[#bfc9c1] text-xs outline-none focus:border-[#005232]"
                        />
                        <input
                          type="text"
                          value={quoteNotes}
                          onChange={(e) => setQuoteNotes(e.target.value)}
                          placeholder="Harvest slot, packaging, or delivery note..."
                          className="flex-1 px-3 py-2 rounded-xl border border-[#bfc9c1] text-xs outline-none focus:border-[#005232]"
                        />
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => handleSendQuote(enq)}
                          className="px-4 py-2 rounded-xl bg-[#005232] text-white text-xs font-semibold cursor-pointer shrink-0"
                        >
                          Send Quote
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setActiveQuoteId(enq.id)}
                        className="px-4 py-2 rounded-xl bg-[#005232] text-white text-xs font-semibold cursor-pointer"
                      >
                        Submit Wholesale Quotation
                      </button>
                    )}
                  </div>
                )}

                {/* Institutional Buyer Action: Accept / Reject Quoted Offer */}
                {enq.status === 'quoted' && isOwner && (
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => onRespondQuote(enq, 'accepted')}
                      className="px-4 py-2 rounded-xl bg-[#005232] text-white text-xs font-semibold cursor-pointer"
                    >
                      Accept Quotation
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => onRespondQuote(enq, 'rejected')}
                      className="px-4 py-2 rounded-xl bg-red-50 text-red-800 border border-red-200 text-xs font-semibold cursor-pointer"
                    >
                      Decline
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
