# @yantratech/kandji-mcp-server

A stdio [Model Context Protocol](https://modelcontextprotocol.io) server for the [Iru Endpoint Management API](https://api-docs.iru.com/), formerly the Kandji API. Its **114 tools** cover the main Apple device-management workflows: device inventory, escrowed device secrets, MDM actions (lock/erase/restart/Lost Mode), Prism fleet reporting, blueprints and blueprint routing, library items (custom apps, profiles, scripts, in-house IPA apps), Automated Device Enrollment (ADE), tags, users, EDR threats, Vulnerability Management, and the admin audit log. List tools page through Kandji's several list envelopes for you, rate-limited requests are retried once, and the largest responses are capped by default and say when they are partial (see [Response shapes](#response-shapes)).

**Not covered:** deleting or renaming devices, Remote Desktop, cellular settings (data roaming, Personal Hotspot), ADE token management (creating, renewing, updating or deleting tokens), and changes to Blueprint Routing (the routing tools are read-only).

> **Kandji is now Iru.** Kandji [announced its rebrand to Iru](https://www.iru.com/newsroom/kandji-now-iru) on 22 October 2025, and as of 8 April 2026 [Iru branding](https://docs.iru.com/en/iru/platform-overview/iru-brand-update) has replaced Kandji across the main admin, enrollment and endpoint surfaces; the device-management product is now Iru Endpoint. The API itself is unchanged: `*.api.kandji.io` hosts keep working, and tenants migrated to Iru can also use `*.api.iru.com`. This package, its `KANDJI_*` environment variables and this README keep the Kandji name, which here means Iru Endpoint.

## Installation

Requires Node.js 22 or later.

### From source

This package lives in the [`yantratech/mcp-connectors`](https://github.com/yantratech/mcp-connectors) monorepo:

```sh
git clone https://github.com/yantratech/mcp-connectors.git
cd mcp-connectors
npm install
npm run build --workspace connectors/kandji   # or: cd connectors/kandji && npm run build
node connectors/kandji/dist/index.js
```

The server speaks JSON-RPC over stdin/stdout; you normally never run it by hand — your MCP client launches it (see [Client configuration](#client-configuration)).

### npx (once published on npm)

```sh
npx -y @yantratech/kandji-mcp-server
```

> **npm publication is in progress.** Until the package is live on the npm registry, this command will not resolve — use the from-source instructions above.

## Setup

### Environment variables

The server needs two environment variables. They are read on the first tool call, not at startup: if either is missing or malformed, the server still starts and every tool call returns an error naming the variable (run `test_connection` to check your setup).

| Variable | Required | Description |
|---|---|---|
| `KANDJI_API_TOKEN` | Yes | An API token for your tenant (see [Minting an API token](#minting-an-api-token)). Sent as `Authorization: Bearer <token>` on every request. |
| `KANDJI_BASE_URL` | Yes | The **full** API base URL for your tenant, **including the `/api/v1` suffix** — e.g. `https://yourcompany.api.kandji.io/api/v1`. Trailing slashes are stripped automatically. |
| `KANDJI_DEBUG` | No | Set to `1` to log the form-encoded body of `POST /blueprints` requests to stderr (useful when debugging blueprint creation). |
| `KANDJI_ALLOW_INSECURE` | No | Set to `1` to allow a plain `http://` `KANDJI_BASE_URL`, for local testing only; otherwise a non-https URL is rejected, because the API token would travel in cleartext. |

There is no default base URL and no separate "subdomain" variable — you supply the whole URL. The host formats are:

- **US tenants:** `https://<subdomain>.api.kandji.io/api/v1`
- **EU tenants:** `https://<subdomain>.api.eu.kandji.io/api/v1`
- **Tenants migrated to Iru** can also use `https://<subdomain>.api.iru.com/api/v1`.

`<subdomain>` is the one in your web console's address: `https://<subdomain>.kandji.io`, or `https://<subdomain>.iru.com` once your account has been [upgraded to Iru](https://docs.iru.com/en/iru/platform-overview/upgrade-to-iru). The console's API token page also shows your tenant's API URL.

### Minting an API token

Open **Access** in the web console (admin access required):

- **Iru console:** Account Menu → **Access** → **API tokens** → **Add Token**.
- **Kandji console that has not been upgraded:** **Settings** → **Access** → **API Token** → **Add token**.

Note:

- The token value is **shown once** at creation — copy it then.
- Tokens are scoped to **individual API endpoints**. Apply least privilege: if you only need read tooling, enable only the `GET` endpoints (device list/details, Prism, audit, etc.) and leave the device-action, secrets, and library-write endpoints off. The server degrades gracefully — tools whose endpoints the token can't reach return an error result rather than crashing the server.
- Removing the admin who created a token affects it differently by console. On a Kandji console the token is deleted with the admin, so prefer a dedicated service-account admin for long-lived automation. On an Iru console the token keeps working until it is revoked under **Access → API tokens**.

### Rate limits

The [API reference](https://api-docs.iru.com/) documents a rate limit of 10,000 requests per hour per customer. The server reads the `ratelimit-reset` header on HTTP 429 and automatically backs off and retries once (capped at 60 s). Fleet-wide tools (`prism_*`, `list_devices`) paginate at up to 300 rows per request, so even large fleets stay well inside the hourly budget.

## Client configuration

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kandji": {
      "command": "npx",
      "args": ["-y", "@yantratech/kandji-mcp-server"],
      "env": {
        "KANDJI_API_TOKEN": "<your-api-token>",
        "KANDJI_BASE_URL": "https://<subdomain>.api.kandji.io/api/v1"
      }
    }
  }
}
```

(Running from source? Replace `command`/`args` with `"command": "node", "args": ["/path/to/mcp-connectors/connectors/kandji/dist/index.js"]`.)

### Claude Code

```sh
claude mcp add kandji \
  --env KANDJI_API_TOKEN=<your-api-token> \
  --env KANDJI_BASE_URL=https://<subdomain>.api.kandji.io/api/v1 \
  -- npx -y @yantratech/kandji-mcp-server
```

(Running from source? Replace everything after `--` with `node /path/to/mcp-connectors/connectors/kandji/dist/index.js`.)

## Tool reference

All 114 tools, grouped by family. Names are exactly as registered (snake_case). Tools marked **DESTRUCTIVE** carry the MCP `destructiveHint: true` annotation; all 26 of them are marked below. Tools marked **SENSITIVE** return escrowed secrets, and each successful read is logged to stderr (capture it if you need an audit trail; see [Security](#security)).

Conventions shared by most tools:

- ID parameters are validated before any request is sent. `device_id`, `blueprint_id`, `library_item_id` and `tag_id` must be UUIDs where they name the resource in the request path; the same names used as optional filters or body fields (for example `list_devices.blueprint_id`, `update_device.blueprint_id`, the threat and detection `device_id` filters) are not UUID-checked. Every ID (including `user_id`, `note_id`, `cve_id`, ADE and export IDs) must be a single path segment: `.`, `..`, `/`, `\`, `?`, `#`, `%`, control characters and surrounding whitespace are rejected, as are empty values except on optional filters, where `""` still means "no filter".
- On an API failure, a tool returns `isError: true` with text of the form `Error: Kandji API error <status> on <path>: [upstream response — untrusted] <body>`, where the upstream body is cut to 280 characters, followed by a `Hint:` line for common statuses (400, 401, 403, 404, 422, 429). `test_connection` starts its message with `Connection failed:` instead.

### Response shapes

Single-record tools (`get_device`, `get_blueprint`, `get_custom_app`, ...) return the API's record, sometimes with an added `note` or status flag. Tools that return a list wrap it as follows; most accept `max_results` (a positive integer) to cap how many items are fetched.

| Tool | Response | When the result is partial |
|---|---|---|
| `list_devices` | `{ count, devices }` | Without `max_results` it pages through every device. With `max_results` it fetches one extra device; if more exist it adds `truncated: true` and a `note`, and `count` is then the capped page size, not the fleet size. |
| `list_users` | `{ count, active_count, archived_count, users }` | Same `truncated` / `note` behavior as `list_devices`. `count` includes archived users, which the `note` also points out. |
| `get_device_apps` | `{ count, returned, apps }` | `count` is every app on the device; `returned` is the rows in this response. `truncated: true` and a `note` appear when `max_results` cuts the list. Rows hold key fields only unless `detail: true`. |
| `get_device_activity` | `{ returned, total_available, truncated, activity }` | Returns the first 50 entries unless you pass `max_results` (`default_cap_applied: 50` says so). `total_available` is the device's full entry count. |
| `get_audit_events` | `{ returned, truncated, events }` | Returns one 50-event page unless you pass `max_results`. When `truncated` is true, call again with `start_offset` set to the returned `next_offset` and the same filters. |
| The 16 Prism category tools | `{ category, returned, total_available, truncated, devices_in_slice, devices, rows }` | Capped at 50 rows by default (20 for the fan-out categories); see [Prism fleet reporting](#prism-fleet-reporting-19). |
| `list_blueprint_templates` | `{ category_count, template_count, note, templates }` | No truncation flag; `max_results` caps the number of category groups. Templates are nested under `templates[].templates[]`, and `template_count` is the number of templates. |
| Every other tool that returns a list | `{ count, <items> }` | No truncation flag. `count` is the number of items in this response, so if you passed `max_results` and `count` equals it, more items may exist. |

The array key names the resource (`blueprints`, `tags`, `notes`, `commands`, `library_items`, `vulnerabilities`, ...); the four library list tools (`list_custom_apps`, `list_custom_profiles`, `list_custom_scripts`, `list_in_house_apps`) use `results`. Some reads return HTTP 200 with an empty list for IDs that do not exist (`list_device_notes`, `get_device_activity`, `get_library_item_status`, `get_library_item_activity`); an empty result from these carries a `note` saying it does not prove the ID exists.

### Connection check (1)

| Tool | Description |
|---|---|
| `test_connection` | Validate that the API token and base URL are configured correctly (makes a 1-device probe request). No parameters. |

### Devices (10)

| Tool | Description |
|---|---|
| `list_devices` | List enrolled devices with filters for platform, blueprint, serial, asset tag, user email, and FileVault state. |
| `get_device` | Summary record for one device (hostname, serial, blueprint, user, last check-in). |
| `get_device_details` | Comprehensive detail record for one device. |
| `get_device_apps` | Applications installed on a device: key fields by default, full records with `detail: true`; `max_results` caps the rows. Preinstalled Apple apps on iPhone/iPad are not reported by the API. |
| `get_device_status` | Compliance status of a device per library item and parameter. |
| `get_device_activity` | Activity log — MDM commands, check-ins, profile installs, status changes. The first 50 entries unless you pass `max_results`. |
| `get_device_library_items` | Library items assigned via the device's blueprint, with per-item install status. |
| `get_device_parameters` | Kandji-managed hardening parameter state (screen lock, firewall, Gatekeeper, ...). |
| `get_device_commands` | MDM command history (lock, erase, install, restart, ...) with status and timestamps. |
| `get_device_lost_mode` | Lost Mode state — enabled/disabled, last known location, lock-screen message. |

**`list_devices` parameters** (all optional):

```
platform           string   "Mac" | "iPhone" | "iPad" | "AppleTV" | "VisionPro" | "Windows"
blueprint_id       string   filter by blueprint ID
serial_number      string   exact serial number
asset_tag          string   exact asset tag
user_email         string   assigned user email
filevault_enabled  boolean  macOS FileVault state
max_results        integer  cap on devices returned across all pages
```

**`get_device` / `get_device_details` parameters:** `device_id` (string, required) — the Kandji device ID, discoverable via `list_devices`.

### Device notes (5)

| Tool | Description |
|---|---|
| `list_device_notes` | List free-text admin notes attached to a device. |
| `get_device_note` | Retrieve one note by ID. |
| `create_device_note` | Attach a note (ticket reference, investigation finding, onboarding context). |
| `update_device_note` | Edit an existing note. |
| `delete_device_note` | **DESTRUCTIVE** — delete a note. |

### Device secrets (4) — SENSITIVE

Each takes a single `device_id` parameter, is a pure read, and **every successful read is logged to stderr** with the device ID and timestamp (refused or failed attempts are not logged).

| Tool | Description |
|---|---|
| `get_filevault_recovery_key` | Escrowed FileVault personal recovery key (PRK) for a macOS device. |
| `get_activation_lock_bypass_code` | Activation Lock bypass code. |
| `get_unlock_pin` | Unlock PIN set by a prior Lock Device MDM command. |
| `get_recovery_lock_password` | Recovery Lock password for an Apple silicon Mac. |

### Device record update (1)

| Tool | Description |
|---|---|
| `update_device` | **DESTRUCTIVE** — update a device record: asset tag, blueprint assignment, assigned user, or tags. Reassigning `blueprint_id` is high impact — the device receives a different configuration bundle. |

**`update_device` parameters:**

```
device_id        string          required
asset_tag        string | null   optional — new asset tag; JSON null clears it
blueprint_id     string          optional — blueprint to assign (HIGH IMPACT)
user             string | null   optional — user ID (UUID or legacy integer) to assign; JSON null unassigns
tags             string[]        optional — full replacement tag list; [] removes all tags
clear_user       boolean         optional — equivalent to user: null
clear_asset_tag  boolean         optional — equivalent to asset_tag: null
clear_tags       boolean         optional — equivalent to tags: []
```

Clearing follows the Kandji API convention (verified live 2026-08-06): scalars
clear with an explicit JSON `null`, tags clear with `[]`. String sentinels such
as `"null"`, `"none"`, or `"0"` are rejected with an error — they are never
forwarded to the API, where they would 400 or silently change nothing.

### Device actions (16)

All take `device_id`; extra parameters noted. Every action Kandji accepts is logged to stderr with the action verb.

| Tool | Description |
|---|---|
| `update_inventory` | Non-destructive: force the device to re-report inventory. |
| `daily_checkin` | Non-destructive: re-run audit scripts and refresh library-item status. |
| `lock_device` | **DESTRUCTIVE** — immediately lock the screen; on macOS may set a six-digit EFI PIN. |
| `unlock_account` | Clear a locked-out local macOS user account (`user_name` param). |
| `clear_passcode` | **DESTRUCTIVE** — wipe the device passcode. |
| `erase_device` | **DESTRUCTIVE** — wipe ALL data; irreversible. See parameters below. |
| `enable_lost_mode` | Put a supervised iOS/iPadOS device into Lost Mode (`message`, `phone_number`, `footnote` params). |
| `disable_lost_mode` | Take a device out of Lost Mode. |
| `play_lost_mode_sound` | Play a locator chime on a device in Lost Mode. |
| `update_location` | Refresh GPS location of a device in Lost Mode. |
| `restart_device` | Disruptive: immediately reboot the device. |
| `shutdown_device` | Disruptive: power the device off. |
| `blank_push` | APNs ping that nudges the device to check in and run queued commands. |
| `renew_mdm_profile` | Refresh the device's MDM enrollment profile. |
| `reinstall_agent` | Reinstall the Kandji macOS agent. |
| `delete_user` | **DESTRUCTIVE** — remove a local user account *including its home directory* (`user_name` param). |

**`lock_device` parameters:** `device_id` (string, required).

**`erase_device` parameters:**

```
device_id     string  required
PIN           string  6-digit PIN for the post-wipe EFI lock screen; the erase
                      is sent only with one. If omitted, nothing is sent and a
                      cryptographically random PIN is returned to call again with
pin_message   string  optional message shown at the EFI lock screen
phone_number  string  optional contact number shown at the EFI lock screen
```

Without `PIN`, `erase_device` is a two-step confirm: the first call sends nothing to Kandji and returns a freshly generated 6-digit PIN with what to do next.

```json
{
  "sent": false,
  "action": "confirm_erase",
  "device_id": "0a6f3c12-9d4e-4b7a-8c21-f0e5a9b3d471",
  "PIN": "123456",
  "next": "No erase was sent. To erase the device, call erase_device again with the same arguments plus PIN \"123456\". Give this PIN to the device's user: the device will require it at the EFI lock screen after the wipe."
}
```

A call with `PIN` sends the erase and returns Kandji's queued command record with the `PIN` added. The PIN is required to release the device from the EFI lock screen after the wipe, so surface it to the operator. Because the erase only ever goes out with a PIN the caller already holds, no failure, timeout or cancellation can queue an erase with a PIN the caller does not know.

`erase_device` is not idempotent: each call with a `PIN` queues another erase. If a call fails other than with a 4xx rejection (after a 5xx, a dropped or timed-out connection, or a success response that cannot be read), the erase may still have been queued with the `PIN` you supplied, and the error says so. The same holds when the MCP client cancels the call or times it out while the request is in flight. Check `get_device_commands` before calling again, and if you retry, use the same `PIN`. Once a call is cancelled, nothing more is sent, including a retry still waiting out a 429 backoff. A configuration error, such as a non-https `KANDJI_BASE_URL`, is reported before anything is sent and carries no PIN.

### Prism fleet reporting (19)

Prism reports a column-oriented view of the whole fleet per category. The 16 category tools share one parameter shape and one response shape:

```
max_results  integer   cap on rows (default 50; default 20 for the per-row
                       fan-out categories: apps, local_users,
                       transparency_database, launch_agents_and_daemons)
fields       string[]  projection — only these row keys are returned
                       (device_id always retained; unknown names are echoed
                       back in fields_unknown so typos are correctable)
summary      boolean   if true, return { category, returned, total_available,
                       truncated, default_cap_applied?, note?,
                       devices_in_slice, by_device, devices, sample } instead
                       of full rows (by_device counts cover only the fetched
                       rows; sample is the first 3 rows)
```

Responses are `{ category, returned, total_available, truncated, default_cap_applied?, note?, fields_projected?, fields_unknown?, devices_in_slice, devices: { <device_id>: { device_id, device_name, serial_number, ... } }, rows: [{ device_id, ...category-specific columns }] }` — per-device columns are hoisted out of the rows into the `devices` map to save tokens. `returned` counts the rows in this response only. `truncated: true` means more rows exist upstream (a `note` then explains), and `default_cap_applied` appears when the default cap was used. `total_available` is the total the API reports, which is often `null`; use `prism_count` for a category's full row count. Rows fill device by device, so a truncated response's `devices` map may cover only part of the fleet.

| Tool | Description |
|---|---|
| `prism_device_information` | Fleet-wide device information. |
| `prism_activation_lock` | Activation Lock status across the fleet. |
| `prism_application_firewall` | Application Firewall status (macOS). |
| `prism_apps` | Application inventory across the fleet. |
| `prism_cellular` | Carrier, eSIM, roaming, phone number (iPhone/iPad). |
| `prism_certificates` | Installed certificates: subject, issuer, expiry, trust. |
| `prism_desktop_and_screensaver` | Desktop and screensaver configuration (macOS). |
| `prism_filevault` | FileVault disk-encryption status (macOS). |
| `prism_gatekeeper_and_xprotect` | Gatekeeper and XProtect status (macOS). |
| `prism_installed_profiles` | Installed configuration profiles across the fleet. |
| `prism_kernel_extensions` | Loaded kernel extensions (macOS). |
| `prism_launch_agents_and_daemons` | Launch Agents and Daemons (macOS). |
| `prism_local_users` | Local user accounts (macOS). |
| `prism_startup_settings` | Startup security settings (macOS). |
| `prism_system_extensions` | System extensions (macOS). |
| `prism_transparency_database` | TCC/PPPC privacy-permission database entries (macOS). |
| `prism_count` | Per-category row counts across all 16 categories, as `{ counts, errors? }`. No parameters. |
| `prism_request_export` | Request an async CSV export of a category; returns an `export_id` (`category`, `device_families`, `blueprint_ids`, `filters` params). Each call creates a new export job, so it is not annotated read-only. |
| `prism_get_export` | Poll an export job by `export_id`; returns a signed download URL when ready. |

### Audit log (1)

| Tool | Description |
|---|---|
| `get_audit_events` | Admin audit log — every change made in the console (blueprint edits, library changes, user management, API-key use). Primary source for SOC 2 evidence. Returns one 50-event page by default. |

**`get_audit_events` parameters:**

```
start_date    string   optional ISO 8601 start (inclusive), e.g. 2026-01-01T00:00:00Z
end_date      string   optional ISO 8601 end (inclusive)
max_results   integer  optional cap on events per call (default 50)
start_offset  integer  optional resume cursor: the previous response's next_offset
                       (keep the same filters)
```

### Users (2)

| Tool | Description |
|---|---|
| `list_users` | End-users in the Kandji directory (typically IdP-synced); filter by `email`, cap with `max_results`. |
| `get_user` | One user by `user_id` (email, name, department, job title, active/archived flags, `device_count`). To list a user's devices, call `list_devices` with `user_email`. |

### Blueprints (10)

| Tool | Description |
|---|---|
| `list_blueprints` | List all blueprints (policy bundles). |
| `list_blueprint_templates` | Kandji's curated blueprint templates (CIS, SOC 2, ADE Default, ...), grouped by category; `detail: true` includes each template's `params`. |
| `get_blueprint` | One blueprint — name, description, enrollment code, metadata. |
| `get_blueprint_library_items` | Every library item assigned to a blueprint. |
| `get_blueprint_ota_enrollment_profile` | The manual-enrollment `.mobileconfig` for a blueprint, base64-encoded (`sso` param for SSO-gated tenants). |
| `create_blueprint` | **DESTRUCTIVE** — create a blueprint, optionally cloned from a template or another blueprint. Note: `type="classic"` currently returns HTTP 500 upstream — the tool defaults to `"map"`. |
| `update_blueprint` | **DESTRUCTIVE** — rename a blueprint or change its description. |
| `delete_blueprint` | **DESTRUCTIVE** — permanently delete a blueprint and unassign its devices. |
| `assign_library_item` | **DESTRUCTIVE** — add a library item to a blueprint (takes effect on next check-in). |
| `remove_library_item` | **DESTRUCTIVE** — remove a library item from a blueprint (already-installed payloads are not proactively uninstalled). |

### Blueprint routing (2)

Read-only: these tools report the routing rules but cannot change them.

| Tool | Description |
|---|---|
| `get_blueprint_routing` | Tenant-wide routing rules deciding which blueprint newly-enrolled devices land on. |
| `get_blueprint_routing_activity` | Change history for the routing rules. |

### Vulnerability Management (5) — license-gated

If Kandji Vulnerability Management isn't enabled on the tenant (or the token can't reach these endpoints), these tools return a non-error `{ license_gated: true, note }` result instead of an error (the list tools with `count: 0` and an empty list).

| Tool | Description |
|---|---|
| `list_vulnerabilities` | CVEs detected across the fleet; filter by `severity` (`low`/`medium`/`high`/`critical`). |
| `get_vulnerability` | Full description for one CVE (`cve_id`): summary, CVSS, advisory, references. |
| `get_vulnerability_devices` | Every device currently affected by a CVE (`cve_id`, `max_results`). |
| `get_vulnerability_software` | Affected software packages and version ranges for a CVE. |
| `list_vulnerability_detections` | Individual device-by-CVE detection pairs; filter by `cve_id` and/or `device_id`. |

### Library items (25)

| Tool | Description |
|---|---|
| `list_custom_apps` | Custom Apps (macOS .pkg/.zip/.dmg installers) in the library. |
| `get_custom_app` | One Custom App — metadata, install/audit scripts, assignment. |
| `list_in_house_apps` | In-House (enterprise-signed .ipa) iOS/iPadOS apps. |
| `get_in_house_app` | One In-House App — bundle ID, version, signing info. |
| `list_custom_profiles` | Custom configuration profiles (.mobileconfig); the profile XML is omitted unless `detail: true`. |
| `get_custom_profile` | One profile — payloads, targeted platforms, assignment. |
| `list_custom_scripts` | Custom scripts in the library. |
| `get_custom_script` | One script — body, execution frequency, remediation script. |
| `get_library_item_status` | Per-device install/run status for any library item. |
| `get_library_item_activity` | Edit/assignment history for a library item. |
| `list_self_service_categories` | Self Service categories for end-user app browsing. |
| `create_custom_app` | **DESTRUCTIVE** — create a Custom App pointing at a binary uploaded via `upload_custom_app_binary`. |
| `update_custom_app` | **DESTRUCTIVE** — modify a Custom App's metadata, scripts, enforcement, or Self Service exposure. |
| `delete_custom_app` | **DESTRUCTIVE** — permanently delete a Custom App and remove it from blueprints. |
| `upload_custom_app_binary` | **DESTRUCTIVE** — step 1 of 2: request a presigned S3 URL for an installer (`name` param). |
| `create_custom_profile` | **DESTRUCTIVE** — create a profile from a `.mobileconfig` payload (`mobileconfig` string + `runs_on_*` device-family flags; at least one family required). |
| `update_custom_profile` | **DESTRUCTIVE** — modify a profile's name, targeting, or payload. |
| `delete_custom_profile` | **DESTRUCTIVE** — permanently delete a profile and remove it from blueprints. |
| `create_custom_script` | **DESTRUCTIVE** — create a script (audit `script`, optional `remediation_script`, `execution_frequency`). |
| `update_custom_script` | **DESTRUCTIVE** — modify a script's content, frequency, or assignments. |
| `delete_custom_script` | **DESTRUCTIVE** — permanently delete a script and remove it from blueprints. |
| `create_in_house_app` | **DESTRUCTIVE** — create an In-House (IPA) App pointing at a binary uploaded via `upload_in_house_app_binary`. |
| `update_in_house_app` | **DESTRUCTIVE** — modify an In-House App's metadata, enforcement, or assignments. |
| `delete_in_house_app` | **DESTRUCTIVE** — permanently delete an In-House App and remove it from blueprints. |
| `upload_in_house_app_binary` | **DESTRUCTIVE** — step 1 of 2: request a presigned S3 URL for an .ipa (`filename` param — note: not `name`). |

### Threats / EDR (2) — license-gated

If Kandji EDR isn't licensed on the tenant, these return a graceful `{ count: 0, ..., license_gated: true }` shape instead of an error. Both accept optional `device_id` and `max_results`.

| Tool | Description |
|---|---|
| `get_threats` | EDR threat detections (malware, PUPs, signature-based) across the fleet. |
| `get_behavioral_detections` | EDR behavioral detection events (anomalous process/file/network behavior). |

### Tags (4)

| Tool | Description |
|---|---|
| `list_tags` | List all tags in the tenant. |
| `create_tag` | Create a tag (`name`). |
| `update_tag` | Rename a tag (`tag_id`, `name`). |
| `delete_tag` | **DESTRUCTIVE** — delete a tag (`tag_id`). |

### Settings (1)

| Tool | Description |
|---|---|
| `get_licensing` | Tenant license entitlements — seat count, EDR add-on, Vulnerability Management, region, renewal dates. |

### Apple ADE (6)

| Tool | Description |
|---|---|
| `list_ade_integrations` | ADE tokens configured in the tenant. |
| `get_ade_integration` | One ADE token — MDM server link, default blueprint, expiry, last sync. |
| `list_ade_devices_for_token` | Devices assigned to a specific ADE token. |
| `list_ade_devices` | Every ADE-eligible device across all tokens. |
| `get_ade_device` | One ADE device by its ADE-side ID (not the MDM device ID). |
| `get_ade_public_key` | The PEM public key used to upload a fresh MDM server token to Apple Business Manager. |

## Security

This connector deliberately includes high-consequence capability. Treat it the way you would treat the Kandji console itself.

- **Escrowed-secret reads are logged to stderr.** Every successful call to `get_filevault_recovery_key`, `get_unlock_pin`, `get_activation_lock_bypass_code`, or `get_recovery_lock_password` writes a line to the server's **stderr** with the device ID and timestamp (`[kandji-mcp] device secret accessed: device=... kind=... at=...`). Capture stderr in your MCP client's logs if you need an audit trail; on an Iru console, the token's **Activity** view also lists the endpoints it accessed.
- **IDs cannot redirect a request.** Every ID is checked as a single URL path segment and then percent-encoded, both in the tool schema and again in the API client. An ID such as `abc/secrets/filevaultkey` or `../blueprints/<id>` is refused before anything is sent, so a read-only tool cannot reach a secrets endpoint and a tag tool cannot delete a blueprint.
- **Destructive tools are annotated.** The 26 tools marked **DESTRUCTIVE** above carry the MCP `destructiveHint: true` annotation: `erase_device`, `lock_device`, `clear_passcode` and `delete_user`; `update_device` (a blueprint reassignment swaps the device's configuration); every blueprint and library-item write, including library-item assignment and the two binary-upload tools; and the `delete_*` tools for tags and device notes. Clients can use that hint to ask for confirmation, but it is advisory: a client set to auto-approve these tools will not prompt, so treat per-endpoint token scoping (below) as the enforceable guardrail. Accepted device actions are additionally logged to stderr with the action verb.
- **Erase is irreversible.** `erase_device` wipes the device and unenrolls it. `delete_user` removes a local account *and its home directory*. There is no undo for either.
- **Scope the token down.** Kandji API tokens are scoped per endpoint. If your workflow is read-only reporting (inventory, Prism, audit, vulnerabilities), mint a token with only those `GET` endpoints enabled and the secrets, device-action, and library-write endpoints disabled. The corresponding tools will then fail with a permission error instead of being usable at all — the cheapest possible guardrail.
- **Secrets pass through the LLM context.** A recovery key fetched by a tool becomes part of the conversation. Only fetch escrowed secrets during active incident response or owner-authenticated recovery, never for bulk export, and treat transcripts containing them as secrets themselves.

## Worked example

*"Which Macs haven't checked in for 30 days, and is FileVault on for them?"*

**Step 1 — list the Macs with their last check-in:**

```json
{ "tool": "list_devices", "arguments": { "platform": "Mac" } }
```

Without `max_results`, `list_devices` pages through every matching device, so `count` is the number of Macs:

```json
{
  "count": 42,
  "devices": [
    {
      "device_id": "0a6f3c12-9d4e-4b7a-8c21-f0e5a9b3d471",
      "device_name": "amelia-mbp",
      "model": "MacBook Pro (14-inch, M3, 2023)",
      "serial_number": "C02ABC123DEF",
      "platform": "Mac",
      "os_version": "15.4.1",
      "last_check_in": "2026-05-02T08:14:09.123000+00:00",
      "blueprint_name": "Production Macs",
      "user": { "email": "amelia@example.com", "name": "Amelia Chen" }
    },
    "… 41 more devices …"
  ]
}
```

The model filters `last_check_in` against today's date to find the stale devices (here `amelia-mbp`, last seen 39 days ago).

**Step 2 — pull fleet-wide FileVault state, projected down to the one column that matters:**

```json
{ "tool": "prism_filevault", "arguments": { "fields": ["filevault_enabled"] } }
```

```json
{
  "category": "filevault",
  "returned": 42,
  "total_available": null,
  "truncated": false,
  "default_cap_applied": 50,
  "fields_projected": ["device_id", "filevault_enabled"],
  "devices_in_slice": 42,
  "devices": {
    "0a6f3c12-9d4e-4b7a-8c21-f0e5a9b3d471": {
      "device_id": "0a6f3c12-9d4e-4b7a-8c21-f0e5a9b3d471",
      "device_name": "amelia-mbp",
      "serial_number": "C02ABC123DEF",
      "last_check_in": "2026-05-02T08:14:09.123000+00:00"
    },
    "…": "… 41 more devices …"
  },
  "rows": [
    { "device_id": "0a6f3c12-9d4e-4b7a-8c21-f0e5a9b3d471", "filevault_enabled": true },
    "… 41 more rows …"
  ]
}
```

`truncated` is `false`, so these 42 rows are the whole category; on a larger fleet the default cap of 50 rows would set `truncated: true`, and you would raise `max_results`. Joining `rows` to step 1 on `device_id` answers the question: `amelia-mbp` is 39 days stale and FileVault **is** enabled. (If a projected field name doesn't exist in the category, it comes back in `fields_unknown` so the model can self-correct — e.g. Prism's apps rows use `bundle_name`, not `app_name`.)

## API behavior notes

Kandji's API has several distinct pagination envelopes, form-encoded and multipart write endpoints, and a handful of sharp edges this server absorbs for you. They're documented in [docs/api-notes.md](docs/api-notes.md) — useful if you're debugging an unexpected response or extending the server.

## Contributing

Issues and PRs are welcome at [yantratech/mcp-connectors](https://github.com/yantratech/mcp-connectors); see [CONTRIBUTING.md](../../CONTRIBUTING.md). Build with `npm run build`, lint with `npm run lint`, and run the offline test suite with `npm test` (no Kandji tenant required). The live scripts under `test/live-*` need real credentials and are opt-in; any that create or change data also require `KANDJI_LIVE_WRITES=1`.

## License

[MIT](./LICENSE) © Yantra Applied Technologies Limited. Server scaffolding adapted from [XeroAPI/xero-mcp-server](https://github.com/XeroAPI/xero-mcp-server) (MIT, © 2025 Xero Limited).

Kandji and Iru are trademarks of their owner. This is an independent project, not affiliated with or endorsed by Iru (formerly Kandji).
