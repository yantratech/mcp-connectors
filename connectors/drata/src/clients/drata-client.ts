/**
 * Drata REST API client.
 * Uses Node built-in fetch — no external HTTP libraries.
 */
import { AsyncLocalStorage } from "async_hooks";
import { appendFileSync, chmodSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";

// --- Entity types based on actual API responses ---

export interface Control {
  id: number;
  name: string;
  code: string;
  description: string;
  slug: string | null;
  archivedAt: string | null;
  topics: number[];
  workspaceId: number;
  isMonitored: boolean;
  hasEvidence: boolean;
  hasOwner: boolean;
  isReady: boolean;
  hasTicket: boolean;
  frameworkTags: string[];
}

export interface Monitor {
  id: number;
  name: string;
  description: string;
  checkResultStatus: string;
  lastCheck: string;
  checkStatus: string;
  disabledMessage: string | null;
  priority: string;
  monitorInstances: MonitorInstance[];
}

export interface MonitorInstance {
  id: number;
  checkResultStatus: string;
  checkFrequency: string;
  autopilotTaskType: string;
  failedTestDescription: string;
  evidenceCollectionDescription: string;
  monitorInstanceCheckTypes: { id: number; checkType: string }[];
}

export interface PersonnelUser {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string | null;
  drataTermsAgreedAt: string | null;
  backgroundChecks: unknown[];
  roles: string[] | null;
  documents: unknown[];
  [key: string]: unknown;
}

export interface Personnel {
  id: number;
  employmentStatus: string;
  user?: PersonnelUser | null;
  drataTermsAgreedAt: string | null;
  createdAt: string;
  updatedAt: string;
  entryId: string;
  identities: unknown[];
  backgroundChecks: unknown[];
  roles: string[];
  documents: unknown[];
  [key: string]: unknown;
}

/** Flattened personnel record for tool output. */
export interface FlatPersonnel {
  id: number;
  userId: number | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  jobTitle: string | null;
  employmentStatus: string;
  roles: string[];
  termsAgreed: boolean;
  backgroundChecks: unknown[];
  documents: unknown[];
}

export function flattenPersonnel(p: Personnel): FlatPersonnel {
  // V1 nests all user data (name, email, roles, backgroundChecks, documents,
  // drataTermsAgreedAt) under `p.user`. V2 /public/v2/personnel is a stub
  // with only id, employmentStatus, and userId — no user details at all.
  // We always use V1 data for personnel listings, so `p.user` is the
  // authoritative source.
  const u = p.user;
  return {
    id: p.id,
    userId: u?.id ?? null,
    firstName: u?.firstName ?? null,
    lastName: u?.lastName ?? null,
    email: u?.email ?? null,
    jobTitle: u?.jobTitle ?? null,
    employmentStatus: p.employmentStatus ?? "UNKNOWN",
    roles: u?.roles ?? p.roles ?? [],
    termsAgreed: !!(u?.drataTermsAgreedAt ?? p.drataTermsAgreedAt),
    backgroundChecks: u?.backgroundChecks ?? p.backgroundChecks ?? [],
    documents: u?.documents ?? p.documents ?? [],
  };
}

/**
 * Slim a flattened personnel record for list output. The nested
 * backgroundChecks[] and documents[] arrays carry a full history per person
 * and, on a large org, blow past the MCP output cap with no way for the caller
 * to trim them. By default we drop those arrays and replace each with a
 * `<name>Count` summary; a caller who genuinely needs the detail can opt the
 * full array back in by naming it in `fields` (e.g. fields: ["backgroundChecks"]),
 * mirroring the compact-by-default pattern used for devices.
 */
export function compactPersonnel(
  p: FlatPersonnel,
  fields?: string[],
): Record<string, unknown> {
  const wants = (key: string): boolean => !!fields && fields.includes(key);
  const { backgroundChecks, documents, ...rest } = p;
  const record: Record<string, unknown> = { ...rest };
  record.backgroundChecks = wants("backgroundChecks")
    ? backgroundChecks
    : undefined;
  record.documents = wants("documents") ? documents : undefined;
  // Always offer the cheap counts so a caller can see the magnitude without
  // pulling the heavy arrays.
  record.backgroundChecksCount = backgroundChecks.length;
  record.documentsCount = documents.length;
  if (!wants("backgroundChecks")) delete record.backgroundChecks;
  if (!wants("documents")) delete record.documents;
  return record;
}

export interface DrataEvent {
  id: string;
  type: string;
  category: string;
  source: string;
  description: string;
  metadata: Record<string, unknown>;
  status: string | null;
  createdAt: string;
  user: Personnel | null;
  connection: unknown | null;
  requestDescription: string | null;
}

export interface Vendor {
  id: number;
  name: string;
  [key: string]: unknown;
}

export interface VendorPayload {
  name: string;
  category: string;
  risk: string;
  critical: boolean;
  isSubProcessor: boolean;
  isSubProcessorActive: boolean;
  userId?: number;
  url?: string;
  privacyUrl?: string;
  termsUrl?: string;
  servicesProvided?: string;
  dataStored?: string;
  location?: string;
  hasPii?: boolean;
  passwordPolicy?: string;
  passwordRequiresMinLength?: boolean;
  passwordRequiresNumber?: boolean;
  passwordRequiresSymbol?: boolean;
  passwordMfaEnabled?: boolean;
  accountManagerName?: string;
  accountManagerEmail?: string;
  isComplianceReviewRequired?: boolean;
  passwordMinLength?: number;
  renewalDate?: string;
  renewalScheduleType?: string;
  notes?: string;
  confirmed?: boolean;
  impactLevel?: string;
}

export interface Policy {
  id: number;
  name: string;
  [key: string]: unknown;
}

export interface Asset {
  id: number;
  name: string;
  [key: string]: unknown;
}

export interface Device {
  id: number;
  [key: string]: unknown;
}

export interface Connection {
  id: number;
  [key: string]: unknown;
}

export interface ControlOwner {
  id: number;
  [key: string]: unknown;
}

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
}

