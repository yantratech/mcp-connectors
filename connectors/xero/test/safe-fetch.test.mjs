/**
 * Behavioural tests for safeFetchUrl (src/helpers/safe-fetch-url.ts), the
 * SSRF-hardened fetch behind upload_attachment's fileUrl.
 *
 * The DNS lookup and the HTTP transport are injected, so every case runs
 * offline and asserts what the guard actually does on the wire path:
 * redirect re-validation (including to cloud metadata and to hex-form
 * IPv6-embedded IPv4), the Content-Length and streaming size caps, the
 * redirect limit, and that the connection is pinned to the address that was
 * validated (no second DNS resolution, so no rebinding window).
 *
 * Run via `npm test` (node --test test/*.test.mjs) after `npm run build`.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const {
  safeFetchUrl,
  createPinnedLookup,
  pinnedHttpTransport,
  MAX_RESPONSE_BYTES,
  MAX_REDIRECTS,
} = await import("../dist/helpers/safe-fetch-url.js");

const PUBLIC_V4 = "93.184.216.34";

/** Lookup that maps hostnames to fixed answers and counts calls. */
function fakeLookup(table) {
  const calls = [];
  const fn = async (hostname) => {
    calls.push(hostname);
    const answer = table[hostname];
    if (typeof answer === "function") return answer(calls.length);
    if (!answer) throw new Error(`ENOTFOUND ${hostname}`);
    return answer;
  };
  fn.calls = calls;
  return fn;
}

/** Builds a transport from a list of canned responses, recording targets. */
function fakeTransport(responses) {
  const targets = [];
  const destroyed = [];
  const fn = async (target) => {
    targets.push({ url: target.url.toString(), address: target.address, family: target.family });
    const spec = responses[Math.min(targets.length - 1, responses.length - 1)];
    const r = typeof spec === "function" ? spec(target) : spec;
    const headers = Object.fromEntries(
      Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
    );
    const res = {
      status: r.status,
      statusText: r.statusText ?? "",
      header: (name) => headers[name.toLowerCase()],
      bodyRead: false,
      body: (async function* () {
        res.bodyRead = true;
        for (const chunk of r.chunks ?? []) yield chunk;
      })(),
      destroy: () => destroyed.push(targets.length),
    };
    return res;
  };
  fn.targets = targets;
  fn.destroyed = destroyed;
  return fn;
}

const BLOCKED = /private, loopback, or link-local/;

describe("safeFetchUrl: happy path", () => {
  it("returns the body bytes from a public host", async () => {
    const lookup = fakeLookup({ "files.example": [{ address: PUBLIC_V4, family: 4 }] });
    const transport = fakeTransport([
      { status: 200, chunks: [Buffer.from("hello "), Buffer.from("world")] },
    ]);
    const body = await safeFetchUrl("https://files.example/a.pdf", { lookup, transport });
    assert.equal(body.toString(), "hello world");
  });
});

describe("safeFetchUrl: redirects are re-validated on every hop", () => {
  for (const location of [
    "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    "http://[::ffff:a9fe:a9fe]/latest/meta-data/",
    "http://[::ffff:7f00:1]:8080/admin",
    "http://[::ffff:127.0.0.1]/",
    "http://[64:ff9b::a9fe:a9fe]/",
    "http://2130706433/",
    "http://internal.example/secret",
  ]) {
    it(`refuses a redirect to ${location}`, async () => {
      const lookup = fakeLookup({
        "files.example": [{ address: PUBLIC_V4, family: 4 }],
        "internal.example": [{ address: "10.0.0.7", family: 4 }],
      });
      const transport = fakeTransport([
        { status: 302, headers: { location } },
        { status: 200, chunks: [Buffer.from("SECRET")] },
      ]);
      await assert.rejects(
        () => safeFetchUrl("https://files.example/a.pdf", { lookup, transport }),
        BLOCKED,
      );
      // Only the first (public) hop was ever requested.
      assert.equal(transport.targets.length, 1);
      assert.equal(transport.targets[0].address, PUBLIC_V4);
    });
  }

  it("follows a redirect to another public host", async () => {
    const lookup = fakeLookup({
      "files.example": [{ address: PUBLIC_V4, family: 4 }],
      "cdn.example": [{ address: "8.8.4.4", family: 4 }],
    });
    const transport = fakeTransport([
      { status: 301, headers: { location: "https://cdn.example/b.pdf" } },
      { status: 200, chunks: [Buffer.from("ok")] },
    ]);
    const body = await safeFetchUrl("https://files.example/a.pdf", { lookup, transport });
    assert.equal(body.toString(), "ok");
    assert.deepEqual(
      transport.targets.map((t) => t.address),
      [PUBLIC_V4, "8.8.4.4"],
    );
  });

  it(`stops after MAX_REDIRECTS (${MAX_REDIRECTS}) hops`, async () => {
    const lookup = fakeLookup({ "loop.example": [{ address: PUBLIC_V4, family: 4 }] });
    const transport = fakeTransport([
      { status: 302, headers: { location: "https://loop.example/next" } },
    ]);
    await assert.rejects(
      () => safeFetchUrl("https://loop.example/start", { lookup, transport }),
      /maximum number of redirects/,
    );
    assert.equal(transport.targets.length, MAX_REDIRECTS + 1);
  });

  it("rejects a redirect with no Location header", async () => {
    const lookup = fakeLookup({ "files.example": [{ address: PUBLIC_V4, family: 4 }] });
    const transport = fakeTransport([{ status: 302 }]);
    await assert.rejects(
      () => safeFetchUrl("https://files.example/a.pdf", { lookup, transport }),
      /without a Location header/,
    );
  });
});

