import { getSession } from './auth';

const API_URL = process.env.NEXT_PUBLIC_SETTLE_API_URL ?? 'http://localhost:3500/v1';

// =============================================================================
// HMAC signing (mirrors backend: sha256(secretKey) as HMAC key)
// =============================================================================

async function sha256Hex(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', encoder.encode(message));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function buildHmacHeaders(
  method: string,
  path: string,
  body: unknown,
  publicKey: string,
  secretKey: string
): Promise<Record<string, string>> {
  const timestamp = Date.now().toString();
  const bodyString = JSON.stringify(body ?? {});
  const bodyHash = await sha256Hex(bodyString);
  const payload = `${timestamp}|${method.toUpperCase()}|/v1${path}|${bodyHash}`;
  const hmacKey = await sha256Hex(secretKey); // SHA256(secretKey) — matches server
  const signature = await hmacSha256Hex(hmacKey, payload);

  return {
    'Content-Type': 'application/json',
    'X-API-Key': publicKey,
    'X-Timestamp': timestamp,
    'X-Signature': signature,
  };
}

// =============================================================================
// Core request helper
// =============================================================================

async function request<T>(
  path: string,
  options: Omit<RequestInit, 'body'> & { body?: unknown } = {}
): Promise<T> {
  const session = getSession();
  if (!session) {
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new Error('Not authenticated');
  }

  const { body, ...rest } = options;
  const headers = await buildHmacHeaders(
    rest.method ?? 'GET',
    path,
    body,
    session.publicKey,
    session.secretKey
  );

  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? data.message ?? 'Request failed');
  return data;
}

// =============================================================================
// Payments
// =============================================================================

export interface Payment {
  id: string;
  reference: string;
  type: 'transfer' | 'gift' | 'request' | 'merchant';
  status: string;
  fiat_amount: number;
  fiat_currency: string;
  crypto: string | null;
  crypto_amount: number | null;
  network: string | null;
  rate: number | null;
  charge_amount: number | null;
  deposit_address: string | null;
  tx_hash: string | null;
  confirmations: number;
  received_amount: number | null;
  settlement_reference: string | null;
  settlement_provider: string | null;
  merchant_id: string | null;
  merchant_reference: string | null;
  api_key_id: number | null;
  expires_at: string | null;
  confirmed_at: string | null;
  settled_at: string | null;
  created_at: string;
  updated_at: string;
  account_number?: string;
  account_name?: string;
  bank_code?: string;
  bank_name?: string;
  payer_chat_id?: string;
}

export interface PaymentsResponse {
  status: boolean;
  data: { payments: Payment[]; total: number; limit: number; offset: number };
}

export interface PaymentDetailResponse {
  status: boolean;
  data: { payment: Payment & Record<string, unknown>; settlementAttempts: unknown[] };
}

export type PaymentStats = Record<string, number>;

export function getPaymentStats() {
  return request<{ status: boolean; data: { stats: PaymentStats } }>('/me/payments/stats');
}

export function getPayments(params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  return request<PaymentsResponse>(`/me/payments${qs ? `?${qs}` : ''}`);
}

export function getPayment(reference: string) {
  return request<PaymentDetailResponse>(`/me/payments/${reference}`);
}

// =============================================================================
// API Key (own key only)
// =============================================================================

export interface ApiKey {
  id: number;
  keyId: string;
  merchantId: string;
  name: string;
  permissions: string[];
  rateLimitTier: 'standard' | 'premium' | 'unlimited';
  ipWhitelist: string[] | null;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  webhookUrl: string | null;
  sweepAddress: string | null;
  settlementMode: 'mongoro' | 'self';
  fundingWalletBitcoin: string | null;
  fundingWalletEthereum: string | null;
  fundingWalletTron: string | null;
}

export function getMe() {
  return request<{ success: boolean; data: { apiKey: ApiKey } }>('/me');
}

// =============================================================================
// Audit Logs
// =============================================================================

export interface AuditLog {
  id: number;
  timestamp: string;
  request_id: string;
  api_key_id: string | null;
  merchant_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  method: string;
  path: string;
  ip_address: string;
  user_agent: string | null;
  status_code: number | null;
  response_time_ms: number | null;
  success: boolean | null;
  error_code: string | null;
  error_message: string | null;
}

export interface AuditLogsResponse {
  status: boolean;
  data: { logs: AuditLog[]; total: number; limit: number; offset: number };
}

export function getAuditLogs(params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  return request<AuditLogsResponse>(`/me/audit-logs${qs ? `?${qs}` : ''}`);
}

// =============================================================================
// Settlement (self-settlement callback)
// =============================================================================

export function settleSelf(reference: string, settlementReference?: string) {
  return request(`/payments/${reference}/settle`, {
    method: 'POST',
    body: settlementReference ? { settlementReference } : {},
  });
}
