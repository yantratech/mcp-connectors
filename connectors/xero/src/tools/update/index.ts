import ApprovePayrollTimesheetTool from "./approve-payroll-timesheet.tool.js";
import RevertPayrollTimesheetTool from "./revert-payroll-timesheet.tool.js";
import UpdateBankTransactionTool from "./update-bank-transaction.tool.js";
import UpdateContactTool from "./update-contact.tool.js";
import UpdateCreditNoteTool from "./update-credit-note.tool.js";
import UpdateInvoiceTool from "./update-invoice.tool.js";
import UpdateItemTool from "./update-item.tool.js";
import AddTimesheetLineTool from "./update-payroll-timesheet-add-line.tool.js";
import UpdatePayrollTimesheetLineTool from "./update-payroll-timesheet-update-line.tool.js";
import UpdateManualJournalTool from "./update-manual-journal.tool.js";
import UpdateQuoteTool from "./update-quote.tool.js";
import UpdateTrackingCategoryTool from "./update-tracking-category.tool.js";
import UpdateTrackingOptionsTool from "./update-tracking-options.tool.js";
import ApproveInvoiceTool from "./approve-invoice.tool.js";
import VoidInvoiceTool from "./void-invoice.tool.js";
import VoidManualJournalTool from "./void-manual-journal.tool.js";
import UpdatePurchaseOrderTool from "./update-purchase-order.tool.js";
// New: Accounting gaps
import UpdateLinkedTransactionTool from "./update-linked-transaction.tool.js";
import UpdateAccountTool from "./update-account.tool.js";
import ArchiveAccountTool from "./archive-account.tool.js";
// New: Projects API
import UpdateProjectTool from "./update-project.tool.js";
import UpdateProjectTaskTool from "./update-project-task.tool.js";
import UpdateTimeEntryTool from "./update-time-entry.tool.js";

export const UpdateTools = [
  UpdateContactTool,
  UpdateCreditNoteTool,
  UpdateInvoiceTool,
  UpdateManualJournalTool,
  UpdateQuoteTool,
  UpdateItemTool,
  UpdateBankTransactionTool,
  ApprovePayrollTimesheetTool,
  AddTimesheetLineTool,
  UpdatePayrollTimesheetLineTool,
  RevertPayrollTimesheetTool,
  UpdateTrackingCategoryTool,
  UpdateTrackingOptionsTool,
  ApproveInvoiceTool,
  VoidInvoiceTool,
  VoidManualJournalTool,
  UpdatePurchaseOrderTool,
  // New tools
  UpdateLinkedTransactionTool,
  UpdateAccountTool,
  ArchiveAccountTool,
  UpdateProjectTool,
  UpdateProjectTaskTool,
  UpdateTimeEntryTool,
];
