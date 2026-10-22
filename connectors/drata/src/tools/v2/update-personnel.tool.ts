import { z } from "zod";
import { updatePersonnel, resolvePersonnelIdByEmail } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const UpdatePersonnelTool = CreateDrataTool(
  "update_personnel",
  "Update a personnel record (V2). Provide personnelId or lookupEmail to identify the person.",
  {
    personnelId: z.number().optional().describe("ID of the personnel to update (or use lookupEmail)"),
    lookupEmail: z.string().optional().describe("Email to look up the personnel ID (alternative to personnelId)"),
    firstName: z.string().optional().describe("Updated first name"),
    lastName: z.string().optional().describe("Updated last name"),
    jobTitle: z.string().optional().describe("Updated job title"),
    email: z.string().optional().describe("Updated email"),
  },
  async ({ personnelId, lookupEmail, ...fields }) => {
    try {
      let id = personnelId;
      if (!id && lookupEmail) {
        id = await resolvePersonnelIdByEmail(lookupEmail);
      }
      if (!id) {
        return { isError: true, content: [{ type: "text" as const, text: "Error: Provide either personnelId or lookupEmail" }] };
      }
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) body[k] = v;
      }
      const response = await updatePersonnel(id, body);
      if (response.isError) {
        return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  },
);

export default UpdatePersonnelTool;
