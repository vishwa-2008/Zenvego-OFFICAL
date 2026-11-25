import React, { useState, useCallback } from 'react';
import { ViewState, LoggedInUser, CartItem, Product, OrderRecord, Lang } from '../types';
import { t } from '../utils/i18n';
import QrCodeRenderer from '../components/QrCodeRenderer';

interface CustomerProps {
  setView: (view: ViewState) => void;
  setCurrentView: (view: ViewState) => void;
  setActiveBillId: (id: string | null) => void;
  setLang: (lang: Lang) => void;
  cart: CartItem[];
  setCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
  addToCart: (product: Product) => void;
  removeFromCart: (id: string) => void;
  placeOrder: (paymentMethod: 'upi' | 'cod', address: string) => void;
  products: Product[];
  orders: OrderRecord[];
  sessionUser: LoggedInUser;
  lang: Lang;
  t: (key: string, lang?: Lang) => string;
  handleLogout: () => void;
}

const TAB_KEYS: { key: 'products' | 'orders' | 'cart' | 'profile'; label: (lang: Lang) => string }[] = [
  { key: 'products', label: l => t('nav.products', l) },
  { key: 'cart', label: l => t('nav.cart', l) || t('customer.cart', l) },
  { key: 'orders', label: l => t('nav.orders', l) },
  { key: 'profile', label: l => t('nav.profile', l) },
];

