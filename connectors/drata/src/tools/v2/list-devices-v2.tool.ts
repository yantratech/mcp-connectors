import { z } from "zod";
import { listDevicesV2 } from "../../handlers/v2-write.handler.js";
import type { DrataQueryParams } from "../../clients/drata-client.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const ListDevicesV2Tool = CreateDrataTool(
  "list_devices_v2",
  "List devices with a compliance summary. By default each device is projected to compact, compliance-relevant fields and the inline list is bounded so the response stays under output limits. Use cursor/size for true cursor pagination (size caps returned devices), `fields` to choose exact device fields, or `fields: [\"*\"]` for full device objects (combine with a small size).",
  {
    cursor: z.string().optional().describe("Pagination cursor"),
    size: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Page size; caps the number of devices returned"),
    includeTotalCount: z
      .boolean()
      .optional()
      .describe("Ask Drata to include total count"),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Device fields to include (e.g. ["id","name","encryptionEnabled"]). Defaults to a compact set; use ["*"] for full objects.',
      ),
  },
  async ({ cursor, size, includeTotalCount, fields }) => {
    const params: DrataQueryParams = { cursor, size, includeTotalCount };
    const response = await listDevicesV2(params, { fields });
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ListDevicesV2Tool;
