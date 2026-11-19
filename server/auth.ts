import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { db } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'breatheos-dev-session-secret-change-in-prod';

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  is_demo: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  requestId?: string;
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(input: string): string {
  const padded = input + '='.repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

export function signToken(user: AuthUser): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7; // 7 days
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      name: user.full_name,
      is_demo: user.is_demo,
      exp,
    })
  );
  const sig = base64UrlEncode(
    crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest()
  );
  return `${header}.${payload}.${sig}`;
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, sig] = parts;
    const expectedSig = base64UrlEncode(
      crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest()
    );
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const parsed = JSON.parse(base64UrlDecode(payload)) as {
      sub: string;
      email: string;
      name: string;
      is_demo?: boolean;
      exp: number;
    };
    if (!parsed.sub || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    const row = db
      .prepare('SELECT id, email, full_name, is_demo FROM profiles WHERE id = ?')
      .get(parsed.sub) as { id: string; email: string; full_name: string; is_demo: number } | undefined;
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      full_name: row.full_name,
      is_demo: Boolean(row.is_demo),
    };
  } catch {
    return null;
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const computed = crypto.scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(hash, 'hex');
  if (computed.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(computed, storedBuf);
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Valid authentication token required.',
        retryable: false,
      },
      meta: { request_id: req.requestId || crypto.randomUUID() },
    });
    return;
  }
  const token = authHeader.slice(7).trim();
  const user = verifyToken(token);
  if (!user) {
    res.status(401).json({
      error: {
        code: 'INVALID_TOKEN',
        message: 'Session token is invalid or expired.',
        retryable: false,
      },
      meta: { request_id: req.requestId || crypto.randomUUID() },
    });
    return;
  }
  req.user = user;
  next();
}
