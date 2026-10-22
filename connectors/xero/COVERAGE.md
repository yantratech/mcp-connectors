# Xero API Coverage Matrix

**Total tools: 148 by default; 151 with `XERO_ENABLE_RECEIPTS=1`, 150 with `XERO_ENABLE_JOURNALS=1`, and 153 with both** (`list_receipts`, `get_receipt` and `create_receipt` are registered only with `XERO_ENABLE_RECEIPTS=1`, and `list_journals` and `get_journal` only with `XERO_ENABLE_JOURNALS=1`). The tables below list all 153.

Every tool exposed by this server, grouped by operation type, with the Xero API endpoint it calls.

## List Tools (52)

| Tool | Xero Endpoint |
|---|---|
| list_accounts | GET /Accounts |
| list_aged_payables_by_contact | GET /Reports/AgedPayablesByContact |
| list_aged_receivables_by_contact | GET /Reports/AgedReceivablesByContact |
| list_asset_types | GET /AssetTypes |
| list_assets | GET /Assets |
| list_attachments | GET /{Entity}/Attachments |
| list_bank_summary | GET /Reports/BankSummary |
| list_bank_transactions | GET /BankTransactions |
| list_bank_transfers | GET /BankTransfers |
| list_branding_themes | GET /BrandingThemes |
| list_budget_summary | GET /Reports/BudgetSummary |
| list_budgets | GET /Budgets |
| list_contact_groups | GET /ContactGroups |
| list_contacts | GET /Contacts |
| list_credit_notes | GET /CreditNotes |
| list_currencies | GET /Currencies |
| list_executive_summary | GET /Reports/ExecutiveSummary |
| list_file_associations | GET /Files/{id}/Associations |
| list_files | GET /Files |
| list_folders | GET /Files/Folders |
| list_invoices | GET /Invoices |
| list_items | GET /Items |
| list_journals | GET /Journals |
| list_linked_transactions | GET /LinkedTransactions |
| list_manual_journals | GET /ManualJournals |
| list_object_associations | GET /Files/Associations/{objectId} |
| list_organisation_details | GET /Organisation |
| list_overpayments | GET /Overpayments |
| list_payments | GET /Payments |
| list_payroll_employee_leave | GET /Employees/{id}/Leave |
| list_payroll_employee_leave_balances | GET /Employees/{id}/LeaveBalances |
| list_payroll_employee_leave_types | GET /Employees/{id}/LeaveTypes |
| list_payroll_employees | GET /Employees |
| list_payroll_leave_periods | GET /Employees/{id}/LeavePeriods |
| list_payroll_leave_types | GET /LeaveTypes |
| list_prepayments | GET /Prepayments |
| list_profit_and_loss | GET /Reports/ProfitAndLoss |
| list_profit_and_loss_with_tracking | GET /Reports/ProfitAndLoss (tracking) |
| list_project_tasks | GET /Projects/{id}/Tasks |
| list_project_users | GET /ProjectUsers |
| list_projects | GET /Projects |
| list_purchase_orders | GET /PurchaseOrders |
| list_quotes | GET /Quotes |
| list_receipts | GET /Receipts |
| list_repeating_invoices | GET /RepeatingInvoices |
| list_report_balance_sheet | GET /Reports/BalanceSheet |
| list_tax_rates | GET /TaxRates |
| list_time_entries | GET /Projects/{id}/Time |
| list_timesheets | GET /Timesheets |
| list_tracking_categories | GET /TrackingCategories |
| list_trial_balance | GET /Reports/TrialBalance |
| list_users | GET /Users (SDK: `getUsers`) |

## Get Tools (36)

