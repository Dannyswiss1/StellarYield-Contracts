# StellarYield Webhooks

This document describes the webhook system for receiving real-time notifications about vault and yield events.

## Webhook Event Types

The following events are supported:

- `deposit` - User deposits funds into a vault
- `withdraw` - User withdraws funds from a vault
- `yield_distributed` - Yield is distributed for an epoch
- `vault_state_changed` - Vault transitions between lifecycle states
- `vault.matured` - Vault reaches maturity date
- `vault_created` - New vault is deployed

## Webhook Payload Schema

All webhooks use a common envelope structure:

```json
{
  "event": "deposit",
  "contractId": "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K",
  "timestamp": 1719417600000,
  "payload": {
    "user": "GBXXL...",
    "amount": "1000000000",
    "shares": "1000000000"
  }
}
```

### Event Payloads

#### `deposit`
```json
{
  "event": "deposit",
  "contractId": "CBQHN...",
  "timestamp": 1719417600000,
  "payload": {
    "user": "GBXXL...",
    "amount": "1000000000",
    "shares": "1000000000"
  }
}
```

#### `withdraw`
```json
{
  "event": "withdraw",
  "contractId": "CBQHN...",
  "timestamp": 1719417600000,
  "payload": {
    "user": "GBXXL...",
    "amount": "500000000",
    "shares": "500000000"
  }
}
```

#### `yield_distributed`
```json
{
  "event": "yield_distributed",
  "contractId": "CBQHN...",
  "timestamp": 1719417600000,
  "payload": {
    "epoch": 1,
    "total_yield": "50000000",
    "total_shares": "10000000000"
  }
}
```

#### `vault_state_changed`
```json
{
  "event": "vault_state_changed",
  "contractId": "CBQHN...",
  "timestamp": 1719417600000,
  "payload": {
    "new_state": "Active"
  }
}
```

#### `vault.matured`
```json
{
  "event": "vault.matured",
  "contractId": "CBQHN...",
  "timestamp": 1719417600000,
  "payload": {}
}
```

#### `vault_created`
```json
{
  "event": "vault_created",
  "contractId": "CBQHN...",
  "timestamp": 1719417600000,
  "payload": {
    "asset_address": "CDLZFC...",
    "admin": "GBXXL...",
    "expected_apy": 500,
    "maturity_date": 1735689600,
    "funding_deadline": 1720022400,
    "min_deposit": "100000000",
    "max_deposit": "10000000000"
  }
}
```

## Signature Verification

All webhook requests include an HMAC-SHA256 signature in the `X-StellarYield-Signature` header. Verify this signature to ensure the webhook is authentic.

### Verification Steps

1. Extract the signature from the `X-StellarYield-Signature` header
2. Compute HMAC-SHA256 of the raw request body using your webhook secret
3. Compare the computed signature with the received signature using constant-time comparison

### Node.js Example

```javascript
const crypto = require('crypto');

function verifyWebhook(payload, signature, secret) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

app.post('/webhook', (req, res) => {
  const signature = req.headers['x-stellaryield-signature'];
  const payload = JSON.stringify(req.body);
  const secret = process.env.WEBHOOK_SECRET;
  
  if (!verifyWebhook(payload, signature, secret)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  console.log('Received event:', req.body.event);
  res.status(200).json({ received: true });
});
```

### Python Example

```python
import hmac
import hashlib

def verify_webhook(payload, signature, secret):
    expected_signature = hmac.new(
        secret.encode('utf-8'),
        payload.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    
    return hmac.compare_digest(signature, expected_signature)

@app.route('/webhook', methods=['POST'])
def webhook():
    signature = request.headers.get('X-StellarYield-Signature')
    payload = request.get_data(as_text=True)
    secret = os.environ.get('WEBHOOK_SECRET')
    
    if not verify_webhook(payload, signature, secret):
        return {'error': 'Invalid signature'}, 401
    
    event = request.json
    print(f"Received event: {event['event']}")
    return {'received': True}, 200
```

## Best Practices

- Always verify the signature before processing webhook events
- Use constant-time comparison to prevent timing attacks
- Respond with HTTP 200 within 5 seconds to prevent retries
- Process webhooks asynchronously to avoid blocking the response
- Store webhook secrets securely in environment variables
- Log all webhook events for debugging and audit purposes
