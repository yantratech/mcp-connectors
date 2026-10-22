import { testConnection } from "../../handlers/test-connection.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";

const TestConnectionTool = CreateKandjiTool(
  "test_connection",
  "Validate that the Kandji API token and base URL are configured correctly. Makes a lightweight API call and reports whether the connection is working. Run this first to verify credentials before using other tools.",
  {},
  async () => {
    const response = await testConnection();

    if (response.isError) {
      const lines = [`Connection failed: ${response.error}`];
      if (response.hint) lines.push(`Hint: ${response.hint}`);
      return {
        isError: true,
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }

    return {
      content: [
        { type: "text" as const, text: response.result.message },
      ],
    };
  },
);

export default TestConnectionTool;
