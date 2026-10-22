/**
 * Offline zod input-schema validation.
 *
 * Imports tool factories from compiled dist/ and checks that realistic
 * inputs parse while malformed inputs are rejected. No Xero account and no
 * network access are required: handlers are never invoked, and the dummy
 * env vars exist only to satisfy the xero-client module-init guard (the
 * tool modules transitively import it).
 *
 * Run via `npm test` (node --test test/*.test.mjs) after `npm run build`.
 */
process.env.XERO_CLIENT_ID = "offline-test-id";
process.env.XERO_CLIENT_SECRET = "offline-test-secret";
process.env.XERO_CLIENT_BEARER_TOKEN = "";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

// Dynamic imports so the env assignments above run first (static imports
// are hoisted ahead of them).
const { default: createInvoiceFactory } = await import(
  "../dist/tools/create/create-invoice.tool.js"
);
const { default: updateInvoiceFactory } = await import(
  "../dist/tools/update/update-invoice.tool.js"
);
const { default: createContactFactory } = await import(
  "../dist/tools/create/create-contact.tool.js"
);
const { default: updateContactFactory } = await import(
  "../dist/tools/update/update-contact.tool.js"
);
const { default: listContactsFactory } = await import(
  "../dist/tools/list/list-contacts.tool.js"
);
const { default: createCreditNoteFactory } = await import(
  "../dist/tools/create/create-credit-note.tool.js"
);
const { default: updateCreditNoteFactory } = await import(
  "../dist/tools/update/update-credit-note.tool.js"
);

const schemaOf = (factory) => z.object(factory().schema);

const accepts = (schema, input, message) =>
  assert.equal(schema.safeParse(input).success, true, message);
const rejects = (schema, input, message) =>
  assert.equal(schema.safeParse(input).success, false, message);

const LINE_ITEM = {
  description: "Consulting services",
  quantity: 1,
  unitAmount: 10,
  accountCode: "200",
  taxType: "NONE",
};

describe("create_invoice schema", () => {
  const s = schemaOf(createInvoiceFactory);
  const base = { contactId: "c-1", lineItems: [LINE_ITEM], type: "ACCREC" };

  it("accepts a minimal valid invoice", () => {
    accepts(s, base);
  });

  it("accepts an optional invoiceNumber", () => {
    accepts(s, { ...base, invoiceNumber: "INV-001" });
  });

  it("rejects an empty invoiceNumber", () => {
    rejects(s, { ...base, invoiceNumber: "" });
  });

  it("rejects a whitespace-only invoiceNumber", () => {
    rejects(s, { ...base, invoiceNumber: "   " });
  });

  it("trims surrounding whitespace from invoiceNumber", () => {
    const parsed = s.safeParse({ ...base, invoiceNumber: "  INV-002  " });
    assert.equal(parsed.success, true);
    assert.equal(parsed.data.invoiceNumber, "INV-002");
  });

  it("rejects garbage input", () => {
    rejects(s, {});
    rejects(s, { contactId: "c-1", lineItems: "not-an-array" });
    rejects(s, { ...base, lineItems: [{ description: 42 }] });
  });
});

describe("update_invoice schema", () => {
  const s = schemaOf(updateInvoiceFactory);
  const base = { invoiceId: "i-1" };

  it("accepts an update with only invoiceId", () => {
    accepts(s, base);
  });

  it("accepts an optional invoiceNumber", () => {
    accepts(s, { ...base, invoiceNumber: "INV-9" });
  });

  it("rejects empty and whitespace-only invoiceNumbers", () => {
    rejects(s, { ...base, invoiceNumber: "" });
    rejects(s, { ...base, invoiceNumber: "   " });
  });

  it("rejects a missing invoiceId", () => {
    rejects(s, { invoiceNumber: "INV-9" });
  });
});

