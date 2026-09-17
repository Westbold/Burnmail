# Testing

## Credential-free checks

```bash
bun install --frozen-lockfile
bun test
bun run tsc
bun run check
bun run deploy --dry-run --outdir dist
```

The test suite uses reserved fixture domains and in-memory database doubles. It exercises
claims, bearer-key hashing, access control, claim release, webhook signatures, unclaimed
mail discard, runtime domain parsing, per-environment isolation, and missing-config denial.
Dry-run builds do not require a live hostname or Cloudflare credential.

## Live smoke test

Set `API_BASE_URL` privately, then run `bun run smoke`. Alternatively, provide `API_HOSTNAME`
as a private environment variable. The script checks HTTPS, D1 health, the runtime domain
allowlist, public MX records, and same-origin OpenAPI documentation. When `EMAIL_DOMAINS`
is provided, the returned allowlist must match that private expected value.

It then creates a random temporary claim, exercises correct/missing/wrong-key authorization,
checks idempotency and competing claims, and deletes the test claim in a cleanup block.
Recipient addresses, bearer keys, and API response bodies are not logged.

Real deployments run this script automatically after upload. The optional GitHub
**Production Smoke Test** workflow reads the deployment URL from an Actions secret named
`SMOKE_BASE_URL`; it never contains a hostname in YAML. Without that secret, use the
Cloudflare post-deploy check or run the script from a privately configured shell.

A failure after deployment does not roll back the Worker automatically. Inspect private
Cloudflare logs and use [the verification checklist](05_pending_verification.md).

## External delivery is a separate check

Smoke tests do not send external email. Claim an address, send a unique message from an
independent mailbox, and verify the subject and body through the authenticated inbox API.
Release the test claim after checking. Never treat a green build or health endpoint as
proof of external SMTP delivery.

## Webhook verification

Verify `X-Webhook-Signature` against the exact received UTF-8 request body using HMAC-SHA512
and the shared webhook secret. Do not parse and reserialize JSON before checking its
signature. Use constant-time signature comparison in the webhook consumer.
