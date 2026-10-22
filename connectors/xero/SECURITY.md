# Security Policy

This document describes the security posture of `@yantratech/xero-mcp-server`: the threat model, which Xero API endpoints are deliberately not exposed as tools, and which OAuth scopes the server requests.

## Reporting a Vulnerability

Please do not open public issues for security vulnerabilities. Report them privately following the repository-root [SECURITY.md](../../SECURITY.md), or email **security@yantratech.com**.

## Threat Model

This is a **local stdio MCP server**. It opens no network listener; it is spawned by an MCP client (Claude Desktop, an agent framework, etc.) and communicates over stdin/stdout.

- **Credentials** are supplied via environment variables (`XERO_CLIENT_ID` + `XERO_CLIENT_SECRET` for a Xero Custom Connection, or `XERO_CLIENT_BEARER_TOKEN` for a pre-issued token), which the server also loads from a `.env` file in its current working directory if one exists (variables already set in the environment take precedence). Credentials are sent only to Xero's identity and API endpoints and are never written to disk or logged.
- **The primary risk is not an external attacker — it is the connected model.** An AI agent with write access to an accounting system can do real financial damage with a single malformed call. The mitigations below (excluded endpoints, voiding rather than deleting posted invoices and journals, ID-targeted updates and deletes, and destructive-tool annotations) exist to bound that blast radius.
- Anyone who can set this server's environment variables already holds the Xero credentials; the server does not add a privilege boundary beyond the tool surface it exposes.

## Intentionally Excluded Endpoints

The following Xero API endpoints are **deliberately not exposed as tools**, to prevent accidental financial damage or data exposure via AI-initiated actions.

| Endpoint | Reason |
|---|---|
| **Payroll: Pay Runs, Payslips, Salary & Wages (writes)** | A single bad API call could pay incorrect amounts. Pay runs should be executed by a human in the Xero UI (or a dedicated payroll system); the auto-posted payroll journal is sufficient for accounting visibility. |
| **Payroll: Create/Update Employee** | Employee records contain sensitive PII (bank details, tax codes, national identifiers). Read-only access is exposed; writes must go through the Xero UI. |
| **Batch Payments** | Mass payment execution without human-in-the-loop review on every payment is too risky. |
| **Email Invoice** | Sending invoices directly to clients without human review could reach wrong recipients. |
| **Bank Feeds API** | Creates bank statement lines programmatically — could introduce fraudulent transactions. |
| **Delete Account** | Irreversible. Archiving is implemented instead (`archive_account`). |
| **Xero Practice Manager / HQ** | Accountant-facing products, out of scope for this server. |

Note: the payroll tools that *are* exposed (employees, leave, timesheets) use the Xero NZ Payroll API surface (`payrollNZApi` in `xero-node`), matching the upstream server this project was forked from.

## Xero API Limitations

