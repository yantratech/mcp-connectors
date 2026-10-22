import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  errorMessage,
  fail,
  ok,
  READ_ONLY,
  registerStrictTool,
  type ToolContext,
} from "../mcp-helpers.js";

export function registerAccountTools(
  server: McpServer,
  ctx: ToolContext,
): void {
  registerStrictTool(
    server,
    "list_accounts",
    "List all Revolut Business accounts. Each account carries id, balance, " +
      "currency, state, public, created_at, updated_at — and usually name, " +
      "but `name` is absent on unnamed accounts, so never index accounts by " +
      "name. `balance` is the single current figure the API reports, in the " +
      "account's `currency`; Revolut provides no available/current/pending " +
      "breakdown, so pending card authorizations cannot be distinguished " +
      "from settled funds. Read-only.",
    {},
    READ_ONLY,
    async () => {
      ctx.log("list_accounts");
      try {
        const accounts = await ctx.client.listAccounts();
        return ok({
          count: accounts.length,
          balance_note:
            "balance is the single current figure Revolut reports (no " +
            "available/pending split exists in this API); `name` may be " +
            "absent on unnamed accounts.",
          accounts,
        });
      } catch (error) {
        return fail(errorMessage(error));
      }
    },
  );

  registerStrictTool(
    server,
    "get_account",
    "Get a single Revolut Business account by id. `balance` is the single " +
      "current figure the API reports (no available/pending split); `name` " +
      "may be absent on unnamed accounts. Set include_bank_details to " +
      "also fetch its bank details (an array of per-scheme routes: IBAN, BIC, " +
      "account number, sort code, beneficiary, ...), merged under a " +
      "`bank_details` key. Read-only.",
    {
      account_id: z.string().guid().describe("Account UUID (from list_accounts)"),
      include_bank_details: z
        .boolean()
        .optional()
        .describe("Also fetch and merge the account's bank details"),
    },
    READ_ONLY,
    async ({ account_id, include_bank_details }) => {
      ctx.log("get_account", { account_id, include_bank_details });
      try {
        const account = await ctx.client.getAccount(account_id);
        if (include_bank_details) {
          const bankDetails =
            await ctx.client.getAccountBankDetails(account_id);
          return ok({ ...account, bank_details: bankDetails });
        }
        return ok(account);
      } catch (error) {
        return fail(errorMessage(error));
      }
    },
  );
}
