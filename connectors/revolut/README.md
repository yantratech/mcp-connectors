# @yantratech/revolut-mcp-server

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives an
AI assistant (Claude or any other MCP client) **read access** to a Revolut
Business account plus the ability to create **payment drafts only**. It is
designed so that no tool can move money.

- stdio · 9 tools · Node ≥ 22

## Safety model (what this server will never do)

1. **No `PAY` scope, ever.** Consent is granted with `scope=READ,WRITE` only.
   There is no transfer, exchange, or payout-link tool — even if a token would
   technically permit it.
2. **Drafts only.** The single money-adjacent write is `create_payment_draft`
   (`POST /payment-drafts`). A draft is inert until a **human approves it in the
   Revolut Business app**.
3. **No counterparty writes.** Counterparties are created, edited, and deleted
   by humans in the Revolut app. (The Revolut API has no counterparty-update
   endpoint at all.)
4. **Attribution on every draft.** Each draft title is automatically prefixed
   with `[<operator> via MCP]`. The calling model cannot change or remove it.
5. **Fail closed.** Any validation failure returns an error; the server never
   silently "fixes up" a payment request.

## Requirements

- Node.js ≥ 22.
- A Revolut Business account (start in **sandbox**:
  <https://sandbox-business.revolut.com>).
- One X509 certificate + one config **per operator** (e.g. alice, bob,
  carol). Revoking a person = deleting their certificate in the Revolut app.

## One-time setup

All steps below are done in **sandbox** first
(`REVOLUT_ENV=sandbox`, web app <https://sandbox-business.revolut.com>). Repeat
against production only once sandbox works end-to-end.

### 1. Generate a keypair

```bash
mkdir -p ~/.revolut-mcp && chmod 700 ~/.revolut-mcp
openssl genrsa -out ~/.revolut-mcp/privatecert.pem 2048
chmod 600 ~/.revolut-mcp/privatecert.pem
openssl req -new -x509 -key ~/.revolut-mcp/privatecert.pem \
  -out ~/.revolut-mcp/publiccert.cer -days 1825
```

### 2. Upload the public cert

In the Revolut Business web app → **Settings → APIs → Business API → Add API
certificate**:

- Paste the contents of `publiccert.cer`.
- Set an OAuth redirect URI on a domain you control (the examples below use
  `https://example.com`). It is only used to read the `code` query
  parameter — nothing is hosted there.
- Title the certificate with the operator's name (one cert per person).
- Copy the **ClientID**.

### 3. Grant access with the scope restriction

Open this URL (production host shown; use `sandbox-business.revolut.com` for
sandbox) and approve with 2FA. **The `scope=READ,WRITE` suffix is the
enforcement point that the token can never initiate payments:**

```
https://business.revolut.com/app-confirm?client_id=<ClientID>&redirect_uri=<REDIRECT_URI>&response_type=code&scope=READ,WRITE
```

The browser redirects to `<REDIRECT_URI>?code=...`. **The code expires in 2
minutes** — do step 4 immediately.

### 4. Exchange the code for tokens

The package ships a second executable, `revolut-mcp-authorize`, for this
one-time exchange. Run it with the same environment the server will use:

```bash
REVOLUT_ENV=sandbox \
REVOLUT_CLIENT_ID=<ClientID> \
REVOLUT_PRIVATE_KEY_PATH=~/.revolut-mcp/privatecert.pem \
REVOLUT_JWT_ISS=example.com \
REVOLUT_OPERATOR=alice \
npx -y -p @yantratech/revolut-mcp-server revolut-mcp-authorize <code>
```

> **npm publication is in progress.** Until the package is live on the npm registry, the `npx` commands in this README will not resolve — use the from-source alternatives.

From a source checkout, run `npm run authorize -- <code>` in
`connectors/revolut` with the same variables (after `npm run build`). Both run
the same script.

This writes `~/.revolut-mcp/tokens-sandbox.json` (mode `0600`) containing the
refresh token (which does not expire) and the current access token. Access
tokens last ~40 minutes and are refreshed automatically. Token values are never
logged.

## Configuration

All configuration is via environment variables, validated on startup:

| Variable | Meaning |
|---|---|
| `REVOLUT_ENV` | `sandbox` (default) or `production`. Production is used only when set explicitly. |
| `REVOLUT_CLIENT_ID` | ClientID from the certificate details. |
| `REVOLUT_PRIVATE_KEY_PATH` | Path to `privatecert.pem`. |
| `REVOLUT_JWT_ISS` | Redirect-URI domain, no scheme (e.g. `example.com`). |
| `REVOLUT_OPERATOR` | Human name stamped on drafts (e.g. `alice`). Required, non-empty. |
| `REVOLUT_TOKEN_DIR` | *(optional)* Override the token-store directory (default `~/.revolut-mcp`). |

## Client configuration

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "revolut-business": {
      "command": "npx",
      "args": ["-y", "@yantratech/revolut-mcp-server"],
      "env": {
        "REVOLUT_ENV": "sandbox",
        "REVOLUT_CLIENT_ID": "...",
        "REVOLUT_PRIVATE_KEY_PATH": "/Users/you/.revolut-mcp/privatecert.pem",
        "REVOLUT_JWT_ISS": "example.com",
        "REVOLUT_OPERATOR": "alice"
      }
    }
  }
}
```

To run from a source checkout instead, use `"command": "node"` with
`"args": ["/path/to/mcp-connectors/connectors/revolut/dist/index.js"]`.

### Claude Code

```bash
claude mcp add revolut-business \
  --env REVOLUT_ENV=sandbox \
  --env REVOLUT_CLIENT_ID=<ClientID> \
  --env REVOLUT_PRIVATE_KEY_PATH=$HOME/.revolut-mcp/privatecert.pem \
  --env REVOLUT_JWT_ISS=example.com \
  --env REVOLUT_OPERATOR=alice \
  -- npx -y @yantratech/revolut-mcp-server
