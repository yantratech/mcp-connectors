/**
 * Child-process harness for the KANDJI_BASE_URL validation tests.
 *
 * The kandji-client is a process-level singleton constructed on first
 * `getKandjiClient()` call, so each base-URL scenario needs a fresh process.
 * The parent spawns this with env already set and reads the JSON verdict.
 *
 * Stdout: JSON { ok: boolean, error?: string }
 *   ok=true  → getKandjiClient() succeeded (URL accepted)
 *   ok=false → constructor threw (URL rejected); `error` is the message
 */
process.env.KANDJI_API_TOKEN = process.env.KANDJI_API_TOKEN ?? "test-token";

try {
  const { getKandjiClient } = await import("../dist/clients/kandji-client.js");
  getKandjiClient();
  process.stdout.write(JSON.stringify({ ok: true }));
} catch (err) {
  process.stdout.write(
    JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
}
