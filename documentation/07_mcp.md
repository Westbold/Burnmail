# Burnmail MCP

Connect a Streamable HTTP client to `${API_BASE_URL}/mcp`, with authentication set to
**None**. This endpoint is served only on the configured `API_HOSTNAME`. Local development
without that setting permits localhost/loopback. There is no OAuth, MCP API key, cookie,
session ID, remembered inbox, subscription, or background polling process.

## Boundary and architecture

```text
handleHttp -> mcp/index.ts -> MCP SDK -> mcp/tools.ts -> app.fetch -> existing REST -> D1
```

`src/mcp/index.ts` owns HTTP transport, Host/Origin checks, request size and request rate
limits. `src/mcp/tools.ts` owns the nine tool definitions and adapts their arguments/results.
Each request creates its own SDK handler/server and closures. Only the existing mailbox
business data persists in D1; edge abuse counters are not MCP sessions.

`app.fetch` dispatches in-process: there is no network proxy, configurable upstream URL,
duplicate SQL, new storage, or parallel authorization implementation. REST routes, inbound
email handling, scheduled retention, webmail and the D1 schema are shared. Removing the
single `/mcp` routing hook disconnects the adapter.

Only `@modelcontextprotocol/server` is added as a runtime dependency. Zod is updated to the
SDK's compatible v4 line and Wrangler to 4.36.0 for stable rate-limit bindings. No Agents
framework, Durable Object, Node compatibility flag or separate deployment is required.

## Mailbox credentials still apply

**No MCP authentication does not make mailboxes public.** `create_inbox` generates a
random address and a 256-bit key and returns `result.email_address` and `result.claim_key`.
The existing claim endpoint hashes that key before storing it. Save both client-side and
include them in each subsequent tool call; the server cannot recover the key. The HTTP
`Authorization` header is neither required nor inherited as a mailbox credential.

Existing REST/webmail inboxes work with their existing address/key. No global mailbox-list
or administrator tool is exposed. An email ID alone never authorizes reading or deletion.
Message tools also check that the ID belongs to the supplied address, even when two
mailboxes share the same key.

Keys are full-access credentials. Tool histories may retain them. The MCP adapter does not
log tool arguments, bodies, or keys; it redacts unexpected/internal error details. Responses
have `Cache-Control: no-store`. Never put credentials in the MCP endpoint URL.

## Tools

| Tool | Arguments beyond optional fields | Behavior |
| --- | --- | --- |
| `list_domains` | None | Runtime receiving-domain allowlist |
| `create_inbox` | Optional `domain`, `prefix` | Claim a random address; return address/key |
| `list_messages` | `email_address`, `claim_key`; optional `limit`, `offset` | Summaries, newest first; limit 1–100, default 10 |
| `read_message` | `email_address`, `claim_key`, `message_id` | Full stored message; no read-state mutation |
| `count_messages` | `email_address`, `claim_key` | Current message count |
| `delete_message` | `email_address`, `claim_key`, `message_id` | Delete one message |
| `clear_inbox` | `email_address`, `claim_key` | Delete messages, retain claim |
| `release_inbox` | `email_address`, `claim_key` | Delete messages and release address |
| `reconcile_inbox` | `email_address`, `claim_key`, `since`; optional `limit`, `offset` | Full messages oldest first; limit 1–25, default 20 |

`prefix` is 1–24 lowercase letters/digits/underscores/hyphens, beginning with a letter or
digit. A random suffix is always appended. `since` is an inclusive Unix timestamp in
**seconds**. Pagination offsets default to zero. Reconciliation retains the existing
`data`, `hasNext`, and `links.next` shape: repeat the tool with the same `since`/`limit` and
advance `offset`. Overlap scans and deduplicate message IDs; pagination is not a snapshot.

