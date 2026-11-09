/**
 * Google Login Test Page
 * Serves a local page for testing POST /v1/users/auth/google end to end.
 *
 * The page is served on its own origin (Google Sign-In only works from an
 * http(s) origin listed under "Authorized JavaScript origins"), and API calls
 * are proxied through /v1/* so CORS_ORIGIN doesn't need to change.
 *
 * Usage:
 *   pnpm test:google-login
 *   # then open http://localhost:5500 (add it to the OAuth client's origins)
 *
 * Env: GOOGLE_CLIENT_ID (from .env), GOOGLE_TEST_PORT (default 5500),
 *      GOOGLE_TEST_API_URL (default http://localhost:<PORT or 3500>)
 */

// Same .env the app loads (payment-engine/.env, one level above backend/)
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '..', '.env') });

const fs = require('fs');
const http = require('http');
const path = require('path');

const PORT = Number(process.env.GOOGLE_TEST_PORT || 5500);
const API_URL = new URL(process.env.GOOGLE_TEST_API_URL || `http://localhost:${process.env.PORT || 3500}`);
const CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').split(',')[0].trim();
const PAGE = path.join(__dirname, 'index.html');

function proxy(req, res) {
  const upstream = http.request(
    {
      hostname: API_URL.hostname,
      port: API_URL.port || 80,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: API_URL.host },
    },
    (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      upRes.pipe(res);
    }
  );
  upstream.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: `API unreachable at ${API_URL.origin}: ${err.code || err.message} - is pnpm dev running?` }));
  });
  req.pipe(upstream);
}

http
  .createServer((req, res) => {
    if (req.url.startsWith('/v1/')) return proxy(req, res);

    if (req.url === '/config.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ clientId: CLIENT_ID, apiUrl: API_URL.origin }));
    }

    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(PAGE).pipe(res);
    }

    res.writeHead(404);
    res.end();
  })
  .listen(PORT, () => {
    console.log(`Google login test page: http://localhost:${PORT}`);
    console.log(`Proxying /v1/* -> ${API_URL.origin}`);
    if (!CLIENT_ID) console.warn('GOOGLE_CLIENT_ID is not set in .env - you can paste one into the page instead');
  });
