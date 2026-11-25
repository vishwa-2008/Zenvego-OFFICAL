import React, { useState } from 'react';
import { ActiveOrder, ScreenId, UserProfileDoc, UserRole } from '../types';
import { UserAvatar } from './ProfileScreens';
import { ZenvegoLogo } from './ZenvegoLogo';

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  time: string;
  icon: string;
  targetScreen: ScreenId;
  targetRole: UserRole;
  unread: boolean;
}

interface AppShellProps {
  screen: ScreenId;
  role: UserRole;
  cartCount: number;
  activeOrder: ActiveOrder | null;
  growerFarmName?: string;
  userDisplayName?: string | null;
  userPhotoURL?: string | null;
  userProfile: UserProfileDoc | null;
  isAuthenticated: boolean;
  notifications: NotificationItem[];
  onMarkAllRead: () => void;
  onNavigate: (screen: ScreenId) => void;
  onBack: () => void;
  onShareReceipt: () => void;
  onSignOut: () => void;
  onNotify?: (msg: string) => void;
  onOpenDesk?: () => void;
  children: React.ReactNode;
}

const SCREEN_TITLES: Record<ScreenId, string> = {
  welcome: 'Zenvego',
  login: 'Account & Sign In',
  'delivery-welcome': 'Partner Network',
  'buyer-explore': 'Fresh Harvest Explorer',
  'buyer-growers': 'Nearby Growers',
  'buyer-cart': 'Harvest Basket',
  'buyer-location': 'Select Delivery Location',
  'buyer-payment': 'Checkout & Payment',
  'buyer-receipt': 'Orders & Verification',
  'buyer-bulk': 'Institutional Bulk Quotes',
  'product-checkout': 'Direct Product Checkout',
  'grower-dashboard': 'Grower Overview',
  'grower-inventory': 'Inventory & Live Stock',
  'grower-qr-studio': 'Product QR Print Studio',
  'grower-add-harvest': 'Add Fresh Harvest',
  'grower-orders': 'Seller Order Fulfilment',
  'grower-earnings': 'Grower Settlement Ledger',
  'grower-kyc': 'Grower Profile & KYC',
  'delivery-onboarding': 'Partner KYC & Vehicle Setup',
  'delivery-audit': 'Partner Duty & Verification',
  'delivery-pickup': 'Live Dispatch & QR Handshake',
  'profile-setup': 'Complete Your Profile',
  profile: 'My Profile & Account',
};

const ROLE_META: Record<UserRole, { label: string; short: string; icon: string; desc: string }> = {
  customer: {
    label: 'Customer / Household',
    short: 'Buyer',
    icon: 'shopping_cart',
    desc: 'Browse real local harvests, checkout & track orders',
  },
  grower: {
    label: 'Grower / Farmer',
    short: 'Grower',
    icon: 'psychiatry',
    desc: 'Publish harvests, manage stock, QR codes & payouts',
  },
  delivery: {
    label: 'Delivery Partner',
    short: 'Partner',
    icon: 'two_wheeler',
    desc: 'Accept ready pickups, scan QR tokens & route drops',
  },
  bulk: {
    label: 'Institutional / Bulk',
    short: 'Bulk',
    icon: 'apartment',
    desc: 'Post wholesale enquiries & accept grower quotations',
  },
};

const NAV_GROUPS: Record<
  UserRole,
  { id: ScreenId; label: string; icon: string; badgeType?: 'cart' | 'handover' }[]
