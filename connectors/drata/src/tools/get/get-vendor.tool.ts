import { z } from "zod";
import { getVendor } from "../../handlers/vendor-read.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const GetVendorTool = CreateDrataTool(
  "get_vendor",
  "Get a single vendor by ID (profile, risk, password policy). Carries NO security-review data — upstream returns always-empty review arrays on this endpoint, so they are omitted; use list_vendor_security_reviews for reviews. Lighter than list_vendors when you only need one.",
  {
    vendorId: z.number().describe("ID of the vendor to retrieve"),
  },
  async ({ vendorId }) => {
    const response = await getVendor(vendorId);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default GetVendorTool;
