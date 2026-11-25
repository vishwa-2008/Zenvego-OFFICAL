import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendEmailVerification,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import { AppShell, NotificationItem } from './components/AppShell';
import { BulkProcurementScreen } from './components/BulkScreens';
import {
  CartReviewScreen,
  CategoryExplorerScreen,
  LocationDetectorScreen,
  NearbyGrowersScreen,
  OrderReceiptScreen,
  PaymentGatewayScreen,
} from './components/CustomerScreens';
import {
  PartnerAuditScreen,
  PartnerOnboardingScreen,
  PickupHandshakeScreen,
} from './components/DeliveryScreens';
import {
  AddHarvestScreen,
  CropAnalyticsScreen,
  EarningsLedgerScreen,
  GrowerComplianceScreen,
  InventoryScreen,
  OrderHandoverScreen,
} from './components/GrowerScreens';
import { DeliveryWelcomeScreen, LoginScreen, WelcomeScreen } from './components/OnboardingScreens';
import { ProductCheckoutScreen } from './components/ProductCheckoutScreen';
import { ProductQrStudio } from './components/ProductQrStudio';
import { ProfileScreen, ProfileSetupScreen } from './components/ProfileScreens';
import { ZenvegoConcierge } from './components/ZenvegoConcierge';
import type { PartnerGpsTelemetry } from './components/MapLibreWidgets';
import { CheckoutValidationResponse, zenvegoApi } from './lib/apiClient';
import { isValidCoord } from './lib/geo';
import { parseZenvegoQrPayload } from './utils/qrGenerator';
import { auth, googleProvider, testFirestoreConnection } from './lib/firebase';
import {
  acceptDeliveryAssignment,
  acceptSellerOrder,
  createBulkEnquiry,
  createProductListing,
  createSupportTicket,
  creditWalletBalance,
  debitWalletForOrder,
  deleteProductListing,
  deleteSupportTicket,
  deleteUserAddress,
  getParentOrderDeliveryCoords,
  markAllNotificationsRead,
  markSellerOrderReadyForPickup,
  placeMultiGrowerOrderTransaction,
  recordOrderTrackingEvent,
  recordVerifiedDeliveryComplete,
  recordVerifiedPickup,
  rejectSellerOrder,
  reportDeliveryIssue,
  requestSettlementReconciliation,
  resolveSupportTicket,
  respondToBulkQuote,
  saveDeliveryProfile,
  saveFullUserProfile,
  saveGrowerProfile,
  saveUserAddress,
  setCartItemQuantity,
  submitGrowerBulkQuote,
  subscribeBulkEnquiries,
  subscribeCompletedCustomerOrders,
  subscribeCustomerDeliveryAssignments,
  subscribeCustomerOrders,
  subscribeDeliveryAssignments,
  subscribeDeliveryProfile,
  subscribeGrowerDeliveryAssignments,
  subscribeGrowerProducts,
  subscribeGrowerProfiles,
  subscribeGrowerSellerOrders,
  subscribeGrowerSettlements,
  subscribeMarketplaceProducts,
  subscribeSupportTickets,
  subscribeUserAddresses,
  subscribeUserCart,
  subscribeUserNotifications,
  subscribeUserProfile,
  subscribeWalletTransactions,
  toggleFavoriteGrower,
  updateDeliveryPartnerLocation,
  upsertOrderTrackingCurrent,
  updateProductFields,
  updateUserAddress,
  upsertUserProfile,
  verifyAndEnterPortalAccount,
} from './lib/firestoreService';
import {
  ActiveOrder,
  AvatarType,
  BulkEnquiryDoc,
  CartItem,
  DeliveryAssignmentDoc,
  DeliveryProfileDoc,
  GrowerListing,
  GrowerProfileDoc,
  LedgerEntry,
  NotificationDoc,
  ProductCheckoutDeepLink,
  SavedAddress,
  ScreenId,
  SellerOrderDoc,
  SupportTicketCategory,
  SupportTicketDoc,
  UserProfileDoc,
  UserRole,
  WalletTransactionDoc,
  ZenvegoAvatarPreset,
} from './types';

const PUBLIC_SCREENS = new Set<ScreenId>(['welcome', 'login', 'delivery-welcome', 'product-checkout']);

function parseInitialDeepLinkFromLocation(): {
  store?: string;
  productCheckout?: ProductCheckoutDeepLink;
} {
  if (typeof window === 'undefined') return {};
  const parsed = parseZenvegoQrPayload(window.location.href);
  if (parsed.kind === 'product' && parsed.productId) {
    return {
      store: parsed.growerId,
      productCheckout: {
        productId: parsed.productId,
        growerId: parsed.growerId,
        qty: parsed.qty,
        src: parsed.src,
        tagline: parsed.tagline,
      },
    };
  }
  if (parsed.kind === 'store' && parsed.growerId) {
    return { store: parsed.growerId };
  }
  return {};
}

function formatPortalLabel(role: UserRole): string {
  if (role === 'grower') return 'Seller / Grower';
  if (role === 'delivery') return 'Delivery Partner';
  if (role === 'bulk') return 'Bulk Buyer';
  return 'Customer';
}

function isScreenAllowedForRole(targetScreen: ScreenId, activeRole: UserRole): boolean {
  if (
    targetScreen === 'welcome' ||
    targetScreen === 'login' ||
    targetScreen === 'profile' ||
    targetScreen === 'profile-setup' ||
    targetScreen === 'product-checkout'
  ) {
    return true;
  }
  if (targetScreen === 'buyer-bulk') {
    return activeRole === 'customer' || activeRole === 'bulk' || activeRole === 'grower';
  }
  if (targetScreen.startsWith('buyer-')) {
    return activeRole === 'customer' || activeRole === 'bulk';
  }
  if (targetScreen.startsWith('grower-')) {
    return activeRole === 'grower';
  }
  if (targetScreen.startsWith('delivery-')) {
    return activeRole === 'delivery';
  }
  return true;
}

function defaultScreenForRole(role: UserRole): ScreenId {
  if (role === 'grower') return 'grower-dashboard';
  if (role === 'delivery') return 'delivery-pickup';
  if (role === 'bulk') return 'buyer-bulk';
  return 'buyer-explore';
}

function iconForEventType(eventType: string): string {
  switch (eventType) {
    case 'ORDER_CONFIRMED':
      return 'shopping_bag';
    case 'SELLER_ORDER_ACCEPTED':
      return 'eco';
    case 'SELLER_ORDER_REJECTED':
      return 'cancel';
    case 'ORDER_READY_FOR_PICKUP':
      return 'inventory_2';
    case 'DELIVERY_ACCEPTED':
    case 'OUT_FOR_DELIVERY':
      return 'two_wheeler';
    case 'DELIVERY_COMPLETED':
      return 'verified';
    case 'SETTLEMENT_UPDATED':
      return 'account_balance_wallet';
    case 'DELIVERY_ISSUE':
      return 'warning';
    case 'BULK_QUOTE_SUBMITTED':
    case 'BULK_QUOTE_ACCEPTED':
    case 'BULK_QUOTE_REJECTED':
      return 'apartment';
    default:
      return 'notifications';
  }
}

