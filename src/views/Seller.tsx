import React, { useState } from 'react';
import { ViewState, LoggedInUser, CartItem, Product, OrderRecord, Lang } from '../types';
import { t } from '../utils/i18n';
import QrCodeRenderer from '../components/QrCodeRenderer';
import { captureFromCamera, readFileAsDataUrl } from '../lib/photo';
import { downloadOrderPdf } from '../lib/exportDocs';

interface SellerProps {
  setView: (view: ViewState) => void;
  setCurrentView: (view: ViewState) => void;
  sessionUser: LoggedInUser;
  lang: Lang;
  t: (key: string, lang?: Lang) => string;
  products: Product[];
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  addToast: (msg: string) => void;
  handleLogout: () => void;
  orders: OrderRecord[];
  setOrders: React.Dispatch<React.SetStateAction<OrderRecord[]>>;
  generateBill: (id: string) => void;
  activeMenu: 'add' | 'inventory' | 'orders' | 'bill' | 'profile' | null;
  openMenu: boolean;
  toggleMenu: (key: 'add' | 'inventory' | 'orders' | 'bill' | 'profile' | null) => void;
  cart: CartItem[];
  setCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
  addToCart: (product: Product) => void;
}

const SELLER_TABS: { key: 'inventory' | 'orders'; label: (lang: Lang) => string }[] = [
  { key: 'inventory', label: l => t('seller.inventory', l) },
  { key: 'orders', label: l => t('seller.myOrders', l) },
];

