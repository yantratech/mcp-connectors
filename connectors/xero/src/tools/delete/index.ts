import DeletePayrollTimesheetTool from "./delete-payroll-timesheet.tool.js";
// New: Accounting gaps
import DeleteLinkedTransactionTool from "./delete-linked-transaction.tool.js";
import DeleteDraftInvoiceTool from "./delete-draft-invoice.tool.js";
import DeletePaymentTool from "./delete-payment.tool.js";
// New: Files API
import DeleteFileAssociationTool from "./delete-file-association.tool.js";
// New: Projects API
import DeleteProjectTaskTool from "./delete-project-task.tool.js";
import DeleteTimeEntryTool from "./delete-time-entry.tool.js";

export const DeleteTools = [
  DeletePayrollTimesheetTool,
  DeleteLinkedTransactionTool,
  DeleteDraftInvoiceTool,
  DeletePaymentTool,
  DeleteFileAssociationTool,
  DeleteProjectTaskTool,
  DeleteTimeEntryTool,
];