describe("create_contact schema", () => {
  const s = schemaOf(createContactFactory);
  const base = { name: "Acme" };

  it("accepts a minimal valid contact", () => {
    accepts(s, base);
  });

  it("rejects a contact without a name", () => {
    rejects(s, {});
  });

  it("accepts an optional accountNumber", () => {
    accepts(s, { ...base, accountNumber: "ACME-001" });
  });

  it("rejects empty and whitespace-only accountNumbers", () => {
    rejects(s, { ...base, accountNumber: "" });
    rejects(s, { ...base, accountNumber: "   " });
  });

  it("trims surrounding whitespace from accountNumber", () => {
    const parsed = s.safeParse({ ...base, accountNumber: "  C-9  " });
    assert.equal(parsed.success, true);
    assert.equal(parsed.data.accountNumber, "C-9");
  });

  it("accepts the legacy phone string", () => {
    accepts(s, { ...base, phone: "+44 1234 567890" });
  });

  it("accepts a phones array with MOBILE", () => {
    accepts(s, {
      ...base,
      phones: [{ phoneType: "MOBILE", phoneNumber: "+44 1234 567890" }],
    });
  });

  it("rejects an unknown phoneType", () => {
    rejects(s, {
      ...base,
      phones: [{ phoneType: "PAGER", phoneNumber: "1234" }],
    });
  });

  it("accepts an addresses array with POBOX", () => {
    accepts(s, {
      ...base,
      addresses: [
        {
          addressType: "POBOX",
          addressLine1: "PO Box 123",
          city: "Example Town",
          postalCode: "AB1 2CD",
          country: "Exampleland",
        },
      ],
    });
  });

  it("accepts an addresses array with DELIVERY", () => {
    accepts(s, {
      ...base,
      addresses: [
        { addressType: "DELIVERY", addressLine1: "Unit 5, Industrial Park" },
      ],
    });
  });

  it("rejects an unknown addressType", () => {
    rejects(s, {
      ...base,
      addresses: [{ addressType: "FOO", addressLine1: "x" }],
    });
  });

  it("accepts POBOX + STREET multi-address input", () => {
    accepts(s, {
      ...base,
      addresses: [
        { addressType: "POBOX", addressLine1: "PO Box 123" },
        { addressType: "STREET", addressLine1: "1 High Street" },
      ],
    });
  });

  it("accepts an address with attentionTo", () => {
    accepts(s, {
      ...base,
      addresses: [
        {
          addressType: "STREET",
          addressLine1: "1 High Street",
          attentionTo: "Accounts Payable",
        },
      ],
    });
  });
});

describe("update_contact schema", () => {
  const s = schemaOf(updateContactFactory);
  const base = { contactId: "c-1", name: "Acme" };

  it("accepts a minimal valid update", () => {
    accepts(s, base);
  });

  it("accepts an optional accountNumber and rejects an empty one", () => {
    accepts(s, { ...base, accountNumber: "ACME-002" });
    rejects(s, { ...base, accountNumber: "" });
  });

  it("accepts the legacy single address", () => {
    accepts(s, {
      ...base,
      address: { addressLine1: "1 High Street", city: "London" },
    });
  });

  it("accepts the legacy single phone", () => {
    accepts(s, { ...base, phone: "+44 1234" });
  });

  it("accepts the new addresses array", () => {
    accepts(s, {
      ...base,
      addresses: [{ addressType: "POBOX", addressLine1: "PO Box 99" }],
    });
  });

  it("accepts legacy and new fields together (handler prefers new)", () => {
    accepts(s, {
      ...base,
      address: { addressLine1: "Legacy" },
      addresses: [{ addressType: "POBOX", addressLine1: "New" }],
      phone: "legacy",
      phones: [{ phoneType: "DEFAULT", phoneNumber: "new" }],
    });
  });

  it("accepts DEFAULT/MOBILE/FAX/DDI phone types", () => {
    accepts(s, {
      ...base,
      phones: [
        { phoneType: "DEFAULT", phoneNumber: "+1" },
        { phoneType: "MOBILE", phoneNumber: "+2" },
        { phoneType: "FAX", phoneNumber: "+3" },
        { phoneType: "DDI", phoneNumber: "+4" },
      ],
    });
  });
});

describe("list_contacts schema", () => {
  const s = schemaOf(listContactsFactory);

  it("accepts empty input", () => {
    accepts(s, {});
  });

  it("accepts an accountNumber filter and rejects an empty one", () => {
    accepts(s, { accountNumber: "ACME-001" });
    rejects(s, { accountNumber: "" });
  });

  it("accepts accountNumber and searchTerm together", () => {
    accepts(s, { accountNumber: "ACME-001", searchTerm: "acme" });
  });
});

describe("create_credit_note schema", () => {
  const s = schemaOf(createCreditNoteFactory);
  const base = { contactId: "c-1", lineItems: [LINE_ITEM] };

  it("accepts a minimal valid credit note", () => {
    accepts(s, base);
  });

  it("accepts an optional creditNoteNumber", () => {
    accepts(s, { ...base, creditNoteNumber: "CN-001" });
  });

  it("rejects empty and whitespace-only creditNoteNumbers", () => {
    rejects(s, { ...base, creditNoteNumber: "" });
    rejects(s, { ...base, creditNoteNumber: "   " });
  });

  it("trims surrounding whitespace from creditNoteNumber", () => {
    const parsed = s.safeParse({ ...base, creditNoteNumber: "  CN-002  " });
    assert.equal(parsed.success, true);
    assert.equal(parsed.data.creditNoteNumber, "CN-002");
  });
});

describe("update_credit_note schema", () => {
  const s = schemaOf(updateCreditNoteFactory);
  const base = { creditNoteId: "cn-1" };

  it("accepts an update with only creditNoteId", () => {
    accepts(s, base);
  });

  it("accepts an optional creditNoteNumber", () => {
    accepts(s, { ...base, creditNoteNumber: "CN-9" });
  });

  it("rejects empty and whitespace-only creditNoteNumbers", () => {
    rejects(s, { ...base, creditNoteNumber: "" });
    rejects(s, { ...base, creditNoteNumber: "   " });
  });
});
