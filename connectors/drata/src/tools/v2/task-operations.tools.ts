import { z } from "zod";
import {
  createTask,
  getTask,
  listTasks,
  listUpcomingTasks,
  performTaskAction,
  updateTask,
} from "../../handlers/v2-write.handler.js";
import type { DrataQueryParams } from "../../clients/drata-client.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const JsonBodySchema = z.record(z.string(), z.unknown());

function taskParams(args: {
  cursor?: string;
  size?: number;
  includeTotalCount?: boolean;
  expand?: string[];
  status?: string;
  taskType?: string;
  type?: string;
  createdById?: number;
  controlId?: number;
  title?: string;
  description?: string;
  assigneeId?: number;
  dueDateFrom?: string;
  dueDateTo?: string;
  sort?: string;
  sortDir?: "ASC" | "DESC";
}): DrataQueryParams {
  return {
    cursor: args.cursor,
    size: args.size,
    includeTotalCount: args.includeTotalCount,
    expand: args.expand,
    status: args.status,
    taskType: args.taskType ?? args.type,
    createdById: args.createdById,
    controlId: args.controlId,
    title: args.title,
    description: args.description,
    assigneeId: args.assigneeId,
    dueDateFrom: args.dueDateFrom,
    dueDateTo: args.dueDateTo,
    sort: args.sort,
    sortDir: args.sortDir,
  };
}

const taskListShape = {
  workspaceId: z
    .number()
    .optional()
    .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
  cursor: z.string().optional().describe("Pagination cursor"),
  size: z.number().optional().describe("Page size"),
  includeTotalCount: z.boolean().optional().describe("Ask Drata to include total count"),
  expand: z.array(z.string()).optional().describe("Related fields to expand"),
  status: z.string().optional().describe("Filter by task status"),
  taskType: z.string().optional().describe("Filter by task type"),
  type: z
    .string()
    .optional()
    .describe("Deprecated alias for taskType; serialized to Drata as taskType."),
  createdById: z.number().optional().describe("Filter by creator user ID"),
  controlId: z.number().optional().describe("Filter by linked control ID"),
  title: z.string().optional().describe("Filter by task title prefix"),
  description: z.string().optional().describe("Filter by task description prefix"),
  assigneeId: z.number().optional().describe("Filter by assignee user ID"),
  dueDateFrom: z.string().optional().describe("Minimum due date"),
  dueDateTo: z.string().optional().describe("Maximum due date"),
  sort: z.string().optional().describe("Sort field"),
  sortDir: z.enum(["ASC", "DESC"]).optional().describe("Sort direction"),
};

const ListTasksTool = CreateDrataTool(
  "list_tasks",
  "List Drata tasks with V2 filters and cursor pagination.",
  taskListShape,
  async ({ workspaceId, ...args }) => {
    const response = await listTasks(workspaceId, taskParams(args));
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const ListUpcomingTasksTool = CreateDrataTool(
  "list_upcoming_tasks",
  "List incomplete Drata tasks ordered by due date (oldest first) — INCLUDES overdue tasks. Pass dueDateFrom/dueDateTo to bound the window; other V2 filters optional.",
  taskListShape,
  async ({ workspaceId, ...args }) => {
    const response = await listUpcomingTasks(workspaceId, taskParams(args));
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const GetTaskTool = CreateDrataTool(
  "get_task",
  "Get a Drata task by ID.",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
    taskId: z.number().describe("Task ID"),
    expand: z
      .array(z.string())
      .optional()
      .describe("Related fields to expand. Known values: assignee, control, owner."),
  },
  async ({ workspaceId, taskId, expand }) => {
    const response = await getTask(workspaceId, taskId, expand ? { expand } : undefined);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const CreateTaskTool = CreateDrataTool(
  "create_task",
  "Create a Drata task. Body is passed through to Drata V2.",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
    body: JsonBodySchema.describe("Task create request body"),
  },
  async ({ workspaceId, body }) => {
    const response = await createTask(workspaceId, body);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const UpdateTaskTool = CreateDrataTool(
  "update_task",
  "Update a Drata task. Body is passed through to Drata V2.",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
    taskId: z.number().describe("Task ID"),
    body: JsonBodySchema.describe("Task update request body"),
  },
  async ({ workspaceId, taskId, body }) => {
    const response = await updateTask(workspaceId, taskId, body);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const PerformTaskActionTool = CreateDrataTool(
  "perform_task_action",
  "Perform a Drata task action.",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
    taskId: z.number().describe("Task ID"),
    action: z.enum(["complete", "uncomplete"]).describe("Task action"),
  },
  async ({ workspaceId, taskId, action }) => {
    const response = await performTaskAction(workspaceId, taskId, action);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export const TaskOperationsTools = [
  ListTasksTool,
  ListUpcomingTasksTool,
  GetTaskTool,
  CreateTaskTool,
  UpdateTaskTool,
  PerformTaskActionTool,
];
