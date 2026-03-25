'use client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3500/v1';

export interface SessionData {
  publicKey: string;
  secretKey: string;
  keyId: string;
  merchantId: string;
  name: string;
}

export async function login(
  publicKey: string,
  secretKey: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicKey, secretKey }),
    });
    const data = await res.json();

    if (!res.ok) {
      return { ok: false, error: data.error ?? 'Invalid credentials' };
    }

    const { apiKey } = data.data;
    const session: SessionData = {
      publicKey,
      secretKey,
      keyId: apiKey.keyId,
      merchantId: apiKey.merchantId,
      name: apiKey.name,
    };
    localStorage.setItem('session', JSON.stringify(session));
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not reach the server. Check your connection.' };
  }
}

export function logout() {
  localStorage.removeItem('session');
}

export function getSession(): SessionData | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('session');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  return getSession() !== null;
}
