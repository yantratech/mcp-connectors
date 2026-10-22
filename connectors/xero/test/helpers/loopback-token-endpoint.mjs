/**
 * Loopback stand-in for Xero's identity token endpoint, so error-convention
 * tests exercise the REAL client_credentials exchange code without any
 * network access.
 *
 * Not a test file itself: `npm test` globs only `test/*.test.mjs`.
 */
import http from "node:http";

// axios honours HTTP(S)_PROXY (via proxy-from-env, which reads `no_proxy`
// before `NO_PROXY`). Exempt loopback in both spellings so a developer or
// CI proxy can never carry these requests off the machine.
{
  const merged = [process.env.no_proxy, process.env.NO_PROXY, "127.0.0.1", "localhost"]
    .filter(Boolean)
    .join(",");
  process.env.no_proxy = merged;
  process.env.NO_PROXY = merged;
}

const listen = (server) =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const close = (server) => new Promise((resolve) => server.close(resolve));

/**
 * Starts a loopback server that answers every request with
 * `401 {"error":"invalid_client"}` (what Xero's identity service returns for
 * bad credentials) and points `client.tokenUrl` at it.
 *
 * Returns a handle with `requests` (every request received, in order),
 * `reset()` to clear them, and `stop()` to restore the original token URL
 * and close the server.
 *
 * `options.status` / `options.body` override the rejection (a string body
 * is sent verbatim, anything else as JSON), e.g. `400 {"error":"invalid_scope"}`.
 */
export async function startRejectingTokenEndpoint(client, options = {}) {
  const status = options.status ?? 401;
  const payload = options.body ?? { error: "invalid_client" };
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
  const handle = { requests: [] };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      handle.requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
      });
      res.writeHead(status, {
        "Content-Type": typeof payload === "string" ? "text/plain" : "application/json",
      });
      res.end(raw);
    });
  });
  await listen(server);

  const originalTokenUrl = client.tokenUrl;
  client.tokenUrl = `http://127.0.0.1:${server.address().port}/connect/token`;

  handle.reset = () => {
    handle.requests.length = 0;
  };
  handle.stop = async () => {
    client.tokenUrl = originalTokenUrl;
    await close(server);
  };
  return handle;
}

/**
 * Points `client.tokenUrl` at a loopback port with nothing listening on it,
 * so the token request fails at the socket. Returns a `stop()` that restores
 * the original token URL.
 */
export async function useUnreachableTokenEndpoint(client) {
  const probe = http.createServer();
  await listen(probe);
  const port = probe.address().port;
  await close(probe);

  const originalTokenUrl = client.tokenUrl;
  client.tokenUrl = `http://127.0.0.1:${port}/connect/token`;
  return {
    stop: async () => {
      client.tokenUrl = originalTokenUrl;
    },
  };
}