export default function SellerView({
  setView, setCurrentView, sessionUser, lang, t, products, setProducts, addToast, handleLogout,
  orders, setOrders, generateBill, activeMenu, openMenu, toggleMenu,
  cart, setCart, addToCart,
}: SellerProps) {
  const [sellerTab, setSellerTab] = useState<'inventory' | 'orders'>('inventory');
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ name: '', price: '', qty: '', unit: 'kg', category: 'Vegetables', desc: '' });
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [billOpen, setBillOpen] = useState(false);
  const [billOrder, setBillOrder] = useState<OrderRecord | null>(null);

  const myProducts = products.filter(p => p.farmer === sessionUser.name);
  const myOrders = orders.filter(o => o.sellerId === sessionUser.id || o.customerId === sessionUser.id).slice(0, 20);

  const handleAddProduct = () => {
    if (!form.name.trim() || !form.price || !form.qty || !form.desc.trim()) {
      addToast('Fill all fields'); return;
    }
    const newProduct: Product = {
      id: 'p' + Date.now(),
      name: form.name.trim(),
      price: Number(form.price),
      qty: Number(form.qty),
      unit: form.unit,
      category: form.category,
      image: photoUrl || 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&q=80&w=400',
      farm: sessionUser.name + ' Farm',
      farmer: sessionUser.name,
      desc: form.desc.trim(),
      organic: true,
    };
    setProducts(prev => [...prev, newProduct]);
    setForm({ name: '', price: '', qty: '', unit: 'kg', category: 'Vegetables', desc: '' });
    setPhotoUrl(null);
    setAddOpen(false);
    addToast('Item published');
  };

  const handleDeleteProduct = (id: string) => {
    setProducts(prev => prev.filter(p => p.id !== id));
    addToast('Item removed');
  };

  const handleCameraPhoto = async () => {
    try {
      const url = await captureFromCamera();
      setPhotoUrl(url);
    } catch (e) {
      addToast('Camera access denied');
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await readFileAsDataUrl(file);
    setPhotoUrl(url);
  };

  return (
    <div className="min-h-screen bg-[#fff8f6] text-[#271810] font-sans flex flex-col h-screen overflow-hidden">
      {/* Top nav */}
      <header className="h-14 bg-[#fff8f6] border-b border-[#ffeae0] px-4 flex items-center justify-between shrink-0">
        <button onClick={() => setCurrentView('login')} className="text-[12px] font-bold text-[#0f5238]">{t('common.back', lang)}</button>
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#271810]/70">
          {t('seller.dashboard', lang)}
        </div>
        <button onClick={handleLogout} className="text-[12px] font-bold text-[#ff5c3e]">{t('common.logout', lang)}</button>
      </header>

      {/* Slide-out menu */}
      <div className={`fixed inset-0 z-40 transition-all duration-300 ${
        openMenu ? 'translate-x-0' : '-translate-x-full'
      } bg-[#fff8f6] border-r border-[#ffeae0] w-full max-w-[320px] flex flex-col shadow-2xl`}>
        <div className="p-4 border-b border-[#ffeae0] flex justify-between items-center">
          <h3 className="font-bold text-sm">Menu</h3>
          <button onClick={() => toggleMenu(null)} className="text-[12px] font-bold text-[#271810]/50">{t('common.close', lang)}</button>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {[
            { key: 'inventory' as const, label: t('seller.inventory', lang), icon: '📦' },
            { key: 'orders' as const, label: t('seller.myOrders', lang), icon: '📋' },
            { key: 'bill' as const, label: t('seller.generateBill', lang), icon: '🧾' },
            { key: 'add' as const, label: t('seller.addItem', lang), icon: '➕' },
            { key: 'profile' as const, label: t('profile.title', lang), icon: '👤' },
          ].map(item => (
            <button
              key={item.key}
              onClick={() => {
                toggleMenu(item.key);
                if (item.key === 'bill') setBillOpen(true);
                else if (item.key === 'add') setAddOpen(true);
                else { setBillOpen(false); setAddOpen(false); }
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold text-left transition-all ${
                activeMenu === item.key
                  ? 'bg-[#0f5238] text-white shadow-sm'
                  : 'bg-white text-[#271810]/80 border border-[#eddcd4] hover:bg-[#fffaf8]'
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              {item.label}
            </button>
          ))}
          <div className="pt-4 border-t border-[#ffeae0]">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold text-left text-[#ff5c3e] border border-[#ffe2d5]"
            >
              <span>🚪</span> {t('common.logout', lang)}
            </button>
          </div>
        </nav>
      </div>

      {/* Menu overlay backdrop */}
      {openMenu && (
        <div className="fixed inset-0 z-30 bg-black/20 backdrop-blur-sm" onClick={() => toggleMenu(null)} />
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Header action bar */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black">{sellerTab === 'inventory' ? t('seller.inventory', lang) : t('seller.myOrders', lang)}</h2>
          <div className="flex gap-2">
            <button
              onClick={() => { setSellerTab('inventory'); toggleMenu('inventory'); }}
              className={`px-3 py-2 rounded-xl text-xs font-bold border ${sellerTab === 'inventory' ? 'bg-[#0f5238] text-white border-[#0f5238]' : 'bg-white text-[#271810]/60 border-[#eddcd4]'}`}
            >
              {t('seller.inventory', lang)}
            </button>
            <button
              onClick={() => { setSellerTab('orders'); toggleMenu('orders'); }}
              className={`px-3 py-2 rounded-xl text-xs font-bold border ${sellerTab === 'orders' ? 'bg-[#0f5238] text-white border-[#0f5238]' : 'bg-white text-[#271810]/60 border-[#eddcd4]'}`}
            >
              {t('seller.myOrders', lang)}
            </button>
            <button onClick={() => { setAddOpen(true); toggleMenu('add'); }} className="w-10 h-10 rounded-full bg-[#ff5c3e] text-white flex items-center justify-center text-lg shadow-sm">+</button>
          </div>
        </div>

        {sellerTab === 'inventory' && (
          <div className="space-y-3">
            {myProducts.length === 0 ? (
              <div className="text-center py-10">
                <div className="w-16 h-16 rounded-full bg-[#ffe9d3] flex items-center justify-center mx-auto text-[#a24000] font-black text-3xl mb-3">🚜</div>
                <p className="text-xs text-[#271810]/60">No items listed yet</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {myProducts.map(product => (
                  <div key={product.id} className="bg-white rounded-3xl p-3 border border-[#ffeae0] shadow-sm space-y-2 relative">
                    <div className="aspect-[4/5] rounded-2xl bg-[#ffe9d3] overflow-hidden">
                      <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between items-baseline">
                        <span className="font-bold text-sm truncate">{product.name}</span>
                        <span className="text-[#0f5238] font-black text-sm">₹{product.price}/{product.unit}</span>
                      </div>
                      <span className="text-[10px] text-[#271810]/60">{product.farm} • {product.qty} {product.unit}</span>
                      <p className="text-[10px] text-[#271810]/70 line-clamp-2">{product.desc}</p>
                    </div>
                    <button
                      onClick={() => handleDeleteProduct(product.id)}
                      className="w-full py-1.5 rounded-xl text-[10px] font-bold text-[#ff5c3e] border border-[#ffe2d5] bg-[#fff8f6]"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {sellerTab === 'orders' && (
          <div className="space-y-3">
            {myOrders.length === 0 ? (
              <div className="text-center py-10">
                <div className="w-16 h-16 rounded-full bg-[#ffe9d3] flex items-center justify-center mx-auto text-[#a24000] font-black text-3xl mb-3">📋</div>
                <p className="text-xs text-[#271810]/60">No orders yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {myOrders.map(order => (
                  <div key={order.id} className="bg-white p-3 rounded-2xl border border-[#ffeae0] shadow-sm space-y-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-bold text-sm">{order.orderNo}</div>
                        <div className="text-[10px] text-[#271810]/60">{order.customerName}</div>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        order.status === 'delivered' ? 'bg-[#b1f0ce] text-[#002114]' :
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
                      {!order.billGenerated && (
                        <button
                          onClick={() => { setBillOrder(order); setBillOpen(true); }}
                          className="flex-1 py-2 rounded-xl border border-[#0f5238] text-[#0f5238] text-[10px] font-bold text-center"
                        >
                          {t('seller.generateBill', lang)}
                        </button>
                      )}
                      {order.billGenerated && (
                        <button
                          onClick={() => downloadOrderPdf(order)}
                          className="flex-1 py-2 rounded-xl bg-[#0f5238] text-white text-[10px] font-bold text-center shadow-sm"
                        >
                          Download PDF
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: 'delivered' } : o));
                          addToast('Order marked delivered');
                        }}
                        className="flex-1 py-2 rounded-xl border border-[#eddcd4] text-[#271810]/60 text-[10px] font-bold text-center"
                      >
                        Mark Delivered
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add item modal */}
      {addOpen && (
        <div className="fixed inset-0 z-50 bg-[#271810]/60 flex items-end">
          <div className="w-full bg-white rounded-t-4xl p-5 max-h-[75vh] overflow-y-auto shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-black">{t('seller.addItem', lang)}</h3>
              <button onClick={() => { setAddOpen(false); toggleMenu(null); }} className="text-[12px] font-bold text-[#271810]/50">{t('common.close', lang)}</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-[#271810]/60 uppercase">Product Name</label>
                <input
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Organic Tomatoes"
                  className="w-full px-3 py-2.5 rounded-xl border border-[#eddcd4] text-sm focus:border-[#0f5238] outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-[#271810]/60 uppercase">Price (₹)</label>
                  <input
                    value={form.price}
                    onChange={e => setForm({ ...form, price: e.target.value })}
                    type="number"
                    className="w-full px-3 py-2.5 rounded-xl border border-[#eddcd4] text-sm focus:border-[#0f5238] outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-[#271810]/60 uppercase">Qty</label>
                  <input
                    value={form.qty}
                    onChange={e => setForm({ ...form, qty: e.target.value })}
                    type="number"
                    className="w-full px-3 py-2.5 rounded-xl border border-[#eddcd4] text-sm focus:border-[#0f5238] outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-[#271810]/60 uppercase">Unit</label>
                  <select
                    value={form.unit}
                    onChange={e => setForm({ ...form, unit: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl border border-[#eddcd4] text-sm focus:border-[#0f5238] outline-none bg-white"
                  >
                    <option>kg</option>
                    <option>bunch</option>
                    <option>loaf</option>
                    <option>jar</option>
                    <option>piece</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-[#271810]/60 uppercase">Category</label>
                  <select
                    value={form.category}
                    onChange={e => setForm({ ...form, category: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl border border-[#eddcd4] text-sm focus:border-[#0f5238] outline-none bg-white"
                  >
                    <option>Vegetables</option>
                    <option>Fruits</option>
                    <option>Bakery</option>
                    <option>Sweets</option>
                    <option>Dairy</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#271810]/60 uppercase">Description</label>
                <textarea
                  value={form.desc}
                  onChange={e => setForm({ ...form, desc: e.target.value })}
                  rows={2}
                  placeholder="Describe your produce..."
                  className="w-full px-3 py-2.5 rounded-xl border border-[#eddcd4] text-sm focus:border-[#0f5238] outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#271810]/60 uppercase mb-1 block">{t('item.photo', lang)}</label>
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={handleCameraPhoto}
                    className="flex-1 py-2.5 rounded-xl border border-[#0f5238] text-[#0f5238] text-[11px] font-bold text-center shadow-sm"
                  >
                    📷 {t('item.camera', lang)}
                  </button>
                  <button
                    onClick={() => document.getElementById('seller-file-input')?.click()}
                    className="flex-1 py-2.5 rounded-xl border border-[#eddcd4] text-[#271810]/60 text-[11px] font-bold text-center"
                  >
                    📁 {t('item.file', lang)}
                  </button>
                  <input
                    id="seller-file-input"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </div>
                {photoUrl && (
                  <div className="relative w-24 h-24 rounded-xl overflow-hidden border border-[#eddcd4] bg-[#ffe9d3]">
                    <img src={photoUrl} alt="preview" className="w-full h-full object-cover" />
                    <button onClick={() => setPhotoUrl(null)} className="absolute top-1 right-1 bg-black/60 text-white text-[10px] rounded-full p-1">✕</button>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => { setAddOpen(false); toggleMenu(null); }}
                className="flex-1 py-3 rounded-xl border border-[#eddcd4] text-[#271810]/60 font-bold text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleAddProduct}
                className="flex-1 py-3 rounded-xl bg-[#0f5238] text-white font-black text-sm shadow-lg"
              >
                {t('seller.publish', lang)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bill modal */}
      {billOpen && billOrder && (
        <div className="fixed inset-0 z-50 bg-[#271810]/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-5 max-w-md w-full shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-black">{t('bill.title', lang)}</h3>
              <button onClick={() => { setBillOpen(false); setBillOrder(null); }} className="text-[12px] font-bold text-[#271810]/50">{t('common.close', lang)}</button>
            </div>
            <div className="space-y-3 mb-4">
              <div className="flex justify-between text-sm">
                <span className="text-[#271810]/60">Order No</span>
                <span className="font-bold">{billOrder.orderNo}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#271810]/60">{t('bill.customerCopy', lang)}</span>
                <span className="font-bold">{billOrder.customerName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#271810]/60">{t('bill.total', lang)}</span>
                <span className="font-bold text-[#0f5238]">₹{billOrder.total.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#271810]/60">{t('bill.payment', lang)}</span>
                <span className="font-bold">{billOrder.paymentMethod === 'cod' ? t('payment.cod', lang) : t('payment.online', lang)}</span>
              </div>
            </div>
            <div className="bg-[#ffe9d3] rounded-2xl p-4 mb-4">
              <div className="flex items-center justify-center gap-3">
                <QrCodeRenderer text={`ZENVEGO_ORDER_${billOrder.orderNo}_${billOrder.total}`} size={140} />
                <div className="text-center">
                  <div className="text-[10px] text-[#271810]/60">{t('bill.qrScan', lang)}</div>
                  <div className="text-xs font-bold">Scan to Verify</div>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { generateBill(billOrder.id); setBillOpen(false); setBillOrder(null); }}
                className="flex-1 py-3 rounded-xl bg-[#0f5238] text-white font-black text-sm shadow-lg"
              >
                {t('bill.generate', lang)}
              </button>
              <button
                onClick={() => downloadOrderPdf(billOrder)}
                className="px-4 py-3 rounded-xl border border-[#eddcd4] text-[#271810]/60 font-bold text-sm"
              >
                PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
