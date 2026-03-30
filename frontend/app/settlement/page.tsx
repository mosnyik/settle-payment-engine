'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { DashboardLayout } from '@/components/DashboardLayout';
import { getPayments, settleSelf, type Payment } from '@/lib/api';
import { cn, formatCurrency, formatDate, STATUS_COLORS } from '@/lib/utils';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

function PaymentsTable({
  title,
  payments,
  loading,
  error,
  showSettleButton,
  settlingRef,
  onSettle,
}: {
  title: string;
  payments: Payment[];
  loading: boolean;
  error: string | null;
  showSettleButton: boolean;
  settlingRef: string | null;
  onSettle: (ref: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <div className="bg-white rounded-xl ring-1 ring-foreground/10 overflow-hidden">
        {error && (
          <div className="p-4 text-sm text-red-600 bg-red-50 border-b border-red-100">{error}</div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>Fiat Amount</TableHead>
              <TableHead>Receiver</TableHead>
              <TableHead>Settlement Provider</TableHead>
              <TableHead>Settlement Reference</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created At</TableHead>
              {showSettleButton && <TableHead>Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: showSettleButton ? 8 : 7 }).map((__, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : payments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={showSettleButton ? 8 : 7} className="text-center py-8 text-slate-400">
                  No payments
                </TableCell>
              </TableRow>
            ) : (
              payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link
                      href={`/payments/${p.reference}`}
                      className="font-mono text-xs text-blue-600 hover:underline"
                    >
                      {p.reference}
                    </Link>
                  </TableCell>
                  <TableCell className="font-medium text-sm">
                    {formatCurrency(p.fiat_amount, p.fiat_currency)}
                  </TableCell>
                  <TableCell className="text-xs text-slate-600">
                    {p.account_name ?? '—'}
                    {p.account_number ? ` · ${p.account_number}` : ''}
                  </TableCell>
                  <TableCell className="text-xs text-slate-600 capitalize">{p.settlement_provider ?? '—'}</TableCell>
                  <TableCell className="font-mono text-xs text-slate-600">{p.settlement_reference ?? '—'}</TableCell>
                  <TableCell>
                    <span className={cn('px-2 py-1 rounded-full text-xs font-medium', STATUS_COLORS[p.status] ?? 'bg-slate-100 text-slate-700')}>
                      {p.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">{formatDate(p.created_at)}</TableCell>
                  {showSettleButton && (
                    <TableCell>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => onSettle(p.reference)}
                        disabled={settlingRef === p.reference}
                      >
                        {settlingRef === p.reference ? 'Confirming...' : 'Confirm Settled'}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function SettlementPage() {
  const [settlingPayments, setSettlingPayments] = useState<Payment[]>([]);
  const [confirmedPayments, setConfirmedPayments] = useState<Payment[]>([]);
  const [loadingSettling, setLoadingSettling] = useState(true);
  const [loadingConfirmed, setLoadingConfirmed] = useState(true);
  const [errorSettling, setErrorSettling] = useState<string | null>(null);
  const [errorConfirmed, setErrorConfirmed] = useState<string | null>(null);
  const [settlingRef, setSettlingRef] = useState<string | null>(null);

  const fetchSettling = useCallback(async () => {
    setLoadingSettling(true);
    setErrorSettling(null);
    try {
      const res = await getPayments({ status: 'settling', limit: '100' });
      setSettlingPayments(res.data.payments);
    } catch (err) {
      setErrorSettling(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoadingSettling(false);
    }
  }, []);

  const fetchConfirmed = useCallback(async () => {
    setLoadingConfirmed(true);
    setErrorConfirmed(null);
    try {
      const res = await getPayments({ status: 'confirmed', limit: '100' });
      setConfirmedPayments(res.data.payments);
    } catch (err) {
      setErrorConfirmed(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoadingConfirmed(false);
    }
  }, []);

  useEffect(() => {
    fetchSettling();
    fetchConfirmed();
  }, [fetchSettling, fetchConfirmed]);

  async function handleSettle(reference: string) {
    setSettlingRef(reference);
    try {
      await settleSelf(reference);
      toast.success(`Settlement confirmed for ${reference}`);
      await fetchSettling();
      await fetchConfirmed();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Settlement failed');
    } finally {
      setSettlingRef(null);
    }
  }

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-7">
        <h1 className="text-lg font-semibold text-slate-900">Settlement</h1>

        <PaymentsTable
          title="Currently Settling"
          payments={settlingPayments}
          loading={loadingSettling}
          error={errorSettling}
          showSettleButton={true}
          settlingRef={settlingRef}
          onSettle={handleSettle}
        />

        <PaymentsTable
          title="Awaiting Settlement (Confirmed)"
          payments={confirmedPayments}
          loading={loadingConfirmed}
          error={errorConfirmed}
          showSettleButton={false}
          settlingRef={null}
          onSettle={() => {}}
        />
      </div>
    </DashboardLayout>
  );
}
