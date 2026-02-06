import type { ToolDefinition } from '../../llm/client.ts';
import type { ToolContext } from './index.ts';
import { getBackgroundTask } from '../../db/messages.ts';

export const taskWaitDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'task_wait',
    description:
      'Wait for a backgrounded task to complete. Returns the result when done, or times out.',
    parameters: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'The task ID to wait for',
        },
        timeout: {
          type: 'number',
          description:
            'Maximum time to wait in milliseconds (default: 30000). If exceeded, returns current status.',
        },
      },
      required: ['task_id'],
    },
  },
};

export async function taskWait(
  input: Record<string, unknown>,
  _context: ToolContext
): Promise<string> {
  const taskId = input.task_id as string;
  const timeout = (input.timeout as number) ?? 30000;

  if (!taskId) {
    return 'Error: task_id is required';
  }

  const startTime = Date.now();
  const pollInterval = 100;

  while (Date.now() - startTime < timeout) {
    const task = getBackgroundTask(taskId);

    if (!task) {
      return `Error: Task not found: ${taskId}`;
    }

    if (task.status === 'completed') {
      return task.result ?? '(no result)';
    }

    if (task.status === 'failed') {
      return `Error: ${task.error ?? 'Task failed'}`;
    }

    await Bun.sleep(pollInterval);
  }

  return JSON.stringify({
    status: 'running',
    message: `Timeout exceeded after ${timeout}ms. Task still running.`,
    task_id: taskId,
  });
}
