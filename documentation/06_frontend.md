# Static inbox frontend

The browser client is mounted at `/app/` on the **same origin as the existing API**.
It uses Cloudflare Workers Static Assets, not a second Cloudflare Pages project.
HTML, CSS, and browser JavaScript are static files. Only API calls execute the
existing Hono Worker. There is no SSR, frontend server, Pages Function, proxy, or
new authentication service.

## Mount and routing

```text
Existing deployment origin
  /app/                 public/app/index.html (static)
  /app/styles.css       static stylesheet
  /app/app.js           static browser UI
  /app/api.js           static API client
  /                     existing API documentation (Worker)
  /swagger              existing Swagger UI (Worker)
  /openapi.json         existing OpenAPI document (Worker)
  /domains              public runtime domain allowlist (Worker)
  /claims/*             existing claim API (Worker)
  /emails/*             existing list/count/delete API (Worker)
  /inbox/*              existing message API (Worker)
  /health               existing health endpoint (Worker)
```

`wrangler.jsonc` adds `assets.directory = "./public"`. API and documentation paths
are explicitly Worker-first; `/app/` and its assets are asset-first. No `ASSETS`
binding is necessary because Worker code does not fetch or transform the files.

There is deliberately **no global SPA fallback**: `not_found_handling` is `none`.
Unknown API URLs and missing JavaScript files must not become a 200 HTML app shell.
The client has no nested path router. `/app` uses Cloudflare's default directory
normalization to `/app/`. Existing `/` documentation is neither moved nor replaced.
Do not add a `public/index.html` or a global rewrite to the inbox shell.

See Cloudflare's [Static Assets documentation](https://developers.cloudflare.com/workers/static-assets/),
[Worker-first routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/),
and [static response headers](https://developers.cloudflare.com/workers/static-assets/headers/).

## Client behavior

- Enter a full mailbox address and its claim key to open an existing inbox.
- Generate a 32-byte random key and explicitly choose **Claim & open** to claim a
  new address. Opening an inbox never implicitly creates a claim.
- List 20 messages per page, read a message, and confirm before deleting it.
- Auto-refresh every 15 seconds only on the newest page while the tab is visible.
  Concurrent list requests are suppressed. Authorization/not-found failures pause
  polling; Refresh retries it. Requests time out after 15 seconds.
- Copy an address or access link. Closing clears client state without deleting
  messages or releasing the mailbox claim.

All paths in `api.js` are root-relative, not relative to `/app/`. Requests use the
existing `Authorization: Bearer <claim-key>` protocol and unwrap the API's
`{ success, result }` envelope. The UI does not require an API hostname, CORS change,
new secret, or build-time domain substitution. Receiving domains are fetched from
`GET /domains`. No live receiving domain or deployment hostname belongs in Git.

## Access links and message safety

An existing claimed inbox can be opened with a link shaped like:

```text
/app/#email=recipient%40example.test&key=YOUR_CLAIM_KEY
```

Use `URLSearchParams` to encode both fields. The browser consumes the fragment,
removes it from the current history entry, and opens the inbox with a GET request.
It does not PUT a claim. The key is sent to the API in the Authorization header,
not in a query string. Fragments are not part of HTTP requests, but the copied
link remains a bearer credential and must be kept private.

**An access link grants the key's full existing API authority, including deletion
and claim release. It is not a read-only or expiring share link.** A scoped viewer
link would require new backend authorization behavior; it cannot be enforced by
hiding buttons in a static page.

Credentials are held in page memory, not cookies or local/session storage. Reloading
or closing requires reopening the saved link or supplying the original key. There
is no recovery service. Do not lose the key after claiming an address.

Message text, subjects, and addresses are inserted using `textContent`. HTML-only
messages show their source as text; HTML is not rendered. This intentionally
avoids scripts, remote tracking images, forms, and active email content in v0.
`public/_headers` restricts the client to same-origin scripts, styles, and API
requests, disables framing and referrers, and revalidates static assets. These
headers apply to assets, not to Worker-generated API/docs responses. API fetches
use `cache: "no-store"`; the client does not introduce server-side caching.

## Build, test, and deployment

There is no frontend build command and no new dependency. The files in `public/`
are the deployable frontend. The existing `scripts/deploy.ts` preserves the asset
configuration and writes its temporary Wrangler config beside the source config,
so the relative asset path remains correct.

```bash
bun install --frozen-lockfile
bun test
bun run tsc
bun run check
bun run deploy --dry-run --outdir dist
```

The frontend helper/config tests can also run without installing packages:

```bash
node --test tests/frontend.test.js
```

For isolated local development, copy `.dev.vars.example` to `.dev.vars`, initialize
the local D1 schema, and use local Wrangler mode:

```bash
bunx wrangler d1 execute temp-mail-d1 --local --file ./sql/schema.sql
bunx wrangler d1 execute temp-mail-d1 --local --file ./sql/indexes.sql
bunx wrangler dev --local
```

Visit `/app/` on the origin printed by Wrangler. The existing `bun run dev` script
uses **remote** mode, so do not use it expecting an isolated database.

Production still uses Cloudflare Builds and `bun run deploy`. No new Pages
project, DNS record, mail route, D1 database, or runtime secret is needed. Deploy
from source with `public/` present; a Worker JavaScript bundle alone is not a
complete static-assets deployment. Merge/deploy is separate from opening a PR.

After deployment, verify `/app/` and its scripts return their expected content
and security headers, `/` still shows API docs, `/domains` still returns JSON,
an invalid API URL does not return the inbox shell, and an existing test claim
can list/read/delete mail through the UI. Do not claim live end-to-end delivery
based only on mocked client tests or a successful Worker bundle.
