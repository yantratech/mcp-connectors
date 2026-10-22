import { z } from "zod";
import { createXeroFolder } from "../../handlers/create-xero-folder.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const CreateFolderTool = CreateXeroTool(
  "create_folder",
  "Create a new folder in Xero Files. Use this to organise files into folders.",
  {
    name: z
      .string()
      .describe("The name of the folder to create."),
  },
  async ({ name }) => {
    const response = await createXeroFolder(name);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error creating folder: ${response.error}`,
          },
        ],
      };
    }

    const folder = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Folder created successfully:",
            `Folder ID: ${folder.id}`,
            `Name: ${folder.name}`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default CreateFolderTool;
