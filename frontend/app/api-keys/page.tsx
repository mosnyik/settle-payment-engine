'use client';

import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { getMe, type ApiKey } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const TIER_COLORS: Record<string, string> = {
  standard: 'bg-slate-100 text-slate-700',
  premium: 'bg-blue-100 text-blue-800',
  unlimited: 'bg-purple-100 text-purple-800',
};

const SETTLEMENT_COLORS: Record<string, string> = {
  mongoro: 'bg-blue-100 text-blue-800',
  self: 'bg-orange-100 text-orange-800',
};

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-900 break-all">{value ?? '—'}</span>
    </div>
  );
}

export default function ApiKeyPage() {
  const [apiKey, setApiKey] = useState<ApiKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMe()
      .then((res) => setApiKey(res.data.apiKey))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load API key'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-5 max-w-2xl">
        <h1 className="text-lg font-semibold text-slate-900">My API Key</h1>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-slate-700">Key Details</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="grid grid-cols-2 gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : apiKey ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <DetailRow
                  label="Key ID (Public)"
                  value={<code className="text-xs">{apiKey.keyId}</code>}
                />
                <DetailRow label="Name" value={apiKey.name} />
                <DetailRow label="Merchant ID" value={apiKey.merchantId} />
                <DetailRow
                  label="Status"
                  value={
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', apiKey.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700')}>
                      {apiKey.isActive ? 'Active' : 'Revoked'}
                    </span>
                  }
                />
                <DetailRow
                  label="Tier"
                  value={
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium capitalize', TIER_COLORS[apiKey.rateLimitTier] ?? 'bg-slate-100 text-slate-700')}>
                      {apiKey.rateLimitTier}
                    </span>
                  }
                />
                <DetailRow
                  label="Settlement Mode"
                  value={
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium capitalize', SETTLEMENT_COLORS[apiKey.settlementMode] ?? 'bg-slate-100 text-slate-700')}>
                      {apiKey.settlementMode}
                    </span>
                  }
                />
                <DetailRow label="Permissions" value={apiKey.permissions.join(', ') || '—'} />
                <DetailRow label="Webhook URL" value={apiKey.webhookUrl} />
                <DetailRow label="Sweep Address" value={apiKey.sweepAddress} />
                <DetailRow label="Created" value={formatDate(apiKey.createdAt)} />
                <DetailRow label="Last Used" value={formatDate(apiKey.lastUsedAt)} />
                <DetailRow label="Expires" value={formatDate(apiKey.expiresAt)} />
              </div>
            ) : null}
          </CardContent>
        </Card>

        {apiKey && (apiKey.fundingWalletBitcoin || apiKey.fundingWalletEthereum || apiKey.fundingWalletTron) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-slate-700">Funding Wallets</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4">
                {apiKey.fundingWalletBitcoin && (
                  <DetailRow label="Bitcoin" value={<code className="text-xs">{apiKey.fundingWalletBitcoin}</code>} />
                )}
                {apiKey.fundingWalletEthereum && (
                  <DetailRow label="Ethereum / BSC / EVM" value={<code className="text-xs">{apiKey.fundingWalletEthereum}</code>} />
                )}
                {apiKey.fundingWalletTron && (
                  <DetailRow label="Tron / TRC20" value={<code className="text-xs">{apiKey.fundingWalletTron}</code>} />
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