> = {
  customer: [
    { id: 'buyer-explore', label: 'Explore Produce', icon: 'storefront' },
    { id: 'buyer-growers', label: 'Nearby Growers', icon: 'potted_plant' },
    { id: 'buyer-location', label: 'Delivery Map', icon: 'my_location' },
    { id: 'buyer-cart', label: 'Harvest Basket', icon: 'shopping_basket', badgeType: 'cart' },
    { id: 'buyer-payment', label: 'Checkout', icon: 'lock' },
    { id: 'buyer-receipt', label: 'My Orders', icon: 'receipt_long' },
    { id: 'buyer-bulk', label: 'Bulk Quotes', icon: 'apartment' },
  ],
  bulk: [
    { id: 'buyer-bulk', label: 'Bulk Enquiries & Quotes', icon: 'apartment' },
    { id: 'buyer-explore', label: 'Direct Produce Feed', icon: 'storefront' },
    { id: 'buyer-growers', label: 'Local Growers', icon: 'potted_plant' },
    { id: 'buyer-location', label: 'Kitchen Address', icon: 'my_location' },
    { id: 'buyer-cart', label: 'Wholesale Basket', icon: 'shopping_basket', badgeType: 'cart' },
    { id: 'buyer-receipt', label: 'Orders & Invoices', icon: 'receipt_long' },
  ],
  grower: [
    { id: 'grower-dashboard', label: 'Grower Dashboard', icon: 'analytics' },
    { id: 'grower-inventory', label: 'Live Inventory', icon: 'inventory_2' },
    { id: 'grower-qr-studio', label: 'Product QR Studio', icon: 'qr_code_2' },
    { id: 'grower-add-harvest', label: 'Add Harvest', icon: 'add_circle' },
    { id: 'grower-orders', label: 'Fulfilment Orders', icon: 'local_shipping', badgeType: 'handover' },
    { id: 'buyer-bulk', label: 'Bulk Enquiries', icon: 'apartment' },
    { id: 'grower-earnings', label: 'Settlement Ledger', icon: 'account_balance_wallet' },
    { id: 'grower-kyc', label: 'Farm Profile & KYC', icon: 'verified_user' },
  ],
  delivery: [
    { id: 'delivery-welcome', label: 'Fleet Overview', icon: 'waving_hand' },
    { id: 'delivery-onboarding', label: 'Partner Profile & EV', icon: 'badge' },
    { id: 'delivery-audit', label: 'Shift & Field ID', icon: 'verified_user' },
    { id: 'delivery-pickup', label: 'Dispatch & QR Scan', icon: 'qr_code_scanner', badgeType: 'handover' },
  ],
};

