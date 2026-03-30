'use client';

import { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { getAuditLogs, type AuditLog } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const LIMIT = 50;

function statusCodeColor(code: number | null): string {
  if (code == null) return 'text-slate-400';
  if (code < 400) return 'text-green-700 font-medium';
  return 'text-red-600 font-medium';
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [actionSearch, setActionSearch] = useState('');
  const [actionInput, setActionInput] = useState('');
  const [successFilter, setSuccessFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {
        limit: String(LIMIT),
        offset: String(offset),
      };
      if (actionSearch) params.action = actionSearch;
      if (successFilter !== 'all') params.success = successFilter === 'success' ? 'true' : 'false';
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo;

      const res = await getAuditLogs(params);
      setLogs(res.data.logs);
      setTotal(res.data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [offset, actionSearch, successFilter, dateFrom, dateTo]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    setOffset(0);
  }, [actionSearch, successFilter, dateFrom, dateTo]);

  function handleActionSearch(e: React.FormEvent) {
    e.preventDefault();
    setActionSearch(actionInput);
  }

  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-slate-900">Audit Logs</h1>
          <span className="text-sm text-slate-500">{total.toLocaleString()} total</span>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <form onSubmit={handleActionSearch} className="flex gap-2">
            <Input
              placeholder="Search action..."
              value={actionInput}
              onChange={(e) => setActionInput(e.target.value)}
              className="w-48"
            />
            <Button type="submit" variant="outline" size="default">Search</Button>
          </form>

          <Select value={successFilter} onValueChange={(v) => v && setSuccessFilter(v)}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All results" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All results</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-500">From</label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-500">To</label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-40"
            />
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl ring-1 ring-foreground/10 overflow-hidden">
          {error && (
            <div className="p-4 text-sm text-red-600 bg-red-50 border-b border-red-100">{error}</div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Method & Path</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Merchant ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Response Time</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10 text-slate-400">
                    No audit logs found
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-xs text-slate-500 whitespace-nowrap">
                      {formatDate(log.timestamp)}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <code className={cn(
                          'text-xs font-mono px-1 py-0.5 rounded',
                          log.method === 'GET' ? 'bg-blue-50 text-blue-700' :
                          log.method === 'POST' ? 'bg-green-50 text-green-700' :
                          log.method === 'DELETE' ? 'bg-red-50 text-red-700' :
                          'bg-slate-100 text-slate-700'
                        )}>
                          {log.method}
                        </code>
                        <code className="text-xs text-slate-600 truncate max-w-48">{log.path}</code>
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-slate-700">{log.action}</TableCell>
                    <TableCell className="text-xs text-slate-600">{log.merchant_id ?? '—'}</TableCell>
                    <TableCell className={cn('text-xs font-mono', statusCodeColor(log.status_code))}>
                      {log.status_code ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {log.response_time_ms != null ? `${log.response_time_ms}ms` : '—'}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-slate-500">{log.ip_address}</TableCell>
                    <TableCell>
                      <span className={cn(
                        'px-2 py-1 rounded-full text-xs font-medium',
                        log.success === true
                          ? 'bg-green-100 text-green-800'
                          : log.success === false
                          ? 'bg-red-100 text-red-700'
                          : 'bg-slate-100 text-slate-600'
                      )}>
                        {log.success === true ? 'Success' : log.success === false ? 'Failed' : 'Unknown'}
                      </span>
                    </TableCell>
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
