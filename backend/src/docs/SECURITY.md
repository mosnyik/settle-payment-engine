# Payment Engine Security Guide

This document explains how to authenticate and interact with the Payment Engine API securely.

## Table of Contents

1. [Overview](#overview)
2. [Getting API Keys](#getting-api-keys)
3. [Authentication](#authentication)
4. [Signing Requests](#signing-requests)
5. [Rate Limiting](#rate-limiting)
6. [IP Whitelisting](#ip-whitelisting)
7. [Error Codes](#error-codes)
8. [Code Examples](#code-examples)
9. [Best Practices](#best-practices)

---

## Overview

The Payment Engine uses **API Key + HMAC Signature** authentication. Every authenticated request requires three headers:

| Header | Description | Example |
|--------|-------------|---------|
| `X-API-Key` | Your public API key ID | `pk_a1b2c3d4e5f6...` |
| `X-Timestamp` | Current Unix timestamp in milliseconds | `1708267200000` |
| `X-Signature` | HMAC-SHA256 signature of the request | `8f4a3b2c1d...` |

### Public Endpoints (No Auth Required)

These endpoints do not require authentication:

- `GET /health` - Health check
- `GET /rate/current` - Current exchange rates
- `GET /banks` - List of supported banks
- `GET /banks/:code` - Bank details lookup
- `GET /crypto/prices` - Cryptocurrency prices
- `GET /reports/lookup` - Look up complaint reports by phone/wallet
- `GET /reports/:reportId` - Get a single complaint report by ID

---

## Getting API Keys

### Creating an API Key

API keys are created by administrators. When created, you'll receive:

```json
{
  "apiKey": {
    "keyId": "pk_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
    "merchantId": "merchant_001",
    "name": "Production Key",
    "rateLimitTier": "standard",
    "permissions": ["transfer.*", "gift.*", "request.*", "report:create"]
  },
  "secretKey": "sk_1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y6z7a8b9c0d1e2f3"
}
```

> **IMPORTANT**: The `secretKey` is only shown once at creation. Store it securely. If lost, you must create a new API key.

### Key Components

- **Key ID (`pk_...`)**: Public identifier sent in `X-API-Key` header
- **Secret Key (`sk_...`)**: Used to sign requests, never sent over the network
- **Key Hash**: What's stored in the database (SHA-256 of secret key)

---

## Authentication

### Required Headers

```http
POST /transfer/save HTTP/1.1
Host: api.example.com
Content-Type: application/json
X-API-Key: pk_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
X-Timestamp: 1708267200000
X-Signature: 8f4a3b2c1d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2
```

### Timestamp Validation

- Timestamp must be within **5 minutes** of server time
- Use milliseconds since Unix epoch (January 1, 1970)
- Prevents replay attacks

---

## Signing Requests

### Signature Format

The signature is an HMAC-SHA256 hash of a specific payload format:

```
signature = HMAC-SHA256(keyHash, payload)

payload = timestamp + "|" + method + "|" + path + "|" + bodyHash

bodyHash = SHA256(requestBody)
```

### Step-by-Step Signing Process

1. **Get current timestamp** (milliseconds)
2. **Hash the request body** using SHA-256
3. **Build the signature payload**:
   ```
   {timestamp}|{METHOD}|{path}|{bodyHash}
   ```
4. **Generate HMAC-SHA256** using your key hash
5. **Add headers** to your request

### Example Payload Construction

For a POST request to `/transfer/save` with body `{"amount": 50000}`:

```
timestamp = 1708267200000
method = "POST"
path = "/transfer/save"
body = '{"amount":50000}'
bodyHash = SHA256('{"amount":50000}')
        = "a1b2c3d4e5f6..."

payload = "1708267200000|POST|/transfer/save|a1b2c3d4e5f6..."
signature = HMAC-SHA256(keyHash, payload)
```

### Important Notes

- Method must be **UPPERCASE** (`POST`, `GET`, etc.)
- Path should include leading slash (`/transfer/save`, not `transfer/save`)
- Body hash is computed on the **exact JSON string** sent (including whitespace)
- For requests without a body (GET, DELETE), use an empty object: `{}`

---

## Rate Limiting

### Rate Limit Tiers

| Tier | Requests per Minute | Use Case |
|------|---------------------|----------|
| `standard` | 100 | Default for new API keys |
| `premium` | 1,000 | High-volume merchants |
| `unlimited` | 10,000 | Enterprise integrations |

### Rate Limit Headers

Every response includes rate limit information:

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1708267260
```

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests per window |
| `X-RateLimit-Remaining` | Requests remaining in current window |
| `X-RateLimit-Reset` | Unix timestamp when the window resets |

### Rate Limit Exceeded Response

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 45
Content-Type: application/json

{
  "error": "Rate limit exceeded. Try again in 45 seconds.",
  "code": "RATE_LIMIT_EXCEEDED",
  "retryAfter": 45
}
```

---

## IP Whitelisting

API keys can optionally restrict access to specific IP addresses.

### Configuring IP Whitelist

When creating or updating an API key, provide an array of allowed IPs:

```json
{
  "ipWhitelist": [
    "203.0.113.10",
    "203.0.113.0/24",
    "2001:db8::1"
  ]
}
```

### Supported Formats

- Single IPv4: `192.168.1.100`
- IPv4 CIDR: `192.168.1.0/24`
- Single IPv6: `2001:db8::1`

### No Whitelist

If `ipWhitelist` is `null` or empty, requests are allowed from any IP.

---

## Error Codes

### Authentication Errors (401)

| Code | Description |
|------|-------------|
| `MISSING_API_KEY` | `X-API-Key` header not provided |
| `MISSING_TIMESTAMP` | `X-Timestamp` header not provided |
| `MISSING_SIGNATURE` | `X-Signature` header not provided |
| `INVALID_API_KEY` | API key not found or invalid |
| `API_KEY_INACTIVE` | API key has been deactivated |
| `API_KEY_EXPIRED` | API key has expired |
| `INVALID_TIMESTAMP` | Timestamp is not a valid number |
| `TIMESTAMP_EXPIRED` | Timestamp is outside the 5-minute window |
| `INVALID_SIGNATURE` | HMAC signature verification failed |

### Authorization Errors (403)

| Code | Description |
|------|-------------|
| `IP_NOT_ALLOWED` | Request IP not in API key's whitelist |
| `PERMISSION_DENIED` | API key lacks required permission |

### Rate Limit Errors (429)

| Code | Description |
|------|-------------|
| `RATE_LIMIT_EXCEEDED` | Too many requests in the time window |

---

## Code Examples

### Node.js / TypeScript

```typescript
import crypto from 'crypto';
import axios from 'axios';

const API_KEY_ID = 'pk_your_key_id';
const KEY_HASH = crypto.createHash('sha256')
  .update('sk_your_secret_key')
  .digest('hex');

async function makeAuthenticatedRequest(
  method: string,
  path: string,
  body?: object
) {
  const timestamp = Date.now();
  const bodyString = JSON.stringify(body || {});
  const bodyHash = crypto.createHash('sha256').update(bodyString).digest('hex');

  // Build signature payload
  const payload = `${timestamp}|${method.toUpperCase()}|${path}|${bodyHash}`;

  // Generate signature
  const signature = crypto
    .createHmac('sha256', KEY_HASH)
    .update(payload)
    .digest('hex');

  // Make request
  const response = await axios({
    method,
    url: `https://api.example.com${path}`,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY_ID,
      'X-Timestamp': timestamp.toString(),
      'X-Signature': signature,
    },
    data: body,
  });

  return response.data;
}

// Usage
const result = await makeAuthenticatedRequest('POST', '/transfer/save', {
  amount: 50000,
  currency: 'NGN',
  // ... other fields
});
```

### Python

```python
import hashlib
import hmac
import json
import time
import requests

API_KEY_ID = 'pk_your_key_id'
SECRET_KEY = 'sk_your_secret_key'
KEY_HASH = hashlib.sha256(SECRET_KEY.encode()).hexdigest()

def make_authenticated_request(method: str, path: str, body: dict = None):
    timestamp = int(time.time() * 1000)  # Milliseconds
    body_string = json.dumps(body or {}, separators=(',', ':'))
    body_hash = hashlib.sha256(body_string.encode()).hexdigest()

    # Build signature payload
    payload = f"{timestamp}|{method.upper()}|{path}|{body_hash}"

    # Generate signature
    signature = hmac.new(
        KEY_HASH.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()

    # Make request
    response = requests.request(
        method=method,
        url=f"https://api.example.com{path}",
        headers={
            'Content-Type': 'application/json',
            'X-API-Key': API_KEY_ID,
            'X-Timestamp': str(timestamp),
            'X-Signature': signature,
        },
        json=body,
    )

    return response.json()

# Usage
result = make_authenticated_request('POST', '/transfer/save', {
    'amount': 50000,
    'currency': 'NGN',
    # ... other fields
})
```

### cURL

```bash
#!/bin/bash

API_KEY_ID="pk_your_key_id"
SECRET_KEY="sk_your_secret_key"
KEY_HASH=$(echo -n "$SECRET_KEY" | sha256sum | cut -d' ' -f1)

METHOD="POST"
PATH="/transfer/save"
BODY='{"amount":50000,"currency":"NGN"}'

TIMESTAMP=$(date +%s%3N)
BODY_HASH=$(echo -n "$BODY" | sha256sum | cut -d' ' -f1)
PAYLOAD="${TIMESTAMP}|${METHOD}|${PATH}|${BODY_HASH}"
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$KEY_HASH" | cut -d' ' -f2)

curl -X $METHOD "https://api.example.com${PATH}" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY_ID" \
  -H "X-Timestamp: $TIMESTAMP" \
  -H "X-Signature: $SIGNATURE" \
  -d "$BODY"
```

### PHP

```php
<?php

$apiKeyId = 'pk_your_key_id';
$secretKey = 'sk_your_secret_key';
$keyHash = hash('sha256', $secretKey);

function makeAuthenticatedRequest($method, $path, $body = []) {
    global $apiKeyId, $keyHash;

    $timestamp = round(microtime(true) * 1000);
    $bodyString = json_encode($body ?: new stdClass());
    $bodyHash = hash('sha256', $bodyString);

    // Build signature payload
    $payload = "{$timestamp}|" . strtoupper($method) . "|{$path}|{$bodyHash}";

    // Generate signature
    $signature = hash_hmac('sha256', $payload, $keyHash);

    // Make request
    $ch = curl_init("https://api.example.com{$path}");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => strtoupper($method),
        CURLOPT_POSTFIELDS => $bodyString,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            "X-API-Key: {$apiKeyId}",
            "X-Timestamp: {$timestamp}",
            "X-Signature: {$signature}",
        ],
    ]);

    $response = curl_exec($ch);
    curl_close($ch);

    return json_decode($response, true);
}

// Usage
$result = makeAuthenticatedRequest('POST', '/transfer/save', [
    'amount' => 50000,
    'currency' => 'NGN',
    // ... other fields
]);
```

### Go

```go
package main

import (
    "bytes"
    "crypto/hmac"
    "crypto/sha256"
    "encoding/hex"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "strconv"
    "time"
)

const (
    apiKeyID  = "pk_your_key_id"
    secretKey = "sk_your_secret_key"
)

func getKeyHash() string {
    h := sha256.Sum256([]byte(secretKey))
    return hex.EncodeToString(h[:])
}

func makeAuthenticatedRequest(method, path string, body interface{}) (map[string]interface{}, error) {
    keyHash := getKeyHash()
    timestamp := time.Now().UnixMilli()

    bodyBytes, _ := json.Marshal(body)
    if body == nil {
        bodyBytes = []byte("{}")
    }

    // Hash body
    bodyHashBytes := sha256.Sum256(bodyBytes)
    bodyHash := hex.EncodeToString(bodyHashBytes[:])

    // Build payload
    payload := fmt.Sprintf("%d|%s|%s|%s", timestamp, method, path, bodyHash)

    // Generate signature
    mac := hmac.New(sha256.New, []byte(keyHash))
    mac.Write([]byte(payload))
    signature := hex.EncodeToString(mac.Sum(nil))

    // Create request
    req, _ := http.NewRequest(method, "https://api.example.com"+path, bytes.NewReader(bodyBytes))
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("X-API-Key", apiKeyID)
    req.Header.Set("X-Timestamp", strconv.FormatInt(timestamp, 10))
    req.Header.Set("X-Signature", signature)

    // Send request
    client := &http.Client{}
    resp, err := client.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()

    respBody, _ := io.ReadAll(resp.Body)
    var result map[string]interface{}
    json.Unmarshal(respBody, &result)

    return result, nil
}
```

---

## Best Practices

### Security

1. **Never expose your secret key** - Only use it server-side
2. **Store keys securely** - Use environment variables or a secrets manager
3. **Rotate keys periodically** - Create new keys and deprecate old ones
4. **Use IP whitelisting** - Restrict API access to known servers
5. **Monitor audit logs** - Track all API activity for anomalies

### Implementation

1. **Handle clock skew** - Ensure your server time is synchronized (use NTP)
2. **Implement retry logic** - Handle transient failures gracefully
3. **Respect rate limits** - Check `X-RateLimit-Remaining` before making requests
4. **Use exponential backoff** - When rate limited, wait before retrying
5. **Verify signatures on webhooks** - Always validate incoming webhook signatures

### Debugging

If you receive `INVALID_SIGNATURE` errors:

1. **Check timestamp** - Must be within 5 minutes and in milliseconds
2. **Verify payload format** - `timestamp|METHOD|path|bodyHash`
3. **Match body exactly** - The hashed body must match what's sent
4. **Use correct key hash** - SHA-256 of your secret key (not the key itself)
5. **Check method case** - Must be uppercase (`POST`, not `post`)

---

## Request ID Tracking

Every request is assigned a unique `X-Request-ID` header in the response:

```http
X-Request-ID: 550e8400-e29b-41d4-a716-446655440000
```

Use this ID when:
- Contacting support about specific requests
- Correlating logs between client and server
- Debugging webhook deliveries

You can also provide your own request ID in the request headers, and it will be echoed back.

---

## Audit Logging

All authenticated requests are logged with:
- Timestamp
- API key used
- Merchant ID
- Request method and path
- Client IP address
- Response status
- Response time

Contact support to access your audit logs.
