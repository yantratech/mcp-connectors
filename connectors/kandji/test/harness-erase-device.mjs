/**
 * Child-process harness for the erase_device configuration-error tests.
 *
 * The kandji-client is a process-level singleton built from the environment
 * on first `getKandjiClient()` call, so a scenario with a different
 * KANDJI_BASE_URL needs a fresh process. The parent spawns this with the
 * environment already set.
 *
 * Args: <erase_device arguments as JSON>
 * Stdout: JSON of the tool result ({ content, isError? })
 */
const argsJson = process.argv[2];
if (!argsJson) {
  console.error("usage: harness-erase-device.mjs '<arguments as JSON>'");
  process.exit(2);
}

process.env.KANDJI_API_TOKEN = process.env.KANDJI_API_TOKEN ?? "test-token";

const { default: EraseDeviceTool } =
  await import("../dist/tools/devices/erase-device.tool.js");
const out = await EraseDeviceTool().handler(JSON.parse(argsJson), {});
process.stdout.write(JSON.stringify(out));
