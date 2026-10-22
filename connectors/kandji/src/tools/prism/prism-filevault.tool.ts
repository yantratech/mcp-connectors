import { makePrismTool } from "./_shared.js";

const PrismFileVaultTool = makePrismTool(
  "prism_filevault",
  "filevault",
  "Get FileVault disk encryption status across all macOS devices via Prism. Returns whether FileVault is enabled, the encryption state, and recovery key escrow status for each Mac. Full-disk encryption is a standard control that SOC 2, ISO 27001 and HIPAA programs are commonly assessed against.",
);

export default PrismFileVaultTool;
