import type { ToolDefinition } from '../../llm/client.ts';
import type { ToolContext } from './index.ts';
import { getBackgroundTask } from '../../db/messages.ts';

export const taskStatusDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'task_status',
    description:
      'Check the status of a backgrounded task. Returns status, result (if completed), or error (if failed).',
    parameters: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'The task ID returned when the task was backgrounded',
        },
      },
      required: ['task_id'],
    },
  },
};

export async function taskStatus(
  input: Record<string, unknown>,
  _context: ToolContext
): Promise<string> {
  const taskId = input.task_id as string;

  if (!taskId) {
    return 'Error: task_id is required';
  }

  const task = getBackgroundTask(taskId);

  if (!task) {
    return `Error: Task not found: ${taskId}`;
  }

  const response: Record<string, unknown> = {
    status: task.status,
  };

  if (task.status === 'completed' && task.result) {
    response.result = task.result;
  }

  if (task.status === 'failed' && task.error) {
    response.error = task.error;
  }

  return JSON.stringify(response, null, 2);
}
