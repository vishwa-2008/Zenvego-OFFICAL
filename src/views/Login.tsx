import React, { useState } from 'react';
import { ViewState, LoggedInUser, Lang } from '../types';
import { t } from '../utils/i18n';

interface LoginProps {
  setView: (view: ViewState) => void;
  onLoginSuccess: (user: LoggedInUser) => void;
  lang: Lang;
  t: (key: string, lang?: Lang) => string;
}

const DEMO_ROLES: { role: LoggedInUser['role']; label: string; color: string }[] = [
  { role: 'customer', label: 'Customer', color: '#0f5238' },
  { role: 'seller', label: 'Seller / Farmer', color: '#a24000' },
  { role: 'delivery', label: 'Delivery Partner', color: '#ff5c3e' },
];

export default function LoginView({ setView, onLoginSuccess, lang, t }: LoginProps) {
  const [selectedRole, setSelectedRole] = useState<LoggedInUser['role']>('customer');
  const [verifying, setVerifying] = useState(false);

  const handleGoogle = () => {
    setVerifying(true);
    setTimeout(() => {
      const user: LoggedInUser = {
        id: 'u_' + Math.random().toString(36).slice(2, 9),
        name: selectedRole === 'customer' ? 'Rahul Sharma' : selectedRole === 'seller' ? 'John Miller' : 'Alex River',
        emailOrPhone: selectedRole === 'customer' ? 'rahul@gmail.com' : selectedRole === 'seller' ? 'john@farm.com' : 'alex@zenvego.com',
        role: selectedRole,
        authMethod: 'google',
        avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf397f5d?auto=format&fit=crop&q=80&w=150',
      };
      setVerifying(false);
      onLoginSuccess(user);
    }, 900);
  };

  return (
    <div className="min-h-screen bg-[#fff8f6] text-[#271810] font-sans flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full space-y-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-12 h-12 rounded-full bg-[#0f5238] flex items-center justify-center text-white font-black text-xl shadow-lg">
            ZV
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight">{t('app.name', lang)}</h1>
            <p className="text-xs text-[#a24000] font-bold uppercase tracking-wider">{t('app.tagline', lang)}</p>
          </div>
        </div>

        <h2 className="text-2xl font-black text-center">{t('login.signIn', lang)}</h2>
        <p className="text-xs text-[#271810]/60 text-center">{t('login.register', lang)}</p>

        <div className="space-y-3">
          {DEMO_ROLES.map(r => (
            <button
              key={r.role}
              onClick={() => setSelectedRole(r.role)}
              className={`w-full py-3 rounded-2xl border font-bold text-xs transition-all flex items-center justify-center gap-2 ${
                selectedRole === r.role
                  ? `bg-${r.color === '#0f5238' ? 'primary' : r.color === '#a24000' ? 'tertiary' : 'secondary-container'} text-white shadow-sm border-${r.color === '#0f5238' ? 'primary' : r.color === '#a24000' ? 'tertiary' : 'secondary-container'}`
                  : 'border-[#eddcd4] bg-white text-[#271810]/80 hover:bg-[#fffaf8]'
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-black">{r.role === 'customer' ? '🛒' : r.role === 'seller' ? '🚜' : '🏍️'}</span>
              {r.label}
              {selectedRole === r.role && <span className="w-2 h-2 bg-white rounded-full"></span>}
            </button>
          ))}
        </div>

        <button
          onClick={handleGoogle}
          disabled={verifying}
          className="w-full py-4 rounded-2xl bg-white border-2 border-[#eddcd4] flex items-center justify-center gap-2 font-black text-xs shadow-sm hover:bg-[#fffaf8] transition-colors disabled:opacity-60"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.85c.87-2.6 3.3-4.53 6.16-4.53z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.85c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
          {verifying ? 'Registering...' : t('auth.google', lang)}
        </button>

        <p className="text-[10px] text-center text-[#271810]/40 uppercase tracking-widest font-bold">
          No phone OTP. No extra forms. Just register.
        </p>

        <button onClick={() => setView('landing')} className="w-full py-3 rounded-2xl text-[#0f5238] font-bold text-xs border border-[#0f5238]/20 hover:bg-[#0f5238]/5 transition-colors">
          Back to Home
        </button>
      </div>
    </div>
  );
}
