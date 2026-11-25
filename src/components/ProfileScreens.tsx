import React, { useMemo, useRef, useState } from 'react';
import { zenvegoApi } from '../lib/apiClient';
import {
  ActiveOrder,
  AvatarType,
  GrowerProfileDoc,
  SavedAddress,
  ScreenId,
  SupportTicketCategory,
  SupportTicketDoc,
  UserProfileDoc,
  UserRole,
  WalletTransactionDoc,
  ZenvegoAvatarPreset,
} from '../types';
import { getUpiPaymentQrUrl } from '../utils/qrGenerator';
import { LocationPickerMap, LocationPickerResult } from './MapLibreWidgets';
import { QrGeneratorModal, QrScannerModal } from './QrWidgets';
import { ZenvegoLogo } from './ZenvegoLogo';

// ---------------------------------------------------------------------------
// 1. Zenvego Branded Avatar Presets & Universal UserAvatar Component
// ---------------------------------------------------------------------------
export const ZENVEGO_AVATAR_PRESETS: {
  id: ZenvegoAvatarPreset;
  label: string;
  bgClass: string;
  icon?: string;
}[] = [
  { id: 'zenvego-emblem', label: 'Zenvego Emblem', bgClass: 'bg-surface-container-low' },
  { id: 'terrace-leaf', label: 'Terrace Leaf', bgClass: 'bg-gradient-to-br from-emerald-700 to-green-900', icon: 'eco' },
  { id: 'harvest-basket', label: 'Harvest Basket', bgClass: 'bg-gradient-to-br from-amber-600 to-emerald-800', icon: 'shopping_basket' },
  { id: 'sun-sprout', label: 'Sun Sprout', bgClass: 'bg-gradient-to-br from-lime-600 to-emerald-800', icon: 'potted_plant' },
  { id: 'ev-rider', label: 'EV Green Fleet', bgClass: 'bg-gradient-to-br from-teal-700 to-emerald-950', icon: 'electric_moped' },
];

const LANGUAGE_OPTIONS = [
  { code: 'EN', label: 'English', native: 'English (India)' },
  { code: 'TE', label: 'TE', native: 'తెలుగు (Telugu)' },
  { code: 'HI', label: 'HI', native: 'हिन्दी (Hindi)' },
  { code: 'KN', label: 'KN', native: 'ಕನ್ನಡ (Kannada)' },
  { code: 'TA', label: 'TA', native: 'தமிழ் (Tamil)' },
];

