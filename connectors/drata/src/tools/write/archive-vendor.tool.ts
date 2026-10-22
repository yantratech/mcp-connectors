import { z } from "zod";
import { archiveVendor } from "../../handlers/vendor-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const ArchiveVendorTool = CreateDrataTool(
  "archive_vendor",
  "Archive a vendor by setting archivedAt via the update endpoint. The Drata API does not support DELETE for vendors.",
  {
    vendorId: z.number().describe("ID of the vendor to archive"),
  },
  async ({ vendorId }) => {
    const response = await archiveVendor(vendorId);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ArchiveVendorTool;
