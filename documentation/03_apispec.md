# Burnmail API Specification

The Worker exposes JSON REST endpoints through Hono and publishes generated OpenAPI
documentation at:

- `GET /openapi.json`
- `GET /swagger`
- `GET /`

All successful API responses use:

```json
{
  "success": true,
  "result": {}
}
```

Error responses use:

```json
{
  "success": false,
  "error": {
    "name": "ErrorName",
    "message": "Error message"
  }
}
```

## Authorization

Claim, email, and inbox endpoints require:

```text
Authorization: Bearer <claim-key>
```

The Worker stores a SHA-256 hash of the bearer key. The original key is never stored.

Claims are permanent and do not expire. A claim can be released only with the same bearer key
that created it.

Public endpoints:

- `GET /domains`
- `GET /health`
- `GET /openapi.json`
- `GET /swagger`
- `GET /`

## Claims

### Claim Address

```http
PUT /claims/{emailAddress}
Authorization: Bearer <claim-key>
```

Creates a permanent claim for a supported email address.

Status codes:

- `200`: address claimed, or already claimed with the same key
- `400`: invalid email path parameter
- `401`: missing or invalid Authorization header
- `404`: unsupported domain
- `409`: address already claimed by a different key

Response:

```json
{
  "success": true,
  "result": {
    "message": "Address claimed successfully",
    "email_address": "recipient@example.test"
  }
}
```

### Release Address Claim

```http
DELETE /claims/{emailAddress}
Authorization: Bearer <claim-key>
```

Deletes all stored email for the address, then removes the claim.

Status codes:

- `200`: claim released and address email data deleted
- `400`: invalid email path parameter
- `401`: missing or invalid Authorization header
- `403`: bearer key does not match the claim
- `404`: unsupported domain or claim not found

Response:

```json
{
  "success": true,
  "result": {
    "message": "Claim released successfully",
    "deleted_count": 2
  }
}
```

## Emails

### List Emails for Address

```http
GET /emails/{emailAddress}?limit=10&offset=0
Authorization: Bearer <claim-key>
```

Returns email summaries for a claimed address.

Query parameters:

- `limit`: optional, default `10`, minimum `1`, maximum `100`
- `offset`: optional, default `0`, minimum `0`

Status codes:

- `200`: emails returned
- `400`: invalid parameter
- `401`: missing or invalid Authorization header
- `403`: bearer key does not match the claim
- `404`: unsupported domain or claim not found

Response:

```json
{
  "success": true,
  "result": [
    {
      "id": "usm2sw0qfv9a5ku9z4xmh8og",
      "from_address": "sender@example.com",
      "to_address": "recipient@example.test",
      "subject": "Welcome to our service",
      "received_at": 1753317948
    }
  ]
}
```

### Count Emails for Address

```http
GET /emails/count/{emailAddress}
Authorization: Bearer <claim-key>
```

Status codes:

- `200`: count returned
- `400`: invalid parameter
- `401`: missing or invalid Authorization header
- `403`: bearer key does not match the claim
- `404`: unsupported domain or claim not found

Response:

```json
{
  "success": true,
  "result": {
    "count": 5
  }
}
```

### Delete Emails for Address

```http
DELETE /emails/{emailAddress}
Authorization: Bearer <claim-key>
```

Deletes stored email for the claimed address but keeps the claim.

Status codes:

- `200`: emails deleted
- `400`: invalid parameter
- `401`: missing or invalid Authorization header
- `403`: bearer key does not match the claim
- `404`: unsupported domain, claim not found, or no emails found

Response:

```json
{
  "success": true,
  "result": {
    "message": "Emails deleted successfully",
    "deleted_count": 2
  }
}
```

## Inbox

### Get Email by ID

```http
GET /inbox/{emailId}
Authorization: Bearer <claim-key>
```

The bearer key must match the claim for the email recipient.

Status codes:

- `200`: email returned
- `400`: invalid email ID
- `401`: missing or invalid Authorization header
- `403`: bearer key does not match the recipient claim
- `404`: email not found

Response:

```json
{
  "success": true,
  "result": {
    "id": "usm2sw0qfv9a5ku9z4xmh8og",
    "from_address": "sender@example.com",
    "to_address": "recipient@example.test",
    "subject": "Welcome to our service",
    "received_at": 1753317948,
    "html_content": "<p>Hello world</p>",
    "text_content": "Hello world"
  }
}
```

### Delete Email by ID

```http
DELETE /inbox/{emailId}
Authorization: Bearer <claim-key>
```

The bearer key must match the claim for the email recipient.

Status codes:

- `200`: email deleted
- `400`: invalid email ID
- `401`: missing or invalid Authorization header
- `403`: bearer key does not match the recipient claim
- `404`: email not found

Response:

```json
{
  "success": true,
  "result": {
    "message": "Email deleted successfully"
  }
}
```

## Domains

The allowlist comes from the `EMAIL_DOMAINS` Worker secret. The addresses below are reserved
examples, not production configuration. A missing allowlist returns an empty list.

### List Supported Domains

```http
GET /domains
```

Public endpoint. Returns supported domains.

Response:

```json
{
  "success": true,
  "result": ["example.test", "mail.example.test"]
}
```

## Health

### Health Check

```http
GET /health
```

Public endpoint. Returns service health status.

## Inbound Email Behavior

Cloudflare Email Routing invokes the Worker for inbound email. The Worker checks the runtime domain allowlist and recipient
claim before parsing the raw message:

- Claimed recipient: parse email, store it in D1, then optionally forward it to the webhook.
- Unsupported domain or unclaimed recipient: discard the message. It is not parsed, stored, or forwarded.

Incoming attachments are ignored.

## Webhook Delivery

Webhook forwarding is enabled only when both `WEBHOOK_URL` and `WEBHOOK_SECRET` are configured.
The Worker sends one request per stored email:

```http
POST <WEBHOOK_URL>
Content-Type: application/json
X-Webhook-Signature: HMAC-SHA512=<base64_hmac_sha512_of_body>
```

The signature is an HMAC-SHA512 over the exact UTF-8 JSON request body using `WEBHOOK_SECRET`.

Payload:

```json
{
  "id": "usm2sw0qfv9a5ku9z4xmh8og",
  "from_address": "sender@example.com",
  "to_address": "recipient@example.test",
  "subject": "Welcome to our service",
  "received_at": 1753317948,
  "html_content": "<p>Hello world</p>",
  "text_content": "Hello world"
}
```

Webhook failures are logged but do not reject or delete stored email. Webhooks are centralized
and are not authenticated with per-address claim keys.
