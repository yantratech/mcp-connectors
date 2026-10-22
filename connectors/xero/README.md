# @yantratech/xero-mcp-server

An unofficial, extended fork of [XeroAPI/xero-mcp-server](https://github.com/XeroAPI/xero-mcp-server) that exposes **148 tools** by default (**153** with both opt-ins: `XERO_ENABLE_RECEIPTS=1` adds the 3 receipt tools and `XERO_ENABLE_JOURNALS=1` adds the 2 journal tools) covering the Xero **Accounting**, **Payroll (NZ/UK)**, **Fixed Assets**, **Projects**, and **Files** APIs as a [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server over stdio. Where the upstream server focuses on a core set of accounting operations, this fork adds read coverage of budgets, the main financial reports, prepayments, overpayments, linked transactions and (opt-in) system journals, write support for purchase orders, repeating invoices, (opt-in) receipts, bank transfers, projects and fixed assets, file/attachment handling, binary downloads of document PDFs, attachments and library files to local paths, batch creation, invoice lifecycle management (approve/void/delete), and a standalone historical FX-rate lookup — while deliberately excluding the highest-risk endpoints (see [Excluded capabilities](#excluded-capabilities)).

## Installation

```bash
npm install @yantratech/xero-mcp-server
# or run directly
npx -y @yantratech/xero-mcp-server
```

> **Note:** publication of `@yantratech/xero-mcp-server` to the public npm registry is in progress. Until it is live, run the server from source:
>
> ```bash
> git clone https://github.com/yantratech/mcp-connectors.git
> cd mcp-connectors/connectors/xero
> npm install
> npm run build
> node dist/index.js
> ```
>
> Where a client configuration below uses `npx -y @yantratech/xero-mcp-server`, you can substitute `node /absolute/path/to/mcp-connectors/connectors/xero/dist/index.js`.

Requires Node.js 22 or higher.

## Authentication

The server supports two authentication modes, controlled entirely by environment variables. The server reads them at startup and exits with an error if neither mode is configured.

| Environment variable | Mode | Notes |
|---|---|---|
| `XERO_CLIENT_ID` | Custom Connections | Required together with `XERO_CLIENT_SECRET` |
| `XERO_CLIENT_SECRET` | Custom Connections | Required together with `XERO_CLIENT_ID` |
| `XERO_CLIENT_BEARER_TOKEN` | Bearer token | If set, **takes precedence** over `XERO_CLIENT_ID`/`XERO_CLIENT_SECRET` |

In both modes the server operates against the **first organisation** connected to the credentials.

The server also loads a `.env` file from its **current working directory**, if one exists (see [`.env.example`](.env.example)). Variables already set in the environment take precedence over the file. MCP clients usually start servers in a directory you do not control, so prefer the client's `env` block shown under [Client configuration](#client-configuration), and keep any `.env` file out of version control.

Optional settings:

| Environment variable | Notes |
|---|---|
| `XERO_ENABLE_RECEIPTS` | Set to `1` to request the deprecated `accounting.transactions(.read)` scopes and register the receipt tools (`list_receipts`, `get_receipt`, `create_receipt`). Off by default: Custom Connections created on or after 29 April 2026 cannot be granted those scopes. See [Mode 1](#mode-1-custom-connections-recommended). |
| `XERO_ENABLE_JOURNALS` | Set to `1` to request `accounting.journals.read` and register the journal tools (`list_journals`, `get_journal`). Off by default: Xero does not grant that scope to Custom Connections created on or after 29 April 2026 unless it grants them Advanced access. See [Mode 1](#mode-1-custom-connections-recommended). |
| `XERO_UPLOAD_DIR` | Absolute path of a directory whose files `upload_file` and `upload_attachment` (`filePath`) may read. Without it, only files staged with `prepare_attachment` can be uploaded from local disk. See [SECURITY.md](./SECURITY.md#outbound-fetch--local-file-access). |

### Mode 1: Custom Connections (recommended)

Best for development and for single-organisation use with MCP clients such as Claude Desktop or Claude Code. Uses the OAuth 2.0 `client_credentials` grant — no interactive login.

To create credentials:

1. Sign up for a Xero account at [xero.com/signup](https://www.xero.com/signup/) if you don't have one. A **Demo Company** (top-left organisation dropdown) is a good starting point — it ships with sample data and can be reset at any time from [My Xero](https://my.xero.com). For the payroll tools the organisation region must be **NZ or UK**.
2. Set up a Custom Connection at [developer.xero.com](https://developer.xero.com/) following Xero's guide: <https://developer.xero.com/documentation/guides/oauth2/custom-connections/>. This gives you a client ID and client secret scoped to one organisation.
3. When configuring the Custom Connection, grant the scopes listed below. If you set `XERO_ENABLE_RECEIPTS=1`, also grant `accounting.transactions` and `accounting.transactions.read` (only possible on connections created before 29 April 2026). If you set `XERO_ENABLE_JOURNALS=1`, the connection must also have `accounting.journals.read`, which only connections created before 29 April 2026 can have unless Xero grants Advanced access (see the **Journals** note below).

By default the server requests the following scopes (see [`src/consts/xero-scopes.ts`](src/consts/xero-scopes.ts), and [SECURITY.md](SECURITY.md#oauth-scopes) for why each one is needed):

```text
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

The list contains neither the deprecated broad scopes nor `accounting.journals.read`, which Xero withholds from Custom Connections created on or after 29 April 2026, so a new connection (for example a new Demo Company connection) can be granted every scope in it.

> **Granular scope migration.** Xero is replacing its broad accounting scopes
> with granular ones; the broad scopes remain valid only until **September
> 2027**, and Custom Connections created on/after **29 April 2026** can only be
> granted granular scopes. This connector uses the granular transaction
> (`accounting.invoices`/`payments`/`banktransactions`/`manualjournals`) and
> report scopes above, and does **not** request the deprecated broad
> `accounting.transactions(.read)` scopes by default. The **Receipts** endpoint
> has no granular scope of its own, so the receipt tools (`list_receipts`,
> `get_receipt`, `create_receipt`) and the `receipts` entity type on the
> attachment and history tools are available only when you set
> `XERO_ENABLE_RECEIPTS=1`. The server then also requests
> `accounting.transactions accounting.transactions.read`, which the connection
> must have been granted; otherwise Xero rejects the token request with
> `invalid_scope` and every tool fails.

> **Journals.** Xero no longer grants `accounting.journals.read` to Custom
> Connections created on or after **29 April 2026**, and it now offers the
> [Journals endpoint](https://developer.xero.com/documentation/api/accounting/journals)
> only from its **Advanced** tier. So the server does not request that scope
> by default, and the journal tools (`list_journals`, `get_journal`) are
> registered only when you set `XERO_ENABLE_JOURNALS=1`.
>
> - A Custom Connection created **before 29 April 2026** can still request
>   journals: if it has been granted `accounting.journals.read`, set
>   `XERO_ENABLE_JOURNALS=1`.
> - A Custom Connection created **on or after 29 April 2026** cannot request
>   journals unless Xero grants it Advanced access. Leave
>   `XERO_ENABLE_JOURNALS` unset: with it set, the server requests a scope the
>   connection was not granted, so Xero rejects the token request with
>   `invalid_scope` and every tool fails.
>
> Manual journals are a different endpoint: `list_manual_journals`,
> `get_manual_journal` and the other manual-journal tools use the default
> `accounting.manualjournals` scopes and are always registered.

> **Migrating from XeroAPI/xero-mcp-server?** This server requests its own
> scope set (the list above), not the upstream server's. Among other
> differences, it adds the `.read` variants and scopes for attachments,
> budgets, more reports, fixed assets, projects and files, and it does not
> request the broad `accounting.transactions` (unless
> `XERO_ENABLE_RECEIPTS=1`) or `accounting.reports.read` scopes. It requests
> `accounting.journals.read`, for the journal tools, only with
> `XERO_ENABLE_JOURNALS=1` (see **Journals** above). Before you switch, grant
> your Custom Connection every scope in the list at developer.xero.com;
> otherwise Xero rejects the token request with `invalid_scope` and every tool
> fails. The upstream `XERO_SCOPES` override is not supported.

### Mode 2: Bearer token

Best when your MCP client manages the OAuth flow itself (e.g. PKCE) or you need to switch between Xero accounts at runtime. Set `XERO_CLIENT_BEARER_TOKEN` to a valid Xero access token; the token must already carry the scopes above (or the subset you need). Token refresh is your responsibility — the server does not refresh bearer tokens. `XERO_ENABLE_RECEIPTS=1` and `XERO_ENABLE_JOURNALS=1` still control whether the receipt and journal tools are registered; the token itself must carry `accounting.transactions` (receipts) or `accounting.journals.read` (journals) for them to work.

## Client configuration

Use placeholders as shown — never commit real credentials.

### Claude Desktop

Go to **Settings → Developer → Edit Config** and add the following to `claude_desktop_config.json` (replace the `${...}` placeholders with your actual values — Claude Desktop does not expand environment variables):

```json
{
  "mcpServers": {
    "xero": {
      "command": "npx",
      "args": ["-y", "@yantratech/xero-mcp-server"],
      "env": {
        "XERO_CLIENT_ID": "${XERO_CLIENT_ID}",
        "XERO_CLIENT_SECRET": "${XERO_CLIENT_SECRET}"
      }
    }
  }
}
```

For bearer-token mode, replace the `env` block with `"XERO_CLIENT_BEARER_TOKEN": "${XERO_CLIENT_BEARER_TOKEN}"`.

> If you use a Node version manager (nvm/fnm), replace `"npx"` with the absolute path to the executable, e.g. `/Users/you/.nvm/versions/node/v22.14.0/bin/npx`. Write the path out in full: MCP clients start the server without a shell, so `~` is not expanded.

### Claude Code

```bash
claude mcp add xero \
  --env XERO_CLIENT_ID="${XERO_CLIENT_ID}" \
  --env XERO_CLIENT_SECRET="${XERO_CLIENT_SECRET}" \
  -- npx -y @yantratech/xero-mcp-server
```

## Tool reference

All 153 tools, grouped by family (the 3 receipt tools are registered only with `XERO_ENABLE_RECEIPTS=1`, and the 2 journal tools only with `XERO_ENABLE_JOURNALS=1`). Tool names are `snake_case` and match the server exactly. Parameter shapes are shown for the most commonly used tools; for everything else, the tool's MCP schema (visible in any MCP client) is the authoritative reference.

Conventions used throughout:

- Most paginated list tools return **10 items per page** (`list_contacts` returns 100) and take a `page` number.
- IDs are Xero GUIDs, obtainable from the corresponding `list_*` tool.
- Create/update tools for invoices, contacts, credit notes, quotes, payments and bank transactions return a **deep link** to the record in the Xero web UI.

### List tools (Accounting) — 34

| Tool | Description |
|---|---|
| `list_accounts` | List the chart of accounts (codes, names, types) |
| `list_aged_payables_by_contact` | Aged payables for a contact as at a report date (invoice window pinned to the report date; compact rows, capped with totals always exact) |
| `list_aged_receivables_by_contact` | Aged receivables for a contact as at a report date (invoice window pinned to the report date; compact rows, capped with totals always exact) |
| `list_bank_summary` | Bank Summary report: opening balance, cash in/out, closing balance per bank account |
| `list_bank_transactions` | List bank transactions, optionally filtered by bank account (paginated) |
| `list_bank_transfers` | List bank transfers between bank accounts (paginated) |
| `list_branding_themes` | List branding themes (for use when creating invoices) |
| `list_budget_summary` | Budget Summary report for the organisation |
| `list_budgets` | List budgets with names and periods (use `get_budget` for the full breakdown) |
| `list_contact_groups` | List contact groups; optionally one group with its member contacts |
| `list_contacts` | List customers and suppliers (paginated, 100/page; text search and account-number filter) |
| `list_credit_notes` | List credit notes, optionally for a specific contact (paginated; DELETED/VOIDED excluded by default, `statuses` to override) |
| `list_currencies` | List currencies set up in the organisation |
| `list_executive_summary` | Executive Summary report: cash, debtors, creditors, income/expenses |
| `list_invoices` | List invoices, filterable by contact or invoice number (paginated; DELETED/VOIDED excluded by default, `statuses` to override) |
| `list_items` | List inventory/service items with codes and descriptions |
| `list_journals` | List system-generated journals (read-only full ledger), offset-based (requires `XERO_ENABLE_JOURNALS=1`) |
| `list_linked_transactions` | List billable-expense linked transactions, filterable by source/contact/status/target |
| `list_manual_journals` | List manual journals, filterable by ID, modified-after date or journal-date range (`dateFrom`/`dateTo`), sortable via `order` (paginated; DELETED/VOIDED excluded by default, `statuses` to override; lines show tracking) |
| `list_organisation_details` | Details of the connected organisation |
| `list_overpayments` | List overpayments (paginated) |
| `list_payments` | List payments, filterable by invoice, payment ID, or reference (paginated; DELETED excluded by default, `includeDeleted` to override) |
| `list_prepayments` | List prepayments (paginated) |
| `list_profit_and_loss` | Profit & Loss report over a period |
| `list_profit_and_loss_with_tracking` | P&L filtered by up to two tracking categories (e.g. department, cost centre) |
| `list_purchase_orders` | List purchase orders (paginated) |
| `list_quotes` | List quotes, optionally for a contact (paginated) |
| `list_receipts` | List receipts (expense claims) (requires `XERO_ENABLE_RECEIPTS=1`) |
| `list_repeating_invoices` | List repeating-invoice templates (both ACCREC and ACCPAY) |
| `list_report_balance_sheet` | Balance Sheet report |
| `list_tax_rates` | List tax rates (source of `taxType` codes for line items) |
| `list_tracking_categories` | List tracking categories and their options |
| `list_trial_balance` | Trial balance snapshot of the general ledger |
| `list_users` | List the organisation's users (resolves user IDs referenced by history records and approvals) |

**`list_invoices`**

```text
page             number     required  — page number (10 invoices per page)
contactIds       string[]   optional  — filter by contact ID(s)
invoiceNumbers   string[]   optional  — filter by invoice number(s); also returns line items
```

**`list_contacts`**

```text
page             number     optional  — 100 contacts per page
searchTerm       string     optional  — case-insensitive search across Name, FirstName, LastName, ContactNumber, EmailAddress
accountNumber    string     optional  — exact AccountNumber match (server-side filter)
```

**`list_profit_and_loss`**

```text
fromDate         string     optional  — YYYY-MM-DD
toDate           string     optional  — YYYY-MM-DD
periods          number     optional  — number of comparison periods
timeframe        enum       optional  — "MONTH" | "QUARTER" | "YEAR"
standardLayout   boolean    optional
paymentsOnly     boolean    optional
```

### Get tools (Accounting) — 23

| Tool | Description |
|---|---|
| `get_account` | Account by ID, including type, tax type, and bank account info |
| `get_bank_transaction` | Bank transaction by ID with line items and reconciliation status |
| `get_bank_transaction_history` | History and notes for a bank transaction |
| `get_bank_transfer` | Bank transfer by ID with linked transactions |
| `get_budget` | Full budget breakdown by account code and period |
| `get_contact` | Contact by ID with addresses, phones, tax types, and outstanding/overdue AR/AP balances |
| `get_contact_history` | History and notes for a contact |
| `get_credit_note` | Credit note by ID with amounts and remaining credit |
| `get_history` | History and notes for an entity by type and ID (credit notes, payments, purchase orders, quotes, items, manual journals, bank transfers, prepayments, overpayments, receipts, repeating invoices) |
| `get_invoice` | Invoice by ID with line items, amounts, and payment status |
| `get_invoice_history` | History and notes for an invoice |
| `get_item` | Item by ID with purchase and sales details |
| `get_journal` | System journal by ID with all journal lines, read-only (requires `XERO_ENABLE_JOURNALS=1`) |
| `get_manual_journal` | Manual journal by ID with journal lines |
| `get_overpayment` | Overpayment by ID with line items and allocations |
| `get_payment` | Payment by ID with currency-labelled amount, invoice, and account info |
| `get_prepayment` | Prepayment by ID with line items and allocations |
| `get_purchase_order` | Purchase order by ID with line items |
| `get_quote` | Quote by ID with amounts and expiry date |
| `get_receipt` | Receipt (expense claim) by ID with line items (requires `XERO_ENABLE_RECEIPTS=1`) |
| `get_repeating_invoice` | Repeating invoice by ID with line items and schedule |
| `get_tax_rate` | Tax rate by its TaxType code (single-lookup complement to `list_tax_rates`) |
| `get_user` | Organisation user by ID (name, email, organisation role) |

**`get_invoice`** (and similarly `approve_invoice`, `void_invoice`, `delete_draft_invoice`)

```text
invoiceId        string     required  — from list_invoices
```

### Create tools (Accounting) — 19

| Tool | Description |
|---|---|
| `create_account` | Add an account to the chart of accounts (name, code, type) |
| `create_bank_transaction` | Record a spend/receive-money bank transaction |
| `create_bank_transfer` | Record a transfer between two of the organisation's bank accounts in Xero (a ledger entry; no bank is instructed to move money) |
| `create_contact` | Create a customer/supplier contact |
| `create_contact_history_note` | Add a note to a contact's history |
| `create_credit_note` | Create a credit note |
| `create_currency` | Add a currency (ISO 4217 code) to the organisation |
| `create_invoice` | Create a sales invoice (ACCREC) or bill (ACCPAY) in DRAFT |
| `create_invoice_history_note` | Add a note to an invoice's history |
| `create_item` | Create an inventory/service item |
| `create_linked_transaction` | Create a billable expense linking a source line item to a contact |
| `create_manual_journal` | Create a manual journal (balanced debit/credit lines) |
| `create_payment` | Record a payment against an AUTHORISED invoice |
| `create_purchase_order` | Create a purchase order in DRAFT |
| `create_quote` | Create a quote |
| `create_receipt` | Create a receipt (expense claim) in DRAFT for a Xero user (requires `XERO_ENABLE_RECEIPTS=1`) |
| `create_repeating_invoice` | Create a repeating-invoice template (ACCREC or ACCPAY) |
| `create_tracking_category` | Create a tracking category |
| `create_tracking_options` | Add options to a tracking category |

**`create_invoice`**

```text
contactId        string                 required  — from list_contacts
type             "ACCREC" | "ACCPAY"    required  — ACCREC = sales invoice, ACCPAY = bill
lineItems        LineItem[]             required
reference        string                 optional
date             string (YYYY-MM-DD)    optional
currencyCode     string (ISO 4217)      optional  — defaults to the contact's currency
invoiceNumber    string                 optional  — ACCREC only; for bills use `reference`

LineItem:
  description    string                 required
  quantity       number                 required
  unitAmount     number                 required
  accountCode    string                 required  — from list_accounts
  taxType        string                 required  — from list_tax_rates
  itemCode       string                 optional  — from list_items
  tracking       Tracking[]             optional  — up to 2 (name, option, trackingCategoryID)
```

**`update_invoice`** (draft invoices only — all line items must be re-supplied; omitted lines are removed)

```text
invoiceId        string                 required
lineItems        LineItem[]             optional
reference        string                 optional
dueDate          string                 optional
date             string                 optional
contactId        string                 optional
invoiceNumber    string                 optional  — ACCREC only
```

**`create_contact`**

```text
name             string                 required
email            string                 optional
phone            string                 optional  — legacy single phone (MOBILE); ignored if `phones` given
accountNumber    string                 optional  — customer account number / contact code
addresses        Address[]              optional  — typed: POBOX (printed on invoices) / STREET / DELIVERY
phones           Phone[]                optional  — typed: DEFAULT / MOBILE / FAX / DDI
```

**`create_payment`**

```text
invoiceId        string                 required  — invoice must be AUTHORISED and not fully paid
accountId        string                 required  — account the payment is made from
amount           number                 required  — positive; must not exceed amount due
date             string (YYYY-MM-DD)    optional
reference        string                 optional
```

**`create_credit_note`**

```text
contactId        string                 required
lineItems        LineItem[]             required  — same shape as create_invoice
reference        string                 optional
currencyCode     string (ISO 4217)      optional
creditNoteNumber string                 optional  — auto-assigned if omitted
```

**`create_manual_journal`**

```text
narration               string          required
manualJournalLines      JournalLine[]   required  — at least two lines; debits positive, credits negative, must balance
date                    string          optional  — YYYY-MM-DD
lineAmountTypes         enum            optional  — "EXCLUSIVE" | "INCLUSIVE" | "NO_TAX" (default NO_TAX)
status                  enum            optional  — "DRAFT" | "POSTED" | ... (default DRAFT)
url                     string          optional  — link to a source document
showOnCashBasisReports  boolean         optional  — default true

JournalLine:
  lineAmount     number                 required
  accountCode    string                 required
  description    string                 optional
  taxType        string                 optional
  tracking       Tracking[]             optional  — at most 2, one per category

Tracking:  (names/IDs from list_tracking_categories)
  name                string            required  — tracking category name, e.g. "Region"
  option              string            required  — option name, e.g. "North"
  trackingCategoryID  string (GUID)     optional
  trackingOptionID    string (GUID)     optional
```

### Update tools (Accounting) — 16

| Tool | Description |
|---|---|
| `approve_invoice` | Approve a draft invoice or bill (DRAFT → AUTHORISED) |
| `archive_account` | Archive an account (reversible; deletion intentionally not implemented) |
| `update_account` | Update a chart-of-accounts entry |
| `update_bank_transaction` | Update a bank transaction |
| `update_contact` | Update a contact (PUT semantics: omitted fields are preserved) |
| `update_credit_note` | Update a draft credit note (all line items must be re-supplied) |
| `update_invoice` | Update a draft invoice (all line items must be re-supplied) |
| `update_item` | Update an item |
| `update_linked_transaction` | Assign a contact or target transaction to a linked transaction |
| `update_manual_journal` | Update a draft manual journal (same line shape as `create_manual_journal`, incl. tracking) |
| `update_purchase_order` | Update a purchase order's line items, dates, reference, or status |
| `update_quote` | Update a draft quote (all line items must be re-supplied) |
| `update_tracking_category` | Update a tracking category |
| `update_tracking_options` | Update options on a tracking category |
| `void_invoice` | Void an AUTHORISED invoice — **permanent**, cannot be undone |
| `void_manual_journal` | Void a POSTED manual journal — **permanent**, cannot be undone |

### Delete tools (Accounting) — 3

| Tool | Description |
|---|---|
| `delete_draft_invoice` | Permanently delete a DRAFT invoice or bill (authorised invoices must be voided instead) |
| `delete_linked_transaction` | Delete a billable-expense linked transaction |
| `delete_payment` | Soft-delete a payment (status → DELETED; cannot be restored) |

### Batch tools — 2

| Tool | Description |
|---|---|
| `batch_create_contacts` | Create up to 50 contacts in one call (existing contacts with the same name are updated) |
| `batch_create_invoices` | Create up to 50 invoices in one call, all in DRAFT status |

**`batch_create_invoices`**

```text
invoices         Invoice[]  required  — max 50; each entry has the create_invoice shape
summarizeErrors  boolean    optional  — true (default) = error summary; false = per-invoice error detail
```

### Files & attachments — 16

| Tool | Description |
|---|---|
| `upload_file` | Upload a local file (staged with `prepare_attachment` or under `XERO_UPLOAD_DIR`, max 10 MB) to Xero Files (inbox by default, or a specific folder) |
| `list_files` | Browse files stored in Xero Files |
| `get_file` | File metadata by ID, including folder information |
| `create_folder` | Create a folder in Xero Files |
| `list_folders` | List folders in Xero Files |
| `get_folder` | Folder details by ID, including file count |
| `get_files_inbox` | The Xero Files Inbox folder: ID, file count, and the email address for emailing documents in |
| `create_file_association` | Link a file in Xero Files to a Xero object (invoice, contact, …) |
| `list_file_associations` | List the objects a given file is linked to |
| `list_object_associations` | List the files linked to a given object |
| `get_file_associations_count` | Batch count of files associated with each of up to 50 object IDs |
| `delete_file_association` | Unlink a file from an object (the file itself is kept) |
| `list_attachments` | List attachments on an entity (invoice, contact, manual journal, bank transaction, credit note, quote, receipt) |
| `get_attachment` | Attachment details and download URL |
| `upload_attachment` | Attach a file to an entity, from a public URL, an allowed local path, or base64 content |
| `prepare_attachment` | Buffer base64 chunks into a temp file for `upload_attachment` / `upload_file`, so a large file never has to fit in one tool call (the server does not delete staged files; see [SECURITY.md](SECURITY.md#outbound-fetch--local-file-access)) |

**`upload_attachment`**

```text
entityType       enum       required  — "invoices" | "contacts" | "manualJournals" | "bankTransactions" | "creditNotes" | "quotes" | "receipts"
entityId         string     required
fileName         string     required  — name the file should have in Xero (e.g. "receipt.pdf")
contentType      string     required  — MIME type (e.g. "application/pdf"); sent to Xero as the attachment's type
fileUrl          string     optional  — public http(s) URL the server fetches directly (best from sandboxed environments)
fileContent      string     optional  — base64-encoded content
filePath         string     optional  — absolute path of a prepare_attachment temp file or a file under XERO_UPLOAD_DIR
                                        provide one of the three; priority: fileUrl > fileContent > filePath
includeOnline    boolean    optional  — invoices and creditNotes only: show the file to the customer online (default false)
```

### Downloads & documents — 4

| Tool | Description |
|---|---|
| `download_document_pdf` | Download an invoice (sales invoice or ACCPAY bill), credit note, quote, or purchase order as a PDF to a local path |
| `get_invoice_online_url` | Shareable online invoice ("pay now") URL for a sales (ACCREC) invoice — an alternative to emailing invoices from Xero, which this server does not do |
| `download_attachment` | Download an attachment's binary content from an entity (invoices, contacts, manual journals, bank transactions, credit notes, quotes, receipts, accounts, purchase orders, bank transfers, repeating invoices) to a local path |
| `download_file_content` | Download a file's binary content from the Xero file library to a local path |

> **Binary-output convention:** every `download_*` tool writes the bytes to a caller-supplied **absolute** `outputPath` (the parent directory must already exist), refuses to overwrite an existing file unless `overwrite: true` is passed, refuses to write through a symlink, and returns the written `path` plus `sizeBytes` and metadata — file bytes are **never** returned inline into model context. `get_invoice_online_url` returns a URL, not a file, so it takes no `outputPath`.

### Projects — 15

| Tool | Description |
|---|---|
| `list_projects` | List projects, filterable by contact and status |
| `get_project` | Project by ID with estimates, deadlines, and totals |
| `create_project` | Create a project (name required; optional contact, estimate, deadline) |
| `update_project` | Update a project (name required by the API) |
| `list_project_tasks` | List tasks within a project |
| `get_project_task` | Task by ID with rate, charge type, and totals |
| `create_project_task` | Create a task (charge type: TIME, FIXED, or NON_CHARGEABLE) |
| `update_project_task` | Update a task (name and charge type required) |
| `delete_project_task` | Permanently delete a task from a project |
| `list_project_users` | List users who can be assigned to projects and log time |
| `list_time_entries` | List time entries for a project |
| `get_time_entry` | Time entry by ID |
| `create_time_entry` | Log time against a project task (duration in minutes, 1–59940) |
| `update_time_entry` | Update a time entry (all fields required by the API) |
| `delete_time_entry` | Permanently delete a time entry |

### Payroll (NZ/UK) — 14

Requires the organisation region to be NZ or UK.

| Tool | Description |
|---|---|
| `list_payroll_employees` | Employee roster with personal and employment details |
| `list_payroll_employee_leave` | Leave records for an employee |
| `list_payroll_employee_leave_balances` | Current leave balances for an employee |
| `list_payroll_employee_leave_types` | Leave types available to an employee |
| `list_payroll_leave_periods` | Leave periods for an employee (dates, status, payment dates) |
| `list_payroll_leave_types` | All leave types configured in Xero Payroll |
| `list_timesheets` | List payroll timesheets |
| `get_timesheet` | Timesheet by ID |
| `create_timesheet` | Create a timesheet (employee, payroll calendar, dates, lines) |
| `add_timesheet_line` | Add a line to an existing timesheet |
| `update_timesheet_line` | Update a line on an existing timesheet |
| `approve_timesheet` | Approve a timesheet |
| `revert_timesheet` | Revert an approved timesheet to draft |
| `delete_timesheet` | Delete a timesheet |

### Fixed assets — 6

| Tool | Description |
|---|---|
| `list_assets` | List fixed assets by status (DRAFT, REGISTERED, or DISPOSED — required) |
| `list_asset_types` | List asset types with default depreciation settings |
| `get_asset` | Asset by ID with depreciation settings and book value |
| `get_asset_settings` | Organisation-level fixed-asset settings |
| `create_asset` | Create a DRAFT fixed asset (depreciation inherited from the asset type) |
| `create_asset_type` | Create an asset type with depreciation defaults and linked accounts |

> The Xero Assets API only supports `GET` and `POST /Assets`. There is no update/register/dispose endpoint — those actions must be done in the Xero UI. This is a [known Xero API limitation](https://xero.uservoice.com/forums/5528-accounting-api/suggestions/148322-fixed-assets-api).

### FX — 1

| Tool | Description |
|---|---|
| `get_fx_rate` | Historical FX rate for a currency pair and date: ECB reference rates via frankfurter.app, falling back to the community-maintained fawazahmed0/currency-api on cdn.jsdelivr.net (not ECB data) when that fails; the result names its source. **Not** a Xero endpoint |

**`get_fx_rate`**

```text
from             string     required  — source currency code (e.g. "GBP"); case-insensitive
to               string     required  — target currency code; comma-separated for multiple (e.g. "USD,EUR")
date             string     required  — YYYY-MM-DD, or "latest"; with the ECB source, weekends/holidays return the previous business day's rate
```

## Worked example

A typical conversation in an MCP client:

> **User:** Create a draft invoice for ACME for 3 units of consulting at £500.

The model first resolves the contact and account/tax codes (`list_contacts`, `list_accounts`, `list_tax_rates`), then calls `create_invoice`:

```json
{
  "name": "create_invoice",
  "arguments": {
    "contactId": "11111111-2222-3333-4444-555555555555",
    "type": "ACCREC",
    "lineItems": [
      {
        "description": "Consulting services",
        "quantity": 3,
        "unitAmount": 500,
        "accountCode": "200",
        "taxType": "OUTPUT2"
      }
    ],
    "reference": "ACME consulting"
  }
}
```

Truncated response:

```text
Invoice created successfully:
ID: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
Invoice Number: INV-0042
Contact: ACME Ltd
Type: ACCREC
Date: 2026-06-10
Total: 1800
Status: DRAFT
Link to view: https://go.xero.com/app/!xxxxx/invoicing/view/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
```

The invoice stays in DRAFT until you call `approve_invoice` (or approve it in the Xero UI).

## Notes

### Excluded capabilities

Some Xero endpoints are **deliberately not implemented**, to limit the blast radius of AI-initiated actions. See [SECURITY.md](SECURITY.md) for the full rationale.

- **Payroll pay runs, payslips, salary & wages** — a single bad call could pay incorrect amounts.
- **Payroll employee create/update** — employee records contain sensitive PII (bank details, tax codes); manage them in the Xero UI.
- **Batch payments** — mass payment execution without per-payment human review is too risky.
- **Email invoice** — sending invoices to clients without human review could reach the wrong recipients.
- **Bank Feeds API** — programmatic creation of bank statement lines could introduce fraudulent transactions.
- **Delete account** — irreversible; `archive_account` is provided instead.

Design principles: read operations are unrestricted. Updates, voids and deletes target an explicit entity ID; the one write that can change existing records without naming them by ID is `batch_create_contacts`, which uses Xero's create-or-update and updates an existing contact with the same name (up to 50 per call). Posted invoices and manual journals are voided, not deleted; `delete_payment` uses Xero's own soft-delete status for payments. Destructive tools are annotated `destructiveHint: true` so MCP clients can gate them, and `void_invoice`, `void_manual_journal` and `delete_draft_invoice` also tell the model to confirm with the user first.

### Error convention

Every tool returns errors in the standard MCP shape with `isError: true` and a single human-readable text content block, e.g.:

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "Error creating invoice: <message from Xero>" }]
}
```

### Tool annotations

All tools carry [MCP tool annotations](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#tool-annotations) inferred from their name prefix unless a tool sets its own (listed below the table), so clients can categorise read/write/destructive operations without parsing names:

| Prefix | Annotations |
|---|---|
| `list_`, `get_` | `readOnlyHint: true`, `idempotentHint: true` |
| `download_` | **`destructiveHint: true`**, non-idempotent: reads Xero but writes a local file at the caller's `outputPath`, and replaces an existing file when `overwrite: true` |
| `prepare_` | local write, non-destructive, non-idempotent, `openWorldHint: false` (writes only its own temp file; no Xero call) |
| `create_`, `add_`, `upload_`, `batch_create_` | write, non-destructive, non-idempotent |
| `update_`, `approve_` | write, non-destructive, idempotent |
| `delete_`, `void_`, `archive_` | **`destructiveHint: true`**, idempotent |
| `revert_` | **`destructiveHint: true`**, non-idempotent |

Explicit overrides: `batch_create_contacts`, `batch_create_invoices`, `update_invoice`, `update_credit_note`, `update_bank_transaction`, `update_manual_journal`, `update_purchase_order` and `update_quote` are annotated `destructiveHint: true`.

### Useful Xero links

- [Xero API documentation](https://developer.xero.com/documentation/api/)
- [Xero API Explorer](https://api-explorer.xero.com/)
- [Xero OpenAPI specs](https://github.com/XeroAPI/Xero-OpenAPI)
- [xero-node SDK docs](https://xeroapi.github.io/xero-node/accounting)

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md). Bug reports and PRs are welcome at [yantratech/mcp-connectors](https://github.com/yantratech/mcp-connectors/issues).

## License

[MIT](./LICENSE) © Yantra Applied Technologies Limited. This project is a fork of [XeroAPI/xero-mcp-server](https://github.com/XeroAPI/xero-mcp-server), which is also MIT-licensed; original copyright belongs to Xero Limited and contributors.

This is an independent project. It is not affiliated with, endorsed or sponsored by Xero Limited. Xero is a trademark of Xero Limited.
