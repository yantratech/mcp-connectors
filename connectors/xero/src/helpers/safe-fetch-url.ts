import dns from "dns";
import http from "http";
import https from "https";
import net from "net";

/**
 * SSRF-hardened fetch for caller-supplied URLs (e.g. upload_attachment's
 * fileUrl). The MCP server fetches the bytes from its own network position,
 * so an unvalidated URL turns it into a confused deputy: a model influenced
 * by prompt injection could point it at cloud-metadata (169.254.169.254),
 * loopback, or other internal services and then read the response back via
 * whatever the bytes are uploaded into.
 *
 * Defences applied here:
 *  - only http/https schemes are allowed;
 *  - the host is DNS-resolved and every resolved address must be a public
 *    unicast address (private/loopback/link-local/ULA/etc. are rejected).
 *    IPv6 addresses are parsed to 16 bytes, so IPv4 addresses embedded in
 *    IPv6 (IPv4-mapped/-compatible/-translated, NAT64 64:ff9b::/96, 6to4
 *    2002::/16) are checked against the IPv4 rules whatever textual form
 *    they arrive in (`::ffff:127.0.0.1` and `::ffff:7f00:1` alike);
 *  - the connection is pinned to the validated address (custom `lookup` on
 *    http(s).request), so DNS cannot be re-resolved to a different,
 *    internal address between validation and connect (DNS rebinding);
 *  - redirects are handled manually so each hop is re-validated;
 *  - the downloaded body is capped to MAX_RESPONSE_BYTES, both via the
 *    declared Content-Length and while streaming.
 */

// Xero caps attachments at ~25 MB; bound memory and the SSRF read-back channel.
export const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;
export const MAX_REDIRECTS = 5;
const IDLE_TIMEOUT_MS = 30_000;
// Overall deadline per hop, so a slow-drip server cannot hold a call open.
const TOTAL_TIMEOUT_MS = 120_000;

const BLOCKED_MESSAGE =
  "fileUrl host resolves to a private, loopback, or link-local address, which is not allowed.";

/** A validated destination: the URL plus the exact address to connect to. */
export interface SafeTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

export type LookupAll = (hostname: string) => Promise<dns.LookupAddress[]>;

/** Minimal response shape the fetch loop needs from a transport. */
export interface TransportResponse {
  status: number;
  statusText: string;
  header(name: string): string | undefined;
  body: AsyncIterable<Uint8Array>;
  /** Abort the response and release the socket. */
  destroy(): void;
}

/**
 * Performs one GET to `target.url`, connecting ONLY to `target.address`.
 * Injectable for tests; the default is pinnedHttpTransport.
 */
export type Transport = (target: SafeTarget) => Promise<TransportResponse>;

export interface SafeFetchDeps {
  lookup?: LookupAll;
  transport?: Transport;
}

const systemLookup: LookupAll = (hostname) =>
  new Promise<dns.LookupAddress[]>((resolve, reject) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  });

/**
 * Returns true if the address is NOT safe to connect to (private, loopback,
 * link-local, unique-local, unspecified, multicast, reserved, etc.).
 */
export function isBlockedAddress(address: string): boolean {
  const type = net.isIP(address);
  if (type === 4) return isBlockedIPv4Bytes(parseIPv4(address));
  if (type === 6) return isBlockedIPv6(address);
  // Not a parseable IP literal — treat as blocked (we only call this on
  // resolved addresses, which are always literals).
  return true;
}

function parseIPv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (bytes.some((b) => Number.isNaN(b) || b > 255)) return null;
  return bytes;
}

function isBlockedIPv4Bytes(bytes: readonly number[] | null): boolean {
  if (!bytes || bytes.length !== 4) return true;
  const [a, b, c] = bytes;
  // 0.0.0.0/8 "this network" / unspecified
  if (a === 0) return true;
  // 10.0.0.0/8 private
  if (a === 10) return true;
  // 127.0.0.0/8 loopback
  if (a === 127) return true;
  // 169.254.0.0/16 link-local (incl. cloud metadata 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 private
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 private
  if (a === 192 && b === 168) return true;
  // 100.64.0.0/10 carrier-grade NAT
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 0 && c === 0) return true;
  // 198.18.0.0/15 benchmarking
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 224.0.0.0/4 multicast and 240.0.0.0/4 reserved / 255.255.255.255 broadcast
  if (a >= 224) return true;
  return false;
}

/**
 * Parses any textual IPv6 form (compressed, expanded, with an embedded
 * dotted IPv4 tail, with a zone id) into 16 bytes. Returns null if the
 * string is not a valid IPv6 address.
 */