describe("safeFetchUrl: response-size cap", () => {
  it("rejects a declared Content-Length over the cap without reading the body", async () => {
    const lookup = fakeLookup({ "files.example": [{ address: PUBLIC_V4, family: 4 }] });
    const transport = fakeTransport([
      {
        status: 200,
        headers: { "content-length": MAX_RESPONSE_BYTES + 1 },
        chunks: [Buffer.alloc(16)],
      },
    ]);
    await assert.rejects(
      () => safeFetchUrl("https://files.example/big.pdf", { lookup, transport }),
      /exceeds the \d+-byte limit/,
    );
    assert.equal(transport.destroyed.length, 1, "response must be destroyed");
  });

  it("rejects a streamed body that exceeds the cap when Content-Length is absent", async () => {
    const lookup = fakeLookup({ "files.example": [{ address: PUBLIC_V4, family: 4 }] });
    const chunk = Buffer.alloc(1024 * 1024);
    const chunks = Array.from({ length: MAX_RESPONSE_BYTES / chunk.length + 1 }, () => chunk);
    const transport = fakeTransport([{ status: 200, chunks }]);
    await assert.rejects(
      () => safeFetchUrl("https://files.example/big.pdf", { lookup, transport }),
      /exceeds the \d+-byte limit/,
    );
    assert.equal(transport.destroyed.length, 1, "stream must be destroyed");
  });

  it("rejects a streamed body that exceeds the cap when Content-Length lies", async () => {
    const lookup = fakeLookup({ "files.example": [{ address: PUBLIC_V4, family: 4 }] });
    const chunk = Buffer.alloc(1024 * 1024);
    const chunks = Array.from({ length: MAX_RESPONSE_BYTES / chunk.length + 1 }, () => chunk);
    const transport = fakeTransport([
      { status: 200, headers: { "content-length": 10 }, chunks },
    ]);
    await assert.rejects(
      () => safeFetchUrl("https://files.example/big.pdf", { lookup, transport }),
      /exceeds the \d+-byte limit/,
    );
  });

  it("accepts a body of exactly the cap", async () => {
    const lookup = fakeLookup({ "files.example": [{ address: PUBLIC_V4, family: 4 }] });
    const transport = fakeTransport([
      { status: 200, chunks: [Buffer.alloc(MAX_RESPONSE_BYTES)] },
    ]);
    const body = await safeFetchUrl("https://files.example/ok.pdf", { lookup, transport });
    assert.equal(body.length, MAX_RESPONSE_BYTES);
  });
});

describe("safeFetchUrl: non-2xx responses", () => {
  it("surfaces the status and does not return a body", async () => {
    const lookup = fakeLookup({ "files.example": [{ address: PUBLIC_V4, family: 4 }] });
    const transport = fakeTransport([{ status: 404, statusText: "Not Found" }]);
    await assert.rejects(
      () => safeFetchUrl("https://files.example/missing.pdf", { lookup, transport }),
      /404 Not Found/,
    );
  });
});

describe("safeFetchUrl: DNS pinning (no rebinding window)", () => {
  it("resolves each hop exactly once and connects to the validated address", async () => {
    // A rebinding resolver: public on the first answer, metadata after.
    const lookup = fakeLookup({
      "rebind.example": (n) =>
        n === 1
          ? [{ address: PUBLIC_V4, family: 4 }]
          : [{ address: "169.254.169.254", family: 4 }],
    });
    const transport = fakeTransport([{ status: 200, chunks: [Buffer.from("x")] }]);
    await safeFetchUrl("http://rebind.example/a", { lookup, transport });
    assert.equal(lookup.calls.length, 1, "host must be resolved once per hop");
    assert.equal(transport.targets[0].address, PUBLIC_V4);
  });

  it("createPinnedLookup answers with the pinned address whatever the hostname", async () => {
    const pinned = createPinnedLookup("203.0.113.9", 4);
    const single = await new Promise((resolve) =>
      pinned("anything.example", { family: 0 }, (err, address, family) =>
        resolve({ err, address, family }),
      ),
    );
    assert.deepEqual(single, { err: null, address: "203.0.113.9", family: 4 });
    const all = await new Promise((resolve) =>
      pinned("anything.example", { all: true }, (err, addresses) =>
        resolve({ err, addresses }),
      ),
    );
    assert.deepEqual(all, {
      err: null,
      addresses: [{ address: "203.0.113.9", family: 4 }],
    });
  });

  describe("pinnedHttpTransport connects to the pinned address, not DNS", () => {
    let server;
    let port;
    let seenHost;

    before(async () => {
      server = http.createServer((req, res) => {
        seenHost = req.headers.host;
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("PINNED");
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      port = server.address().port;
    });

    after(() => server.close());

    it("reaches the pinned socket even though the hostname cannot resolve", async () => {
      // `.invalid` never resolves (RFC 6761): success proves no DNS lookup.
      const url = new URL(`http://pinned-host.invalid:${port}/x`);
      const res = await pinnedHttpTransport({ url, address: "127.0.0.1", family: 4 });
      const chunks = [];
      for await (const c of res.body) chunks.push(Buffer.from(c));
      assert.equal(res.status, 200);
      assert.equal(Buffer.concat(chunks).toString(), "PINNED");
      // The Host header still names the original host (TLS SNI likewise).
      assert.equal(seenHost, `pinned-host.invalid:${port}`);
    });
  });
});
