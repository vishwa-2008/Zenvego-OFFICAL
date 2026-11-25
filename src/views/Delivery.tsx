import React, { useState, useCallback } from 'react';
import { ViewState, LoggedInUser, CartItem, OrderRecord, Lang } from '../types';
import { t } from '../utils/i18n';
import QrCodeRenderer from '../components/QrCodeRenderer';
import { startScanner, stopScanner, isScannerSupported } from '../lib/qrScanner';

interface DeliveryProps {
  setView: (view: ViewState) => void;
  setCurrentView: (view: ViewState) => void;
  sessionUser: LoggedInUser;
  lang: Lang;
  t: (key: string, lang?: Lang) => string;
  orders: OrderRecord[];
  setOrders: React.Dispatch<React.SetStateAction<OrderRecord[]>>;
  addToast: (msg: string) => void;
  handleLogout: () => void;
  cart: CartItem[];
  setCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
  addToCart: (product: any) => void;
}

const DELIVERY_TABS: { key: 'assignments' | 'messages'; label: (lang: Lang) => string }[] = [
  { key: 'assignments', label: l => t('delivery.assignments', l) },
  { key: 'messages', label: l => t('delivery.textMessage', l) },
];

export default function DeliveryView({
  setView, setCurrentView, sessionUser, lang, t, orders, setOrders, addToast, handleLogout,
  cart, setCart, addToCart,
}: DeliveryProps) {
  const [activeTab, setActiveTab] = useState<'assignments' | 'messages' | 'scanner'>('assignments');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerSupported, setScannerSupported] = useState<boolean | null>(null);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [callOpen, setCallOpen] = useState(false);
  const [callNumber, setCallNumber] = useState('');
  const [msgOpen, setMsgOpen] = useState(false);
  const [msgTo, setMsgTo] = useState('');
  const [msgText, setMsgText] = useState('');
  const [msgHistory, setMsgHistory] = useState<{ to: string; text: string; time: string }[]>([]);

  const myAssignments = orders.filter(
    o => o.deliveryPartnerId === sessionUser.id || o.deliveryPartnerName === sessionUser.name
  );

  useCallback(() => {
    setScannerSupported(isScannerSupported());
  }, []);

  const handleStartScan = async () => {
    if (!scannerSupported) {
      addToast('Camera scanner not supported on this device');
      return;
    }
    setScannerOpen(true);
    try {
      await startScanner('qr-scanner-container', (text) => {
        setScanResult(text);
        setScannerOpen(false);
        stopScanner();
        addToast('QR scanned: ' + text);
      });
    } catch (e) {
      addToast('Failed to start scanner');
      setScannerOpen(false);
    }
  };

  const handleScanClose = () => {
    setScannerOpen(false);
    stopScanner();
  };

  const handleMaskCall = (number: string) => {
    setCallNumber(number);
    setCallOpen(true);
  };

  const handleEndCall = () => setCallOpen(false);

  const handleSendMsg = () => {
    if (!msgText.trim() || !msgTo.trim()) return;
    setMsgHistory(prev => [...prev, { to: msgTo, text: msgText, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
    setMsgText('');
    addToast('Message sent to ' + msgTo);
  };

  const formatTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const assignSelf = (orderId: string) => {
    setOrders(prev => prev.map(o =>
      o.id === orderId
        ? { ...o, status: 'assigned', deliveryPartnerId: sessionUser.id, deliveryPartnerName: sessionUser.name }
        : o
    ));
    addToast('Order assigned to you');
  };

  const markPicked = (orderId: string) => {
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'picked' } : o));
    addToast('Order picked up');
  };

  const markDelivered = (orderId: string) => {
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'delivered' } : o));
    addToast('Order delivered');
  };

  return (
    <div className="min-h-screen bg-[#fff8f6] text-[#271810] font-sans flex flex-col h-screen overflow-hidden">
      {/* Top nav */}
      <header className="h-14 bg-[#fff8f6] border-b border-[#ffeae0] px-4 flex items-center justify-between shrink-0">
        <button onClick={() => setCurrentView('login')} className="text-[12px] font-bold text-[#0f5238]">{t('common.back', lang)}</button>
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#271810]/70">
          {t('delivery.dashboard', lang)}
        </div>
        <button onClick={handleLogout} className="text-[12px] font-bold text-[#ff5c3e]">{t('common.logout', lang)}</button>
      </header>

      {/* Tab bar */}
      <div className="flex border-b border-[#ffeae0] shrink-0 overflow-x-auto pb-1">
        {DELIVERY_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key as any); setScannerOpen(false); }}
            className={`px-4 py-3 whitespace-nowrap text-xs font-bold border-b-2 ${
              activeTab === tab.key
                ? 'border-[#ff5c3e] text-[#ff5c3e] bg-[#ffe9d3]'
                : 'border-transparent text-[#271810]/50 hover:bg-[#fffaf8]'
            }`}
          >
            {tab.label(lang)}
          </button>
        ))}
        <button
          onClick={handleStartScan}
          className="px-3 py-3 whitespace-nowrap text-xs font-bold border-b-2 border-transparent text-[#271810]/50 hover:bg-[#fffaf8] flex items-center gap-1"
        >
          📷 {t('delivery.scanOrderQR', lang)}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {activeTab === 'assignments' && (
          <div className="space-y-3">
            <h2 className="text-lg font-black">{t('delivery.assignments', lang)}</h2>
            {myAssignments.length === 0 ? (
              <div className="text-center py-10">
                <div className="w-16 h-16 rounded-full bg-[#ffe9d3] flex items-center justify-center mx-auto text-[#a24000] font-black text-3xl mb-3">🏍️</div>
                <p className="text-xs text-[#271810]/60">No delivery assignments</p>
              </div>
            ) : (
              <div className="space-y-3">
                {myAssignments.map(order => (
                  <div key={order.id} className="bg-white p-3 rounded-2xl border border-[#ffeae0] shadow-sm space-y-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-bold text-sm">{order.orderNo}</div>
                        <div className="text-[10px] text-[#271810]/60">{order.customerName}</div>
                        <div className="text-[10px] text-[#271810]/60">{order.address}</div>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        order.status === 'delivered' ? 'bg-[#b1f0ce] text-[#002114]' :
                        order.status === 'picked' ? 'bg-[#ffe9d3] text-[#a24000]' :
                        order.status === 'assigned' ? 'bg-[#ffe9d3] text-[#a24000]' :
                        'bg-[#eededc] text-[#271810]/60'
                      }`}>{order.status}</span>
                    </div>
                    <div className="flex gap-2 mb-2">
                      {order.items.map(it => (
                        <div key={it.id} className="w-10 h-10 rounded-lg bg-[#ffe9d3] overflow-hidden flex-shrink-0">
                          <img src={it.image} alt={it.name} className="w-full h-full object-cover" />
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between text-xs font-bold mb-2">
                      <span>{t('bill.total', lang)}</span>
                      <span>₹{order.total.toFixed(2)}</span>
                    </div>
                    <div className="flex gap-2">
                      {order.status === 'placed' && (
                        <button
                          onClick={() => assignSelf(order.id)}
                          className="flex-1 py-2 rounded-xl bg-[#0f5238] text-white text-[10px] font-bold text-center shadow-sm"
                        >
                          Accept Assignment
                        </button>
                      )}
                      {order.status === 'assigned' && (
                        <button
                          onClick={() => markPicked(order.id)}
                          className="flex-1 py-2 rounded-xl bg-[#ff5c3e] text-white text-[10px] font-bold text-center shadow-sm"
                        >
                          Mark Picked
                        </button>
                      )}
                      {order.status === 'picked' && (
                        <button
                          onClick={() => markDelivered(order.id)}
                          className="flex-1 py-2 rounded-xl bg-[#0f5238] text-white text-[10px] font-bold text-center shadow-sm"
                        >
                          Mark Delivered
                        </button>
                      )}
                      <button
                        onClick={() => handleMaskCall('+91 98765 43210')}
                        className="flex-1 py-2 rounded-xl border border-[#eddcd4] text-[#271810]/60 text-[10px] font-bold text-center"
                      >
                        {t('delivery.maskCall', lang)}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'messages' && (
          <div className="space-y-3">
            <h2 className="text-lg font-black">{t('delivery.textMessage', lang)}</h2>
            <div className="space-y-3">
              {msgHistory.map((m, i) => (
                <div key={i} className="max-w-[80%] self-end bg-[#0f5238] text-white text-xs rounded-3xl rounded-tl-none p-2">
                  <div className="text-[9px] text-[#b1f0ce] mb-0.5">{m.to}</div>
                  <div>{m.text}</div>
                  <div className="text-[8px] text-[#b1f0ce]/60 mt-0.5">{m.time}</div>
                </div>
              ))}
              <div className="h-8"></div>
            </div>
            <div className="flex gap-2 border-t border-[#ffeae0] pt-3">
              <input
                value={msgTo}
                onChange={e => setMsgTo(e.target.value)}
                placeholder="Customer number"
                className="flex-1 px-3 py-2.5 rounded-xl border border-[#eddcd4] text-sm focus:border-[#0f5238] outline-none"
              />
              <input
                value={msgText}
                onChange={e => setMsgText(e.target.value)}
                placeholder={t('support.message', lang)}
                className="flex-1 px-3 py-2.5 rounded-xl border border-[#eddcd4] text-sm focus:border-[#0f5238] outline-none"
              />
              <button onClick={handleSendMsg} className="px-4 py-2.5 rounded-xl bg-[#0f5238] text-white font-bold text-sm">Send</button>
            </div>
          </div>
        )}
      </div>

      {/* Mask call overlay */}
      {callOpen && (
        <div className="fixed inset-0 z-50 bg-[#000] flex items-center justify-center">
          <div className="bg-[#271810] text-white rounded-3xl p-6 max-w-sm w-full shadow-2xl text-center">
            <div className="text-6xl font-black mb-2">📞</div>
            <div className="text-lg font-bold mb-1">{callNumber}</div>
            <div className="text-sm text-[#b1f0ce]/80 mb-6">Masked Call Active</div>
            <div className="text-xs text-[#b1f0ce]/50 mb-8">Your real number is hidden. Customer sees a ZENVEGO proxy number.</div>
            <button
              onClick={handleEndCall}
              className="w-full py-3 rounded-xl bg-[#ff5c3e] text-white font-black text-sm shadow-lg"
            >
            End Call
            </button>
          </div>
        </div>
      )}

      {/* QR scanner overlay */}
      {scannerOpen && (
        <div className="fixed inset-0 z-50 bg-[#000] flex flex-col items-center justify-center">
          <div className="relative w-[90vw] h-[55vh] rounded-3xl overflow-hidden bg-[#000] border border-white/20">
            <div id="qr-scanner-container" className="w-full h-full"></div>
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white text-sm font-bold bg-black/60 px-3 py-1.5 rounded-full">
              Point camera at QR code
            </div>
          </div>
          <button
            onClick={handleScanClose}
            className="mt-4 text-white text-xl font-bold bg-black/50 px-4 py-2 rounded-full"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
