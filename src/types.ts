export type UserRole = 'customer' | 'grower' | 'delivery' | 'bulk';

export type ScreenId =
  | 'welcome'
  | 'login'
  | 'delivery-welcome'
  // Customer / Bulk screens
  | 'buyer-explore'
  | 'buyer-growers'
  | 'buyer-cart'
  | 'buyer-location'
  | 'buyer-payment'
  | 'buyer-receipt'
  | 'buyer-bulk'
  | 'product-checkout'
  // Grower screens
  | 'grower-dashboard'
  | 'grower-inventory'
  | 'grower-qr-studio'
  | 'grower-add-harvest'
  | 'grower-orders'
  | 'grower-earnings'
  | 'grower-kyc'
  // Delivery Partner screens
  | 'delivery-onboarding'
  | 'delivery-audit'
  | 'delivery-pickup'
  // Universal Account & Profile screens (All non-admin roles)
  | 'profile-setup'
  | 'profile';

export interface ProductCheckoutDeepLink {
  productId: string;
  growerId?: string;
  qty?: number;
  src?: string;
  tagline?: string;
}

export type ProduceCategory =
  | 'Leafy Greens'
  | 'Vegetables'
  | 'Heirloom'
  | 'Fruits'
  | 'Microgreens'
  | 'Herbs';

export interface GrowerListing {
  id: string;
  growerId?: string;
  name: string;
  variety: string;
  category: ProduceCategory;
  bedLabel: string;
  price: number;
  unit: string;
  stock: number;
  unitShort: string;
  reserved: number;
  harvestedAt: string;
  available: boolean;
  lowStock?: boolean;
  highDemand?: boolean;
  image: string;
  farmName: string;
  distanceKm: number;
  lat?: number;
  lng?: number;
  chemicalFree: boolean;
  harvestedToday: boolean;
  growerNote?: string;
}

export interface CartItem {
  listingId: string;
  growerId?: string;
  quantity: number;
}

export interface SavedAddress {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
  serviceable: boolean;
  icon: 'home' | 'work' | 'location_on';
}

export interface LedgerEntry {
  id: string;
  growerId?: string;
  orderCode: string;
  status: 'settled' | 'escrow' | 'payable';
  isBulk?: boolean;
  timestamp: string;
  summary: string;
  gross: number;
  fee: number;
  net: number;
  refNote: string;
}

export interface ActiveOrderItem {
  listingId: string;
  name: string;
  farmName: string;
  distanceKm: number;
  freshnessLabel: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
  actualWeight?: string;
  packNote?: string;
}

export interface ActiveOrder {
  id?: string;
  orderCode: string;
  handoverPin: string;
  status: 'created' | 'confirmed' | 'preparing' | 'ready_for_pickup' | 'picked_up' | 'out_for_delivery' | 'delivered' | 'cancelled';
  paymentStatus?: 'pending' | 'pending_upi_review' | 'verified' | 'doorstep_qr' | 'failed' | 'refunded';
  paymentRef?: string;
  etaText: string;
  paymentMethod: string;
  itemsTotal: number;
  deliveryFee: number;
  totalPaid: number;
  customerId?: string;
  customerName: string;
  customerArea: string;
  deliveryLat?: number;
  deliveryLng?: number;
  driverName: string;
  driverVehicle: string;
  driverRating: number;
  driverPhone: string;
  sealId: string;
  growerHandoverConfirmed: boolean;
  driverPickupConfirmed: boolean;
  createdAtText?: string;
  items: ActiveOrderItem[];
}

export type AvatarType = 'zenvego' | 'personal';

export type ZenvegoAvatarPreset =
  | 'zenvego-emblem'
  | 'terrace-leaf'
  | 'harvest-basket'
  | 'sun-sprout'
  | 'ev-rider';

export interface UserProfileDoc {
  uid: string;
  displayName: string;
  email?: string;
  phone?: string;
  activeRole: UserRole;
  photoURL?: string;
  avatarType?: AvatarType;
  avatarPreset?: ZenvegoAvatarPreset | string;
  customAvatarData?: string;
  city?: string;
  bio?: string;
  deliveryNote?: string;
  organizationName?: string;
  defaultAddressId?: string;
  profileCompleted?: boolean;
  walletBalance?: number;
  savedUpiId?: string;
  language?: string;
  favoriteGrowerIds?: string[];
  registeredPortals?: UserRole[];
  createdAtText?: string;
}

export type WalletTxType = 'topup' | 'order_debit' | 'escrow_hold' | 'escrow_release' | 'refund';
export type WalletTxStatus = 'pending_verification' | 'credited' | 'completed' | 'rejected';

export interface WalletTransactionDoc {
  id: string;
  userId: string;
  type: WalletTxType;
  status?: WalletTxStatus;
  amount: number;
  orderCode?: string;
  referenceId?: string;
  method: string;
  note: string;
  createdAtText: string;
}

export type SupportTicketCategory =
  | 'order_issue'
  | 'delivery'
  | 'grower_payout'
  | 'address_account'
  | 'bulk_supply'
  | 'general';