export default function App() {
  // Auth & Connection State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [firestoreOfflineMsg, setFirestoreOfflineMsg] = useState<string | null>(null);
  const [pendingEmailLinkUrl, setPendingEmailLinkUrl] = useState<string | null>(null);
  const [confirmEmailInput, setConfirmEmailInput] = useState('');

  // Navigation & Portal State (role = locked active session portal; welcomeTargetRole = pre-login selector)
  const initialLink = useMemo(() => parseInitialDeepLinkFromLocation(), []);
  const [role, setRole] = useState<UserRole>('customer');
  const [welcomeTargetRole, setWelcomeTargetRole] = useState<UserRole>('customer');
  const [screen, setScreen] = useState<ScreenId>(() =>
    initialLink.productCheckout ? 'product-checkout' : 'welcome'
  );
  const [history, setHistory] = useState<ScreenId[]>(() =>
    initialLink.productCheckout ? ['welcome', 'product-checkout'] : ['welcome']
  );
  const [pendingDeepLink, setPendingDeepLink] = useState<{
    store?: string;
    product?: string;
    productCheckout?: ProductCheckoutDeepLink;
  } | null>(() =>
    initialLink.productCheckout || initialLink.store
      ? {
          store: initialLink.store,
          product: initialLink.productCheckout?.productId,
          productCheckout: initialLink.productCheckout,
        }
      : null
  );
  const pendingDeepLinkRef = useRef(pendingDeepLink);
  pendingDeepLinkRef.current = pendingDeepLink;
  const [activeProductCheckout, setActiveProductCheckout] = useState<ProductCheckoutDeepLink | null>(
    () => initialLink.productCheckout ?? null
  );
  const [qrStudioProductId, setQrStudioProductId] = useState<string | null>(null);
  const [farmFilter, setFarmFilter] = useState<string | null>(() => initialLink.store ?? null);
  const [highlightedProductId, setHighlightedProductId] = useState<string | null>(
    () => initialLink.productCheckout?.productId ?? null
  );
  const portalGateInFlightRef = useRef(false);

  // Real-Time Firestore State (Zero Mock Business Data)
  const [userProfile, setUserProfile] = useState<UserProfileDoc | null>(null);
  const [supportTickets, setSupportTickets] = useState<SupportTicketDoc[]>([]);
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string>('');
  const [activeDeliveryCoords, setActiveDeliveryCoords] = useState<{
    address: string;
    lat: number;
    lng: number;
  }>({
    address: 'Indiranagar, Bengaluru',
    lat: 12.9784,
    lng: 77.6408,
  });

  const [marketplaceListings, setMarketplaceListings] = useState<GrowerListing[]>([]);
  const [growerListings, setGrowerListings] = useState<GrowerListing[]>([]);
  const [growerProfiles, setGrowerProfiles] = useState<GrowerProfileDoc[]>([]);
  const [deliveryProfile, setDeliveryProfile] = useState<DeliveryProfileDoc | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerOrders, setCustomerOrders] = useState<ActiveOrder[]>([]);
  const [completedCustomerOrders, setCompletedCustomerOrders] = useState<ActiveOrder[]>([]);
  const [customerDeliveryAssignments, setCustomerDeliveryAssignments] = useState<DeliveryAssignmentDoc[]>([]);
  const [sellerOrders, setSellerOrders] = useState<SellerOrderDoc[]>([]);
  const [growerDeliveryAssignments, setGrowerDeliveryAssignments] = useState<DeliveryAssignmentDoc[]>([]);
  const [deliveryAssignments, setDeliveryAssignments] = useState<DeliveryAssignmentDoc[]>([]);
  const [walletTransactions, setWalletTransactions] = useState<WalletTransactionDoc[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [notifications, setNotifications] = useState<NotificationDoc[]>([]);
  const [bulkEnquiries, setBulkEnquiries] = useState<BulkEnquiryDoc[]>([]);

  // Toast Notification & Zenvego Desk Drawer
  const [toast, setToast] = useState<string | null>(null);
  const [deskOpen, setDeskOpen] = useState<boolean>(false);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  // 1b. Complete Firebase Passwordless Email Verification Link Sign-In on Boot (Strict Portal Account Gate)
  const completeEmailLinkSignIn = useCallback(
    async (email: string, href: string) => {
      portalGateInFlightRef.current = true;
      setAuthLoading(true);
      setAuthError(null);
      try {
        const result = await signInWithEmailLink(auth, email.trim(), href);
        const u = result.user;
        const savedRole = (window.localStorage.getItem('zenvego_role_for_signin') as UserRole | null) || 'customer';
        const savedMode =
          (window.localStorage.getItem('zenvego_mode_for_signin') as 'signin' | 'signup' | null) || 'signin';
        window.localStorage.removeItem('zenvego_email_for_signin');
        window.localStorage.removeItem('zenvego_role_for_signin');
        window.localStorage.removeItem('zenvego_mode_for_signin');
        window.history.replaceState({}, '', window.location.pathname);
        setPendingEmailLinkUrl(null);
        setConfirmEmailInput('');

        const portalCheck = await verifyAndEnterPortalAccount({
          uid: u.uid,
          displayName: u.displayName || u.email?.split('@')[0] || 'Zenvego Member',
          email: u.email || undefined,
          photoURL: u.photoURL || undefined,
          targetRole: savedRole,
          mode: savedMode,
        });

        if (!portalCheck.allowed) {
          await signOut(auth);
          const existingText =
            portalCheck.registeredPortals.length > 0
              ? ` Your registered portal(s): ${portalCheck.registeredPortals.map(formatPortalLabel).join(', ')}.`
              : '';
          setAuthError(
            `No ${formatPortalLabel(savedRole)} account exists for ${u.email || 'this email'}.${existingText} Please create a new account for the ${formatPortalLabel(savedRole)} portal separately.`
          );
          setWelcomeTargetRole(savedRole);
          setRole(savedRole);
          setScreen('login');
          return;
        }

        setRole(savedRole);
        setWelcomeTargetRole(savedRole);
        setEmailVerified(Boolean(u.emailVerified));

        if (savedRole === 'grower' && !portalCheck.hasGrowerKyc) {
          setScreen('grower-kyc');
          setHistory(['welcome', 'grower-kyc']);
          showToast('Email verified! Complete Live Photo & Seller KYC to activate your Grower storefront.');
        } else if (savedRole === 'delivery' && !portalCheck.hasDeliveryKyc) {
          setScreen('delivery-onboarding');
          setHistory(['welcome', 'delivery-onboarding']);
          showToast('Email verified! Complete Live Photo & Delivery Partner KYC to start dispatching.');
        } else if (!portalCheck.profileCompleted) {
          setScreen('profile-setup');
          setHistory(['welcome', 'profile-setup']);
          showToast('Email link verified! Complete your profile to get started.');
        } else {
          const link = pendingDeepLinkRef.current;
          if (link?.productCheckout) {
            setActiveProductCheckout(link.productCheckout);
            setScreen('product-checkout');
            setHistory(['welcome', 'product-checkout']);
            setPendingDeepLink(null);
            showToast(`Signed in (${u.email}) — opening direct product checkout`);
          } else {
            const target = defaultScreenForRole(savedRole);
            setScreen(target);
            setHistory(['welcome', target]);
            showToast(`Signed in to ${formatPortalLabel(savedRole)} Portal (${u.email})`);
          }
        }
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Email sign-in link could not be verified or has expired.');
        setScreen('login');
      } finally {
        portalGateInFlightRef.current = false;
        setAuthLoading(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    const href = window.location.href;
    if (isSignInWithEmailLink(auth, href)) {
      const savedEmail = window.localStorage.getItem('zenvego_email_for_signin');
      if (savedEmail) {
        completeEmailLinkSignIn(savedEmail, href);
      } else {
        setPendingEmailLinkUrl(href);
      }
    }
  }, [completeEmailLinkSignIn]);

  // 2. Test Live Firestore Connectivity on Boot
  useEffect(() => {
    let active = true;
    testFirestoreConnection().then((res) => {
      if (active && res.offline) {
        setFirestoreOfflineMsg(res.message || 'Firestore connection is offline.');
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // 3. Firebase Authentication Listener (Restores locked portal session on reload without bypassing portal gate)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setEmailVerified(Boolean(user?.emailVerified));
      setAuthReady(true);

      if (user) {
        if (!portalGateInFlightRef.current) {
          upsertUserProfile({
            uid: user.uid,
            displayName: user.displayName || user.email?.split('@')[0] || 'Zenvego Member',
            email: user.email || undefined,
            photoURL: user.photoURL || undefined,
            activeRole: role,
          })
            .then((res) => {
              setRole(res.activeRole);
              setWelcomeTargetRole(res.activeRole);
              const link = pendingDeepLinkRef.current;
              if (link?.productCheckout) {
                setActiveProductCheckout(link.productCheckout);
                setScreen('product-checkout');
                setHistory(['welcome', 'product-checkout']);
                setPendingDeepLink(null);
              } else if (link && (res.activeRole === 'customer' || res.activeRole === 'bulk')) {
                setScreen('buyer-explore');
                setHistory(['welcome', 'buyer-explore']);
                setPendingDeepLink(null);
              }
            })
            .catch(() => {
              // Non-fatal if profile read races
            });
        }
      } else {
        // Clear all user-scoped state cleanly on sign-out
        setUserProfile(null);
        setSupportTickets([]);
        setAddresses([]);
        setSelectedAddressId('');
        setMarketplaceListings([]);
        setGrowerListings([]);
        setGrowerProfiles([]);
        setDeliveryProfile(null);
        setCart([]);
        setCustomerOrders([]);
        setCompletedCustomerOrders([]);
        setCustomerDeliveryAssignments([]);
        setSellerOrders([]);
        setDeliveryAssignments([]);
        setWalletTransactions([]);
        setLedger([]);
        setNotifications([]);
        setBulkEnquiries([]);
      }
    });

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 4. Attach Real-Time Cloud Firestore Listeners Only When Authenticated
  useEffect(() => {
    if (!authReady || !currentUser) return;
    const uid = currentUser.uid;
    const unsubs: Array<() => void> = [];

    unsubs.push(subscribeUserProfile(uid, setUserProfile));
    unsubs.push(subscribeSupportTickets(uid, setSupportTickets));
    unsubs.push(
      subscribeUserAddresses(uid, (list) => {
        setAddresses(list);
        if (list.length > 0) {
          setSelectedAddressId((prev) => (prev && list.some((a) => a.id === prev) ? prev : list[0].id));
        } else {
          setSelectedAddressId('');
        }
      })
    );
    unsubs.push(subscribeUserCart(uid, setCart));
    unsubs.push(subscribeGrowerProfiles(setGrowerProfiles));
    unsubs.push(subscribeDeliveryProfile(uid, setDeliveryProfile));
    unsubs.push(subscribeCustomerOrders(uid, setCustomerOrders));
    unsubs.push(subscribeCompletedCustomerOrders(uid, setCompletedCustomerOrders));
    unsubs.push(subscribeCustomerDeliveryAssignments(uid, setCustomerDeliveryAssignments));
    unsubs.push(subscribeGrowerSellerOrders(uid, setSellerOrders));
    unsubs.push(subscribeGrowerDeliveryAssignments(uid, setGrowerDeliveryAssignments));
    unsubs.push(subscribeDeliveryAssignments(uid, setDeliveryAssignments));
    unsubs.push(subscribeWalletTransactions(uid, setWalletTransactions));
    unsubs.push(subscribeGrowerSettlements(uid, setLedger));
    unsubs.push(subscribeUserNotifications(uid, setNotifications));
    unsubs.push(subscribeBulkEnquiries(uid, setBulkEnquiries));

    return () => {
      unsubs.forEach((u) => {
        try {
          u();
        } catch {
          // Ignore teardown errors
        }
      });
    };
  }, [authReady, currentUser]);

  // 4b. Sync active order handover PINs with server verifier so QR & 4-digit PINs work seamlessly even after server restarts
  const syncedPinsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!currentUser) return;
    for (const ord of customerOrders) {
      if (ord.id && ord.status !== 'delivered' && ord.status !== 'cancelled' && ord.handoverPin) {
        const key = `delivery:${ord.id}:${ord.handoverPin}`;
        if (!syncedPinsRef.current.has(key)) {
          syncedPinsRef.current.add(key);
          zenvegoApi
            .registerQrHandover({
              action: 'delivery',
              orderId: ord.id,
              orderCode: ord.orderCode,
              handoverPin: ord.handoverPin,
            })
            .catch(() => {
              syncedPinsRef.current.delete(key);
            });
        }
      }
    }
    for (const so of sellerOrders) {
      if (so.status !== 'delivered' && so.status !== 'rejected' && so.handoverPin) {
        const key = `pickup:${so.id}:${so.handoverPin}`;
        if (!syncedPinsRef.current.has(key)) {
          syncedPinsRef.current.add(key);
          zenvegoApi
            .registerQrHandover({
              action: 'pickup',
              orderId: so.parentOrderId,
              sellerOrderId: so.id,
              orderCode: so.orderCode,
              handoverPin: so.handoverPin,
            })
            .catch(() => {
              syncedPinsRef.current.delete(key);
            });
        }
      }
    }
  }, [currentUser, customerOrders, sellerOrders]);

  // 5. Subscribe to Live Marketplace & Grower Catalog (Recalculates Distance When Active Coordinates Change)
  useEffect(() => {
    if (!authReady || !currentUser) return;
    const uid = currentUser.uid;
    const uMarket = subscribeMarketplaceProducts(
      activeDeliveryCoords.lat,
      activeDeliveryCoords.lng,
      setMarketplaceListings
    );
    const uGrower = subscribeGrowerProducts(
      uid,
      activeDeliveryCoords.lat,
      activeDeliveryCoords.lng,
      setGrowerListings
    );
    return () => {
      uMarket();
      uGrower();
    };
  }, [authReady, currentUser, activeDeliveryCoords.lat, activeDeliveryCoords.lng]);

  // Sync activeDeliveryCoords when saved address selection or defaultAddressId changes
  useEffect(() => {
    if (
      userProfile?.defaultAddressId &&
      !selectedAddressId &&
      addresses.some((a) => a.id === userProfile.defaultAddressId)
    ) {
      setSelectedAddressId(userProfile.defaultAddressId);
      return;
    }
    const selected = addresses.find((a) => a.id === selectedAddressId);
    if (selected) {
      setActiveDeliveryCoords({
        address: selected.address,
        lat: selected.lat,
        lng: selected.lng,
      });
    }
  }, [addresses, selectedAddressId, userProfile?.defaultAddressId]);

  // Derived Profiles & Counts
  const myGrowerProfile = useMemo(
    () => (currentUser ? growerProfiles.find((g) => g.ownerId === currentUser.uid) ?? null : null),
    [growerProfiles, currentUser]
  );

  const activeOrder = useMemo(() => customerOrders[0] ?? null, [customerOrders]);

  const cartCount = useMemo(() => cart.reduce((sum, c) => sum + c.quantity, 0), [cart]);

  const shellNotifications: NotificationItem[] = useMemo(
    () =>
      notifications.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        time: n.createdAtText,
        icon: iconForEventType(n.eventType),
        targetRole: n.targetRole,
        targetScreen: n.targetScreen,
        unread: n.unread,
      })),
    [notifications]
  );

  // Navigation Helpers (Enforces Firebase Auth + Strict Separate Portal Isolation)
  const navigate = useCallback(
    (next: ScreenId) => {
      if (!PUBLIC_SCREENS.has(next) && !currentUser) {
        setScreen('login');
        setHistory((prev) => [...prev, 'login']);
        showToast('Sign in to access your Zenvego portal');
        return;
      }
      if (currentUser && !isScreenAllowedForRole(next, role)) {
        showToast(
          `Direct portal shifting is disabled. Sign out from ${formatPortalLabel(role)} first to log into another portal.`
        );
        return;
      }
      setScreen(next);
      setHistory((prev) => (prev[prev.length - 1] === next ? prev : [...prev, next]));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [currentUser, role, showToast]
  );

  const goBack = useCallback(() => {
    setHistory((prev) => {
      if (prev.length <= 1) {
        setScreen('welcome');
        return ['welcome'];
      }
      const nextHist = prev.slice(0, -1);
      setScreen(nextHist[nextHist.length - 1]);
      return nextHist;
    });
  }, []);

  // Auth Actions (Strict Per-Portal Account Enforcement — No Direct Portal Shifting)
  const handleGoogleSignIn = useCallback(
    async (selectedRole: UserRole, mode: 'signin' | 'signup') => {
      portalGateInFlightRef.current = true;
      setAuthLoading(true);
      setAuthError(null);
      try {
        const result = await signInWithPopup(auth, googleProvider);
        const u = result.user;

        const portalCheck = await verifyAndEnterPortalAccount({
          uid: u.uid,
          displayName: u.displayName || u.email?.split('@')[0] || 'Zenvego Member',
          email: u.email || undefined,
          photoURL: u.photoURL || undefined,
          targetRole: selectedRole,
          mode,
        });

        if (!portalCheck.allowed) {
          await signOut(auth);
          const existingText =
            portalCheck.registeredPortals.length > 0
              ? ` Your registered portal(s): ${portalCheck.registeredPortals.map(formatPortalLabel).join(', ')}.`
              : '';
          setAuthError(
            `No ${formatPortalLabel(selectedRole)} account exists for ${u.email || 'this account'}.${existingText} Please create a new account for the ${formatPortalLabel(selectedRole)} portal separately.`
          );
          return;
        }

        setRole(selectedRole);
        setWelcomeTargetRole(selectedRole);

        if (selectedRole === 'grower' && !portalCheck.hasGrowerKyc) {
          setScreen('grower-kyc');
          setHistory(['welcome', 'grower-kyc']);
          showToast('Complete your Live Photo & Seller KYC to activate your Grower storefront.');
        } else if (selectedRole === 'delivery' && !portalCheck.hasDeliveryKyc) {
          setScreen('delivery-onboarding');
          setHistory(['welcome', 'delivery-onboarding']);
          showToast('Complete your Live Photo & Delivery Partner KYC to start dispatching.');
        } else if (!portalCheck.profileCompleted) {
          setScreen('profile-setup');
          setHistory(['welcome', 'profile-setup']);
          showToast(`Welcome ${u.displayName || u.email}! Complete your profile to get started.`);
        } else {
          const target: ScreenId = pendingDeepLink?.productCheckout
            ? 'product-checkout'
            : pendingDeepLink && (selectedRole === 'customer' || selectedRole === 'bulk')
              ? 'buyer-explore'
              : defaultScreenForRole(selectedRole);
          if (pendingDeepLink?.productCheckout) {
            setActiveProductCheckout(pendingDeepLink.productCheckout);
          }
          setPendingDeepLink(null);
          setScreen(target);
          setHistory(['welcome', target]);
          showToast(`Signed in to ${formatPortalLabel(selectedRole)} Portal`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Google Sign-In failed.';
        if (msg.includes('popup-closed-by-user')) {
          setAuthError('Sign-in popup was closed before completion. Please try again.');
        } else if (msg.includes('unauthorized-domain')) {
          setAuthError('This preview domain needs to be authorized in Firebase Auth settings.');
        } else {
          setAuthError(msg);
        }
      } finally {
        portalGateInFlightRef.current = false;
        setAuthLoading(false);
      }
    },
    [pendingDeepLink, showToast]
  );

  const handleSendEmailSignInLink = useCallback(
    async (email: string, selectedRole: UserRole, mode: 'signin' | 'signup') => {
      const normalized = email.trim().toLowerCase();
      if (!normalized || !normalized.includes('@')) {
        throw new Error('Please enter a valid email address.');
      }
      try {
        await sendSignInLinkToEmail(auth, normalized, {
          url: window.location.origin,
          handleCodeInApp: true,
        });
        window.localStorage.setItem('zenvego_email_for_signin', normalized);
        window.localStorage.setItem('zenvego_role_for_signin', selectedRole);
        window.localStorage.setItem('zenvego_mode_for_signin', mode);
        showToast(`Verification link sent to ${normalized}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to send sign-in link.';
        if (msg.includes('operation-not-allowed')) {
          throw new Error(
            'Enable "Email link (passwordless sign-in)" under Firebase Console → Authentication → Sign-in method → Email/Password, or use Google Sign-In above.'
          );
        }
        if (msg.includes('unauthorized-domain')) {
          throw new Error('Add this app domain to Firebase Authentication → Settings → Authorized domains.');
        }
        throw new Error(msg);
      }
    },
    [showToast]
  );

  const handleSendVerificationEmail = useCallback(async () => {
    if (!auth.currentUser) {
      throw new Error('Please sign in first.');
    }
    await sendEmailVerification(auth.currentUser, {
      url: window.location.origin,
    });
    showToast(`Verification email sent to ${auth.currentUser.email}`);
  }, [showToast]);

  const handleRefreshVerificationStatus = useCallback(async (): Promise<boolean> => {
    if (!auth.currentUser) return false;
    await auth.currentUser.reload();
    const verified = Boolean(auth.currentUser.emailVerified);
    setEmailVerified(verified);
    if (verified) {
      showToast('Email address is verified!');
    } else {
      showToast('Email not verified yet — check your inbox and click the link.');
    }
    return verified;
  }, [showToast]);

  const handleSignOut = useCallback(async () => {
    try {
      await signOut(auth);
      setAuthError(null);
      setScreen('welcome');
      setHistory(['welcome']);
      showToast('Signed out cleanly. Choose a portal to sign in or register.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Sign-out failed');
    }
  }, [showToast]);

  const handleSignOutAndSwitchPortal = useCallback(
    async (targetRole: UserRole) => {
      try {
        await signOut(auth);
        setAuthError(null);
        setRole(targetRole);
        setWelcomeTargetRole(targetRole);
        setScreen('login');
        setHistory(['welcome', 'login']);
        showToast(`Signed out. Sign in or create an account for ${formatPortalLabel(targetRole)}.`);
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Sign-out failed');
      }
    },
    [showToast]
  );

  // Wallet, Favorites, Partner Live GPS, and Universal QR Navigation Handlers
  const handleTopUpWallet = useCallback(
    async (amountInr: number, method: string, note: string) => {
      if (!currentUser) return;
      const nextBal = await creditWalletBalance(currentUser.uid, amountInr, method, note);
      showToast(`Added ₹${amountInr.toFixed(0)} · Wallet balance: ₹${nextBal.toFixed(2)}`);
    },
    [currentUser, showToast]
  );

  const handlePayWithWallet = useCallback(
    async (amountInr: number, orderCode: string) => {
      if (!currentUser) {
        throw new Error('Sign in required for Green Escrow Wallet checkout.');
      }
      await debitWalletForOrder(
        currentUser.uid,
        amountInr,
        orderCode,
        `Escrow checkout for ${orderCode}`
      );
    },
    [currentUser]
  );

  const handleToggleFavoriteGrower = useCallback(
    async (growerId: string) => {
      if (!currentUser) return;
      const current = userProfile?.favoriteGrowerIds ?? [];
      const next = await toggleFavoriteGrower(currentUser.uid, growerId, current);
      const added = next.includes(growerId);
      showToast(added ? 'Saved to Favourite Terrace Farms' : 'Removed from Favourite Terrace Farms');
    },
    [currentUser, userProfile?.favoriteGrowerIds, showToast]
  );

  const handleBroadcastPartnerLocation = useCallback((assignmentId: string, lat: number, lng: number) => {
    updateDeliveryPartnerLocation(assignmentId, lat, lng).catch(() => {
      // Non-fatal GPS tick error
    });
  }, []);

  const handleBroadcastPartnerTelemetry = useCallback(
    (assignment: DeliveryAssignmentDoc, telemetry: PartnerGpsTelemetry) => {
      if (!currentUser) return;
      const mappedStage =
        telemetry.stage === 'DELIVERED'
          ? 'delivered'
          : telemetry.stage === 'ARRIVED'
            ? 'arrived'
            : telemetry.stage === 'NEAR_DESTINATION'
              ? 'near_destination'
              : telemetry.stage === 'OUT_FOR_DELIVERY'
                ? 'out_for_delivery'
                : telemetry.stage === 'PICKED_UP'
                  ? 'picked_up'
                  : 'en_route_to_pickup';

      upsertOrderTrackingCurrent({
        orderId: assignment.parentOrderId,
        assignmentId: assignment.id,
        partnerId: currentUser.uid,
        partnerName: deliveryProfile?.partnerName || currentUser.displayName || 'EV Partner',
        lat: telemetry.lat,
        lng: telemetry.lng,
        accuracy: telemetry.accuracy,
        heading: telemetry.heading,
        speed: telemetry.speed,
        stage: mappedStage,
        trackingActive: mappedStage !== 'delivered',
      }).catch(() => {});
    },
    [currentUser, deliveryProfile?.partnerName]
  );

  const handlePartnerMarkMilestone = useCallback(
    async (assignment: DeliveryAssignmentDoc, stage: 'NEAR_DESTINATION' | 'ARRIVED') => {
      if (!currentUser) return;
      const label = stage === 'ARRIVED' ? 'Arrived' : 'Near Destination';
      await recordOrderTrackingEvent({
        orderId: assignment.parentOrderId,
        customerId: assignment.customerId,
        growerId: assignment.growerId,
        partnerId: currentUser.uid,
        eventType: stage,
        label,
        note:
          stage === 'ARRIVED'
            ? `${deliveryProfile?.partnerName || 'EV Partner'} arrived at customer doorstep.`
            : `${deliveryProfile?.partnerName || 'EV Partner'} is approaching customer destination.`,
        actorUid: currentUser.uid,
        actorRole: 'delivery',
        lat: assignment.partnerLat,
        lng: assignment.partnerLng,
      });
      if (isValidCoord(assignment.partnerLat, assignment.partnerLng)) {
        await upsertOrderTrackingCurrent({
          orderId: assignment.parentOrderId,
          assignmentId: assignment.id,
          partnerId: currentUser.uid,
          partnerName: deliveryProfile?.partnerName || 'EV Partner',
          lat: assignment.partnerLat as number,
          lng: assignment.partnerLng as number,
          stage: stage === 'ARRIVED' ? 'arrived' : 'near_destination',
          trackingActive: true,
        });
      }
      showToast(`Customer notified: ${label}`);
    },
    [currentUser, deliveryProfile?.partnerName, showToast]
  );

  const handleOpenStoreFromQr = useCallback(
    (growerId: string) => {
      if (currentUser && role !== 'customer' && role !== 'bulk') {
        showToast('Sign out and log into a Customer account to shop from this Storefront QR.');
        return;
      }
      setFarmFilter(growerId);
      setHighlightedProductId(null);
      navigate('buyer-explore');
      showToast('Opened Grower Storefront from QR');
    },
    [currentUser, role, navigate, showToast]
  );

  const handleOpenProductFromQr = useCallback(
    (productId: string, growerId?: string, qty?: number, src?: string) => {
      if (currentUser && role === 'delivery') {
        showToast('Sign out and log into a Customer account to shop from this Product Checkout QR.');
        return;
      }
      if (growerId) setFarmFilter(growerId);
      setHighlightedProductId(productId);
      setActiveProductCheckout({ productId, growerId, qty, src });
      navigate('product-checkout');
      showToast('Opened Direct Product Checkout from QR');
    },
    [currentUser, role, navigate, showToast]
  );

  const handleOpenQrStudio = useCallback(
    (productId?: string) => {
      setQrStudioProductId(productId || null);
      navigate('grower-qr-studio');
    },
    [navigate]
  );

  const handlePreviewProductCheckout = useCallback(
    (deepLink: ProductCheckoutDeepLink) => {
      setActiveProductCheckout(deepLink);
      navigate('product-checkout');
    },
    [navigate]
  );

  // 1-Tap Re-order from Past Completed Orders in Profile Order History
  const handleReorder = useCallback(
    async (order: ActiveOrder) => {
      if (!currentUser) {
        navigate('login');
        return;
      }
      if (role !== 'customer' && role !== 'bulk') {
        showToast('Re-order is available in Customer & Bulk Buyer portals.');
        return;
      }

      let addedCount = 0;
      let unavailableCount = 0;

      for (const item of order.items) {
        const matched =
          marketplaceListings.find((l) => l.id === item.listingId && l.available && l.stock > 0) ||
          marketplaceListings.find(
            (l) =>
              l.available &&
              l.stock > 0 &&
              l.name.toLowerCase() === item.name.toLowerCase() &&
              l.farmName.toLowerCase() === item.farmName.toLowerCase()
          );

        if (!matched) {
          unavailableCount += 1;
          continue;
        }

        const existingQty = cart.find((c) => c.listingId === matched.id)?.quantity ?? 0;
        const desiredQty = Math.min(matched.stock, existingQty + Math.max(1, item.quantity));
        await setCartItemQuantity(currentUser.uid, matched.id, matched.growerId || 'unknown', desiredQty);
        addedCount += 1;
      }

      if (addedCount === 0) {
        showToast(`Items from ${order.orderCode} are currently out of harvest stock.`);
        return;
      }

      showToast(
        unavailableCount > 0
          ? `Added ${addedCount} item(s) from ${order.orderCode} to basket (${unavailableCount} currently out of stock).`
          : `Added ${addedCount} item(s) from ${order.orderCode} to your Harvest Basket!`
      );
      navigate('buyer-cart');
    },
    [currentUser, role, marketplaceListings, cart, navigate, showToast]
  );

  // Customer Cart Action (Persisted in Firestore users/{uid}/cart)
  const handleUpdateCart = useCallback(
    (listingId: string, delta: number) => {
      if (!currentUser) {
        navigate('login');
        return;
      }
      const listing = marketplaceListings.find((l) => l.id === listingId);
      const currentQty = cart.find((c) => c.listingId === listingId)?.quantity ?? 0;
      const nextQty = Math.max(0, currentQty + delta);
      if (listing && nextQty > listing.stock) {
        showToast(`Only ${listing.stock} left in stock`);
        return;
      }
      setCartItemQuantity(
        currentUser.uid,
        listingId,
        listing?.growerId || 'unknown',
        nextQty
      ).catch((err) => {
        showToast(err instanceof Error ? err.message : 'Could not update basket');
      });
    },
    [currentUser, marketplaceListings, cart, navigate, showToast]
  );

  // Customer Address Save / Edit / Delete
  const handleAddAddress = useCallback(
    async (payload: {
      label: string;
      formattedAddress: string;
      lat: number;
      lng: number;
      serviceable: boolean;
    }) => {
      if (!currentUser) return;
      const id = await saveUserAddress(currentUser.uid, payload);
      setSelectedAddressId(id);
      setActiveDeliveryCoords({
        address: payload.formattedAddress,
        lat: payload.lat,
        lng: payload.lng,
      });
      saveFullUserProfile(currentUser.uid, { defaultAddressId: id }).catch(() => {});
      showToast(`Saved "${payload.label}" address in Firestore`);
    },
    [currentUser, showToast]
  );

  const handleUpdateAddress = useCallback(
    async (
      addressId: string,
      payload: {
        label: string;
        formattedAddress: string;
        lat: number;
        lng: number;
        serviceable: boolean;
      }
    ) => {
      if (!currentUser) return;
      await updateUserAddress(currentUser.uid, addressId, payload);
      if (addressId === selectedAddressId) {
        setActiveDeliveryCoords({
          address: payload.formattedAddress,
          lat: payload.lat,
          lng: payload.lng,
        });
      }
      showToast(`Updated "${payload.label}" address`);
    },
    [currentUser, selectedAddressId, showToast]
  );

  const handleDeleteAddress = useCallback(
    async (addressId: string) => {
      if (!currentUser) return;
      await deleteUserAddress(currentUser.uid, addressId);
      if (addressId === selectedAddressId) {
        const remaining = addresses.filter((a) => a.id !== addressId);
        if (remaining.length > 0) {
          setSelectedAddressId(remaining[0].id);
          saveFullUserProfile(currentUser.uid, { defaultAddressId: remaining[0].id }).catch(() => {});
        } else {
          setSelectedAddressId('');
          setActiveDeliveryCoords({
            address: 'Indiranagar, Bengaluru',
            lat: 12.9784,
            lng: 77.6408,
          });
        }
      }
      showToast('Deleted saved address');
    },
    [currentUser, selectedAddressId, addresses, showToast]
  );

  // User Profile & Post-Sign-In Onboarding Handlers
  const handleSaveFullProfile = useCallback(
    async (updates: Partial<Omit<UserProfileDoc, 'uid' | 'email'>>) => {
      if (!currentUser) return;
      await saveFullUserProfile(currentUser.uid, updates);
      showToast('Profile saved to Cloud Firestore');
    },
    [currentUser, showToast]
  );

  const handleCompleteProfileSetup = useCallback(
    async (payload: {
      displayName: string;
      phone: string;
      city: string;
      organizationName: string;
      bio: string;
      deliveryNote: string;
      activeRole: UserRole;
      avatarType: AvatarType;
      avatarPreset: ZenvegoAvatarPreset;
      customAvatarData: string;
      initialAddress?: { label: string; formattedAddress: string };
    }) => {
      if (!currentUser) return;
      let defaultAddressId = userProfile?.defaultAddressId;
      if (payload.initialAddress) {
        const addrId = await saveUserAddress(currentUser.uid, {
          label: payload.initialAddress.label,
          formattedAddress: payload.initialAddress.formattedAddress,
          lat: activeDeliveryCoords.lat,
          lng: activeDeliveryCoords.lng,
          serviceable: true,
        });
        defaultAddressId = addrId;
        setSelectedAddressId(addrId);
      }
      await saveFullUserProfile(currentUser.uid, {
        displayName: payload.displayName,
        phone: payload.phone,
        city: payload.city,
        organizationName: payload.organizationName,
        bio: payload.bio,
        deliveryNote: payload.deliveryNote,
        activeRole: payload.activeRole,
        avatarType: payload.avatarType,
        avatarPreset: payload.avatarPreset,
        customAvatarData: payload.customAvatarData,
        defaultAddressId,
        profileCompleted: true,
      });
      setRole(payload.activeRole);
      const target: ScreenId = pendingDeepLink?.productCheckout
        ? 'product-checkout'
        : pendingDeepLink
          ? 'buyer-explore'
          : defaultScreenForRole(payload.activeRole);
      if (pendingDeepLink?.productCheckout) {
        setActiveProductCheckout(pendingDeepLink.productCheckout);
      }
      setPendingDeepLink(null);
      setScreen(target);
      setHistory(['welcome', target]);
      showToast(`Profile ready! Welcome, ${payload.displayName}`);
    },
    [currentUser, userProfile?.defaultAddressId, activeDeliveryCoords.lat, activeDeliveryCoords.lng, pendingDeepLink, showToast]
  );

  const handleSkipProfileSetup = useCallback(async () => {
    if (!currentUser) return;
    await saveFullUserProfile(currentUser.uid, { profileCompleted: true }).catch(() => {});
    const target: ScreenId = pendingDeepLink?.productCheckout
      ? 'product-checkout'
      : pendingDeepLink
        ? 'buyer-explore'
        : defaultScreenForRole(role);
    if (pendingDeepLink?.productCheckout) {
      setActiveProductCheckout(pendingDeepLink.productCheckout);
    }
    setPendingDeepLink(null);
    setScreen(target);
    setHistory(['welcome', target]);
  }, [currentUser, pendingDeepLink, role]);

  // Customer Care Support Ticket Handlers
  const handleCreateSupportTicket = useCallback(
    async (payload: {
      category: SupportTicketCategory;
      orderCode?: string;
      subject: string;
      message: string;
      contactPhone?: string;
    }) => {
      if (!currentUser) return;
      await createSupportTicket(currentUser.uid, payload);
      showToast('Customer Care ticket submitted & saved');
    },
    [currentUser, showToast]
  );

  const handleResolveSupportTicket = useCallback(
    async (ticketId: string) => {
      if (!currentUser) return;
      await resolveSupportTicket(currentUser.uid, ticketId);
      showToast('Ticket marked as resolved');
    },
    [currentUser, showToast]
  );

  const handleDeleteSupportTicket = useCallback(
    async (ticketId: string) => {
      if (!currentUser) return;
      await deleteSupportTicket(currentUser.uid, ticketId);
      showToast('Support ticket deleted');
    },
    [currentUser, showToast]
  );

  // Customer Validated Multi-Grower Atomic Order Placement
  const handlePlaceValidatedOrder = useCallback(
    async (params: {
      validation: CheckoutValidationResponse;
      paymentMethod: string;
      paymentStatus: 'verified' | 'pending_upi_review' | 'doorstep_qr';
      paymentRef?: string;
    }) => {
      if (!currentUser) return;
      const res = await placeMultiGrowerOrderTransaction({
        customerUid: currentUser.uid,
        customerName:
          userProfile?.displayName || currentUser.displayName || currentUser.email?.split('@')[0] || 'Zenvego Buyer',
        deliveryAddress: activeDeliveryCoords.address,
        deliveryLat: activeDeliveryCoords.lat,
        deliveryLng: activeDeliveryCoords.lng,
        paymentMethod: params.paymentMethod,
        paymentStatus: params.paymentStatus,
        paymentRef: params.paymentRef,
        checkoutValidation: params.validation,
      });

      // Register delivery & grower pickup handover PINs immediately on server so 4-digit PIN & QR scanning always verify
      zenvegoApi
        .registerQrHandover({
          action: 'delivery',
          orderId: res.orderId,
          orderCode: res.orderCode,
          handoverPin: params.validation.handoverPin,
        })
        .catch(() => {});
      params.validation.sellerSplits.forEach((split, idx) => {
        zenvegoApi
          .registerQrHandover({
            action: 'pickup',
            orderId: res.orderId,
            sellerOrderId: res.sellerOrderIds[idx],
            orderCode: res.orderCode,
            handoverPin: split.handoverPin,
          })
          .catch(() => {});
      });

      showToast(`Order ${res.orderCode} confirmed & live stock reserved`);
      navigate('buyer-receipt');
    },
    [currentUser, userProfile?.displayName, activeDeliveryCoords, navigate, showToast]
  );

  // Grower Actions
  const handlePublishHarvest = useCallback(
    async (listing: Omit<GrowerListing, 'id' | 'growerId' | 'distanceKm'>) => {
      if (!currentUser) return;
      await createProductListing(currentUser.uid, listing);
      showToast(`Published "${listing.name}" live to Marketplace`);
      navigate('grower-inventory');
    },
    [currentUser, navigate, showToast]
  );

  const handleSaveGrowerProfile = useCallback(
    async (profile: Omit<GrowerProfileDoc, 'ownerId'>) => {
      if (!currentUser) return;
      await saveGrowerProfile(currentUser.uid, profile);
      showToast(`Saved farm profile "${profile.farmName}"`);
    },
    [currentUser, showToast]
  );

  const handleMarkReadyForPickup = useCallback(
    async (sellerOrder: SellerOrderDoc) => {
      if (!myGrowerProfile || !isValidCoord(myGrowerProfile.lat, myGrowerProfile.lng)) {
        showToast('Please set your verified farm pickup GPS location in Seller KYC before dispatching.');
        return;
      }
      const growerLoc = {
        address: myGrowerProfile.areaName,
        lat: myGrowerProfile.lat,
        lng: myGrowerProfile.lng,
      };
      // Fetch real customer drop-off coordinates from the parent order (authorized via growerIds)
      const parentDropoff = await getParentOrderDeliveryCoords(sellerOrder.parentOrderId);
      if (!parentDropoff || !isValidCoord(parentDropoff.lat, parentDropoff.lng)) {
        showToast('Unable to verify customer drop-off coordinates on parent order. Please retry.');
        return;
      }
      await markSellerOrderReadyForPickup(sellerOrder, growerLoc, {
        lat: parentDropoff.lat,
        lng: parentDropoff.lng,
      });
      zenvegoApi
        .registerQrHandover({
          action: 'pickup',
          orderId: sellerOrder.parentOrderId,
          sellerOrderId: sellerOrder.id,
          orderCode: sellerOrder.orderCode,
          handoverPin: sellerOrder.handoverPin,
        })
        .catch(() => {});
      showToast(`Order ${sellerOrder.orderCode} marked Ready & EV dispatch opened`);
    },
    [myGrowerProfile, showToast]
  );

  // Delivery Partner Actions
  const handleSaveDeliveryProfile = useCallback(
    async (profile: Omit<DeliveryProfileDoc, 'userId'>) => {
      if (!currentUser) return;
      await saveDeliveryProfile(currentUser.uid, profile);
      showToast('Delivery Partner profile activated in Firestore');
    },
    [currentUser, showToast]
  );

  const handleTogglePartnerShift = useCallback(async () => {
    if (!currentUser || !deliveryProfile) return;
    await saveDeliveryProfile(currentUser.uid, {
      partnerName: deliveryProfile.partnerName,
      phone: deliveryProfile.phone,
      emergencyPhone: deliveryProfile.emergencyPhone,
      vehicleType: deliveryProfile.vehicleType,
      vehiclePlate: deliveryProfile.vehiclePlate,
      dlNumber: deliveryProfile.dlNumber,
      govIdType: deliveryProfile.govIdType,
      govIdLast4: deliveryProfile.govIdLast4,
      liveSelfieData: deliveryProfile.liveSelfieData,
      idDocumentPhotoData: deliveryProfile.idDocumentPhotoData,
      livePhotoCapturedAt: deliveryProfile.livePhotoCapturedAt,
      livenessConfirmed: deliveryProfile.livenessConfirmed,
      clusterArea: deliveryProfile.clusterArea,
      availableForDispatch: !deliveryProfile.availableForDispatch,
      kycStatus: deliveryProfile.kycStatus,
    });
    showToast(deliveryProfile.availableForDispatch ? 'Duty shift paused' : 'Duty shift active');
  }, [currentUser, deliveryProfile, showToast]);

  const handleAcceptDeliveryAssignment = useCallback(
    async (assignment: DeliveryAssignmentDoc) => {
      if (!currentUser) return;
      const partnerName = deliveryProfile?.partnerName || currentUser.displayName || 'EV Partner';
      await acceptDeliveryAssignment(assignment, currentUser.uid, partnerName);
      showToast(`Accepted pickup for ${assignment.orderCode}`);
    },
    [currentUser, deliveryProfile, showToast]
  );

  const handlePickupVerified = useCallback(
    async (assignment: DeliveryAssignmentDoc, verifiedAtIso: string) => {
      await recordVerifiedPickup(assignment, verifiedAtIso);
      showToast(`Pickup QR verified for ${assignment.orderCode} — Out for Delivery`);
    },
    [showToast]
  );

  const handleDeliveryVerified = useCallback(
    async (assignment: DeliveryAssignmentDoc, deliveredAtIso: string) => {
      const matchingSellerOrder = sellerOrders.find((so) => so.id === assignment.sellerOrderId);
      await recordVerifiedDeliveryComplete(assignment, matchingSellerOrder, deliveredAtIso);
      showToast(`Delivery QR verified for ${assignment.orderCode} — Grower payable logged`);
    },
    [sellerOrders, showToast]
  );

  const handleReportDeliveryIssue = useCallback(
    async (assignment: DeliveryAssignmentDoc, note: string) => {
      await reportDeliveryIssue(assignment, note);
      showToast(`Exception logged for ${assignment.orderCode}`);
    },
    [showToast]
  );

  // Bulk Procurement Actions
  const handleCreateBulkEnquiry = useCallback(
    async (payload: {
      organizationName: string;
      produceName: string;
      quantityKg: number;
      frequency: 'one_time' | 'daily' | 'weekly';
      deliveryArea: string;
    }) => {
      if (!currentUser) return;
      await createBulkEnquiry(currentUser.uid, payload);
      showToast('Bulk requirement broadcasted to local growers');
    },
    [currentUser, showToast]
  );

  const handleSubmitBulkQuote = useCallback(
    async (enquiry: BulkEnquiryDoc, pricePerKg: number, notes: string) => {
      if (!currentUser) return;
      const farmName = myGrowerProfile?.farmName || currentUser.displayName || 'Local Grower';
      await submitGrowerBulkQuote(enquiry, currentUser.uid, farmName, pricePerKg, notes);
      showToast(`Sent quote ₹${pricePerKg}/kg to ${enquiry.organizationName}`);
    },
    [currentUser, myGrowerProfile, showToast]
  );

  const handleRespondBulkQuote = useCallback(
    async (enquiry: BulkEnquiryDoc, decision: 'accepted' | 'rejected') => {
      await respondToBulkQuote(enquiry, decision);
      showToast(decision === 'accepted' ? 'Grower bulk quotation accepted' : 'Quotation declined');
    },
    [showToast]
  );

  const handleShareReceipt = useCallback(() => {
    if (!activeOrder) return;
    const text = `Zenvego Order ${activeOrder.orderCode} · Status: ${activeOrder.status} · Total: ₹${activeOrder.totalPaid}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    showToast(`Copied receipt summary for ${activeOrder.orderCode}`);
  }, [activeOrder, showToast]);

  const partnerActiveRuns = useMemo(
    () =>
      currentUser
        ? deliveryAssignments.filter(
            (a) => a.partnerId === currentUser.uid && (a.status === 'accepted' || a.status === 'picked_up')
          ).length
        : 0,
    [deliveryAssignments, currentUser]
  );

  const partnerCompletedRuns = useMemo(
    () =>
      currentUser
        ? deliveryAssignments.filter((a) => a.partnerId === currentUser.uid && a.status === 'delivered').length
        : 0,
    [deliveryAssignments, currentUser]
  );

  if (!authReady) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <div className="w-10 h-10 rounded-full border-4 border-primary/20 border-t-primary animate-spin mx-auto" />
          <p className="text-xs font-bold text-primary">Connecting Zenvego to Firebase...</p>
        </div>
      </div>
    );
  }

  return (
    <AppShell
      screen={screen}
      role={role}
      cartCount={cartCount}
      activeOrder={activeOrder}
      growerFarmName={myGrowerProfile?.farmName}
      userDisplayName={userProfile?.displayName || currentUser?.displayName || currentUser?.email}
      userPhotoURL={currentUser?.photoURL}
      userProfile={userProfile}
      isAuthenticated={Boolean(currentUser)}
      notifications={shellNotifications}
      onMarkAllRead={() => {
        markAllNotificationsRead(notifications).catch(() => {});
      }}
      onNavigate={navigate}
      onBack={goBack}
      onShareReceipt={handleShareReceipt}
      onSignOut={handleSignOut}
      onNotify={showToast}
      onOpenDesk={() => setDeskOpen(true)}
    >
      {firestoreOfflineMsg && (
        <div className="mb-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-950 flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-amber-700">cloud_off</span>
          <span>{firestoreOfflineMsg}</span>
        </div>
      )}

      {/* Onboarding & Authentication */}
      {screen === 'welcome' && (
        <WelcomeScreen
          selectedRole={welcomeTargetRole}
          activeSignedInRole={currentUser ? role : undefined}
          isAuthenticated={Boolean(currentUser)}
          userDisplayName={currentUser?.displayName || currentUser?.email}
          onSelectRole={(selected) => {
            setWelcomeTargetRole(selected);
            if (!currentUser) setRole(selected);
          }}
          onGetStarted={() => navigate(defaultScreenForRole(role))}
          onGoToSignIn={(targetRole) => {
            setWelcomeTargetRole(targetRole);
            if (!currentUser) setRole(targetRole);
            setAuthError(null);
            navigate('login');
          }}
          onSignOutAndSwitchPortal={handleSignOutAndSwitchPortal}
        />
      )}

      {screen === 'login' && (
        <LoginScreen
          selectedRole={currentUser ? role : welcomeTargetRole}
          isAuthenticated={Boolean(currentUser)}
          userEmail={currentUser?.email}
          userEmailVerified={emailVerified}
          userDisplayName={userProfile?.displayName || currentUser?.displayName}
          authLoading={authLoading}
          authError={authError}
          onSelectRole={(selected) => {
            if (!currentUser) {
              setWelcomeTargetRole(selected);
              setRole(selected);
            }
          }}
          onClearAuthError={() => setAuthError(null)}
          onGoogleSignIn={handleGoogleSignIn}
          onSendEmailSignInLink={handleSendEmailSignInLink}
          onSendVerificationEmail={handleSendVerificationEmail}
          onRefreshVerificationStatus={handleRefreshVerificationStatus}
          onSignOut={handleSignOut}
          onContinueToPortal={() => navigate(defaultScreenForRole(role))}
          onOpenProfile={() => navigate('profile')}
        />
      )}

      {screen === 'delivery-welcome' && (
        <DeliveryWelcomeScreen
          onStartDelivering={() => {
            if (!currentUser) {
              setWelcomeTargetRole('delivery');
              setRole('delivery');
              navigate('login');
            } else {
              navigate('delivery-onboarding');
            }
          }}
          onNavigate={navigate}
        />
      )}

      {/* Customer / Household & Bulk Marketplace Screens */}
      {screen === 'buyer-explore' && (
        <CategoryExplorerScreen
          listings={marketplaceListings}
          cart={cart}
          farmFilter={farmFilter}
          highlightedProductId={highlightedProductId}
          onClearFarmFilter={() => {
            setFarmFilter(null);
            setHighlightedProductId(null);
          }}
          onUpdateCart={handleUpdateCart}
          onOpenProductCheckout={(product) =>
            handlePreviewProductCheckout({ productId: product.id, growerId: product.growerId })
          }
          onNavigate={navigate}
          onNotify={showToast}
        />
      )}

      {screen === 'buyer-growers' && (
        <NearbyGrowersScreen
          growers={growerProfiles}
          favoriteGrowerIds={userProfile?.favoriteGrowerIds ?? []}
          onToggleFavoriteGrower={handleToggleFavoriteGrower}
          onSelectFarm={(farmNameOrId) => {
            setFarmFilter(farmNameOrId);
            navigate('buyer-explore');
          }}
          onNavigate={navigate}
        />
      )}

      {screen === 'buyer-cart' && (
        <CartReviewScreen
          listings={marketplaceListings}
          cart={cart}
          deliveryAddress={activeDeliveryCoords.address}
          onUpdateCart={handleUpdateCart}
          onNavigate={navigate}
        />
      )}

      {screen === 'buyer-location' && (
        <LocationDetectorScreen
          addresses={addresses}
          selectedAddressId={selectedAddressId}
          onSelectAddress={setSelectedAddressId}
          onAddAddress={handleAddAddress}
          onDeleteAddress={handleDeleteAddress}
          onConfirm={(loc) => {
            setActiveDeliveryCoords(loc);
            navigate('buyer-explore');
          }}
        />
      )}

      {screen === 'buyer-payment' && (
        <PaymentGatewayScreen
          listings={marketplaceListings}
          cart={cart}
          deliveryLat={activeDeliveryCoords.lat}
          deliveryLng={activeDeliveryCoords.lng}
          deliveryAddress={activeDeliveryCoords.address}
          walletBalance={userProfile?.walletBalance ?? 0}
          savedUpiId={userProfile?.savedUpiId || ''}
          onPayWithWallet={handlePayWithWallet}
          onPlaceValidatedOrder={handlePlaceValidatedOrder}
          onNavigate={navigate}
          onNotify={showToast}
        />
      )}

      {screen === 'buyer-receipt' && (
        <OrderReceiptScreen
          currentUid={currentUser?.uid ?? null}
          orders={customerOrders}
          deliveryAssignments={customerDeliveryAssignments}
          onNotify={showToast}
          onNavigate={navigate}
        />
      )}

      {screen === 'buyer-bulk' && (
        <BulkProcurementScreen
          role={role}
          currentUid={currentUser?.uid ?? null}
          growerFarmName={myGrowerProfile?.farmName || currentUser?.displayName || 'Local Grower'}
          enquiries={bulkEnquiries}
          onCreateEnquiry={handleCreateBulkEnquiry}
          onSubmitQuote={handleSubmitBulkQuote}
          onRespondQuote={handleRespondBulkQuote}
        />
      )}

      {/* Direct QR-Linked Unique Product Checkout Screen */}
      {screen === 'product-checkout' && (
        <ProductCheckoutScreen
          deepLink={activeProductCheckout}
          isAuthenticated={Boolean(currentUser)}
          role={role}
          marketplaceListings={marketplaceListings}
          growerListings={growerListings}
          deliveryLat={activeDeliveryCoords.lat}
          deliveryLng={activeDeliveryCoords.lng}
          deliveryAddress={activeDeliveryCoords.address}
          walletBalance={userProfile?.walletBalance ?? 0}
          savedUpiId={userProfile?.savedUpiId || ''}
          onAddToBasket={(listingId, qty) => handleUpdateCart(listingId, qty)}
          onPayWithWallet={handlePayWithWallet}
          onPlaceValidatedOrder={handlePlaceValidatedOrder}
          onSignInToCheckout={() => {
            if (activeProductCheckout) {
              setPendingDeepLink({
                store: activeProductCheckout.growerId,
                product: activeProductCheckout.productId,
                productCheckout: activeProductCheckout,
              });
            }
            setWelcomeTargetRole('customer');
            setRole('customer');
            setAuthError(null);
            navigate('login');
          }}
          onReturnToQrStudio={(productId) => handleOpenQrStudio(productId)}
          onNavigate={navigate}
          onNotify={showToast}
        />
      )}

      {/* Grower / Farmer Portal Screens */}
      {screen === 'grower-dashboard' && (
        <CropAnalyticsScreen
          currentUid={currentUser?.uid ?? null}
          growerProfile={myGrowerProfile}
          listings={growerListings}
          sellerOrders={sellerOrders}
          ledger={ledger}
          onNavigate={navigate}
          onNotify={showToast}
        />
      )}

      {screen === 'grower-inventory' && (
        <InventoryScreen
          listings={growerListings}
          onAdjustStock={async (id, nextStock) => {
            await updateProductFields(id, { stock: nextStock, available: nextStock > 0 });
            showToast(`Updated live stock to ${nextStock}`);
          }}
          onToggleAvailable={async (id, nextAvailable) => {
            await updateProductFields(id, { available: nextAvailable });
            showToast(nextAvailable ? 'Listing visible to customers' : 'Listing paused');
          }}
          onUpdatePrice={async (id, price) => {
            await updateProductFields(id, { price });
            showToast(`Updated price to ₹${price}`);
          }}
          onDeleteListing={async (id) => {
            await deleteProductListing(id);
          }}
          onOpenQrStudio={handleOpenQrStudio}
          onPreviewProductCheckout={(product) =>
            handlePreviewProductCheckout({ productId: product.id, growerId: product.growerId })
          }
          onNavigate={navigate}
          onNotify={showToast}
        />
      )}

      {screen === 'grower-qr-studio' && (
        <ProductQrStudio
          listings={growerListings}
          growerProfile={myGrowerProfile}
          initialProductId={qrStudioProductId}
          onPreviewCheckout={handlePreviewProductCheckout}
          onNavigate={navigate}
          onNotify={showToast}
        />
      )}

      {screen === 'grower-add-harvest' && (
        <AddHarvestScreen
          growerProfile={myGrowerProfile}
          onPublish={handlePublishHarvest}
          onNotify={showToast}
        />
      )}

      {screen === 'grower-orders' && (
        <OrderHandoverScreen
          sellerOrders={sellerOrders}
          growerProfile={myGrowerProfile}
          growerAssignments={growerDeliveryAssignments}
          onAcceptOrder={async (order) => {
            await acceptSellerOrder(order);
            showToast(`Accepted order ${order.orderCode}`);
          }}
          onRejectOrder={async (order, reason) => {
            await rejectSellerOrder(order, reason);
            showToast(`Rejected order ${order.orderCode}`);
          }}
          onMarkReadyForPickup={handleMarkReadyForPickup}
          onNotify={showToast}
        />
      )}

      {screen === 'grower-earnings' && (
        <EarningsLedgerScreen
          ledger={ledger}
          onReconcilePayable={async (entry) => {
            await requestSettlementReconciliation(entry.id, `Reconciled on ${new Date().toLocaleDateString('en-IN')}`);
          }}
          onNotify={showToast}
        />
      )}

      {screen === 'grower-kyc' && (
        <GrowerComplianceScreen
          profile={myGrowerProfile}
          defaultGrowerName={currentUser?.displayName || ''}
          onSaveProfile={handleSaveGrowerProfile}
          onComplete={() => navigate('grower-dashboard')}
          onNotify={showToast}
        />
      )}

      {/* Delivery Partner Portal Screens */}
      {screen === 'delivery-onboarding' && (
        <PartnerOnboardingScreen
          profile={deliveryProfile}
          defaultName={currentUser?.displayName || ''}
          onSaveProfile={handleSaveDeliveryProfile}
          onComplete={() => navigate('delivery-pickup')}
          onNotify={showToast}
        />
      )}

      {screen === 'delivery-audit' && (
        <PartnerAuditScreen
          profile={deliveryProfile}
          activeAssignmentsCount={partnerActiveRuns}
          completedCount={partnerCompletedRuns}
          onToggleShift={handleTogglePartnerShift}
          onNavigate={navigate}
        />
      )}

      {screen === 'delivery-pickup' && (
        <PickupHandshakeScreen
          currentUid={currentUser?.uid ?? null}
          partnerProfile={deliveryProfile}
          assignments={deliveryAssignments}
          onAcceptAssignment={handleAcceptDeliveryAssignment}
          onPickupVerified={handlePickupVerified}
          onDeliveryVerified={handleDeliveryVerified}
          onReportIssue={handleReportDeliveryIssue}
          onBroadcastPartnerLocation={handleBroadcastPartnerLocation}
          onBroadcastPartnerTelemetry={handleBroadcastPartnerTelemetry}
          onPartnerMarkMilestone={handlePartnerMarkMilestone}
          onNavigate={navigate}
          onNotify={showToast}
        />
      )}

      {/* Post-Sign-In User Details Setup & Universal Editable Profile (All Roles) */}
      {screen === 'profile-setup' && (
        <ProfileSetupScreen
          profile={userProfile}
          authEmail={currentUser?.email}
          authDisplayName={currentUser?.displayName}
          authPhotoURL={currentUser?.photoURL}
          activeRole={role}
          onSaveProfile={async (updates, initialAddress) => {
            await handleCompleteProfileSetup({
              displayName: updates.displayName || currentUser?.displayName || 'Zenvego Member',
              phone: updates.phone || '',
              city: updates.city || 'Bengaluru',
              organizationName: updates.organizationName || '',
              bio: updates.bio || '',
              deliveryNote: updates.deliveryNote || '',
              activeRole: updates.activeRole || role,
              avatarType: updates.avatarType || 'zenvego',
              avatarPreset: (updates.avatarPreset as ZenvegoAvatarPreset) || 'zenvego-emblem',
              customAvatarData: updates.customAvatarData || '',
              initialAddress: initialAddress
                ? { label: initialAddress.label, formattedAddress: initialAddress.formattedAddress }
                : undefined,
            });
          }}
          onSkip={handleSkipProfileSetup}
          onNotify={showToast}
        />
      )}

      {screen === 'profile' && (
        <ProfileScreen
          profile={userProfile}
          authEmail={currentUser?.email}
          authEmailVerified={emailVerified}
          authDisplayName={currentUser?.displayName}
          authPhotoURL={currentUser?.photoURL}
          activeRole={role}
          addresses={addresses}
          selectedAddressId={selectedAddressId}
          orders={customerOrders}
          completedOrders={completedCustomerOrders}
          growers={growerProfiles}
          walletTransactions={walletTransactions}
          tickets={supportTickets}
          onReorder={handleReorder}
          onSaveProfile={handleSaveFullProfile}
          onSelectAddress={setSelectedAddressId}
          onAddAddress={handleAddAddress}
          onUpdateAddress={handleUpdateAddress}
          onDeleteAddress={handleDeleteAddress}
          onCreateTicket={handleCreateSupportTicket}
          onResolveTicket={handleResolveSupportTicket}
          onDeleteTicket={handleDeleteSupportTicket}
          onTopUpWallet={handleTopUpWallet}
          onToggleFavoriteGrower={handleToggleFavoriteGrower}
          onSendVerificationEmail={handleSendVerificationEmail}
          onRefreshVerificationStatus={handleRefreshVerificationStatus}
          onOpenStoreFromQr={handleOpenStoreFromQr}
          onOpenProductFromQr={handleOpenProductFromQr}
          onNavigate={navigate}
          onSignOut={handleSignOut}
          onNotify={showToast}
        />
      )}

      {/* Cross-Device Email Sign-In Link Confirmation Modal */}
      {pendingEmailLinkUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm bg-surface-container-lowest rounded-3xl p-5 shadow-2xl border border-outline-variant/20 space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[22px]">mark_email_read</span>
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-primary">Confirm Email to Complete Sign-In</h3>
                <p className="text-[11px] text-on-surface-variant">
                  Enter the email address where you received this Zenvego verification link.
                </p>
              </div>
            </div>
            <input
              type="email"
              value={confirmEmailInput}
              onChange={(e) => setConfirmEmailInput(e.target.value)}
              placeholder="name@example.com"
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-high text-sm text-on-surface border border-outline-variant/30 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setPendingEmailLinkUrl(null);
                  window.history.replaceState({}, '', window.location.pathname);
                }}
                className="flex-1 py-2.5 rounded-xl bg-surface-container-high text-on-surface-variant text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={authLoading || !confirmEmailInput.includes('@')}
                onClick={() => completeEmailLinkSignIn(confirmEmailInput, pendingEmailLinkUrl)}
                className="flex-1 py-2.5 rounded-xl bg-primary text-on-primary text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {authLoading ? 'Verifying...' : 'Verify & Sign In'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Zenvego Desk (Multi-turn Chat, Google Search, Google Maps & Live Voice) */}
      <ZenvegoConcierge
        open={deskOpen}
        onClose={() => setDeskOpen(false)}
        isAuthenticated={Boolean(currentUser)}
        role={role}
        lat={activeDeliveryCoords.lat}
        lng={activeDeliveryCoords.lng}
        addressLabel={activeDeliveryCoords.address}
        contextSummary={`Screen: ${screen}. Area: ${activeDeliveryCoords.address}${activeOrder ? `. Active Order: ${activeOrder.orderCode} (${activeOrder.status})` : ''}`}
        onRequireSignIn={() => {
          setDeskOpen(false);
          navigate('login');
        }}
      />

      {/* Global Toast Feedback */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-20 lg:bottom-6 right-4 left-4 sm:left-auto sm:max-w-sm z-50 bg-inverse-surface text-inverse-on-surface px-4 py-3 rounded-2xl shadow-xl text-xs font-semibold flex items-center justify-between gap-3"
        >
          <span>{toast}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-inverse-on-surface/70 hover:text-inverse-on-surface cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}
    </AppShell>
  );
}
