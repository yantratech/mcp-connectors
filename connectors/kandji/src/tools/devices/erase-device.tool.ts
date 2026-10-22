import { randomInt } from "node:crypto";
import { z } from "zod";
import { getKandjiClient } from "../../clients/kandji-client.js";
import { KandjiUuid } from "../../helpers/kandji-id.js";
import { triggerDeviceAction } from "../../handlers/device-actions.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import {
  formatKandjiError,
  renderToolError,
} from "../../helpers/format-kandji-error.js";

// Apple MDM EraseDevice on macOS requires a 6-digit PIN. The Kandji API
// rejects requests without it (`<SchemaError(errors=[<PIN: MissingKeyError()>])>`)
// — unlike DeviceLock, where the API auto-generates a PIN if none is sent —
// and does not echo it back. Without the PIN the device cannot be released
// from the EFI lock screen after the wipe, so the caller must hold it before
// the erase is sent: a PIN generated here and then lost with the result (a
// client timeout or cancellation mid-request) would leave a wiped device
// nobody can unlock. Called without a PIN, the tool therefore sends nothing
// and returns a generated one for the caller to send the erase with.
function generatePin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

// Only a 4xx shows that Kandji refused the erase. Any other failure (a 5xx,
// a dropped connection or timeout, a 2xx whose body cannot be read) can
// follow an accepted command.
function eraseMayHaveBeenQueued(status: number | undefined): boolean {
  return status === undefined || status < 400 || status >= 500;
}

function uncertainOutcomeHint(pin: string): string {
  return `The erase may still have been queued with the PIN you supplied ("${pin}"). If the device erases, give that PIN to its user: the device requires it at the EFI lock screen after the wipe. Check the device's command status (get_device_commands) before retrying, and if you do retry, pass the same PIN.`;
}

function jsonResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

const EraseDeviceTool = CreateKandjiTool(
  "erase_device",
  "DESTRUCTIVE: queues an MDM 'EraseDevice' command that wipes ALL data on the device — irreversible. On Apple Silicon Macs and iOS this is a cryptographic wipe; on Intel Macs it requires firmware support. The device is unenrolled and re-enrols on next setup. Use only for confirmed loss/theft, employee offboarding, or device repurposing. The erase sets a 6-digit PIN that the device asks for at the EFI lock screen after the wipe, so the PIN is fixed before anything is sent. Without PIN this is step one of two: the tool sends NOTHING to Kandji and returns { sent: false, action: \"confirm_erase\", device_id, PIN, next } with a freshly generated random PIN; to proceed, call erase_device again with that PIN. With PIN, it sends POST /devices/{id}/action/erase and returns the queued command record plus the PIN. The calling LLM MUST surface this PIN to the user, since it is required to release the device from the EFI lock screen after the wipe finishes. Not idempotent: each call with a PIN queues another erase. If a call with a PIN fails other than with a 4xx rejection, or times out or is cancelled mid-request, the erase may still have been queued with that PIN, so check get_device_commands before calling again, and retry only with the same PIN. Every erase Kandji accepts is logged to stderr.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID to erase"),
    PIN: z
      .string()
      .regex(/^\d{6}$/)
      .optional()
      .describe(
        "6-digit numeric PIN to set on the EFI lock screen post-wipe. The erase is sent only when PIN is given. If omitted, nothing is sent: the call returns a freshly generated cryptographically random 6-digit PIN, and you call erase_device again with that PIN to proceed.",
      ),
    pin_message: z
      .string()
      .optional()
      .describe(
        "Optional message displayed at the EFI lock screen after the wipe completes (e.g. instructions to call IT).",
      ),
    phone_number: z
      .string()
      .optional()
      .describe(
        "Optional contact phone number displayed at the EFI lock screen after the wipe completes.",
      ),
  },
  async ({ device_id, PIN, pin_message, phone_number }, extra) => {
    // A configuration error (a missing token, a non-https KANDJI_BASE_URL)
    // is raised before anything is sent, so it is reported as it is: no
    // "may have been queued" hint and no PIN.
    try {
      getKandjiClient();
    } catch (err) {
      return renderToolError(formatKandjiError(err));
    }

    // Step one of two: send nothing, and hand the caller a PIN to send the
    // erase with. The PIN is then known before the erase can be queued, so
    // no failure, timeout or cancellation can lose it.
    if (PIN === undefined) {
      const pin = generatePin();
      return jsonResult({
        sent: false,
        action: "confirm_erase",
        device_id,
        PIN: pin,
        next: `No erase was sent. To erase the device, call erase_device again with the same arguments plus PIN "${pin}". Give this PIN to the device's user: the device will require it at the EFI lock screen after the wipe.`,
      });
    }

    const payload: Record<string, unknown> = { PIN };
    if (pin_message !== undefined) payload.PINMessage = pin_message;
    if (phone_number !== undefined) payload.PhoneNumber = phone_number;

    // Once the client cancels the call or times it out, the SDK drops this
    // result, so the erase must not be sent after that, e.g. at the end of a
    // 429 backoff.
    const response = await triggerDeviceAction(
      device_id,
      "erase",
      payload,
      extra?.signal,
    );
    if (response.isError) {
      if (!eraseMayHaveBeenQueued(response.status)) {
        return renderToolError(response);
      }
      // Replaces any status hint: generic retry advice is wrong for an
      // erase that may already be queued with this PIN.
      return renderToolError({
        ...response,
        hint: uncertainOutcomeHint(PIN),
      });
    }
    // Always include the PIN in the response so the LLM can relay it to the
    // device user. The Kandji API echoes back various command-record fields
    // but does NOT echo the PIN, so we attach it ourselves.
    const result =
      response.result && typeof response.result === "object"
        ? { ...(response.result as Record<string, unknown>), PIN }
        : { queued: true, action: "erase", PIN };
    return jsonResult(result);
  },
  { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
);

export default EraseDeviceTool;
