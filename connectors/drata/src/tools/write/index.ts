import CreateVendorTool from "./create-vendor.tool.js";
import UpdateVendorTool from "./update-vendor.tool.js";
import ArchiveVendorTool from "./archive-vendor.tool.js";
import BulkUpdateVendorsTool from "./bulk-update-vendors.tool.js";
import UploadVendorDocumentTool from "./upload-vendor-document.tool.js";
import CreateAssetTool from "./create-asset.tool.js";
import UploadUserDocumentTool from "./upload-user-document.tool.js";
import ListExternalEvidenceTool from "./list-external-evidence.tool.js";
import CreateControlExternalEvidenceTool from "./create-control-external-evidence.tool.js";
import { ControlEvidenceLifecycleTools } from "./control-evidence-lifecycle.tools.js";

export const WriteTools = [
  CreateVendorTool,
  UpdateVendorTool,
  ArchiveVendorTool,
  BulkUpdateVendorsTool,
  UploadVendorDocumentTool,
  CreateAssetTool,
  UploadUserDocumentTool,
  ListExternalEvidenceTool,
  CreateControlExternalEvidenceTool,
  ...ControlEvidenceLifecycleTools,
];
