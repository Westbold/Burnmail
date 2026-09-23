# Burnmail webmail

## Host routing

The private `APP_HOSTNAME` serves the static inbox at `/`. The private `API_HOSTNAME`
continues to serve API docs at `/`, Swagger at `/swagger`, and OpenAPI at `/openapi.json`.
The private `ROOT_HOSTNAME` apex and its other subdomains redirect to the app root.
Unknown paths on the app/API do not get a global SPA fallback.

The header's **API docs** link uses `/api-docs`. The Worker sends it to the configured
API origin without propagating query parameters or login credentials. Existing `/app/`
links redirect to the app root. All browser API calls remain same-origin.

The Worker runs before asset handling for host routing and URL credential cleanup.
Its `ASSETS` binding serves the files in `public/`; the UI remains static HTML/CSS/JS.
The app root internally serves `public/app/index.html`. Script/style paths remain `/app/*`.
The existing API, D1 database, mail routing, and claim permissions are unchanged.

## URL login

An existing inbox opens with either `/?email=recipient%40example.test&key=YOUR_KEY`
or `/#email=recipient%40example.test&key=YOUR_KEY`. Use `URLSearchParams` to encode the
values rather than concatenating them. Query credentials take precedence when present;
incomplete query values are not combined with a fragment's values. Duplicates are rejected.

Query credentials are redirected to a fragment before the HTML is served. Responses
use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. The browser removes
credentials from the current URL/history entry before starting API calls, keeps them
only in memory, and uses the original bearer-header API. It never creates a claim from
a link. Opening fails for unclaimed inboxes or incorrect keys.

A query link still sends credentials in the initial HTTPS request and can be retained
in upstream logs or external history. Worker query-string log redaction is enforced by
the deployment script. The **Copy access link** button produces fragment links by default.
Both link forms grant full existing mailbox authority; neither is read-only or expiring.

## Client behavior and safety

Claiming requires an explicit **Claim & open** action. Generate a key and save it first.
Credentials are never saved in cookies or local/session storage. Closing/reloading requires
supplying the original key or link. Closing the UI does not release the address claim.

Messages are listed 20 per page. Auto-refresh runs every 15 seconds on the first page
while visible. Authorization errors pause polling. Text and HTML-source bodies are
rendered with `textContent`, not executable markup. Deletion asks for confirmation.

## Deployment

No frontend build dependency or separate Pages project is needed. `scripts/deploy.ts`
generates routes from private settings: app/API/apex custom domains plus a wildcard
Worker route. A proxied wildcard DNS record is required for unknown subdomains. Existing
specific DNS entries take precedence; this does not route incoming email for extra domains.
Standard zone TLS covers the apex and one-level subdomains, not arbitrary nested names.

The registered Worker name and D1 identifiers stay unchanged; the product is Burnmail.
Production deployment runs API/DNS checks plus webmail assets, branding, docs target,
apex/wildcard redirects, and query-credential cleanup checks. Unit tests cover routing,
query/fragment parsing, malformed links, and preserved API behavior.

Use `bun test`, `bun run tsc`, `bun run check`, and `bun run deploy --dry-run --outdir dist`.
Set runtime secrets and private build settings before a real deploy. Live domains and
hostname values must never be added to source, examples, tests, or documentation.
