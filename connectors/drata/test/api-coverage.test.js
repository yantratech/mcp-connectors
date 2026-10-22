import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync, unlinkSync } from "node:fs";

let server;
let baseUrl;
let requests;

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

before(async () => {
  requests = [];
  server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    requests.push({
      method: req.method,
      url: req.url,
      body,
      contentType: req.headers["content-type"],
    });

    res.setHeader("content-type", "application/json");
    if (req.method === "DELETE") {
      res.end(JSON.stringify({ deleted: true }));
      return;
    }
    if (
      req.method === "GET" &&
      req.url === "/public/v2/workspaces/1/evidence-library/77"
    ) {
      res.end(
        JSON.stringify({
          id: 77,
          renewalScheduleType: "ONE_YEAR",
          renewalDate: "2027-06-03",
        }),
      );
      return;
    }
    if (req.url?.includes("/download")) {
      res.end(JSON.stringify({ downloadUrl: "https://example.test/download" }));
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/public/v2/devices/123/documents")) {
      res.end(
        JSON.stringify({
          documents: [
            {
              id: 456,
              type: "PASSWORD_MANAGER_EVIDENCE",
              name: "Password Manager Evidence",
            },
          ],
        }),
      );
      return;
    }
    res.end(JSON.stringify({ data: [], pagination: { cursor: null }, ok: true }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  process.env.DRATA_API_KEY = "test-key";
  process.env.DRATA_BASE_URL = baseUrl;
  process.env.DRATA_WORKSPACE_ID = "1";
  process.env.DRATA_RISK_REGISTER_ID = "2";
});

beforeEach(() => {
  requests.length = 0;
  delete process.env.DRATA_MCP_DRY_RUN;
  delete process.env.DRATA_MCP_AUDIT_LOG;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("artifact-source validation", () => {
  it("requires exactly one create artifact source", async () => {
    const { validateExactlyOneArtifactSource } = await import(
      "../dist/helpers/artifact-source.js"
    );

    assert.equal(
      validateExactlyOneArtifactSource({ fileBase64: "abc" }),
      null,
    );
    assert.match(
      validateExactlyOneArtifactSource({ fileBase64: "abc", url: "https://example.test" }),
      /exactly one/,
    );
    assert.match(validateExactlyOneArtifactSource({}), /exactly one/);
  });
});

describe("new Drata API coverage", () => {
  it("has MCP annotations on every registered tool", async () => {
    const { CheckTools } = await import("../dist/tools/check/index.js");
    const { GetTools } = await import("../dist/tools/get/index.js");
    const { ListTools } = await import("../dist/tools/list/index.js");
    const { WriteTools } = await import("../dist/tools/write/index.js");
    const { V2Tools } = await import("../dist/tools/v2/index.js");
    const { GitHubTools } = await import("../dist/tools/github/index.js");

    const tools = [
      ...CheckTools,
      ...GetTools,
      ...ListTools,
      ...WriteTools,
      ...V2Tools,
      ...GitHubTools,
    ].map((factory) => factory());
    const missing = tools
      .filter((tool) => !tool.annotations)
      .map((tool) => tool.name);

    assert.deepEqual(missing, []);
    assert.equal(
      tools.find((tool) => tool.name === "upsert_custom_data_records")?.annotations
        ?.readOnlyHint,
      false,
    );
    assert.equal(
      tools.find((tool) => tool.name === "fulfil_templated_evidence")?.annotations
        ?.readOnlyHint,
      false,
    );
  });

  it("creates evidence library URL items", async () => {
    const { createEvidenceLibraryItem } = await import(
      "../dist/handlers/v2-write.handler.js"
    );

    const result = await createEvidenceLibraryItem({
      name: "Architecture diagram",
      url: "https://example.test/diagram",
      controlIds: [11, 12],
      ownerId: 1,
      filedAt: "2026-06-03",
      renewalScheduleType: "ONE_YEAR",
      renewalDate: "2027-06-03",
    });

    assert.equal(result.isError, false);
    assert.equal(requests[0].method, "POST");
    assert.equal(requests[0].url, "/public/v2/workspaces/1/evidence-library");
    assert.match(requests[0].contentType, /application\/json/);
    const body = JSON.parse(requests[0].body);
    assert.equal(body.name, "Architecture diagram");
    assert.equal(body.url, "https://example.test/diagram");
    assert.equal(body.ownerId, 1);
    assert.deepEqual(body.controlIds, [11, 12]);
    assert.equal(body.source, undefined);
    assert.equal(body.renewalDate, undefined);
  });

  it("keeps old evidence fileName input shape through the tool", async () => {
    const { default: CreateEvidenceLibraryItemTool } = await import(
      "../dist/tools/v2/create-evidence-library-item.tool.js"
    );
    const tool = CreateEvidenceLibraryItemTool();

    const result = await tool.handler({
      fileBase64: Buffer.from("hello").toString("base64"),
      fileName: "old-shape.pdf",
      description: "legacy call",
      ownerId: 1,
      filedAt: "2026-06-03",
      renewalScheduleType: "ONE_YEAR",
    });

    assert.equal(result.content[0].type, "text");
    assert.equal(requests[0].method, "POST");
    const body = JSON.parse(requests[0].body);
    assert.equal(body.name, "old-shape.pdf");
    assert.equal(body.source, undefined);
    assert.equal(body.base64File, Buffer.from("hello").toString("base64"));
  });

  it("preserves evidence renewal metadata on update when omitted", async () => {
    const { updateEvidenceLibraryItem } = await import(
      "../dist/handlers/v2-write.handler.js"
    );

    const result = await updateEvidenceLibraryItem({
      itemId: 77,
      description: "metadata-only update",
    });

    assert.equal(result.isError, false);
    assert.equal(requests[0].method, "GET");
    assert.equal(requests[0].url, "/public/v2/workspaces/1/evidence-library/77");
    assert.equal(requests[1].method, "PUT");
    assert.equal(requests[1].url, "/public/v2/workspaces/1/evidence-library/77");
    const body = JSON.parse(requests[1].body);
    assert.deepEqual(body, {
      description: "metadata-only update",
      renewalScheduleType: "ONE_YEAR",
    });
  });

  it("rejects invalid evidence renewal metadata locally", async () => {
    const { default: CreateEvidenceLibraryItemTool } = await import(
      "../dist/tools/v2/create-evidence-library-item.tool.js"
    );
    const tool = CreateEvidenceLibraryItemTool();

    const result = await tool.handler({
      name: "Invalid renewal",
      url: "https://example.test/evidence",
      ownerId: 1,
      filedAt: "2026-06-03",
      renewalScheduleType: "ONE_YEAR",
      renewalDate: "2027-06-03",
    });

    assert.match(result.content[0].text, /renewalDate is only allowed/);
    assert.equal(requests.length, 0);
  });

  it("sends required non-CUSTOM renewalDate to control external evidence", async () => {
    const { createControlExternalEvidence } = await import(
      "../dist/handlers/write-evidence.handler.js"
    );

    const result = await createControlExternalEvidence({
      controlId: 58,
      filename: "Control evidence",
      url: "https://example.test/evidence",
      creationDate: "2026-06-03T00:00:00Z",
      renewalDate: "2027-06-03T00:00:00Z",
      renewalScheduleType: "ONE_YEAR",
    });

    assert.equal(result.isError, false);
    assert.equal(requests[0].method, "POST");
    assert.equal(
      requests[0].url,
      "/public/workspaces/1/controls/58/external-evidence",
    );
    assert.match(requests[0].body, /renewalDate/);
    assert.match(requests[0].body, /2027-06-03T00%3A00%3A00Z|2027-06-03T00:00:00Z/);
    assert.match(requests[0].body, /renewalScheduleType/);
  });

  it("dry-runs writes and logs exact JSON payloads without sending", async () => {
    const auditPath = `/tmp/drata-api-coverage-audit-${process.pid}.jsonl`;
    try {
      unlinkSync(auditPath);
    } catch {
      /* absent */
    }
    process.env.DRATA_MCP_DRY_RUN = "true";
    process.env.DRATA_MCP_AUDIT_LOG = auditPath;
    const { createVendorSecurityReview } = await import(
      "../dist/handlers/v2-write.handler.js"
    );

    const result = await createVendorSecurityReview(42, {
      reviewDeadlineAt: "2026-04-09T00:00:00Z",
      securityReviewStatus: "COMPLETED",
      securityReviewType: "SECURITY",
      requesterUserId: 1,
    });

    assert.equal(result.isError, false);
    assert.equal(requests.length, 0);
    assert.deepEqual(result.result, {
      dryRun: true,
      note: "DRY RUN — no mutation was performed",
      method: "POST",
      path: "/public/v2/vendors/42/security-reviews",
      body: {
        reviewDeadlineAt: "2026-04-09T00:00:00Z",
        securityReviewStatus: "COMPLETED",
        securityReviewType: "SECURITY",
        requesterUserId: 1,
      },
    });
    const audit = JSON.parse(readFileSync(auditPath, "utf8").trim());
    assert.equal(audit.dryRun, true);
    assert.equal(audit.path, "/public/v2/vendors/42/security-reviews");
    assert.equal(audit.request.body.requesterUserId, 1);
  });

  it("sends documented required title on vendor security review file uploads", async () => {
    process.env.DRATA_MCP_DRY_RUN = "true";
    const { default: CreateVendorSecurityReviewWithFileTool } = await import(
      "../dist/tools/v2/create-vendor-security-review-with-file.tool.js"
    );
    const tool = CreateVendorSecurityReviewWithFileTool();

    const result = await tool.handler({
      vendorId: 42,
      fileBase64: Buffer.from("soc report").toString("base64"),
      fileName: "soc.pdf",
      title: "SOC 2 review",
      reviewDeadlineAt: "2026-04-09T00:00:00Z",
      requestedAt: "2026-04-01T00:00:00Z",
      securityReviewStatus: "COMPLETED",
      securityReviewType: "SOC_REPORT",
      requesterUserId: 1,
      documentType: "SOC_DOCUMENT",
    });

    assert.equal(result.content[0].type, "text");
    assert.equal(requests.length, 0);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.method, "POST");
    assert.equal(parsed.path, "/public/v2/vendors/42/security-reviews/with-file");
    assert.deepEqual(parsed.fields, {
      title: "SOC 2 review",
      reviewDeadlineAt: "2026-04-09T00:00:00Z",
      securityReviewStatus: "COMPLETED",
      securityReviewType: "SOC_REPORT",
      requesterUserId: "1",
      requestedAt: "2026-04-01T00:00:00Z",
      documentType: "SOC_DOCUMENT",
    });
    assert.deepEqual(parsed.file, {
      fieldName: "file",
      fileName: "soc.pdf",
      bytes: 10,
    });
  });

  it("passes risk list filters and cursor through", async () => {
    const { listRisks } = await import("../dist/handlers/v2-write.handler.js");

    const result = await listRisks(undefined, {
      cursor: "abc",
      size: 25,
      includeTotalCount: true,
      title: "vendor",
      status: "OPEN",
      treatmentPlan: "MITIGATE",
      minScore: 3,
      maxScore: 9,
      vendorId: 42,
    });

    assert.equal(result.isError, false);
    assert.equal(requests[0].method, "GET");
    assert.match(requests[0].url, /^\/public\/v2\/risk-registers\/2\/risks\?/);
    assert.match(requests[0].url, /cursor=abc/);
    assert.match(requests[0].url, /includeTotalCount=true/);
    assert.match(requests[0].url, /treatmentPlan=MITIGATE/);
  });

  it("allows string risk identifiers when listing risk documents", async () => {
    const { default: ListRiskDocumentsTool } = await import(
      "../dist/tools/v2/list-risk-documents.tool.js"
    );
    const tool = ListRiskDocumentsTool();

    const result = await tool.handler({
      riskId: "RISK-001",
      size: 10,
    });

    assert.equal(result.content[0].type, "text");
    assert.equal(requests[0].method, "GET");
    assert.match(
      requests[0].url,
      /^\/public\/v2\/risk-registers\/2\/risks\/RISK-001\/documents\?/,
    );
    assert.match(requests[0].url, /size=10/);
  });

  it("uploads risk documents using Drata's documented `files` multipart field", async () => {
    process.env.DRATA_MCP_DRY_RUN = "true";
    const { uploadRiskDocument } = await import(
      "../dist/handlers/v2-write.handler.js"
    );

    const result = await uploadRiskDocument(
      undefined,
      "RISK-001",
      new Uint8Array([1, 2, 3]),
      "risk.pdf",
    );

    assert.equal(result.isError, false);
    assert.equal(requests.length, 0);
    assert.deepEqual(result.result, {
      dryRun: true,
      note: "DRY RUN — no mutation was performed",
      method: "POST",
      path: "/public/v2/risk-registers/2/risks/RISK-001/documents",
      fields: {},
      file: {
        fieldName: "files",
        fileName: "risk.pdf",
        bytes: 3,
      },
    });
  });

  it("passes documented list_risk_notes pagination and owner expansion params", async () => {
    const { default: ListRiskNotesTool } = await import(
      "../dist/tools/v2/list-risk-notes.tool.js"
    );
    const tool = ListRiskNotesTool();

    const result = await tool.handler({
      riskId: 7,
      cursor: "next",
      size: 25,
      sort: "updatedAt",
      sortDir: "DESC",
      expand: ["owner"],
    });

    assert.equal(result.content[0].type, "text");
    assert.equal(requests[0].method, "GET");
    assert.match(
      requests[0].url,
      /^\/public\/v2\/risk-registers\/2\/risks\/7\/notes\?/,
    );
    assert.match(requests[0].url, /cursor=next/);
    assert.match(requests[0].url, /size=25/);
    assert.match(requests[0].url, /sort=updatedAt/);
    assert.match(requests[0].url, /sortDir=DESC/);
    assert.match(requests[0].url, /expand=owner/);
  });

  it("sends task action request body", async () => {
    const { performTaskAction } = await import("../dist/handlers/v2-write.handler.js");

    const result = await performTaskAction(undefined, 9, "complete");

    assert.equal(result.isError, false);
    assert.equal(requests[0].method, "POST");
    assert.equal(requests[0].url, "/public/v2/workspaces/1/tasks/9/actions");
    assert.deepEqual(JSON.parse(requests[0].body), { action: "complete" });
  });

  it("serializes list_tasks taskType using Drata's documented query param", async () => {
    const { TaskOperationsTools } = await import(
      "../dist/tools/v2/task-operations.tools.js"
    );
    const tool = TaskOperationsTools.find(
      (candidate) => candidate().name === "list_tasks",
    )();

    const result = await tool.handler({
      taskType: "CONTROL",
      status: "INCOMPLETE",
      controlId: 58,
    });

    assert.equal(result.content[0].type, "text");
    assert.equal(requests[0].method, "GET");
    assert.match(requests[0].url, /^\/public\/v2\/workspaces\/1\/tasks\?/);
    assert.match(requests[0].url, /taskType=CONTROL/);
    assert.match(requests[0].url, /controlId=58/);
    assert.doesNotMatch(requests[0].url, /(^|[?&])type=/);
  });

  it("keeps list_upcoming_tasks defaults when the tool layer forwards undefined params", async () => {
    // Regression: the tool layer builds params with explicit `undefined`
    // values for omitted args. The old `{ ...defaults, ...params }` merge
    // let those undefineds clobber every default, so a bare
    // list_upcoming_tasks degraded into an unfiltered list_tasks.
    const { TaskOperationsTools } = await import(
      "../dist/tools/v2/task-operations.tools.js"
    );
    const tool = TaskOperationsTools.find(
      (candidate) => candidate().name === "list_upcoming_tasks",
    )();

    const result = await tool.handler({});

    assert.equal(result.content[0].type, "text");
    assert.equal(requests[0].method, "GET");
    assert.match(requests[0].url, /^\/public\/v2\/workspaces\/1\/tasks\?/);
    assert.match(requests[0].url, /status=INCOMPLETE/);
    assert.match(requests[0].url, /sort=dueDate/);
    assert.match(requests[0].url, /sortDir=ASC/);
    // Deliberately NO dueDateFrom default: silently starting at today hid
    // OVERDUE incomplete tasks — the ones "what's outstanding?" needs most.
    assert.doesNotMatch(requests[0].url, /dueDateFrom=/);
  });

  it("lets callers override list_upcoming_tasks defaults explicitly", async () => {
    const { TaskOperationsTools } = await import(
      "../dist/tools/v2/task-operations.tools.js"
    );
    const tool = TaskOperationsTools.find(
      (candidate) => candidate().name === "list_upcoming_tasks",
    )();

    await tool.handler({ status: "COMPLETED", sortDir: "DESC" });

    assert.match(requests[0].url, /status=COMPLETED/);
    assert.match(requests[0].url, /sortDir=DESC/);
    // Untouched defaults still apply.
    assert.match(requests[0].url, /sort=dueDate/);
    // No implicit dueDateFrom default — overdue tasks must stay visible.
    assert.doesNotMatch(requests[0].url, /dueDateFrom=/);
  });

  it("rejects document uploads that fail path, extension, or size validation", async () => {
    const { uploadUserDocument } = await import(
      "../dist/handlers/write-evidence.handler.js"
    );
    const { uploadVendorDocument } = await import(
      "../dist/handlers/write-vendors.handler.js"
    );

    const relative = await uploadUserDocument(1, "evidence.pdf", "MFA_EVIDENCE");
    assert.equal(relative.isError, true);
    assert.match(relative.error, /absolute path/);

    const traversal = await uploadUserDocument(
      1,
      "/tmp/../etc/secrets.pdf",
      "MFA_EVIDENCE",
    );
    assert.equal(traversal.isError, true);
    assert.match(traversal.error, /traversal/);

    const badExtension = await uploadVendorDocument(2, "/tmp/payload.exe");
    assert.equal(badExtension.isError, true);
    assert.match(badExtension.error, /unsupported file extension/i);

    // Nothing was sent upstream for any rejected upload.
    assert.equal(requests.length, 0);
  });

  it("normalizes device document list responses that use top-level documents", async () => {
    const { listEntityDocuments } = await import(
      "../dist/handlers/v2-write.handler.js"
    );

    const result = await listEntityDocuments("devices", 123);

    assert.equal(result.isError, false);
    assert.equal(requests[0].method, "GET");
    assert.equal(requests[0].url, "/public/v2/devices/123/documents");
    assert.deepEqual(result.result, {
      documents: [
        {
          id: 456,
          type: "PASSWORD_MANAGER_EVIDENCE",
          name: "Password Manager Evidence",
        },
      ],
      returned: 1,
      total: 1,
      pagination: { cursor: null },
    });
  });

  it("serializes audit request array filters using Drata's documented query keys", async () => {
    const { AuditRequestTools } = await import(
      "../dist/tools/v2/audit-request.tools.js"
    );
    const tool = AuditRequestTools.find(
      (candidate) => candidate().name === "list_audit_requests",
    )();

    const result = await tool.handler({
      auditId: "audit-123",
      statuses: ["OUTSTANDING", "IN_REVIEW"],
      userIds: [1, 2],
      sort: "createdAt",
      sortDir: "DESC",
    });

    assert.equal(result.content[0].type, "text");
    assert.equal(requests[0].method, "GET");
    assert.match(
      requests[0].url,
      /^\/public\/v2\/workspaces\/1\/audits\/audit-123\/requests\?/,
    );
    assert.match(requests[0].url, /status%5B%5D=OUTSTANDING/);
    assert.match(requests[0].url, /status%5B%5D=IN_REVIEW/);
    assert.match(requests[0].url, /userIds%5B%5D=1/);
    assert.match(requests[0].url, /userIds%5B%5D=2/);
    assert.match(requests[0].url, /sort=createdAt/);
    assert.match(requests[0].url, /sortDir=DESC/);
    assert.doesNotMatch(requests[0].url, /(^|[?&])status=/);
    assert.doesNotMatch(requests[0].url, /(^|[?&])userIds=/);
  });

  it("serializes list_users filters using documented firstName/lastName keys", async () => {
    const { OperationalCoverageTools } = await import(
      "../dist/tools/v2/operational-coverage.tools.js"
    );
    const tool = OperationalCoverageTools.find(
      (candidate) => candidate().name === "list_users",
    )();

    const result = await tool.handler({
      firstName: "Sally",
      lastName: "Smith",
      sort: "updatedAt",
      sortDir: "ASC",
    });

    assert.equal(result.content[0].type, "text");
    assert.equal(requests[0].method, "GET");
    assert.match(requests[0].url, /^\/public\/v2\/users\?/);
    assert.match(requests[0].url, /firstName=Sally/);
    assert.match(requests[0].url, /lastName=Smith/);
    assert.match(requests[0].url, /sort=updatedAt/);
    assert.match(requests[0].url, /sortDir=ASC/);
    assert.doesNotMatch(requests[0].url, /email=/);
    assert.doesNotMatch(requests[0].url, /status=/);
  });

  it("uses external evidence delete and download routes", async () => {
    const {
      deleteExternalEvidence,
      getExternalEvidenceDownloadUrl,
    } = await import("../dist/handlers/write-evidence.handler.js");

    const download = await getExternalEvidenceDownloadUrl(77);
    const deleted = await deleteExternalEvidence(77);

    assert.equal(download.isError, false);
    assert.equal(deleted.isError, false);
    assert.equal(requests[0].method, "GET");
    assert.equal(requests[0].url, "/public/external-evidence/77/download");
    assert.equal(requests[1].method, "DELETE");
    assert.equal(requests[1].url, "/public/external-evidence/77");
  });

  it("list_vendor_documents_v2 returns a clean missing-vendorId error", async () => {
    const { OperationalCoverageTools } = await import(
      "../dist/tools/v2/operational-coverage.tools.js"
    );
    const tool = OperationalCoverageTools.find(
      (candidate) => candidate().name === "list_vendor_documents_v2",
    )();

    const result = await tool.handler({});

    assert.match(result.content[0].text, /vendorId is required/);
    assert.equal(requests.length, 0);
  });
});
