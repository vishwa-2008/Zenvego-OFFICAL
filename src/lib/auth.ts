// Real authentication using Web Crypto API (SHA-256 + salt).
// No SMS OTP. Email + password only. Passwords are hashed before storage.
import {
  createUser,
  getUserByEmail,
  createSession,
  getSession,
  deleteSession,
  getUserById,
  updateUser,
  generateId,
  type Role,
  type UserRecord,
} from './db';

const SESSION_KEY = 'zenvego_session_token';

function generateSalt(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr));
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(salt + password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return btoa(String.fromCharCode(...hashArray));
}

export interface AuthResult {
  ok: boolean;
  user?: UserRecord;
  token?: string;
  error?: string;
}

export async function register(
  name: string,
  email: string,
  password: string,
  role: Role
): Promise<AuthResult> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    return { ok: false, error: 'Please enter a valid email address.' };
  }
  if (!password || password.length < 6) {
    return { ok: false, error: 'Password must be at least 6 characters.' };
  }
  if (!name.trim()) {
    return { ok: false, error: 'Please enter your name.' };
  }

  const existing = await getUserByEmail(cleanEmail);
  if (existing) {
    return { ok: false, error: 'An account with this email already exists.' };
  }

  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);

  const user: UserRecord = {
    id: generateId('user_'),
    name: name.trim(),
    email: cleanEmail,
    role,
    passwordHash,
    salt,
    createdAt: Date.now(),
    idVerified: false,
  };

  await createUser(user);
  return { ok: true, user };
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const cleanEmail = email.trim().toLowerCase();
  const user = await getUserByEmail(cleanEmail);
  if (!user) {
    return { ok: false, error: 'No account found with this email.' };
  }

  const hash = await hashPassword(password, user.salt);
  if (hash !== user.passwordHash) {
    return { ok: false, error: 'Incorrect password.' };
  }

  const token = generateId('tok_');
  const session = {
    token,
    userId: user.id,
    role: user.role,
    createdAt: Date.now(),
    expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 7, // 7 days
  };
  await createSession(session);
  localStorage.setItem(SESSION_KEY, token);

  return { ok: true, user, token };
}

export async function getCurrentSession(): Promise<UserRecord | null> {
  const token = localStorage.getItem(SESSION_KEY);
  if (!token) return null;

  const session = await getSession(token);
  if (!session) {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
  if (session.expiresAt < Date.now()) {
    await deleteSession(token);
    localStorage.removeItem(SESSION_KEY);
    return null;
  }

  const user = await getUserById(session.userId);
  return user || null;
}

export async function logout(): Promise<void> {
  const token = localStorage.getItem(SESSION_KEY);
  if (token) {
    await deleteSession(token);
  }
  localStorage.removeItem(SESSION_KEY);
}

export async function updateProfile(userId: string, patch: Partial<UserRecord>): Promise<void> {
  await updateUser(userId, patch);
}

export async function saveSelfiePhoto(userId: string, selfieDataUrl: string): Promise<void> {
  await updateUser(userId, { selfiePhoto: selfieDataUrl });
}
