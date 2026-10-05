import crypto from 'k6/crypto';

// Mirrors src/security/services/hmac.service.ts:
//   payload   = `${timestamp}|${METHOD}|${path}|${sha256(body)}`
//   hmacKey   = sha256(secretKey)
//   signature = hmac_sha256(hmacKey, payload)
// The server hashes JSON.stringify(req.body || {}), so GETs sign "{}".
export function signedHeaders(apiKey, secretKey, method, path, body) {
  const bodyString = body === undefined ? '{}' : body;
  const timestamp = Date.now().toString();
  const bodyHash = crypto.sha256(bodyString, 'hex');
  const payload = `${timestamp}|${method.toUpperCase()}|${path}|${bodyHash}`;
  const hmacKey = crypto.sha256(secretKey, 'hex');

  return {
    'Content-Type': 'application/json',
    'X-API-Key': apiKey,
    'X-Timestamp': timestamp,
    'X-Signature': crypto.hmac('sha256', hmacKey, payload, 'hex'),
  };
}
