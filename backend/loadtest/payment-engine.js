/**
 * k6 load test for the payment engine.
 *
 *   k6 run -e PROFILE=smoke  -e BASE_URL=https://api.2settle.io -e API_KEY=pk_test_... -e SECRET_KEY=sk_test_... loadtest/payment-engine.js
 *   k6 run -e PROFILE=ramp   ...   # step up to 5k VUs, find the knee
 *   k6 run -e PROFILE=hold5k ...   # 5k concurrent sessions for 10 min
 *   k6 run -e PROFILE=spike  ...   # 0 -> 5k in 30s
 *
 * Use a SANDBOX key (pk_test_) with rateLimitTier "unlimited" and no IP whitelist.
 * See loadtest/README.md for the server-side prep — without it you are load
 * testing mod_evasive, not the app.
 */
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import exec from 'k6/execution';
import { Counter, Trend } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';
import { signedHeaders } from './lib/auth.js';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3500').replace(/\/$/, '');
const API_KEY = __ENV.API_KEY;
const SECRET_KEY = __ENV.SECRET_KEY;
const PROFILE = __ENV.PROFILE || 'smoke';
// Share of sessions that create a payment (the rest only read/poll).
const WRITE_RATIO = parseFloat(__ENV.WRITE_RATIO || '0.1');
// Sessions that derive a real HD address (see README: burns derivation indexes).
const MAX_DERIVATIONS = parseInt(__ENV.MAX_DERIVATIONS || '0', 10);
const SEED_REFS = parseInt(__ENV.SEED_REFS || '20', 10);
// What "reliable" means: p95 end-to-end (network included) and error rate,
// judged separately at each steady load level of the ramp.
const SLO_P95_MS = parseInt(__ENV.SLO_P95_MS || '3000', 10);
const SLO_ERROR_RATE = parseFloat(__ENV.SLO_ERROR_RATE || '0.01');
// Concurrent-session levels the ramp steps through, and how long each is held.
const LEVELS = (__ENV.LEVELS || '250,500,1000,2000,3500,5000').split(',').map((n) => parseInt(n, 10));
const RAMP_TIME = __ENV.RAMP_TIME || '1m';
const HOLD_TIME = __ENV.HOLD_TIME || '3m';

const rateLimited = new Counter('rate_limited_429');
const serverTimeouts = new Counter('server_timeouts_503');
const serverErrors = new Counter('server_errors_5xx');
const sessionDuration = new Trend('session_duration', true);

const PROFILES = {
  smoke: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 10 },
    { duration: '10s', target: 0 },
  ],
  // Step load: ramp to each level, then hold it. Requests made during a hold
  // are tagged level:<n>, so the summary reports each level separately.
  ramp: LEVELS.flatMap((target) => [
    { duration: RAMP_TIME, target },
    { duration: HOLD_TIME, target },
  ]).concat([{ duration: '1m', target: 0 }]),
  hold5k: [
    { duration: '5m', target: 5000 },
    { duration: '10m', target: 5000 },
    { duration: '1m', target: 0 },
  ],
  spike: [
    { duration: '30s', target: 5000 },
    { duration: '2m', target: 5000 },
    { duration: '30s', target: 0 },
  ],
};

if (!PROFILES[PROFILE]) {
  throw new Error(`Unknown PROFILE "${PROFILE}". Use one of: ${Object.keys(PROFILES).join(', ')}`);
}

const scenarios = {
  sessions: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: PROFILES[PROFILE],
    gracefulRampDown: '30s',
    exec: 'userSession',
  },
};

if (MAX_DERIVATIONS > 0) {
  // Low, fixed concurrency on the address-derivation path: it takes a
  // SELECT ... FOR UPDATE on hd_wallet_config, so every create serialises.
  scenarios.derive = {
    executor: 'shared-iterations',
    vus: Math.min(20, MAX_DERIVATIONS),
    iterations: MAX_DERIVATIONS,
    maxDuration: '10m',
    exec: 'deriveSession',
  };
}

function parseDurationMs(d) {
  const m = /^(\d+)(ms|s|m|h)$/.exec(d);
  if (!m) throw new Error(`Unsupported duration "${d}" (use e.g. 90s, 3m)`);
  return parseInt(m[1], 10) * { ms: 1, s: 1000, m: 60000, h: 3600000 }[m[2]];
}

