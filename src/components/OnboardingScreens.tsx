import React, { useState } from 'react';
import { HOTLINK_IMAGES } from '../data/mockData';
import { ScreenId, UserRole } from '../types';
import { SmartImage, ZenvegoLogo } from './ZenvegoLogo';

interface WelcomeScreenProps {
  selectedRole: UserRole;
  activeSignedInRole?: UserRole;
  isAuthenticated: boolean;
  userDisplayName?: string | null;
  onSelectRole: (role: UserRole) => void;
  onGetStarted: (role: UserRole) => void;
  onGoToSignIn: (targetRole: UserRole) => void;
  onSignOutAndSwitchPortal?: (targetRole: UserRole) => Promise<void>;
}

const ROLE_OPTIONS: {
  id: UserRole;
  title: string;
  ctaLabel: string;
  description: string;
  icon: string;
  popular?: boolean;
}[] = [
  {
    id: 'customer',
    title: 'Customer / Household',
    ctaLabel: 'Customer',
    description: 'Shop fresh produce from neighborhood growers & track delivery live',
    icon: 'shopping_cart',
    popular: true,
  },
  {
    id: 'grower',
    title: 'Grower / Farmer',
    ctaLabel: 'Grower / Farmer',
    description: 'List daily terrace or farm harvests & fulfil local orders',
    icon: 'psychiatry',
  },
  {
    id: 'delivery',
    title: 'Delivery Partner',
    ctaLabel: 'Delivery Partner',
    description: 'Claim local harvest pickups, verify QR handshakes & deliver fast',
    icon: 'two_wheeler',
  },
  {
    id: 'bulk',
    title: 'Institutional / Bulk',
    ctaLabel: 'Bulk Buyer',
    description: 'Request wholesale quotes for restaurants, cafés, hostels & apartments',
    icon: 'apartment',
  },
];

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  selectedRole,
  activeSignedInRole,
  isAuthenticated,
  userDisplayName,
  onSelectRole,
  onGetStarted,
  onGoToSignIn,
  onSignOutAndSwitchPortal,
}) => {
  const currentMeta = ROLE_OPTIONS.find((r) => r.id === selectedRole) ?? ROLE_OPTIONS[0];
  const signedInMeta =
    ROLE_OPTIONS.find((r) => r.id === (activeSignedInRole || selectedRole)) ?? ROLE_OPTIONS[0];
  const isDifferentPortalWhileSignedIn =
    isAuthenticated && activeSignedInRole && selectedRole !== activeSignedInRole;

  return (
    <div className="flex flex-col w-full pb-10">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left / Top Brand Hero Showcase */}
        <div className="lg:col-span-6 flex flex-col">
          <div className="relative w-full h-full rounded-3xl bg-surface-container-low shadow-sm overflow-hidden flex flex-col items-center justify-between pt-7 pb-6 px-5">
            <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-secondary-fixed/25 blur-2xl pointer-events-none" />
            <div className="absolute -bottom-8 -left-8 w-44 h-44 rounded-full bg-primary-fixed/20 blur-2xl pointer-events-none" />

            {/* Original Seamlessly Blended Logo Lockup */}
            <div className="relative z-10 flex flex-col items-center text-center">
              <div className="w-24 h-24 flex items-center justify-center mb-1.5">
                <ZenvegoLogo variant="emblem" className="w-full h-full drop-shadow-sm" />
              </div>
              <div className="w-60 max-w-full flex justify-center">
                <ZenvegoLogo variant="wordmark" className="h-12 w-auto" />
              </div>
              <p className="text-[15px] font-semibold text-secondary italic tracking-wide mt-1">
                Freshness from our farms
              </p>
            </div>

            {/* Farm Fresh Wicker Basket Visual Anchor */}
            <div className="relative w-full mt-5 rounded-2xl overflow-hidden shadow-sm bg-surface-container-highest">
              <SmartImage
                src={HOTLINK_IMAGES.heroBasket}
                alt="Sunlit woven wicker basket brimming with freshly harvested tomatoes, organic palak, and garden carrots"
                className="w-full h-52 lg:h-64 object-cover object-center"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-primary/70 via-primary/10 to-transparent" />
              <div className="absolute bottom-3 left-3 bg-surface-container-lowest/95 backdrop-blur-md px-3 py-1.5 rounded-full flex items-center gap-2 shadow-sm">
                <span className="material-symbols-outlined text-secondary text-[15px]">eco</span>
                <span className="text-[11px] text-primary font-bold">
                  Hyperlocal Terrace &amp; Urban Harvest Network
                </span>
              </div>
            </div>

            {/* Tagline & Mission */}
            <div className="mt-5 text-center px-1">
              <h2 className="text-[22px] lg:text-[26px] font-extrabold text-primary tracking-tight leading-tight text-balance">
                Grow Local. Buy Fresh. Deliver Fast.
              </h2>
              <p className="text-sm text-on-surface-variant mt-1.5 leading-relaxed max-w-md mx-auto">
                Direct farm-to-table logistics connecting terrace gardens, local micro-farms, institutional kitchens, and conscious neighborhoods.
              </p>
            </div>
          </div>
        </div>

        {/* Right / Bottom Value Pillars + Role Selector + CTA */}
        <div className="lg:col-span-6 flex flex-col justify-between gap-5">
          {/* 4 Key Value Pillars */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="bg-surface-container-lowest p-3.5 rounded-2xl shadow-sm flex items-start gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-surface-container flex items-center justify-center shrink-0 text-primary">
                <span className="material-symbols-outlined material-symbols-filled text-[20px]">eco</span>
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-on-surface">Zero Cold Storage</div>
                <div className="text-xs text-on-surface-variant mt-0.5 truncate">Cut &amp; harvested same-day</div>
              </div>
            </div>
            <div className="bg-surface-container-lowest p-3.5 rounded-2xl shadow-sm flex items-start gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-surface-container flex items-center justify-center shrink-0 text-primary">
                <span className="material-symbols-outlined material-symbols-filled text-[20px]">roofing</span>
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-on-surface">Terrace &amp; Urban</div>
                <div className="text-xs text-on-surface-variant mt-0.5 truncate">Verified neighborhood farms</div>
              </div>
            </div>
            <div className="bg-surface-container-lowest p-3.5 rounded-2xl shadow-sm flex items-start gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-surface-container flex items-center justify-center shrink-0 text-primary">
                <span className="material-symbols-outlined material-symbols-filled text-[20px]">qr_code_2</span>
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-on-surface">Signed QR Handshake</div>
                <div className="text-xs text-on-surface-variant mt-0.5 truncate">Verified pickup &amp; drop</div>
              </div>
            </div>
            <div className="bg-surface-container-lowest p-3.5 rounded-2xl shadow-sm flex items-start gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-surface-container flex items-center justify-center shrink-0 text-primary">
                <span className="material-symbols-outlined material-symbols-filled text-[20px]">volunteer_activism</span>
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-on-surface">90% Grower Payable</div>
                <div className="text-xs text-on-surface-variant mt-0.5 truncate">Transparent seller ledger</div>
              </div>
            </div>
          </div>

          {/* Interactive Choose Your Role Section */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-extrabold text-primary uppercase tracking-wider">
                Choose Your Workspace
              </span>
              <span className="text-xs text-on-surface-variant font-medium">
                {isAuthenticated && userDisplayName ? `Signed in as ${userDisplayName}` : 'Sign in required to transact'}
              </span>
            </div>

            {ROLE_OPTIONS.map((role) => {
              const isSelected = selectedRole === role.id;
              return (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => onSelectRole(role.id)}
                  className={`w-full text-left p-3.5 rounded-2xl transition-all duration-150 active:scale-[0.99] flex items-center justify-between gap-3 cursor-pointer ${
                    isSelected
                      ? 'bg-surface-container-low ring-2 ring-primary/25 shadow-sm'
                      : 'bg-surface-container-lowest hover:bg-surface-container-low/60 shadow-sm'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                        isSelected
                          ? 'bg-primary-container text-on-primary'
                          : 'bg-surface-container text-primary'
                      }`}
                    >
                      <span className="material-symbols-outlined material-symbols-filled text-[22px]">
                        {role.icon}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[15px] font-bold text-on-surface truncate">
                          {role.title}
                        </span>
                        {role.popular && (
                          <span className="text-[11px] font-bold text-on-secondary-container bg-secondary-container px-2 py-0.5 rounded-full shrink-0">
                            Popular
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-on-surface-variant mt-0.5 truncate">
                        {role.description}
                      </p>
                    </div>
                  </div>
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                      isSelected
                        ? 'bg-primary text-on-primary'
                        : 'bg-surface-container text-transparent'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[15px]">check</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Primary CTA + Strict Separate Portal Guard */}
          <div className="flex flex-col gap-3">
            {isDifferentPortalWhileSignedIn ? (
              <>
                <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3.5 text-xs text-amber-950 space-y-1">
                  <div className="font-extrabold flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-amber-700">lock</span>
                    <span>Direct Portal Shifting Is Disabled</span>
                  </div>
                  <p className="leading-snug">
                    You are currently signed into the <strong>{signedInMeta.ctaLabel}</strong> portal. To enter the{' '}
                    <strong>{currentMeta.ctaLabel}</strong> portal, sign out first and sign in (or create a separate account) for{' '}
                    {currentMeta.ctaLabel}.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => onSignOutAndSwitchPortal?.(selectedRole)}
                  className="w-full h-14 bg-primary-container hover:bg-primary text-on-primary rounded-2xl text-[15px] font-bold flex items-center justify-center gap-2 shadow-lg shadow-primary-container/20 active:scale-[0.98] transition-all cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[20px]">logout</span>
                  <span>Sign Out &amp; Login to {currentMeta.ctaLabel} Portal</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() =>
                  isAuthenticated ? onGetStarted(activeSignedInRole || selectedRole) : onGoToSignIn(selectedRole)
                }
                className="w-full h-14 bg-primary-container hover:bg-primary text-on-primary rounded-2xl text-[15px] font-bold flex items-center justify-center gap-2 shadow-lg shadow-primary-container/20 active:scale-[0.98] transition-all cursor-pointer"
              >
                <span>
                  {isAuthenticated
                    ? `Continue to ${signedInMeta.ctaLabel} Portal`
                    : `Sign In / Register as ${currentMeta.ctaLabel}`}
                </span>
                <span className="material-symbols-outlined text-[22px]">arrow_forward</span>
              </button>
            )}

            {!isAuthenticated && (
              <div className="flex items-center justify-center gap-1.5 py-0.5">
                <span className="text-sm text-on-surface-variant">Separate account per portal ·</span>
                <button
                  type="button"
                  onClick={() => onGoToSignIn(selectedRole)}
                  className="text-sm font-bold text-secondary underline hover:text-primary transition-colors cursor-pointer"
                >
                  Sign In / Create Account
                </button>
              </div>
            )}
          </div>

          {/* Trust & Official Contact Footer */}
          <div className="bg-surface-container-low rounded-2xl p-4 flex flex-col items-center text-center space-y-2">
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-on-surface-variant">
              <div className="flex items-center gap-1 text-xs font-semibold">
                <span className="material-symbols-outlined text-[16px] text-secondary">eco</span>
                Same-Day Local Harvest
              </div>
              <span className="text-outline-variant" aria-hidden="true">·</span>
              <div className="flex items-center gap-1 text-xs font-semibold">
                <span className="material-symbols-outlined text-[16px] text-secondary">location_on</span>
                OpenStreetMap Serviceability
              </div>
            </div>
            <p className="text-xs text-on-surface-variant/85 max-w-sm leading-normal">
              Connecting Local Farmers, Sellers, Delivery Partners &amp; Buyers on One Real-Time Ledger.
            </p>
            <div className="pt-2 border-t border-outline-variant/20 w-full flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs">
              <a
                href="https://www.instagram.com/zenvego.in/?utm_source=ig_web_button_share_sheet"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-bold text-primary hover:underline"
              >
                <span className="material-symbols-outlined text-[15px]">photo_camera</span>
                <span>Instagram: @zenvego.in</span>
              </a>
              <span className="text-outline-variant hidden sm:inline" aria-hidden="true">·</span>
              <a
                href="mailto:zenvego.in@gmail.com"
                className="inline-flex items-center gap-1 font-bold text-primary hover:underline"
              >
                <span className="material-symbols-outlined text-[15px]">mail</span>
                <span>Queries: zenvego.in@gmail.com</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface LoginScreenProps {
  selectedRole: UserRole;
  isAuthenticated: boolean;
  userEmail?: string | null;
  userEmailVerified?: boolean;
  userDisplayName?: string | null;
  authLoading: boolean;
  authError: string | null;
  onSelectRole: (role: UserRole) => void;
  onClearAuthError?: () => void;
  onGoogleSignIn: (role: UserRole, mode: 'signin' | 'signup') => Promise<void>;
  onSendEmailSignInLink: (email: string, role: UserRole, mode: 'signin' | 'signup') => Promise<void>;
  onSendVerificationEmail: () => Promise<void>;
  onRefreshVerificationStatus: () => Promise<boolean>;
  onSignOut: () => Promise<void>;
  onContinueToPortal: () => void;
  onOpenProfile?: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  selectedRole,
  isAuthenticated,
  userEmail,
  userEmailVerified = false,
  userDisplayName,
  authLoading,
  authError,
  onSelectRole,
  onClearAuthError,
  onGoogleSignIn,
  onSendEmailSignInLink,
  onSendVerificationEmail,
  onRefreshVerificationStatus,
  onSignOut,
  onContinueToPortal,
  onOpenProfile,
}) => {
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [emailInput, setEmailInput] = useState('');
  const [emailLinkSentTo, setEmailLinkSentTo] = useState<string | null>(null);
  const [emailLinkBusy, setEmailLinkBusy] = useState(false);
  const [emailLinkError, setEmailLinkError] = useState<string | null>(null);
  const [verifMsg, setVerifMsg] = useState<string | null>(null);
  const [verifBusy, setVerifBusy] = useState(false);

  const roleLabels: Record<UserRole, string> = {
    customer: 'Customer',
    grower: 'Seller / Grower',
    delivery: 'Delivery Partner',
    bulk: 'Bulk Buyer',
  };

  const roleHints: Record<UserRole, string> = {
    customer: 'Order fresh daily harvests & track delivery',
    grower: 'Requires Live Photo & Seller KYC Verification',
    delivery: 'Requires Live Photo & Vehicle/ID KYC Verification',
    bulk: 'Submit institutional enquiries & review farm quotes',
  };

  const isNoPortalAccountError = Boolean(
    authError && authError.toLowerCase().includes('create a new account')
  );

  return (
    <div className="flex flex-col w-full max-w-md mx-auto gap-4 pb-10">
      {/* Top Brand Header — Seamlessly Blended Original Logos */}
      <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-13 h-13 rounded-full bg-surface-container-low/70 flex items-center justify-center shrink-0 p-1">
            <ZenvegoLogo variant="emblem" className="w-full h-full" />
          </div>
          <div className="flex flex-col min-w-0">
            <ZenvegoLogo variant="wordmark" className="h-7 w-auto object-left" />
            <span className="text-[11px] font-semibold text-on-surface-variant truncate mt-0.5">
              Grow Local. Buy Fresh. Deliver Fast.
            </span>
          </div>
        </div>
      </div>

      {/* Portal Selector (ONLY Available When Signed Out — Direct Portal Shifting Disabled) */}
      {!isAuthenticated && (
        <>
          {/* Explicit Sign In vs Create New Account Switcher */}
          <div className="grid grid-cols-2 gap-1 bg-surface-container-low p-1 rounded-xl border border-outline-variant/20">
            <button
              type="button"
              onClick={() => {
                setAuthMode('signin');
                onClearAuthError?.();
              }}
              className={`h-10 rounded-lg text-xs font-extrabold transition-all cursor-pointer ${
                authMode === 'signin'
                  ? 'bg-primary text-on-primary shadow-sm'
                  : 'text-on-surface-variant hover:text-primary'
              }`}
            >
              Sign In (Existing)
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode('signup');
                onClearAuthError?.();
              }}
              className={`h-10 rounded-lg text-xs font-extrabold transition-all cursor-pointer ${
                authMode === 'signup'
                  ? 'bg-primary text-on-primary shadow-sm'
                  : 'text-on-surface-variant hover:text-primary'
              }`}
            >
              Create New Account
            </button>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-semibold text-on-surface-variant">
                {authMode === 'signin' ? 'Sign in to Portal' : 'Register Portal Account'}
              </span>
              <span className="text-xs font-medium text-secondary truncate ml-2">{roleHints[selectedRole]}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 bg-surface-container-low p-1 rounded-xl">
              {(
                [
                  { id: 'customer', label: 'Customer', icon: 'shopping_bag' },
                  { id: 'grower', label: 'Grower', icon: 'potted_plant' },
                  { id: 'delivery', label: 'Partner', icon: 'two_wheeler' },
                  { id: 'bulk', label: 'Bulk', icon: 'apartment' },
                ] as const
              ).map((r) => {
                const active = selectedRole === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      onSelectRole(r.id);
                      onClearAuthError?.();
                    }}
                    className={`h-10 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      active
                        ? 'bg-primary text-on-primary shadow-sm'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[17px]">{r.icon}</span>
                    <span className="truncate">{r.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Main Firebase Auth Card */}
      <div className="bg-surface-container-lowest rounded-2xl p-5 shadow-sm flex flex-col gap-4 border border-outline-variant/20">
        {isAuthenticated ? (
          <>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-container-low">
              <div className="w-11 h-11 rounded-full bg-primary text-on-primary flex items-center justify-center font-bold text-base shrink-0">
                {(userDisplayName || userEmail || 'Z').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-on-surface truncate">{userDisplayName || 'Zenvego User'}</p>
                <p className="text-xs text-on-surface-variant truncate">{userEmail}</p>
              </div>
              <span
                className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full shrink-0 ${
                  userEmailVerified
                    ? 'text-secondary bg-secondary-container/60'
                    : 'text-amber-900 bg-amber-100'
                }`}
              >
                {userEmailVerified ? 'Email Verified' : 'Unverified'}
              </span>
            </div>

            {!userEmailVerified && (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 space-y-2.5">
                <p className="text-xs text-amber-950 font-semibold">
                  Verify your email address to unlock Firestore orders, wallet top-ups, and profile updates.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={verifBusy}
                    onClick={async () => {
                      setVerifBusy(true);
                      setVerifMsg(null);
                      try {
                        await onSendVerificationEmail();
                        setVerifMsg('Verification email link sent! Check your inbox and spam folder.');
                      } catch (e) {
                        setVerifMsg(e instanceof Error ? e.message : 'Could not send verification link.');
                      } finally {
                        setVerifBusy(false);
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-bold cursor-pointer disabled:opacity-60"
                  >
                    {verifBusy ? 'Sending...' : 'Send Verification Email Link'}
                  </button>
                  <button
                    type="button"
                    disabled={verifBusy}
                    onClick={async () => {
                      setVerifBusy(true);
                      try {
                        const verified = await onRefreshVerificationStatus();
                        setVerifMsg(
                          verified
                            ? 'Email verified successfully!'
                            : 'Still pending verification. Click the link in your email first.'
                        );
                      } finally {
                        setVerifBusy(false);
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-950 text-xs font-bold cursor-pointer"
                  >
                    I&apos;ve Verified — Refresh
                  </button>
                </div>
                {verifMsg && <p className="text-[11px] font-semibold text-primary">{verifMsg}</p>}
              </div>
            )}

            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-950">
              <p className="font-extrabold">Active Portal: {roleLabels[selectedRole]}</p>
              <p className="text-[11px] mt-0.5 text-emerald-900">
                Direct portal switching is disabled. To log into or register a different portal, sign out first.
              </p>
            </div>

            <button
              type="button"
              onClick={() => onContinueToPortal()}
              className="w-full h-12 rounded-xl bg-primary-container hover:bg-primary text-on-primary text-sm font-bold shadow-md flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Continue to {roleLabels[selectedRole]} Portal</span>
              <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
            </button>

            {onOpenProfile && (
              <button
                type="button"
                onClick={onOpenProfile}
                className="w-full h-11 rounded-xl bg-secondary-container/70 hover:bg-secondary-container text-on-secondary-container text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">person</span>
                <span>Edit My Profile, Avatar &amp; Addresses</span>
              </button>
            )}

            <button
              type="button"
              onClick={onSignOut}
              className="w-full h-11 rounded-xl bg-red-50 hover:bg-red-100 text-red-800 text-xs font-extrabold cursor-pointer flex items-center justify-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[17px]">logout</span>
              <span>Sign Out to Switch Portal</span>
            </button>
          </>
        ) : (
          <>
            <div className="space-y-1">
              <h2 className="text-lg font-extrabold text-primary">
                {authMode === 'signin'
                  ? `Sign in to ${roleLabels[selectedRole]} Portal`
                  : `Create ${roleLabels[selectedRole]} Account`}
              </h2>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                {authMode === 'signin'
                  ? `Sign in to your existing ${roleLabels[selectedRole]} account. Haven't registered for the ${roleLabels[selectedRole]} portal yet? Switch to "Create New Account" above.`
                  : `Create a separate ${roleLabels[selectedRole]} account on Zenvego. ${
                      selectedRole === 'grower' || selectedRole === 'delivery'
                        ? 'Live camera photo verification and full KYC are required right after registration.'
                        : 'Set up your profile and delivery location right after registration.'
                    }`}
              </p>
            </div>

            {authError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 font-medium space-y-2">
                <p>{authError}</p>
                {isNoPortalAccountError && authMode === 'signin' && (
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('signup');
                      onClearAuthError?.();
                    }}
                    className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-[11px] font-extrabold cursor-pointer"
                  >
                    Switch to &ldquo;Create New Account&rdquo; for {roleLabels[selectedRole]} →
                  </button>
                )}
              </div>
            )}

            {/* 1. Google Sign-In / Registration */}
            <button
              type="button"
              disabled={authLoading}
              onClick={() => onGoogleSignIn(selectedRole, authMode)}
              className="w-full h-13 rounded-xl bg-primary-container hover:bg-primary text-on-primary shadow-md transition-all flex items-center justify-center gap-3 text-sm font-bold px-4 cursor-pointer disabled:opacity-60"
            >
              <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center shrink-0">
                <svg aria-hidden="true" className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
              </div>
              <span>
                {authLoading
                  ? 'Connecting with Google...'
                  : authMode === 'signin'
                    ? `Sign In to ${roleLabels[selectedRole]} with Google`
                    : `Register ${roleLabels[selectedRole]} Account with Google`}
              </span>
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3 my-0.5">
              <div className="flex-1 h-px bg-outline-variant/40" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                Or Email Verification Link
              </span>
              <div className="flex-1 h-px bg-outline-variant/40" />
            </div>

            {/* 2. Passwordless Verification Email Link Sign-In */}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const cleaned = emailInput.trim();
                if (!cleaned || !cleaned.includes('@')) {
                  setEmailLinkError('Enter a valid email address to receive your verification link.');
                  return;
                }
                setEmailLinkBusy(true);
                setEmailLinkError(null);
                setEmailLinkSentTo(null);
                try {
                  await onSendEmailSignInLink(cleaned, selectedRole, authMode);
                  setEmailLinkSentTo(cleaned);
                } catch (err) {
                  setEmailLinkError(
                    err instanceof Error ? err.message : 'Failed to send verification email link.'
                  );
                } finally {
                  setEmailLinkBusy(false);
                }
              }}
              className="space-y-2.5"
            >
              <label className="block text-xs font-bold text-on-surface">
                {authMode === 'signin'
                  ? `Sign in to ${roleLabels[selectedRole]} via Email Link`
                  : `Create ${roleLabels[selectedRole]} Account via Email Link`}
              </label>
              <div className="flex gap-2">
                <input
                  type="email"
                  required
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="you@example.com"
                  className="flex-1 px-3.5 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/40 text-sm text-on-surface focus:outline-none focus:border-primary"
                />
                <button
                  type="submit"
                  disabled={emailLinkBusy}
                  className="px-4 rounded-xl bg-secondary hover:bg-primary text-on-secondary text-xs font-bold shrink-0 cursor-pointer disabled:opacity-60"
                >
                  {emailLinkBusy ? 'Sending...' : 'Send Link'}
                </button>
              </div>
              {emailLinkSentTo && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 font-medium">
                  Verification link sent to <strong>{emailLinkSentTo}</strong>! Open the link from your inbox on this device to {authMode === 'signin' ? 'sign in' : 'complete registration'} for {roleLabels[selectedRole]}.
                </div>
              )}
              {emailLinkError && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 font-medium">
                  {emailLinkError}
                </div>
              )}
            </form>

            <div className="bg-surface-container-low rounded-xl p-3 text-[11px] text-on-surface-variant flex items-start gap-2">
              <span className="material-symbols-outlined text-secondary text-[16px] shrink-0 mt-0.5">shield</span>
              <span>
                Each Zenvego portal (Customer, Grower, Delivery Partner, Bulk) requires a separate portal registration. To access a different portal later, sign out and log into that portal.
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

interface DeliveryWelcomeScreenProps {
  onStartDelivering: () => void;
  onNavigate: (screen: ScreenId) => void;
}

export const DeliveryWelcomeScreen: React.FC<DeliveryWelcomeScreenProps> = ({
  onStartDelivering,
  onNavigate,
}) => {
  const [highlighted, setHighlighted] = useState<number>(0);

  const benefits = [
    {
      title: 'Hyperlocal Routes',
      tag: 'Within 10 km',
      tagClass: 'text-secondary bg-secondary-container/50',
      desc: 'Short neighborhood pickups and doorstep drops verified with OpenStreetMap live routing.',
      icon: 'electric_moped',
      iconWrap: 'bg-surface-container text-primary',
    },
    {
      title: 'Signed QR Chain of Custody',
      tag: 'Single-Use Tokens',
      tagClass: 'text-primary font-bold',
      desc: 'Cryptographic pickup and delivery QR verification protects partners, growers, and buyers.',
      icon: 'qr_code_scanner',
      iconWrap: 'bg-secondary-container/50 text-secondary',
    },
    {
      title: 'Eco-Friendly Impact',
      tag: 'EV Ready',
      tagClass: 'text-secondary bg-surface-container',
      desc: 'Deliver zero-cold-storage local harvests directly from verified urban growers.',
      icon: 'eco',
      iconWrap: 'bg-primary-fixed/50 text-primary-container',
    },
  ];

  return (
    <div className="flex flex-col w-full max-w-lg mx-auto pb-10">
      <div className="relative flex flex-col items-center justify-center rounded-2xl bg-surface-container-lowest px-6 py-8 border border-outline-variant/40 shadow-sm overflow-hidden">
        <div className="relative z-10 flex items-center justify-center gap-4 w-full max-w-xs">
          <ZenvegoLogo variant="emblem" className="w-16 h-16 shrink-0" />
          <ZenvegoLogo variant="wordmark" className="h-11 w-auto min-w-0" />
        </div>
      </div>

      <div className="flex flex-col items-center text-center mt-6 px-1">
        <div className="inline-flex items-center gap-1.5 px-4 py-1 rounded-full bg-secondary-container/70 border border-secondary/20 text-on-secondary-container text-[11px] font-bold tracking-wider uppercase">
          <span>Delivery Partner Network</span>
        </div>
        <h2 className="mt-4 text-[28px] leading-9 font-extrabold text-on-surface tracking-tight text-balance">
          Welcome to the Zenvego Fleet
        </h2>
        <p className="mt-2 text-sm text-on-surface-variant max-w-sm leading-relaxed">
          Complete your EV/vehicle partner profile to claim live neighborhood harvest pickups.
        </p>
      </div>

      <div className="flex flex-col gap-3 mt-6">
        {benefits.map((b, idx) => (
          <button
            key={b.title}
            type="button"
            onClick={() => setHighlighted(idx)}
            className={`w-full text-left flex items-start gap-4 p-4 rounded-xl border border-outline-variant/30 shadow-sm transition-all duration-150 cursor-pointer ${
              highlighted === idx
                ? 'bg-surface-container-low ring-2 ring-primary/20'
                : 'bg-surface-container-lowest hover:bg-surface-container-low/60'
            }`}
          >
            <div className={`flex items-center justify-center w-11 h-11 rounded-lg shrink-0 ${b.iconWrap}`}>
              <span className="material-symbols-outlined text-[24px]">{b.icon}</span>
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[15px] font-semibold text-on-surface">{b.title}</h3>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 ${b.tagClass}`}>
                  {b.tag}
                </span>
              </div>
              <p className="mt-1 text-sm text-on-surface-variant">{b.desc}</p>
            </div>
          </button>
        ))}
      </div>

      <div className="mt-7 flex flex-col gap-3">
        <button
          type="button"
          onClick={onStartDelivering}
          className="w-full h-12 px-6 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-sm font-bold flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer"
        >
          <span>Complete Partner Profile</span>
          <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onNavigate('delivery-audit')}
            className="h-11 rounded-xl bg-surface-container-lowest text-primary text-xs font-bold shadow-sm hover:bg-surface-container-low transition-colors cursor-pointer"
          >
            Partner Status &amp; Shift
          </button>
          <button
            type="button"
            onClick={() => onNavigate('delivery-pickup')}
            className="h-11 rounded-xl bg-surface-container-lowest text-secondary text-xs font-bold shadow-sm hover:bg-surface-container-low transition-colors cursor-pointer"
          >
            Live Dispatch Queue
          </button>
        </div>
      </div>
    </div>
  );
};
