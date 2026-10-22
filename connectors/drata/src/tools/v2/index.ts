// Evidence Library
import ListEvidenceLibraryTool from "./list-evidence-library.tool.js";
import CreateEvidenceLibraryItemTool from "./create-evidence-library-item.tool.js";
import UpdateEvidenceLibraryItemTool from "./update-evidence-library-item.tool.js";
import FulfilTemplatedEvidenceTool from "./fulfil-templated-evidence.tool.js";
import DeleteEvidenceLibraryItemTool from "./delete-evidence-library-item.tool.js";
import { EvidenceLibraryCoverageTools } from "./evidence-library-coverage.tools.js";

// Control Management
import CreateControlTool from "./create-control.tool.js";
import ModifyControlTool from "./modify-control.tool.js";
import AddControlOwnerTool from "./add-control-owner.tool.js";
import ModifyControlOwnersTool from "./modify-control-owners.tool.js";
import RemoveControlOwnerTool from "./remove-control-owner.tool.js";
import ListControlOwnersTool from "./list-control-owners.tool.js";
import CreateControlNoteTool from "./create-control-note.tool.js";
import UpdateControlNoteTool from "./update-control-note.tool.js";
import DeleteControlNoteTool from "./delete-control-note.tool.js";
import ListControlNotesTool from "./list-control-notes.tool.js";

// Risk Registers
import ListRiskRegistersTool from "./list-risk-registers.tool.js";
import CreateRiskRegisterTool from "./create-risk-register.tool.js";
import UpdateRiskRegisterTool from "./update-risk-register.tool.js";
import UploadRiskDocumentTool from "./upload-risk-document.tool.js";
import ListRiskDocumentsTool from "./list-risk-documents.tool.js";
import CreateRiskNoteTool from "./create-risk-note.tool.js";
import UpdateRiskNoteTool from "./update-risk-note.tool.js";
import ListRiskNotesTool from "./list-risk-notes.tool.js";
import { RiskOperationsTools } from "./risk-operations.tools.js";
import { TaskOperationsTools } from "./task-operations.tools.js";
import { AuditRequestTools } from "./audit-request.tools.js";
import { OperationalCoverageTools } from "./operational-coverage.tools.js";
import { LibraryDeviceReadTools } from "./library-device-reads.tools.js";

// Vendor Enhancements
import CreateVendorSecurityReviewTool from "./create-vendor-security-review.tool.js";
import CreateVendorSecurityReviewWithFileTool from "./create-vendor-security-review-with-file.tool.js";
import GetVendorSecurityReviewTool from "./get-vendor-security-review.tool.js";
import SendVendorQuestionnaireTool from "./send-vendor-questionnaire.tool.js";
import ListVendorQuestionnairesTool from "./list-vendor-questionnaires.tool.js";
import CreateVendorTypeTool from "./create-vendor-type.tool.js";
import ListVendorTypesTool from "./list-vendor-types.tool.js";

// Personnel
import ListPersonnelV2Tool from "./list-personnel-v2.tool.js";
import UpdatePersonnelTool from "./update-personnel.tool.js";
import CreateBackgroundCheckTool from "./create-background-check.tool.js";
import UploadOffboardingDocumentTool from "./upload-offboarding-document.tool.js";

// Connections
import ListCustomConnectionsTool from "./list-custom-connections.tool.js";
import CreateCustomConnectionTool from "./create-custom-connection.tool.js";
import PushConnectionRecordsTool from "./push-connection-records.tool.js";

// Monitoring
import ListMonitoringTestsV2Tool from "./list-monitoring-tests-v2.tool.js";
import GetMonitoringTestTool from "./get-monitoring-test.tool.js";
import ListMonitoringTestFailuresTool from "./list-monitoring-test-failures.tool.js";

// Compliance Read
import ListFrameworksTool from "./list-frameworks.tool.js";
import ListFrameworkRequirementsTool from "./list-framework-requirements.tool.js";
import GetFrameworkRequirementReadinessRollupTool from "./get-framework-requirement-readiness-rollup.tool.js";
import ListDevicesV2Tool from "./list-devices-v2.tool.js";
import ListPoliciesV2Tool from "./list-policies-v2.tool.js";
import GetPolicyTool from "./get-policy.tool.js";
import ListPolicyVersionsTool from "./list-policy-versions.tool.js";
import GetPolicyVersionTool from "./get-policy-version.tool.js";
import GetPolicyVersionContentTool from "./get-policy-version-content.tool.js";
import ListPolicyActionsTool from "./list-policy-actions.tool.js";
import PerformPolicyActionTool from "./perform-policy-action.tool.js";
import ListUserAssignedPoliciesTool from "./list-user-assigned-policies.tool.js";
import AcknowledgeAssignedPolicyTool from "./acknowledge-assigned-policy.tool.js";
import ListEventsV2Tool from "./list-events-v2.tool.js";
import ListWorkspacesTool from "./list-workspaces.tool.js";
import GetCompanyTool from "./get-company.tool.js";

export const V2Tools = [
  // Evidence Library
  ListEvidenceLibraryTool,
  CreateEvidenceLibraryItemTool,
  UpdateEvidenceLibraryItemTool,
  FulfilTemplatedEvidenceTool,
  DeleteEvidenceLibraryItemTool,
  ...EvidenceLibraryCoverageTools,

  // Control Management
  CreateControlTool,
  ModifyControlTool,
  AddControlOwnerTool,
  ModifyControlOwnersTool,
  RemoveControlOwnerTool,
  ListControlOwnersTool,
  CreateControlNoteTool,
  UpdateControlNoteTool,
  DeleteControlNoteTool,
  ListControlNotesTool,

  // Risk Registers
  ListRiskRegistersTool,
  CreateRiskRegisterTool,
  UpdateRiskRegisterTool,
  UploadRiskDocumentTool,
  ListRiskDocumentsTool,
  CreateRiskNoteTool,
  UpdateRiskNoteTool,
  ListRiskNotesTool,
  ...RiskOperationsTools,
  ...TaskOperationsTools,
  ...AuditRequestTools,
  ...OperationalCoverageTools,
  ...LibraryDeviceReadTools,

  // Vendor Enhancements
  CreateVendorSecurityReviewTool,
  CreateVendorSecurityReviewWithFileTool,
  GetVendorSecurityReviewTool,
  SendVendorQuestionnaireTool,
  ListVendorQuestionnairesTool,
  CreateVendorTypeTool,
  ListVendorTypesTool,

  // Personnel
  ListPersonnelV2Tool,
  UpdatePersonnelTool,
  CreateBackgroundCheckTool,
  UploadOffboardingDocumentTool,

  // Connections
  ListCustomConnectionsTool,
  CreateCustomConnectionTool,
  PushConnectionRecordsTool,

  // Monitoring
  ListMonitoringTestsV2Tool,
  GetMonitoringTestTool,
  ListMonitoringTestFailuresTool,

  // Compliance Read
  ListFrameworksTool,
  ListFrameworkRequirementsTool,
  GetFrameworkRequirementReadinessRollupTool,
  ListDevicesV2Tool,
  ListPoliciesV2Tool,
  GetPolicyTool,
  ListPolicyVersionsTool,
  GetPolicyVersionTool,
  GetPolicyVersionContentTool,
  ListPolicyActionsTool,
  PerformPolicyActionTool,
  ListUserAssignedPoliciesTool,
  AcknowledgeAssignedPolicyTool,
  ListEventsV2Tool,
  ListWorkspacesTool,
  GetCompanyTool,
];
