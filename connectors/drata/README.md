# @yantratech/drata-mcp-server

MCP server for SOC 2 compliance automation via the Drata REST API (V1 + V2). 140 tools for gap analysis, evidence management, control ownership, risk operations, tasks, audits and audit requests, vendor assessments, control and risk template libraries, device drill-down, custom data, GitHub security scanning, and more.

Built for the compliance coordinator/admin. Employees normally complete their own policy acknowledgements, security training and device compliance in Drata or through the Drata agent. An admin can also record some of this for a user: `acknowledge_assigned_policy` records an acknowledgement the user gave elsewhere (Drata's `details` field says how and where), and `upload_user_document` uploads evidence such as a training certificate.

## Installation

Requires Node.js 22 or later.

### From source

This package lives in the [`yantratech/mcp-connectors`](https://github.com/yantratech/mcp-connectors) monorepo:

```sh
git clone https://github.com/yantratech/mcp-connectors.git
cd mcp-connectors
npm install
npm run build --workspace connectors/drata   # or: cd connectors/drata && npm run build
node connectors/drata/dist/index.js
```

### npx (once published on npm)

```sh
npx -y @yantratech/drata-mcp-server
```

> **npm publication is in progress.** Until the package is live on the npm registry, the `npx` command above will not resolve — use the from-source instructions above.

The server speaks JSON-RPC over stdin/stdout; you normally never run it by hand — your MCP client launches it (see [Claude Code](#claude-code) and [Claude Desktop](#claude-desktop) under Setup). It needs at least `DRATA_API_KEY` (see [Environment Variables](#environment-variables)).

## Tools (140)

Legend: 🧪 = beta endpoint, may change. 💎 = feature-gated, requires a specific Drata plan feature.

### Gap Analysis (6)
- `run_gap_analysis` — Full SOC 2 gap analysis with prioritised gaps and next actions
- `check_control_status` — Filter controls by readiness, evidence, owner, or monitoring status. `hasEvidence`/`no_evidence` count evidence of any kind (external uploads, evidence-library reports, mapped policies, monitor tests), matching the app; archived controls are excluded by default
- `check_monitors` — View automated test results (passing, failing, disabled)
- `check_personnel_compliance` — Who's missing training, background checks, policy acks
- `check_vendor_risk` — Vendors with trimmed risk summary (id, name, critical, risk, impact, MFA, reviews count)
- `list_vendor_security_review_statuses` — Per-vendor security-review status the way the app's column reports it: only COMPLETED reviews count as past reviews; NOT_YET_STARTED/NOT_REQUIRED shells are surfaced separately (`pendingReviewCount`), with per-review `status`/`decision`

### Summary & Events (2)
- `get_compliance_summary` — High-level posture metrics at a glance; `failingMonitors` includes errored checks (could not evaluate), broken out as `errorMonitors`
- `get_recent_events` — Audit log of what changed and when

### Listings — V1 (9)
- `list_controls` — All controls with status
- `list_monitors` — All automated tests
- `list_personnel` — All personnel with compliance status
- `list_vendors` — Vendor inventory
- `search_vendors` — Search vendors by name (case-insensitive substring match)
- `get_vendor` — Get a single vendor by ID (lighter than `list_vendors`); carries no security-review data, so use `list_vendor_security_reviews` for reviews
- `list_policies` — Policy inventory
- `list_assets` — Asset inventory
- `list_connections` — Connected integrations

### Vendor & Asset Write — V1 (5)
- `create_vendor` — Create a new vendor with risk scoring and impact level
- `update_vendor` — Safe partial update (fetches existing vendor first, preserves unchanged fields)
- `archive_vendor` — Archive a vendor (sets archivedAt via update endpoint)
- `bulk_update_vendors` — Update multiple vendors in parallel (max 50 per call)
- `create_asset` — Create a new asset in the Drata asset inventory

### Evidence Library — V2 (7)
- `list_evidence_library` — List evidence items with cursor, sort, filter, status, total-count, and expand support
- `create_evidence_library_item` — Create evidence from exactly one source: base64 file, URL, or ticket URL
- `update_evidence_library_item` — Update metadata and optionally replace the evidence source (only sends provided fields; preserves the current renewal schedule when `renewalScheduleType` is omitted)
- `fulfil_templated_evidence` — Attach an artifact (URL or base64 file) to a templated evidence placeholder; templated items reject name/description changes (400 code 10000) but accept minimal artifact/owner/renewal payloads
- `delete_evidence_library_item` — Remove evidence from library
- `get_evidence_library_item` — Get an evidence library item by ID
- `get_evidence_library_version` — Get a specific evidence library item version

### Control External Evidence — V1 (5)
- `list_external_evidence` — List external evidence already attached to a control (download each item with `get_external_evidence_download_url`)
- `create_control_external_evidence` — Attach URL or file-based evidence directly to a control with creation and renewal metadata
- `get_external_evidence_download_url` — Get a download URL for one external evidence item; the signed URL is short-lived (~60 s, expiry surfaced as `urlExpiresAt`) — re-call for a fresh link
- `delete_external_evidence` — Delete external evidence by ID
- `list_control_mapped_requirements` — List framework requirements mapped to a control

### Control Management — V2 (12)
- `get_control` — Get a single Drata control by ID (fills the V2 read gap; `list_controls` is V1-only); the `flags` expand carries Drata's narrow `hasEvidence`, labelled inline with a semantics note
- `get_control_requirement_comparison` — Compare a control's tenant requirement mappings against Drata's global template mappings
- `create_control` — Create a new control
- `modify_control` — Update control details
- `add_control_owner` — Assign an owner to a control
- `modify_control_owners` — Replace the full owner list
- `remove_control_owner` — Remove an owner
- `list_control_owners` — List current owners
- `create_control_note` — Add a note to a control
- `update_control_note` — Edit an existing note
- `delete_control_note` — Remove a note
- `list_control_notes` — List notes on a control

### Risk Registers & Risks — V2 (13)
- `list_risk_registers` — List all risk registers
- `create_risk_register` — Create a new register
- `update_risk_register` — Update register details
- `upload_risk_document` — Attach a file to a risk
- `list_risk_documents` — List documents on a risk, including optional `downloadUrl` expansion
- `create_risk_note` — Add a note to a risk
- `update_risk_note` — Edit a risk note
- `list_risk_notes` — List notes on a risk
- `list_risks` — List risks with filters, score bounds, vendor filter, expand, and cursor pagination; archived risks are excluded by default (`archivedRisksExcluded` reports the count, `includeArchived: true` restores them)
- `get_risk` — Get a risk by ID
- `create_risk` — Create a risk
- `update_risk` — Update a risk
- `get_risk_insights` — Get risk insights for a register

### Control & Risk Libraries — V2 (4)
- `list_control_library` 💎 — Browse Drata's prebuilt control template library (not workspace-scoped); requires the Custom Frameworks feature
- `get_control_library_item` 💎 — Get a single control template from Drata's control library; requires the Custom Frameworks feature
- `list_risk_library` 💎 — Browse Drata's risk library for a risk register; requires the Risk Management Pro feature
- `get_risk_library_item` 💎 — Get a single risk from Drata's risk library; requires the Risk Management Pro feature

### Tasks, Audits & Audit Requests — V2 (10)
- `list_tasks` — List tasks with filters and cursor pagination
- `list_upcoming_tasks` — List upcoming incomplete tasks
- `get_task` — Get a task by ID
- `create_task` — Create a task
- `update_task` — Update a task
- `perform_task_action` — Complete or uncomplete a task
- `list_audits` — List audits in a Drata workspace (the way to discover `auditId`)
- `get_audit` — Get a Drata audit by ID
- `list_audit_requests` — List audit requests for an audit
- `get_audit_request` — Get an audit request by ID

### Operational Documents, Users & Roles — V2 (11)
- `list_user_documents_v2` / `get_user_document_v2` — Read user documents with optional `downloadUrl` expansion
- `list_device_documents` / `get_device_document` — Read device documents with optional `downloadUrl` expansion
- `list_vendor_documents_v2` / `get_vendor_document_v2` — Read vendor documents with optional `downloadUrl` expansion
- `get_risk_document` — Get a risk document with optional `downloadUrl` expansion
- `list_roles` / `get_role` — Read roles for permission audits
- `list_users` / `get_user` — Read users for owner lookup and permission audits

### Policies — V2 (10)
- `list_policies_v2` — List policies with cursor pagination, filters, and expansions (includes REPLACED and ARCHIVED, unlike V1 `list_policies`)
- `get_policy` — Get a specific policy with version history
- `get_policy_approval_configuration` — Get the review-group approval configuration (approval tiers) for a policy
- `get_policy_version` — Get metadata for a specific policy version
- `get_policy_version_content` — Get the raw HTML content of a specific policy version
- `list_policy_versions` — List versions of a policy with cursor pagination
- `list_policy_actions` — List workflow actions the caller can perform on a policy (SubmitForApproval, Approve, RequestChanges, OverrideApprove, Publish, Discard)
- `perform_policy_action` — Advance a policy through its approval/publish lifecycle
- `list_user_assigned_policies` — List policies assigned to a user and their acknowledgement status
- `acknowledge_assigned_policy` — Record a user's acknowledgement of an assigned policy

### Vendor Enhancements — V1 + V2 (13)
- `create_vendor_security_review` — Log a vendor assessment (reviewDeadlineAt, status, type, requester). Note: the API silently drops a `notes` field — use `update_vendor` notes instead
- `create_vendor_security_review_with_file` — Assessment with attached report
- `list_vendor_security_reviews` — List security reviews for a vendor (the primary way to discover `securityReviewId` values)
- `get_vendor_security_review` — Get a vendor security review by ID
- `list_security_review_actions` 🧪 — List the actions currently available on a vendor security review (e.g. finalize, reopen) given its present state; works for all review types (SECURITY, SOC_REPORT, UPLOAD_REPORT)
- `list_security_review_questionnaires` 🧪 — List security questionnaires attached to a vendor security review
- `send_vendor_questionnaire` — Send a security questionnaire to a vendor
- `list_vendor_questionnaires` — List questionnaires for a vendor
- `get_vendor_questionnaire` — Get a vendor questionnaire by ID (surfaces send-status metadata)
- `get_vendor_questionnaire_answers` — Get the answers a vendor submitted for a questionnaire (V1 endpoint)
- `create_vendor_type` — Create a vendor category
- `list_vendor_types` — List vendor categories
- `upload_vendor_document` — Upload a document to a vendor for security review evidence (V1)

### Personnel — V1 + V2 (5)
- `list_personnel_v2` — Search personnel with cursor pagination
- `update_personnel` — Update a personnel record's first name, last name, job title or email (identify it by `personnelId` or `lookupEmail`)
- `create_background_check` — Link a background check URL to a person
- `upload_offboarding_document` — Upload offboarding evidence for a user
- `upload_user_document` — Upload a compliance document for a user (training cert, MFA evidence, offboarding) (V1)

### GitHub Scanning (4)
- `scan_github_repos` — List repositories for an org or authenticated user (visibility, default branch, archive status)
- `scan_github_branch_protection` — Check branch protection rules (required reviews, status checks, force-push restrictions)
- `scan_github_vulnerabilities` — Scan Dependabot alerts with severity breakdown
- `scan_github_collaborators` — List collaborators and permissions for access-control audits

### Custom Connections — V2 (3)
- `list_custom_connections` — List custom evidence connections
- `create_custom_connection` — Create a new evidence feed
- `push_connection_records` — Push structured data into a connection resource

### Custom Data Records — V2 (7)
- `list_custom_data_records` — List custom data records
- `upsert_custom_data_records` — Upsert custom data records
- `list_custom_data_records_sessions` — List custom data record sessions
- `upsert_custom_data_records_session` — Upsert records into a session
- `perform_custom_data_session_action` — Complete or cancel a session
- `update_custom_data_record` — Update one custom data record
- `delete_custom_data_record` — Delete one custom data record

### Monitoring — V2 (3)
- `list_monitoring_tests_v2` — List automated compliance tests
- `get_monitoring_test` — Get test details and status; accepts `testId` OR `monitorId` (the two id namespaces overlap)
- `list_monitoring_test_failures` — List current failures for a test; accepts `testId` OR `monitorId`, resolves against the workspace test list before fetching, and echoes the resolved test identity so results are never attributed to the wrong test

### Compliance Read — V2 (7)
- `list_frameworks` — List compliance frameworks (SOC 2, ISO 27001, etc.)
- `list_framework_requirements` — List framework criteria and control mappings
- `get_framework_requirement_readiness_rollup` — Requirement readiness rollup matching the app (out-of-scope = all mapped controls archived; ready = all live mapped controls ready), mapped via the V2 controls list's `expand=requirements` and cross-checked against Drata's own framework numbers
- `list_devices_v2` — List devices and compliance status
- `list_events_v2` — Audit trail of changes
- `list_workspaces` — List workspaces (use to find workspace ID)
- `get_company` — Company-level information

### Device Drill-down — V2 (4)
- `get_device` — Get a single Drata device by ID (discover `deviceId` via `list_devices_v2` or `list_personnel_devices`)
- `list_device_apps` — List applications installed on a Drata device (use the `fields` projection to keep responses lean)
- `list_personnel_devices` — List devices associated with a personnel record (by `personnelId` or `lookupEmail`)
- `list_connection_devices` 🧪 — List devices reported by a Drata connection (the official docs mark this endpoint experimental)

## Setup

### Environment Variables

```
DRATA_API_KEY=your-api-key                                    # required
DRATA_BASE_URL=https://public-api.drata.com                   # optional, defaults to NA — EU/APAC tenants MUST set this
DRATA_WORKSPACE_ID=1                                          # optional, used as default for V2 workspace-scoped tools
DRATA_RISK_REGISTER_ID=1                                      # optional, used as default for risk register-scoped tools
DRATA_MCP_STATE_PATH=~/.local/state/drata-mcp/drata-state.json  # optional, legacy fallback for vendor review IDs (see Local state)
DRATA_MCP_DRY_RUN=false                                       # optional, "true"/"1" makes mutations log and return payloads without sending
DRATA_MCP_AUDIT_LOG=/path/to/drata-mutating-requests.jsonl    # optional JSONL audit log for mutations
DRATA_HIDE_UNENTITLED_TOOLS=false                            # optional, "true"/"1" unregisters plan-gated (402) tools entirely
GITHUB_PAT=ghp_xxx                                            # optional, required for the scan_github_* tools (see GitHub Scanning setup)
GITHUB_API_URL=https://api.github.com                         # optional, GitHub Enterprise Server REST root, e.g. https://github.example.com/api/v3
GITHUB_ALLOW_INSECURE=0                                       # optional, "1" permits an http GITHUB_API_URL (local testing only)
```

**Base URL — EU and APAC tenants must set `DRATA_BASE_URL`.** When unset, the server defaults to the NA region (`https://public-api.drata.com`). If your Drata tenant is in the EU or APAC region, requests against the NA base URL will fail authentication, so set the variable explicitly:

- NA (default): `https://public-api.drata.com`
- EU: `https://public-api.eu.drata.com`
- APAC: `https://public-api.apac.drata.com`

The server prints the resolved base URL to stderr at startup (`[drata-mcp] Drata API base URL: ...`) so a misconfigured region is visible in the MCP server logs.

**Plan-gated tools.** On startup the server probes one endpoint per paid feature group (`GET /risk-registers`, `GET /custom-connections`). A **HTTP 402** marks that group **unavailable on this plan** — an account/plan entitlement, distinct from a 403 token-permission error. Detection fails open: a network blip or a future plan upgrade leaves every tool registered.

- **Default (`DRATA_HIDE_UNENTITLED_TOOLS=false`)**: gated tools stay registered but their description is prefixed with `⛔ UNAVAILABLE ON THIS PLAN …`, and calling one returns a clear, non-retryable 402 message naming the feature and the base-tier alternative. Upgrade-safe: buying the add-on auto-restores them.
- **`DRATA_HIDE_UNENTITLED_TOOLS=true`**: gated tools are not registered at all, for a clean surface on plans without the add-on.

The Risk Management Pro group covers `list_risk_registers`, `get_risk_insights`, `list_risk_documents` (+ register create/update and risk-document upload); base-tier risk reads (`list_risks`, `get_risk`, `list_risk_notes`) work without Pro — pass `riskRegisterId` or set `DRATA_RISK_REGISTER_ID`, since the only register enumerator (`list_risk_registers`) is itself Pro-gated.

**GitHub Scanning setup.** The `scan_github_*` tools read directly from the GitHub API — Drata's public API does not re-expose raw repo, branch-protection, Dependabot, or collaborator data. Set `GITHUB_PAT` to a token that can read the repositories you want to scan. Prefer a fine-grained token with read-only Repository permissions: Contents:read, Administration:read (branch protection), Metadata:read, and Dependabot alerts:read. A classic token also works with scopes `repo`, `read:org` and `security_events`, but it is not read-only: classic `repo` grants full read and write access to private repositories. `org`/`owner` default to the org of the connected Drata GitHub integration when omitted. For **GitHub Enterprise Server**, set `GITHUB_API_URL` to your instance's REST root (`https://<host>/api/v3`); it defaults to `https://api.github.com`, must be `https` (`GITHUB_ALLOW_INSECURE=1` permits `http` for local testing only), and must not carry credentials, a query string or a fragment.

**Local state (legacy fallback).** The server does not record vendor security reviews locally: it discovers them through Drata's official list endpoint. For compatibility with pre-release builds, which kept the IDs of reviews they created in a small JSON file, an existing file at `~/.local/state/drata-mcp/drata-state.json` (or wherever `DRATA_MCP_STATE_PATH` points) is still read as a fallback (see *Vendor Security Review Read Path*); a new installation has no such file. This fallback is deprecated and will be removed in a future release.

### Claude Code

```bash
claude mcp add drata \
  --env DRATA_API_KEY=your-key \
  --env DRATA_WORKSPACE_ID=1 \
  --env GITHUB_PAT=ghp_xxx \
  -- npx -y @yantratech/drata-mcp-server
```

(Running from source? Replace `npx -y @yantratech/drata-mcp-server` with `node /path/to/mcp-connectors/connectors/drata/dist/index.js`.)

EU/APAC tenants: add `--env DRATA_BASE_URL=https://public-api.eu.drata.com` (or the APAC URL).

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "drata": {
      "command": "npx",
      "args": ["-y", "@yantratech/drata-mcp-server"],
      "env": {
        "DRATA_API_KEY": "your-key",
        "DRATA_BASE_URL": "https://public-api.drata.com",
        "DRATA_WORKSPACE_ID": "1",
        "GITHUB_PAT": "ghp_xxx"
      }
    }
  }
}
```

Replace `DRATA_BASE_URL` with your region's URL (or remove the line to use the NA default).

(Running from source? Replace `command`/`args` with `"command": "node", "args": ["/path/to/mcp-connectors/connectors/drata/dist/index.js"]`.)

### Dry Run and Audit Log

Two safety knobs apply to every mutating tool (anything that is not a GET):

- `DRATA_MCP_DRY_RUN=true` (or `1`) short-circuits each mutation before its request is sent (a tool that reads first, such as `update_vendor`, still makes that read). The tool returns `{ dryRun: true, method, path, body }` so you can inspect exactly what would have been sent.
- `DRATA_MCP_AUDIT_LOG=/path/to/file.jsonl` appends one JSON line per mutation attempt — timestamp, method, path, request body, and (for real requests) the response status and body. Dry-run attempts are logged with `"dryRun": true`. The file and its parent directories are created on demand. If the log cannot be written, mutating tools (dry runs included) fail with an `Audit log unavailable` error before anything is sent. If an entry still cannot be written after Drata has answered, for example because the disk is full, the tool returns Drata's result (or error) unchanged plus an `Audit log warning` text block, which is also printed to stderr. When the warning says Drata applied the change, the change is in Drata: do not retry it.

> **Security:** the audit log records the **full request and response bodies in plaintext** — vendor PII, personnel data, account-manager names/emails, security-review notes, and evidence metadata. The bearer token is never written, but the recorded payloads are sensitive GRC data. The connector creates the log file with mode `0600` and any directory it creates with mode `0700` (owner-only), but if you point `DRATA_MCP_AUDIT_LOG` at a pre-existing directory or a shared location its existing permissions are left untouched — choose a protected path. Treat the file as confidential and rotate/delete it when no longer needed.

Both can be combined to rehearse a write workflow and keep a reviewable trail.

## Worked Example: Gap Analysis

A typical conversation: *"Run a SOC 2 gap analysis and tell me what to fix first."* The model calls:

```json
{
  "name": "run_gap_analysis",
  "arguments": { "frameworkFilter": "SOC 2" }
}
```

and receives a JSON report (truncated, illustrative values):

```json
{
  "overview": {
    "totalControls": 142,
    "readyControls": 97,
    "notReadyControls": 45,
    "readinessPercentage": 68,
    "totalMonitors": 180,
    "failingMonitors": 3,
    "passingMonitors": 158,
    "totalPersonnel": 38,
    "totalVendors": 24,
    "totalPolicies": 21,
    "totalConnections": 9
  },
  "semanticsNote": "Scope: control readiness/evidence/ownership/monitoring gaps (in-scope controls only) plus failing monitors bucketed by each monitor's own Drata priority (CRITICAL/HIGH/NORMAL/LOW). Personnel, vendors, policies, and connections are presence-checked only ... frameworkFilter scopes CONTROLS only; monitor and inventory numbers remain tenant-wide.",
  "gaps": {
    "critical": [],
    "high": [
      "FAILING MONITOR: MFA on Version Control (HIGH) — 2 GitHub users do not have MFA enabled",
      "12 controls have NO evidence. Top 10: DCF-26 (Backup Restoration Tested), DCF-21 (Incident Response Plan), ..."
    ],
    "medium": [
      "FAILING MONITOR: Background Checks (NORMAL) — 1 employee has no completed background check",
      "9 controls have NO owner. This blocks audit readiness.",
      "17 controls are NOT monitored (no automated test)."
    ],
    "low": [
      "FAILING MONITOR: Security Training (LOW) — 2 employees have not completed security awareness training"
    ]
  },
  "nextActions": [
    "PRIORITY 2: Assign owners to 9 controls.",
    "PRIORITY 2: Fix 3 failing monitors: MFA on Version Control, Background Checks, Security Training",
    "PRIORITY 3: Collect and upload evidence for 12 controls."
  ]
}
```

A failing monitor lands in the bucket that matches its own Drata priority (`CRITICAL`, `HIGH`, `NORMAL` → medium, `LOW`), so `critical` is empty unless a monitor is marked CRITICAL in Drata. Personnel, vendors, policies and connections are only checked for presence, as `semanticsNote` says.

From there the conversation usually continues with `check_control_status` (drill into the unready controls), `add_control_owner` (fix ownership gaps), and `create_evidence_library_item` (attach missing evidence).

## Key Tool Parameters

Parameter shapes for the most-used tools (all derived from the zod schemas in `src/tools/`). Optional parameters are marked `?`.

| Tool | Parameters |
|---|---|
| `run_gap_analysis` | `frameworkFilter?: string` — framework tag, e.g. `"SOC 2"`; omit for all |
| `check_control_status` | `filter: "all" \| "not_ready" \| "no_evidence" \| "no_owner" \| "not_monitored" \| "ready"`, `frameworkFilter?: string`, `codes?: string[]` (e.g. `["DCF-26"]`), `fields?: string[]` (e.g. `["id", "code", "isReady"]`), `includeArchived?: boolean`, `workspaceId?: number` |
| `list_controls` | `frameworkFilter?: string`, `codes?: string[]`, `fields?: string[]` |
| `list_evidence_library` | `workspaceId?: number`, `cursor?: string`, `size?: number` (1–500), `sort?: string`, `sortDir?: "ASC" \| "DESC"`, `includeTotalCount?: boolean`, `expand?: string[]`, `name?: string`, `statuses?: string[]`, `fields?: string[]` |
| `create_evidence_library_item` | exactly one of `fileBase64?: string`, `url?: string`, `ticketUrl?: string`; plus `workspaceId?: number`, `name?: string` (defaults to `fileName`), `description?: string`, `implementationGuidance?: string`, `ownerId?: number`, `controlIds?: number[]`, `filedAt?: string`, `renewalScheduleType?: "ONE_MONTH" \| ... \| "CUSTOM" \| "NONE"`, `renewalDate?: string`, `fileName?: string` |
| `create_vendor` | `name: string`, `category: "ENGINEERING" \| "PRODUCT" \| "MARKETING" \| "CS" \| "SALES" \| "FINANCE" \| "HR" \| "ADMINISTRATIVE" \| "SECURITY"`, `risk: "NONE" \| "LOW" \| "MODERATE" \| "HIGH"`, `critical: boolean`, `isSubProcessor: boolean`, `isSubProcessorActive: boolean`; optional: `userId`, `url`, `privacyUrl`, `termsUrl`, `servicesProvided`, `dataStored`, `location`, `hasPii`, `passwordPolicy`, `passwordMfaEnabled`, `renewalDate`, `renewalScheduleType`, `notes`, `impactLevel`, and more |
| `add_control_owner` | `controlId: number`, `userId: number`, `workspaceId?: number` |
| `create_task` | `body: object` (passed through to Drata V2), `workspaceId?: number` |
| `create_risk` | `body: object` (passed through to Drata V2), `riskRegisterId?: number` (defaults to `DRATA_RISK_REGISTER_ID`) |
| `scan_github_vulnerabilities` | `owner: string`, `repo: string`, `state?: "open" \| "fixed" \| "dismissed"` (defaults to `"open"`) |

Conventions that hold across the toolset:

- `workspaceId` is optional on V2 workspace-scoped tools and falls back to `DRATA_WORKSPACE_ID`; `riskRegisterId` falls back to `DRATA_RISK_REGISTER_ID`.
- V2 list tools use cursor pagination: pass the `cursor` from a previous response, with `size`, `sort`, `sortDir`, `includeTotalCount`, and `expand` where supported.
- `fields?: string[]` on list/check tools trims responses to the named fields — use it to keep large listings compact.
- Tool errors return MCP `isError: true` with a text description; they do not throw.

## API Coverage

| Capability | Status |
|---|---|
| Evidence upload to library | Supported (V2) |
| Evidence Library URL and ticket evidence | Supported (V2) |
| External control evidence download/delete | Supported (V1) |
| Control owner assignment | Supported (V2) |
| Control notes | Supported (V2) |
| Risk register and risk management | Supported (V2) |
| Tasks, audits, and audit requests | Supported (V2) |
| User, device, vendor, and risk document lookup | Supported (V2, use `expand: ["downloadUrl"]`) |
| Users and roles | Supported (V2) |
| Custom data records and sessions | Supported (V2) |
| Vendor security review create/list/read | Supported (V2) |
| Vendor management | Supported (V1 + V2) |
| Personnel updates | Supported (V2) |
| Background checks | Supported (V2) |
| Custom evidence connections | Supported (V2) |
| Control library and risk library templates | Supported (V2; feature-gated 💎) |
| Device drill-down (device, apps, personnel/connection devices) | Supported (V2) |
| GitHub security scanning | Supported (repos, branch protection, vulnerabilities, collaborators) |
| Policy approval workflow | Supported (V2 `perform_policy_action`: submit, approve, publish, etc.) |
| Policy content creation/upload | Not available (no documented endpoint; policy content is read-only via API) |
| Personnel creation | Not available (comes from IdP/HRIS sync) |
| Monitoring test configuration | Not available (API is read-only) |

## Vendor Security Review Read Path

Drata V2 exposes vendor security review creation, `GET /public/v2/vendors/{vendorId}/security-reviews/{securityReviewId}`, and an official list endpoint — implemented here as `list_vendor_security_reviews`, the primary way to discover review IDs. On some tenants, vendor `expand[]=reviews` and `expand[]=latestSecurityReviews` may still return empty arrays even when the Drata UI shows completed reviews; use `list_vendor_security_reviews` instead.

Review IDs found in a legacy local state file (see *Local state* above) are still verified by GET-by-ID as a read-only fallback, which is deprecated and will be removed in a future release; `create_vendor_security_review` and `create_vendor_security_review_with_file` never write to it. `check_vendor_risk` and `list_vendor_security_review_statuses` report `reviewSources` for each count:

- `api_list` - the official per-vendor list endpoint (primary source)
- `api_expand` - review arrays returned directly by vendor APIs
- `persisted_get_by_id` - a review ID from the legacy local state file was verified with GET-by-ID
- `event_log` - matching `VENDOR_SECURITY_REVIEW_STARTED` event was found
- `vendor_notes` - the vendor's free-text notes mention "security review" (case-insensitive), a heuristic that counts as at least one review of unknown status

`event_log` and `vendor_notes` are used only for vendors whose list call failed. `api_expand` (from the vendor payload) and `persisted_get_by_id` (legacy local state, for IDs the list did not return) are supplementary sources checked for every vendor. In `list_vendor_security_review_statuses`, a vendor with no COMPLETED review that has any review detected only by `event_log` or `vendor_notes`, or any review without a status, is reported as `UNKNOWN` rather than `NO_PAST_REVIEW`, because those sources cannot see review status.

Unknown review IDs return the Drata API error:

```json
{"statusCode":404,"message":"Not Found","code":10170,"debugInfo":null}
```

The events wrapper maps `since` to `createdAtFrom` and also filters client-side because Drata can ignore the date filter on broader event queries.

## Drata API Behaviour Notes

Quirks of the Drata API observed in live use, and how this connector handles them:

- `check_control_status` and `list_controls` include control `id`; both accept `codes[]` and `fields[]`.
- `list_vendors` and `list_evidence_library` accept `fields[]` for compact responses.
- `bulk_update_vendors` runs per-vendor `update_vendor` calls in parallel. It supports renewal fields and rejects unsupported/no-op updates so silently stripped fields cannot produce false success.
- `create_control_external_evidence` is a V1 multipart endpoint. Official docs require `renewalDate` even when `renewalScheduleType` is not `CUSTOM`, so the connector always sends it. The endpoint has been observed returning `{"statusCode":500,"message":"Internal server error","code":10010,...}` even for minimal valid calls; if that happens, prefer `create_evidence_library_item` with `controlIds`.
- Omitting `renewalScheduleType` on a raw evidence-library update causes Drata to reset the renewal schedule to `NONE`; `update_evidence_library_item` guards against this by preserving the current schedule when the field is omitted.
- Templated evidence details are immutable. Use `fulfil_templated_evidence` for minimal artifact attachment; attempting detail updates can return code `10000`.
- Control `isReady` is computed by Drata from mapped evidence, approvals, in-scope requirements, and monitor state. It cannot be set directly.
- Vendor security reviews can be created, listed (`list_vendor_security_reviews`), and read by ID, but no update-decision endpoint is documented; the beta `list_security_review_actions` only reports which actions are currently available on a review.
- Risk write endpoints are plan-gated: Drata plans without the risk module return `402`, which the connector surfaces with a remediation hint.
- `list_control_mapped_requirements` uses the documented V1 route `GET /controls/{id}/requirements`.
- The V1 (and V2 `flags`) control `hasEvidence` boolean only covers manually attached external evidence and evidence-library reports — NOT evidence from mapped policies or monitor tests, which the app's evidence view counts. `check_control_status` therefore aggregates all four sources from the V2 controls list expands (`flags`, `evidenceIds`, `testIds`); Drata's narrow flag is still echoed as `evidence.drataHasEvidenceFlag`.
- Unfulfilled evidence-library placeholders (status "Needs artifact" in the app) are invisible to the public API: they appear in neither `evidenceIds.validReportIds` nor `invalidReportIds`, and the evidence-library list ignores `controlId`. A control whose only "evidence" is an unfulfilled placeholder reports `hasEvidence: false` — same as Drata's own readiness treats it.
- The requirement-side `expand[]=controls` on `framework-requirements` is capped at 10 inline controls per requirement (`controls.totalCount` reveals the truncation; a SOC 2 requirement can map 30+). `get_framework_requirement_readiness_rollup` therefore builds the requirement→controls mapping from the V2 controls list's reverse `expand[]=requirements`, which live verification showed is complete, and cross-checks its derived counts against the framework object's `numInScopeRequirements` / `numReadyInScopeRequirements` (surfaced as `framework.drataReported` / `matchesDrataReported`).
- Requirement scope is not a field anywhere in the public API: a requirement is out of scope exactly when every control mapped to it is archived (verified against the in-scope SOC 2 requirement count shown in the Drata app).
- Monitoring-test ids live in two overlapping integer namespaces: the workspace-scoped `testId` and the internal monitor `id` (the one `list_monitors`/`check_monitors` report). A number can be valid in both at once, and `/monitoring-tests/{id}/failures` returns HTTP 200 with an empty list even for ids that are no test's `testId` — so `list_monitoring_test_failures` and `get_monitoring_test` resolve the caller's id against the workspace test list BEFORE fetching (accepting an explicit `monitorId` parameter), echo the resolved test identity, and flag ambiguous numbers instead of silently returning another test's data.
- Vendor security-review lists include scheduled shells (status `NOT_YET_STARTED`, or `NOT_REQUIRED`, decision `PENDING`) that the app does not count as past reviews; `list_vendor_security_review_statuses` counts only `COMPLETED` reviews as "has reviews" and surfaces the shells via `pendingReviewCount`.

## Dependencies

- `@modelcontextprotocol/sdk` — MCP protocol
- `zod` — Schema validation
- Node built-in `fetch` — HTTP client (no axios)

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](../../CONTRIBUTING.md) at the repository root.

## License

[MIT](./LICENSE) © Yantra Applied Technologies Limited. Portions adapted from [XeroAPI/xero-mcp-server](https://github.com/XeroAPI/xero-mcp-server) (MIT, © 2025 Xero Limited).

Drata is a trademark of its owner. This connector is an independent project and is not affiliated with or endorsed by Drata.
