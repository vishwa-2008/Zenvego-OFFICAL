import React, { useState } from 'react';
import { ViewState, Lang } from '../types';
import { t } from '../utils/i18n';

interface LandingProps {
  setView: (view: ViewState) => void;
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, lang?: Lang) => string;
}

export default function Landing({ setView, lang, setLang, t }: LandingProps) {
  const handleGetStarted = () => {
    setView('login');
  };

  return (
    <div className="min-h-screen bg-[#fff8f6] text-[#271810] font-sans flex flex-col">
      {/* Header */}
      <header className="px-4 py-6 bg-[#fff8f6] border-b border-[#ffeae0]/50">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-full bg-[#0f5238] flex items-center justify-center text-white font-black text-lg shadow-lg">
            ZV
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight">{t('app.name', lang)}</h1>
            <p className="text-xs text-[#a24000] font-bold uppercase tracking-wider">{t('app.tagline', lang)}</p>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="flex-1 px-4 py-8 max-w-md mx-auto w-full space-y-8">
        <div className="space-y-3 text-center">
          <h2 className="text-3xl font-black leading-tight">{t('landing.title1', lang)}<br /><span className="text-[#0f5238]">{t('landing.title2', lang)}</span></h2>
          <p className="text-sm text-[#271810]/80 leading-relaxed">{t('landing.subtitle', lang)}</p>
        </div>

        <div className="bg-[#ffeae0] rounded-3xl p-6 border border-[#ffe2d5] shadow-sm space-y-4">
          <div className="flex items-center gap-3 text-sm font-semibold text-[#271810]">
            <span className="w-8 h-8 rounded-full bg-[#b1f0ce] flex items-center justify-center text-[#002114] text-xs font-bold">1</span>
            <span>Farmers list fresh produce</span>
          </div>
          <div className="flex items-center gap-3 text-sm font-semibold text-[#271810]">
            <span className="w-8 h-8 rounded-full bg-[#b1f0ce] flex items-center justify-center text-[#002114] text-xs font-bold">2</span>
            <span>Customers discover nearby products</span>
          </div>
          <div className="flex items-center gap-3 text-sm font-semibold text-[#271810]">
            <span className="w-8 h-8 rounded-full bg-[#b1f0ce] flex items-center justify-center text-[#002114] text-xs font-bold">3</span>
            <span>Orders delivered fast</span>
          </div>
        </div>

        <div className="bg-[#0f5238] rounded-3xl p-6 text-white shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-left">
              <p className="text-xs text-[#b1f0ce] font-bold uppercase tracking-wider">{t('common.about', lang) || 'About ZENVEGO'}</p>
              <h3 className="text-lg font-bold">{t('landing.about', lang)}</h3>
            </div>
          </div>
          <p className="text-xs text-[#fff8f6]/80 leading-relaxed">{t('landing.howItWorks', lang)}</p>
        </div>

        <button
          onClick={handleGetStarted}
          className="w-full py-5 rounded-3xl bg-[#ff5c3e] text-white font-black text-lg flex items-center justify-center gap-2 shadow-lg hover:bg-[#b5270e] transition-colors"
        >
          {t('landing.getStarted', lang)}
          <span>→</span>
        </button>
      </section>

      {/* Footer */}
      <footer className="px-4 py-6 border-t border-[#ffeae0]/50 bg-[#fff8f6]">
        <div className="max-w-md mx-auto w-full text-center space-y-3">
          <div className="flex items-center justify-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#0f5238] flex items-center justify-center text-white font-black text-lg">
              ZV
            </div>
            <span className="text-sm font-bold">{t('app.name', lang)}</span>
          </div>
          <p className="text-[10px] text-[#271810]/50 uppercase tracking-widest font-bold">
            ZENVEGO - Hyperlocal Fresh Produce Marketplace
          </p>
          <div className="flex justify-center gap-4 text-xs text-[#271810]/40">
            <span>{t('common.language', lang)}</span>
            <button onClick={() => setLang('en')} className={lang === 'en' ? 'text-[#0f5238] font-bold' : 'text-[#271810]/50'}>{t('lang.en', lang)}</button>
            <button onClick={() => setLang('te')} className={lang === 'te' ? 'text-[#0f5238] font-bold' : 'text-[#271810]/50'}>{t('lang.te', lang)}</button>
            <button onClick={() => setLang('hi')} className={lang === 'hi' ? 'text-[#0f5238] font-bold' : 'text-[#271810]/50'}>{t('lang.hi', lang)}</button>
            <button onClick={() => setLang('ta')} className={lang === 'ta' ? 'text-[#0f5238] font-bold' : 'text-[#271810]/50'}>{t('lang.ta', lang)}</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
