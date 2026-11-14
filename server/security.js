import { randomBytes, scryptSync, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { scrypt } from 'node:crypto';

const scryptAsync = promisify(scrypt);
export const token = () => randomBytes(32).toString('base64url');
export const hashToken = (value) => createHash('sha256').update(value).digest('hex');
export const id = () => randomUUID();
export const hoursFromNow = (n) => new Date(Date.now() + n * 3600000).toISOString();
export const cookieOptions = (production, maxAge) => ({
  httpOnly: true,
  secure: production,
  sameSite: 'strict',
  path: '/',
  maxAge,
});

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

// Async KDF prevents login requests blocking the event loop.
export async function verifyPassword(password, encoded) {
  const [salt, expected] = encoded.split(':');
  const actual = await scryptAsync(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}

export class HttpError extends Error {
  constructor(status, message, code = 'REQUEST_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const fail = (status, message, code) => {
  throw new HttpError(status, message, code);
};

export async function createAdmin(db, email, password) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    throw new Error('Email tidak valid.');
  if (password.length < 12 || password.length > 128)
    throw new Error('Password harus 12–128 karakter.');
  await db
    .prepare('INSERT INTO admins(id,email,password_hash,username) VALUES(?,?,?,?)')
    .run(id(), email.toLowerCase(), hashPassword(password), 'studio-' + id());
}
