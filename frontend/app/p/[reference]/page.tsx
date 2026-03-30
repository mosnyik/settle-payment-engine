'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'
import {
  Copy,
  Check,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react'
import Logo from '@/components/Logo'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Payment {
  id: string
  reference: string
  type: string
  status: string
  depositAddress: string | null
  cryptoAmount: number | null
  crypto: string | null
  network: string | null
  fiatAmount: number
  fiatCurrency: string
  rate: number | null
  txHash: string | null
  confirmations: number | null
  receivedAmount: number | null
  expiresAt: string | null
  confirmedAt: string | null
  settledAt: string | null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NETWORK_LABELS: Record<string, string> = {
  trc20: 'TRC-20',
  tron: 'Tron',
  erc20: 'ERC-20',
  ethereum: 'Ethereum',
  bep20: 'BEP-20',
  bsc: 'BSC',
  bitcoin: 'Bitcoin',
}

const CONFIRMATION_TARGETS: Record<string, number> = {
  trc20: 19,
  tron: 19,
  erc20: 12,
  ethereum: 12,
  bep20: 15,
  bsc: 15,
  bitcoin: 2,
}

const TERMINAL_STATUSES = ['confirmed', 'settled', 'expired', 'failed', 'settlement_reversed']

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCrypto(amount: number | null, crypto: string | null): string {
  if (amount == null || !crypto) return '—'
  const trimmed = parseFloat(amount.toFixed(8)).toString()
  return `${trimmed} ${crypto.toUpperCase()}`
}

function formatFiat(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toLocaleString()}`
  }
}

function buildCryptoUri(address: string, amount: number | null, network: string | null): string {
  if (amount == null) return address
  const amt = parseFloat(amount.toFixed(8)).toString()
  const net = network ?? ''
  if (net === 'bitcoin') return `bitcoin:${address}?amount=${amt}`
  if (net === 'trc20' || net === 'tron') return `tron:${address}?amount=${amt}`
  if (net === 'erc20' || net === 'ethereum') return `ethereum:${address}?value=${amt}`
  if (net === 'bep20' || net === 'bsc') return `ethereum:${address}?value=${amt}`
  return `${address}?amount=${amt}`
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return '00:00'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function secondsUntil(isoDate: string | null): number {
  if (!isoDate) return 0
  return Math.max(0, Math.floor((new Date(isoDate).getTime() - Date.now()) / 1000))
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Payment Stepper
// ---------------------------------------------------------------------------

const STEPS = [
  { key: 'pending',    label: 'Awaiting Payment' },
  { key: 'confirming', label: 'Confirming' },
  { key: 'confirmed',  label: 'Confirmed' },
  { key: 'settling',   label: 'Settling' },
  { key: 'settled',    label: 'Complete' },
]

const STATUS_TO_STEP: Record<string, number> = {
  pending: 0,
  confirming: 1,
  confirmed: 2,
  settling: 3,
  settled: 4,
}

function PaymentStepper({
  status,
  confirmations,
  network,
}: {
  status: string
  confirmations?: number | null
  network?: string | null
}) {
  if (!STATUS_TO_STEP.hasOwnProperty(status)) return null

  const currentStep = STATUS_TO_STEP[status]
  const target = CONFIRMATION_TARGETS[network ?? ''] ?? 12
  const current = Math.min(confirmations ?? 0, target)

  return (
    <div className="px-6 py-4 border-b border-slate-100">
      <div className="flex items-center justify-between relative">
        {/* Connecting line background */}
        <div className="absolute top-3.5 left-0 right-0 h-px bg-slate-200 z-0" />
        {/* Connecting line fill */}
        <div
          className="absolute top-3.5 left-0 h-px bg-[#2D6BE4] z-0 transition-all duration-700"
          style={{ width: `${(currentStep / (STEPS.length - 1)) * 100}%` }}
        />

        {STEPS.map((step, i) => {
          const done = i < currentStep
          const active = i === currentStep
          const isConfirmingStep = step.key === 'confirming'

          return (
            <div key={step.key} className="flex flex-col items-center gap-1.5 z-10">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all duration-300 ${
                  done
                    ? 'bg-[#2D6BE4] border-[#2D6BE4] text-white'
                    : active
                    ? 'bg-white border-[#2D6BE4] text-[#2D6BE4]'
                    : 'bg-white border-slate-200 text-slate-300'
                }`}
              >
                {done ? <Check className="w-3.5 h-3.5" /> : <span>{i + 1}</span>}
              </div>
              <span
                className={`text-[10px] font-medium text-center leading-tight w-14 ${
                  done || active ? 'text-slate-700' : 'text-slate-300'
                }`}
              >
                {step.label}
                {isConfirmingStep && active && (
                  <span className="block text-[#2D6BE4] font-bold tabular-nums">
                    {current}/{target}
                  </span>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; class: string }> = {
    pending:    { label: 'Awaiting Payment', class: 'bg-amber-50 text-amber-700 border-amber-200' },
    confirming: { label: 'Confirming',       class: 'bg-blue-50 text-blue-700 border-blue-200' },
    confirmed:  { label: 'Confirmed',         class: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    settled:    { label: 'Settled',           class: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    expired:    { label: 'Expired',           class: 'bg-slate-50 text-slate-500 border-slate-200' },
    failed:     { label: 'Failed',            class: 'bg-red-50 text-red-600 border-red-200' },
  }
  const s = map[status] ?? { label: status, class: 'bg-slate-50 text-slate-500 border-slate-200' }
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${s.class}`}>
      {s.label}
    </span>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
      const el = document.createElement('textarea')
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [text])

  return (
    <button
      onClick={handleCopy}
      aria-label="Copy address"
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
        bg-[#2D6BE4] text-white hover:bg-[#2560d0] active:scale-95
        transition-all duration-150 cursor-pointer select-none"
    >
      {copied ? (
        <><Check className="w-3.5 h-3.5" /> Copied</>
      ) : (
        <><Copy className="w-3.5 h-3.5" /> Copy</>
      )}
    </button>
  )
}

function ConfirmationBar({
  confirmations,
  network,
}: {
  confirmations: number | null
  network: string | null
}) {
  const target = CONFIRMATION_TARGETS[network ?? ''] ?? 12
  const current = Math.min(confirmations ?? 0, target)
  const pct = Math.round((current / target) * 100)

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-slate-500">
        <span>Confirmations</span>
        <span className="font-semibold text-slate-700">{current} / {target}</span>
      </div>
      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-[#2D6BE4] transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 bg-slate-100 rounded-xl w-2/3 mx-auto" />
      <div className="h-48 bg-slate-100 rounded-2xl" />
      <div className="h-12 bg-slate-100 rounded-xl" />
      <div className="h-10 bg-slate-100 rounded-xl" />
    </div>
  )
}

function PendingState({ payment, countdown }: { payment: Payment; countdown: number }) {
  const networkLabel = NETWORK_LABELS[payment.network ?? ''] ?? payment.network ?? ''

  return (
    <div className="space-y-5">
      {/* Amount */}
      <div className="text-center space-y-1">
        <p className="text-sm text-slate-500">Send exactly</p>
        <div className="flex items-center justify-center gap-2">
          <p className="text-3xl font-bold text-slate-900 tracking-tight">
            {formatCrypto(payment.cryptoAmount, payment.crypto)}
          </p>
          {payment.cryptoAmount != null && (
            <CopyButton text={parseFloat(payment.cryptoAmount.toFixed(8)).toString()} />
          )}
        </div>
        <p className="text-sm text-slate-400">
          ≈ {formatFiat(payment.fiatAmount, payment.fiatCurrency)}
        </p>
        {networkLabel && (
          <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold
            bg-[#2D6BE4]/10 text-[#2D6BE4] border border-[#2D6BE4]/20 mt-1">
            {networkLabel} Network
          </span>
        )}
      </div>

      {/* QR */}
      {payment.depositAddress && (
        <div className="flex justify-center">
          <div className="p-3 bg-white rounded-2xl shadow-sm border border-slate-100">
            <QRCodeSVG
              value={payment.depositAddress}
              size={180}
              level="M"
              includeMargin={false}
              fgColor="#0f172a"
            />
          </div>
        </div>
      )}

      {/* Address + Amount */}
      {payment.depositAddress && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
            Deposit Address
          </p>
          <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl">
            <p
              className="flex-1 text-xs text-slate-700 break-all leading-relaxed font-mono"
            >
              {payment.depositAddress}
            </p>
            <CopyButton text={payment.depositAddress} />
          </div>
        </div>
      )}

      {/* Warning */}
      <div className="flex gap-2.5 p-3 bg-amber-50 border border-amber-100 rounded-xl">
        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-700 leading-relaxed">
          Send only <strong>{payment.crypto?.toUpperCase()}</strong> on the{' '}
          <strong>{networkLabel}</strong> network to this address. Sending any other
          asset will result in permanent loss.
        </p>
      </div>

      {/* Timer */}
      <div className="flex items-center justify-center gap-2 text-sm">
        <Clock className="w-4 h-4 text-slate-400" />
        <span className="text-slate-500">Expires in</span>
        <span
          className={`font-mono font-semibold tabular-nums ${
            countdown < 120 ? 'text-red-500' : 'text-slate-700'
          }`}
        >
          {formatCountdown(countdown)}
        </span>
      </div>
    </div>
  )
}

function ConfirmingState({
  payment,
}: {
  payment: Payment
}) {
  return (
    <div className="space-y-6 text-center">
      <div className="flex justify-center">
        <div className="relative">
          <div className="w-20 h-20 rounded-full bg-blue-50 flex items-center justify-center">
            <Loader2 className="w-10 h-10 text-[#2D6BE4] animate-spin" />
          </div>
          <div className="absolute inset-0 rounded-full border-2 border-[#2D6BE4]/20 animate-ping" />
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-lg font-bold text-slate-800">Payment Detected!</h3>
        <p className="text-sm text-slate-500 leading-relaxed">
          Your payment is being confirmed on the blockchain.
          <br />This usually takes a few minutes.
        </p>
      </div>

      <ConfirmationBar
        confirmations={payment.confirmations}
        network={payment.network}
      />

      {payment.txHash && (
        <div className="space-y-1">
          <p className="text-xs text-slate-400">Transaction Hash</p>
          <p
            className="text-xs text-slate-600 break-all"
            style={{ fontFamily: 'var(--font-geist-mono), monospace' }}
          >
            {payment.txHash}
          </p>
        </div>
      )}
    </div>
  )
}

function SuccessState({ payment }: { payment: Payment }) {
  return (
    <div className="space-y-5 text-center">
      <div className="flex justify-center">
        <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-500" />
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-xl font-bold text-slate-800">Payment Complete!</h3>
        <p className="text-sm text-slate-500">
          {formatFiat(payment.fiatAmount, payment.fiatCurrency)} will be credited shortly.
        </p>
      </div>

      <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl space-y-2 text-left">
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">Reference</span>
          <span className="font-mono font-semibold text-slate-700">{payment.reference}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">Amount Paid</span>
          <span className="font-semibold text-slate-700">
            {formatCrypto(payment.receivedAmount ?? payment.cryptoAmount, payment.crypto)}
          </span>
        </div>
        {payment.settledAt && (
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Settled At</span>
            <span className="font-semibold text-slate-700">
              {new Date(payment.settledAt).toLocaleTimeString()}
            </span>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-400 animate-pulse">Redirecting you back...</p>
    </div>
  )
}

function ExpiredState({ reference }: { reference: string }) {
  return (
    <div className="space-y-5 text-center">
      <div className="flex justify-center">
        <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center">
          <Clock className="w-10 h-10 text-slate-400" />
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-xl font-bold text-slate-800">Session Expired</h3>
        <p className="text-sm text-slate-500 leading-relaxed">
          This payment session has expired. If you already sent funds,
          please contact support with reference{' '}
          <span className="font-mono font-semibold text-slate-700">{reference}</span>.
        </p>
      </div>

      <button
        onClick={() => window.history.back()}
        className="w-full py-3 rounded-xl font-semibold text-sm
          bg-slate-100 text-slate-700 hover:bg-slate-200
          transition-colors duration-150 cursor-pointer"
      >
        Go Back
      </button>
    </div>
  )
}

function NotFoundState() {
  return (
    <div className="space-y-5 text-center">
      <div className="flex justify-center">
        <div className="w-20 h-20 rounded-full bg-red-50 flex items-center justify-center">
          <XCircle className="w-10 h-10 text-red-400" />
        </div>
      </div>
      <div className="space-y-2">
        <h3 className="text-xl font-bold text-slate-800">Payment Not Found</h3>
        <p className="text-sm text-slate-500">
          This payment link is invalid or no longer exists.
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function PaymentPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const reference = params.reference as string
  const callbackUrl = searchParams.get('callback_url')

  const [payment, setPayment] = useState<Payment | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [countdown, setCountdown] = useState(0)

  const callbackUrlRef = useRef(callbackUrl)
  callbackUrlRef.current = callbackUrl

  const apiBase = process.env.NEXT_PUBLIC_SETTLE_API_URL ?? 'http://localhost:3500/v1'

  // -------------------------------------------------------------------------
  // Fetch payment
  // -------------------------------------------------------------------------
  const fetchPayment = useCallback(async (): Promise<Payment | null> => {
    try {
      const res = await fetch(`${apiBase}/payments/${reference}`)
      if (res.status === 404) {
        setNotFound(true)
        return null
      }
      const data = await res.json()
      if (!data.success) return null
      return data.payment as Payment
    } catch {
      return null
    }
  }, [apiBase, reference])

  // -------------------------------------------------------------------------
  // Initial load
  // -------------------------------------------------------------------------
  useEffect(() => {
    fetchPayment().then((p) => {
      if (p) {
        setPayment(p)
        setCountdown(secondsUntil(p.expiresAt))
      }
      setLoading(false)
    })
  }, [fetchPayment])

  // -------------------------------------------------------------------------
  // Polling
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!payment) return
    if (TERMINAL_STATUSES.includes(payment.status)) return

    const interval = setInterval(async () => {
      const updated = await fetchPayment()
      if (updated) setPayment(updated)
    }, 8000)

    return () => clearInterval(interval)
  }, [payment?.status, fetchPayment])

  // -------------------------------------------------------------------------
  // Countdown timer
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!payment?.expiresAt) return
    if (TERMINAL_STATUSES.includes(payment.status)) return

    const tick = setInterval(() => {
      const remaining = secondsUntil(payment.expiresAt)
      setCountdown(remaining)
      if (remaining === 0) clearInterval(tick)
    }, 1000)

    return () => clearInterval(tick)
  }, [payment?.expiresAt, payment?.status])

  // -------------------------------------------------------------------------
  // Redirect on success
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!payment) return
    if (payment.status !== 'confirmed' && payment.status !== 'settled') return

    const url = callbackUrlRef.current
    if (!url) return

    const timer = setTimeout(() => {
      try {
        const parsed = new URL(url)
        parsed.searchParams.set('reference', payment.reference)
        parsed.searchParams.set('status', payment.status)
        window.location.href = parsed.toString()
      } catch {
        // invalid URL — don't redirect
      }
    }, 3000)

    return () => clearTimeout(timer)
  }, [payment?.status, payment?.reference])

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const isSuccess = payment?.status === 'confirmed' || payment?.status === 'settled'
  const isExpired = payment?.status === 'expired' || (payment?.status === 'pending' && countdown === 0 && !loading)

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-4"
      style={{
        background: 'linear-gradient(135deg, #f0f4ff 0%, #f3eeff 45%, #fde8f4 100%)',
      }}
    >
      {/* Card */}
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <Logo />
        </div>

        <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/60 border border-slate-100 overflow-hidden">
          {/* Header */}
          <div className="px-6 pt-6 pb-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-1">
                Payment
              </p>
              {payment && (
                <p
                  className="text-sm font-mono font-semibold text-slate-700"
                >
                  {payment.reference}
                </p>
              )}
            </div>
            {payment && <StatusBadge status={payment.status} />}
          </div>

          {/* Stepper */}
          {payment && (
            <PaymentStepper
              status={payment.status}
              confirmations={payment.confirmations}
              network={payment.network}
            />
          )}

          {/* Body */}
          <div className="px-6 py-6">
            {loading && <LoadingSkeleton />}

            {!loading && notFound && <NotFoundState />}

            {!loading && payment && (
              <>
                {isSuccess && <SuccessState payment={payment} />}
                {isExpired && !isSuccess && <ExpiredState reference={payment.reference} />}
                {payment.status === 'confirming' && !isSuccess && (
                  <ConfirmingState payment={payment} />
                )}
                {payment.status === 'pending' && !isExpired && (
                  <PendingState payment={payment} countdown={countdown} />
                )}
                {payment.status === 'failed' && (
                  <div className="text-center space-y-3 py-4">
                    <XCircle className="w-12 h-12 text-red-400 mx-auto" />
                    <p className="font-semibold text-slate-800">Payment Failed</p>
                    <p className="text-sm text-slate-500">
                      Something went wrong. Contact support with ref{' '}
                      <span className="font-mono">{payment.reference}</span>.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-[#2D6BE4]" />
            <p className="text-xs text-slate-400">
              Secured by{' '}
              <span className="font-semibold text-[#2D6BE4]">2settle</span>
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 mt-4">
          Need help?{' '}
          <a
            href="mailto:support@2settle.io"
            className="text-[#2D6BE4] hover:underline cursor-pointer"
          >
            Contact support
          </a>
        </p>
      </div>
    </div>
  )
}
