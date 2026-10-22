import { listXeroBrandingThemes } from "../../handlers/list-xero-branding-themes.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ListBrandingThemesTool = CreateXeroTool(
  "list_branding_themes",
  "Lists all branding themes in Xero. Use this to find branding theme IDs for use when creating invoices or other documents.",
  {},
  async () => {
    const response = await listXeroBrandingThemes();
    if (response.error !== null) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing branding themes: ${response.error}`,
          },
        ],
      };
    }

    const brandingThemes = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${brandingThemes?.length || 0} branding themes:`,
        },
        ...(brandingThemes?.map((theme) => ({
          type: "text" as const,
          text: [
            `Branding Theme ID: ${theme.brandingThemeID || "N/A"}`,
            `Name: ${theme.name || "Unnamed"}`,
            theme.type ? `Type: ${theme.type}` : null,
            theme.sortOrder !== undefined ? `Sort Order: ${theme.sortOrder}` : null,
            theme.createdDateUTC ? `Created: ${theme.createdDateUTC}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        })) || []),
      ],
    };
  },
);

export default ListBrandingThemesTool;
