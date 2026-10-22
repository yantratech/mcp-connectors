import { makePrismTool } from "./_shared.js";

const PrismDeviceInformationTool = makePrismTool(
  "prism_device_information",
  "device_information",
  "Get fleet-wide device information via Prism. Returns general details for all enrolled devices including device name, serial number, model, OS version, assigned user, blueprint, and last check-in. Use this for aggregate fleet reporting instead of querying devices one by one.",
);

export default PrismDeviceInformationTool;