```

(Running from source? Replace `npx -y @yantratech/revolut-mcp-server` with
`node /path/to/mcp-connectors/connectors/revolut/dist/index.js`.)

Both examples target the sandbox. Once it works end to end, repeat the one-time
setup against production and set `REVOLUT_ENV` to `production`. Any other MCP
client works the same way: run the server over stdio with the environment
variables above.

## Tools

Read tools cannot move money, but they do return balances, transactions and
counterparty bank details to the connected model. The one write tool is
`create_payment_draft`.

Every tool's input schema is strict: an argument the tool does not define
(for example a misspelled `acount_id`) is rejected with an invalid-arguments
error rather than silently dropped.

| Tool | Method | Notes |
|---|---|---|
| `list_accounts` | `GET /accounts` | All accounts. |
| `get_account` | `GET /accounts/{id}` | `include_bank_details` merges the bank-details **array** under `bank_details`. |
| `list_transactions` | `GET /transactions` | Filters: `from`/`to`/`account_id`/`count`/`type` (`account`, Revolut's own name for the account filter, is accepted as an alias of `account_id`). Newest first; `next_page_to` paginates (timestamp cursor — boundary ties may repeat or be skipped). |
| `get_transaction` | `GET /transaction/{id}` | Note the **singular** path. |
| `list_counterparties` | `GET /counterparties` | Filters incl. `name` (partial), `iban`, `account_no`. `sort_code` needs `account_no`; `bic` needs `iban`. |
| `get_counterparty` | `GET /counterparty/{id}` | **Singular** path. Exposes `accounts[]`/`cards[]` so a payee can be sanity-checked. |
| `create_payment_draft` | `POST /payment-drafts` | **The only write.** See below. |
| `list_payment_drafts` | `GET /payment-drafts` | Drafts not yet sent for processing. Optional `source`: `api`, `integration`, `email`, or `all`. Use `all` to include Business-app drafts. Omission preserves the default API scope. |
| `get_payment_draft` | `GET /payment-drafts/{id}` | Full payment details of one draft. |

### `create_payment_draft`

Creates a **draft only** — it cannot send money; a human must approve it in the
Revolut Business app. Inputs:

```
title?               human-readable purpose (attribution is prepended)
schedule_for?        ISO 8601 date to schedule for
account_id           UUID of the account to pay FROM
counterparty_id      UUID of an existing counterparty to pay TO
receiver_account_id? required only if the counterparty has >1 receiving
                     account/card — the id of the specific account (or card)
amount               > 0
currency             ISO 4217 (^[A-Z]{3}$)
reference            required, e.g. the supplier invoice number
transfer_reason_code? only if a prior attempt failed asking for one (Revolut
                     requires it for certain destination countries/currencies)
