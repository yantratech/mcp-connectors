import axios, { AxiosError } from "axios";
import dotenv from "dotenv";
import {
  IXeroClientConfig,
  Organisation,
  TokenSet,
  XeroClient,
} from "xero-node";

import {
  getClientCredentialsScopes,
  journalsEnabled,
  receiptsEnabled,
} from "../consts/xero-scopes.js";
import { ensureError } from "../helpers/ensure-error.js";

// OAuth 2.0 error codes are short lowercase tokens (RFC 6749 §5.2). Only a
// value of exactly this shape is ever surfaced, so nothing else from the
// identity response (which could echo credentials or tokens) can leak.
const OAUTH_ERROR_CODE = /^[a-z_]{1,64}$/;

/**
 * The end of the invalid_scope hint. The hint tells the user to grant only
 * the default scopes, none of which Xero withholds from new connections. For
 * each opt-in flag that is set it adds unsetting that flag instead, because
 * Custom Connections created on or after 29 April 2026 cannot be granted
 * accounting.transactions or accounting.journals.read.
 */
function optInScopeHint(): string {
  const hints: string[] = [];
  if (receiptsEnabled()) {
    hints.push(
      "unset XERO_ENABLE_RECEIPTS if this connection cannot be granted " +
        "accounting.transactions",
    );
  }
  if (journalsEnabled()) {
    hints.push(
      "unset XERO_ENABLE_JOURNALS if this connection cannot be granted " +
        "accounting.journals.read",
    );
  }
  if (hints.length === 0) return ".";
  return (
    `, or ${hints.join(", or ")} (connections created on or after ` +
    `29 April 2026 cannot be granted ${hints.length === 1 ? "it" : "either"}).`
  );
}

/**
 * Describes a failed client_credentials exchange for a model-visible error.
 * Surfaces the HTTP status and the OAuth `error` code only, never the body,
 * `error_description`, or the request.
 */
export function describeTokenError(error: AxiosError): string {
  const status = error.response?.status;
  if (status === undefined) {
    return "the Xero identity service could not be reached";
  }
  const data = error.response?.data as { error?: unknown } | undefined;
  const code =
    data && typeof data === "object" && typeof data.error === "string" &&
    OAUTH_ERROR_CODE.test(data.error)
      ? data.error
      : undefined;
  const prefix = code ? `HTTP ${status} ${code}` : `HTTP ${status}`;

  switch (code) {
    case "invalid_scope":
      return (
        `${prefix} - the Xero connection has not been granted every scope this ` +
        "server requests. Grant the default scopes listed in the README " +
        "(Custom Connections) at developer.xero.com" +
        optInScopeHint()
      );
    case "invalid_client":
    case "unauthorized_client":
      return `${prefix} - check XERO_CLIENT_ID/XERO_CLIENT_SECRET`;
    case undefined:
      return status === 401
        ? `${prefix} - check XERO_CLIENT_ID/XERO_CLIENT_SECRET`
        : prefix;
    default:
      return prefix;
  }
}

// quiet: dotenv >=17 logs an injection tip to STDOUT by default, which
// corrupts the MCP stdio protocol channel.
dotenv.config({ quiet: true });

const client_id = process.env.XERO_CLIENT_ID;
const client_secret = process.env.XERO_CLIENT_SECRET;
const bearer_token = process.env.XERO_CLIENT_BEARER_TOKEN;
const grant_type = "client_credentials";

// Xero's OAuth 2.0 token endpoint for the client_credentials grant.
export const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";

if (!bearer_token && (!client_id || !client_secret)) {
  throw Error("Environment Variables not set - please check your .env file");
}

abstract class MCPXeroClient extends XeroClient {
  public tenantId: string;
  private shortCode: string;

  protected constructor(config?: IXeroClientConfig) {
    super(config);
    this.tenantId = "";
    this.shortCode = "";
  }