| Tool | Xero Endpoint |
|---|---|
| get_account | GET /Accounts/{id} |
| get_asset | GET /Assets/{id} |
| get_asset_settings | GET /AssetSettings |
| get_attachment | GET /{Entity}/Attachments/{id} |
| get_bank_transaction | GET /BankTransactions/{id} |
| get_bank_transaction_history | GET /BankTransactions/{id}/History |
| get_bank_transfer | GET /BankTransfers/{id} |
| get_budget | GET /Budgets/{id} |
| get_contact | GET /Contacts/{id} |
| get_contact_history | GET /Contacts/{id}/History |
| get_credit_note | GET /CreditNotes/{id} |
| get_file | GET /Files/{id} |
| get_file_associations_count | GET /Files/Associations/Count (Files API; SDK: `getAssociationsCount`) |
| get_files_inbox | GET /Files/Inbox (Files API; SDK: `getInbox`) |
| get_folder | GET /Files/Folders/{id} |
| get_fx_rate | External: ECB reference rates via frankfurter.app, with fawazahmed0/currency-api (jsDelivr CDN, not ECB data) as the fallback; not a Xero endpoint |
| get_history | GET /{Entity}/{id}/History across 11 entity types (SDK: `getCreditNoteHistory`, `getPaymentHistory`, `getPurchaseOrderHistory`, `getQuoteHistory`, `getItemHistory`, `getManualJournalsHistory`, `getBankTransferHistory`, `getPrepaymentHistory`, `getOverpaymentHistory`, `getReceiptHistory`, `getRepeatingInvoiceHistory`) |
| get_invoice | GET /Invoices/{id} |
| get_invoice_history | GET /Invoices/{id}/History |
| get_invoice_online_url | GET /Invoices/{id}/OnlineInvoice (SDK: `getOnlineInvoice`) |
| get_item | GET /Items/{id} |
| get_journal | GET /Journals/{id} |
| get_manual_journal | GET /ManualJournals/{id} |
| get_overpayment | GET /Overpayments/{id} |
| get_payment | GET /Payments/{id} |
| get_prepayment | GET /Prepayments/{id} |
| get_project | GET /Projects/{id} |
| get_project_task | GET /Projects/{id}/Tasks/{taskId} |
| get_purchase_order | GET /PurchaseOrders/{id} |
| get_quote | GET /Quotes/{id} |
| get_receipt | GET /Receipts/{id} |
| get_repeating_invoice | GET /RepeatingInvoices/{id} |
| get_tax_rate | GET /TaxRates (filtered by TaxType; SDK: `getTaxRateByTaxType`) |
| get_time_entry | GET /Projects/{id}/Time/{timeEntryId} |
| get_timesheet | GET /Timesheets/{id} |
| get_user | GET /Users/{id} (SDK: `getUser`) |

## Download Tools (3)

