import { getPrismCount } from "../../handlers/get-prism-count.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const PrismCountTool = CreateKandjiTool(
  "prism_count",
  "Get per-category row counts across all 16 Prism categories (apps, filevault, activation_lock, application_firewall, cellular, certificates, desktop_and_screensaver, device_information, gatekeeper_and_xprotect, installed_profiles, kernel_extensions, launch_agents_and_daemons, local_users, startup_settings, system_extensions, transparency_database). Returns { counts: { <category>: <int|null> }, errors? }. Cheap summary — use before fetching a category to gauge response size.",
  {},
  async () => {
    const response = await getPrismCount();
    if (response.isError) {
      return renderToolError(response);
    }
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(response.result, null, 2),
        },
      ],
    };
  },
);

export default PrismCountTool;
