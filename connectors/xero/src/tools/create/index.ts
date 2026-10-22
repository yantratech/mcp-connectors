import CreateBankTransactionTool from "./create-bank-transaction.tool.js";
import CreateContactTool from "./create-contact.tool.js";
import CreateCreditNoteTool from "./create-credit-note.tool.js";
import CreateInvoiceTool from "./create-invoice.tool.js";
import CreateItemTool from "./create-item.tool.js";
import CreateManualJournalTool from "./create-manual-journal.tool.js";
import CreatePaymentTool from "./create-payment.tool.js";
import CreatePayrollTimesheetTool from "./create-payroll-timesheet.tool.js";
import CreateQuoteTool from "./create-quote.tool.js";
import CreateTrackingCategoryTool from "./create-tracking-category.tool.js";
import CreateTrackingOptionsTool from "./create-tracking-options.tool.js";
import CreateBankTransferTool from "./create-bank-transfer.tool.js";
import CreateRepeatingInvoiceTool from "./create-repeating-invoice.tool.js";
import CreateAssetTool from "./create-asset.tool.js";
import CreatePurchaseOrderTool from "./create-purchase-order.tool.js";
import PrepareAttachmentTool from "./prepare-attachment.tool.js";
import UploadAttachmentTool from "./upload-attachment.tool.js";
import CreateReceiptTool from "./create-receipt.tool.js";
import BatchCreateInvoicesTool from "./batch-create-invoices.tool.js";
import BatchCreateContactsTool from "./batch-create-contacts.tool.js";
// New: Assets
import CreateAssetTypeTool from "./create-asset-type.tool.js";
// New: Accounting gaps
import CreateCurrencyTool from "./create-currency.tool.js";
import CreateLinkedTransactionTool from "./create-linked-transaction.tool.js";
import CreateAccountTool from "./create-account.tool.js";
// New: History
import CreateInvoiceHistoryNoteTool from "./create-invoice-history-note.tool.js";
import CreateContactHistoryNoteTool from "./create-contact-history-note.tool.js";
// New: Files API
import CreateFolderTool from "./create-folder.tool.js";
import CreateFileAssociationTool from "./create-file-association.tool.js";
import UploadFileTool from "./upload-file.tool.js";
// New: Projects API
import CreateProjectTool from "./create-project.tool.js";
import CreateProjectTaskTool from "./create-project-task.tool.js";
import CreateTimeEntryTool from "./create-time-entry.tool.js";

export const CreateTools = [
  CreateContactTool,
  CreateCreditNoteTool,
  CreateManualJournalTool,
  CreateInvoiceTool,
  CreateQuoteTool,
  CreatePaymentTool,
  CreateItemTool,
  CreateBankTransactionTool,
  CreatePayrollTimesheetTool,
  CreateTrackingCategoryTool,
  CreateTrackingOptionsTool,
  CreateBankTransferTool,
  CreateRepeatingInvoiceTool,
  CreateAssetTool,
  CreatePurchaseOrderTool,
  PrepareAttachmentTool,
  UploadAttachmentTool,
  CreateReceiptTool,
  BatchCreateInvoicesTool,
  BatchCreateContactsTool,
  // New tools
  CreateAssetTypeTool,
  CreateCurrencyTool,
  CreateLinkedTransactionTool,
  CreateAccountTool,
  CreateInvoiceHistoryNoteTool,
  CreateContactHistoryNoteTool,
  CreateFolderTool,
  CreateFileAssociationTool,
  UploadFileTool,
  CreateProjectTool,
  CreateProjectTaskTool,
  CreateTimeEntryTool,
];
