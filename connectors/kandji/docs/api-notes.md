# Kandji (Iru Endpoint) API behavior notes

Field notes on the Kandji API, now the Iru Endpoint Management API,
collected while building and live-testing `@yantratech/kandji-mcp-server`. Kandji
rebranded to Iru in October 2025. The API itself is unchanged and its hosts keep the
kandji.io naming; tenants migrated to Iru can also use `{subdomain}.api.iru.com`. The
upstream reference is [api-docs.iru.com](https://api-docs.iru.com/), which notes that
many of its URLs still reference Kandji.

## Fundamentals

| Property | Detail |
|---|---|
| **Base URL** | `https://{subdomain}.api.kandji.io/api/v1/` (US) / `https://{subdomain}.api.eu.kandji.io/api/v1/` (EU); tenants migrated to Iru can also use `https://{subdomain}.api.iru.com/api/v1/` |
| **Auth** | Bearer token (tenant-level, scopable per endpoint) |
| **Rate limit** | 10,000 requests per hour per customer, as documented in the [API reference](https://api-docs.iru.com/) |
| **Rate-limit headers** | `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`; HTTP 429 on exceed |
| **Pagination** | mostly `limit` + `offset` query params; max ~300 per page on the device list; see envelope notes below |
| **Regions** | US and EU (separate API subdomains) |
| **Token lifecycle** | Shown once on creation. On a Kandji console a token is deleted when the admin who created it is removed; on an Iru console it keeps working until revoked |

## Pagination envelopes

Kandji does **not** have one list shape. At least five envelopes coexist across the
API surface, and the right unwrapping depends on the endpoint:

| Envelope | Shape | Endpoints |
|---|---|---|
| Bare array | `[ ... ]` | `/devices`, `/devices/:id/notes`, `/self-service/categories` |
| DRF | `{ count, next, previous, results: [...] }` | `/blueprints`, `/users`, `/tags`, `/library/*`, `/audit/events`, `/threat-details` |
| Prism | `{ data: [...], offset, limit, total, cursor }` | `/prism/:category` |
| Page/size | `{ results: [...], total, page, size }` | `/vulnerability-management/*` — note **page/size** params, not limit/offset |
| Doubly nested | `{ device_id, <key>: { count, next, results: [...] } }` | `/devices/:id/activity`, `/devices/:id/commands` |

Two practical consequences:

- A "short page" (fewer rows than the requested `limit`) is **not** a reliable
  end-of-data signal — Prism silently clamps `limit` on some categories. Terminate on
  an empty page, a `next: null`, or a known `total`/`count` instead.
- `/devices` is a bare array on most tenants but DRF-wrapped tenants exist in the
  wild; handle both.

## Endpoint quirks

### Devices and actions

- `POST /devices/{id}/action/erase` on macOS **requires a 6-digit `PIN`** field and
  rejects requests without it (`<SchemaError ... PIN: MissingKeyError>`). By contrast,
  `action/lock` auto-generates a PIN server-side if none is sent. The erase response
  does **not** echo the PIN back — keep your own copy, or the device cannot be
  released from the EFI lock screen after the wipe.
- The iOS device-apps endpoint does not report preinstalled Apple apps.
- `/devices/:id/secrets/{bypasscode|filevaultkey|unlockpin|recoverypassword}` are the
  four escrowed-secret reads — plain GETs, one secret kind per path segment.

### Blueprints

- `POST /blueprints` expects **`application/x-www-form-urlencoded`** with dotted-key
  nesting (`enrollment_code.is_active=true`), not JSON. Sending JSON yields a 400
  ("enrollment_code: This field is required.") even when correctly nested, or a 500
  from a downstream crash.
- `enrollment_code.is_active` is effectively **mandatory** on create despite being
  conceptually optional — requests without it are rejected.
- Creating a blueprint with `type=classic` currently returns HTTP 500 upstream (and
  the server-side default also resolves to classic). Use `type=map` until Kandji
  fixes it.
- `GET /blueprints/templates/` **requires the trailing slash**; without it the
  request 404s.
- `GET /blueprints/:id/ota-enrollment-profile` returns either a raw `.mobileconfig`
  (`Content-Type: application/x-apple-aspen-config`) or, with `?sso=true` on an
  SSO-gated blueprint, a JSON `{url, ...}` pointing at the auth flow. Branch on the
  Content-Type before parsing.

### Prism

- `GET /prism/count` requires `?category=` — a bare GET 404s. To get all counts,
  fan out across the 16 known categories.
- Prism rows denormalize ~14 device-level columns into **every** row, which gets
  expensive fast on per-row fan-out categories (`apps`, `local_users`,
  `transparency_database`, `launch_agents_and_daemons`).
- Prism supports custom filters and an async CSV export
  (`POST /prism/export` → poll `GET /prism/export/:id`).

### Library items

- `POST /library/custom-profiles` is **multipart/form-data**: the `.mobileconfig`
  goes in a `file` part, and at least one `runs_on_*` device-family flag
  (`runs_on_mac`, `runs_on_iphone`, `runs_on_ipad`, `runs_on_tv`, `runs_on_vision`)
  must be `true`, or the API rejects with "At least one valid device family must be
  specified".
- `PATCH /library/custom-profiles/:id` accepts **both** JSON (metadata-only changes)
  and multipart (when replacing the `.mobileconfig`).
- The custom-script create/update field for the audit script body is **`script`**,
  not `audit_script`.
- The two presigned-upload endpoints are asymmetric: `POST /library/custom-apps/upload`
  takes **`name`**, while `POST /library/ipa-apps/upload` takes **`filename`**.
  Both return a presigned S3 URL + `file_key`; the binary is then POSTed directly
  to S3 and the `file_key` referenced in the subsequent create call.

### Threats / EDR (license-gated)

- The threat endpoints exist at **both** v1 and v2 (`/threat-details` vs
  `/v2/threat/threat-details`; `/behavioral-detections` vs
  `/v2/threat/behavioral-detections/events`), and tenants vary on which is enabled —
  older tenants 404 on v2, some token scopes only expose v1. Try one, fall back to
  the other on 404; if **both** 404, the EDR license isn't enabled on the tenant.
- The v2 paths live under the API root, **not** under the `/api/v1` base URL:
  the wire paths are `/api/v2/threat/threat-details` and
  `/api/v2/threat/behavioral-detections/events`. Concatenating them onto
  `KANDJI_BASE_URL` yields `/api/v1/v2/...`, which 404s and would be misread as
  "EDR not licensed".
- The threat-details endpoint has known pagination issues (publicly flagged by
  Sumo Logic's collector docs).

### ADE

- `GET /integrations/apple/ade/public_key/` returns a **raw PEM**
  (`Content-Type: application/x-pem-file` or `text/plain`), not JSON. Sniff the
  Content-Type or a leading `-----BEGIN` before parsing, or `JSON.parse` fails with
  "No number after minus sign in JSON at position 1".
- ADE devices have their own ADE-side IDs, distinct from the MDM-side device IDs
  used everywhere else.

### Vulnerability Management (license-gated)

- Uses **page/size** pagination (1-based `page`), unlike the limit/offset used by
  the rest of the API.
- Returns 401 when the Vulnerability Management license isn't enabled — not 404
  like the EDR endpoints.

## Other limits

- **No webhook API** — change detection is polling-only (the audit log at
  `/audit/events` is the best polling target for admin-side changes).
- API tokens are scoped per endpoint in the console; a request to an out-of-scope
  endpoint fails rather than degrading, so probe with a cheap read
  (e.g. `GET /devices?limit=1`) to validate a token.
