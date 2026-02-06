import type { ToolDefinition } from '../../llm/client.ts';
import { webFetch, webFetchDefinition } from './web-fetch.ts';
import { webSearch, webSearchDefinition } from './web-search.ts';
import { filesystem, filesystemDefinition } from './filesystem.ts';
import { terminal, terminalDefinition } from './terminal.ts';
import { sleep, sleepDefinition } from './sleep.ts';
import { notable, notableDefinition } from './notable.ts';
import { taskStatus, taskStatusDefinition } from './task-status.ts';
import { taskWait, taskWaitDefinition } from './task-wait.ts';

export interface ToolContext {
  onInterrupt?: () => boolean;
}

export type ToolHandler = (
  input: Record<string, unknown>,
  context: ToolContext
) => Promise<string>;

const toolHandlers: Record<string, ToolHandler> = {
  web_fetch: webFetch,
  web_search: webSearch,
  filesystem: filesystem,
  terminal: terminal,
  sleep: sleep,
  notable: notable,
  task_status: taskStatus,
  task_wait: taskWait,
};

export const toolDefinitions: ToolDefinition[] = [
  webFetchDefinition,
  webSearchDefinition,
  filesystemDefinition,
  terminalDefinition,
  sleepDefinition,
  notableDefinition,
  taskStatusDefinition,
  taskWaitDefinition,
];

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  context: ToolContext = {}
): Promise<string> {
  const handler = toolHandlers[name];
  if (!handler) {
    return `Error: Unknown tool "${name}"`;
  }

  try {
    return await handler(input, context);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: ${message}`;
  }
}
