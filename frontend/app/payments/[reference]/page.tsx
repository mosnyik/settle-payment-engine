'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { DashboardLayout } from '@/components/DashboardLayout';
import { getPayment, settleSelf, type Payment } from '@/lib/api';
import { cn, formatCurrency, formatDate, STATUS_COLORS } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-900 break-all">{value ?? '—'}</span>
    </div>
  );
}

export default function PaymentDetailPage() {
  const params = useParams();
  const reference = params.reference as string;

  const [payment, setPayment] = useState<Payment & Record<string, unknown> | null>(null);
  const [settlementAttempts, setSettlementAttempts] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);

  useEffect(() => {
    async function fetchPayment() {
      setLoading(true);
      setError(null);
      try {
        const res = await getPayment(reference);
        setPayment(res.data.payment);
        setSettlementAttempts(res.data.settlementAttempts);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load payment');
      } finally {
        setLoading(false);
      }
    }
    fetchPayment();
  }, [reference]);

  async function handleManualSettle() {
    setSettling(true);
    try {
      await settleSelf(reference);
      toast.success('Settlement triggered successfully');
      // Refresh payment
      const res = await getPayment(reference);
      setPayment(res.data.payment);
      setSettlementAttempts(res.data.settlementAttempts);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Settlement failed');
    } finally {
      setSettling(false);
    }
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex flex-col gap-5">
          <Skeleton className="h-8 w-64" />
          <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-40" />
            ))}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (error || !payment) {
    return (
      <DashboardLayout>
        <div className="text-red-600 bg-red-50 border border-red-200 rounded-lg p-4">
          {error ?? 'Payment not found'}
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-mono text-base font-semibold text-slate-900">{payment.reference}</h1>
              <span className={cn('px-2 py-1 rounded-full text-xs font-medium', STATUS_COLORS[payment.status] ?? 'bg-slate-100 text-slate-700')}>
                {payment.status}
              </span>
              <span className="px-2 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 capitalize">
                {payment.type}
              </span>
            </div>
            <p className="text-sm text-slate-500">Created {formatDate(payment.created_at)}</p>
          </div>
          {payment.status === 'settling' && (
            <Button
              onClick={handleManualSettle}
              disabled={settling}
              variant="default"
            >
              {settling ? 'Settling...' : 'Manual Settle'}
            </Button>
          )}
        </div>

        {/* Detail Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Amounts */}
          <Card>
            <CardHeader>
              <CardTitle>Amounts</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <DetailRow
                label="Fiat Amount"
                value={formatCurrency(payment.fiat_amount, payment.fiat_currency)}
              />
              <DetailRow
                label="Crypto Amount"
                value={payment.crypto_amount != null ? `${payment.crypto_amount} ${payment.crypto ?? ''}` : null}
              />
              <DetailRow
                label="Rate"
                value={payment.rate != null ? `1 ${payment.crypto ?? 'crypto'} = ${formatCurrency(payment.rate, payment.fiat_currency)}` : null}
              />
              <DetailRow
                label="Charges"
                value={payment.charge_amount != null ? formatCurrency(payment.charge_amount, payment.fiat_currency) : null}
              />
            </CardContent>
          </Card>

          {/* Deposit */}
          <Card>
            <CardHeader>
              <CardTitle>Deposit</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <DetailRow label="Deposit Address" value={payment.deposit_address} />
              <DetailRow label="TX Hash" value={payment.tx_hash} />
              <DetailRow label="Confirmations" value={payment.confirmations} />
              <DetailRow
                label="Received Amount"
                value={payment.received_amount != null ? `${payment.received_amount} ${payment.crypto ?? ''}` : null}
              />
            </CardContent>
          </Card>

          {/* Receiver */}
          <Card>
            <CardHeader>
              <CardTitle>Receiver</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <DetailRow label="Account Name" value={payment.account_name} />
              <DetailRow label="Account Number" value={payment.account_number} />
              <DetailRow label="Bank Code" value={payment.bank_code} />
              <DetailRow label="Bank Name" value={payment.bank_name} />
            </CardContent>
          </Card>

          {/* Payer */}
          <Card>
            <CardHeader>
              <CardTitle>Payer</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <DetailRow label="Chat ID" value={payment.payer_chat_id} />
              <DetailRow label="Merchant ID" value={payment.merchant_id} />
              <DetailRow label="Merchant Reference" value={payment.merchant_reference} />
            </CardContent>
          </Card>

          {/* Settlement */}
          <Card>
            <CardHeader>
              <CardTitle>Settlement</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <DetailRow label="Provider" value={payment.settlement_provider} />
              <DetailRow label="Settlement Reference" value={payment.settlement_reference} />
              <DetailRow label="Confirmed At" value={formatDate(payment.confirmed_at)} />
              <DetailRow label="Settled At" value={formatDate(payment.settled_at)} />
            </CardContent>
          </Card>

          {/* Timing */}
          <Card>
            <CardHeader>
              <CardTitle>Timing</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <DetailRow label="Created At" value={formatDate(payment.created_at)} />
              <DetailRow label="Updated At" value={formatDate(payment.updated_at)} />
              <DetailRow label="Expires At" value={formatDate(payment.expires_at)} />
            </CardContent>
          </Card>
        </div>

        {/* Settlement Attempts */}
        <div className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-slate-900">Settlement Attempts</h2>
          <div className="bg-white rounded-xl ring-1 ring-foreground/10 overflow-hidden">
            {settlementAttempts.length === 0 ? (
              <div className="text-center py-8 text-sm text-slate-400">No settlement attempts</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Error</TableHead>
                    <TableHead>Attempted At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {settlementAttempts.map((attempt: unknown, i) => {
                    const a = attempt as Record<string, unknown>;
                    return (
                      <TableRow key={i}>
                        <TableCell className="text-xs text-slate-500">{i + 1}</TableCell>
                        <TableCell className="text-xs">{String(a.provider ?? '—')}</TableCell>
                        <TableCell>
                          <span className={cn(
                            'px-2 py-1 rounded-full text-xs font-medium',
                            a.status === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'
                          )}>
                            {String(a.status ?? '—')}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{String(a.reference ?? '—')}</TableCell>
                        <TableCell className="text-xs text-red-600 max-w-xs truncate">{String(a.error_message ?? '—')}</TableCell>
                        <TableCell className="text-xs text-slate-500">{formatDate(String(a.attempted_at ?? a.created_at ?? ''))}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
