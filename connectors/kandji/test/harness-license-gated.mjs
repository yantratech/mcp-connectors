/**
 * Child-process harness for the "both paths 404 → license_gated" test.
 *
 * The kandji-client is a process-level singleton (caches the resolved
 * v1/v2 path). Spawning a fresh Node here gives us a clean cache so we
 * can confirm the full v1→v2→license-gated fallback runs end-to-end.
 *
 * Args: <KANDJI_BASE_URL>  (the mock server URL)
 * Stdout: JSON { threats, behavioral, tried } — the parent reads this
 * Stderr: any [kandji-mcp] log lines (parent asserts on these)
 */
const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error("usage: harness-license-gated.mjs <baseUrl>");
  process.exit(2);
}

process.env.KANDJI_API_TOKEN = "test-token";
process.env.KANDJI_BASE_URL = baseUrl;
// Mock server is plain http on loopback; opt out of the https-only guard.
process.env.KANDJI_ALLOW_INSECURE = "1";

const threats = await import("../dist/handlers/threats.handler.js");
const tried = [];
const origConsoleError = console.error;
console.error = (...args) => {
  tried.push(args.join(" "));
  origConsoleError(...args);
};

const t = await threats.getThreats({});
const b = await threats.getBehavioralDetections({});

process.stdout.write(
  JSON.stringify({ threats: t, behavioral: b, tried: tried.join("\n") }),
);