// [startMs, endMs, level] for every stage that holds a constant VU count.
const HOLD_WINDOWS = (() => {
  const windows = [];
  let t = 0;
  let prevTarget = 0;
  for (const stage of PROFILES[PROFILE]) {
    const ms = parseDurationMs(stage.duration);
    if (stage.target > 0 && stage.target === prevTarget) windows.push([t, t + ms, stage.target]);
    t += ms;
    prevTarget = stage.target;
  }
  return windows;
})();
const HOLD_LEVELS = [...new Set(HOLD_WINDOWS.map((w) => w[2]))];

// setup() has no scenario context, and k6 throws uncatchably if we ask for one.
let inSetup = false;

function currentLevel() {
  if (inSetup) return 'setup';
  const scenario = exec.scenario;
  if (scenario.name !== 'sessions') return scenario.name;
  const elapsed = Date.now() - scenario.startTime;
  const w = HOLD_WINDOWS.find(([start, end]) => elapsed >= start && elapsed < end);
  return w ? String(w[2]) : 'ramping';
}

const thresholds = {
  // Safety stop: once well past capacity, stop hammering production.
  http_req_failed: [{ threshold: 'rate<0.10', abortOnFail: PROFILE !== 'smoke', delayAbortEval: '1m' }],
  'http_req_duration{name:rate}': [`p(95)<${SLO_P95_MS}`],
  'http_req_duration{name:banks}': [`p(95)<${SLO_P95_MS}`],
  'http_req_duration{name:payment_get}': [`p(95)<${SLO_P95_MS}`],
  'http_req_duration{name:payment_create}': [`p(95)<${SLO_P95_MS * 2}`],
  'http_req_duration{name:payment_create_derive}': [`p(95)<${SLO_P95_MS * 2}`],
  rate_limited_429: ['count<1'],
};
// Per-level thresholds make k6 keep per-level sub-metrics for the capacity table.
for (const level of HOLD_LEVELS) {
  thresholds[`http_req_duration{level:${level}}`] = [`p(95)<${SLO_P95_MS}`];
  thresholds[`http_req_waiting{level:${level}}`] = [`p(95)<${SLO_P95_MS}`];
  thresholds[`http_req_failed{level:${level}}`] = [`rate<${SLO_ERROR_RATE}`];
}

export const options = {
  scenarios,
  thresholds,
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  // Each VU keeps its own keep-alive connection, so 5k VUs ~= 5k open
  // connections at Apache — that's the concurrency being tested.
  noConnectionReuse: false,
  userAgent: 'k6-loadtest/payment-engine',
};

function track(res) {
  if (res.status === 429) rateLimited.add(1);
  if (res.status === 503) serverTimeouts.add(1);
  if (res.status >= 500) serverErrors.add(1);
  return res;
}

function signedPost(path, bodyObj, name) {
  const body = JSON.stringify(bodyObj);
  return track(http.post(`${BASE_URL}${path}`, body, {
    headers: signedHeaders(API_KEY, SECRET_KEY, 'POST', path, body),
    tags: { name, level: currentLevel() },
    timeout: '35s',
  }));
}

function get(path, name) {
  return track(http.get(`${BASE_URL}${path}`, { tags: { name, level: currentLevel() }, timeout: '20s' }));
}

function createRequestPayment() {
  // A "request" without crypto stops at status "created": exercises validation,
  // API-key lookup, receiver upsert, session insert and legacy sync, but does
  // NOT derive an HD address. Sandbox keys skip the NUBAN bank lookup.
  const res = signedPost('/v1/payments', {
    type: 'request',
    fiatAmount: 15000,
    fiatCurrency: 'NGN',
    receiver: { bankCode: '058', accountNumber: '0000000001', accountName: 'k6 Load Test' },
    metadata: { source: 'k6-loadtest' },
  }, 'payment_create');

  const ok = check(res, { 'create: 2xx': (r) => r.status >= 200 && r.status < 300 });
  return ok ? res.json('payment.reference') : null;
}

export function setup() {
  if (!API_KEY || !SECRET_KEY) {
    throw new Error('API_KEY and SECRET_KEY are required (use a pk_test_ sandbox key)');
  }
  if (!API_KEY.startsWith('pk_test_')) {
    throw new Error('Refusing to run with a live key — create a sandbox key (isSandbox: true)');
  }

  const health = http.get(`${BASE_URL}/v1/health`);
  if (health.status !== 200) {
    throw new Error(`Health check failed: ${health.status} ${health.body}`);
  }

  // Fixed pool of references for read-only sessions to poll.
  inSetup = true;
  const refs = [];
  for (let i = 0; i < SEED_REFS; i++) {
    const ref = createRequestPayment();
    if (ref) refs.push(ref);
  }
  if (refs.length === 0) {
    throw new Error('Could not create any seed payments — check the key permissions (payment:create)');
  }
  return { refs };
}

