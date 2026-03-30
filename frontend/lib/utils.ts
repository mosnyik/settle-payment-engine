import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, currency = 'NGN') {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency }).format(amount);
}

export function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export const STATUS_COLORS: Record<string, string> = {
  created:              'bg-slate-100 text-slate-700',
  pending:              'bg-yellow-100 text-yellow-800',
  confirming:           'bg-blue-100 text-blue-800',
  confirmed:            'bg-indigo-100 text-indigo-800',
  settling:             'bg-purple-100 text-purple-800',
  settled:              'bg-green-100 text-green-800',
  expired:              'bg-gray-100 text-gray-600',
  failed:               'bg-red-100 text-red-700',
  settlement_reversed:  'bg-orange-100 text-orange-800',
};