| Endpoint | Limitation |
|---|---|
| **Update/Register/Dispose Asset** | The Xero Assets API only supports `GET` and `POST /Assets` (create). There is no PUT/PATCH/DELETE on `/Assets/{id}`. Draft assets can only be edited, registered, or disposed via the Xero UI. This is a [known Xero API limitation](https://xero.uservoice.com/forums/5528-accounting-api/suggestions/148322-fixed-assets-api), and is why this server has no `update_asset`, `register_asset`, or `dispose_asset` tools. |

## OAuth Scopes

When using client-credentials auth, the server requests the following 32 scopes for its token by default (see `src/consts/xero-scopes.ts`):

```
accounting.invoices accounting.invoices.read
accounting.payments accounting.payments.read
accounting.banktransactions accounting.banktransactions.read
accounting.manualjournals accounting.manualjournals.read
accounting.contacts accounting.contacts.read
accounting.settings accounting.settings.read
accounting.reports.balancesheet.read accounting.reports.banksummary.read
accounting.reports.profitandloss.read accounting.reports.trialbalance.read
accounting.reports.aged.read accounting.reports.executivesummary.read
accounting.reports.budgetsummary.read
accounting.attachments accounting.attachments.read
accounting.budgets.read
payroll.settings
payroll.employees.read
payroll.timesheets payroll.timesheets.read
assets assets.read
projects projects.read
files files.read
```

**Why these scopes:** each one backs at least one tool. `test/oauth-scopes.test.mjs` maps every payroll and report SDK call in the handlers to the scope it needs, and fails if a call has no mapping or its scope is not requested.

- The accounting, assets, projects, and files scopes are used by the matching tool families, for both reads and writes.
- `accounting.transactions(.read)` is **not** requested by default. Receipts has no granular scope, so these two deprecated broad scopes are added, and the receipt tools registered, only when the operator sets `XERO_ENABLE_RECEIPTS=1`. Custom Connections created on or after 29 April 2026 cannot be granted them, and Xero rejects a token request for an ungranted scope with `invalid_scope`.
- `accounting.journals.read` is **not** requested by default either. Xero no longer grants it to Custom Connections created on or after 29 April 2026 unless it grants them Advanced access (the Journals endpoint is now an Advanced-tier feature), so it is added, and `list_journals` and `get_journal` registered, only when the operator sets `XERO_ENABLE_JOURNALS=1`. Connections created before that date that hold the scope can still request it.
- `payroll.employees.read` backs the employee and employee-leave read tools.
- `payroll.timesheets` backs the timesheet create, approve, revert, delete and line tools.
- `payroll.settings` backs `list_payroll_leave_types`.

**Not requested.** These scopes are not requested because no tool uses them:

| Scope | Why it is not requested |
|---|---|
| `payroll.payruns`, `payroll.payruns.read` | Pay runs are an intentionally excluded endpoint (see above). |
| `payroll.payslip`, `payroll.payslip.read` | Payslips are an intentionally excluded endpoint. |
| `payroll.employees` (write) | Employee and leave tools are read-only, and `payroll.employees.read` covers them. |
| `accounting.reports.tenninetynine.read` | There is no 1099 report tool. |

**Remaining over-breadth.** `payroll.settings` is the write form, although the only settings call (`getLeaveTypes`) is a read. Swapping it for `payroll.settings.read` would make the server *request* a scope that existing Custom Connections may not have been granted. Xero then rejects the whole token request with `invalid_scope`, which breaks every tool, so the swap would need every connection owner to re-grant scopes first. Requesting *fewer* scopes never needs that coordination: a connection may hold scopes that the server does not ask for.

**Bearer-token mode** (`XERO_CLIENT_BEARER_TOKEN`) does not use this list. That token's scopes are whatever its issuer granted.

## Binary Outputs

The download family (`download_document_pdf`, `download_attachment`, `download_file_content`) returns file bytes by writing them to local disk, under a strict path policy (enforced in `src/helpers/save-binary-response.ts`):

- Bytes are written only to a **caller-supplied absolute `outputPath`** — relative paths are rejected, and the server never picks a location itself.
- The **parent directory must already exist**; the server never creates directories on the caller's behalf.
- An **existing file is never overwritten** unless the caller explicitly passes `overwrite: true`. New files are created with exclusive-create (`O_CREAT|O_EXCL`), so an existing path is never written through, even if it appears after the checks.
- **Symlinks are refused.** If the final component of `outputPath` is a symlink, dangling or not, the write is refused. A directory, FIFO or other non-regular file is also refused. The parent directory is resolved normally, so a symlinked parent directory is followed.
- With `overwrite: true`, the bytes go to a temp file in the same directory, which is then **renamed over** `outputPath`. The replacement is atomic, keeps the replaced file's permission bits, and a symlink swapped in at the last moment is replaced rather than followed. The existing file must itself be writable, so a read-only file is never replaced. The file gets a new inode, so hard links to the old file keep the old contents, and the owner, group, ACLs and extended attributes are not carried over (only the permission bits are).
- **Permissions.** A new file gets the default mode for the server process's umask (typically `0644`, which other local users can read); the server does not restrict it further. On a shared machine, run the server with a restrictive umask (for example `077`) or write only into a directory that other users cannot read.
- Because these tools write local files and can replace them, they are annotated **`readOnlyHint: false, destructiveHint: true, idempotentHint: false`**, not as reads. MCP clients that gate destructive tools will ask before running them.
- **File bytes are never returned into model context** — the tool result contains only the written path, size in bytes, and metadata (file name, content type, document number).
- Xero caps attachments at **~25 MB**, which bounds memory use: the `xero-node` SDK buffers each whole response in memory (no streaming).

## Outbound fetch / local file access

Beyond Xero's identity/API endpoints, a prompt-injected model could try to use the server as a confused deputy: make it fetch from, or read files on, the machine it runs on, then read the bytes back from the Xero attachment it uploads them to. Three tool inputs are therefore constrained.

**`upload_attachment` `fileUrl` (outbound fetch).** The server fetches the bytes from its own network position, through `src/helpers/safe-fetch-url.ts`:

- Only `http` and `https` URLs are allowed.
- The host is DNS-resolved once, and **every** resolved address must be public unicast. Private, loopback, link-local (including `169.254.169.254` cloud metadata), CGNAT, unique-local, multicast and reserved ranges are rejected.
- IPv6 addresses are parsed to their 16 bytes, so an IPv4 address embedded in IPv6 is checked against the IPv4 rules whatever its textual form. This covers IPv4-mapped (`::ffff:0:0/96`, e.g. `[::ffff:7f00:1]` and `[::ffff:a9fe:a9fe]`), IPv4-compatible (`::/96`), IPv4-translated, NAT64 (`64:ff9b::/96`) and 6to4 (`2002::/16`). The rest of `64:ff9b::/32` (including the NAT64 local-use prefix `64:ff9b:1::/48`) and Teredo (`2001::/32`) are blocked outright.
- The connection is **pinned to the validated address** (a custom `lookup` on `http(s).request`), so DNS cannot be re-resolved to an internal address between the check and the connect (DNS rebinding). TLS still verifies the certificate against the URL's hostname.
- Redirects are followed manually (at most 5), and each hop is re-validated and re-pinned.
- The response is capped at **25 MB**, both from a declared `Content-Length` and while streaming. A request is aborted after 30 seconds idle or 120 seconds in total.

**`upload_attachment` `filePath` and `upload_file` `filePath` (local file reads).** Enforced by `src/helpers/resolve-upload-path.ts`:

- The path must be absolute. It is resolved with `realpath`, which collapses `..` and symlinks and maps macOS `/var` to `/private/var`.
- The resolved file must be either a temp file that `prepare_attachment` created in this server process, or inside the directory named by the optional **`XERO_UPLOAD_DIR`** environment variable. Nothing else on disk can be uploaded. If `XERO_UPLOAD_DIR` is unset, only `prepare_attachment` files are allowed.
- The file is opened with `O_NOFOLLOW` and checked with `fstat` on the open descriptor. It must be a regular file (not a directory, FIFO or device) no larger than **10 MB**, and the bytes are read from that same descriptor.
- A refused path fails before authentication, so no Xero call is made.

**`prepare_attachment` temp files.** Staged content is written to a new file in the OS temp directory (`os.tmpdir()`), with the same umask-based permissions as downloads. The server does not delete staged files, either after an upload or when it exits, so they stay on disk until you or the operating system remove them. On Linux, `os.tmpdir()` is the shared `/tmp` unless `TMPDIR` is set; on a shared host, point `TMPDIR` at a private directory for the server process.

Anyone who can set `XERO_UPLOAD_DIR` controls the server's configuration and is trusted. Point it at a dedicated directory, not at a home directory. The check does not defend against another local user racing to swap directory components inside `XERO_UPLOAD_DIR` between the `realpath` and the `open`; keep that directory writable only by the user running the server. On Windows, `O_NOFOLLOW` is not available and the symlink protection rests on the `realpath` check alone.

**`upload_attachment` visibility.** Attachments on invoices and credit notes are **not** shown to the customer on the online invoice unless the caller passes `includeOnline: true`.

**`get_fx_rate`.** This tool fetches historical FX rates from two fixed, trusted hosts (`api.frankfurter.app` and `cdn.jsdelivr.net`). The `date` and currency inputs are format-validated (`YYYY-MM-DD`/`latest`, 3-letter ISO codes) before being put into the request URL, so they cannot change the request path or query.

## Design Principles

1. **Read operations cannot modify Xero data, but they are not harmless.** All `list_*`/`get_*` tools are unrestricted, and they return accounting, bank, contact and payroll data (including employees' personal details) into the model's context, and so to whoever hosts the model. Connect the server only to an organisation and a model where that exposure is acceptable.
2. **Updates and deletes target explicit entity IDs.** The one write that can change existing records without naming them by ID is `batch_create_contacts`, which uses Xero's create-or-update: an entry whose name matches an existing contact updates that contact (up to 50 per call). `batch_create_invoices` sends no invoice IDs or numbers, so it only creates new drafts.
3. **Destructive tools are annotated `destructiveHint: true`** so MCP clients can ask before running them. The permanent ones also warn in their descriptions (e.g. `void_invoice` warns it is permanent; `delete_draft_invoice` instructs the model to confirm with the user first); `delete_timesheet`, `delete_linked_transaction`, `delete_file_association` and `revert_timesheet` carry the annotation only.
4. **Posted accounting records are voided or archived, not deleted** — `void_invoice`, `void_manual_journal`, `archive_account`; `delete_draft_invoice` only sets a DRAFT invoice to DELETED, and `delete_payment` is Xero's own soft-delete status change. `delete_timesheet`, `delete_linked_transaction`, `delete_time_entry` and `delete_project_task` delete their records outright (payroll timesheets, billable-expense links and project records), and `delete_file_association` removes a file's link to an object outright (the file itself is kept). `update_manual_journal` also accepts `VOIDED`, `DELETED` and `ARCHIVED` statuses, and `update_purchase_order` a `DELETED` status; both are annotated destructive but carry no confirm-first wording.
5. **Least-privilege OAuth scopes.** The token requests only the scopes the exposed tools use (see [OAuth Scopes](#oauth-scopes)). The one documented exception is `payroll.settings`.