// One iteration = one user session: land on the page, look up rate + banks,
// optionally create a payment, then poll its status like the checkout UI does.
export function userSession(data) {
  const start = Date.now();

  group('landing', () => {
    check(get('/v1/rate', 'rate'), { 'rate: 200': (r) => r.status === 200 });
    check(get('/v1/banks/list?name=access', 'banks'), { 'banks: 200': (r) => r.status === 200 });
  });

  sleep(1 + Math.random() * 2);

  let reference = null;
  if (Math.random() < WRITE_RATIO) {
    group('create', () => {
      reference = createRequestPayment();
    });
  }
  if (!reference) {
    reference = data.refs[Math.floor(Math.random() * data.refs.length)];
  }

  group('poll', () => {
    for (let i = 0; i < 3; i++) {
      const res = get(`/v1/payments/${reference}`, 'payment_get');
      check(res, { 'poll: 200': (r) => r.status === 200 });
      sleep(3);
    }
  });

  sessionDuration.add(Date.now() - start);
  sleep(2 + Math.random() * 3);
}

export function deriveSession() {
  // Unique chatId -> no reusable owner wallet -> fresh HD derivation.
  const res = signedPost('/v1/payments', {
    type: 'transfer',
    fiatAmount: 15000,
    fiatCurrency: 'NGN',
    crypto: 'USDT',
    network: 'trc20',
    payer: { chatId: `k6-${__VU}-${__ITER}-${Date.now()}` },
    receiver: { bankCode: '058', accountNumber: '0000000001', accountName: 'k6 Load Test' },
    metadata: { source: 'k6-loadtest' },
  }, 'payment_create_derive');
  check(res, { 'derive: 2xx': (r) => r.status >= 200 && r.status < 300 });
}

function capacityReport(data) {
  if (HOLD_LEVELS.length < 2) return '';
  const val = (metric, stat) => {
    const m = data.metrics[metric];
    return m && m.values[stat] !== undefined ? m.values[stat] : null;
  };
  const pad = (s, n) => String(s).padStart(n);

  const lines = [
    '',
    `Capacity by concurrent sessions (SLO: p95 < ${SLO_P95_MS}ms, errors < ${(SLO_ERROR_RATE * 100).toFixed(1)}%)`,
    `${pad('sessions', 9)} ${pad('p95 total', 10)} ${pad('p95 wait', 9)} ${pad('errors', 7)} ${pad('reqs', 8)}  result`,
  ];
  let reliable = 0;
  let stillPassing = true;
  for (const level of HOLD_LEVELS) {
    const p95 = val(`http_req_duration{level:${level}}`, 'p(95)');
    const wait = val(`http_req_waiting{level:${level}}`, 'p(95)');
    const failRate = val(`http_req_failed{level:${level}}`, 'rate');
    const reqs = (val(`http_req_failed{level:${level}}`, 'passes') || 0)
      + (val(`http_req_failed{level:${level}}`, 'fails') || 0);

    if (!reqs) {
      stillPassing = false;
      lines.push(`${pad(level, 9)} ${pad('-', 10)} ${pad('-', 9)} ${pad('-', 7)} ${pad(0, 8)}  not reached`);
      continue;
    }
    const ok = p95 < SLO_P95_MS && failRate < SLO_ERROR_RATE;
    if (ok && stillPassing) reliable = level;
    if (!ok) stillPassing = false;
    lines.push(
      `${pad(level, 9)} ${pad(`${Math.round(p95)}ms`, 10)} ${pad(`${Math.round(wait)}ms`, 9)} ` +
      `${pad(`${(failRate * 100).toFixed(2)}%`, 7)} ${pad(reqs, 8)}  ${ok ? 'PASS' : 'FAIL'}`,
    );
  }
  const firstRan = (val(`http_req_failed{level:${HOLD_LEVELS[0]}}`, 'passes') || 0)
    + (val(`http_req_failed{level:${HOLD_LEVELS[0]}}`, 'fails') || 0);
  lines.push(
    reliable
      ? `\nReliable capacity: ${reliable} concurrent sessions (highest level where it and every level below passed)`
      : firstRan
        ? '\nReliable capacity: below the first level tested — lower LEVELS and rerun'
        : '\nNo level was held long enough to measure (run aborted early?)',
    '',
  );
  return lines.join('\n');
}

export function handleSummary(data) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }) + capacityReport(data),
    [`loadtest/results/${PROFILE}-${stamp}.json`]: JSON.stringify(data, null, 2),
  };
}
