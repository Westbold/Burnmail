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
credentials from the current URL/history entry before starting API calls, uses the original bearer-header API, and remembers successful logins in device-local IndexedDB. It never creates a claim from
a link. Opening fails for unclaimed inboxes or incorrect keys.

A query link still sends credentials in the initial HTTPS request and can be retained
in upstream logs or external history. Worker query-string log redaction is enforced by
the deployment script. The **Copy access link** button produces fragment links by default.
Both link forms grant full existing mailbox authority; neither is read-only or expiring.

## Client behavior and safety

Claiming requires an explicit **Claim & open** action. Generate a key and save it first.
Successful logins and newly created claims are remembered in IndexedDB in this browser
profile. Closing the UI retains the remembered entry; refreshing lists saved mailboxes
without opening or checking any of them. Login performs the existing authenticated read
only for the selected mailbox. New / other mailbox always keeps manual login and claiming
available. Cookies, localStorage, sessionStorage, and server-side sync are not used.

Messages are listed 20 per page. Auto-refresh runs every 15 seconds on the first page
while visible. Authorization errors pause polling. HTML is displayed by default when available, including inline styling, embedded styles,
tables, and links. A Text button keeps the plain-text alternative available. DOMPurify
sanitizes sender markup before it enters an opaque-origin sandboxed iframe. Scripts,
forms, nested frames, plugins, and automatic navigation are blocked. Sender CSS cannot
style the app or access the bearer key. HTTPS/HTTP links open separately with no opener
or referrer. Remote images (including CSS background images) are blocked until the reader
chooses Load remote images for the current message. Embedded raster data images work;
CID attachment images remain unavailable because attachments are not stored. The per-message
image preference resets when switching mail. CSP permits inline styles in the sandbox;
application scripts remain same-origin only and no inline JavaScript is allowed.

Delete message removes only the selected message. Delete mailbox requires typing the
full mailbox address, calls the authenticated claim-deletion endpoint, permanently removes
its stored messages, and releases the claim. Success clears the reader, aborts pending
requests, removes the matching local remembered entry, clears in-memory credentials, and returns to login. A cancellation or failed
authorized request does not silently close the inbox. Other controls/polling are paused
during deletion. The address can be claimed again; deletion is not a permanent address ban.

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

## Device-local remembered mailboxes

The database `burnmail-device-mailboxes`, version 1, has a `mailboxes` object store keyed
by the exact trimmed address (matching the existing case-sensitive API), containing the
address, opaque bearer key, and last successful use timestamp. One record per address;
a failed login never overwrites a valid stored key. Keys never appear in switcher markup,
change notifications, or logs. Email content remains in the existing server mailbox and
is not copied into this client credential store. There is no account, cloud backup, sync
endpoint, or bulk upload. Only an explicitly selected mailbox's key goes to the existing
API Authorization header. Remembering itself performs no network requests.

Records have no TTL, pruning schedule, or artificial limit. Writes request IndexedDB
`durability: strict` and wait for transaction completion, falling back to the default
transaction only on engines that reject the durability option. The app requests
`navigator.storage.persist()` after saving and offers an explicit retry button. It shows
whether persistence was granted instead of claiming guaranteed permanence. Browser denial,
unsupported persistence, blocked/quota-exhausted storage, private-mode cleanup, manual site
data deletion, profile removal, and changing origins cannot be overridden. Failed saves
leave a working login and visible warning with a retry and access-link backup guidance.
Storage errors never cause a cloud fallback or deletion/recreation of the local database.

Forget requires confirmation and only removes the entry on this device; it does not delete
the remote mailbox. Forgetting the active entry also closes the local session. Delete mailbox
removes local credentials only after the existing authorized server deletion succeeds;
cancellation and server failure preserve the record. A stale saved login stays listed with
an error until the user chooses Forget or supplies a working key. Same-device tabs exchange
only a key-free invalidation notice with BroadcastChannel and refresh local metadata on focus;
there is no background validation, automatic login, or polling of inactive saved mailboxes.

Keys must be recoverable for one-click access, so IndexedDB is not a password vault. Anyone
with this browser profile, privileged extensions, or same-origin script execution can access
them. Existing script CSP and opaque-origin HTML-email sandboxing remain in place. Keep
private access links as backups; storage permission cannot prevent explicit deletion.
