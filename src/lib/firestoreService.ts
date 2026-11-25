import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { CheckoutValidationResponse } from './apiClient';
import { haversineKm as rawHaversineKm, isValidCoord } from './geo';
import {
  ActiveOrder,
  BulkEnquiryDoc,
  CartItem,
  DeliveryAssignmentDoc,
  DeliveryProfileDoc,
  GrowerListing,
  GrowerProfileDoc,
  LedgerEntry,
  NotificationDoc,
  OrderTrackingCurrentDoc,
  OrderTrackingEventDoc,
  OrderTrackingEventType,
  OrderTrackingStage,
  ProduceCategory,
  SavedAddress,
  ScreenId,
  SellerOrderDoc,
  SupportTicketCategory,
  SupportTicketDoc,
  UserProfileDoc,
  UserRole,
  WalletTransactionDoc,
  WalletTxType,
} from '../types';

function clampStr(val: string | undefined, max: number, fallback = ''): string {
  const s = (val ?? fallback).trim();
  return s.slice(0, max);
}

function makeDocId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function formatTs(ts: unknown): string {
  if (ts instanceof Timestamp) {
    const diffSec = Math.max(0, Math.floor((Date.now() - ts.toMillis()) / 1000));
    if (diffSec < 60) return 'Just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    return ts.toDate().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
  return 'Just now';
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (!isValidCoord(lat1, lng1) || !isValidCoord(lat2, lng2)) return 0;
  return Math.round(rawHaversineKm(lat1, lng1, lat2, lng2) * 10) / 10;
}

// ---------------------------------------------------------------------------
// 1. User Profile (users/{uid})
// ---------------------------------------------------------------------------
function mapUserProfileDoc(uid: string, data: Record<string, unknown>): UserProfileDoc {
  return {
    uid: String(data.uid || uid),
    displayName: String(data.displayName || 'Zenvego Member'),
    email: data.email ? String(data.email) : undefined,
    phone: data.phone ? String(data.phone) : undefined,
    activeRole: (data.activeRole as UserRole) || 'customer',
    photoURL: data.photoURL ? String(data.photoURL) : undefined,
    avatarType: data.avatarType === 'personal' ? 'personal' : 'zenvego',
    avatarPreset: data.avatarPreset ? String(data.avatarPreset) : 'zenvego-emblem',
    customAvatarData: data.customAvatarData ? String(data.customAvatarData) : undefined,
    city: data.city ? String(data.city) : undefined,
    bio: data.bio ? String(data.bio) : undefined,
    deliveryNote: data.deliveryNote ? String(data.deliveryNote) : undefined,
    organizationName: data.organizationName ? String(data.organizationName) : undefined,
    defaultAddressId: data.defaultAddressId ? String(data.defaultAddressId) : undefined,
    profileCompleted: Boolean(data.profileCompleted),
    walletBalance: typeof data.walletBalance === 'number' ? data.walletBalance : 0,
    savedUpiId: data.savedUpiId ? String(data.savedUpiId) : undefined,
    language: data.language ? String(data.language) : 'EN',
    favoriteGrowerIds: Array.isArray(data.favoriteGrowerIds)
      ? data.favoriteGrowerIds.map((x) => String(x))
      : [],
    registeredPortals: Array.isArray(data.registeredPortals)
      ? (data.registeredPortals.filter((r) =>
          ['customer', 'grower', 'delivery', 'bulk'].includes(String(r))
        ) as UserRole[])
      : [(data.activeRole as UserRole) || 'customer'],
    createdAtText:
      data.createdAt instanceof Timestamp
        ? `Since ${data.createdAt.toDate().toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`
        : 'Since 2026',
  };
}

export function subscribeUserProfile(uid: string, onData: (profile: UserProfileDoc | null) => void) {
  const path = `users/${uid}`;
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      onData(mapUserProfileDoc(uid, snap.data()));
    },
    (err) => handleFirestoreError(err, OperationType.GET, path)
  );
}

/**
 * Strict Separate Portal Account Gate:
 * - mode === 'signin': verifies that the user ALREADY has an account created for `targetRole`.
 *   If NOT, returns `{ allowed: false, reason: 'NO_PORTAL_ACCOUNT', registeredPortals }` without mutating Firestore.
 * - mode === 'signup': registers `targetRole` separately in `registeredPortals` and activates that portal.
 */
