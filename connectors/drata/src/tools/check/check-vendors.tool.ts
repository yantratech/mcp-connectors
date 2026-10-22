import { checkVendors } from "../../handlers/check-vendors.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const CheckVendorsTool = CreateDrataTool(
  "check_vendor_risk",
  "Vendor risk overview: every vendor (archived ones included but marked archived: true) with criticality/risk flags and security-review counts. Only COMPLETED reviews count in completedReviewCount — scheduled/in-progress reviews are pendingReviewCount, fallback detections with unknowable status are unverifiableReviewCount. Leading aggregates count active vendors lacking a completed review. Suggests starter vendor categories only when the inventory is empty. For the app-equivalent per-vendor review status use list_vendor_security_review_statuses.",
  {},
  async () => {
    const response = await checkVendors();

    if (response.isError) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${response.error}` }],
      };
    }

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(response.result, null, 2) },
      ],
    };
  },
);

export default CheckVendorsTool;