export interface V2PaginatedResponse<T> {
  data: T[];
  pagination: { cursor: string | null };
}

export type DrataQueryParams = Record<
  string,
  string | string[] | number | boolean | undefined
>;

export interface ControlExternalEvidenceInput {
  workspaceId: number;
  controlId: number;
  filename: string;
  creationDate: string;
  renewalDate: string;
  renewalScheduleType: string;
  description?: string;
  url?: string;
  base64File?: string;
  file?: Uint8Array;
  fileName?: string;
}

export type DrataFormValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<string | number | boolean>;

export interface DrataFormFile {
  fieldName?: string;
  bytes: Uint8Array;
  fileName: string;
}

function buildQueryString(params?: DrataQueryParams): string {
  if (!params) return "";
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) usp.append(key, String(v));
    } else {
      usp.append(key, String(value));
    }
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Parse a numeric ID from an environment variable. Guards against the
 * silent-NaN trap: `Number("not-a-number")` is NaN, which would otherwise
 * be interpolated into query strings and request paths as the literal
 * string "NaN" and produce baffling upstream 404s.
 */
function parseIdFromEnv(envVar: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Environment variable ${envVar} must be a positive integer ID, got "${value}".`,
    );
  }
  return parsed;
}

function isMutation(method?: string): boolean {
  return method !== undefined && !["GET", "HEAD"].includes(method.toUpperCase());
}

function isDryRun(): boolean {
  const value = process.env.DRATA_MCP_DRY_RUN;
  return value === "1" || value?.toLowerCase() === "true";
}

// Every dry-run short-circuit result must carry this note next to
// dryRun: true so no caller (or model) can mistake the sentinel for a
// completed mutation.
const DRY_RUN_NOTE = "DRY RUN — no mutation was performed";

function parseBody(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

type AuditEntry = { method: string; path: string; request: unknown } & (
  | { dryRun: true }
  | { response: { status: number; body: unknown } }
);

function writeAuditLog(path: string, text: string): void {
  // The log records full mutation request/response bodies (vendor PII,
  // personnel data, security-review notes, evidence metadata, etc.) in
  // plaintext. Without an explicit mode the file lands at the process umask
  // (commonly world-readable 0644) — drop a long-lived record of sensitive GRC
  // data readable by any local user. Restrict the directory to 0700 and the
  // file to 0600 so only the owner can read it. Detect first-create so we
  // chmod the new file exactly once (appendFileSync alone cannot set a mode).
  const dir = dirname(path);
  const dirExisted = existsSync(dir);
  mkdirSync(dir, { recursive: true });
  if (!dirExisted) {
    try {
      chmodSync(dir, 0o700);
    } catch {
      // Best-effort: a pre-existing dir or a filesystem that rejects chmod
      // must not break auditing.
    }
  }
  const fileExisted = existsSync(path);
  appendFileSync(path, text);
  if (!fileExisted) {
    try {
      chmodSync(path, 0o600);
    } catch {
      // Best-effort, as above.
    }
  }
}

/**
 * Runs before every mutation, dry runs included. When DRATA_MCP_AUDIT_LOG is
 * set but cannot be written, fail here, before anything is sent to Drata,
 * rather than apply a change that cannot be logged.
 */
function assertAuditLogWritable(): void {
  const path = process.env.DRATA_MCP_AUDIT_LOG;
  if (!path) return;
  try {
    // Appending nothing creates the directory and file exactly as a real
    // entry would (same modes) and fails for the same reasons.
    writeAuditLog(path, "");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Audit log unavailable: DRATA_MCP_AUDIT_LOG is set to "${path}", but it cannot be written (${reason}). No change was sent to Drata. Fix the path or its permissions, or unset DRATA_MCP_AUDIT_LOG.`,
      { cause: err },
    );
  }
}