export function parseIPv6(address: string): number[] | null {
  let addr = address.toLowerCase();
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone);
  if (net.isIPv6(addr) === false) return null;

  // Convert a trailing dotted IPv4 into two hex groups.
  const lastColon = addr.lastIndexOf(":");
  const tail = addr.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIPv4(tail);
    if (!v4) return null;
    addr =
      addr.slice(0, lastColon + 1) +
      ((v4[0] << 8) | v4[1]).toString(16) +
      ":" +
      ((v4[2] << 8) | v4[3]).toString(16);
  }

  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const v = parseInt(g, 16);
    bytes.push(v >> 8, v & 0xff);
  }
  return bytes;
}

function allZero(bytes: readonly number[], from: number, to: number): boolean {
  for (let i = from; i < to; i++) if (bytes[i] !== 0) return false;
  return true;
}

function isBlockedIPv6(address: string): boolean {
  const b = parseIPv6(address);
  if (!b) return true;

  // ::/96 — unspecified (::), loopback (::1) and deprecated IPv4-compatible
  // (::a.b.c.d). The embedded IPv4 check blocks :: and ::1 too (0.0.0.0/8).
  if (allZero(b, 0, 12)) return isBlockedIPv4Bytes(b.slice(12));
  // ::ffff:0:0/96 — IPv4-mapped (any textual form, e.g. ::ffff:7f00:1).
  if (allZero(b, 0, 10) && b[10] === 0xff && b[11] === 0xff) {
    return isBlockedIPv4Bytes(b.slice(12));
  }
  // ::ffff:0:0:0/96 — IPv4-translated (RFC 2765).
  if (allZero(b, 0, 8) && b[8] === 0xff && b[9] === 0xff && b[10] === 0 && b[11] === 0) {
    return isBlockedIPv4Bytes(b.slice(12));
  }
  // 64:ff9b::/96 — NAT64 well-known prefix; the gateway connects to the
  // embedded IPv4, so apply the IPv4 rules to it.
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && allZero(b, 4, 12)) {
    return isBlockedIPv4Bytes(b.slice(12));
  }
  // Rest of 64:ff9b::/32, including the NAT64 local-use prefix
  // 64:ff9b:1::/48 (RFC 8215): block outright.
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return true;
  // 2002::/16 — 6to4; the IPv4 relay target is bytes 2..5.
  if (b[0] === 0x20 && b[1] === 0x02) return isBlockedIPv4Bytes(b.slice(2, 6));
  // 2001:0::/32 — Teredo; the client IPv4 is obfuscated, block outright.
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return true;
  // 100::/64 — discard-only.
  if (b[0] === 0x01 && b[1] === 0x00 && allZero(b, 2, 8)) return true;
  // fc00::/7 unique-local
  if ((b[0] & 0xfe) === 0xfc) return true;
  // fe80::/10 link-local and fec0::/10 deprecated site-local
  if (b[0] === 0xfe && (b[1] & 0x80) === 0x80) return true;
  // ff00::/8 multicast
  if (b[0] === 0xff) return true;
  return false;
}

/**
 * Parses and validates a caller-supplied URL, resolves its host once and
 * asserts that every resolved address is a public unicast address. Returns
 * the URL together with the address the connection must be pinned to.
 * Throws on any violation.
 */
export async function resolveSafeTarget(
  rawUrl: string,
  lookup: LookupAll = systemLookup,
): Promise<SafeTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("fileUrl is not a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `fileUrl must use http or https (got '${url.protocol.replace(/:$/, "")}').`,
    );
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets

  // If the host is already an IP literal, validate it directly. The WHATWG
  // parser has already canonicalised it (e.g. decimal/hex IPv4 forms become
  // dotted quads, ::ffff:127.0.0.1 becomes ::ffff:7f00:1).
  const literalType = net.isIP(hostname);
  if (literalType) {
    if (isBlockedAddress(hostname)) throw new Error(BLOCKED_MESSAGE);
    return { url, address: hostname, family: literalType as 4 | 6 };
  }

  let addresses: dns.LookupAddress[];
  try {
    addresses = await lookup(hostname);
  } catch {
    throw new Error(`fileUrl host could not be resolved: ${hostname}`);
  }
  if (!addresses || addresses.length === 0) {
    throw new Error(`fileUrl host could not be resolved: ${hostname}`);
  }
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) throw new Error(BLOCKED_MESSAGE);
  }
  const [first] = addresses;
  return {
    url,
    address: first.address,
    family: net.isIP(first.address) === 6 ? 6 : 4,
  };
}