Binary endpoints. Bytes are written to a caller-supplied absolute `outputPath` and never returned into model context (see [SECURITY.md](SECURITY.md#binary-outputs)).

| Tool | Xero Endpoint |
|---|---|
| download_attachment | GET /{Entity}/Attachments/{attachmentId} across 11 entity types (SDK: `getInvoiceAttachmentById`, `getContactAttachmentById`, `getManualJournalAttachmentById`, `getBankTransactionAttachmentById`, `getCreditNoteAttachmentById`, `getQuoteAttachmentById`, `getReceiptAttachmentById`, `getAccountAttachmentById`, `getPurchaseOrderAttachmentById`, `getBankTransferAttachmentById`, `getRepeatingInvoiceAttachmentById`) |
| download_document_pdf | GET /Invoices/{id}, /CreditNotes/{id}, /Quotes/{id}, /PurchaseOrders/{id} with `Accept: application/pdf` (SDK: `getInvoiceAsPdf`, `getCreditNoteAsPdf`, `getQuoteAsPdf`, `getPurchaseOrderAsPdf`) |
| download_file_content | GET /Files/{id} + GET /Files/{id}/Content (Files API; SDK: `getFile` + `getFileContent`) |

## Create & Upload Tools (32)

| Tool | Xero Endpoint |
|---|---|
| batch_create_contacts | POST /Contacts (batch) |
| batch_create_invoices | POST /Invoices (batch) |
| create_account | POST /Accounts |
| create_asset | POST /Assets |
| create_asset_type | POST /AssetTypes |
| create_bank_transaction | POST /BankTransactions |
| create_bank_transfer | POST /BankTransfers |
| create_contact | POST /Contacts |
| create_contact_history_note | PUT /Contacts/{id}/History |
| create_credit_note | POST /CreditNotes |
| create_currency | PUT /Currencies |
| create_file_association | POST /Files/{id}/Associations |
| create_folder | POST /Files/Folders |
| create_invoice | POST /Invoices |
| create_invoice_history_note | PUT /Invoices/{id}/History |
| create_item | POST /Items |
| create_linked_transaction | POST /LinkedTransactions |
| create_manual_journal | POST /ManualJournals |
| create_payment | POST /Payments |
| create_project | POST /Projects |
| create_project_task | POST /Projects/{id}/Tasks |
| create_purchase_order | POST /PurchaseOrders |
| create_quote | POST /Quotes |
| create_receipt | POST /Receipts |
| create_repeating_invoice | POST /RepeatingInvoices |
| create_time_entry | POST /Projects/{id}/Time |
| create_timesheet | POST /Timesheets |
| create_tracking_category | POST /TrackingCategories |
| create_tracking_options | POST /TrackingCategories/{id}/Options |
| prepare_attachment | Local helper: stages base64 chunks to a temp file for upload_attachment / upload_file (no Xero call) |
| upload_attachment | POST /{Entity}/Attachments |
| upload_file | POST /Files |

## Update & Status-Change Tools (23)

| Tool | Xero Endpoint |
|---|---|
| add_timesheet_line | POST /Timesheets/{id}/Lines |
| approve_invoice | POST /Invoices/{id} (status AUTHORISED) |
| approve_timesheet | PUT /Timesheets/{id} (approve) |
| archive_account | PUT /Accounts/{id} (status ARCHIVED) |
| revert_timesheet | PUT /Timesheets/{id} (revert) |
| update_account | PUT /Accounts/{id} |
| update_bank_transaction | POST /BankTransactions/{id} |
| update_contact | POST /Contacts/{id} |
| update_credit_note | POST /CreditNotes/{id} |
| update_invoice | POST /Invoices/{id} |
| update_item | POST /Items/{id} |
| update_linked_transaction | PUT /LinkedTransactions/{id} |
| update_manual_journal | POST /ManualJournals/{id} |
| update_project | PUT /Projects/{id} |
| update_project_task | PUT /Projects/{id}/Tasks/{taskId} |
| update_purchase_order | POST /PurchaseOrders/{id} |
| update_quote | POST /Quotes/{id} |
| update_time_entry | PUT /Projects/{id}/Time/{timeEntryId} |
| update_timesheet_line | PUT /Timesheets/{id}/Lines/{lineId} |
| update_tracking_category | POST /TrackingCategories/{id} |
| update_tracking_options | POST /TrackingCategories/{id}/Options/{optionId} |
| void_invoice | POST /Invoices/{id} (status VOIDED) |
| void_manual_journal | POST /ManualJournals/{id} (status VOIDED) |

## Delete Tools (7)

| Tool | Xero Endpoint |
|---|---|
| delete_draft_invoice | POST /Invoices/{id} (status DELETED, draft only) |
| delete_file_association | DELETE /Files/{id}/Associations/{objectId} |
| delete_linked_transaction | DELETE /LinkedTransactions/{id} |
| delete_payment | POST /Payments/{id} (status DELETED) |
| delete_project_task | DELETE /Projects/{id}/Tasks/{taskId} |
| delete_time_entry | DELETE /Projects/{id}/Time/{timeEntryId} |
| delete_timesheet | DELETE /Timesheets/{id} |

## Not Implemented

- **update_asset / register_asset / dispose_asset** — the Xero Assets API only supports `GET` and `POST /Assets` (create); there is no endpoint to update, register, or dispose an asset. See [SECURITY.md](SECURITY.md#xero-api-limitations).
- **Pay runs, payslips, employee writes, batch payments, invoice emailing, bank feeds, account deletion** — intentionally excluded; see [SECURITY.md](SECURITY.md#intentionally-excluded-endpoints) for reasons.

## OAuth Scopes

The scopes the client-credentials token requests by default are listed, with the reason for each, in [SECURITY.md](SECURITY.md#oauth-scopes); the [README](README.md#mode-1-custom-connections-recommended) repeats the list for setup. `XERO_ENABLE_RECEIPTS=1` adds `accounting.transactions accounting.transactions.read`, and `XERO_ENABLE_JOURNALS=1` adds `accounting.journals.read`. Custom Connections created on or after 29 April 2026 cannot be granted those opt-in scopes, except `accounting.journals.read` where Xero grants Advanced access (see the [README](README.md#mode-1-custom-connections-recommended)). The source of truth is [`src/consts/xero-scopes.ts`](src/consts/xero-scopes.ts).