```

Server-side guards, all fail-closed:

1. The counterparty must exist and be in state `created` (else: "add it manually
   in the Revolut Business app first" — this server never creates counterparties).
2. The receiving account/card is resolved: exactly one → used automatically;
   more than one → rejected with the list of options so a human can choose.
3. The paying account must exist and be `active`.
4. Duplicate guard: if a pending API-created draft already has the same
   counterparty + amount + currency + reference, creation is refused. If the
   drafts list cannot be read, creation is refused too (fail closed). Within
   one server process, calls with the same four values run the check and the
   create one at a time, so an overlapping identical call checks only after
   the earlier call's create has finished. This guard retains the default
   API-created scope; it does not request `source=all`.
5. The title becomes `[<operator> via MCP] <title-or-reference>`.
6. One payment per draft (no bulk drafts).

`charge_bearer` is deliberately not exposed (Revolut's docs flag it as
error-prone).

## Worked example

*"Draft a £1,250 payment to Acme Supplies for invoice INV-1042 from our GBP
account."* (All names, ids and amounts below are made up.)

**Step 1 — find the payee and the paying account.**

```json
{ "tool": "list_counterparties", "arguments": { "name": "Acme" } }
```

```json
{
  "count": 1,
  "more_available": false,
  "next_page_created_before": null,
  "counterparties": [
    {
      "id": "8f2c1d4e-5b6a-4c3d-9e8f-1a2b3c4d5e6f",
      "name": "Acme Supplies Ltd",
      "state": "created",
      "accounts": [
        { "id": "0d9e8f7a-6b5c-4d3e-8f1a-2b3c4d5e6f7a", "currency": "GBP" }
      ]
    }
  ]
}
```

(Trimmed to the fields used here; the record also carries Revolut's other
counterparty and bank-account fields.) `list_accounts` then returns the account
to pay from; here, the active GBP account `3b7e9c1a-2d4f-4e6a-8b0c-9d1e2f3a4b5c`.

**Step 2 — create the draft.**

```json
{
  "tool": "create_payment_draft",
  "arguments": {
    "account_id": "3b7e9c1a-2d4f-4e6a-8b0c-9d1e2f3a4b5c",
    "counterparty_id": "8f2c1d4e-5b6a-4c3d-9e8f-1a2b3c4d5e6f",
    "amount": 1250,
    "currency": "GBP",
    "reference": "INV-1042",
    "title": "Acme Supplies INV-1042"
  }
}
```

```json
{
  "id": "c4d5e6f7-a8c9-4c0d-9e1f-2a3b4c5d6e7f",
  "title": "[alice via MCP] Acme Supplies INV-1042",
  "receiver": {
    "counterparty_id": "8f2c1d4e-5b6a-4c3d-9e8f-1a2b3c4d5e6f",
    "account_id": "0d9e8f7a-6b5c-4d3e-8f1a-2b3c4d5e6f7a"
  },
  "reminder": "Draft created. It will not be paid until approved in the Revolut Business app."
}
```

Before creating the draft, the server confirmed that the counterparty is
`created`, picked its only receiving account, checked that the paying account
is `active`, and found no pending API-created draft with the same
counterparty, amount, currency and reference. Nothing is paid until a person
approves the draft in the Revolut Business app.

## Explicitly NOT implemented

By design — these are human-only or out of scope:

- `DELETE /payment-drafts/{id}` — drafts are discarded by humans in the app.
- `POST /counterparty`, `DELETE /counterparty/{id}` — counterparties are
  human-managed (and the API has no counterparty-update endpoint at all).
- Everything under Transfers, Foreign exchange, Payout links, Cards, Team
  members, Webhooks, Expenses, and Accounting settings.

## Implementation notes

- `receiver_account_id` also accepts a counterparty **card** id; it is routed to
  `receiver.card_id` automatically.
- `transfer_reason_code` is exposed as an optional passthrough because Revolut
  rejects some cross-border drafts without it.
- Verified against the [Revolut payment-drafts guide](https://developer.revolut.com/docs/guides/manage-accounts/transfers/payment-drafts)
  on 7 September 2026: `GET /payment-drafts?source=all` includes drafts created
  in the Business app. Other filters are `api`, `integration` and `email`.
  Omission preserves Revolut's API-created default. The create tool's duplicate
  guard keeps that default scope; only `list_payment_drafts` accepts `source`.
- Drafts remain unsubmitted. A `schedule_for` date does not prove approval or
  execution. The draft list is not a complete inventory of submitted future
  payments or standing orders; verify those separately before reporting that
  nothing is scheduled.

## Testing

Offline suites (no credentials; run in CI):

```bash
npm run build
npm test
```

Covered: tools/list surface + annotations, config validation, JWT/token-store/
refresh (single-flight), and every `create_payment_draft` guard via an
in-memory transport.

Manual sandbox validation: create a counterparty in the sandbox app, draft a
payment via the tool, and confirm it appears as a draft in the app and via
`get_payment_draft` with the `[<operator> via MCP]` title prefix. An opt-in
live smoke that calls read endpoints only (`npm run smoke:read`, not run in CI)
lives at `test/live-read-smoke.mjs`.

## License

[MIT](./LICENSE) © Yantra Applied Technologies Limited. Not affiliated with or
endorsed by Revolut.
