import { makePrismTool } from "./_shared.js";

const PrismKernelExtensionsTool = makePrismTool(
  "prism_kernel_extensions",
  "kernel_extensions",
  "Get kernel extensions (kexts) loaded across all macOS devices via Prism. Returns the list of kernel extensions with team ID and bundle ID. Useful for identifying legacy kexts that may conflict with newer macOS versions or represent security risks.",
);

export default PrismKernelExtensionsTool;
