import { makePrismTool } from "./_shared.js";

const PrismDesktopAndScreensaverTool = makePrismTool(
  "prism_desktop_and_screensaver",
  "desktop_and_screensaver",
  "Get Desktop and Screensaver configuration across macOS devices via Prism. Returns screensaver settings including idle time, password requirement, and whether the screen locks. Useful for verifying lock-screen compliance policies.",
);

export default PrismDesktopAndScreensaverTool;
