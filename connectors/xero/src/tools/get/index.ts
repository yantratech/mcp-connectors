import GetPayrollTimesheetTool from "./get-payroll-timesheet.tool.js";
import GetBankTransferTool from "./get-bank-transfer.tool.js";
import GetRepeatingInvoiceTool from "./get-repeating-invoice.tool.js";
import GetAssetTool from "./get-asset.tool.js";
import GetAssetSettingsTool from "./get-asset-settings.tool.js";
import GetPrepaymentTool from "./get-prepayment.tool.js";
import GetOverpaymentTool from "./get-overpayment.tool.js";
import GetPurchaseOrderTool from "./get-purchase-order.tool.js";
import GetJournalTool from "./get-journal.tool.js";
import GetAttachmentTool from "./get-attachment.tool.js";
import GetReceiptTool from "./get-receipt.tool.js";
import GetBudgetTool from "./get-budget.tool.js";
// New: Get-by-ID
import GetInvoiceTool from "./get-invoice.tool.js";
import GetContactTool from "./get-contact.tool.js";
import GetAccountTool from "./get-account.tool.js";
import GetCreditNoteTool from "./get-credit-note.tool.js";
import GetQuoteTool from "./get-quote.tool.js";
import GetPaymentTool from "./get-payment.tool.js";
import GetBankTransactionTool from "./get-bank-transaction.tool.js";
import GetItemTool from "./get-item.tool.js";
import GetManualJournalTool from "./get-manual-journal.tool.js";
// New: History
import GetInvoiceHistoryTool from "./get-invoice-history.tool.js";
import GetContactHistoryTool from "./get-contact-history.tool.js";
import GetBankTransactionHistoryTool from "./get-bank-transaction-history.tool.js";
// New: Files API
import GetFileTool from "./get-file.tool.js";
import GetFolderTool from "./get-folder.tool.js";
// New: Projects API
import GetProjectTool from "./get-project.tool.js";
import GetProjectTaskTool from "./get-project-task.tool.js";
import GetTimeEntryTool from "./get-time-entry.tool.js";
// FX rates (non-Xero, external API)
import GetFxRateTool from "./get-fx-rate.tool.js";
// New: read expansion (history dispatcher, files inbox, users, tax rates)
import GetHistoryTool from "./get-history.tool.js";
import GetFilesInboxTool from "./get-files-inbox.tool.js";
import GetFileAssociationsCountTool from "./get-file-associations-count.tool.js";
import GetUserTool from "./get-user.tool.js";
import GetTaxRateTool from "./get-tax-rate.tool.js";

export const GetTools = [
  GetPayrollTimesheetTool,
  GetBankTransferTool,
  GetRepeatingInvoiceTool,
  GetAssetTool,
  GetAssetSettingsTool,
  GetPrepaymentTool,
  GetOverpaymentTool,
  GetPurchaseOrderTool,
  GetJournalTool,
  GetAttachmentTool,
  GetReceiptTool,
  GetBudgetTool,
  // New tools
  GetInvoiceTool,
  GetContactTool,
  GetAccountTool,
  GetCreditNoteTool,
  GetQuoteTool,
  GetPaymentTool,
  GetBankTransactionTool,
  GetItemTool,
  GetManualJournalTool,
  GetInvoiceHistoryTool,
  GetContactHistoryTool,
  GetBankTransactionHistoryTool,
  GetFileTool,
  GetFolderTool,
  GetProjectTool,
  GetProjectTaskTool,
  GetTimeEntryTool,
  GetFxRateTool,
  GetHistoryTool,
  GetFilesInboxTool,
  GetFileAssociationsCountTool,
  GetUserTool,
  GetTaxRateTool,
];
