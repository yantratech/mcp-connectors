import ListDevicesTool from "./list-devices.tool.js";
import GetDeviceTool from "./get-device.tool.js";
import GetDeviceDetailsTool from "./get-device-details.tool.js";
import GetDeviceAppsTool from "./get-device-apps.tool.js";
import GetDeviceStatusTool from "./get-device-status.tool.js";
import GetDeviceActivityTool from "./get-device-activity.tool.js";
import GetDeviceLibraryItemsTool from "./get-device-library-items.tool.js";
import GetDeviceParametersTool from "./get-device-parameters.tool.js";
import GetDeviceCommandsTool from "./get-device-commands.tool.js";
import GetDeviceLostModeTool from "./get-device-lost-mode.tool.js";
import ListDeviceNotesTool from "./list-device-notes.tool.js";
import GetDeviceNoteTool from "./get-device-note.tool.js";
import CreateDeviceNoteTool from "./create-device-note.tool.js";
import UpdateDeviceNoteTool from "./update-device-note.tool.js";
import DeleteDeviceNoteTool from "./delete-device-note.tool.js";
import GetFileVaultRecoveryKeyTool from "./get-filevault-recovery-key.tool.js";
import GetActivationLockBypassCodeTool from "./get-activation-lock-bypass-code.tool.js";
import GetUnlockPinTool from "./get-unlock-pin.tool.js";
import GetRecoveryLockPasswordTool from "./get-recovery-lock-password.tool.js";
import UpdateDeviceTool from "./update-device.tool.js";
import UpdateInventoryTool from "./update-inventory.tool.js";
import DailyCheckinTool from "./daily-checkin.tool.js";
import LockDeviceTool from "./lock-device.tool.js";
import UnlockAccountTool from "./unlock-account.tool.js";
import ClearPasscodeTool from "./clear-passcode.tool.js";
import EraseDeviceTool from "./erase-device.tool.js";
import EnableLostModeTool from "./enable-lost-mode.tool.js";
import DisableLostModeTool from "./disable-lost-mode.tool.js";
import PlayLostModeSoundTool from "./play-lost-mode-sound.tool.js";
import UpdateLocationTool from "./update-location.tool.js";
import RestartDeviceTool from "./restart-device.tool.js";
import ShutdownDeviceTool from "./shutdown-device.tool.js";
import BlankPushTool from "./blank-push.tool.js";
import RenewMdmProfileTool from "./renew-mdm-profile.tool.js";
import ReinstallAgentTool from "./reinstall-agent.tool.js";
import DeleteUserTool from "./delete-user.tool.js";

export const DeviceTools = [
  ListDevicesTool,
  GetDeviceTool,
  GetDeviceDetailsTool,
  GetDeviceAppsTool,
  GetDeviceStatusTool,
  GetDeviceActivityTool,
  GetDeviceLibraryItemsTool,
  GetDeviceParametersTool,
  GetDeviceCommandsTool,
  GetDeviceLostModeTool,
  ListDeviceNotesTool,
  GetDeviceNoteTool,
  CreateDeviceNoteTool,
  UpdateDeviceNoteTool,
  DeleteDeviceNoteTool,
  GetFileVaultRecoveryKeyTool,
  GetActivationLockBypassCodeTool,
  GetUnlockPinTool,
  GetRecoveryLockPasswordTool,
  UpdateDeviceTool,
  UpdateInventoryTool,
  DailyCheckinTool,
  // Device actions (POST /devices/{id}/action/<action>)
  LockDeviceTool,
  UnlockAccountTool,
  ClearPasscodeTool,
  EraseDeviceTool,
  EnableLostModeTool,
  DisableLostModeTool,
  PlayLostModeSoundTool,
  UpdateLocationTool,
  RestartDeviceTool,
  ShutdownDeviceTool,
  BlankPushTool,
  RenewMdmProfileTool,
  ReinstallAgentTool,
  DeleteUserTool,
];