export const AppShell: React.FC<AppShellProps> = ({
  screen,
  role,
  cartCount,
  activeOrder,
  growerFarmName,
  userDisplayName,
  userPhotoURL,
  userProfile,
  isAuthenticated,
  notifications,
  onMarkAllRead,
  onNavigate,
  onBack,
  onShareReceipt,
  onSignOut,
  onNotify,
  onOpenDesk,
  children,
}) => {
  const [notifOpen, setNotifOpen] = useState(false);

  const unreadCount = notifications.filter((n) => n.unread).length;
  const resolvedDisplayName = userProfile?.displayName || userDisplayName || 'My Profile';
  const firstName = resolvedDisplayName.split(' ')[0] || 'Profile';

  const isBuyerTab =
    screen === 'buyer-explore' ||
    screen === 'buyer-growers' ||
    screen === 'buyer-cart' ||
    screen === 'buyer-receipt' ||
    screen === 'buyer-bulk';

  const isGrowerTab =
    screen === 'grower-dashboard' ||
    screen === 'grower-inventory' ||
    screen === 'grower-qr-studio' ||
    screen === 'grower-orders' ||
    screen === 'grower-earnings';

  const isDeliveryTab =
    screen === 'delivery-onboarding' ||
    screen === 'delivery-audit' ||
    screen === 'delivery-pickup';

  const isStackHeader =
    screen === 'login' ||
    screen === 'delivery-welcome' ||
    screen === 'buyer-location' ||
    screen === 'buyer-payment' ||
    screen === 'buyer-receipt' ||
    screen === 'product-checkout' ||
    screen === 'grower-add-harvest' ||
    screen === 'grower-kyc' ||
    screen === 'profile' ||
    screen === 'profile-setup' ||
    isDeliveryTab;

  const showMobileBottomNav = isBuyerTab || isGrowerTab || isDeliveryTab;
  const activeNavList = NAV_GROUPS[role];

  return (
    <div className="min-h-screen bg-surface text-on-surface flex flex-col lg:flex-row">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-[260px] lg:fixed lg:inset-y-0 lg:left-0 bg-surface-container-lowest border-r border-outline-variant/25 z-40">
        <button
          type="button"
          onClick={() => onNavigate('welcome')}
          className="flex items-center gap-2.5 px-4 py-4 text-left hover:bg-surface-container-low/60 transition-colors cursor-pointer"
        >
          <ZenvegoLogo variant="emblem" className="w-11 h-11 shrink-0" />
          <div className="min-w-0 flex-1">
            <ZenvegoLogo variant="wordmark" className="h-7 w-auto object-left" />
          </div>
        </button>

        {/* Locked Current Portal Indicator (Direct Portal Shifting Permanently Removed) */}
        <div className="px-3 pb-3">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant px-1.5 mb-1.5">
            Active Portal
          </div>
          <div className="bg-surface-container-low p-3 rounded-xl border border-outline-variant/25 space-y-1.5">
            <div className="flex items-center gap-2 text-primary">
              <div className="w-8 h-8 rounded-lg bg-primary text-on-primary flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[17px]">{ROLE_META[role].icon}</span>
              </div>
              <div className="min-w-0">
                <div className="text-xs font-extrabold truncate">{ROLE_META[role].label}</div>
                <div className="text-[10px] text-on-surface-variant truncate">
                  {isAuthenticated ? 'Signed-in portal session' : 'Select portal at sign-in'}
                </div>
              </div>
            </div>
            {isAuthenticated && (
              <p className="text-[10px] text-on-surface-variant leading-snug pt-1 border-t border-outline-variant/20">
                To access another portal, sign out below and log in to that portal account.
              </p>
            )}
          </div>
        </div>

        {/* Role Screen Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-1 space-y-1">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant px-2 py-1">
            {ROLE_META[role].label}
          </div>
          {activeNavList.map((item) => {
            const active = screen === item.id;
            const showCartBadge = item.badgeType === 'cart' && cartCount > 0;
            const showHandoverDot =
              item.badgeType === 'handover' &&
              activeOrder !== null &&
              activeOrder.status !== 'delivered' &&
              activeOrder.status !== 'cancelled';
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer ${
                  active
                    ? 'bg-secondary-container text-on-secondary-container font-bold shadow-xs'
                    : 'text-on-surface-variant hover:bg-surface-container-low hover:text-primary'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={`material-symbols-outlined text-[20px] ${
                      active ? 'material-symbols-filled' : ''
                    }`}
                  >
                    {item.icon}
                  </span>
                  <span className="truncate">{item.label}</span>
                </div>
                {showCartBadge && (
                  <span className="px-2 py-0.5 rounded-full bg-primary text-on-primary text-[11px] font-extrabold tabular-nums">
                    {cartCount}
                  </span>
                )}
                {showHandoverDot && (
                  <span className="w-2 h-2 rounded-full bg-secondary shrink-0" />
                )}
              </button>
            );
          })}

          <div className="pt-4 mt-3 border-t border-outline-variant/25 space-y-1">
            <div className="text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant px-2 py-1">
              Account
            </div>
            <button
              type="button"
              onClick={() => onNavigate('welcome')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                screen === 'welcome'
                  ? 'bg-surface-container text-primary font-bold'
                  : 'text-on-surface-variant hover:bg-surface-container-low hover:text-primary'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">home</span>
              <span>Welcome &amp; Roles</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate(isAuthenticated ? 'profile' : 'login')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                screen === 'profile' || screen === 'login'
                  ? 'bg-surface-container text-primary font-bold'
                  : 'text-on-surface-variant hover:bg-surface-container-low hover:text-primary'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">
                {isAuthenticated ? 'person' : 'login'}
              </span>
              <span className="truncate">{isAuthenticated ? 'My Profile & Care' : 'Sign In with Google'}</span>
            </button>
            {onOpenDesk && (
              <button
                type="button"
                onClick={onOpenDesk}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-on-surface-variant hover:bg-surface-container-low hover:text-primary transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">support_agent</span>
                <span className="truncate">Help &amp; Voice Desk</span>
              </button>
            )}
          </div>
        </nav>

        {/* Sidebar Footer Account Status & Official Contact */}
        <div className="p-3 border-t border-outline-variant/25 space-y-2.5">
          <div className="px-1 flex flex-col gap-1 text-[11px] text-on-surface-variant">
            <a
              href="https://www.instagram.com/zenvego.in/?utm_source=ig_web_button_share_sheet"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 hover:text-primary font-semibold transition-colors truncate"
            >
              <span className="material-symbols-outlined text-[14px] shrink-0">photo_camera</span>
              <span className="truncate">Instagram: @zenvego.in</span>
            </a>
            <a
              href="mailto:zenvego.in@gmail.com"
              className="flex items-center gap-1.5 hover:text-primary font-semibold transition-colors truncate"
            >
              <span className="material-symbols-outlined text-[14px] shrink-0">mail</span>
              <span className="truncate">zenvego.in@gmail.com</span>
            </a>
          </div>
          {isAuthenticated ? (
            <div className="bg-surface-container-low rounded-xl p-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => onNavigate('profile')}
                className="flex items-center gap-2.5 min-w-0 flex-1 text-left rounded-lg hover:bg-surface-container/60 p-1 transition-colors cursor-pointer"
              >
                <UserAvatar
                  avatarType={userProfile?.avatarType}
                  avatarPreset={userProfile?.avatarPreset}
                  customAvatarData={userProfile?.customAvatarData}
                  photoURL={userProfile?.photoURL || userPhotoURL}
                  displayName={resolvedDisplayName}
                  size="sm"
                />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-primary truncate">{resolvedDisplayName}</div>
                  <div className="text-[10px] text-on-surface-variant truncate">Edit Profile &amp; Addresses</div>
                </div>
              </button>
              <button
                type="button"
                onClick={onSignOut}
                title="Sign Out"
                className="p-1.5 rounded-lg hover:bg-surface-container text-on-surface-variant hover:text-primary cursor-pointer shrink-0"
              >
                <span className="material-symbols-outlined text-[18px]">logout</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate('login')}
              className="w-full py-2.5 rounded-xl bg-primary text-on-primary text-xs font-bold cursor-pointer"
            >
              Sign In to Transact
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-[260px] flex flex-col min-w-0 min-h-screen">
        {/* Desktop Top Header */}
        <header className="hidden lg:flex sticky top-0 z-30 h-16 bg-surface/90 backdrop-blur-md border-b border-outline-variant/20 px-6 items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {isStackHeader && (
              <button
                type="button"
                onClick={onBack}
                aria-label="Go back"
                className="w-9 h-9 rounded-full bg-surface-container-lowest hover:bg-surface-container flex items-center justify-center text-primary shadow-xs cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">arrow_back</span>
              </button>
            )}
            <div className="min-w-0">
              <h1 className="text-lg font-extrabold text-primary truncate">
                {SCREEN_TITLES[screen]}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {screen === 'buyer-receipt' && activeOrder && (
              <button
                type="button"
                onClick={onShareReceipt}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container-lowest hover:bg-surface-container-low shadow-xs text-xs font-bold text-primary cursor-pointer whitespace-nowrap"
              >
                <span className="material-symbols-outlined text-[16px]">share</span>
                <span>Share Receipt</span>
              </button>
            )}

            {onOpenDesk && (
              <button
                type="button"
                onClick={onOpenDesk}
                aria-label="Open Zenvego Desk and Voice"
                className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-surface-container-lowest hover:bg-surface-container-low shadow-xs ring-1 ring-outline-variant/25 text-xs font-bold text-primary cursor-pointer whitespace-nowrap"
              >
                <span className="material-symbols-outlined text-[18px]">support_agent</span>
                <span>Desk &amp; Voice</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setNotifOpen(true)}
              aria-label="Notifications"
              className="relative w-10 h-10 rounded-full bg-surface-container-lowest hover:bg-surface-container-low shadow-xs flex items-center justify-center text-primary cursor-pointer"
            >
              <span className="material-symbols-outlined text-[21px]">notifications</span>
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-secondary ring-2 ring-surface-container-lowest" />
              )}
            </button>

            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary-container/80 text-on-secondary-container text-xs font-extrabold whitespace-nowrap select-none">
              <span className="material-symbols-outlined text-[16px]">{ROLE_META[role].icon}</span>
              <span>{ROLE_META[role].short} Portal</span>
            </span>

            {/* Right-side Profile Avatar Button (All Roles) */}
            <button
              type="button"
              onClick={() => onNavigate(isAuthenticated ? 'profile' : 'login')}
              aria-label={isAuthenticated ? 'Open Profile, Addresses & Care' : 'Sign In'}
              className={`flex items-center gap-2 pl-1 pr-3 py-1 rounded-full transition-all cursor-pointer whitespace-nowrap ${
                screen === 'profile'
                  ? 'bg-primary text-on-primary shadow-sm'
                  : 'bg-surface-container-lowest hover:bg-surface-container-low text-primary shadow-xs ring-1 ring-outline-variant/25'
              }`}
            >
              <UserAvatar
                avatarType={userProfile?.avatarType}
                avatarPreset={userProfile?.avatarPreset}
                customAvatarData={userProfile?.customAvatarData}
                photoURL={userProfile?.photoURL || userPhotoURL}
                displayName={resolvedDisplayName}
                size="xs"
              />
              <span className="text-xs font-extrabold max-w-[96px] truncate">
                {isAuthenticated ? firstName : 'Sign In'}
              </span>
            </button>
          </div>
        </header>

        {/* Mobile Top Header */}
        <header className="lg:hidden sticky top-0 z-30 bg-surface/95 backdrop-blur-md border-b border-outline-variant/20 px-3.5 h-15 flex items-center justify-between gap-2">
          {screen === 'welcome' ? (
            <>
              <div className="flex items-center gap-2 min-w-0">
                <ZenvegoLogo variant="emblem" className="w-9 h-9 shrink-0" />
                <ZenvegoLogo variant="wordmark" className="h-6 w-auto object-left" />
              </div>
              {isAuthenticated ? (
                <button
                  type="button"
                  onClick={() => onNavigate('profile')}
                  aria-label="Open Profile"
                  className="flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full bg-surface-container-lowest text-primary text-xs font-bold shadow-xs ring-1 ring-outline-variant/25 cursor-pointer"
                >
                  <UserAvatar
                    avatarType={userProfile?.avatarType}
                    avatarPreset={userProfile?.avatarPreset}
                    customAvatarData={userProfile?.customAvatarData}
                    photoURL={userProfile?.photoURL || userPhotoURL}
                    displayName={resolvedDisplayName}
                    size="xs"
                  />
                  <span className="max-w-[72px] truncate">{firstName}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate('login')}
                  className="px-3.5 py-1.5 rounded-full bg-surface-container-lowest text-primary text-xs font-bold shadow-xs cursor-pointer"
                >
                  Sign In
                </button>
              )}
            </>
          ) : isStackHeader ? (
            <>
              <div className="flex items-center gap-2 min-w-0">
                {screen !== 'profile-setup' && (
                  <button
                    type="button"
                    onClick={onBack}
                    aria-label="Back"
                    className="w-9 h-9 rounded-full hover:bg-surface-container flex items-center justify-center text-primary shrink-0 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[22px]">arrow_back</span>
                  </button>
                )}
                <h1 className="text-[16px] font-extrabold text-primary truncate">
                  {SCREEN_TITLES[screen]}
                </h1>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {screen === 'buyer-receipt' && activeOrder && (
                  <button
                    type="button"
                    onClick={onShareReceipt}
                    aria-label="Share receipt"
                    className="w-9 h-9 rounded-full bg-surface-container-lowest flex items-center justify-center text-primary shadow-xs cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[20px]">share</span>
                  </button>
                )}
                {screen !== 'profile-setup' && isAuthenticated && (
                  <span className="px-2.5 py-1 rounded-full bg-secondary-container/70 text-on-secondary-container text-[11px] font-extrabold whitespace-nowrap select-none">
                    {ROLE_META[role].short}
                  </span>
                )}
                {isAuthenticated && screen !== 'profile' && screen !== 'profile-setup' && (
                  <button
                    type="button"
                    onClick={() => onNavigate('profile')}
                    aria-label="Open Profile"
                    className="rounded-full ring-2 ring-primary/15 hover:ring-primary/40 transition-all cursor-pointer"
                  >
                    <UserAvatar
                      avatarType={userProfile?.avatarType}
                      avatarPreset={userProfile?.avatarPreset}
                      customAvatarData={userProfile?.customAvatarData}
                      photoURL={userProfile?.photoURL || userPhotoURL}
                      displayName={resolvedDisplayName}
                      size="sm"
                    />
                  </button>
                )}
              </div>
            </>
          ) : isGrowerTab ? (
            <>
              <button
                type="button"
                onClick={() => onNavigate('welcome')}
                className="flex items-center gap-2 min-w-0 text-left cursor-pointer"
              >
                <ZenvegoLogo variant="emblem" className="w-9 h-9 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-extrabold text-primary truncate leading-tight">
                    {SCREEN_TITLES[screen]}
                  </div>
                  <div className="text-[11px] font-semibold text-secondary truncate">
                    {growerFarmName || 'Set up farm profile'}
                  </div>
                </div>
              </button>
              <div className="flex items-center gap-1.5 shrink-0">
                {onOpenDesk && (
                  <button
                    type="button"
                    onClick={onOpenDesk}
                    aria-label="Open Zenvego Desk and Voice"
                    className="w-9 h-9 rounded-full bg-surface-container-lowest flex items-center justify-center text-primary shadow-xs cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[20px]">support_agent</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setNotifOpen(true)}
                  aria-label="Notifications"
                  className="relative w-9 h-9 rounded-full bg-surface-container-lowest flex items-center justify-center text-primary shadow-xs cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[20px]">notifications</span>
                  {unreadCount > 0 && (
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-secondary" />
                  )}
                </button>
                <span className="px-2.5 py-1 rounded-full bg-secondary-container/80 text-on-secondary-container text-[11px] font-extrabold whitespace-nowrap select-none">
                  Grower
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate(isAuthenticated ? 'profile' : 'login')}
                  aria-label="Open Profile"
                  className="rounded-full ring-2 ring-primary/15 hover:ring-primary/40 transition-all cursor-pointer"
                >
                  <UserAvatar
                    avatarType={userProfile?.avatarType}
                    avatarPreset={userProfile?.avatarPreset}
                    customAvatarData={userProfile?.customAvatarData}
                    photoURL={userProfile?.photoURL || userPhotoURL}
                    displayName={resolvedDisplayName}
                    size="sm"
                  />
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Clean Brand Mark on Left ("Deliver to" removed per user request) */}
              <button
                type="button"
                onClick={() => onNavigate('welcome')}
                aria-label="Zenvego Home"
                className="flex items-center gap-2 min-w-0 cursor-pointer"
              >
                <ZenvegoLogo variant="emblem" className="w-9 h-9 shrink-0" />
                <ZenvegoLogo variant="wordmark" className="h-5.5 w-auto object-left" />
              </button>

              {/* Right Side: Desk, Notifications, Role Switcher & Profile Avatar Button */}
              <div className="flex items-center gap-1.5 shrink-0">
                {onOpenDesk && (
                  <button
                    type="button"
                    onClick={onOpenDesk}
                    aria-label="Open Zenvego Desk and Voice"
                    className="w-9 h-9 rounded-full bg-surface-container-lowest flex items-center justify-center text-primary shadow-xs cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[20px]">support_agent</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setNotifOpen(true)}
                  aria-label="Notifications"
                  className="relative w-9 h-9 rounded-full bg-surface-container-lowest flex items-center justify-center text-primary shadow-xs cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[20px]">notifications</span>
                  {unreadCount > 0 && (
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-secondary" />
                  )}
                </button>
                <span className="px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-extrabold uppercase tracking-wide whitespace-nowrap select-none">
                  {role === 'bulk' ? 'BULK' : 'BUYER'}
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate(isAuthenticated ? 'profile' : 'login')}
                  aria-label="Open Profile, Addresses & Customer Care"
                  className="rounded-full ring-2 ring-primary/20 hover:ring-primary/50 transition-all cursor-pointer"
                >
                  <UserAvatar
                    avatarType={userProfile?.avatarType}
                    avatarPreset={userProfile?.avatarPreset}
                    customAvatarData={userProfile?.customAvatarData}
                    photoURL={userProfile?.photoURL || userPhotoURL}
                    displayName={resolvedDisplayName}
                    size="sm"
                  />
                </button>
              </div>
            </>
          )}
        </header>

        {/* Page Main Scrollable Container */}
        <main
          className={`flex-1 w-full max-w-5xl mx-auto px-3.5 sm:px-6 pt-4 ${
            showMobileBottomNav ? 'pb-22 lg:pb-10' : 'pb-8'
          }`}
        >
          {children}
        </main>
      </div>

      {/* Mobile Fixed Bottom Navigation */}
      {showMobileBottomNav && (
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface-container-lowest/95 backdrop-blur-md border-t border-outline-variant/25 px-2 py-1.5 shadow-[0_-4px_16px_rgba(0,56,32,0.06)]">
          {isBuyerTab && (
            <div className="grid grid-cols-5 gap-1 max-w-md mx-auto">
              {[
                { id: 'buyer-explore' as ScreenId, label: 'Explore', icon: 'storefront' },
                { id: 'buyer-growers' as ScreenId, label: 'Growers', icon: 'potted_plant' },
                { id: 'buyer-cart' as ScreenId, label: 'Cart', icon: 'shopping_basket', badge: cartCount },
                { id: 'buyer-receipt' as ScreenId, label: 'Orders', icon: 'receipt_long' },
                { id: 'buyer-bulk' as ScreenId, label: 'Bulk', icon: 'apartment' },
              ].map((tab) => {
                const active = screen === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => onNavigate(tab.id)}
                    className={`relative flex flex-col items-center justify-center py-1 rounded-xl transition-colors cursor-pointer ${
                      active ? 'text-primary' : 'text-on-surface-variant'
                    }`}
                  >
                    <div
                      className={`px-3 py-0.5 rounded-full flex items-center justify-center ${
                        active ? 'bg-secondary-container text-on-secondary-container' : ''
                      }`}
                    >
                      <span
                        className={`material-symbols-outlined text-[21px] ${
                          active ? 'material-symbols-filled' : ''
                        }`}
                      >
                        {tab.icon}
                      </span>
                    </div>
                    {tab.badge !== undefined && tab.badge > 0 && (
                      <span className="absolute top-0.5 right-2 min-w-[16px] h-4 px-1 rounded-full bg-primary text-on-primary text-[10px] font-extrabold flex items-center justify-center tabular-nums">
                        {tab.badge}
                      </span>
                    )}
                    <span className={`text-[10px] mt-0.5 ${active ? 'font-extrabold' : 'font-semibold'}`}>
                      {tab.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {isGrowerTab && (
            <div className="grid grid-cols-5 gap-1 max-w-md mx-auto">
              {[
                { id: 'grower-dashboard' as ScreenId, label: 'Overview', icon: 'analytics' },
                { id: 'grower-inventory' as ScreenId, label: 'Stock', icon: 'inventory_2' },
                { id: 'grower-qr-studio' as ScreenId, label: 'QR Print', icon: 'qr_code_2' },
                { id: 'grower-orders' as ScreenId, label: 'Orders', icon: 'local_shipping' },
                { id: 'grower-earnings' as ScreenId, label: 'Ledger', icon: 'account_balance_wallet' },
              ].map((tab) => {
                const active = screen === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => onNavigate(tab.id)}
                    className={`flex flex-col items-center justify-center py-1 rounded-xl transition-colors cursor-pointer ${
                      active ? 'text-primary' : 'text-on-surface-variant'
                    }`}
                  >
                    <div
                      className={`px-3.5 py-0.5 rounded-full flex items-center justify-center ${
                        active ? 'bg-secondary-container text-on-secondary-container' : ''
                      }`}
                    >
                      <span
                        className={`material-symbols-outlined text-[21px] ${
                          active ? 'material-symbols-filled' : ''
                        }`}
                      >
                        {tab.icon}
                      </span>
                    </div>
                    <span className={`text-[10px] mt-0.5 ${active ? 'font-extrabold' : 'font-semibold'}`}>
                      {tab.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {isDeliveryTab && (
            <div className="grid grid-cols-3 gap-1 max-w-md mx-auto">
              {[
                { id: 'delivery-onboarding' as ScreenId, label: 'KYC & EV', icon: 'badge' },
                { id: 'delivery-audit' as ScreenId, label: 'Shift ID', icon: 'verified_user' },
                { id: 'delivery-pickup' as ScreenId, label: 'Dispatch', icon: 'qr_code_scanner' },
              ].map((tab) => {
                const active = screen === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => onNavigate(tab.id)}
                    className={`flex flex-col items-center justify-center py-1 rounded-xl transition-colors cursor-pointer ${
                      active ? 'text-primary' : 'text-on-surface-variant'
                    }`}
                  >
                    <div
                      className={`px-3.5 py-0.5 rounded-full flex items-center justify-center ${
                        active ? 'bg-secondary-container text-on-secondary-container' : ''
                      }`}
                    >
                      <span
                        className={`material-symbols-outlined text-[21px] ${
                          active ? 'material-symbols-filled' : ''
                        }`}
                      >
                        {tab.icon}
                      </span>
                    </div>
                    <span className={`text-[10px] mt-0.5 ${active ? 'font-extrabold' : 'font-semibold'}`}>
                      {tab.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </nav>
      )}


      {/* Real-Time Notifications Drawer */}
      {notifOpen && (
        <div
          className="fixed inset-0 z-50 bg-inverse-surface/55 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
          onClick={() => setNotifOpen(false)}
        >
          <div
            className="bg-surface-container-lowest rounded-2xl p-5 w-full max-w-md shadow-xl space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[22px]">
                  notifications_active
                </span>
                <h2 className="text-base font-extrabold text-primary">Notifications</h2>
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={onMarkAllRead}
                    className="text-xs font-bold text-secondary hover:underline cursor-pointer"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setNotifOpen(false)}
                  className="w-8 h-8 rounded-full hover:bg-surface-container flex items-center justify-center text-on-surface-variant cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>
            </div>

            <div className="space-y-2 max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="text-xs text-on-surface-variant text-center py-6">
                  No notifications yet. Order updates, pickup alerts, and quote responses appear here in real time.
                </p>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => {
                      if (n.targetRole === role) {
                        onNavigate(n.targetScreen);
                      } else if (onNotify) {
                        onNotify(
                          `This alert is for the ${ROLE_META[n.targetRole].label} portal. Sign out and log into that portal to view it.`
                        );
                      }
                      setNotifOpen(false);
                    }}
                    className={`w-full text-left p-3 rounded-xl flex items-start gap-3 transition-colors cursor-pointer ${
                      n.unread
                        ? 'bg-surface-container-low hover:bg-surface-container'
                        : 'bg-surface hover:bg-surface-container-low'
                    }`}
                  >
                    <div className="w-9 h-9 rounded-full bg-secondary-container/70 text-on-secondary-container flex items-center justify-center shrink-0 mt-0.5">
                      <span className="material-symbols-outlined text-[18px]">{n.icon}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-primary truncate">{n.title}</span>
                        <span className="text-[10px] text-on-surface-variant shrink-0">{n.time}</span>
                      </div>
                      <p className="text-xs text-on-surface-variant mt-0.5 leading-snug">{n.body}</p>
                    </div>
                    {n.unread && <span className="w-2 h-2 rounded-full bg-secondary shrink-0 mt-1.5" />}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