export default function CustomerView({
  setView, setCurrentView, setActiveBillId, setLang, cart, setCart, addToCart, removeFromCart,
  placeOrder, products, orders, sessionUser, lang, t, handleLogout,
}: CustomerProps) {
  const [activeTab, setActiveTab] = useState<'products' | 'cart' | 'orders' | 'profile'>('products');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'upi' | 'cod'>('cod');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportMsg, setSupportMsg] = useState('');
  const [supportMsgs, setSupportMsgs] = useState<string[]>([]);

  const cartTotal = cart.reduce((a, c) => a + c.price * c.quantity, 0);

  const checkoutProducts = cart.map(item => {
    const p = products.find(p => p.id === item.id);
    return p || { id: item.id, name: item.name, price: item.price, qty: item.quantity, unit: item.unit, category: '', image: '', farm: '', farmer: '', desc: '', organic: true };
  });

  const formatTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const handleCheckout = () => {
    if (!deliveryAddress.trim()) { alert('Please enter delivery address'); return; }
    placeOrder(paymentMethod, deliveryAddress);
    setCheckoutOpen(false);
  };

  const handleSupportSend = () => {
    if (!supportMsg.trim()) return;
    setSupportMsgs(prev => [...prev, supportMsg]);
    setSupportMsg('');
  };

  return (
    <div className="min-h-screen bg-[#fff8f6] text-[#271810] font-sans flex flex-col h-screen overflow-hidden">
      {/* Top nav */}
      <header className="h-14 bg-[#fff8f6] border-b border-[#ffeae0] px-4 flex items-center justify-between shrink-0">
        <button onClick={() => setCurrentView('login')} className="text-[12px] font-bold text-[#0f5238]">{t('common.back', lang)}</button>
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#271810]/70">
          {t('customer.browse', lang)}
        </div>
        <button onClick={() => setCheckoutOpen(!checkoutOpen)} className={`w-10 h-10 rounded-full flex items-center justify-center border ${
          cart.length > 0 ? 'bg-[#ff5c3e] text-white border-[#ff5c3e]' : 'bg-white text-[#271810] border-[#eddcd4]'
        } shadow-sm`}>
          {cart.length > 0 ? String(cart.length) : '0'}
        </button>
      </header>

      {/* Tab bar */}
      <div className="flex border-b border-[#ffeae0] shrink-0 overflow-x-auto pb-1">
        {TAB_KEYS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-3 whitespace-nowrap text-xs font-bold border-b-2 ${
              activeTab === tab.key
                ? 'border-[#ff5c3e] text-[#ff5c3e] bg-[#ffe9d3]'
                : 'border-transparent text-[#271810]/50 hover:bg-[#fffaf8]'
            }`}
          >
            {tab.label(lang)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {activeTab === 'products' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black">{t('customer.browse', lang)}</h2>
              <div className="flex gap-2">
                <button onClick={() => setLang('en')} className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${lang === 'en' ? 'bg-[#0f5238] text-white border-[#0f5238]' : 'bg-white text-[#271810]/60 border-[#eddcd4]'}`}>{t('lang.en', lang)}</button>
                <button onClick={() => setLang('te')} className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${lang === 'te' ? 'bg-[#0f5238] text-white border-[#0f5238]' : 'bg-white text-[#271810]/60 border-[#eddcd4]'}`}>{t('lang.te', lang)}</button>
                <button onClick={() => setLang('hi')} className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${lang === 'hi' ? 'bg-[#0f5238] text-white border-[#0f5238]' : 'bg-white text-[#271810]/60 border-[#eddcd4]'}`}>{t('lang.hi', lang)}</button>
                <button onClick={() => setLang('ta')} className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${lang === 'ta' ? 'bg-[#0f5238] text-white border-[#0f5238]' : 'bg-white text-[#271810]/60 border-[#eddcd4]'}`}>{t('lang.ta', lang)}</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {products.map(product => (
                <div key={product.id} className="bg-white rounded-3xl p-3 border border-[#ffeae0] shadow-sm space-y-2 relative overflow-hidden">
                  <div className="aspect-[4/5] rounded-2xl bg-[#ffe9d3] overflow-hidden relative">
                    <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
                    {product.organic && <span className="absolute top-2 left-2 bg-[#0f5238] text-white text-[10px] px-2 py-0.5 rounded-lg font-bold">Organic</span>}
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between items-baseline">
                      <span className="font-bold text-sm">{product.name}</span>
                      <span className="text-[#0f5238] font-black text-sm">₹{product.price}/{product.unit}</span>
                    </div>
                    <span className="text-[10px] text-[#271810]/60">{product.farm}</span>
                    <p className="text-[10px] text-[#271810]/70 line-clamp-2">{product.desc}</p>
                  </div>
                  <button
                    onClick={() => addToCart(product)}
                    disabled={product.qty <= 0}
                    className={`w-full py-2 rounded-xl font-bold text-xs transition-all ${
                      product.qty <= 0
                        ? 'bg-[#eededc] text-[#271810]/40 border border-[#eededc]'
                        : 'bg-[#0f5238] text-white shadow-sm hover:bg-[#0a3e2b]'
                    }`}
                  >
                    {product.qty <= 0 ? 'Out of Stock' : 'Add to Cart'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'cart' && (
          <div className="space-y-4">
            <h2 className="text-lg font-black">{t('customer.cart', lang)}</h2>
            {cart.length === 0 ? (
              <div className="text-center py-10">
                <div className="w-16 h-16 rounded-full bg-[#ffe9d3] flex items-center justify-center mx-auto text-[#a24000] font-black text-3xl mb-3">🛒</div>
                <p className="text-xs text-[#271810]/60">{t('customer.emptyCart', lang)}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {cart.map(item => (
                  <div key={item.id} className="flex items-center gap-3 bg-white p-3 rounded-2xl border border-[#ffeae0] shadow-sm">
                    <div className="w-16 h-16 rounded-2xl bg-[#ffe9d3] overflow-hidden flex-shrink-0">
                      <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm truncate">{item.name}</div>
                      <div className="flex justify-between items-center text-xs text-[#271810]/70 mt-1">
                        <span>{item.farm}</span>
                        <span>₹{item.price}/{item.unit}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => removeFromCart(item.id)} className="w-6 h-6 rounded-full bg-[#eededc] text-[#271810]/60 flex items-center justify-center text-[10px]">−</button>
                      <span className="w-6 text-center font-bold text-[10px]">{item.quantity}</span>
                      <button onClick={() => { const p = products.find(x => x.id === item.id); if (p) addToCart(p); }} className="w-6 h-6 rounded-full bg-[#0f5238] text-white flex items-center justify-center text-[10px] font-black">+</button>
                    </div>
                    <span className="text-[#0f5238] font-bold text-sm">₹{(item.price * item.quantity).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="bg-[#fff8f6] p-4 rounded-2xl border border-[#ffeae0]">
              <div className="flex justify-between text-sm font-bold mb-2">
                <span>{t('bill.total', lang)}</span>
                <span>₹{cartTotal.toFixed(2)}</span>
              </div>
              <button
                onClick={() => setCheckoutOpen(true)}
                className="w-full py-3 rounded-xl bg-[#ff5c3e] text-white font-black text-sm flex items-center justify-center gap-2 shadow-lg hover:bg-[#b5270e]"
              >
                {t('customer.checkout', lang)}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'orders' && (
          <div className="space-y-3">
            <h2 className="text-lg font-black">{t('customer.orders', lang)}</h2>
            {orders.filter(o => o.customerId === sessionUser.id).length === 0 ? (
              <div className="text-center py-10">
                <div className="w-16 h-16 rounded-full bg-[#ffe9d3] flex items-center justify-center mx-auto text-[#a24000] font-black text-3xl mb-3">📦</div>
                <p className="text-xs text-[#271810]/60">No orders yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {orders.filter(o => o.customerId === sessionUser.id).map(order => (
                  <div key={order.id} className="bg-white p-3 rounded-2xl border border-[#ffeae0] shadow-sm space-y-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-bold text-sm">{order.orderNo}</div>
                        <div className="text-[10px] text-[#271810]/60">{new Date(order.createdAt).toLocaleDateString()} • {formatTime(order.createdAt)}</div>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        order.status === 'delivered' ? 'bg-[#b1f0ce] text-[#002114]' :
                        order.status === 'assigned' ? 'bg-[#ffe9d3] text-[#a24000]' :
                        'bg-[#eededc] text-[#271810]/60'
                      }`}>{order.status}</span>
                    </div>
                    <div className="flex gap-2">
                      {order.items.map(it => (
                        <div key={it.id} className="w-10 h-10 rounded-lg bg-[#ffe9d3] overflow-hidden flex-shrink-0">
                          <img src={it.image} alt={it.name} className="w-full h-full object-cover" />
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between text-xs font-bold mt-2">
                      <span>{t('bill.payment', lang)}: {order.paymentMethod === 'cod' ? t('payment.cod', lang) : t('payment.online', lang)}</span>
                      <span>₹{order.total.toFixed(2)}</span>
                    </div>
                    <div className="flex gap-2 pt-2 border-t border-[#ffeae0]">
                      {order.billGenerated && (
                        <button
                          onClick={() => { setActiveBillId(order.id); setView('bill'); }}
                          className="flex-1 py-2 rounded-xl border border-[#0f5238] text-[#0f5238] text-[10px] font-bold text-center"
                        >
                          Download Bill
                        </button>
                      )}
                      <button onClick={() => alert('Order tracking coming soon')} className="flex-1 py-2 rounded-xl border border-[#eddcd4] text-[#271810]/60 text-[10px] font-bold text-center">Track</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'profile' && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-[#ffe9d3] flex items-center justify-center overflow-hidden">
                <img src={sessionUser.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf397f5d?auto=format&fit=crop&q=80&w=150'} alt="avatar" className="w-full h-full object-cover" />
              </div>
              <div>
                <div className="font-bold text-sm">{sessionUser.name}</div>
                <div className="text-[10px] text-[#271810]/60">{sessionUser.emailOrPhone}</div>
                <div className="text-[10px] text-[#0f5238] font-bold mt-0.5">{sessionUser.role === 'customer' ? 'Customer' : sessionUser.role === 'seller' ? 'Seller' : 'Delivery'}</div>
              </div>
            </div>

            <button
              onClick={() => setSupportOpen(true)}
              className="w-full py-3 rounded-xl border border-[#0f5238] text-[#0f5238] font-bold text-sm flex items-center justify-center gap-2 shadow-sm"
            >
              <span>💬</span> {t('common.support', lang)}
            </button>

            <button
              onClick={handleLogout}
              className="w-full py-3 rounded-xl border border-[#ff5c3e] text-[#ff5c3e] font-bold text-sm flex items-center justify-center gap-2 shadow-sm"
            >
              <span>🚪</span> {t('common.logout', lang)}
            </button>
          </div>
        )}
      </div>

      {/* Checkout overlay */}
      {checkoutOpen && (
        <div className="fixed inset-0 z-50 bg-[#271810]/60 flex items-end">
          <div className="w-full bg-white rounded-t-4xl p-5 max-h-[60vh] overflow-y-auto shadow-2xl">
            <h3 className="text-lg font-black mb-4">{t('customer.checkout', lang)}</h3>
            <div className="space-y-3 mb-4">
              <label className="text-xs font-bold text-[#271810]/70">Delivery Address</label>
              <input
                value={deliveryAddress}
                onChange={e => setDeliveryAddress(e.target.value)}
                placeholder="Home, street, landmark..."
                className="w-full px-3 py-2.5 rounded-xl border border-[#eddcd4] text-sm focus:border-[#0f5238] outline-none"
              />
            </div>
            <div className="space-y-2 mb-4">
              <label className="text-xs font-bold text-[#271810]/70">Payment Method</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setPaymentMethod('cod')}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-bold border ${
                    paymentMethod === 'cod' ? 'bg-[#ff5c3e] text-white border-[#ff5c3e]' : 'bg-white text-[#271810]/60 border-[#eddcd4]'
                  }`}>
                    {t('payment.cod', lang)}
                  </button>
                <button
                  onClick={() => setPaymentMethod('upi')}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-bold border ${
                    paymentMethod === 'upi' ? 'bg-[#0f5238] text-white border-[#0f5238]' : 'bg-white text-[#271810]/60 border-[#eddcd4]'
                  }`}>
                    {t('payment.online', lang)}
                  </button>
              </div>
            </div>
            <div className="flex justify-between text-sm font-bold mb-4 pt-3 border-t border-[#ffeae0]">
              <span>Total</span>
              <span>₹{cartTotal.toFixed(2)}</span>
            </div>
            <button
              onClick={handleCheckout}
              className="w-full py-3.5 rounded-xl bg-[#0f5238] text-white font-black text-lg shadow-lg hover:bg-[#0a3e2b]"
            >
              {t('customer.placeOrder', lang)}
            </button>
            <button onClick={() => setCheckoutOpen(false)} className="w-full py-2.5 rounded-xl text-xs font-bold text-[#271810]/60 border border-[#eddcd4] mt-2">Cancel</button>
          </div>
        </div>
      )}

      {/* Support overlay */}
      {supportOpen && (
        <div className="fixed inset-0 z-50 bg-[#271810]/60 flex items-end">
          <div className="w-full bg-white rounded-t-4xl p-5 shadow-2xl max-h-[70vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-black">{t('support.title', lang)}</h3>
              <button onClick={() => setSupportOpen(false)} className="text-[12px] font-bold text-[#271810]/50">{t('common.close', lang)}</button>
            </div>
            <div className="bg-[#f3f4f6] rounded-3xl p-3 mb-4 h-40 overflow-y-auto space-y-2">
              {supportMsgs.map((m, i) => (
                <div key={i} className="max-w-[80%] self-end bg-[#0f5238] text-white text-xs rounded-3xl rounded-tl-none p-2">{m}</div>
              ))}
              <div className="h-8"></div>
            </div>
            <div className="flex gap-2">
              <input
                value={supportMsg}
                onChange={e => setSupportMsg(e.target.value)}
                placeholder={t('support.message', lang)}
                className="flex-1 px-3 py-2.5 rounded-xl border border-[#eddcd4] text-sm focus:border-[#0f5238] outline-none"
              />
              <button onClick={handleSupportSend} className="px-4 py-2.5 rounded-xl bg-[#0f5238] text-white font-bold text-sm">Send</button>
            </div>
            <p className="text-[10px] text-[#271810]/50 mt-2 text-center">Support will reply shortly.</p>
          </div>
        </div>
      )}
    </div>
  );
}
