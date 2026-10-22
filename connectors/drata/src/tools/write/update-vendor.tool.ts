import { z } from "zod";
import { updateVendor } from "../../handlers/vendor-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const UpdateVendorTool = CreateDrataTool(
  "update_vendor",
  "Update an existing vendor in the Drata vendor inventory. Only provided fields will be updated.",
  {
    vendorId: z.number().describe("ID of the vendor to update"),
    name: z.string().optional().describe("Vendor name"),
    category: z
      .enum([
        "ENGINEERING",
        "PRODUCT",
        "MARKETING",
        "CS",
        "SALES",
        "FINANCE",
        "HR",
        "ADMINISTRATIVE",
        "SECURITY",
      ])
      .optional()
      .describe("Vendor department/category"),
    risk: z
      .enum(["NONE", "LOW", "MODERATE", "HIGH"])
      .optional()
      .describe("Risk level for customer data"),
    critical: z.boolean().optional().describe("Is the vendor critical?"),
    isSubProcessor: z
      .boolean()
      .optional()
      .describe("Is the vendor a sub-processor?"),
    isSubProcessorActive: z
      .boolean()
      .optional()
      .describe("Is the sub-processor active?"),
    userId: z
      .number()
      .optional()
      .describe("Personnel ID of the compliance owner"),
    url: z.string().optional().describe("Vendor website URL"),
    privacyUrl: z.string().optional().describe("Privacy policy URL"),
    termsUrl: z.string().optional().describe("Terms of use URL"),
    servicesProvided: z
      .string()
      .optional()
      .describe("Description of services provided"),
    dataStored: z
      .string()
      .optional()
      .describe("What data the vendor stores"),
    location: z.string().optional().describe("Vendor location"),
    hasPii: z.boolean().optional().describe("Does vendor store PII?"),
    passwordPolicy: z
      .enum(["USERNAME_PASSWORD", "SSO", "LDAP"])
      .optional()
      .describe("Authentication method used"),
    passwordRequiresMinLength: z
      .boolean()
      .optional()
      .describe("Is minimum password length enforced?"),
    passwordRequiresNumber: z
      .boolean()
      .optional()
      .describe("Are numbers required in password?"),
    passwordRequiresSymbol: z
      .boolean()
      .optional()
      .describe("Are symbols required in password?"),
    passwordMfaEnabled: z.boolean().optional().describe("Is MFA enabled?"),
    accountManagerName: z
      .string()
      .optional()
      .describe("Vendor account manager name"),
    accountManagerEmail: z
      .string()
      .optional()
      .describe("Vendor account manager email"),
    isComplianceReviewRequired: z
      .boolean()
      .optional()
      .describe("Is compliance review required?"),
    passwordMinLength: z
      .number()
      .optional()
      .describe("Minimum password length"),
    renewalDate: z
      .string()
      .optional()
      .describe("Contract renewal date (ISO 8601, e.g. 2025-01-01T00:00:00.000Z)"),
    renewalScheduleType: z
      .enum([
        "ONE_MONTH",
        "TWO_MONTHS",
        "THREE_MONTHS",
        "SIX_MONTHS",
        "ONE_YEAR",
        "CUSTOM",
      ])
      .optional()
      .describe("Renewal schedule type"),
    notes: z.string().optional().describe("Additional notes"),
    confirmed: z
      .boolean()
      .optional()
      .describe("Is all vendor data confirmed?"),
    impactLevel: z
      .enum(["INSIGNIFICANT", "MINOR", "MODERATE", "MAJOR", "CRITICAL", "UNSCORED"])
      .optional()
      .describe("Vendor risk impact level"),
  },
  async ({ vendorId, ...fields }) => {
    const response = await updateVendor(vendorId, fields);

    if (response.isError) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${response.error}` }],
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
  },
);

export default UpdateVendorTool;