// Audit-log write failures raised during the tool call in progress. Keeping
// them per call means each warning reaches the result of the call that made
// the request, even when the server runs several calls concurrently.
const auditWarnings = new AsyncLocalStorage<string[]>();

/**
 * Run `fn` and return its result with the audit-log warnings raised while it
 * ran. CreateDrataTool runs every tool handler through this.
 */
export async function collectAuditWarnings<T>(
  fn: () => T | Promise<T>,
): Promise<{ result: T; warnings: string[] }> {
  const warnings: string[] = [];
  const result = await auditWarnings.run(warnings, fn);
  return { result, warnings };
}

function auditFailureWarning(entry: AuditEntry, reason: string): string {
  const request = `${entry.method} ${entry.path}`;
  const failure = `its audit log entry could not be written (${reason})`;
  if ("dryRun" in entry) {
    return `Audit log warning: dry run of ${request}; no change was sent to Drata, but ${failure}.`;
  }
  const { status } = entry.response;
  if (status >= 200 && status < 300) {
    return `Audit log warning: Drata applied ${request} (HTTP ${status}), but ${failure}. The change is in Drata; do not retry it.`;
  }
  return `Audit log warning: Drata rejected ${request} (HTTP ${status}), and ${failure}.`;
}

/**
 * Append one entry to DRATA_MCP_AUDIT_LOG. Never throws: by the time this
 * runs, Drata has applied or rejected the request (or, in a dry run, it was
 * never sent), and a failed write must not replace that outcome. The failure
 * goes to stderr and, as a warning, onto the tool call's result instead.
 */
function auditMutation(entry: AuditEntry): void {
  const path = process.env.DRATA_MCP_AUDIT_LOG;
  if (!path) return;
  try {
    writeAuditLog(
      path,
      `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`,
    );
  } catch (err) {
    const warning = auditFailureWarning(
      entry,
      err instanceof Error ? err.message : String(err),
    );
    console.error(`[drata-mcp] ${warning}`);
    auditWarnings.getStore()?.push(warning);
  }
}

/**
 * A non-2xx response from the Drata API. `status`, `path` and `body` are
 * typed fields so callers (the 429 retry, error mapping) branch on them
 * instead of parsing the message. The message keeps its historical
 * `<label> <status> on <path>: <body>` shape for logs and model-facing text.
 */
export class DrataApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
    public readonly body: string,
  ) {
    super(message);
    this.name = "DrataApiError";
  }
}

/** Drata's primary (NA) region. EU/APAC tenants must set DRATA_BASE_URL. */
const DEFAULT_BASE_URL = "https://public-api.drata.com";

let baseUrlLogged = false;

class DrataClientInstance {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    const apiKey = process.env.DRATA_API_KEY;
    const baseUrl = process.env.DRATA_BASE_URL || DEFAULT_BASE_URL;

    if (!apiKey) {
      throw new Error("DRATA_API_KEY environment variable is required");
    }

