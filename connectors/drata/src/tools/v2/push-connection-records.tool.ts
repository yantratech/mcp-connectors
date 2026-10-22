import { z } from "zod";
import { pushConnectionRecords } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const PushConnectionRecordsTool = CreateDrataTool(
  "push_connection_records",
  "Push records to a custom connection resource (V2).",
  {
    connectionId: z.number().describe("ID of the custom connection"),
    resourceId: z.number().describe("ID of the resource within the connection"),
    data: z
      .record(z.string(), z.unknown())
      .describe("Record data to push as key-value pairs"),
  },
  async ({ connectionId, resourceId, data }) => {
    const response = await pushConnectionRecords(connectionId, resourceId, data);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default PushConnectionRecordsTool;
