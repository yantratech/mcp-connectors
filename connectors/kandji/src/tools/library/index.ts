import ListCustomAppsTool from "./list-custom-apps.tool.js";
import GetCustomAppTool from "./get-custom-app.tool.js";
import ListInHouseAppsTool from "./list-in-house-apps.tool.js";
import GetInHouseAppTool from "./get-in-house-app.tool.js";
import ListCustomProfilesTool from "./list-custom-profiles.tool.js";
import GetCustomProfileTool from "./get-custom-profile.tool.js";
import ListCustomScriptsTool from "./list-custom-scripts.tool.js";
import GetCustomScriptTool from "./get-custom-script.tool.js";
import GetLibraryItemStatusTool from "./get-library-item-status.tool.js";
import GetLibraryItemActivityTool from "./get-library-item-activity.tool.js";
import ListSelfServiceCategoriesTool from "./list-self-service-categories.tool.js";
import CreateCustomAppTool from "./create-custom-app.tool.js";
import UpdateCustomAppTool from "./update-custom-app.tool.js";
import DeleteCustomAppTool from "./delete-custom-app.tool.js";
import UploadCustomAppBinaryTool from "./upload-custom-app-binary.tool.js";
import CreateCustomProfileTool from "./create-custom-profile.tool.js";
import UpdateCustomProfileTool from "./update-custom-profile.tool.js";
import DeleteCustomProfileTool from "./delete-custom-profile.tool.js";
import CreateCustomScriptTool from "./create-custom-script.tool.js";
import UpdateCustomScriptTool from "./update-custom-script.tool.js";
import DeleteCustomScriptTool from "./delete-custom-script.tool.js";
import CreateInHouseAppTool from "./create-in-house-app.tool.js";
import UpdateInHouseAppTool from "./update-in-house-app.tool.js";
import DeleteInHouseAppTool from "./delete-in-house-app.tool.js";
import UploadInHouseAppBinaryTool from "./upload-in-house-app-binary.tool.js";

export const LibraryTools = [
  ListCustomAppsTool,
  GetCustomAppTool,
  ListInHouseAppsTool,
  GetInHouseAppTool,
  ListCustomProfilesTool,
  GetCustomProfileTool,
  ListCustomScriptsTool,
  GetCustomScriptTool,
  GetLibraryItemStatusTool,
  GetLibraryItemActivityTool,
  ListSelfServiceCategoriesTool,
  // Library writes — custom apps
  CreateCustomAppTool,
  UpdateCustomAppTool,
  DeleteCustomAppTool,
  UploadCustomAppBinaryTool,
  // Library writes — custom profiles
  CreateCustomProfileTool,
  UpdateCustomProfileTool,
  DeleteCustomProfileTool,
  // Library writes — custom scripts
  CreateCustomScriptTool,
  UpdateCustomScriptTool,
  DeleteCustomScriptTool,
  // Library writes — in-house (IPA) apps
  CreateInHouseAppTool,
  UpdateInHouseAppTool,
  DeleteInHouseAppTool,
  UploadInHouseAppBinaryTool,
];