    // One-time startup notice on stderr (stdout is reserved for MCP stdio).
    if (!baseUrlLogged) {
      baseUrlLogged = true;
      console.error(
        `[drata-mcp] Drata API base URL: ${baseUrl} (set DRATA_BASE_URL to override, e.g. https://public-api.eu.drata.com for EU tenants)`,
      );
    }

    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const method = String(options.method ?? "GET").toUpperCase();
    const mutation = isMutation(method);
    const requestBody = typeof options.body === "string" ? parseBody(options.body) : undefined;
    if (mutation) assertAuditLogWritable();
    if (mutation && isDryRun()) {
      const result = { dryRun: true, note: DRY_RUN_NOTE, method, path, body: requestBody };
      auditMutation({ dryRun: true, method, path, request: { body: requestBody } });
      return result as T;
    }
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        // Several V2 routes (e.g. policy-version metadata) content-negotiate on
        // the SAME path that also serves HTML; Node fetch's default Accept of
        // `*/*` gets a 406. Ask for JSON explicitly. Overridable via options.
        Accept: "application/json",
        ...options.headers,
      },
    });
    const text = await response.text();

    if (!response.ok) {
      if (mutation) {
        auditMutation({
          method,
          path,
          request: { body: requestBody },
          response: { status: response.status, body: parseBody(text) },
        });
      }
      throw new DrataApiError(
        `Drata API error ${response.status} on ${path}: ${text}`,
        response.status,
        path,
        text,
      );
    }

    const parsed = parseBody(text) as T;
    if (mutation) {
      auditMutation({
        method,
        path,
        request: { body: requestBody },
        response: { status: response.status, body: parsed },
      });
    }
    return parsed;
  }

  private async fetchAll<T>(
    path: string,
    params: Record<string, string> = {},
  ): Promise<T[]> {
    const all: T[] = [];
    let page = 1;
    const limit = 50;

    while (true) {
      const query = new URLSearchParams({
        ...params,
        page: String(page),
        limit: String(limit),
      });
      const result = await this.request<PaginatedResponse<T>>(
        `${path}?${query}`,
      );
      all.push(...result.data);
      if (all.length >= result.total || result.data.length === 0) break;
      page++;
    }

    return all;
  }

  /**
   * Fetch a single V1 (offset-paginated) page of `path`. Use when callers
   * need explicit control over `page` / `limit` instead of auto-merging.
   */
  async getV1Page<T>(
    path: string,
    params?: DrataQueryParams,
  ): Promise<PaginatedResponse<T>> {
    return this.request<PaginatedResponse<T>>(
      `${path}${buildQueryString(params)}`,
    );
  }

  async getJson<T>(
    path: string,
    params?: DrataQueryParams,
  ): Promise<T> {
    return this.request<T>(`${path}${buildQueryString(params)}`);
  }

  async postJson<T>(
    path: string,
    body: unknown,
  ): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async putJson<T>(
    path: string,
    body: unknown,
  ): Promise<T> {
    return this.request<T>(path, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  // Returns the response body when there is one — in DRATA_MCP_DRY_RUN mode
  // that is the {dryRun: true, note, ...} sentinel, which delete handlers must
  // pass through instead of fabricating a success payload.
  async deleteJson(path: string): Promise<unknown> {
    return this.request<unknown>(path, { method: "DELETE" });
  }

  // === Controls ===
  async getControls(
    params: Record<string, string> = {},
  ): Promise<Control[]> {
    return this.fetchAll<Control>("/public/controls", params);
  }

  async getControlOwners(controlId: number): Promise<ControlOwner[]> {
    const result = await this.request<{ data: ControlOwner[] }>(
      `/public/controls/${controlId}/owners`,
    );
    return result.data;
  }

  // === Monitors ===
  async getMonitors(
    params: Record<string, string> = {},
  ): Promise<Monitor[]> {
    return this.fetchAll<Monitor>("/public/monitors", params);
  }

  // === Personnel ===
  async getPersonnel(
    params: Record<string, string> = {},
  ): Promise<Personnel[]> {
    return this.fetchAll<Personnel>("/public/personnel", params);
  }

  async getUser(userId: number): Promise<Personnel> {
    return this.request<Personnel>(`/public/users/${userId}`);
  }

  // === Events ===
  async getRecentEvents(limit: number = 50): Promise<DrataEvent[]> {
    const result = await this.request<PaginatedResponse<DrataEvent>>(
      `/public/events?limit=${limit}&sort=CREATED&sortDir=DESC`,
    );
    return result.data;
  }

  // === Vendors ===
  async getVendors(
    params: Record<string, string> = {},
  ): Promise<Vendor[]> {
    return this.fetchAll<Vendor>("/public/vendors", params);
  }

  async createVendor(payload: VendorPayload): Promise<Vendor> {
    return this.request<Vendor>("/public/vendors", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async updateVendor(
    vendorId: number,
    payload: Partial<VendorPayload>,
  ): Promise<Vendor> {
    return this.request<Vendor>(`/public/vendors/${vendorId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  // === Policies ===
  async getPolicies(
    params: Record<string, string> = {},
  ): Promise<Policy[]> {
    return this.fetchAll<Policy>("/public/policies", params);
  }

  // === Assets ===
  async getAssets(
    params: Record<string, string> = {},
  ): Promise<Asset[]> {
    return this.fetchAll<Asset>("/public/assets", params);
  }

  async createAsset(body: Record<string, unknown>): Promise<Asset> {
    return this.request<Asset>("/public/assets", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // === External Evidence ===
  async getExternalEvidence(controlId: number): Promise<unknown[]> {
    return this.fetchAll<unknown>(
      `/public/controls/${controlId}/external-evidence`,
    );
  }

  // === Devices ===
  async getDevices(
    params: Record<string, string> = {},
  ): Promise<Device[]> {
    return this.fetchAll<Device>("/public/devices", params);
  }

  // === Connections ===
  async getConnections(
    params: Record<string, string> = {},
  ): Promise<Connection[]> {
    return this.fetchAll<Connection>("/public/connections", params);
  }

  // === Evidence Upload ===
  async uploadUserDocument(
    userId: number,
    file: Uint8Array,
    fileName: string,
    type: string,
  ): Promise<unknown> {
    const formData = new FormData();
    formData.append("type", type);
    formData.append("file", new Blob([file] as BlobPart[]), fileName);

    const url = `${this.baseUrl}/public/users/${userId}/documents`;
    const auditRequest = {
      fields: { type },
      file: { fieldName: "file", fileName, bytes: file.byteLength },
    };
    assertAuditLogWritable();
    if (isDryRun()) {
      const result = {
        dryRun: true,
        note: DRY_RUN_NOTE,
        method: "POST",
        path: `/public/users/${userId}/documents`,
        ...auditRequest,
      };
      auditMutation({
        dryRun: true,
        method: "POST",
        path: `/public/users/${userId}/documents`,
        request: auditRequest,
      });
      return result;
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: formData,
    });
    const text = await response.text();

    if (!response.ok) {
      auditMutation({
        method: "POST",
        path: `/public/users/${userId}/documents`,
        request: auditRequest,
        response: { status: response.status, body: parseBody(text) },
      });
      throw new DrataApiError(
        `Evidence upload error ${response.status}: ${text}`,
        response.status,
        `/public/users/${userId}/documents`,
        text,
      );
    }

    const parsed = parseBody(text);
    auditMutation({
      method: "POST",
      path: `/public/users/${userId}/documents`,
      request: auditRequest,
      response: { status: response.status, body: parsed },
    });
    return parsed;
  }

  async uploadVendorDocument(
    vendorId: number,
    file: Uint8Array,
    fileName: string,
  ): Promise<unknown> {
    const formData = new FormData();
    formData.append("file", new Blob([file] as BlobPart[]), fileName);

    const url = `${this.baseUrl}/public/vendors/${vendorId}/documents`;
    const auditRequest = {
      file: { fieldName: "file", fileName, bytes: file.byteLength },
    };
    assertAuditLogWritable();
    if (isDryRun()) {
      const result = {
        dryRun: true,
        note: DRY_RUN_NOTE,
        method: "POST",
        path: `/public/vendors/${vendorId}/documents`,
        ...auditRequest,
      };
      auditMutation({
        dryRun: true,
        method: "POST",
        path: `/public/vendors/${vendorId}/documents`,
        request: auditRequest,
      });
      return result;
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: formData,
    });
    const text = await response.text();

    if (!response.ok) {
      auditMutation({
        method: "POST",
        path: `/public/vendors/${vendorId}/documents`,
        request: auditRequest,
        response: { status: response.status, body: parseBody(text) },
      });
      throw new DrataApiError(
        `Vendor document upload error ${response.status}: ${text}`,
        response.status,
        `/public/vendors/${vendorId}/documents`,
        text,
      );
    }

    const parsed = parseBody(text);
    auditMutation({
      method: "POST",
      path: `/public/vendors/${vendorId}/documents`,
      request: auditRequest,
      response: { status: response.status, body: parsed },
    });
    return parsed;
  }

  async uploadControlEvidence(
    controlId: number,
    file: Uint8Array,
    fileName: string,
  ): Promise<unknown> {
    const formData = new FormData();
    formData.append("file", new Blob([file] as BlobPart[]), fileName);

    const url = `${this.baseUrl}/public/controls/${controlId}/external-evidence`;
    const auditRequest = {
      file: { fieldName: "file", fileName, bytes: file.byteLength },
    };
    assertAuditLogWritable();
    if (isDryRun()) {
      const result = {
        dryRun: true,
        note: DRY_RUN_NOTE,
        method: "POST",
        path: `/public/controls/${controlId}/external-evidence`,
        ...auditRequest,
      };
      auditMutation({
        dryRun: true,
        method: "POST",
        path: `/public/controls/${controlId}/external-evidence`,
        request: auditRequest,
      });
      return result;
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: formData,
    });
    const text = await response.text();

    if (!response.ok) {
      auditMutation({
        method: "POST",
        path: `/public/controls/${controlId}/external-evidence`,
        request: auditRequest,
        response: { status: response.status, body: parseBody(text) },
      });
      throw new DrataApiError(
        `Control evidence upload error ${response.status}: ${text}`,
        response.status,
        `/public/controls/${controlId}/external-evidence`,
        text,
      );
    }

    const parsed = parseBody(text);
    auditMutation({
      method: "POST",
      path: `/public/controls/${controlId}/external-evidence`,
      request: auditRequest,
      response: { status: response.status, body: parsed },
    });
    return parsed;
  }

  async createControlExternalEvidence(
    input: ControlExternalEvidenceInput,
  ): Promise<unknown> {
    return this.submitForm(
      `/public/workspaces/${input.workspaceId}/controls/${input.controlId}/external-evidence`,
      "POST",
      {
        filename: input.filename,
        creationDate: input.creationDate,
        renewalDate: input.renewalDate,
        renewalScheduleType: input.renewalScheduleType,
        description: input.description,
        url: input.url,
        base64File: input.base64File,
      },
      input.file && input.fileName
        ? { bytes: input.file, fileName: input.fileName }
        : undefined,
      "Control external evidence create error",
    );
  }

  // =================================================================
  // V2 API helpers
  // =================================================================

  private async requestV2<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const method = String(options.method ?? "GET").toUpperCase();
    const mutation = isMutation(method);
    const requestBody = typeof options.body === "string" ? parseBody(options.body) : undefined;
    if (mutation) assertAuditLogWritable();
    if (mutation && isDryRun()) {
      const result = { dryRun: true, note: DRY_RUN_NOTE, method, path, body: requestBody };
      auditMutation({ dryRun: true, method, path, request: { body: requestBody } });
      return result as T;
    }
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        // Several V2 routes (e.g. policy-version metadata) content-negotiate on
        // the SAME path that also serves HTML; Node fetch's default Accept of
        // `*/*` gets a 406. Ask for JSON explicitly. Overridable via options.
        Accept: "application/json",
        ...options.headers,
      },
    });
    const text = await response.text();

    if (!response.ok) {
      if (mutation) {
        auditMutation({
          method,
          path,
          request: { body: requestBody },
          response: { status: response.status, body: parseBody(text) },
        });
      }
      throw new DrataApiError(
        `Drata V2 API error ${response.status} on ${path}: ${text}`,
        response.status,
        path,
        text,
      );
    }

    // Some endpoints (DELETE) may return 204 with no body
    const parsed = parseBody(text) as T;
    if (mutation) {
      auditMutation({
        method,
        path,
        request: { body: requestBody },
        response: { status: response.status, body: parsed },
      });
    }
    return parsed;
  }

  async getV2<T>(
    path: string,
    params?: DrataQueryParams,
  ): Promise<T> {
    return this.requestV2<T>(`${path}${buildQueryString(params)}`);
  }

  /**
   * GET a V2 endpoint with `Accept: text/html` and return the raw body.
   * Used for endpoints like policy version content that return HTML.
   */
  async getV2Text(
    path: string,
    params?: DrataQueryParams,
    accept: string = "text/html",
  ): Promise<string> {
    const url = `${this.baseUrl}${path}${buildQueryString(params)}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: accept,
      },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new DrataApiError(
        `Drata V2 API error ${response.status} on ${path}: ${body}`,
        response.status,
        path,
        body,
      );
    }
    return response.text();
  }

  async postV2<T>(
    path: string,
    body: unknown,
  ): Promise<T> {
    return this.requestV2<T>(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async putV2<T>(
    path: string,
    body: unknown,
  ): Promise<T> {
    return this.requestV2<T>(path, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  // Returns the response body when there is one — in DRATA_MCP_DRY_RUN mode
  // that is the {dryRun: true, note, ...} sentinel, which delete handlers must
  // pass through instead of fabricating a success payload.
  async deleteV2(path: string): Promise<unknown> {
    return this.requestV2<unknown>(path, { method: "DELETE" });
  }

  async submitForm(
    path: string,
    method: "POST" | "PUT",
    fields: Record<string, DrataFormValue>,
    file?: DrataFormFile,
    errorLabel: string = "Drata form request error",
  ): Promise<unknown> {
    const formData = new FormData();
    const scalarFields: Record<string, DrataFormValue> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null) continue;
      scalarFields[key] = value;
      if (Array.isArray(value)) {
        for (const item of value) formData.append(key, String(item));
      } else {
        formData.append(key, String(value));
      }
    }
    if (file) {
      formData.append(
        file.fieldName ?? "file",
        new Blob([file.bytes] as BlobPart[]),
        file.fileName,
      );
    }
    const auditRequest = {
      fields: scalarFields,
      file: file
        ? {
            fieldName: file.fieldName ?? "file",
            fileName: file.fileName,
            bytes: file.bytes.byteLength,
          }
        : undefined,
    };
    assertAuditLogWritable();
    if (isDryRun()) {
      const result = { dryRun: true, note: DRY_RUN_NOTE, method, path, ...auditRequest };
      auditMutation({ dryRun: true, method, path, request: auditRequest });
      return result;
    }

    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: formData,
    });
    const text = await response.text();

    if (!response.ok) {
      auditMutation({
        method,
        path,
        request: auditRequest,
        response: { status: response.status, body: parseBody(text) },
      });
      // Include `on ${path}` so error-mapping can attribute plan-gated (402)
      // features — matching the requestV2 message convention.
      throw new DrataApiError(
        `${errorLabel} ${response.status} on ${path}: ${text}`,
        response.status,
        path,
        text,
      );
    }

    const parsed = parseBody(text);
    auditMutation({
      method,
      path,
      request: auditRequest,
      response: { status: response.status, body: parsed },
    });
    return parsed;
  }

  async uploadFileV2(
    path: string,
    file: Uint8Array,
    fileName: string,
    extraFields?: Record<string, string>,
  ): Promise<unknown> {
    const formData = new FormData();
    const scalarFields: Record<string, string> = {};
    if (extraFields) {
      for (const [k, v] of Object.entries(extraFields)) {
        scalarFields[k] = v;
        formData.append(k, v);
      }
    }
    formData.append("file", new Blob([file] as BlobPart[]), fileName);
    const auditRequest = {
      fields: scalarFields,
      file: { fieldName: "file", fileName, bytes: file.byteLength },
    };
    assertAuditLogWritable();
    if (isDryRun()) {
      const result = { dryRun: true, note: DRY_RUN_NOTE, method: "POST", path, ...auditRequest };
      auditMutation({ dryRun: true, method: "POST", path, request: auditRequest });
      return result;
    }

    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: formData,
    });
    const text = await response.text();

    if (!response.ok) {
      auditMutation({
        method: "POST",
        path,
        request: auditRequest,
        response: { status: response.status, body: parseBody(text) },
      });
      throw new DrataApiError(
        `Drata V2 file upload error ${response.status} on ${path}: ${text}`,
        response.status,
        path,
        text,
      );
    }

    const parsed = parseBody(text);
    auditMutation({
      method: "POST",
      path,
      request: auditRequest,
      response: { status: response.status, body: parsed },
    });
    return parsed;
  }

  async fetchAllV2<T>(
    path: string,
    params?: DrataQueryParams,
  ): Promise<T[]> {
    const all: T[] = [];
    let cursor: string | null = null;

    while (true) {
      const query: DrataQueryParams = { ...params };
      if (cursor) query.cursor = cursor;

      const result = await this.getV2<V2PaginatedResponse<T>>(path, query);
      all.push(...result.data);

      const next = result.pagination?.cursor;
      // Stop on end-of-stream, empty page, or non-advancing cursor (server bug).
      if (!next || result.data.length === 0 || next === cursor) break;
      cursor = next;
    }

    return all;
  }

  // === V2 workspace resolver ===
  /**
   * Resolve a workspace ID with a fallback to fetching the first available
   * workspace from /public/v2/workspaces. Use for tools that should "just
   * work" when neither a param nor DRATA_WORKSPACE_ID is provided.
   */
  async resolveOrFetchWorkspaceId(paramValue?: number): Promise<number> {
    if (paramValue !== undefined) return paramValue;
    const envVal = process.env.DRATA_WORKSPACE_ID;
    if (envVal) return parseIdFromEnv("DRATA_WORKSPACE_ID", envVal);
    const result = await this.getV2<V2PaginatedResponse<{ id: number }>>(
      "/public/v2/workspaces",
    );
    const first = result.data?.[0];
    if (!first || typeof first.id !== "number") {
      throw new Error(
        "Workspace ID is required. No workspaces returned from /public/v2/workspaces. Provide it as a parameter or set the DRATA_WORKSPACE_ID environment variable.",
      );
    }
    return first.id;
  }

  // The only enumerator of risk registers (GET /risk-registers) is gated behind
  // Risk Management Pro and 402s on base-tier accounts, while the per-register
  // risk endpoints work fine once the id is known. To break that discovery
  // deadlock without Pro we (1) honour DRATA_RISK_REGISTER_ID and (2) cache any
  // register id that flows through a successful base-tier call, so a single
  // explicit id seeds the default for every later param-less call.
  private lastSeenRiskRegisterId: number | undefined;

  /** Cache a risk register id observed in a request param or response body. */
  rememberRiskRegisterId(id: number | undefined): void {
    if (typeof id === "number" && Number.isFinite(id)) {
      this.lastSeenRiskRegisterId = id;
    }
  }

  resolveRiskRegisterId(paramValue?: number): number {
    if (paramValue !== undefined) {
      this.rememberRiskRegisterId(paramValue);
      return paramValue;
    }
    const envVal = process.env.DRATA_RISK_REGISTER_ID;
    if (envVal) return parseIdFromEnv("DRATA_RISK_REGISTER_ID", envVal);
    if (this.lastSeenRiskRegisterId !== undefined) {
      return this.lastSeenRiskRegisterId;
    }
    throw new Error(
      "Risk Register ID is required. Try list_risk_registers first to " +
        "enumerate registers (it may be plan-gated on some accounts; if it " +
        "402s, that gates only the enumerator — base-tier risk reads still " +
        "work). Otherwise pass riskRegisterId explicitly (commonly 1) or set " +
        "the DRATA_RISK_REGISTER_ID environment variable; once seen, the id " +
        "is cached for later calls.",
    );
  }

  /**
   * Issue a lightweight GET and return only the HTTP status (or null on a
   * network error / timeout). Used for startup entitlement probing; never
   * throws so a failed probe can fail open.
   */
  async probeHttpStatus(
    path: string,
    timeoutMs: number = 5000,
  ): Promise<number | null> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      // Drain the body so the socket is released promptly.
      await response.text().catch(() => undefined);
      return response.status;
    } catch {
      return null;
    }
  }

  // === V2 vendor getter (for fetch-before-update) ===
  async getVendor(vendorId: number): Promise<Vendor> {
    return this.request<Vendor>(`/public/vendors/${vendorId}`);
  }
}

// Singleton
let instance: DrataClientInstance | null = null;

export function getDrataClient(): DrataClientInstance {
  if (!instance) {
    instance = new DrataClientInstance();
  }
  return instance;
}