interface UserAvatarProps {
  profile?: UserProfileDoc | null;
  fallbackName?: string | null;
  fallbackPhotoURL?: string | null;
  avatarType?: AvatarType;
  avatarPreset?: string;
  customAvatarData?: string;
  photoURL?: string | null;
  displayName?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

export const UserAvatar: React.FC<UserAvatarProps> = ({
  profile = null,
  fallbackName,
  fallbackPhotoURL,
  avatarType: directAvatarType,
  avatarPreset: directAvatarPreset,
  customAvatarData: directCustomAvatarData,
  photoURL: directPhotoURL,
  displayName: directDisplayName,
  size = 'md',
  className = '',
}) => {
  const sizeClass =
    size === 'xs'
      ? 'w-7 h-7 text-xs'
      : size === 'sm'
        ? 'w-9 h-9 text-sm'
        : size === 'lg'
          ? 'w-16 h-16 text-xl'
          : 'w-12 h-12 text-base';

  const avatarType: AvatarType = directAvatarType || profile?.avatarType || 'zenvego';
  const presetId = ((directAvatarPreset || profile?.avatarPreset) as ZenvegoAvatarPreset) || 'zenvego-emblem';
  const personalImg =
    directCustomAvatarData || profile?.customAvatarData || directPhotoURL || profile?.photoURL || fallbackPhotoURL;
  const resolvedName = directDisplayName || profile?.displayName || fallbackName || 'Zenvego';
  const initial = resolvedName.charAt(0).toUpperCase();

  if (avatarType === 'personal' && personalImg) {
    return (
      <div
        className={`${sizeClass} rounded-full overflow-hidden border border-primary/20 bg-surface-container shrink-0 ${className}`}
      >
        <img
          src={personalImg}
          alt={resolvedName}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
      </div>
    );
  }

  if (avatarType === 'personal') {
    return (
      <div
        className={`${sizeClass} rounded-full bg-primary text-on-primary font-extrabold flex items-center justify-center shrink-0 ${className}`}
      >
        {initial}
      </div>
    );
  }

  if (presetId === 'zenvego-emblem') {
    return (
      <div
        className={`${sizeClass} rounded-full bg-surface-container-low border border-primary/20 p-1 flex items-center justify-center shrink-0 overflow-hidden ${className}`}
      >
        <ZenvegoLogo variant="emblem" className="w-full h-full" />
      </div>
    );
  }

  const preset = ZENVEGO_AVATAR_PRESETS.find((p) => p.id === presetId) ?? ZENVEGO_AVATAR_PRESETS[1];
  const iconSize =
    size === 'xs' ? 'text-[16px]' : size === 'sm' ? 'text-[20px]' : size === 'lg' ? 'text-[32px]' : 'text-[24px]';

  return (
    <div
      className={`${sizeClass} rounded-full ${preset.bgClass} text-white flex items-center justify-center shrink-0 shadow-xs ${className}`}
    >
      <span className={`material-symbols-outlined ${iconSize}`}>{preset.icon || 'eco'}</span>
    </div>
  );
};

// Resize uploaded personal photo into a compact base64 JPEG (< 28 KB) so it fits Firestore securely
function compressAvatarFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image format.'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const target = 160;
        canvas.width = target;
        canvas.height = target;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas unavailable.'));
          return;
        }
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, target, target);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
        if (dataUrl.length > 31500) {
          resolve(canvas.toDataURL('image/jpeg', 0.55));
        } else {
          resolve(dataUrl);
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

// Reusable Avatar Selector Widget (Zenvego Avatar OR Personal Avatar)
interface AvatarSelectorProps {
  avatarType: AvatarType;
  avatarPreset: string;
  customAvatarData: string;
  googlePhotoURL?: string | null;
  displayName: string;
  onChangeType: (t: AvatarType) => void;
  onChangePreset: (p: ZenvegoAvatarPreset) => void;
  onChangeCustomData: (d: string) => void;
  onNotify: (msg: string) => void;
}

const AvatarSelector: React.FC<AvatarSelectorProps> = ({
  avatarType,
  avatarPreset,
  customAvatarData,
  googlePhotoURL,
  displayName,
  onChangeType,
  onChangePreset,
  onChangeCustomData,
  onNotify,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onNotify('Please select an image file (JPG, PNG, or WebP).');
      return;
    }
    try {
      const compressed = await compressAvatarFile(file);
      onChangeCustomData(compressed);
      onChangeType('personal');
      onNotify('Personal photo ready — save profile to apply.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to process photo.');
    }
  };

  return (
    <div className="bg-surface-container-low rounded-2xl p-4 space-y-3 border border-outline-variant/25">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <UserAvatar
            profile={{
              uid: 'preview',
              displayName: displayName || 'Zenvego Member',
              activeRole: 'customer',
              avatarType,
              avatarPreset,
              customAvatarData: customAvatarData || undefined,
              photoURL: googlePhotoURL || undefined,
            }}
            fallbackName={displayName}
            fallbackPhotoURL={googlePhotoURL}
            size="lg"
          />
          <div>
            <p className="text-sm font-extrabold text-primary">Profile Avatar</p>
            <p className="text-xs text-on-surface-variant">
              Choose a Zenvego Avatar or use your Personal Photo
            </p>
          </div>
        </div>
      </div>

      {/* Mode Toggle */}
      <div className="grid grid-cols-2 gap-1.5 bg-surface-container p-1 rounded-xl">
        <button
          type="button"
          onClick={() => onChangeType('zenvego')}
          className={`h-9 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
            avatarType === 'zenvego'
              ? 'bg-primary text-on-primary shadow-xs'
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">eco</span>
          <span>Zenvego Avatar</span>
        </button>
        <button
          type="button"
          onClick={() => onChangeType('personal')}
          className={`h-9 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
            avatarType === 'personal'
              ? 'bg-primary text-on-primary shadow-xs'
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">face</span>
          <span>Personal Avatar</span>
        </button>
      </div>

      {avatarType === 'zenvego' ? (
        <div className="grid grid-cols-5 gap-2 pt-1">
          {ZENVEGO_AVATAR_PRESETS.map((preset) => {
            const active = avatarPreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onChangePreset(preset.id)}
                className={`flex flex-col items-center gap-1 p-2 rounded-xl border transition-all cursor-pointer ${
                  active
                    ? 'border-primary bg-surface-container-lowest ring-2 ring-primary/20'
                    : 'border-transparent hover:bg-surface-container-lowest/70'
                }`}
              >
                {preset.id === 'zenvego-emblem' ? (
                  <div className="w-10 h-10 rounded-full bg-surface-container-low border border-primary/20 p-1 flex items-center justify-center">
                    <ZenvegoLogo variant="emblem" className="w-full h-full" />
                  </div>
                ) : (
                  <div
                    className={`w-10 h-10 rounded-full ${preset.bgClass} text-white flex items-center justify-center`}
                  >
                    <span className="material-symbols-outlined text-[20px]">{preset.icon}</span>
                  </div>
                )}
                <span className="text-[10px] font-bold text-on-surface truncate w-full text-center">
                  {preset.label.split(' ')[0]}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-3.5 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold flex items-center gap-1.5 cursor-pointer hover:bg-primary-container"
          >
            <span className="material-symbols-outlined text-[16px]">upload</span>
            <span>Upload Personal Photo</span>
          </button>
          {googlePhotoURL && (
            <button
              type="button"
              onClick={() => {
                onChangeCustomData('');
                onChangeType('personal');
              }}
              className="px-3.5 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/40 text-primary text-xs font-bold cursor-pointer hover:bg-surface-container"
            >
              Use Google Photo
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// 2. Post-Sign-In Complete Your Profile Screen (All Roles)
// ---------------------------------------------------------------------------
interface ProfileSetupScreenProps {
  profile: UserProfileDoc | null;
  authEmail?: string | null;
  authDisplayName?: string | null;
  authPhotoURL?: string | null;
  activeRole: UserRole;
  onSaveProfile: (
    updates: Partial<Omit<UserProfileDoc, 'uid' | 'email'>>,
    initialAddress?: { label: string; formattedAddress: string; lat: number; lng: number; serviceable: boolean }
  ) => Promise<void>;
  onSkip: () => void;
  onNotify: (msg: string) => void;
}

export const ProfileSetupScreen: React.FC<ProfileSetupScreenProps> = ({
  profile,
  authEmail,
  authDisplayName,
  authPhotoURL,
  activeRole,
  onSaveProfile,
  onSkip,
  onNotify,
}) => {
  const [displayName, setDisplayName] = useState(profile?.displayName || authDisplayName || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [city, setCity] = useState(profile?.city || 'Bengaluru');
  const [organizationName, setOrganizationName] = useState(profile?.organizationName || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [deliveryNote, setDeliveryNote] = useState(profile?.deliveryNote || '');
  const [avatarType, setAvatarType] = useState<AvatarType>(profile?.avatarType || 'zenvego');
  const [avatarPreset, setAvatarPreset] = useState<string>(profile?.avatarPreset || 'zenvego-emblem');
  const [customAvatarData, setCustomAvatarData] = useState<string>(profile?.customAvatarData || '');
  const [addAddressNow, setAddAddressNow] = useState(true);
  const [addressLabel, setAddressLabel] = useState('Home');
  const [pickedLoc, setPickedLoc] = useState<LocationPickerResult>({
    address: 'Indiranagar, Bengaluru',
    lat: 12.9784,
    lng: 77.6408,
    serviceability: null,
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      onNotify('Please enter your full name.');
      return;
    }
    setSaving(true);
    try {
      await onSaveProfile(
        {
          displayName: displayName.trim(),
          phone: phone.trim(),
          city: city.trim() || 'Bengaluru',
          organizationName: organizationName.trim(),
          bio: bio.trim(),
          deliveryNote: deliveryNote.trim(),
          avatarType,
          avatarPreset,
          customAvatarData,
          activeRole,
          profileCompleted: true,
        },
        addAddressNow && pickedLoc.address.trim().length >= 3
          ? {
              label: addressLabel.trim() || 'Home',
              formattedAddress: pickedLoc.address.trim(),
              lat: pickedLoc.lat,
              lng: pickedLoc.lng,
              serviceable: pickedLoc.serviceability ? pickedLoc.serviceability.serviceable : true,
            }
          : undefined
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto flex flex-col gap-4 pb-12">
      <div className="bg-surface-container-lowest rounded-3xl p-5 sm:p-6 shadow-sm border border-outline-variant/25 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[11px] font-bold uppercase tracking-wider">
              Welcome to Zenvego
            </span>
            <h2 className="text-xl font-extrabold text-primary mt-1.5">Complete Your Account Details</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Personalize your profile, avatar, contact details, and primary delivery address. You can edit everything anytime from your Profile icon.
            </p>
          </div>
          <button
            type="button"
            onClick={onSkip}
            className="text-xs font-bold text-on-surface-variant hover:text-primary shrink-0 cursor-pointer"
          >
            Skip for now
          </button>
        </div>

        <AvatarSelector
          avatarType={avatarType}
          avatarPreset={avatarPreset}
          customAvatarData={customAvatarData}
          googlePhotoURL={authPhotoURL}
          displayName={displayName}
          onChangeType={setAvatarType}
          onChangePreset={setAvatarPreset}
          onChangeCustomData={setCustomAvatarData}
          onNotify={onNotify}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label className="block text-xs font-bold text-on-surface mb-1">Full Name *</label>
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g., Ananya Sharma"
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/40 text-sm focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface mb-1">Mobile Phone Number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98765 43210"
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/40 text-sm focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface mb-1">Verified Email</label>
            <input
              type="email"
              readOnly
              value={authEmail || profile?.email || ''}
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container text-on-surface-variant border border-outline-variant/25 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface mb-1">City / Neighborhood</label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g., Kondapur, Hyderabad or Indiranagar, Bengaluru"
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/40 text-sm focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {(activeRole === 'bulk' || activeRole === 'grower') && (
          <div>
            <label className="block text-xs font-bold text-on-surface mb-1">
              {activeRole === 'bulk' ? 'Organization / Restaurant / Hostel Name' : 'Farm / Terrace Garden Name'}
            </label>
            <input
              type="text"
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              placeholder={activeRole === 'bulk' ? 'e.g., Green Bowl Kitchen' : 'e.g., Koramangala Rooftop Greens'}
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/40 text-sm focus:outline-none focus:border-primary"
            />
          </div>
        )}

        <div>
          <label className="block text-xs font-bold text-on-surface mb-1">
            Doorstep Delivery Instructions (Optional)
          </label>
          <input
            type="text"
            value={deliveryNote}
            onChange={(e) => setDeliveryNote(e.target.value)}
            placeholder="e.g., Leave fresh crate with gate security / call on arrival"
            className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/40 text-sm focus:outline-none focus:border-primary"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-on-surface mb-1">About / Produce Preferences</label>
          <textarea
            rows={2}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="e.g., Prefer organic leafy greens & morning harvests"
            className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/40 text-xs focus:outline-none focus:border-primary"
          />
        </div>
      </div>

      {/* Primary Address & Auto GPS Setup */}
      <div className="bg-surface-container-lowest rounded-3xl p-5 shadow-sm border border-outline-variant/25 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-extrabold text-primary">Save Primary Delivery Address</h3>
            <p className="text-xs text-on-surface-variant">
              Auto-detect via GPS or pin on map. You can edit or delete saved addresses anytime in Profile.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs font-bold text-primary cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={addAddressNow}
              onChange={(e) => setAddAddressNow(e.target.checked)}
            />
            Include
          </label>
        </div>

        {addAddressNow && (
          <>
            <div className="flex gap-2">
              {(['Home', 'Office', 'Kitchen', 'Other'] as const).map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setAddressLabel(tag)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${
                    addressLabel === tag
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container-low text-on-surface-variant'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
            <LocationPickerMap
              initialLat={pickedLoc.lat}
              initialLng={pickedLoc.lng}
              initialAddress={pickedLoc.address}
              autoDetectOnMount={true}
              onLocationChange={setPickedLoc}
            />
          </>
        )}
      </div>

      <button
        type="submit"
        disabled={saving}
        className="w-full h-13 rounded-2xl bg-primary hover:bg-primary-container text-on-primary text-sm font-extrabold shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
      >
        <span>{saving ? 'Saving Account to Firestore...' : 'Save Profile & Continue'}</span>
        <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
      </button>
    </form>
  );
};

// ---------------------------------------------------------------------------
// 3. Redesigned Profile & Account Page (Exact Match to Reference Design — Zero AI)
// ---------------------------------------------------------------------------
type ProfileModalView =
  | null
  | 'edit-profile'
  | 'addresses'
  | 'orders'
  | 'favorites'
  | 'quality'
  | 'language'
  | 'care'
  | 'wallet-add'
  | 'wallet-passbook'
  | 'wallet-upi'
  | 'deactivate';

interface ProfileScreenProps {
  profile: UserProfileDoc | null;
  authEmail?: string | null;
  authEmailVerified?: boolean;
  authDisplayName?: string | null;
  authPhotoURL?: string | null;
  activeRole: UserRole;
  addresses: SavedAddress[];
  selectedAddressId: string;
  orders: ActiveOrder[];
  completedOrders: ActiveOrder[];
  growers: GrowerProfileDoc[];
  walletTransactions: WalletTransactionDoc[];
  tickets: SupportTicketDoc[];
  onReorder: (order: ActiveOrder) => Promise<void>;
  onSaveProfile: (updates: Partial<Omit<UserProfileDoc, 'uid' | 'email'>>) => Promise<void>;
  onSelectAddress: (id: string) => void;
  onAddAddress: (payload: {
    label: string;
    formattedAddress: string;
    lat: number;
    lng: number;
    serviceable: boolean;
  }) => Promise<void>;
  onUpdateAddress: (
    addressId: string,
    payload: { label: string; formattedAddress: string; lat: number; lng: number; serviceable: boolean }
  ) => Promise<void>;
  onDeleteAddress: (addressId: string) => Promise<void>;
  onCreateTicket: (payload: {
    category: SupportTicketCategory;
    orderCode?: string;
    subject: string;
    message: string;
    contactPhone?: string;
  }) => Promise<void>;
  onResolveTicket: (ticketId: string) => Promise<void>;
  onDeleteTicket: (ticketId: string) => Promise<void>;
  onTopUpWallet: (amountInr: number, method: string, note: string) => Promise<void>;
  onToggleFavoriteGrower: (growerId: string) => Promise<void>;
  onSendVerificationEmail: () => Promise<void>;
  onRefreshVerificationStatus: () => Promise<boolean>;
  onOpenStoreFromQr: (growerId: string) => void;
  onOpenProductFromQr: (productId: string, growerId?: string, qty?: number, src?: string) => void;
  onNavigate: (screen: ScreenId) => void;
  onSignOut: () => Promise<void>;
  onNotify: (msg: string) => void;
}

const CUSTOMER_CARE_FAQS = [
  {
    q: 'How does the signed QR delivery handover work?',
    a: 'Every order gets a 4-digit PIN and a single-use cryptographic QR. Show it to your EV delivery partner at your doorstep to confirm fresh receipt.',
  },
  {
    q: 'How is produce freshness & zero-pesticide quality verified?',
    a: 'All produce is harvested same-day within 10 km from verified neighborhood terrace gardens and local micro-farms.',
  },
  {
    q: 'How do Green Escrow Wallet funds & refunds work?',
    a: 'Your wallet balance is held safely in escrow for active orders and released to the grower (90% net farmgate yield) only after verified doorstep delivery.',
  },
  {
    q: 'Can I edit or delete my saved delivery addresses?',
    a: 'Yes! Open Saved Addresses & Geofences right here on your Profile page to add, edit, auto-detect via GPS, or delete any address.',
  },
];

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  profile,
  authEmail,
  authEmailVerified = true,
  authDisplayName,
  authPhotoURL,
  activeRole,
  addresses,
  selectedAddressId,
  orders,
  completedOrders,
  growers,
  walletTransactions,
  tickets,
  onReorder,
  onSaveProfile,
  onSelectAddress,
  onAddAddress,
  onUpdateAddress,
  onDeleteAddress,
  onCreateTicket,
  onResolveTicket,
  onDeleteTicket,
  onTopUpWallet,
  onToggleFavoriteGrower,
  onSendVerificationEmail,
  onRefreshVerificationStatus,
  onOpenStoreFromQr,
  onOpenProductFromQr,
  onNavigate,
  onSignOut,
  onNotify,
}) => {
  const [activeModal, setActiveModal] = useState<ProfileModalView>(null);
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [myQrOpen, setMyQrOpen] = useState(false);
  const [reorderingId, setReorderingId] = useState<string | null>(null);

  const handleReorderClick = async (order: ActiveOrder) => {
    const key = order.id || order.orderCode;
    setReorderingId(key);
    try {
      await onReorder(order);
    } finally {
      setReorderingId(null);
    }
  };

  // Edit Profile form state
  const [displayName, setDisplayName] = useState(profile?.displayName || authDisplayName || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [city, setCity] = useState(profile?.city || '');
  const [organizationName, setOrganizationName] = useState(profile?.organizationName || '');
  const [deliveryNote, setDeliveryNote] = useState(profile?.deliveryNote || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [avatarType, setAvatarType] = useState<AvatarType>(profile?.avatarType || 'zenvego');
  const [avatarPreset, setAvatarPreset] = useState<string>(profile?.avatarPreset || 'zenvego-emblem');
  const [customAvatarData, setCustomAvatarData] = useState<string>(profile?.customAvatarData || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [verifSending, setVerifSending] = useState(false);

  // Address add/edit state
  const [addressEditorOpen, setAddressEditorOpen] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [addrLabel, setAddrLabel] = useState('Home');
  const [addrLoc, setAddrLoc] = useState<LocationPickerResult>({
    address: 'Indiranagar, Bengaluru',
    lat: 12.9784,
    lng: 77.6408,
    serviceability: null,
  });
  const [savingAddr, setSavingAddr] = useState(false);

  // Wallet Add Money & UPI state
  const [topUpAmount, setTopUpAmount] = useState('500');
  const [topUpUtr, setTopUpUtr] = useState('');
  const [topUpBusy, setTopUpBusy] = useState(false);
  const [topUpError, setTopUpError] = useState<string | null>(null);
  const [upiInput, setUpiInput] = useState(profile?.savedUpiId || '');
  const [savingUpi, setSavingUpi] = useState(false);

  // Customer Care state
  const [ticketCategory, setTicketCategory] = useState<SupportTicketCategory>('order_issue');
  const [ticketOrderCode, setTicketOrderCode] = useState(orders[0]?.orderCode || '');
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketMessage, setTicketMessage] = useState('');
  const [ticketPhone, setTicketPhone] = useState(profile?.phone || '');
  const [submittingTicket, setSubmittingTicket] = useState(false);
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(0);

  // Data purge request state
  const [purgeBusy, setPurgeBusy] = useState(false);

  // Real Firestore-derived Impact & Wallet Metrics
  const activeOrders = useMemo(
    () => orders.filter((o) => o.status !== 'delivered' && o.status !== 'cancelled'),
    [orders]
  );
  const pastOrdersCount = useMemo(
    () => orders.filter((o) => o.status === 'delivered' || o.status === 'cancelled').length,
    [orders]
  );

  const impactMetrics = useMemo(() => {
    const validOrders = orders.filter((o) => o.status !== 'cancelled');
    const totalUnits = validOrders.reduce(
      (sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0),
      0
    );
    const kgProduce = Math.round(totalUnits * 0.65 * 10) / 10;
    const co2Saved = Math.round(kgProduce * 0.25 * 10) / 10;
    const directToGrowers = Math.round(
      validOrders.reduce((sum, o) => sum + o.itemsTotal * 0.9, 0)
    );
    return { kgProduce, co2Saved, directToGrowers, validCount: validOrders.length };
  }, [orders]);

  const walletBalance = profile?.walletBalance ?? 0;
  const escrowProtected = useMemo(
    () => activeOrders.reduce((sum, o) => sum + o.totalPaid, 0),
    [activeOrders]
  );

  const favoriteIds = profile?.favoriteGrowerIds ?? [];
  const favoriteGrowers = useMemo(
    () => growers.filter((g) => favoriteIds.includes(g.ownerId)),
    [growers, favoriteIds]
  );

  const activeAddress = addresses.find((a) => a.id === selectedAddressId) ?? addresses[0];
  const primaryAreaLabel =
    profile?.city?.trim() ||
    (activeAddress ? activeAddress.address.split(',').slice(0, 2).join(', ') : 'Indiranagar, Bengaluru');

  const roleMemberLabel =
    activeRole === 'grower'
      ? 'Verified Grower'
      : activeRole === 'delivery'
        ? 'EV Courier Partner'
        : activeRole === 'bulk'
          ? 'Institutional Member'
          : 'Household Member';

  const currentViewSummary =
    activeRole === 'grower'
      ? 'Current view: Terrace grower inventory & orders'
      : activeRole === 'delivery'
        ? 'Current view: EV hyperlocal dispatch fleet'
        : activeRole === 'bulk'
          ? 'Current view: Institutional wholesale supply'
          : 'Current view: Household fresh produce';

  const topUpQr = useMemo(() => {
    const amt = Math.max(10, Math.min(50000, Number(topUpAmount) || 500));
    return getUpiPaymentQrUrl(
      {
        pa: 'zenvego.escrow@upi',
        pn: 'Zenvego Green Escrow Wallet',
        am: amt,
        tn: `Zenvego Wallet Top-Up INR ${amt}`,
        tr: `WLT${Date.now().toString().slice(-8)}`,
      },
      220
    );
  }, [topUpAmount]);

  const openEditProfileModal = () => {
    setDisplayName(profile?.displayName || authDisplayName || '');
    setPhone(profile?.phone || '');
    setCity(profile?.city || '');
    setOrganizationName(profile?.organizationName || '');
    setDeliveryNote(profile?.deliveryNote || '');
    setBio(profile?.bio || '');
    setAvatarType(profile?.avatarType || 'zenvego');
    setAvatarPreset(profile?.avatarPreset || 'zenvego-emblem');
    setCustomAvatarData(profile?.customAvatarData || '');
    setActiveModal('edit-profile');
  };

  const handleSaveProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      onNotify('Full name cannot be empty.');
      return;
    }
    setSavingProfile(true);
    try {
      await onSaveProfile({
        displayName: displayName.trim(),
        phone: phone.trim(),
        city: city.trim(),
        organizationName: organizationName.trim(),
        deliveryNote: deliveryNote.trim(),
        bio: bio.trim(),
        avatarType,
        avatarPreset,
        customAvatarData,
        profileCompleted: true,
      });
      setActiveModal(null);
    } finally {
      setSavingProfile(false);
    }
  };

  const startAddAddress = () => {
    setEditingAddressId(null);
    setAddrLabel('Home');
    setAddrLoc({
      address: 'Indiranagar, Bengaluru',
      lat: 12.9784,
      lng: 77.6408,
      serviceability: null,
    });
    setAddressEditorOpen(true);
  };

  const startEditAddress = (addr: SavedAddress) => {
    setEditingAddressId(addr.id);
    setAddrLabel(addr.label);
    setAddrLoc({
      address: addr.address,
      lat: addr.lat,
      lng: addr.lng,
      serviceability: null,
    });
    setAddressEditorOpen(true);
  };

  const handleSaveAddress = async () => {
    if (!addrLoc.address.trim()) {
      onNotify('Please select or enter a valid address.');
      return;
    }
    setSavingAddr(true);
    try {
      const payload = {
        label: addrLabel.trim() || 'Home',
        formattedAddress: addrLoc.address.trim(),
        lat: addrLoc.lat,
        lng: addrLoc.lng,
        serviceable: addrLoc.serviceability ? addrLoc.serviceability.serviceable : true,
      };
      if (editingAddressId) {
        await onUpdateAddress(editingAddressId, payload);
      } else {
        await onAddAddress(payload);
      }
      setAddressEditorOpen(false);
      setEditingAddressId(null);
    } finally {
      setSavingAddr(false);
    }
  };

  const handleWalletTopUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(topUpAmount);
    if (!Number.isFinite(amt) || amt < 10 || amt > 50000) {
      setTopUpError('Enter an amount between ₹10 and ₹50,000.');
      return;
    }
    if (!topUpUtr.trim()) {
      setTopUpError('Scan the UPI QR above and enter your 12-digit UPI UTR Reference number.');
      return;
    }
    setTopUpBusy(true);
    setTopUpError(null);
    try {
      const verified = await zenvegoApi.verifyWalletTopUp({
        amountInr: amt,
        method: 'Direct UPI QR',
        utrNumber: topUpUtr.trim(),
      });
      await onTopUpWallet(
        verified.amountInr,
        verified.method,
        `UPI Top-Up Verified (${verified.referenceId})`
      );
      setTopUpUtr('');
      setActiveModal(null);
    } catch (err) {
      setTopUpError(err instanceof Error ? err.message : 'Top-up verification failed.');
    } finally {
      setTopUpBusy(false);
    }
  };

  const handleSaveUpi = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingUpi(true);
    try {
      await onSaveProfile({ savedUpiId: upiInput.trim() });
      setActiveModal(null);
    } finally {
      setSavingUpi(false);
    }
  };

  const handleTicketSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (ticketSubject.trim().length < 3 || ticketMessage.trim().length < 5) {
      onNotify('Please provide a subject and detailed message.');
      return;
    }
    setSubmittingTicket(true);
    try {
      await onCreateTicket({
        category: ticketCategory,
        orderCode: ticketOrderCode.trim() || undefined,
        subject: ticketSubject.trim(),
        message: ticketMessage.trim(),
        contactPhone: ticketPhone.trim() || undefined,
      });
      setTicketSubject('');
      setTicketMessage('');
    } finally {
      setSubmittingTicket(false);
    }
  };

  const handleRequestDataPurge = async () => {
    setPurgeBusy(true);
    try {
      await onCreateTicket({
        category: 'address_account',
        subject: 'Account Deactivation / DPDP Data Purge Request',
        message: `User ${profile?.displayName || authDisplayName || 'Member'} (${authEmail || 'account'}) requested account deactivation and personal data purge under DPDP Act.`,
        contactPhone: profile?.phone || undefined,
      });
      onNotify('Data purge request logged in Customer Care. Signing out...');
      setActiveModal(null);
    } finally {
      setPurgeBusy(false);
    }
  };

  const openTicketCount = tickets.filter((t) => t.status === 'open').length;
  const savedLangCode = profile?.language || 'EN';
  const savedLangLabel =
    LANGUAGE_OPTIONS.find((l) => l.code === savedLangCode)?.label || 'English';

  const addressSubtitle =
    addresses.length > 0
      ? addresses
          .slice(0, 2)
          .map((a) => `${a.label} (${a.address.split(',')[0]})`)
          .join(' • ')
      : 'No saved addresses yet — tap to add or auto-detect GPS';

  const favSubtitle =
    favoriteGrowers.length > 0
      ? favoriteGrowers.map((g) => g.farmName).join(', ')
      : 'Save your trusted neighborhood terrace farms for quick reorders';

  return (
    <div className="max-w-xl mx-auto flex flex-col gap-4 pb-16">
      {/* 1. Profile & Account Header Row (Matches Reference Layout) */}
      <div className="flex items-center justify-between gap-3 pt-1 px-0.5">
        <div className="min-w-0">
          <h1 className="text-[22px] font-extrabold text-[#0b2619] tracking-tight leading-tight">
            Profile &amp; Account
          </h1>
          <div className="flex items-center gap-1.5 mt-0.5 text-xs text-[#4b6356] font-medium">
            <span className="w-2 h-2 rounded-full bg-[#16a34a] shrink-0" />
            <span className="truncate">
              {primaryAreaLabel} • {roleMemberLabel}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setQrScannerOpen(true)}
            title="Scan Zenvego QR Code"
            aria-label="Scan Zenvego QR Code"
            className="w-10 h-10 rounded-full bg-[#e9f5ee] hover:bg-[#d8ede1] text-[#0b2619] flex items-center justify-center transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px]">qr_code_2</span>
          </button>
          <button
            type="button"
            onClick={openEditProfileModal}
            title="Edit Profile & Avatar Settings"
            aria-label="Edit Profile & Avatar Settings"
            className="w-10 h-10 rounded-full bg-[#e9f5ee] hover:bg-[#d8ede1] text-[#0b2619] flex items-center justify-center transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px]">settings</span>
          </button>
        </div>
      </div>

      {/* 2. User Identity & Role Switcher Card */}
      <section className="bg-white rounded-3xl p-4 sm:p-5 shadow-xs border border-[#dcece3] space-y-4">
        <div className="flex items-center gap-3.5">
          <button
            type="button"
            onClick={openEditProfileModal}
            title="Tap to change Avatar or edit profile"
            className="relative shrink-0 cursor-pointer group"
          >
            <UserAvatar
              profile={profile}
              fallbackName={authDisplayName}
              fallbackPhotoURL={authPhotoURL}
              size="lg"
              className="ring-2 ring-[#e9f5ee] group-hover:ring-[#16a34a] transition-all"
            />
            <span className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-[#107c41] text-white border-2 border-white flex items-center justify-center shadow-xs">
              <span className="material-symbols-outlined text-[13px]">
                {authEmailVerified ? 'check' : 'priority_high'}
              </span>
            </span>
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-extrabold text-[#0b2619] truncate">
                {profile?.displayName || authDisplayName || 'Zenvego Member'}
              </h2>
            </div>
            <p className="text-xs text-[#4b6356] truncate mt-0.5">
              {profile?.phone ? `${profile.phone} • ` : ''}
              {authEmail || profile?.email || 'No email linked'}
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#dcfce7] text-[#0e6b38] text-[11px] font-extrabold">
                <span>★</span>
                <span>
                  {impactMetrics.validCount >= 5 ? 'Green Circle Patron' : 'Green Circle Member'}
                </span>
              </span>
              <span className="text-[11px] font-medium text-[#64746b]">
                {profile?.createdAtText || 'Since 2026'}
              </span>
            </div>
          </div>
        </div>

        {/* Locked Portal Session Status (Direct Portal Shifting Permanently Removed) */}
        <div className="bg-[#eef5f0] p-3 rounded-2xl border border-[#d6e9dd] space-y-1.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#16a34a]" />
              <span className="text-xs font-extrabold text-[#063e22]">
                Signed in to {roleMemberLabel} Portal
              </span>
            </div>
            <span className="px-2.5 py-0.5 rounded-full bg-white text-[#063e22] text-[10px] font-extrabold border border-[#cce3d5]">
              Separate Portal Account
            </span>
          </div>
          <p className="text-[11px] text-[#4b6356] leading-snug">
            {currentViewSummary}. To use a different portal (Seller, Customer, or Delivery Partner), sign out below and log in or register for that portal separately.
          </p>
        </div>
      </section>

      {/* 3. Dark Forest Green "Neighborhood Impact Metric" Card */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#074f2b] via-[#064424] to-[#04361c] text-white p-5 shadow-md space-y-4">
        {/* Subtle Decorative Leaf Watermark */}
        <span
          aria-hidden="true"
          className="material-symbols-outlined pointer-events-none select-none absolute -bottom-8 -right-6 text-[150px] text-white/[0.06]"
        >
          eco
        </span>

        <div className="relative z-10 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-[#4ade80] text-[#04361c] flex items-center justify-center shrink-0 font-extrabold">
              <span className="material-symbols-outlined text-[20px]">eco</span>
            </div>
            <h3 className="text-base font-extrabold leading-tight">
              Neighborhood Impact
              <br />
              Metric
            </h3>
          </div>
          <span className="px-3 py-1 rounded-full bg-white/12 text-[11px] font-bold text-white/95 shrink-0">
            100% Traceable
          </span>
        </div>

        {/* 3 Real Firestore-Computed Metric Tiles */}
        <div className="relative z-10 grid grid-cols-3 gap-2.5 tabular-nums">
          <div className="rounded-2xl bg-white/10 backdrop-blur-xs p-3 text-center space-y-0.5">
            <p className="text-xl font-extrabold text-[#86efac] leading-tight">
              {impactMetrics.kgProduce.toFixed(1)}
            </p>
            <p className="text-[11px] font-bold text-white">kg Produce</p>
            <p className="text-[10px] text-white/70 leading-tight">Zero chemical pesticide</p>
          </div>

          <div className="rounded-2xl bg-white/10 backdrop-blur-xs p-3 text-center space-y-0.5">
            <p className="text-xl font-extrabold text-[#86efac] leading-tight">
              {impactMetrics.co2Saved.toFixed(1)}
            </p>
            <p className="text-[11px] font-bold text-white">kg CO₂ Saved</p>
            <p className="text-[10px] text-white/70 leading-tight">&lt; 10km radius transit</p>
          </div>

          <div className="rounded-2xl bg-white/10 backdrop-blur-xs p-3 text-center space-y-0.5">
            <p className="text-xl font-extrabold text-[#86efac] leading-tight">
              ₹{impactMetrics.directToGrowers.toLocaleString('en-IN')}
            </p>
            <p className="text-[11px] font-bold text-white">Direct to Growers</p>
            <p className="text-[10px] text-white/70 leading-tight">90% net farmgate yield</p>
          </div>
        </div>

        {/* Community Green Champion Banner */}
        <button
          type="button"
          onClick={() => setActiveModal('orders')}
          className="relative z-10 w-full rounded-2xl bg-white/10 hover:bg-white/15 transition-colors px-3.5 py-3 flex items-center justify-between gap-3 text-left cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-[#15803d]/60 text-[#86efac] flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[20px]">emoji_events</span>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-extrabold text-white truncate">
                {primaryAreaLabel.split(',')[0]} Community Green Champion
              </p>
              <p className="text-[11px] text-[#86efac] truncate">
                {impactMetrics.validCount > 0
                  ? `${impactMetrics.validCount} verified farm-to-table order${impactMetrics.validCount === 1 ? '' : 's'}`
                  : 'Place your first harvest order to track local impact'}
              </p>
            </div>
          </div>
          <span className="material-symbols-outlined text-white/75 text-[20px] shrink-0">
            chevron_right
          </span>
        </button>
      </section>

      {/* 4. Green Escrow Wallet Card */}
      <section className="bg-white rounded-3xl p-5 shadow-xs border border-[#dcece3] space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#e9f5ee] text-[#0d5c33] flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[22px]">account_balance_wallet</span>
            </div>
            <div>
              <h3 className="text-[15px] font-extrabold text-[#0b2619]">Green Escrow Wallet</h3>
              <p className="text-xs text-[#4b6356]">Instant 1-Tap Farmgate Settlement</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#e9f5ee] text-[#0d5c33] text-[11px] font-bold shrink-0">
            <span className="material-symbols-outlined text-[14px]">verified_user</span>
            <span>Safe Escrow</span>
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 tabular-nums">
          <div className="rounded-2xl bg-[#eef7f1] p-3.5 space-y-0.5">
            <span className="text-xs text-[#4b6356] font-medium block">Available Balance</span>
            <span className="text-2xl font-extrabold text-[#0b2619] block">
              ₹{walletBalance.toFixed(2)}
            </span>
            <span className="text-[11px] font-bold text-[#0e6b38] block">Ready for checkout</span>
          </div>

          <div className="rounded-2xl bg-[#eef7f1] p-3.5 space-y-0.5">
            <span className="text-xs text-[#4b6356] font-medium block">Escrow Protected</span>
            <span className="text-2xl font-extrabold text-[#9a3412] block">
              ₹{escrowProtected.toFixed(2)}
            </span>
            <span className="text-[11px] text-[#64746b] block truncate">
              {activeOrders.length > 0
                ? `Held for Order ${activeOrders[0].orderCode}`
                : 'No active holds'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => {
              setTopUpError(null);
              setActiveModal('wallet-add');
            }}
            className="h-11 rounded-xl bg-[#063e22] hover:bg-[#08522d] text-white text-xs font-extrabold flex items-center justify-center gap-1 cursor-pointer transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            <span>Add Money</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveModal('wallet-passbook')}
            className="h-11 rounded-xl bg-[#ebf3ee] hover:bg-[#dcebe2] text-[#0b2619] text-xs font-extrabold flex items-center justify-center gap-1 cursor-pointer transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">history</span>
            <span>Passbook</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setUpiInput(profile?.savedUpiId || '');
              setActiveModal('wallet-upi');
            }}
            className="h-11 rounded-xl bg-[#ebf3ee] hover:bg-[#dcebe2] text-[#0b2619] text-xs font-extrabold flex items-center justify-center gap-1 cursor-pointer transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">credit_card</span>
            <span>UPI / Cards</span>
          </button>
        </div>
      </section>

      {/* 4b. Inline Order History Section (Past Completed Orders from Firestore + 1-Tap Re-order) */}
      <section className="bg-white rounded-3xl p-5 shadow-xs border border-[#dcece3] space-y-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#e9f5ee] text-[#0d5c33] flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[21px]">inventory</span>
            </div>
            <div className="min-w-0">
              <h3 className="text-[15px] font-extrabold text-[#0b2619] truncate">Order History</h3>
              <p className="text-xs text-[#4b6356] truncate">
                {completedOrders.length} completed order{completedOrders.length === 1 ? '' : 's'} synced from Cloud Firestore
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActiveModal('orders')}
            className="px-3 py-1.5 rounded-xl bg-[#ebf3ee] hover:bg-[#dcebe2] text-[#063e22] text-xs font-extrabold shrink-0 cursor-pointer"
          >
            All ({orders.length})
          </button>
        </div>

        {completedOrders.length === 0 ? (
          <div className="rounded-2xl bg-[#f5faf7] border border-dashed border-[#cce3d5] p-5 text-center space-y-2">
            <span className="material-symbols-outlined text-3xl text-[#5a7a68]">receipt_long</span>
            <p className="text-sm font-extrabold text-[#0b2619]">No completed orders yet</p>
            <p className="text-xs text-[#4b6356] max-w-xs mx-auto">
              Once your fresh harvest orders are delivered and verified via doorstep QR, they appear here with instant 1-tap Re-order.
            </p>
            {(activeRole === 'customer' || activeRole === 'bulk') && (
              <button
                type="button"
                onClick={() => onNavigate('buyer-explore')}
                className="mt-1 px-4 py-2 rounded-xl bg-[#063e22] text-white text-xs font-extrabold cursor-pointer"
              >
                Explore Fresh Produce
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2.5">
            {completedOrders.slice(0, 5).map((ord) => {
              const key = ord.id || ord.orderCode;
              const isBusy = reorderingId === key;
              const farmNames = Array.from(new Set(ord.items.map((i) => i.farmName).filter(Boolean))).join(', ');
              return (
                <div
                  key={key}
                  className="rounded-2xl p-3.5 bg-[#f6fbf8] border border-[#dcece3] space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-extrabold text-[#0b2619]">{ord.orderCode}</span>
                        <span className="px-2 py-0.5 rounded-full bg-[#dcfce7] text-[#0e6b38] text-[10px] font-extrabold uppercase">
                          Delivered
                        </span>
                      </div>
                      <p className="text-[11px] text-[#64746b] mt-0.5">
                        {ord.createdAtText || 'Completed'} {farmNames ? `• ${farmNames}` : ''}
                      </p>
                    </div>
                    <span className="text-sm font-extrabold text-[#063e22] tabular-nums shrink-0">
                      ₹{ord.totalPaid}
                    </span>
                  </div>

                  <p className="text-xs text-[#233a2d] leading-snug">
                    {ord.items.map((i) => `${i.quantity}× ${i.name} (${i.unit})`).join(', ')}
                  </p>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#e2efe7]">
                    <span className="text-[11px] text-[#64746b] truncate">{ord.paymentMethod}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {(activeRole === 'customer' || activeRole === 'bulk') && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleReorderClick(ord)}
                          className="px-3.5 py-1.5 rounded-xl bg-[#063e22] hover:bg-[#08522d] text-white text-xs font-extrabold inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
                        >
                          <span className="material-symbols-outlined text-[15px]">replay</span>
                          <span>{isBusy ? 'Adding...' : 'Re-order'}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setTicketOrderCode(ord.orderCode);
                          setTicketCategory('order_issue');
                          setActiveModal('care');
                        }}
                        className="px-2.5 py-1.5 rounded-xl bg-white border border-[#cce3d5] text-[#0b2619] text-xs font-bold cursor-pointer"
                      >
                        Help
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 5. 6-Row Account Action Menu List (Matches Reference — Strictly ZERO AI) */}
      <section className="bg-white rounded-3xl shadow-xs border border-[#dcece3] divide-y divide-[#eef5f0] overflow-hidden">
        {/* Row 1: Saved Addresses & Geofences */}
        <button
          type="button"
          onClick={() => {
            setAddressEditorOpen(false);
            setActiveModal('addresses');
          }}
          className="w-full px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-[#f6fbf8] transition-colors text-left cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-[#e9f5ee] text-[#0d5c33] flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[20px]">location_on</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-[#0b2619] truncate">
                Saved Addresses &amp; Geofences
              </p>
              <p className="text-xs text-[#64746b] truncate mt-0.5">{addressSubtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {addresses.length > 0 && <span className="w-2.5 h-2.5 rounded-full bg-[#4ade80]" />}
            <span className="material-symbols-outlined text-[#64746b] text-[20px]">
              chevron_right
            </span>
          </div>
        </button>

        {/* Row 2: Order History & Receipts */}
        <button
          type="button"
          onClick={() => setActiveModal('orders')}
          className="w-full px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-[#f6fbf8] transition-colors text-left cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-[#e9f5ee] text-[#0d5c33] flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[20px]">receipt_long</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-[#0b2619] truncate">
                Order History &amp; Receipts
              </p>
              <p className="text-xs text-[#64746b] truncate mt-0.5">
                {pastOrdersCount} past orders • {activeOrders.length} active harvest
                {activeOrders.length === 1 ? '' : 's'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {activeOrders.length > 0 && (
              <span className="px-2.5 py-0.5 rounded-full bg-[#86efac] text-[#053b22] text-[11px] font-extrabold">
                {activeOrders.length} Live
              </span>
            )}
            <span className="material-symbols-outlined text-[#64746b] text-[20px]">
              chevron_right
            </span>
          </div>
        </button>

        {/* Row 3: Favourite Terrace Farms */}
        <button
          type="button"
          onClick={() => setActiveModal('favorites')}
          className="w-full px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-[#f6fbf8] transition-colors text-left cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-[#e9f5ee] text-[#0d5c33] flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[20px]">favorite</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-[#0b2619] truncate">
                Favourite Terrace Farms
              </p>
              <p className="text-xs text-[#64746b] truncate mt-0.5">{favSubtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-extrabold text-[#0b2619]">
              {favoriteGrowers.length} saved
            </span>
            <span className="material-symbols-outlined text-[#64746b] text-[20px]">
              chevron_right
            </span>
          </div>
        </button>

        {/* Row 4: Quality & Farm Assurances */}
        <button
          type="button"
          onClick={() => setActiveModal('quality')}
          className="w-full px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-[#f6fbf8] transition-colors text-left cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-[#e9f5ee] text-[#0d5c33] flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[20px]">verified_user</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-[#0b2619] truncate">
                Quality &amp; Farm Assurances
              </p>
              <p className="text-xs text-[#64746b] truncate mt-0.5">
                Same-day harvest checks, farmgate verification &amp; organic pledge
              </p>
            </div>
          </div>
          <span className="material-symbols-outlined text-[#64746b] text-[20px] shrink-0">
            chevron_right
          </span>
        </button>

        {/* Row 5: Language & Region */}
        <button
          type="button"
          onClick={() => setActiveModal('language')}
          className="w-full px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-[#f6fbf8] transition-colors text-left cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-[#e9f5ee] text-[#0d5c33] flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[20px]">language</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-[#0b2619] truncate">
                Language &amp; Region
              </p>
              <p className="text-xs text-[#64746b] truncate mt-0.5">
                {savedLangLabel} (Telugu / Hindi / Kannada available)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs font-extrabold text-[#0e6b38]">{savedLangCode}</span>
            <span className="material-symbols-outlined text-[#64746b] text-[20px]">
              chevron_right
            </span>
          </div>
        </button>

        {/* Row 6: Help & Customer Care (STRICTLY ZERO AI!) */}
        <button
          type="button"
          onClick={() => setActiveModal('care')}
          className="w-full px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-[#f6fbf8] transition-colors text-left cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-[#e9f5ee] text-[#0d5c33] flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[20px]">support_agent</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-[#0b2619] truncate">
                Help &amp; Customer Care
              </p>
              <p className="text-xs text-[#64746b] truncate mt-0.5">
                Grievance redressal, order help &amp; verified refunds
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {openTicketCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-extrabold">
                {openTicketCount} open
              </span>
            )}
            <span className="material-symbols-outlined text-[#64746b] text-[20px]">
              chevron_right
            </span>
          </div>
        </button>
      </section>

      {/* 6. Official Contact + Version Compliance Footer + Sign Out + Data Purge */}
      <div className="pt-2 space-y-3 text-center">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs px-4">
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
        <div className="flex items-center justify-center gap-1.5 text-[11px] text-[#64746b] px-4">
          <span className="material-symbols-outlined text-[15px] shrink-0">lock</span>
          <span>Version 2.4.0 • Verified Firebase &amp; DPDP Act compliant storage</span>
        </div>

        <button
          type="button"
          onClick={onSignOut}
          className="w-full h-12 rounded-2xl bg-[#e7f0ea] hover:bg-[#d7e7dd] text-[#0b2619] text-sm font-extrabold flex items-center justify-center gap-2 transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-[19px]">logout</span>
          <span>Sign Out of Zenvego</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveModal('deactivate')}
          className="text-xs font-extrabold text-[#c92a2a] hover:underline cursor-pointer py-1"
        >
          Deactivate or Request Data Purge
        </button>
      </div>

      {/* ===================================================================== */}
      {/* INTERACTIVE MODALS FOR EVERY PROFILE ACTION                           */}
      {/* ===================================================================== */}

      {/* Modal A: Edit Profile, Avatar & Email Verification */}
      {activeModal === 'edit-profile' && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveProfileSubmit}
            className="bg-surface-container-lowest rounded-3xl max-w-lg w-full p-5 sm:p-6 shadow-2xl border border-outline-variant/25 space-y-4 my-auto max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-extrabold text-primary">Edit Profile &amp; Account</h3>
                <p className="text-xs text-on-surface-variant">
                  Update your avatar, personal info, and email verification
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <AvatarSelector
              avatarType={avatarType}
              avatarPreset={avatarPreset}
              customAvatarData={customAvatarData}
              googlePhotoURL={authPhotoURL}
              displayName={displayName}
              onChangeType={setAvatarType}
              onChangePreset={setAvatarPreset}
              onChangeCustomData={setCustomAvatarData}
              onNotify={onNotify}
            />

            {/* Email Verification Link Control */}
            <div className="rounded-2xl bg-surface-container-low p-3.5 border border-outline-variant/25 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-bold text-primary">Email Verification Status</p>
                <p className="text-[11px] text-on-surface-variant truncate">{authEmail || profile?.email}</p>
              </div>
              {authEmailVerified ? (
                <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-900 text-[11px] font-extrabold">
                  ✓ Email Verified
                </span>
              ) : (
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    disabled={verifSending}
                    onClick={async () => {
                      setVerifSending(true);
                      try {
                        await onSendVerificationEmail();
                      } finally {
                        setVerifSending(false);
                      }
                    }}
                    className="px-2.5 py-1 rounded-lg bg-primary text-on-primary text-[11px] font-bold cursor-pointer"
                  >
                    {verifSending ? 'Sending...' : 'Send Verify Link'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRefreshVerificationStatus()}
                    className="px-2.5 py-1 rounded-lg bg-white border border-outline-variant text-[11px] font-bold cursor-pointer"
                  >
                    Refresh
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-on-surface mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/40 text-sm focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-on-surface mb-1">Mobile Phone</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/40 text-sm focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-on-surface mb-1">City / Area</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g., Kondapur, Hyderabad"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/40 text-sm focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-on-surface mb-1">Farm / Organization</label>
                <input
                  type="text"
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  placeholder="Optional"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/40 text-sm focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-on-surface mb-1">Doorstep Delivery Note</label>
              <input
                type="text"
                value={deliveryNote}
                onChange={(e) => setDeliveryNote(e.target.value)}
                placeholder="e.g., Call on arrival / hand over to security"
                className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/40 text-sm focus:outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-on-surface mb-1">About / Produce Preferences</label>
              <textarea
                rows={2}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/40 text-xs focus:outline-none focus:border-primary"
              />
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              {profile?.uid && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveModal(null);
                    setMyQrOpen(true);
                  }}
                  className="px-3.5 py-2.5 rounded-xl bg-secondary-container text-on-secondary-container text-xs font-bold cursor-pointer"
                >
                  My Storefront QR
                </button>
              )}
              <button
                type="submit"
                disabled={savingProfile}
                className="flex-1 h-11 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-xs font-extrabold cursor-pointer disabled:opacity-60"
              >
                {savingProfile ? 'Saving Changes...' : 'Save Profile Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal B: Saved Addresses & Geofences (Add / Edit / Delete / Auto-GPS) */}
      {activeModal === 'addresses' && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-surface-container-lowest rounded-3xl max-w-xl w-full p-5 sm:p-6 shadow-2xl border border-outline-variant/25 space-y-4 my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-extrabold text-primary">Saved Addresses &amp; Geofences</h3>
                <p className="text-xs text-on-surface-variant">
                  Edit, delete, or auto-detect your GPS delivery location
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!addressEditorOpen && (
                  <button
                    type="button"
                    onClick={startAddAddress}
                    className="px-3 py-1.5 rounded-xl bg-primary text-on-primary text-xs font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[15px]">add</span>
                    Add
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>
            </div>

            {addressEditorOpen && (
              <div className="bg-surface-container-low rounded-2xl p-4 border border-primary/25 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-extrabold text-primary">
                    {editingAddressId ? 'Edit Saved Address' : 'Add New Delivery Address'}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setAddressEditorOpen(false);
                      setEditingAddressId(null);
                    }}
                    className="text-xs font-bold text-on-surface-variant hover:text-primary cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {(['Home', 'Office', 'Kitchen', 'Other'] as const).map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setAddrLabel(tag)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${
                        addrLabel === tag
                          ? 'bg-primary text-on-primary'
                          : 'bg-white text-on-surface-variant'
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>

                <LocationPickerMap
                  initialLat={addrLoc.lat}
                  initialLng={addrLoc.lng}
                  initialAddress={addrLoc.address}
                  autoDetectOnMount={!editingAddressId}
                  onLocationChange={setAddrLoc}
                />

                <button
                  type="button"
                  disabled={savingAddr}
                  onClick={handleSaveAddress}
                  className="w-full h-11 rounded-xl bg-primary text-on-primary text-xs font-extrabold cursor-pointer disabled:opacity-60"
                >
                  {savingAddr
                    ? 'Saving Address...'
                    : editingAddressId
                      ? 'Update Saved Address'
                      : 'Save New Address'}
                </button>
              </div>
            )}

            {addresses.length === 0 ? (
              <div className="p-6 text-center rounded-2xl bg-surface-container-low space-y-2">
                <span className="material-symbols-outlined text-3xl text-outline">location_on</span>
                <p className="text-sm font-bold text-primary">No saved addresses yet</p>
                <button
                  type="button"
                  onClick={startAddAddress}
                  className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold cursor-pointer"
                >
                  Auto-Detect GPS / Add First Address
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {addresses.map((addr) => {
                  const isActive = addr.id === selectedAddressId;
                  return (
                    <div
                      key={addr.id}
                      className={`rounded-2xl p-3.5 border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        isActive
                          ? 'border-primary bg-surface-container-low ring-2 ring-primary/15'
                          : 'border-outline-variant/25 bg-white'
                      }`}
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-surface-container text-primary flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-[18px]">{addr.icon}</span>
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-extrabold text-primary">{addr.label}</span>
                            {isActive && (
                              <span className="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[10px] font-extrabold">
                                Active
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-on-surface mt-0.5">{addr.address}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {!isActive && (
                          <button
                            type="button"
                            onClick={() => onSelectAddress(addr.id)}
                            className="px-2.5 py-1.5 rounded-lg bg-secondary-container text-on-secondary-container text-[11px] font-bold cursor-pointer"
                          >
                            Use
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => startEditAddress(addr)}
                          className="px-2.5 py-1.5 rounded-lg bg-surface-container text-primary text-[11px] font-bold cursor-pointer"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteAddress(addr.id)}
                          className="px-2.5 py-1.5 rounded-lg bg-red-50 text-red-700 text-[11px] font-bold cursor-pointer"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal C: Order History & Live Tracking Shortcut */}
      {activeModal === 'orders' && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-surface-container-lowest rounded-3xl max-w-xl w-full p-5 sm:p-6 shadow-2xl border border-outline-variant/25 space-y-4 my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-extrabold text-primary">Order History &amp; Live Tracking</h3>
                <p className="text-xs text-on-surface-variant">
                  {orders.length} total order{orders.length === 1 ? '' : 's'} · {activeOrders.length} active live
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {orders.length === 0 ? (
              <div className="p-6 text-center rounded-2xl bg-surface-container-low space-y-2">
                <span className="material-symbols-outlined text-3xl text-outline">receipt_long</span>
                <p className="text-sm font-bold text-primary">No orders yet</p>
                <button
                  type="button"
                  onClick={() => {
                    setActiveModal(null);
                    onNavigate('buyer-explore');
                  }}
                  className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold cursor-pointer"
                >
                  Browse Fresh Produce
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {orders.map((ord) => (
                  <div
                    key={ord.id || ord.orderCode}
                    className="rounded-2xl p-4 bg-surface-container-low border border-outline-variant/25 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="text-sm font-extrabold text-primary">{ord.orderCode}</span>
                        <p className="text-[11px] text-on-surface-variant">{ord.paymentMethod}</p>
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[10px] font-extrabold uppercase">
                        {ord.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="text-xs text-on-surface">
                      {ord.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
                    </p>
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-outline-variant/20 flex-wrap">
                      <span className="text-sm font-extrabold text-primary tabular-nums">
                        ₹{ord.totalPaid}
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {ord.status === 'delivered' && (activeRole === 'customer' || activeRole === 'bulk') && (
                          <button
                            type="button"
                            disabled={reorderingId === (ord.id || ord.orderCode)}
                            onClick={async () => {
                              await handleReorderClick(ord);
                              setActiveModal(null);
                            }}
                            className="px-3 py-1.5 rounded-lg bg-[#063e22] text-white text-xs font-extrabold inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
                          >
                            <span className="material-symbols-outlined text-[15px]">replay</span>
                            <span>{reorderingId === (ord.id || ord.orderCode) ? 'Adding...' : 'Re-order'}</span>
                          </button>
                        )}
                        {(activeRole === 'customer' || activeRole === 'bulk') && (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveModal(null);
                              onNavigate('buyer-receipt');
                            }}
                            className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-bold cursor-pointer"
                          >
                            Live Track &amp; QR
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setTicketOrderCode(ord.orderCode);
                            setTicketCategory('order_issue');
                            setActiveModal('care');
                          }}
                          className="px-3 py-1.5 rounded-lg bg-white border border-outline-variant text-primary text-xs font-bold cursor-pointer"
                        >
                          Help
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal D: Favourite Terrace Farms */}
      {activeModal === 'favorites' && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-surface-container-lowest rounded-3xl max-w-lg w-full p-5 sm:p-6 shadow-2xl border border-outline-variant/25 space-y-4 my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-extrabold text-primary">Favourite Terrace Farms</h3>
                <p className="text-xs text-on-surface-variant">
                  Saved in Firestore for 1-tap access to your trusted local growers
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {growers.length === 0 ? (
              <p className="text-xs text-on-surface-variant text-center py-6">
                No local farms registered yet. Verified terrace gardens appear here automatically.
              </p>
            ) : (
              <div className="space-y-2.5">
                {growers.map((g) => {
                  const isFav = favoriteIds.includes(g.ownerId);
                  return (
                    <div
                      key={g.ownerId}
                      className="rounded-2xl p-3.5 bg-surface-container-low border border-outline-variant/25 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-extrabold text-primary truncate">{g.farmName}</p>
                        <p className="text-xs text-on-surface-variant truncate">
                          {g.growerName} · {g.areaName}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => onToggleFavoriteGrower(g.ownerId)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                            isFav
                              ? 'bg-red-50 text-red-700'
                              : 'bg-white border border-outline-variant text-primary'
                          }`}
                        >
                          {isFav ? '♥ Saved' : '♡ Save'}
                        </button>
                        {(activeRole === 'customer' || activeRole === 'bulk') && (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveModal(null);
                              onOpenStoreFromQr(g.ownerId);
                            }}
                            className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-bold cursor-pointer"
                          >
                            Shop
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal E: Quality & Farm Assurances */}
      {activeModal === 'quality' && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-surface-container-lowest rounded-3xl max-w-lg w-full p-5 sm:p-6 shadow-2xl border border-outline-variant/25 space-y-4 my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-extrabold text-primary">Quality &amp; Farm Assurances</h3>
                <p className="text-xs text-on-surface-variant">
                  Verified neighborhood growers &amp; zero-cold-storage farmgate standards
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3.5 text-xs text-emerald-950 space-y-1">
              <p className="font-extrabold">Zenvego Hyperlocal Freshness Pledge</p>
              <p>
                • Same-day harvest within 10 km serviceability geofence
                <br />• Tamper-evident crate seal &amp; signed single-use QR handover
                <br />• Live camera-verified local terrace &amp; neighborhood growers
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-extrabold text-primary">
                Registered Neighborhood Growers ({growers.length})
              </p>
              {growers.map((g) => (
                <div
                  key={g.ownerId}
                  className="rounded-xl p-3 bg-surface-container-low border border-outline-variant/25 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-on-surface truncate">{g.farmName}</p>
                    <p className="text-on-surface-variant truncate">
                      {g.farmType || 'Local Terrace Grower'}{g.areaName ? ` · ${g.areaName}` : ''}
                    </p>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 font-bold text-[10px] shrink-0">
                    {g.chemicalFree ? 'Chemical-Free' : g.verificationStatus}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal F: Language & Region */}
      {activeModal === 'language' && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest rounded-3xl max-w-sm w-full p-5 shadow-2xl border border-outline-variant/25 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-primary">Language &amp; Region</h3>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <div className="space-y-2">
              {LANGUAGE_OPTIONS.map((lang) => {
                const selected = savedLangCode === lang.code;
                return (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={async () => {
                      await onSaveProfile({ language: lang.code });
                      setActiveModal(null);
                    }}
                    className={`w-full p-3 rounded-xl border flex items-center justify-between cursor-pointer ${
                      selected
                        ? 'border-primary bg-surface-container-low'
                        : 'border-outline-variant/25 bg-white'
                    }`}
                  >
                    <span className="text-sm font-bold text-primary">{lang.native}</span>
                    <span className="text-xs font-extrabold text-secondary">{lang.code}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Modal G: Green Escrow Wallet — Add Money via Real Direct UPI QR */}
      {activeModal === 'wallet-add' && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleWalletTopUpSubmit}
            className="bg-surface-container-lowest rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-2xl border border-outline-variant/25 space-y-4 my-auto"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-extrabold text-primary">Add Money to Green Escrow Wallet</h3>
                <p className="text-xs text-on-surface-variant">
                  Zero-fee UPI QR top-up verified on server &amp; stored in Firestore
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="flex gap-2">
              {['250', '500', '1000', '2000'].map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setTopUpAmount(amt)}
                  className={`flex-1 py-2 rounded-xl text-xs font-extrabold cursor-pointer ${
                    topUpAmount === amt
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container-low text-primary'
                  }`}
                >
                  +₹{amt}
                </button>
              ))}
            </div>

            <div>
              <label className="block text-xs font-bold text-on-surface mb-1">Amount (₹)</label>
              <input
                type="number"
                min={10}
                max={50000}
                required
                value={topUpAmount}
                onChange={(e) => setTopUpAmount(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/40 text-sm font-extrabold"
              />
            </div>

            <div className="rounded-2xl bg-white border border-outline-variant/30 p-3.5 flex flex-col items-center gap-2 text-center">
              <img
                src={topUpQr.qrImageUrl}
                alt="UPI Wallet Top-Up QR"
                className="w-44 h-44 rounded-xl border border-outline-variant/20"
              />
              <p className="text-xs font-bold text-primary">
                Scan with GPay / PhonePe / Paytm → Pay ₹{Number(topUpAmount) || 0}
              </p>
              <a
                href={topUpQr.upiUri}
                className="text-[11px] font-bold text-secondary underline"
              >
                Open UPI App Directly
              </a>
            </div>

            <div>
              <label className="block text-xs font-bold text-on-surface mb-1">
                12-Digit UPI UTR / Reference Number *
              </label>
              <input
                type="text"
                required
                value={topUpUtr}
                onChange={(e) => setTopUpUtr(e.target.value)}
                placeholder="e.g., 432619820411"
                className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/40 text-sm font-mono"
              />
            </div>

            {topUpError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-900 font-medium">
                {topUpError}
              </div>
            )}

            <button
              type="submit"
              disabled={topUpBusy}
              className="w-full h-11 rounded-xl bg-primary text-on-primary text-xs font-extrabold cursor-pointer disabled:opacity-60"
            >
              {topUpBusy ? 'Verifying UTR & Crediting Wallet...' : `Verify UTR & Add ₹${topUpAmount}`}
            </button>
          </form>
        </div>
      )}

      {/* Modal H: Green Escrow Wallet Passbook */}
      {activeModal === 'wallet-passbook' && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-surface-container-lowest rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-2xl border border-outline-variant/25 space-y-4 my-auto max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-extrabold text-primary">Green Escrow Passbook</h3>
                <p className="text-xs text-on-surface-variant">
                  Balance: ₹{walletBalance.toFixed(2)} · Real-time Firestore ledger
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {walletTransactions.length === 0 ? (
              <div className="p-6 text-center rounded-2xl bg-surface-container-low space-y-2">
                <p className="text-sm font-bold text-primary">No wallet transactions yet</p>
                <p className="text-xs text-on-surface-variant">
                  Add money via Direct UPI QR to enable 1-tap Green Escrow checkout.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {walletTransactions.map((tx) => {
                  const isCredit = tx.type === 'topup' || tx.type === 'refund';
                  return (
                    <div
                      key={tx.id}
                      className="rounded-xl p-3 bg-surface-container-low border border-outline-variant/20 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-bold text-on-surface truncate">{tx.note}</p>
                        <p className="text-[11px] text-on-surface-variant">
                          {tx.method} · {tx.createdAtText}
                        </p>
                      </div>
                      <span
                        className={`font-extrabold text-sm tabular-nums shrink-0 ${
                          isCredit ? 'text-emerald-700' : 'text-amber-800'
                        }`}
                      >
                        {isCredit ? '+' : '−'}₹{tx.amount.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal I: Saved UPI / Payment Preferences */}
      {activeModal === 'wallet-upi' && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveUpi}
            className="bg-surface-container-lowest rounded-3xl max-w-sm w-full p-5 shadow-2xl border border-outline-variant/25 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-primary">Saved UPI &amp; Payment ID</h3>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <div>
              <label className="block text-xs font-bold text-on-surface mb-1">Primary UPI VPA ID</label>
              <input
                type="text"
                value={upiInput}
                onChange={(e) => setUpiInput(e.target.value)}
                placeholder="e.g., vishwa@okhdfcbank"
                className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/40 text-sm font-mono"
              />
              <p className="text-[11px] text-on-surface-variant mt-1">
                Pre-filled during Direct UPI checkout and used for verified refunds.
              </p>
            </div>
            <button
              type="submit"
              disabled={savingUpi}
              className="w-full h-11 rounded-xl bg-primary text-on-primary text-xs font-extrabold cursor-pointer disabled:opacity-60"
            >
              {savingUpi ? 'Saving...' : 'Save UPI ID'}
            </button>
          </form>
        </div>
      )}

      {/* Modal J: Help & Customer Care (Real Firestore Support Desk — STRICTLY NO AI) */}
      {activeModal === 'care' && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-surface-container-lowest rounded-3xl max-w-xl w-full p-5 sm:p-6 shadow-2xl border border-outline-variant/25 space-y-4 my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-extrabold text-primary">Help &amp; Customer Care</h3>
                <p className="text-xs text-on-surface-variant">
                  Direct human support desk · Grievance redressal, order help &amp; refunds
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
              <a
                href="mailto:zenvego.in@gmail.com"
                className="rounded-2xl bg-surface-container-low hover:bg-surface-container transition-colors p-3 flex items-center gap-2.5"
              >
                <span className="material-symbols-outlined text-primary text-[20px]">mail</span>
                <div className="min-w-0">
                  <p className="font-extrabold text-primary">Queries &amp; Support Email</p>
                  <p className="text-on-surface-variant font-mono truncate">zenvego.in@gmail.com</p>
                </div>
              </a>
              <a
                href="https://www.instagram.com/zenvego.in/?utm_source=ig_web_button_share_sheet"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-2xl bg-surface-container-low hover:bg-surface-container transition-colors p-3 flex items-center gap-2.5"
              >
                <span className="material-symbols-outlined text-primary text-[20px]">photo_camera</span>
                <div className="min-w-0">
                  <p className="font-extrabold text-primary">Instagram</p>
                  <p className="text-on-surface-variant font-mono truncate">@zenvego.in</p>
                </div>
              </a>
            </div>

            <form onSubmit={handleTicketSubmit} className="space-y-3 bg-surface-container-low rounded-2xl p-4">
              <p className="text-xs font-extrabold text-primary">Raise a Customer Care Ticket</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <select
                  value={ticketCategory}
                  onChange={(e) => setTicketCategory(e.target.value as SupportTicketCategory)}
                  className="px-3 py-2 rounded-xl bg-white border border-outline-variant/40 text-xs font-semibold"
                >
                  <option value="order_issue">Order &amp; Freshness Quality</option>
                  <option value="delivery">Delivery &amp; EV Tracking</option>
                  <option value="grower_payout">Grower Payout / Listing</option>
                  <option value="address_account">Account, Wallet &amp; Refund</option>
                  <option value="bulk_supply">Institutional / Bulk</option>
                  <option value="general">General Enquiry</option>
                </select>
                <input
                  type="text"
                  value={ticketOrderCode}
                  onChange={(e) => setTicketOrderCode(e.target.value)}
                  placeholder="Order Code (Optional)"
                  className="px-3 py-2 rounded-xl bg-white border border-outline-variant/40 text-xs"
                />
              </div>
              <input
                type="text"
                required
                minLength={3}
                value={ticketSubject}
                onChange={(e) => setTicketSubject(e.target.value)}
                placeholder="Subject (e.g., Request refund or delivery timing help)"
                className="w-full px-3 py-2 rounded-xl bg-white border border-outline-variant/40 text-xs"
              />
              <textarea
                required
                minLength={5}
                rows={3}
                value={ticketMessage}
                onChange={(e) => setTicketMessage(e.target.value)}
                placeholder="Describe your issue so our Customer Care team can resolve it..."
                className="w-full px-3 py-2 rounded-xl bg-white border border-outline-variant/40 text-xs"
              />
              <input
                type="tel"
                value={ticketPhone}
                onChange={(e) => setTicketPhone(e.target.value)}
                placeholder="Callback Phone Number"
                className="w-full px-3 py-2 rounded-xl bg-white border border-outline-variant/40 text-xs"
              />
              <button
                type="submit"
                disabled={submittingTicket}
                className="w-full h-10 rounded-xl bg-primary text-on-primary text-xs font-extrabold cursor-pointer disabled:opacity-60"
              >
                {submittingTicket ? 'Submitting Ticket...' : 'Submit Ticket to Customer Care'}
              </button>
            </form>

            {tickets.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-extrabold text-primary">Your Tickets ({tickets.length})</p>
                {tickets.map((t) => (
                  <div key={t.id} className="rounded-xl p-3 bg-surface-container-low space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-primary">{t.subject}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          t.status === 'resolved'
                            ? 'bg-emerald-100 text-emerald-900'
                            : 'bg-amber-100 text-amber-900'
                        }`}
                      >
                        {t.status}
                      </span>
                    </div>
                    <p className="text-on-surface-variant">{t.message}</p>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[10px] text-on-surface-variant">{t.createdAtText}</span>
                      <div className="flex gap-1.5">
                        {t.status !== 'resolved' && (
                          <button
                            type="button"
                            onClick={() => onResolveTicket(t.id)}
                            className="px-2.5 py-1 rounded-lg bg-secondary-container text-on-secondary-container text-[11px] font-bold cursor-pointer"
                          >
                            Mark Resolved
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onDeleteTicket(t.id)}
                          className="px-2.5 py-1 rounded-lg bg-red-50 text-red-700 text-[11px] font-bold cursor-pointer"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2 pt-1">
              <p className="text-xs font-extrabold text-primary">Quick Help FAQs</p>
              {CUSTOMER_CARE_FAQS.map((faq, idx) => (
                <div key={faq.q} className="rounded-xl bg-surface-container-low overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenFaqIdx(openFaqIdx === idx ? null : idx)}
                    className="w-full px-3.5 py-2.5 text-left flex items-center justify-between gap-2 text-xs font-bold text-primary cursor-pointer"
                  >
                    <span>{faq.q}</span>
                    <span className="material-symbols-outlined text-[16px]">
                      {openFaqIdx === idx ? 'expand_less' : 'expand_more'}
                    </span>
                  </button>
                  {openFaqIdx === idx && (
                    <p className="px-3.5 pb-3 text-xs text-on-surface-variant">{faq.a}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal K: Deactivate or Request Data Purge */}
      {activeModal === 'deactivate' && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest rounded-3xl max-w-sm w-full p-5 shadow-2xl border border-outline-variant/25 space-y-4">
            <h3 className="text-base font-extrabold text-red-800">Deactivate or Request Data Purge</h3>
            <p className="text-xs text-on-surface-variant leading-relaxed">
              Under the Digital Personal Data Protection (DPDP) Act, you can log a formal request to deactivate your account and erase stored profile/address data after active orders settle.
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={purgeBusy}
                onClick={handleRequestDataPurge}
                className="w-full h-11 rounded-xl bg-red-700 text-white text-xs font-extrabold cursor-pointer disabled:opacity-60"
              >
                {purgeBusy ? 'Logging Request...' : 'Submit Data Purge Request'}
              </button>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="w-full h-10 rounded-xl bg-surface-container text-primary text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Universal QR Code Scanner (from Profile top-right QR icon) */}
      <QrScannerModal
        open={qrScannerOpen}
        title="Scan Zenvego Storefront or Product QR"
        expectedAction="universal"
        onDeepLinkScanned={(parsed) => {
          setQrScannerOpen(false);
          if (parsed.kind === 'product' && parsed.productId) {
            onOpenProductFromQr(parsed.productId, parsed.growerId, parsed.qty, parsed.src);
          } else if (parsed.kind === 'store' && parsed.growerId) {
            onOpenStoreFromQr(parsed.growerId);
          }
        }}
        onClose={() => setQrScannerOpen(false)}
      />

      {/* User's Own Storefront Marketing QR */}
      <QrGeneratorModal
        open={myQrOpen}
        title={`My Zenvego QR — ${profile?.displayName || authDisplayName || 'Member'}`}
        subtitle="Share or print for offline flyers & quick farm discovery"
        requestPayload={
          profile?.uid
            ? {
                type: 'store',
                growerId: profile.uid,
                farmName: profile.organizationName || profile.displayName || 'Zenvego Grower',
                areaName: primaryAreaLabel,
              }
            : null
        }
        onClose={() => setMyQrOpen(false)}
      />
    </div>
  );
};
