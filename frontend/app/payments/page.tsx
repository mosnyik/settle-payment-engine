'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { DashboardLayout } from '@/components/DashboardLayout';
import { getPayments, getPaymentStats, type Payment, type PaymentStats } from '@/lib/api';
import { cn, formatCurrency, formatDate, STATUS_COLORS } from '@/lib/utils';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ChevronLeft, ChevronRight, Clock, Loader2, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';

const LIMIT = 50;

const STATE_CARDS: Array<{
  label: string;
  statuses: string[];
  icon: React.ElementType;
  color: string;
  bg: string;
  border: string;
}> = [
  { label: 'Pending',    statuses: ['pending'],    icon: Clock,        color: 'text-amber-600',  bg: 'bg-amber-50',   border: 'border-amber-200' },
  { label: 'Confirming', statuses: ['confirming'], icon: Loader2,      color: 'text-blue-600',   bg: 'bg-blue-50',    border: 'border-blue-200' },
  { label: 'Confirmed',  statuses: ['confirmed'],  icon: CheckCircle2, color: 'text-violet-600', bg: 'bg-violet-50',  border: 'border-violet-200' },
  { label: 'Settling',   statuses: ['settling'],   icon: RefreshCw,    color: 'text-indigo-600', bg: 'bg-indigo-50',  border: 'border-indigo-200' },
  { label: 'Settled',    statuses: ['settled'],    icon: CheckCircle2, color: 'text-emerald-600',bg: 'bg-emerald-50', border: 'border-emerald-200' },
  { label: 'Failed / Expired', statuses: ['failed', 'expired', 'settlement_reversed'], icon: XCircle, color: 'text-red-500', bg: 'bg-red-50', border: 'border-red-200' },
];

const ALL_STATUSES = [
  'created', 'pending', 'confirming', 'confirmed',
  'settling', 'settled', 'expired', 'failed', 'settlement_reversed',
];

const ALL_TYPES = ['transfer', 'gift', 'request', 'merchant'];

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<PaymentStats>({});

  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {
        limit: String(LIMIT),
        offset: String(offset),
      };
      if (statusFilter !== 'all') params.status = statusFilter;
      if (typeFilter !== 'all') params.type = typeFilter;
      if (search) params.search = search;

      const res = await getPayments(params);
      setPayments(res.data.payments);
      setTotal(res.data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load payments');
    } finally {
      setLoading(false);
    }
  }, [offset, statusFilter, typeFilter, search]);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  useEffect(() => {
    getPaymentStats().then((res) => setStats(res.data.stats)).catch(() => {});
  }, []);

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0);
  }, [statusFilter, typeFilter, search]);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
  }

  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-slate-900">Payments</h1>
          <span className="text-sm text-slate-500">{total.toLocaleString()} total</span>
        </div>

        {/* State distribution cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {STATE_CARDS.map((card) => {
            const count = card.statuses.reduce((sum, s) => sum + (stats[s] ?? 0), 0);
            const isActive = card.statuses.some((s) => s === statusFilter);
            const Icon = card.icon;
            return (
              <button
                key={card.label}
                onClick={() => {
                  if (isActive) {
                    setStatusFilter('all');
                  } else {
                    setStatusFilter(card.statuses[0]);
                  }
                }}
                className={cn(
                  'flex flex-col gap-1.5 p-3 rounded-xl border text-left transition-all duration-150',
                  card.bg, card.border,
                  isActive ? 'ring-2 ring-offset-1 ring-current' : 'hover:opacity-80',
                  card.color
                )}
              >
                <div className="flex items-center justify-between">
                  <Icon className="w-4 h-4" />
                  <span className="text-lg font-bold tabular-nums">{count}</span>
                </div>
                <span className="text-xs font-medium leading-tight">{card.label}</span>
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {ALL_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={typeFilter} onValueChange={(v) => v && setTypeFilter(v)}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {ALL_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <form onSubmit={handleSearchSubmit} className="flex gap-2">
            <Input
              placeholder="Search reference..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-56"
            />
            <Button type="submit" variant="outline" size="default">Search</Button>
          </form>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl ring-1 ring-foreground/10 overflow-hidden">
          {error && (
            <div className="p-4 text-sm text-red-600 bg-red-50 border-b border-red-100">
              {error}
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Fiat Amount</TableHead>
                <TableHead>Crypto</TableHead>
                <TableHead>Network</TableHead>
                <TableHead>Receiver Account</TableHead>
                <TableHead>Created At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : payments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10 text-slate-400">
                    No payments found
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
                    <TableCell>
                      <span className="capitalize text-xs text-slate-600">{p.type}</span>
                    </TableCell>
                    <TableCell>
                      <span className={cn('px-2 py-1 rounded-full text-xs font-medium', STATUS_COLORS[p.status] ?? 'bg-slate-100 text-slate-700')}>
                        {p.status}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">
                      {formatCurrency(p.fiat_amount, p.fiat_currency)}
                    </TableCell>
                    <TableCell className="text-slate-600 uppercase text-xs">{p.crypto ?? '—'}</TableCell>
                    <TableCell className="text-slate-600 text-xs">{p.network ?? '—'}</TableCell>
                    <TableCell className="text-xs text-slate-600">
                      {p.account_number
                        ? `${p.account_number}${p.bank_code ? ` (${p.bank_code})` : ''}`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">{formatDate(p.created_at)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {!loading && total > LIMIT && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500">
              Page {currentPage} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                disabled={offset === 0}
              >
                <ChevronLeft className="size-4" />
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOffset(offset + LIMIT)}
                disabled={offset + LIMIT >= total}
              >
                Next
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