  public abstract authenticate(): Promise<void>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches xero-node's own untyped signature, updateTenants(): Promise<any[]>
  override async updateTenants(fullOrgDetails?: boolean): Promise<any[]> {
    await super.updateTenants(fullOrgDetails);
    if (this.tenants && this.tenants.length > 0) {
      this.tenantId = this.tenants[0].tenantId;
    }
    return this.tenants;
  }

  private async getOrganisation(): Promise<Organisation> {
    await this.authenticate();

    const organisationResponse = await this.accountingApi.getOrganisations(
      this.tenantId || "",
    );

    const organisation = organisationResponse.body.organisations?.[0];

    if (!organisation) {
      throw new Error("Failed to retrieve organisation");
    }

    return organisation;
  }

  public async getShortCode(): Promise<string | undefined> {
    if (!this.shortCode) {
      try {
        const organisation = await this.getOrganisation();
        this.shortCode = organisation.shortCode ?? "";
      } catch (error: unknown) {
        const err = ensureError(error);

        throw new Error(
          `Failed to get Organisation short code: ${err.message}`,
          { cause: error },
        );
      }
    }
    return this.shortCode;
  }
}

export class CustomConnectionsXeroClient extends MCPXeroClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  /**
   * Token endpoint the client_credentials exchange posts to. Defaults to
   * Xero's identity service; overridable (constructor option, or assignment
   * on the instance) only so offline tests can point the real exchange code
   * at a loopback server. Deliberately NOT read from the environment: it
   * receives the client secret, so it must never be redirectable by config.
   */
  public tokenUrl: string;

  constructor(config: {
    clientId: string;
    clientSecret: string;
    grantType: string;
    tokenUrl?: string;
  }) {
    super(config);
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.tokenUrl = config.tokenUrl ?? XERO_TOKEN_URL;
  }

  public async getClientCredentialsToken(): Promise<TokenSet> {
    const scope = getClientCredentialsScopes().join(" ");
    const credentials = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString("base64");

    let response;
    try {
      response = await axios.post(
        this.tokenUrl,
        `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`,
        {
          headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
        },
      );
    } catch (error) {
      // eslint-disable-next-line preserve-caught-error -- deliberately NOT attached as `cause`: the caught axios error carries the identity-endpoint response body, which can echo credentials or tokens (see describeTokenError).
      throw new Error(
        `Failed to obtain Xero token: ${describeTokenError(error as AxiosError)}`,
      );
    }

    // Get the tenant ID from the connections endpoint
    const token = response.data.access_token;
    let connectionsResponse;
    try {
      connectionsResponse = await axios.get(
        "https://api.xero.com/connections",
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        },
      );
    } catch (error) {
      const status = (error as AxiosError).response?.status;
      // eslint-disable-next-line preserve-caught-error -- deliberately NOT attached as `cause`: the request config carries the bearer token.
      throw new Error(
        `Obtained a Xero token but could not list connected organisations: ${
          status !== undefined
            ? `HTTP ${status}`
            : "api.xero.com could not be reached"
        }`,
      );
    }

    if (connectionsResponse.data && connectionsResponse.data.length > 0) {
      this.tenantId = connectionsResponse.data[0].tenantId;
    }

    return response.data;
  }

  public async authenticate() {
    const tokenResponse = await this.getClientCredentialsToken();

    this.setTokenSet({
      access_token: tokenResponse.access_token,
      expires_in: tokenResponse.expires_in,
      token_type: tokenResponse.token_type,
    });
  }
}

class BearerTokenXeroClient extends MCPXeroClient {
  private readonly bearerToken: string;

  constructor(config: { bearerToken: string }) {
    super();
    this.bearerToken = config.bearerToken;
  }

  async authenticate(): Promise<void> {
    this.setTokenSet({
      access_token: this.bearerToken,
    });

    await this.updateTenants();
  }
}

export const xeroClient = bearer_token
  ? new BearerTokenXeroClient({
      bearerToken: bearer_token,
    })
  : new CustomConnectionsXeroClient({
      clientId: client_id!,
      clientSecret: client_secret!,
      grantType: grant_type,
    });
