import React, { useState, useEffect } from 'react';
import { ViewState, LoggedInUser, OrderRecord, Lang } from '../types';
import { t } from '../utils/i18n';
import QrCodeRenderer from '../components/QrCodeRenderer';
import { downloadOrderPdf } from '../lib/exportDocs';
import { buildUpiUrl } from '../lib/payments';

interface BillProps {
  setView: (view: ViewState) => void;
  order: OrderRecord;
  sessionUser: LoggedInUser;
  lang: Lang;
  t: (key: string, lang?: Lang) => string;
  onClose: () => void;
}

export default function BillView({
  setView, order, sessionUser, lang, t, onClose,
}: BillProps) {
  const [generated, setGenerated] = useState(order.billGenerated);
  const [upiUrl, setUpiUrl] = useState<string>('');

  useEffect(() => {
    setGenerated(order.billGenerated);
    if (order.paymentMethod === 'upi' && order.paymentRef) {
      setUpiUrl(buildUpiUrl({
        payeeVpa: 'zenvego@upi',
        payeeName: 'ZENVEGO Marketplace',
        amount: order.total,
        note: `Order ${order.orderNo}`,
        transactionRef: order.paymentRef,
      }));
    }
  }, [order]);

  const handleGenerate = () => {
    setGenerated(true);
  };

  const handleDownload = () => {
    downloadOrderPdf(order);
  };

  return (
    <div className="min-h-screen bg-[#fff8f6] text-[#271810] font-sans flex flex-col h-screen overflow-hidden">
      <header className="h-14 bg-[#fff8f6] border-b border-[#ffeae0] px-4 flex items-center justify-between shrink-0">
        <button onClick={onClose} className="text-[12px] font-bold text-[#0f5238]">{t('common.back', lang)}</button>
        <h2 className="text-xs font-bold uppercase tracking-wider text-[#271810]/70">{t('bill.title', lang)}</h2>
        <button onClick={() => setView('seller')} className="text-[12px] font-bold text-[#ff5c3e]">{t('common.close', lang)}</button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="bg-white rounded-3xl p-4 border border-[#ffeae0] shadow-sm">
          <div className="flex justify-between items-start mb-4">
            <div>
              <div className="text-lg font-black">{t('app.name', lang)}</div>
              <div className="text-[10px] text-[#271810]/60">Hyperlocal Agrarian Grid</div>
            </div>
            <div className="text-right">
              <div className="text-xs font-bold">{t('bill.customerCopy', lang)}</div>
              <div className="text-[10px] text-[#271810]/60">{order.orderNo}</div>
              <div className="text-[10px] text-[#271810]/60">{new Date(order.createdAt).toLocaleDateString()}</div>
            </div>
          </div>
          <div className="flex justify-between items-baseline mb-2">
            <span className="text-sm text-[#271810]/60">Customer</span>
            <span className="font-bold text-sm">{order.customerName}</span>
          </div>
          <div className="flex justify-between items-baseline mb-4">
            <span className="text-sm text-[#271810]/60">Delivery Address</span>
            <span className="text-sm truncate max-w-[60%]">{order.address}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-[#ffeae0]">
                  <th className="pb-2 text-[10px] font-bold text-[#271810]/60 uppercase">Item</th>
                  <th className="pb-2 text-[10px] font-bold text-[#271810]/60 uppercase text-right">Qty</th>
                  <th className="pb-2 text-[10px] font-bold text-[#271810]/60 uppercase text-right">Price</th>
                  <th className="pb-2 text-[10px] font-bold text-[#271810]/60 uppercase text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#ffeae0]">
                {order.items.map(it => (
                  <tr key={it.id} className="text-sm">
                    <td className="py-2">{it.name}</td>
                    <td className="py-2 text-right">{it.quantity} {it.unit}</td>
                    <td className="py-2 text-right">₹{it.price.toFixed(2)}</td>
                    <td className="py-2 text-right font-bold">₹{(it.price * it.quantity).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex justify-between items-baseline pt-4 border-t border-[#ffeae0]">
            <span className="text-lg font-black">{t('bill.total', lang)}</span>
            <span className="text-2xl font-black text-[#0f5238]">₹{order.total.toFixed(2)}</span>
          </div>

          <div className="mt-3 flex justify-between items-center text-xs text-[#271810]/60">
            <span>Payment: {order.paymentMethod === 'cod' ? t('payment.cod', lang) : t('payment.online', lang)}</span>
            <span>Status: {order.status}</span>
          </div>
        </div>

        {!generated && (
          <div className="bg-[#ffe9d3] rounded-3xl p-4 border border-[#ffe2d5]">
            <div className="flex flex-col items-center gap-3">
              <QrCodeRenderer text={`ZENVEGO_ORDER_${order.orderNo}_${order.total}`} size={160} />
              <div className="text-center">
                <div className="text-[10px] font-bold text-[#a24000] uppercase">{t('bill.qrScan', lang)}</div>
                <div className="text-xs text-[#271810]/60">Scan QR to verify order and amount</div>
              </div>
              <div className="w-full">
                <button
                  onClick={handleGenerate}
                  className="w-full py-3 rounded-2xl bg-[#0f5238] text-white font-black text-sm shadow-lg"
                >
                  {t('bill.generate', lang)}
                </button>
              </div>
            </div>
          </div>
        )}

        {generated && (
          <div className="bg-[#b1f0ce] rounded-3xl p-4 border border-[#7fd9a8]">
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#002114] flex items-center justify-center text-white font-black">✓</div>
              <div className="text-center">
                <div className="text-xs font-bold text-[#002114] uppercase">Bill Generated</div>
                <div className="text-[10px] text-[#002114]/60">QR code locked to order amount</div>
              </div>
              <QrCodeRenderer text={`ZENVEGO_ORDER_${order.orderNo}_${order.total}_VERIFIED`} size={140} />
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleDownload}
            className="flex-1 py-3 rounded-xl bg-[#0f5238] text-white font-black text-sm shadow-lg flex items-center justify-center gap-2"
          >
            📄 {t('bill.downloadPDF', lang)}
          </button>
          {order.paymentMethod === 'upi' && (
            <button
              onClick={() => { window.location.href = upiUrl; }}
              className="flex-1 py-3 rounded-xl bg-[#ff5c3e] text-white font-black text-sm shadow-lg flex items-center justify-center gap-2"
            >
            💳 {t('payment.payNow', lang)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
