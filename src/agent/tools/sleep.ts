import type { ToolDefinition } from '../../llm/client.ts';
import type { ToolContext } from './index.ts';

const MAX_SLEEP_MS = 30 * 1000; // 30 seconds max

export const sleepDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'sleep',
    description:
      'Sleep for a specified duration (max 30 seconds). Can be interrupted by incoming events (user messages, injections).',
    parameters: {
      type: 'object',
      properties: {
        duration: {
          type: 'number',
          description: 'How long to sleep (capped at 30 seconds)',
        },
        unit: {
          type: 'string',
          enum: ['seconds', 'minutes', 'hours'],
          description: 'Time unit for the duration',
        },
      },
      required: ['duration', 'unit'],
    },
  },
};

function toMilliseconds(duration: number, unit: string): number {
  switch (unit) {
    case 'seconds':
      return duration * 1000;
    case 'minutes':
      return duration * 60 * 1000;
    case 'hours':
      return duration * 60 * 60 * 1000;
    default:
      throw new Error(`Unknown unit: ${unit}`);
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hours`;
}

export async function sleep(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const duration = input.duration as number;
  const unit = input.unit as string;

  if (!duration || !unit) {
    return 'Error: duration and unit are required';
  }

  const requestedMs = toMilliseconds(duration, unit);
  const totalMs = Math.min(requestedMs, MAX_SLEEP_MS);
  const wasCapped = requestedMs > MAX_SLEEP_MS;
  const startTime = Date.now();
  const checkInterval = 100;

  let elapsed = 0;
  while (elapsed < totalMs) {
    if (context.onInterrupt?.()) {
      const actualDuration = Date.now() - startTime;
      return `Sleep interrupted after ${formatDuration(actualDuration)}`;
    }

    await Bun.sleep(Math.min(checkInterval, totalMs - elapsed));
    elapsed = Date.now() - startTime;
  }

  const cappedNote = wasCapped
    ? ` (requested ${formatDuration(requestedMs)}, capped at 30 seconds)`
    : '';
  return `Sleep completed (${formatDuration(totalMs)})${cappedNote}`;
}