export async function verifyAndEnterPortalAccount(params: {
  uid: string;
  displayName: string;
  email?: string;
  photoURL?: string;
  targetRole: UserRole;
  mode: 'signin' | 'signup';
}): Promise<{
  allowed: boolean;
  reason?: 'NO_PORTAL_ACCOUNT';
  existed: boolean;
  isNewPortalRegistration: boolean;
  profileCompleted: boolean;
  activeRole: UserRole;
  registeredPortals: UserRole[];
  hasGrowerKyc: boolean;
  hasDeliveryKyc: boolean;
}> {
  const path = `users/${params.uid}`;
  try {
    const ref = doc(db, 'users', params.uid);
    const [snap, growerSnap, deliverySnap] = await Promise.all([
      getDoc(ref),
      getDoc(doc(db, 'grower_profiles', params.uid)).catch(() => null),
      getDoc(doc(db, 'delivery_profiles', params.uid)).catch(() => null),
    ]);

    const hasGrowerKyc = Boolean(
      growerSnap?.exists() &&
        growerSnap.data()?.liveSelfieData &&
        growerSnap.data()?.verificationStatus === 'verified'
    );
    const hasDeliveryKyc = Boolean(
      deliverySnap?.exists() &&
        deliverySnap.data()?.liveSelfieData &&
        deliverySnap.data()?.kycStatus === 'verified'
    );

    if (!snap.exists()) {
      if (params.mode === 'signin') {
        return {
          allowed: false,
          reason: 'NO_PORTAL_ACCOUNT',
          existed: false,
          isNewPortalRegistration: false,
          profileCompleted: false,
          activeRole: params.targetRole,
          registeredPortals: [],
          hasGrowerKyc: false,
          hasDeliveryKyc: false,
        };
      }

      const basePayload: Record<string, unknown> = {
        uid: params.uid,
        displayName: clampStr(params.displayName, 120, 'Zenvego Member'),
        activeRole: params.targetRole,
        registeredPortals: [params.targetRole],
        avatarType: 'zenvego',
        avatarPreset: 'zenvego-emblem',
        profileCompleted: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (params.email) basePayload.email = clampStr(params.email, 200);
      if (params.photoURL) basePayload.photoURL = clampStr(params.photoURL, 600);
      await setDoc(ref, basePayload);
      return {
        allowed: true,
        existed: false,
        isNewPortalRegistration: true,
        profileCompleted: false,
        activeRole: params.targetRole,
        registeredPortals: [params.targetRole],
        hasGrowerKyc,
        hasDeliveryKyc,
      };
    }

    const existing = snap.data();
    const validRoles: UserRole[] = ['customer', 'grower', 'delivery', 'bulk'];
    const storedPortals: UserRole[] = Array.isArray(existing.registeredPortals)
      ? (existing.registeredPortals.filter((r: unknown) =>
          validRoles.includes(String(r) as UserRole)
        ) as UserRole[])
      : [];

    // Graceful migration for accounts created before registeredPortals existed
    const inferredPortals = new Set<UserRole>(storedPortals);
    if (storedPortals.length === 0 && existing.activeRole && validRoles.includes(existing.activeRole as UserRole)) {
      inferredPortals.add(existing.activeRole as UserRole);
    }
    if (growerSnap?.exists()) inferredPortals.add('grower');
    if (deliverySnap?.exists()) inferredPortals.add('delivery');

    const currentPortals = Array.from(inferredPortals);
    const hasPortal = currentPortals.includes(params.targetRole);

    if (params.mode === 'signin' && !hasPortal) {
      return {
        allowed: false,
        reason: 'NO_PORTAL_ACCOUNT',
        existed: true,
        isNewPortalRegistration: false,
        profileCompleted: Boolean(existing.profileCompleted),
        activeRole: (existing.activeRole as UserRole) || 'customer',
        registeredPortals: currentPortals,
        hasGrowerKyc,
        hasDeliveryKyc,
      };
    }

    const nextPortals = hasPortal ? currentPortals : [...currentPortals, params.targetRole];
    const updatePayload: Record<string, unknown> = {
      activeRole: params.targetRole,
      registeredPortals: nextPortals,
      updatedAt: serverTimestamp(),
    };
    if (!existing.displayName && params.displayName) {
      updatePayload.displayName = clampStr(params.displayName, 120, 'Zenvego Member');
    }
    if (!existing.photoURL && params.photoURL) {
      updatePayload.photoURL = clampStr(params.photoURL, 600);
    }
    await updateDoc(ref, updatePayload);

    return {
      allowed: true,
      existed: true,
      isNewPortalRegistration: !hasPortal,
      profileCompleted: Boolean(existing.profileCompleted),
      activeRole: params.targetRole,
      registeredPortals: nextPortals,
      hasGrowerKyc,
      hasDeliveryKyc,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function upsertUserProfile(
  profile: UserProfileDoc
): Promise<{ existed: boolean; profileCompleted: boolean; activeRole: UserRole; registeredPortals: UserRole[] }> {
  const path = `users/${profile.uid}`;
  try {
    const ref = doc(db, 'users', profile.uid);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      const basePayload: Record<string, unknown> = {
        uid: profile.uid,
        displayName: clampStr(profile.displayName, 120, 'Zenvego Member'),
        activeRole: profile.activeRole,
        registeredPortals: [profile.activeRole],
        avatarType: profile.avatarType || 'zenvego',
        avatarPreset: clampStr(profile.avatarPreset, 40, 'zenvego-emblem'),
        profileCompleted: Boolean(profile.profileCompleted ?? false),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (profile.email) basePayload.email = clampStr(profile.email, 200);
      if (profile.phone) basePayload.phone = clampStr(profile.phone, 24);
      if (profile.photoURL) basePayload.photoURL = clampStr(profile.photoURL, 600);
      await setDoc(ref, basePayload);
      return {
        existed: false,
        profileCompleted: false,
        activeRole: profile.activeRole,
        registeredPortals: [profile.activeRole],
      };
    }

    const existing = snap.data();
    const existingPortals: UserRole[] = Array.isArray(existing.registeredPortals)
      ? (existing.registeredPortals as UserRole[])
      : [(existing.activeRole as UserRole) || 'customer'];
    return {
      existed: true,
      profileCompleted: Boolean(existing.profileCompleted),
      activeRole: (existing.activeRole as UserRole) || profile.activeRole,
      registeredPortals: existingPortals,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function saveFullUserProfile(
  uid: string,
  updates: Partial<Omit<UserProfileDoc, 'uid' | 'email'>>
): Promise<void> {
  const path = `users/${uid}`;
  try {
    const ref = doc(db, 'users', uid);
    const snap = await getDoc(ref);
    const payload: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (updates.displayName !== undefined) {
      payload.displayName = clampStr(updates.displayName, 120, 'Zenvego Member');
    }
    if (updates.phone !== undefined) {
      payload.phone = clampStr(updates.phone, 24);
    }
    if (updates.activeRole !== undefined) {
      payload.activeRole = updates.activeRole;
    }
    if (updates.photoURL !== undefined) {
      payload.photoURL = clampStr(updates.photoURL, 600);
    }
    if (updates.avatarType !== undefined) {
      payload.avatarType = updates.avatarType;
    }
    if (updates.avatarPreset !== undefined) {
      payload.avatarPreset = clampStr(updates.avatarPreset, 40, 'zenvego-emblem');
    }
    if (updates.customAvatarData !== undefined) {
      payload.customAvatarData = updates.customAvatarData.slice(0, 32000);
    }
    if (updates.city !== undefined) {
      payload.city = clampStr(updates.city, 80);
    }
    if (updates.bio !== undefined) {
      payload.bio = clampStr(updates.bio, 240);
    }
    if (updates.deliveryNote !== undefined) {
      payload.deliveryNote = clampStr(updates.deliveryNote, 200);
    }
    if (updates.organizationName !== undefined) {
      payload.organizationName = clampStr(updates.organizationName, 120);
    }
    if (updates.defaultAddressId !== undefined) {
      payload.defaultAddressId = clampStr(updates.defaultAddressId, 128);
    }
    if (updates.profileCompleted !== undefined) {
      payload.profileCompleted = Boolean(updates.profileCompleted);
    }
    if (typeof updates.walletBalance === 'number') {
      payload.walletBalance = Math.max(0, Math.min(500000, Math.round(updates.walletBalance * 100) / 100));
    }
    if (updates.savedUpiId !== undefined) {
      payload.savedUpiId = clampStr(updates.savedUpiId, 80);
    }
    if (updates.language !== undefined) {
      payload.language = clampStr(updates.language, 24, 'EN');
    }
    if (updates.favoriteGrowerIds !== undefined) {
      payload.favoriteGrowerIds = updates.favoriteGrowerIds.slice(0, 50).map((id) => clampStr(id, 128)).filter(Boolean);
    }

    if (!snap.exists()) {
      await setDoc(ref, {
        uid,
        displayName: (payload.displayName as string) || 'Zenvego Member',
        activeRole: (payload.activeRole as UserRole) || 'customer',
        ...payload,
        createdAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, payload);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function updateUserActiveRole(uid: string, activeRole: UserRole): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      activeRole,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// ---------------------------------------------------------------------------
// 2. Customer Addresses (users/{uid}/addresses)
// ---------------------------------------------------------------------------
export function subscribeUserAddresses(uid: string, onData: (addresses: SavedAddress[]) => void) {
  const path = `users/${uid}/addresses`;
  const q = query(collection(db, 'users', uid, 'addresses'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list: SavedAddress[] = snap.docs.map((d) => {
        const data = d.data();
        const label = String(data.label || 'Saved');
        return {
          id: d.id,
          label,
          address: String(data.formattedAddress || ''),
          lat: Number(data.lat || 12.9784),
          lng: Number(data.lng || 77.6408),
          serviceable: Boolean(data.serviceable),
          icon:
            label.toLowerCase() === 'home'
              ? 'home'
              : label.toLowerCase() === 'office' || label.toLowerCase() === 'work'
                ? 'work'
                : 'location_on',
        };
      });
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function saveUserAddress(
  uid: string,
  payload: { label: string; formattedAddress: string; lat: number; lng: number; serviceable: boolean }
): Promise<string> {
  const id = makeDocId('addr');
  const path = `users/${uid}/addresses/${id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'addresses', id), {
      userId: uid,
      label: clampStr(payload.label, 40, 'Home'),
      formattedAddress: clampStr(payload.formattedAddress, 300),
      lat: payload.lat,
      lng: payload.lng,
      serviceable: payload.serviceable,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateUserAddress(
  uid: string,
  addressId: string,
  payload: { label: string; formattedAddress: string; lat: number; lng: number; serviceable: boolean }
): Promise<void> {
  const path = `users/${uid}/addresses/${addressId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'addresses', addressId), {
      label: clampStr(payload.label, 40, 'Home'),
      formattedAddress: clampStr(payload.formattedAddress, 300),
      lat: payload.lat,
      lng: payload.lng,
      serviceable: payload.serviceable,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteUserAddress(uid: string, addressId: string): Promise<void> {
  const path = `users/${uid}/addresses/${addressId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'addresses', addressId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// ---------------------------------------------------------------------------
// 3. Customer Cart (users/{uid}/cart)
// ---------------------------------------------------------------------------
export function subscribeUserCart(uid: string, onData: (items: CartItem[]) => void) {
  const path = `users/${uid}/cart`;
  const q = query(collection(db, 'users', uid, 'cart'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items: CartItem[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          listingId: String(data.productId),
          growerId: String(data.growerId),
          quantity: Number(data.quantity || 1),
        };
      });
      onData(items);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function setCartItemQuantity(
  uid: string,
  productId: string,
  growerId: string,
  quantity: number
): Promise<void> {
  const path = `users/${uid}/cart/${productId}`;
  const ref = doc(db, 'users', uid, 'cart', productId);
  try {
    if (quantity <= 0) {
      await deleteDoc(ref);
      return;
    }
    const existing = await getDoc(ref);
    if (existing.exists()) {
      await updateDoc(ref, {
        quantity: Math.min(500, Math.max(1, Math.round(quantity))),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        userId: uid,
        productId,
        growerId,
        quantity: Math.min(500, Math.max(1, Math.round(quantity))),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

// ---------------------------------------------------------------------------
// 4. Grower & Delivery Partner Profiles
// ---------------------------------------------------------------------------
export function subscribeGrowerProfiles(onData: (growers: GrowerProfileDoc[]) => void) {
  const path = 'grower_profiles';
  const q = query(collection(db, 'grower_profiles'), where('verificationStatus', 'in', ['pending', 'verified']));
  return onSnapshot(
    q,
    (snap) => {
      onData(
        snap.docs.map((d) => {
          const data = d.data();
          return {
            ownerId: String(data.ownerId || d.id),
            farmName: String(data.farmName || 'Neighborhood Farm'),
            growerName: String(data.growerName || 'Local Grower'),
            farmType: String(data.farmType || 'Terrace Farm'),
            areaName: String(data.areaName || 'Bengaluru'),
            lat: Number(data.lat || 12.9784),
            lng: Number(data.lng || 77.6408),
            fssaiNumber: data.fssaiNumber ? String(data.fssaiNumber) : undefined,
            phone: data.phone ? String(data.phone) : undefined,
            govIdType: (data.govIdType as GrowerProfileDoc['govIdType']) || undefined,
            govIdLast4: data.govIdLast4 ? String(data.govIdLast4) : undefined,
            liveSelfieData: data.liveSelfieData ? String(data.liveSelfieData) : undefined,
            farmPhotoData: data.farmPhotoData ? String(data.farmPhotoData) : undefined,
            livePhotoCapturedAt: data.livePhotoCapturedAt ? String(data.livePhotoCapturedAt) : undefined,
            livenessConfirmed: Boolean(data.livenessConfirmed),
            verificationStatus: (data.verificationStatus as GrowerProfileDoc['verificationStatus']) || 'pending',
            chemicalFree: Boolean(data.chemicalFree ?? true),
          };
        })
      );
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function saveGrowerProfile(uid: string, profile: Omit<GrowerProfileDoc, 'ownerId'>): Promise<void> {
  const path = `grower_profiles/${uid}`;
  const ref = doc(db, 'grower_profiles', uid);
  try {
    const snap = await getDoc(ref);
    const payload: Record<string, unknown> = {
      ownerId: uid,
      farmName: clampStr(profile.farmName, 120, 'My Terrace Farm'),
      growerName: clampStr(profile.growerName, 120, 'Local Grower'),
      farmType: clampStr(profile.farmType, 80, 'Terrace Garden'),
      areaName: clampStr(profile.areaName, 160, 'Indiranagar, Bengaluru'),
      lat: profile.lat,
      lng: profile.lng,
      verificationStatus: profile.verificationStatus,
      chemicalFree: Boolean(profile.chemicalFree ?? true),
      updatedAt: serverTimestamp(),
    };
    if (profile.fssaiNumber) payload.fssaiNumber = clampStr(profile.fssaiNumber, 40);
    if (profile.phone) payload.phone = clampStr(profile.phone, 24);
    if (profile.govIdType) payload.govIdType = profile.govIdType;
    if (profile.govIdLast4) payload.govIdLast4 = clampStr(profile.govIdLast4, 20);
    if (profile.liveSelfieData) payload.liveSelfieData = profile.liveSelfieData.slice(0, 32000);
    if (profile.farmPhotoData) payload.farmPhotoData = profile.farmPhotoData.slice(0, 32000);
    if (profile.livePhotoCapturedAt) payload.livePhotoCapturedAt = clampStr(profile.livePhotoCapturedAt, 64);
    if (typeof profile.livenessConfirmed === 'boolean') payload.livenessConfirmed = profile.livenessConfirmed;

    if (!snap.exists()) {
      await setDoc(ref, { ...payload, createdAt: serverTimestamp() });
    } else {
      const updateObj = { ...payload };
      delete updateObj.ownerId;
      await updateDoc(ref, updateObj);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export function subscribeDeliveryProfile(uid: string, onData: (profile: DeliveryProfileDoc | null) => void) {
  const path = `delivery_profiles/${uid}`;
  return onSnapshot(
    doc(db, 'delivery_profiles', uid),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const data = snap.data();
      onData({
        userId: String(data.userId || uid),
        partnerName: String(data.partnerName || 'Delivery Partner'),
        phone: data.phone ? String(data.phone) : undefined,
        emergencyPhone: data.emergencyPhone ? String(data.emergencyPhone) : undefined,
        vehicleType: (data.vehicleType as DeliveryProfileDoc['vehicleType']) || 'ev',
        vehiclePlate: data.vehiclePlate ? String(data.vehiclePlate) : undefined,
        dlNumber: data.dlNumber ? String(data.dlNumber) : undefined,
        govIdType: (data.govIdType as DeliveryProfileDoc['govIdType']) || undefined,
        govIdLast4: data.govIdLast4 ? String(data.govIdLast4) : undefined,
        liveSelfieData: data.liveSelfieData ? String(data.liveSelfieData) : undefined,
        idDocumentPhotoData: data.idDocumentPhotoData ? String(data.idDocumentPhotoData) : undefined,
        livePhotoCapturedAt: data.livePhotoCapturedAt ? String(data.livePhotoCapturedAt) : undefined,
        livenessConfirmed: Boolean(data.livenessConfirmed),
        clusterArea: String(data.clusterArea || 'Indiranagar Cluster'),
        availableForDispatch: Boolean(data.availableForDispatch),
        kycStatus: (data.kycStatus as DeliveryProfileDoc['kycStatus']) || 'submitted',
      });
    },
    (err) => handleFirestoreError(err, OperationType.GET, path)
  );
}

export async function saveDeliveryProfile(uid: string, profile: Omit<DeliveryProfileDoc, 'userId'>): Promise<void> {
  const path = `delivery_profiles/${uid}`;
  const ref = doc(db, 'delivery_profiles', uid);
  try {
    const snap = await getDoc(ref);
    const payload: Record<string, unknown> = {
      userId: uid,
      partnerName: clampStr(profile.partnerName, 120, 'EV Partner'),
      vehicleType: profile.vehicleType,
      clusterArea: clampStr(profile.clusterArea, 120, 'Indiranagar Cluster'),
      availableForDispatch: Boolean(profile.availableForDispatch),
      kycStatus: profile.kycStatus,
      updatedAt: serverTimestamp(),
    };
    if (profile.phone) payload.phone = clampStr(profile.phone, 24);
    if (profile.emergencyPhone) payload.emergencyPhone = clampStr(profile.emergencyPhone, 24);
    if (profile.vehiclePlate) payload.vehiclePlate = clampStr(profile.vehiclePlate, 32);
    if (profile.dlNumber) payload.dlNumber = clampStr(profile.dlNumber, 40);
    if (profile.govIdType) payload.govIdType = profile.govIdType;
    if (profile.govIdLast4) payload.govIdLast4 = clampStr(profile.govIdLast4, 20);
    if (profile.liveSelfieData) payload.liveSelfieData = profile.liveSelfieData.slice(0, 32000);
    if (profile.idDocumentPhotoData) payload.idDocumentPhotoData = profile.idDocumentPhotoData.slice(0, 32000);
    if (profile.livePhotoCapturedAt) payload.livePhotoCapturedAt = clampStr(profile.livePhotoCapturedAt, 64);
    if (typeof profile.livenessConfirmed === 'boolean') payload.livenessConfirmed = profile.livenessConfirmed;

    if (!snap.exists()) {
      await setDoc(ref, { ...payload, createdAt: serverTimestamp() });
    } else {
      const updateObj = { ...payload };
      delete updateObj.userId;
      await updateDoc(ref, updateObj);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

// ---------------------------------------------------------------------------
// 5. Products Catalog (products/{productId})
// ---------------------------------------------------------------------------
function mapProductDoc(id: string, data: Record<string, unknown>, refLat: number, refLng: number): GrowerListing {
  const lat = typeof data.lat === 'number' ? data.lat : 12.9784;
  const lng = typeof data.lng === 'number' ? data.lng : 77.6408;
  const stock = Number(data.stock || 0);
  const reserved = Number(data.reserved || 0);
  return {
    id,
    growerId: String(data.growerId || ''),
    name: String(data.name || ''),
    variety: String(data.variety || 'Fresh Local Harvest'),
    category: (data.category as ProduceCategory) || 'Vegetables',
    bedLabel: String(data.bedLabel || 'Bed #1'),
    price: Number(data.price || 0),
    unit: String(data.unit || '500g'),
    unitShort: String(data.unitShort || 'pk'),
    stock,
    reserved,
    harvestedAt: String(data.harvestedAt || 'Harvested Today'),
    available: Boolean(data.available),
    lowStock: stock > 0 && stock <= 8,
    highDemand: reserved >= 3,
    image: String(data.image || ''),
    farmName: String(data.farmName || 'Neighborhood Farm'),
    distanceKm: haversineKm(refLat, refLng, lat, lng),
    lat,
    lng,
    chemicalFree: Boolean(data.chemicalFree),
    harvestedToday: Boolean(data.harvestedToday),
    growerNote: data.growerNote ? String(data.growerNote) : undefined,
  };
}

export function subscribeMarketplaceProducts(
  refLat: number,
  refLng: number,
  onData: (products: GrowerListing[]) => void
) {
  const path = 'products';
  // CRITICAL: matches firestore.rules list condition (available == true)
  const q = query(collection(db, 'products'), where('available', '==', true));
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => mapProductDoc(d.id, d.data(), refLat, refLng)));
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export function subscribeGrowerProducts(
  growerUid: string,
  refLat: number,
  refLng: number,
  onData: (products: GrowerListing[]) => void
) {
  const path = 'products';
  // CRITICAL: matches firestore.rules list condition (growerId == request.auth.uid)
  const q = query(collection(db, 'products'), where('growerId', '==', growerUid));
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => mapProductDoc(d.id, d.data(), refLat, refLng)));
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function fetchProductById(
  productId: string,
  refLat: number,
  refLng: number
): Promise<GrowerListing | null> {
  const cleanId = productId.trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(cleanId)) {
    return null;
  }
  const path = `products/${cleanId}`;
  try {
    const snap = await getDoc(doc(db, 'products', cleanId));
    if (!snap.exists()) return null;
    return mapProductDoc(snap.id, snap.data(), refLat, refLng);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function createProductListing(
  growerUid: string,
  listing: Omit<GrowerListing, 'id' | 'growerId' | 'distanceKm'>
): Promise<string> {
  const id = makeDocId('prod');
  const path = `products/${id}`;
  try {
    const payload: Record<string, unknown> = {
      growerId: growerUid,
      farmName: clampStr(listing.farmName, 120, 'My Terrace Farm'),
      name: clampStr(listing.name, 120),
      variety: clampStr(listing.variety, 120, 'Local Variety'),
      category: listing.category,
      bedLabel: clampStr(listing.bedLabel, 40, 'Bed #1'),
      price: Math.max(1, Math.min(100000, Number(listing.price))),
      unit: clampStr(listing.unit, 24, '500g'),
      unitShort: clampStr(listing.unitShort, 12, 'pk'),
      stock: Math.max(0, Math.min(100000, Math.round(Number(listing.stock)))),
      reserved: 0,
      harvestedAt: clampStr(listing.harvestedAt, 60, 'Harvested Today'),
      available: Boolean(listing.available && listing.stock > 0),
      chemicalFree: Boolean(listing.chemicalFree),
      harvestedToday: Boolean(listing.harvestedToday),
      image: clampStr(listing.image, 600),
      lat: typeof listing.lat === 'number' ? listing.lat : 12.9784,
      lng: typeof listing.lng === 'number' ? listing.lng : 77.6408,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (listing.growerNote) payload.growerNote = clampStr(listing.growerNote, 400);
    await setDoc(doc(db, 'products', id), payload);
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateProductFields(
  productId: string,
  fields: Partial<{
    price: number;
    stock: number;
    available: boolean;
    harvestedAt: string;
    growerNote: string;
  }>
): Promise<void> {
  const path = `products/${productId}`;
  try {
    const updatePayload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (typeof fields.price === 'number') updatePayload.price = Math.max(1, Math.min(100000, fields.price));
    if (typeof fields.stock === 'number') updatePayload.stock = Math.max(0, Math.min(100000, Math.round(fields.stock)));
    if (typeof fields.available === 'boolean') updatePayload.available = fields.available;
    if (typeof fields.harvestedAt === 'string') updatePayload.harvestedAt = clampStr(fields.harvestedAt, 60);
    if (typeof fields.growerNote === 'string') updatePayload.growerNote = clampStr(fields.growerNote, 400);
    await updateDoc(doc(db, 'products', productId), updatePayload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteProductListing(productId: string): Promise<void> {
  const path = `products/${productId}`;
  try {
    await deleteDoc(doc(db, 'products', productId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// ---------------------------------------------------------------------------
// 6. Atomic Transactional Multi-Grower Checkout (Prevents Overselling & Negative Stock)
// ---------------------------------------------------------------------------
export async function placeMultiGrowerOrderTransaction(params: {
  customerUid: string;
  customerName: string;
  deliveryAddress: string;
  deliveryLat: number;
  deliveryLng: number;
  paymentMethod: string;
  paymentStatus: 'verified' | 'pending_upi_review' | 'doorstep_qr';
  paymentRef?: string;
  checkoutValidation: CheckoutValidationResponse;
}): Promise<{ orderId: string; orderCode: string; sellerOrderIds: string[] }> {
  const {
    customerUid,
    customerName,
    deliveryAddress,
    deliveryLat,
    deliveryLng,
    paymentMethod,
    paymentStatus,
    paymentRef,
    checkoutValidation,
  } = params;

  const orderId = makeDocId('ord');
  const allItems = checkoutValidation.sellerSplits.flatMap((s) =>
    s.items.map((item) => ({
      ...item,
      growerId: s.growerId,
      farmName: s.farmName,
    }))
  );
  const growerIds = checkoutValidation.sellerSplits.map((s) => s.growerId);

  try {
    const sellerOrderIds: string[] = [];

    await runTransaction(db, async (tx) => {
      // Phase 1: Read all product documents inside the atomic transaction
      const productSnaps = await Promise.all(
        allItems.map(async (item) => {
          const ref = doc(db, 'products', item.productId);
          const snap = await tx.get(ref);
          return { item, ref, snap };
        })
      );

      // Validate live stock inside transaction to block concurrent overselling
      for (const { item, snap } of productSnaps) {
        if (!snap.exists()) {
          throw new Error(`Product "${item.name}" is no longer listed.`);
        }
        const data = snap.data();
        const currentStock = Number(data.stock || 0);
        if (!data.available || currentStock < item.quantity) {
          throw new Error(
            `Insufficient live stock for "${item.name}". Available: ${currentStock}, requested: ${item.quantity}.`
          );
        }
      }

      // Phase 2: Reserve stock atomically (stock -= qty, reserved += qty)
      for (const { item, ref, snap } of productSnaps) {
        const data = snap.data()!;
        const nextStock = Number(data.stock) - item.quantity;
        const nextReserved = Number(data.reserved || 0) + item.quantity;
        tx.update(ref, {
          stock: nextStock,
          reserved: nextReserved,
          available: nextStock > 0,
          updatedAt: serverTimestamp(),
        });
      }

      // Phase 3: Create Parent Customer Order
      const parentOrderRef = doc(db, 'orders', orderId);
      const orderPayload: Record<string, unknown> = {
        orderCode: checkoutValidation.orderCode,
        customerId: customerUid,
        customerName: clampStr(customerName, 120, 'Zenvego Customer'),
        deliveryAddress: clampStr(deliveryAddress, 300),
        deliveryLat,
        deliveryLng,
        status: 'confirmed',
        paymentStatus,
        paymentMethod: clampStr(paymentMethod, 80),
        itemsTotal: checkoutValidation.itemsTotal,
        deliveryFee: checkoutValidation.deliveryFee,
        totalPaid: checkoutValidation.totalPaid,
        handoverPin: checkoutValidation.handoverPin,
        growerIds,
        items: allItems.map((i) => ({
          listingId: i.productId,
          growerId: i.growerId,
          name: i.name,
          farmName: i.farmName,
          unit: i.unit,
          unitPrice: i.unitPrice,
          quantity: i.quantity,
          lineTotal: i.lineTotal,
        })),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (paymentRef) orderPayload.paymentRef = clampStr(paymentRef, 120);
      tx.set(parentOrderRef, orderPayload);

      // Phase 4: Create Independent Per-Grower Seller Fulfilment Orders
      for (const split of checkoutValidation.sellerSplits) {
        const sellerOrderId = makeDocId('so');
        sellerOrderIds.push(sellerOrderId);
        tx.set(doc(db, 'seller_orders', sellerOrderId), {
          parentOrderId: orderId,
          orderCode: checkoutValidation.orderCode,
          customerId: customerUid,
          customerName: clampStr(customerName, 120, 'Zenvego Customer'),
          customerArea: clampStr(deliveryAddress, 200),
          growerId: split.growerId,
          farmName: clampStr(split.farmName, 120),
          status: 'awaiting_acceptance',
          handoverPin: split.handoverPin,
          sealId: split.sealId,
          grossAmount: split.grossAmount,
          platformFee: split.platformFee,
          netPayout: split.netPayout,
          items: split.items,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });

    // Clear customer cart & emit cross-portal notifications
    const batch = writeBatch(db);
    for (const item of allItems) {
      batch.delete(doc(db, 'users', customerUid, 'cart', item.productId));
    }
    for (const split of checkoutValidation.sellerSplits) {
      const nId = makeDocId('notif');
      batch.set(doc(db, 'notifications', nId), {
        userId: split.growerId,
        eventType: 'ORDER_CONFIRMED',
        title: `New Order ${checkoutValidation.orderCode}`,
        body: `${customerName} ordered ${split.items.length} item(s) worth ₹${split.grossAmount}. Tap to accept & prepare.`,
        targetRole: 'grower',
        targetScreen: 'grower-orders',
        unread: true,
        createdAt: serverTimestamp(),
      });
    }
    const custNotifId = makeDocId('notif');
    batch.set(doc(db, 'notifications', custNotifId), {
      userId: customerUid,
      eventType: 'ORDER_CONFIRMED',
      title: `Order ${checkoutValidation.orderCode} Confirmed`,
      body: `Grower(s) notified. Handover PIN: ${checkoutValidation.handoverPin}.`,
      targetRole: 'customer',
      targetScreen: 'buyer-receipt',
      unread: true,
      createdAt: serverTimestamp(),
    });
    if (checkoutValidation.sellerSplits[0]?.growerId) {
      batch.set(doc(db, 'orders', orderId, 'orderEvents', makeDocId('evt')), {
        orderId,
        customerId: customerUid,
        growerId: checkoutValidation.sellerSplits[0].growerId,
        eventType: 'ORDER_CONFIRMED',
        label: 'Order Confirmed',
        note: `Order ${checkoutValidation.orderCode} placed and sent to grower.`,
        actorUid: customerUid,
        actorRole: 'customer',
        createdAt: serverTimestamp(),
      });
    }
    await batch.commit();

    return { orderId, orderCode: checkoutValidation.orderCode, sellerOrderIds };
  } catch (err) {
    if (err instanceof Error && (err.message.includes('Insufficient live stock') || err.message.includes('no longer listed'))) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `orders/${orderId}`);
  }
}

// ---------------------------------------------------------------------------
// 7. Real-Time Orders, Seller Orders & Delivery Assignments Subscriptions
// ---------------------------------------------------------------------------
function mapCustomerOrderDoc(id: string, uid: string, data: Record<string, unknown>): ActiveOrder & { _sortMs: number } {
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const status = (data.status as ActiveOrder['status']) || 'confirmed';
  const createdTs = data.createdAt instanceof Timestamp ? data.createdAt : null;
  return {
    id,
    orderCode: String(data.orderCode || id),
    handoverPin: String(data.handoverPin || '0000'),
    status,
    paymentStatus: (data.paymentStatus as ActiveOrder['paymentStatus']) || 'doorstep_qr',
    paymentRef: data.paymentRef ? String(data.paymentRef) : undefined,
    etaText:
      status === 'delivered'
        ? 'Delivered Fresh'
        : status === 'out_for_delivery' || status === 'picked_up'
          ? 'Out for EV delivery'
          : status === 'ready_for_pickup'
            ? 'Packed — Awaiting EV pickup'
            : status === 'cancelled'
              ? 'Order cancelled'
              : 'Grower preparing harvest',
    paymentMethod: String(data.paymentMethod || 'Doorstep Verified QR'),
    itemsTotal: Number(data.itemsTotal || 0),
    deliveryFee: Number(data.deliveryFee || 0),
    totalPaid: Number(data.totalPaid || 0),
    customerId: String(data.customerId || uid),
    customerName: String(data.customerName || 'Customer'),
    customerArea: String(data.deliveryAddress || ''),
    deliveryLat: typeof data.deliveryLat === 'number' ? data.deliveryLat : 12.9784,
    deliveryLng: typeof data.deliveryLng === 'number' ? data.deliveryLng : 77.6408,
    driverName: 'Assigned EV Partner',
    driverVehicle: 'Zero-Emission EV',
    driverRating: 4.9,
    driverPhone: '',
    sealId: 'ZVG-SEAL',
    growerHandoverConfirmed: ['ready_for_pickup', 'picked_up', 'out_for_delivery', 'delivered'].includes(status),
    driverPickupConfirmed: ['picked_up', 'out_for_delivery', 'delivered'].includes(status),
    createdAtText: createdTs
      ? createdTs.toDate().toLocaleString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'Recent',
    items: rawItems.map((i: Record<string, unknown>) => ({
      listingId: String(i.listingId || i.productId || ''),
      name: String(i.name || ''),
      farmName: String(i.farmName || 'Local Farm'),
      distanceKm: 1.5,
      freshnessLabel: 'Harvested Fresh',
      quantity: Number(i.quantity || 1),
      unit: String(i.unit || 'pack'),
      unitPrice: Number(i.unitPrice || 0),
      lineTotal: Number(i.lineTotal || 0),
    })),
    _sortMs: createdTs ? createdTs.toMillis() : 0,
  };
}

export function subscribeCustomerOrders(uid: string, onData: (orders: ActiveOrder[]) => void) {
  const path = 'orders';
  const q = query(collection(db, 'orders'), where('customerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const orders = snap.docs.map((d) => mapCustomerOrderDoc(d.id, uid, d.data()));
      orders.sort((a, b) => b._sortMs - a._sortMs);
      onData(orders);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export function subscribeCompletedCustomerOrders(uid: string, onData: (orders: ActiveOrder[]) => void) {
  const path = 'orders';
  const q = query(collection(db, 'orders'), where('customerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const orders = snap.docs
        .map((d) => mapCustomerOrderDoc(d.id, uid, d.data()))
        .filter((o) => o.status === 'delivered');
      orders.sort((a, b) => b._sortMs - a._sortMs);
      onData(orders);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export function subscribeGrowerSellerOrders(growerUid: string, onData: (orders: SellerOrderDoc[]) => void) {
  const path = 'seller_orders';
  const q = query(collection(db, 'seller_orders'), where('growerId', '==', growerUid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          parentOrderId: String(data.parentOrderId),
          orderCode: String(data.orderCode),
          customerId: String(data.customerId),
          customerName: String(data.customerName),
          customerArea: String(data.customerArea),
          growerId: String(data.growerId),
          farmName: String(data.farmName),
          assignedPartnerId: data.assignedPartnerId ? String(data.assignedPartnerId) : undefined,
          status: (data.status as SellerOrderDoc['status']) || 'awaiting_acceptance',
          rejectionReason: data.rejectionReason ? String(data.rejectionReason) : undefined,
          handoverPin: String(data.handoverPin || '0000'),
          sealId: data.sealId ? String(data.sealId) : undefined,
          grossAmount: Number(data.grossAmount || 0),
          platformFee: Number(data.platformFee || 0),
          netPayout: Number(data.netPayout || 0),
          items: Array.isArray(data.items) ? data.items : [],
          createdAt: formatTs(data.createdAt),
          _sortMs: data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : 0,
        };
      });
      list.sort((a, b) => b._sortMs - a._sortMs);
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

function mapDeliveryAssignmentDoc(id: string, data: Record<string, unknown>): DeliveryAssignmentDoc {
  const toNum = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  return {
    id,
    parentOrderId: String(data.parentOrderId),
    sellerOrderId: String(data.sellerOrderId),
    orderCode: String(data.orderCode),
    customerId: String(data.customerId),
    growerId: String(data.growerId),
    partnerId: data.partnerId ? String(data.partnerId) : undefined,
    partnerName: data.partnerName ? String(data.partnerName) : undefined,
    farmName: String(data.farmName),
    pickupAddress: String(data.pickupAddress),
    pickupLat: toNum(data.pickupLat),
    pickupLng: toNum(data.pickupLng),
    dropoffAddress: String(data.dropoffAddress),
    dropoffLat: toNum(data.dropoffLat),
    dropoffLng: toNum(data.dropoffLng),
    status: (data.status as DeliveryAssignmentDoc['status']) || 'open',
    pickupVerifiedAt: data.pickupVerifiedAt ? String(data.pickupVerifiedAt) : undefined,
    deliveredAt: data.deliveredAt ? String(data.deliveredAt) : undefined,
    issueNote: data.issueNote ? String(data.issueNote) : undefined,
    partnerLat: typeof data.partnerLat === 'number' && Number.isFinite(data.partnerLat) ? data.partnerLat : undefined,
    partnerLng: typeof data.partnerLng === 'number' && Number.isFinite(data.partnerLng) ? data.partnerLng : undefined,
    lastLocationAt: data.lastLocationAt ? String(data.lastLocationAt) : undefined,
  };
}

export function subscribeDeliveryAssignments(
  partnerUid: string,
  onData: (assignments: DeliveryAssignmentDoc[]) => void
) {
  const path = 'delivery_assignments';
  const mapSnap = (docs: { id: string; data: () => Record<string, unknown> }[]) =>
    docs.map((d) => mapDeliveryAssignmentDoc(d.id, d.data()));

  let openList: DeliveryAssignmentDoc[] = [];
  let myList: DeliveryAssignmentDoc[] = [];
  const emit = () => {
    const merged = new Map<string, DeliveryAssignmentDoc>();
    for (const a of [...myList, ...openList]) merged.set(a.id, a);
    onData(Array.from(merged.values()));
  };

  const unsubOpen = onSnapshot(
    query(collection(db, 'delivery_assignments'), where('status', '==', 'open')),
    (snap) => {
      openList = mapSnap(snap.docs);
      emit();
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );

  const unsubMine = onSnapshot(
    query(collection(db, 'delivery_assignments'), where('partnerId', '==', partnerUid)),
    (snap) => {
      myList = mapSnap(snap.docs);
      emit();
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );

  return () => {
    unsubOpen();
    unsubMine();
  };
}

export function subscribeCustomerDeliveryAssignments(
  customerUid: string,
  onData: (assignments: DeliveryAssignmentDoc[]) => void
) {
  const path = 'delivery_assignments';
  const q = query(collection(db, 'delivery_assignments'), where('customerId', '==', customerUid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => mapDeliveryAssignmentDoc(d.id, d.data()));
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export function subscribeGrowerDeliveryAssignments(
  growerUid: string,
  onData: (assignments: DeliveryAssignmentDoc[]) => void
) {
  const path = 'delivery_assignments';
  const q = query(collection(db, 'delivery_assignments'), where('growerId', '==', growerUid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => mapDeliveryAssignmentDoc(d.id, d.data()));
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function getParentOrderDeliveryCoords(
  parentOrderId: string
): Promise<{ lat: number; lng: number; address?: string } | null> {
  const path = `orders/${parentOrderId}`;
  try {
    const snap = await getDoc(doc(db, 'orders', parentOrderId));
    if (!snap.exists()) return null;
    const data = snap.data();
    const lat = Number(data.deliveryLat);
    const lng = Number(data.deliveryLng);
    if (!isValidCoord(lat, lng)) return null;
    return {
      lat,
      lng,
      address: typeof data.deliveryAddress === 'string' ? data.deliveryAddress : undefined,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
    return null;
  }
}

export async function updateDeliveryPartnerLocation(
  assignmentId: string,
  lat: number,
  lng: number
): Promise<void> {
  if (!isValidCoord(lat, lng)) return;
  try {
    await updateDoc(doc(db, 'delivery_assignments', assignmentId), {
      partnerLat: lat,
      partnerLng: lng,
      lastLocationAt: new Date().toISOString(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('[LiveTracking] Could not sync partner GPS to Firestore:', err);
  }
}

export async function upsertOrderTrackingCurrent(params: {
  orderId: string;
  assignmentId: string;
  partnerId: string;
  partnerName?: string;
  lat: number;
  lng: number;
  accuracy?: number;
  heading?: number | null;
  speed?: number | null;
  stage: OrderTrackingStage;
  trackingActive: boolean;
}): Promise<void> {
  if (!isValidCoord(params.lat, params.lng)) return;
  try {
    const payload: Record<string, unknown> = {
      orderId: params.orderId,
      assignmentId: params.assignmentId,
      partnerId: params.partnerId,
      lat: params.lat,
      lng: params.lng,
      stage: params.stage,
      trackingActive: params.trackingActive,
      lastUpdatedAt: new Date().toISOString(),
      updatedAt: serverTimestamp(),
    };
    if (params.partnerName) {
      payload.partnerName = clampStr(params.partnerName, 120);
    }
    if (typeof params.accuracy === 'number' && Number.isFinite(params.accuracy) && params.accuracy >= 0 && params.accuracy <= 10000) {
      payload.accuracy = Math.round(params.accuracy * 10) / 10;
    }
    if (typeof params.heading === 'number' && Number.isFinite(params.heading) && params.heading >= 0 && params.heading <= 360) {
      payload.heading = Math.round(params.heading * 10) / 10;
    }
    if (typeof params.speed === 'number' && Number.isFinite(params.speed) && params.speed >= 0 && params.speed <= 150) {
      payload.speed = Math.round(params.speed * 100) / 100;
    }
    await setDoc(doc(db, 'orders', params.orderId, 'tracking', 'current'), payload, { merge: true });
  } catch (err) {
    console.warn('[LiveTracking] Could not persist orders/{orderId}/tracking/current:', err);
  }
}

export async function recordOrderTrackingEvent(params: {
  orderId: string;
  customerId: string;
  growerId: string;
  partnerId?: string;
  eventType: OrderTrackingEventType;
  label: string;
  note?: string;
  actorUid: string;
  actorRole: 'customer' | 'grower' | 'delivery' | 'system';
  lat?: number;
  lng?: number;
}): Promise<void> {
  try {
    const payload: Record<string, unknown> = {
      orderId: params.orderId,
      customerId: params.customerId,
      growerId: params.growerId,
      eventType: params.eventType,
      label: clampStr(params.label, 120, params.eventType),
      actorUid: params.actorUid,
      actorRole: params.actorRole,
      createdAt: serverTimestamp(),
    };
    if (params.partnerId) payload.partnerId = clampStr(params.partnerId, 128);
    if (params.note) payload.note = clampStr(params.note, 300);
    if (typeof params.lat === 'number' && typeof params.lng === 'number' && isValidCoord(params.lat, params.lng)) {
      payload.lat = params.lat;
      payload.lng = params.lng;
    }
    await setDoc(doc(db, 'orders', params.orderId, 'orderEvents', makeDocId('evt')), payload);
  } catch (err) {
    console.warn('[LiveTracking] Could not persist order tracking event:', err);
  }
}

export function subscribeOrderTrackingCurrent(
  orderId: string,
  onData: (tracking: OrderTrackingCurrentDoc | null) => void
) {
  const ref = doc(db, 'orders', orderId, 'tracking', 'current');
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const d = snap.data();
      const lat = Number(d.lat);
      const lng = Number(d.lng);
      if (!isValidCoord(lat, lng)) {
        onData(null);
        return;
      }
      onData({
        orderId: String(d.orderId || orderId),
        assignmentId: String(d.assignmentId || ''),
        partnerId: String(d.partnerId || ''),
        partnerName: typeof d.partnerName === 'string' ? d.partnerName : undefined,
        lat,
        lng,
        accuracy: typeof d.accuracy === 'number' ? d.accuracy : undefined,
        heading: typeof d.heading === 'number' ? d.heading : undefined,
        speed: typeof d.speed === 'number' ? d.speed : undefined,
        stage: (d.stage as OrderTrackingStage) || 'out_for_delivery',
        trackingActive: Boolean(d.trackingActive),
        lastUpdatedAt: typeof d.lastUpdatedAt === 'string' ? d.lastUpdatedAt : new Date().toISOString(),
      });
    },
    () => {
      // Non-fatal when doc doesn't exist yet or before partner is assigned
      onData(null);
    }
  );
}

export function subscribeOrderTrackingEvents(
  orderId: string,
  filterField: 'customerId' | 'growerId' | 'partnerId',
  uid: string,
  onData: (events: OrderTrackingEventDoc[]) => void
) {
  const q = query(
    collection(db, 'orders', orderId, 'orderEvents'),
    where(filterField, '==', uid)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list: OrderTrackingEventDoc[] = snap.docs.map((d) => {
        const data = d.data();
        const ts = data.createdAt instanceof Timestamp ? data.createdAt : null;
        return {
          id: d.id,
          orderId: String(data.orderId || orderId),
          customerId: String(data.customerId || ''),
          growerId: String(data.growerId || ''),
          partnerId: typeof data.partnerId === 'string' ? data.partnerId : undefined,
          eventType: (data.eventType as OrderTrackingEventType) || 'ORDER_CONFIRMED',
          label: String(data.label || data.eventType || 'Status Updated'),
          note: typeof data.note === 'string' ? data.note : undefined,
          actorUid: String(data.actorUid || ''),
          actorRole: (data.actorRole as OrderTrackingEventDoc['actorRole']) || 'system',
          lat: typeof data.lat === 'number' ? data.lat : undefined,
          lng: typeof data.lng === 'number' ? data.lng : undefined,
          createdAtText: ts
            ? ts.toDate().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
            : 'Just now',
          createdAtMs: ts ? ts.toMillis() : Date.now(),
        };
      });
      list.sort((a, b) => a.createdAtMs - b.createdAtMs);
      onData(list);
    },
    () => {
      onData([]);
    }
  );
}

// ---------------------------------------------------------------------------
// 8. Grower Fulfilment Actions (Accept / Reject / Ready for Pickup -> Dispatch)
// ---------------------------------------------------------------------------
export async function acceptSellerOrder(sellerOrder: SellerOrderDoc): Promise<void> {
  const path = `seller_orders/${sellerOrder.id}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'seller_orders', sellerOrder.id), {
      status: 'preparing',
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'orders', sellerOrder.parentOrderId), {
      status: 'preparing',
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'notifications', makeDocId('notif')), {
      userId: sellerOrder.customerId,
      eventType: 'SELLER_ORDER_ACCEPTED',
      title: `${sellerOrder.farmName} accepted ${sellerOrder.orderCode}`,
      body: 'Your produce is now being freshly harvested and packed.',
      targetRole: 'customer',
      targetScreen: 'buyer-receipt',
      unread: true,
      createdAt: serverTimestamp(),
    });
    batch.set(doc(db, 'orders', sellerOrder.parentOrderId, 'orderEvents', makeDocId('evt')), {
      orderId: sellerOrder.parentOrderId,
      customerId: sellerOrder.customerId,
      growerId: sellerOrder.growerId,
      eventType: 'GROWER_PREPARING',
      label: 'Grower Preparing Order',
      note: `${sellerOrder.farmName} accepted and started harvesting your order.`,
      actorUid: sellerOrder.growerId,
      actorRole: 'grower',
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function rejectSellerOrder(sellerOrder: SellerOrderDoc, reason: string): Promise<void> {
  const path = `seller_orders/${sellerOrder.id}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'seller_orders', sellerOrder.id), {
      status: 'rejected',
      rejectionReason: clampStr(reason, 240, 'Harvest unavailable'),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'notifications', makeDocId('notif')), {
      userId: sellerOrder.customerId,
      eventType: 'SELLER_ORDER_REJECTED',
      title: `Order ${sellerOrder.orderCode} update from ${sellerOrder.farmName}`,
      body: `Grower declined fulfilment: ${clampStr(reason, 180)}`,
      targetRole: 'customer',
      targetScreen: 'buyer-receipt',
      unread: true,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function markSellerOrderReadyForPickup(
  sellerOrder: SellerOrderDoc,
  growerLocation: { address: string; lat: number; lng: number },
  dropoffLocation: { lat: number; lng: number }
): Promise<string> {
  const assignmentId = makeDocId('del');
  const path = `seller_orders/${sellerOrder.id}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'seller_orders', sellerOrder.id), {
      status: 'ready_for_pickup',
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'orders', sellerOrder.parentOrderId), {
      status: 'ready_for_pickup',
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'delivery_assignments', assignmentId), {
      parentOrderId: sellerOrder.parentOrderId,
      sellerOrderId: sellerOrder.id,
      orderCode: sellerOrder.orderCode,
      customerId: sellerOrder.customerId,
      growerId: sellerOrder.growerId,
      farmName: sellerOrder.farmName,
      pickupAddress: clampStr(growerLocation.address, 240, 'Indiranagar Terrace Hub, Bengaluru'),
      pickupLat: growerLocation.lat,
      pickupLng: growerLocation.lng,
      dropoffAddress: clampStr(sellerOrder.customerArea, 300),
      dropoffLat: dropoffLocation.lat,
      dropoffLng: dropoffLocation.lng,
      status: 'open',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'notifications', makeDocId('notif')), {
      userId: sellerOrder.customerId,
      eventType: 'ORDER_READY_FOR_PICKUP',
      title: `Crate sealed for ${sellerOrder.orderCode}`,
      body: `${sellerOrder.farmName} marked your order ready. EV partner dispatch open.`,
      targetRole: 'customer',
      targetScreen: 'buyer-receipt',
      unread: true,
      createdAt: serverTimestamp(),
    });
    batch.set(doc(db, 'orders', sellerOrder.parentOrderId, 'orderEvents', makeDocId('evt')), {
      orderId: sellerOrder.parentOrderId,
      customerId: sellerOrder.customerId,
      growerId: sellerOrder.growerId,
      eventType: 'READY_FOR_PICKUP',
      label: 'Ready for EV Pickup',
      note: `${sellerOrder.farmName} sealed your crate for EV dispatch.`,
      actorUid: sellerOrder.growerId,
      actorRole: 'grower',
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    return assignmentId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

// ---------------------------------------------------------------------------
// 9. Delivery Partner Actions (Accept / Pickup Verified / Delivered / Issue)
// ---------------------------------------------------------------------------
export async function acceptDeliveryAssignment(
  assignment: DeliveryAssignmentDoc,
  partnerUid: string,
  partnerName: string
): Promise<void> {
  const path = `delivery_assignments/${assignment.id}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'delivery_assignments', assignment.id), {
      status: 'accepted',
      partnerId: partnerUid,
      partnerName: clampStr(partnerName, 120, 'EV Partner'),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'seller_orders', assignment.sellerOrderId), {
      assignedPartnerId: partnerUid,
      updatedAt: serverTimestamp(),
    });
    // Bind assignedPartnerId on parent order so live tracking subcollection & pickup rules authorize this partner
    batch.update(doc(db, 'orders', assignment.parentOrderId), {
      assignedPartnerId: partnerUid,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'orders', assignment.parentOrderId, 'orderEvents', makeDocId('evt')), {
      orderId: assignment.parentOrderId,
      customerId: assignment.customerId,
      growerId: assignment.growerId,
      partnerId: partnerUid,
      eventType: 'PARTNER_ASSIGNED',
      label: 'Delivery Partner Assigned',
      note: `${clampStr(partnerName, 120, 'EV Partner')} accepted pickup from ${assignment.farmName}.`,
      actorUid: partnerUid,
      actorRole: 'delivery',
      createdAt: serverTimestamp(),
    });
    batch.set(doc(db, 'notifications', makeDocId('notif')), {
      userId: assignment.growerId,
      eventType: 'DELIVERY_ACCEPTED',
      title: `EV Partner assigned for ${assignment.orderCode}`,
      body: `${partnerName} is on the way to pick up the crate.`,
      targetRole: 'grower',
      targetScreen: 'grower-orders',
      unread: true,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function recordVerifiedPickup(
  assignment: DeliveryAssignmentDoc,
  verifiedAtIso: string
): Promise<void> {
  const path = `delivery_assignments/${assignment.id}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'delivery_assignments', assignment.id), {
      status: 'picked_up',
      pickupVerifiedAt: verifiedAtIso,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'seller_orders', assignment.sellerOrderId), {
      status: 'picked_up',
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'orders', assignment.parentOrderId), {
      status: 'out_for_delivery',
      updatedAt: serverTimestamp(),
    });
    if (assignment.partnerId) {
      batch.set(doc(db, 'orders', assignment.parentOrderId, 'orderEvents', makeDocId('evt')), {
        orderId: assignment.parentOrderId,
        customerId: assignment.customerId,
        growerId: assignment.growerId,
        partnerId: assignment.partnerId,
        eventType: 'PICKED_UP',
        label: 'Order Picked Up',
        note: `Pickup QR verified at ${assignment.farmName}.`,
        actorUid: assignment.partnerId,
        actorRole: 'delivery',
        createdAt: serverTimestamp(),
      });
      batch.set(doc(db, 'orders', assignment.parentOrderId, 'orderEvents', makeDocId('evt')), {
        orderId: assignment.parentOrderId,
        customerId: assignment.customerId,
        growerId: assignment.growerId,
        partnerId: assignment.partnerId,
        eventType: 'OUT_FOR_DELIVERY',
        label: 'Out for Delivery',
        note: `EV partner is heading to your doorstep.`,
        actorUid: assignment.partnerId,
        actorRole: 'delivery',
        createdAt: serverTimestamp(),
      });
    }
    batch.set(doc(db, 'notifications', makeDocId('notif')), {
      userId: assignment.customerId,
      eventType: 'OUT_FOR_DELIVERY',
      title: `Order ${assignment.orderCode} is Out for Delivery`,
      body: `Pickup QR verified at ${assignment.farmName}. Your fresh produce is on the way.`,
      targetRole: 'customer',
      targetScreen: 'buyer-receipt',
      unread: true,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function recordVerifiedDeliveryComplete(
  assignment: DeliveryAssignmentDoc,
  sellerOrder: SellerOrderDoc | undefined,
  deliveredAtIso: string
): Promise<void> {
  const path = `delivery_assignments/${assignment.id}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'delivery_assignments', assignment.id), {
      status: 'delivered',
      deliveredAt: deliveredAtIso,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'seller_orders', assignment.sellerOrderId), {
      status: 'delivered',
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'orders', assignment.parentOrderId), {
      status: 'delivered',
      updatedAt: serverTimestamp(),
    });

    // Record Grower Payable Settlement entry upon verified delivery completion
    const gross = sellerOrder?.grossAmount ?? 0;
    const fee = sellerOrder?.platformFee ?? Math.round(gross * 0.1 * 100) / 100;
    const net = sellerOrder?.netPayout ?? Math.round((gross - fee) * 100) / 100;
    const summary =
      sellerOrder?.items?.map((i) => `${i.name} ×${i.quantity}`).join(', ') ||
      `Delivered ${assignment.orderCode}`;

    batch.set(doc(db, 'settlements', makeDocId('settle')), {
      growerId: assignment.growerId,
      orderCode: assignment.orderCode,
      summary: clampStr(summary, 200),
      status: 'payable',
      gross,
      fee,
      net,
      refNote: 'Delivery verified — payable in next grower payout batch',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (assignment.partnerId) {
      batch.set(doc(db, 'orders', assignment.parentOrderId, 'orderEvents', makeDocId('evt')), {
        orderId: assignment.parentOrderId,
        customerId: assignment.customerId,
        growerId: assignment.growerId,
        partnerId: assignment.partnerId,
        eventType: 'DELIVERED',
        label: 'Delivered',
        note: `Verified doorstep handover completed for ${assignment.orderCode}.`,
        actorUid: assignment.partnerId,
        actorRole: 'delivery',
        createdAt: serverTimestamp(),
      });
      const finalLat = isValidCoord(assignment.partnerLat, assignment.partnerLng)
        ? (assignment.partnerLat as number)
        : assignment.dropoffLat;
      const finalLng = isValidCoord(assignment.partnerLat, assignment.partnerLng)
        ? (assignment.partnerLng as number)
        : assignment.dropoffLng;
      if (isValidCoord(finalLat, finalLng)) {
        batch.set(
          doc(db, 'orders', assignment.parentOrderId, 'tracking', 'current'),
          {
            orderId: assignment.parentOrderId,
            assignmentId: assignment.id,
            partnerId: assignment.partnerId,
            partnerName: clampStr(assignment.partnerName, 120, 'EV Partner'),
            lat: finalLat,
            lng: finalLng,
            stage: 'delivered',
            trackingActive: false,
            lastUpdatedAt: deliveredAtIso,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
    }

    batch.set(doc(db, 'notifications', makeDocId('notif')), {
      userId: assignment.customerId,
      eventType: 'DELIVERY_COMPLETED',
      title: `Order ${assignment.orderCode} Delivered!`,
      body: `Verified delivery from ${assignment.farmName} completed.`,
      targetRole: 'customer',
      targetScreen: 'buyer-receipt',
      unread: true,
      createdAt: serverTimestamp(),
    });
    batch.set(doc(db, 'notifications', makeDocId('notif')), {
      userId: assignment.growerId,
      eventType: 'SETTLEMENT_UPDATED',
      title: `Payable recorded for ${assignment.orderCode}`,
      body: `Delivery confirmed. Net grower payable ₹${net} added to your ledger.`,
      targetRole: 'grower',
      targetScreen: 'grower-earnings',
      unread: true,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function reportDeliveryIssue(assignment: DeliveryAssignmentDoc, issueNote: string): Promise<void> {
  const path = `delivery_assignments/${assignment.id}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'delivery_assignments', assignment.id), {
      status: 'issue_reported',
      issueNote: clampStr(issueNote, 240, 'Customer unreachable'),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'notifications', makeDocId('notif')), {
      userId: assignment.customerId,
      eventType: 'DELIVERY_ISSUE',
      title: `Delivery exception on ${assignment.orderCode}`,
      body: `Partner reported: ${clampStr(issueNote, 180)}`,
      targetRole: 'customer',
      targetScreen: 'buyer-receipt',
      unread: true,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// ---------------------------------------------------------------------------
// 10. Grower Settlements & Notifications
// ---------------------------------------------------------------------------
export function subscribeGrowerSettlements(growerUid: string, onData: (entries: LedgerEntry[]) => void) {
  const path = 'settlements';
  const q = query(collection(db, 'settlements'), where('growerId', '==', growerUid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          growerId: String(data.growerId),
          orderCode: String(data.orderCode),
          status: data.status === 'settled' ? ('settled' as const) : ('payable' as const),
          isBulk: Boolean(data.isBulk),
          timestamp: formatTs(data.createdAt),
          summary: String(data.summary),
          gross: Number(data.gross || 0),
          fee: Number(data.fee || 0),
          net: Number(data.net || 0),
          refNote: String(data.refNote || ''),
          _sortMs: data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : 0,
        };
      });
      list.sort((a, b) => b._sortMs - a._sortMs);
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function requestSettlementReconciliation(settlementId: string, refNote: string): Promise<void> {
  const path = `settlements/${settlementId}`;
  try {
    await updateDoc(doc(db, 'settlements', settlementId), {
      status: 'settled',
      refNote: clampStr(refNote, 120),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export function subscribeUserNotifications(uid: string, onData: (items: NotificationDoc[]) => void) {
  const path = 'notifications';
  const q = query(collection(db, 'notifications'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          userId: String(data.userId),
          eventType: String(data.eventType),
          title: String(data.title),
          body: String(data.body),
          targetRole: (data.targetRole as UserRole) || 'customer',
          targetScreen: (data.targetScreen as ScreenId) || 'buyer-explore',
          unread: Boolean(data.unread),
          createdAtText: formatTs(data.createdAt),
          _sortMs: data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : 0,
        };
      });
      list.sort((a, b) => b._sortMs - a._sortMs);
      onData(list.slice(0, 30));
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function markAllNotificationsRead(notifs: NotificationDoc[]): Promise<void> {
  const unread = notifs.filter((n) => n.unread);
  if (unread.length === 0) return;
  try {
    const batch = writeBatch(db);
    for (const n of unread) {
      batch.update(doc(db, 'notifications', n.id), { unread: false });
    }
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, 'notifications');
  }
}

// ---------------------------------------------------------------------------
// 11. Institutional / Bulk Enquiries & Grower Quotations
// ---------------------------------------------------------------------------
export function subscribeBulkEnquiries(uid: string, onData: (enquiries: BulkEnquiryDoc[]) => void) {
  const path = 'bulk_enquiries';
  const mapDocs = (docs: { id: string; data: () => Record<string, unknown> }[]) =>
    docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        buyerId: String(data.buyerId),
        organizationName: String(data.organizationName),
        produceName: String(data.produceName),
        quantityKg: Number(data.quantityKg),
        frequency: (data.frequency as BulkEnquiryDoc['frequency']) || 'weekly',
        deliveryArea: String(data.deliveryArea),
        status: (data.status as BulkEnquiryDoc['status']) || 'open',
        quotedGrowerId: data.quotedGrowerId ? String(data.quotedGrowerId) : undefined,
        quotedFarmName: data.quotedFarmName ? String(data.quotedFarmName) : undefined,
        quotedPricePerKg: typeof data.quotedPricePerKg === 'number' ? data.quotedPricePerKg : undefined,
        quoteNotes: data.quoteNotes ? String(data.quoteNotes) : undefined,
        createdAt: formatTs(data.createdAt),
      };
    });

  let mine: BulkEnquiryDoc[] = [];
  let open: BulkEnquiryDoc[] = [];
  let quoted: BulkEnquiryDoc[] = [];
  const emit = () => {
    const m = new Map<string, BulkEnquiryDoc>();
    for (const item of [...mine, ...quoted, ...open]) m.set(item.id, item);
    onData(Array.from(m.values()));
  };

  const u1 = onSnapshot(
    query(collection(db, 'bulk_enquiries'), where('buyerId', '==', uid)),
    (s) => {
      mine = mapDocs(s.docs);
      emit();
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
  const u2 = onSnapshot(
    query(collection(db, 'bulk_enquiries'), where('status', '==', 'open')),
    (s) => {
      open = mapDocs(s.docs);
      emit();
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
  const u3 = onSnapshot(
    query(collection(db, 'bulk_enquiries'), where('quotedGrowerId', '==', uid)),
    (s) => {
      quoted = mapDocs(s.docs);
      emit();
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );

  return () => {
    u1();
    u2();
    u3();
  };
}

export async function createBulkEnquiry(
  buyerUid: string,
  payload: {
    organizationName: string;
    produceName: string;
    quantityKg: number;
    frequency: 'one_time' | 'daily' | 'weekly';
    deliveryArea: string;
  }
): Promise<string> {
  const id = makeDocId('bulk');
  const path = `bulk_enquiries/${id}`;
  try {
    await setDoc(doc(db, 'bulk_enquiries', id), {
      buyerId: buyerUid,
      organizationName: clampStr(payload.organizationName, 120),
      produceName: clampStr(payload.produceName, 120),
      quantityKg: Math.max(1, Math.min(50000, Number(payload.quantityKg))),
      frequency: payload.frequency,
      deliveryArea: clampStr(payload.deliveryArea, 200),
      status: 'open',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function submitGrowerBulkQuote(
  enquiry: BulkEnquiryDoc,
  growerUid: string,
  farmName: string,
  pricePerKg: number,
  quoteNotes: string
): Promise<void> {
  const path = `bulk_enquiries/${enquiry.id}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'bulk_enquiries', enquiry.id), {
      status: 'quoted',
      quotedGrowerId: growerUid,
      quotedFarmName: clampStr(farmName, 120),
      quotedPricePerKg: Math.max(1, Math.min(100000, Number(pricePerKg))),
      quoteNotes: clampStr(quoteNotes, 300),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'notifications', makeDocId('notif')), {
      userId: enquiry.buyerId,
      eventType: 'BULK_QUOTE_SUBMITTED',
      title: `Wholesale quote from ${farmName}`,
      body: `₹${pricePerKg}/kg quoted for ${enquiry.quantityKg} kg ${enquiry.produceName}.`,
      targetRole: 'bulk',
      targetScreen: 'buyer-bulk',
      unread: true,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function respondToBulkQuote(
  enquiry: BulkEnquiryDoc,
  decision: 'accepted' | 'rejected'
): Promise<void> {
  const path = `bulk_enquiries/${enquiry.id}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'bulk_enquiries', enquiry.id), {
      status: decision,
      updatedAt: serverTimestamp(),
    });
    if (enquiry.quotedGrowerId) {
      batch.set(doc(db, 'notifications', makeDocId('notif')), {
        userId: enquiry.quotedGrowerId,
        eventType: decision === 'accepted' ? 'BULK_QUOTE_ACCEPTED' : 'BULK_QUOTE_REJECTED',
        title: `Bulk quote ${decision} by ${enquiry.organizationName}`,
        body: `${enquiry.quantityKg} kg ${enquiry.produceName} at ₹${enquiry.quotedPricePerKg}/kg.`,
        targetRole: 'grower',
        targetScreen: 'buyer-bulk',
        unread: true,
        createdAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// ---------------------------------------------------------------------------
// 12. Customer Care Support Tickets (users/{uid}/support_tickets)
// ---------------------------------------------------------------------------
export function subscribeSupportTickets(uid: string, onData: (tickets: SupportTicketDoc[]) => void) {
  const path = `users/${uid}/support_tickets`;
  const q = query(collection(db, 'users', uid, 'support_tickets'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          userId: String(data.userId || uid),
          category: (data.category as SupportTicketCategory) || 'general',
          orderCode: data.orderCode ? String(data.orderCode) : undefined,
          subject: String(data.subject || ''),
          message: String(data.message || ''),
          contactPhone: data.contactPhone ? String(data.contactPhone) : undefined,
          status: data.status === 'resolved' ? ('resolved' as const) : ('open' as const),
          createdAtText: formatTs(data.createdAt),
          _sortMs: data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : 0,
        };
      });
      list.sort((a, b) => b._sortMs - a._sortMs);
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function createSupportTicket(
  uid: string,
  payload: {
    category: SupportTicketCategory;
    orderCode?: string;
    subject: string;
    message: string;
    contactPhone?: string;
  }
): Promise<string> {
  const id = makeDocId('care');
  const path = `users/${uid}/support_tickets/${id}`;
  try {
    const docPayload: Record<string, unknown> = {
      userId: uid,
      category: payload.category,
      subject: clampStr(payload.subject, 120),
      message: clampStr(payload.message, 800),
      status: 'open',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (payload.orderCode?.trim()) {
      docPayload.orderCode = clampStr(payload.orderCode, 32);
    }
    if (payload.contactPhone?.trim()) {
      docPayload.contactPhone = clampStr(payload.contactPhone, 24);
    }
    await setDoc(doc(db, 'users', uid, 'support_tickets', id), docPayload);
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function resolveSupportTicket(uid: string, ticketId: string): Promise<void> {
  const path = `users/${uid}/support_tickets/${ticketId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'support_tickets', ticketId), {
      status: 'resolved',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteSupportTicket(uid: string, ticketId: string): Promise<void> {
  const path = `users/${uid}/support_tickets/${ticketId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'support_tickets', ticketId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// ---------------------------------------------------------------------------
// 13. Green Escrow Wallet & Passbook (users/{uid}/wallet_transactions)
// ---------------------------------------------------------------------------
export function subscribeWalletTransactions(
  uid: string,
  onData: (transactions: WalletTransactionDoc[]) => void
) {
  const path = `users/${uid}/wallet_transactions`;
  const q = query(collection(db, 'users', uid, 'wallet_transactions'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          userId: String(data.userId || uid),
          type: (data.type as WalletTxType) || 'topup',
          amount: Number(data.amount || 0),
          orderCode: data.orderCode ? String(data.orderCode) : undefined,
          method: String(data.method || 'UPI'),
          note: String(data.note || 'Wallet transaction'),
          createdAtText: formatTs(data.createdAt),
          _sortMs: data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : 0,
        };
      });
      list.sort((a, b) => b._sortMs - a._sortMs);
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function creditWalletBalance(
  uid: string,
  amountInr: number,
  method: string,
  note: string
): Promise<number> {
  const amount = Math.round(Number(amountInr) * 100) / 100;
  if (!Number.isFinite(amount) || amount < 10 || amount > 50000) {
    throw new Error('Top-up amount must be between ₹10 and ₹50,000.');
  }
  const txId = makeDocId('wtx');
  const userRef = doc(db, 'users', uid);
  const txRef = doc(db, 'users', uid, 'wallet_transactions', txId);

  try {
    let nextBalance = 0;
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists()) throw new Error('User profile not initialized.');
      const current = Number(snap.data().walletBalance || 0);
      nextBalance = Math.min(500000, Math.round((current + amount) * 100) / 100);
      tx.update(userRef, {
        walletBalance: nextBalance,
        updatedAt: serverTimestamp(),
      });
      tx.set(txRef, {
        userId: uid,
        type: 'topup',
        amount,
        method: clampStr(method, 60, 'Direct UPI QR'),
        note: clampStr(note, 200, 'Green Escrow Wallet Top-Up'),
        createdAt: serverTimestamp(),
      });
    });
    return nextBalance;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${uid}/wallet_transactions/${txId}`);
  }
}

export async function debitWalletForOrder(
  uid: string,
  amountInr: number,
  orderCode: string,
  note: string
): Promise<number> {
  const amount = Math.round(Number(amountInr) * 100) / 100;
  const txId = makeDocId('wtx');
  const userRef = doc(db, 'users', uid);
  const txRef = doc(db, 'users', uid, 'wallet_transactions', txId);

  try {
    let nextBalance = 0;
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists()) throw new Error('User profile not initialized.');
      const current = Number(snap.data().walletBalance || 0);
      if (current < amount) {
        throw new Error(`Insufficient wallet balance (Available: ₹${current.toFixed(2)}, Required: ₹${amount.toFixed(2)}).`);
      }
      nextBalance = Math.round((current - amount) * 100) / 100;
      tx.update(userRef, {
        walletBalance: nextBalance,
        updatedAt: serverTimestamp(),
      });
      tx.set(txRef, {
        userId: uid,
        type: 'escrow_hold',
        amount,
        orderCode: clampStr(orderCode, 32),
        method: 'Green Escrow Wallet',
        note: clampStr(note, 200, `Escrow held for Order ${orderCode}`),
        createdAt: serverTimestamp(),
      });
    });
    return nextBalance;
  } catch (err) {
    if (err instanceof Error && err.message.includes('Insufficient wallet balance')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `users/${uid}/wallet_transactions/${txId}`);
  }
}

export async function toggleFavoriteGrower(
  uid: string,
  growerId: string,
  currentFavorites: string[]
): Promise<string[]> {
  const exists = currentFavorites.includes(growerId);
  const next = exists
    ? currentFavorites.filter((id) => id !== growerId)
    : [...currentFavorites, growerId].slice(0, 50);
  await saveFullUserProfile(uid, { favoriteGrowerIds: next });
  return next;
}

