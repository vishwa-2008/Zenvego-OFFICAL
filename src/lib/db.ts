// Real on-device database using IndexedDB (zero-investment, no backend needed).
// Stores users, products, orders, sessions, and verification documents.
import { openDB, type IDBPDatabase } from 'idb';

export type Role = 'customer' | 'seller' | 'delivery';

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: Role;
  passwordHash: string; // base64 of SHA-256 + salt
  salt: string;
  createdAt: number;
  avatar?: string;
  // Verification
  selfiePhoto?: string; // base64 data URL
  idVerified?: boolean;
  // Profile data
  profileData?: Record<string, any>;
}

export interface ProductRecord {
  id: string;
  name: string;
  price: number;
  qty: number;
  unit: string;
  category: string;
  image: string;
  farm: string;
  farmerId: string;
  farmerName: string;
  desc: string;
  organic: boolean;
  origin?: string;
  createdAt: number;
}

export type OrderStatus =
  | 'placed'
  | 'paid'
  | 'assigned'
  | 'picked'
  | 'in_transit'
  | 'delivered'
  | 'cancelled';

export interface OrderItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  unit: string;
  farm: string;
}

export interface OrderRecord {
  id: string;
  orderNo: string;
  customerId: string;
  customerName: string;
  items: OrderItem[];
  total: number;
  currency: 'INR' | 'USD';
  status: OrderStatus;
  address: string;
  deliveryPartnerId?: string;
  deliveryPartnerName?: string;
  paymentMethod: 'upi' | 'cod';
  paymentRef?: string;
  createdAt: number;
  updatedAt: number;
  // Live tracking
  pickupLat?: number;
  pickupLng?: number;
  dropLat?: number;
  dropLng?: number;
  currentLat?: number;
  currentLng?: number;
}

export interface SessionRecord {
  token: string;
  userId: string;
  role: Role;
  createdAt: number;
  expiresAt: number;
}

const DB_NAME = 'zenvego_db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('users')) {
          const users = db.createObjectStore('users', { keyPath: 'id' });
          users.createIndex('email', 'email', { unique: true });
        }
        if (!db.objectStoreNames.contains('products')) {
          const products = db.createObjectStore('products', { keyPath: 'id' });
          products.createIndex('farmerId', 'farmerId', { unique: false });
        }
        if (!db.objectStoreNames.contains('orders')) {
          const orders = db.createObjectStore('orders', { keyPath: 'id' });
          orders.createIndex('customerId', 'customerId', { unique: false });
          orders.createIndex('deliveryPartnerId', 'deliveryPartnerId', { unique: false });
        }
        if (!db.objectStoreNames.contains('sessions')) {
          db.createObjectStore('sessions', { keyPath: 'token' });
        }
      },
    });
  }
  return dbPromise;
}

// ---------- USERS ----------
export async function createUser(user: UserRecord): Promise<void> {
  const db = await getDB();
  await db.add('users', user);
}

export async function getUserByEmail(email: string): Promise<UserRecord | undefined> {
  const db = await getDB();
  return db.getFromIndex('users', 'email', email.toLowerCase());
}

export async function getUserById(id: string): Promise<UserRecord | undefined> {
  const db = await getDB();
  return db.get('users', id);
}

export async function updateUser(id: string, patch: Partial<UserRecord>): Promise<void> {
  const db = await getDB();
  const existing = await db.get('users', id);
  if (!existing) throw new Error('User not found');
  await db.put('users', { ...existing, ...patch });
}

// ---------- PRODUCTS ----------
export async function getAllProducts(): Promise<ProductRecord[]> {
  const db = await getDB();
  return db.getAll('products');
}

export async function getProductsByFarmer(farmerId: string): Promise<ProductRecord[]> {
  const db = await getDB();
  return db.getAllFromIndex('products', 'farmerId', farmerId);
}

export async function putProduct(product: ProductRecord): Promise<void> {
  const db = await getDB();
  await db.put('products', product);
}

export async function deleteProduct(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('products', id);
}

// ---------- ORDERS ----------
export async function createOrder(order: OrderRecord): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['products', 'orders'], 'readwrite');
  try {
    const productsToUpdate = new Map<string, ProductRecord>();
    const requestedQuantities = new Map<string, { quantity: number; name: string }>();
    for (const item of order.items) {
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
        throw new Error(`Invalid quantity for ${item.name}.`);
      }
      const request = requestedQuantities.get(item.productId);
      requestedQuantities.set(item.productId, {
        quantity: (request?.quantity || 0) + item.quantity,
        name: request?.name || item.name,
      });
    }

    for (const [productId, request] of requestedQuantities) {
      const product = await tx.objectStore('products').get(productId);
      if (!product) throw new Error(`${request.name} is no longer available.`);
      if (product.qty < request.quantity) throw new Error(`Not enough stock for ${request.name}.`);
      productsToUpdate.set(productId, { ...product, qty: product.qty - request.quantity });
    }

    await Promise.all([
      ...Array.from(productsToUpdate.values(), (product) => tx.objectStore('products').put(product)),
      tx.objectStore('orders').add(order),
    ]);
    await tx.done;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // The transaction may already have aborted after a failed request.
    }
    await tx.done.catch(() => undefined);
    throw error;
  }
}

export async function getOrderById(id: string): Promise<OrderRecord | undefined> {
  const db = await getDB();
  return db.get('orders', id);
}

export async function getOrdersByCustomer(customerId: string): Promise<OrderRecord[]> {
  const db = await getDB();
  return db.getAllFromIndex('orders', 'customerId', customerId);
}

export async function getOrdersByDeliveryPartner(partnerId: string): Promise<OrderRecord[]> {
  const db = await getDB();
  return db.getAllFromIndex('orders', 'deliveryPartnerId', partnerId);
}

export async function getAllOrders(): Promise<OrderRecord[]> {
  const db = await getDB();
  return db.getAll('orders');
}

export async function updateOrder(id: string, patch: Partial<OrderRecord>): Promise<void> {
  const db = await getDB();
  const existing = await db.get('orders', id);
  if (!existing) throw new Error('Order not found');
  await db.put('orders', { ...existing, ...patch, updatedAt: Date.now() });
}

// ---------- SESSIONS ----------
export async function createSession(session: SessionRecord): Promise<void> {
  const db = await getDB();
  await db.add('sessions', session);
}

export async function getSession(token: string): Promise<SessionRecord | undefined> {
  const db = await getDB();
  return db.get('sessions', token);
}

export async function deleteSession(token: string): Promise<void> {
  const db = await getDB();
  await db.delete('sessions', token);
}

export function generateId(prefix = ''): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
