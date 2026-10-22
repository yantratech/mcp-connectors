import { z } from "zod";
import {
  createBackgroundCheck,
  resolveUserIdForPersonnel,
} from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const CreateBackgroundCheckTool = CreateDrataTool(
  "create_background_check",
  "Create a background check record for a personnel member (V2). Provide exactly one of: userId, personnelId, or lookupEmail to identify the person. The Drata V2 endpoint keys off userId; personnelId/lookupEmail are resolved to a userId before posting.",
  {
    userId: z
      .number()
      .optional()
      .describe(
        "ID of the user (preferred — V2 endpoint posts userId directly). Provide exactly one of userId, personnelId, or lookupEmail.",
      ),
    personnelId: z
      .number()
      .optional()
      .describe(
        "ID of the personnel record. Resolved to its userId via the personnel list.",
      ),
    lookupEmail: z
      .string()
      .optional()
      .describe(
        "Email to look up the personnel/user. Resolved to a userId via the personnel list.",
      ),
    url: z.string().describe("URL of the background check report"),
    filedAt: z
      .string()
      .optional()
      .describe("Date the background check was filed (ISO 8601)"),
  },
  async ({ userId, personnelId, lookupEmail, ...rest }) => {
    const provided = [userId, personnelId, lookupEmail].filter(
      (v) => v !== undefined,
    ).length;
    if (provided !== 1) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "Error: Provide exactly one of userId, personnelId, or lookupEmail.",
          },
        ],
      };
    }

    try {
      const resolvedUserId = await resolveUserIdForPersonnel({
        userId,
        personnelId,
        lookupEmail,
      });
      const response = await createBackgroundCheck({
        userId: resolvedUserId,
        ...rest,
      });
      if (response.isError) {
        return {
          isError: true,
          content: [
            { type: "text" as const, text: `Error: ${response.error}` },
          ],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(response.result, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  },
);

export default CreateBackgroundCheckTool;