Tool results include both text JSON and matching `structuredContent`, preserving Burnmail's
`success`/`result` envelope and a declared output schema. Business failures set `isError: true`
and return `status` plus `error: { code, name, message, retryable }`. Stable codes distinguish
`FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `RATE_LIMITED` (429), and service errors
(500/503). Only rate-limit/server failures are retryable. Internal failure details are redacted.
These are MCP tool results, not JSON-RPC invalid-argument errors. Some host integrations may
still wrap tool errors as `INVALID_ARGUMENT`; clients should inspect the embedded status/code.

Clearing an authorized empty inbox succeeds with `deleted_count: 0`, including repeated clears.
Unknown/unclaimed addresses still fail authorization. Reading/deleting a missing message or
releasing an already-released claim returns `NOT_FOUND`; an old key cannot release a new claim.
List ordering is `received_at DESC, id DESC`; reconciliation is `received_at ASC, id ASC`.

Read/create/delete annotations describe real side effects. Destructive hints remain enabled
for deletion, clearing, and release. Client-side approval/safety blocks occur before the Worker
and cannot be disabled by a server fix.

There is no send, attachment, autonomous wait, or webhook-configuration tool. Email content
is untrusted data; the server never follows links or loads remote images.

## Typical use

1. Discover domains and call `create_inbox` **before** sending mail to the returned address.
2. Save its address/key. Poll `list_messages`, then use `read_message` for selected IDs.
3. Call `release_inbox` when finished; use `clear_inbox` only to keep the address claimed.

Creation is deliberately non-idempotent: a retry generates a different inbox. A lost creation
response may leave an inaccessible claim. There is no key-recovery or server-side client
credential registry. Claims do not expire; messages retain Burnmail's existing three-hour
cleanup threshold (cleanup runs every two hours, not exactly at expiration).

## Transport and abuse limits

The SDK handles current stateless MCP (2026-07-28) and legacy stateless HTTP clients (2025
revisions). Each call is independent. GET/DELETE session operations return 405; same-origin
OPTIONS preflight is supported. Modern clients must send the standard version, method,
name and request-metadata fields; use an MCP SDK to construct them. CORS permits the modern
MCP headers. Absent Origin is accepted; a present Origin must match the request origin exactly.
Unconfigured public hosts, webmail/wildcard hosts and mismatched Host headers are rejected.

`wrangler.jsonc` supplies two edge rate-limit bindings: `MCP_REQUEST_LIMIT` (120 requests per
60 seconds) and `MCP_CREATE_LIMIT` (10 creation attempts per 60 seconds). Counters use the
Cloudflare-provided client IP, never a caller-selected mailbox/key or X-Forwarded-For. IPs
behind one proxy/NAT share a quota. Limits are approximate and per Cloudflare location,
not strict global accounting. Keep binding namespace IDs distinct from other account limits.

Missing bindings fail closed (503). Transport throttling returns HTTP 429 with Retry-After;
creation throttling is a tool error with status 429. POST bodies are limited to 16 KiB,
including bodies without Content-Length. These controls cover `/mcp`; they do not change
or claim to harden the pre-existing public REST API.

## Verification and deployment

Run `bun install --frozen-lockfile`, `bun test`, `bun run tsc`, `bun run check`, and
`bun run deploy --dry-run --outdir dist`. MCP tests exercise the real REST routes against an
in-memory SQLite database, including a fixture MIME message through the inbound handler.
They cover protocol versions, concurrent request isolation, every tool, authorization,
pagination (including timestamp ties), empty-clear retries, destruction, MIME/Unicode, large
bodies, retention, concurrent mutations, malformed input and HTTP/rate-limit boundaries.

The standard post-deploy smoke check also runs `scripts/mcp-smoke.ts`. To run just MCP checks,
set `API_BASE_URL` privately and run `bun run smoke:mcp`. It exercises all nine tools, verifies
typed 403/404 results and empty-clear retries, and removes its own random test inbox. It never
logs credentials or deletes pre-existing inboxes. Single-message success and nonempty pagination
are covered by SQLite/MIME integration tests, not this empty-inbox production smoke check.

Use the existing Cloudflare Builds deployment path after review. No database migration is
needed. Do not run the repository's remote `bun run dev` against production for MCP tests;
use `wrangler dev --local` and a local fixture database. A local test or a successful build
does not prove that production DNS/email delivery or an external MCP client has been verified.