/**
 * Parses and validates a caller-supplied URL, then asserts that every address
 * its host resolves to is a public unicast address. Throws on any violation.
 */
export async function assertSafeUrl(
  rawUrl: string,
  lookup?: LookupAll,
): Promise<URL> {
  return (await resolveSafeTarget(rawUrl, lookup)).url;
}

/**
 * A dns.lookup replacement that always answers with the pre-validated
 * address, whatever hostname it is asked about. Handles both the
 * single-address and `all: true` callback forms (Node's happy-eyeballs
 * connect path asks for `all`).
 */
export function createPinnedLookup(address: string, family: 4 | 6) {
  return (
    _hostname: string,
    options: dns.LookupOptions | number | undefined,
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string | dns.LookupAddress[],
      family?: number,
    ) => void,
  ): void => {
    const all = typeof options === "object" && options !== null && options.all;
    if (all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

/**
 * Default transport: a single GET over http(s).request whose socket is
 * pinned to the validated address. TLS still verifies the certificate
 * against the URL's hostname (SNI and checkServerIdentity use the hostname,
 * not the pinned address).
 */
export const pinnedHttpTransport: Transport = (target) =>
  new Promise<TransportResponse>((resolve, reject) => {
    const mod = target.url.protocol === "https:" ? https : http;
    const req = mod.request(target.url, {
      method: "GET",
      lookup: createPinnedLookup(target.address, target.family) as never,
      // Ask for identity encoding: we read raw bytes and enforce the cap on
      // what we receive, so no decompression step can inflate it.
      headers: { "accept-encoding": "identity", accept: "*/*" },
      // Never let a proxy agent re-resolve the host.
      agent: false,
    });
    req.setTimeout(IDLE_TIMEOUT_MS, () => {
      req.destroy(new Error("fileUrl request timed out."));
    });
    const deadline = setTimeout(() => {
      req.destroy(new Error("fileUrl request timed out."));
    }, TOTAL_TIMEOUT_MS);
    deadline.unref();
    req.on("close", () => clearTimeout(deadline));
    req.on("error", reject);
    req.on("response", (res) => {
      res.on("close", () => clearTimeout(deadline));
      resolve({
        status: res.statusCode ?? 0,
        statusText: res.statusMessage ?? "",
        header: (name) => {
          const v = res.headers[name.toLowerCase()];
          return Array.isArray(v) ? v[0] : v;
        },
        body: res,
        destroy: () => res.destroy(),
      });
    });
    req.end();
  });

function oversize(): Error {
  return new Error(`File at fileUrl exceeds the ${MAX_RESPONSE_BYTES}-byte limit.`);
}

/**
 * Fetches a caller-supplied URL with SSRF protection: scheme/host validation,
 * address pinning, manual per-hop redirect re-validation, and a hard
 * response-size cap.
 */
export async function safeFetchUrl(
  rawUrl: string,
  deps: SafeFetchDeps = {},
): Promise<Buffer> {
  const lookup = deps.lookup ?? systemLookup;
  const transport = deps.transport ?? pinnedHttpTransport;
  let currentUrl = rawUrl;

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const target = await resolveSafeTarget(currentUrl, lookup);
    const response = await transport(target);

    // Manually follow redirects so each hop is re-validated against the
    // SSRF rules (an open redirect on an allowed host could otherwise point
    // at an internal target).
    if (response.status >= 300 && response.status < 400) {
      const location = response.header("location");
      response.destroy();
      if (!location) {
        throw new Error(
          `fileUrl redirected (${response.status}) without a Location header.`,
        );
      }
      currentUrl = new URL(location, target.url).toString();
      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      response.destroy();
      throw new Error(
        `Failed to fetch file from URL: ${response.status} ${response.statusText}`,
      );
    }

    // Reject up front if the server declares an oversize body.
    const declared = response.header("content-length");
    const declaredLength = declared === undefined ? NaN : Number(declared);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      response.destroy();
      throw oversize();
    }

    // Stream and enforce the cap even when content-length is absent or lies.
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      for await (const chunk of response.body) {
        total += chunk.byteLength;
        if (total > MAX_RESPONSE_BYTES) throw oversize();
        chunks.push(Buffer.from(chunk));
      }
    } catch (err) {
      response.destroy();
      throw err;
    }
    return Buffer.concat(chunks);
  }

  throw new Error("fileUrl exceeded the maximum number of redirects.");
}
