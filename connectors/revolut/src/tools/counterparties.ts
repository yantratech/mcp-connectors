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

const DEFAULT_LIMIT = 100;

export function registerCounterpartyTools(
  server: McpServer,
  ctx: ToolContext,
): void {
  registerStrictTool(
    server,
    "list_counterparties",
    "List saved counterparties (payees). All filters optional. `name` is a " +
      "partial match; `sort_code` is only valid with `account_no`, and `bic` " +
      "only with `iban`. Pagination signals lead the response: `count` is " +
      "only this page's row count, and when `more_available` is true pass " +
      "`next_page_created_before` as `created_before` to fetch the next page " +
      "(items sharing that exact created_at may repeat or be skipped). " +
      "Read-only — this server cannot create, edit, or delete counterparties.",
    {
      name: z.string().optional().describe("Partial name match"),
      account_no: z.string().optional().describe("Exact account number match"),
      sort_code: z
        .string()
        .optional()
        .describe("Sort code — only allowed together with account_no"),
      iban: z.string().optional().describe("Exact IBAN match"),
      bic: z.string().optional().describe("BIC — only allowed together with iban"),
      created_before: z
        .string()
        .optional()
        .describe("ISO 8601; return counterparties created before this (cursor)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .describe("Page size, 1–1000 (default 100)"),
    },
    READ_ONLY,
    async ({ name, account_no, sort_code, iban, bic, created_before, limit }) => {
      // Enforce the documented combination rules up front (fail closed).
      if (sort_code && !account_no) {
        return fail("sort_code may only be used together with account_no.");
      }
      if (bic && !iban) {
        return fail("bic may only be used together with iban.");
      }
      const effectiveLimit = limit ?? DEFAULT_LIMIT;
      // Audit trail: never log full bank details — mask filters to last 4.
      ctx.log("list_counterparties", {
        name,
        account_no: account_no ? `…${account_no.slice(-4)}` : undefined,
        iban: iban ? `…${iban.slice(-4)}` : undefined,
        created_before,
        limit: effectiveLimit,
      });
      try {
        const counterparties = await ctx.client.listCounterparties({
          name,
          account_no,
          sort_code,
          iban,
          bic,
          created_before,
          limit: effectiveLimit,
        });
        const last = counterparties[counterparties.length - 1] as
          | { created_at?: string }
          | undefined;
        const nextPage =
          counterparties.length >= effectiveLimit && last?.created_at
            ? last.created_at
            : null;
        return ok({
          count: counterparties.length,
          more_available: nextPage !== null,
          next_page_created_before: nextPage,
          ...(nextPage !== null && {
            page_note:
              `Showing ${counterparties.length} counterparties of an ` +
              "unknown total — pass next_page_created_before as " +
              "`created_before` for the next page.",
          }),
          counterparties,
        });
      } catch (error) {
        return fail(errorMessage(error));
      }
    },
  );

  registerStrictTool(
    server,
    "get_counterparty",
    "Get a single counterparty by id, including its accounts[] and cards[] " +
      "(IBAN/account number/sort code/BIC/currency) so a payee can be " +
      "sanity-checked. Read-only.",
    {
      counterparty_id: z.string().guid().describe("Counterparty UUID"),
    },
    READ_ONLY,
    async ({ counterparty_id }) => {
      ctx.log("get_counterparty", { counterparty_id });
      try {
        return ok(await ctx.client.getCounterparty(counterparty_id));
      } catch (error) {
        return fail(errorMessage(error));
      }
    },
  );
}