export interface SupportTicketDoc {
  id: string;
  userId: string;
  category: SupportTicketCategory;
  orderCode?: string;
  subject: string;
  message: string;
  contactPhone?: string;
  status: 'open' | 'resolved';
  createdAtText: string;
}

export interface GrowerKycDoc {
  ownerId: string;
  phone: string;
  fssaiNumber?: string;
  govIdType: 'aadhaar' | 'pan' | 'voter_id';
  govIdLast4: string;
  liveSelfieData: string;
  farmPhotoData: string;
  livePhotoCapturedAt?: string;
  livenessConfirmed: boolean;
  reviewStatus: 'pending' | 'verified' | 'correction_needed' | 'rejected';
  reviewNote?: string;
}

export interface GrowerProfileDoc {
  ownerId: string;
  farmName: string;
  growerName: string;
  farmType: string;
  areaName: string;
  lat: number;
  lng: number;
  fssaiNumber?: string;
  // Private KYC fields below are hydrated ONLY for the grower's own profile from private grower_kyc/{uid}
  phone?: string;
  govIdType?: 'aadhaar' | 'pan' | 'voter_id';
  govIdLast4?: string;
  liveSelfieData?: string;
  farmPhotoData?: string;
  livePhotoCapturedAt?: string;
  livenessConfirmed?: boolean;
  verificationStatus: 'pending' | 'verified' | 'correction_needed' | 'rejected';
  chemicalFree?: boolean;
}

export interface DeliveryProfileDoc {
  userId: string;
  partnerName: string;
  phone?: string;
  emergencyPhone?: string;
  vehicleType: 'ev' | 'petrol' | 'bicycle';
  vehiclePlate?: string;
  dlNumber?: string;
  govIdType?: 'aadhaar' | 'pan' | 'dl';
  govIdLast4?: string;
  liveSelfieData?: string;
  idDocumentPhotoData?: string;
  livePhotoCapturedAt?: string;
  livenessConfirmed?: boolean;
  clusterArea: string;
  availableForDispatch: boolean;
  kycStatus: 'submitted' | 'verified' | 'rejected';
  reviewNote?: string;
}

export interface SellerOrderDoc {
  id: string;
  parentOrderId: string;
  orderCode: string;
  customerId: string;
  customerName: string;
  customerArea: string;
  growerId: string;
  farmName: string;
  assignedPartnerId?: string;
  status: 'awaiting_acceptance' | 'accepted' | 'preparing' | 'ready_for_pickup' | 'picked_up' | 'delivered' | 'rejected';
  rejectionReason?: string;
  handoverPin: string;
  sealId?: string;
  grossAmount: number;
  platformFee: number;
  netPayout: number;
  items: {
    productId: string;
    name: string;
    unit: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }[];
  createdAt?: string;
}

export interface DeliveryAssignmentDoc {
  id: string;
  parentOrderId: string;
  sellerOrderId: string;
  orderCode: string;
  customerId: string;
  growerId: string;
  partnerId?: string;
  partnerName?: string;
  farmName: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  status: 'open' | 'accepted' | 'picked_up' | 'delivered' | 'issue_reported';
  pickupVerifiedAt?: string;
  deliveredAt?: string;
  issueNote?: string;
  partnerLat?: number;
  partnerLng?: number;
  lastLocationAt?: string;
}

export interface BulkEnquiryDoc {
  id: string;
  buyerId: string;
  organizationName: string;
  produceName: string;
  quantityKg: number;
  frequency: 'one_time' | 'daily' | 'weekly';
  deliveryArea: string;
  status: 'open' | 'quoted' | 'accepted' | 'rejected';
  quotedGrowerId?: string;
  quotedFarmName?: string;
  quotedPricePerKg?: number;
  quoteNotes?: string;
  createdAt?: string;
}

export interface NotificationDoc {
  id: string;
  userId: string;
  eventType: string;
  title: string;
  body: string;
  targetRole: UserRole;
  targetScreen: ScreenId;
  unread: boolean;
  createdAtText: string;
}

export type OrderTrackingEventType =
  | 'ORDER_CONFIRMED'
  | 'GROWER_PREPARING'
  | 'READY_FOR_PICKUP'
  | 'PARTNER_ASSIGNED'
  | 'PICKED_UP'
  | 'OUT_FOR_DELIVERY'
  | 'NEAR_DESTINATION'
  | 'ARRIVED'
  | 'DELIVERED'
  | 'DELIVERY_ISSUE'
  | 'CANCELLED';

export type OrderTrackingStage =
  | 'assigned'
  | 'en_route_to_pickup'
  | 'picked_up'
  | 'out_for_delivery'
  | 'near_destination'
  | 'arrived'
  | 'delivered'
  | 'cancelled';

export interface OrderTrackingCurrentDoc {
  orderId: string;
  assignmentId: string;
  partnerId: string;
  partnerName?: string;
  lat: number;
  lng: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
  stage: OrderTrackingStage;
  trackingActive: boolean;
  lastUpdatedAt: string;
}

export interface OrderTrackingEventDoc {
  id: string;
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
  createdAtText: string;
  createdAtMs: number;
}

