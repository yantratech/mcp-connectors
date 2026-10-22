import { makePrismTool } from "./_shared.js";

const PrismLocalUsersTool = makePrismTool(
  "prism_local_users",
  "local_users",
  "Get local user accounts on macOS devices via Prism. Returns local user names, admin status, and account details — one row per account per device, and the DEFAULT RESPONSE IS A CAPPED 20-ROW SLICE, not the whole fleet (page with max_results). Use for auditing local admin accounts — compliance frameworks typically require minimizing local admin privileges.",
);

export default PrismLocalUsersTool;
