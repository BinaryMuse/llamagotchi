import type { ToolDefinition } from '../../llm/client.ts';
import type { ToolContext } from './index.ts';
import { addNotable } from '../../db/messages.ts';
import { broadcastNotable } from '../../server/websocket.ts';

export const notableDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'notable',
    description:
      "Surface something interesting, useful, or novel to the user's Notables tab. Use this to highlight discoveries, insights, or results worth remembering.",
    parameters: {
      type: 'object',
      properties: {
        label: {
          type: 'string',
          description:
            'Short title/category for the notable (e.g., "Discovery", "Insight", "Result")',
        },
        content: {
          type: 'string',
          description: 'The notable content (supports markdown)',
        },
        reason: {
          type: 'string',
          description: 'Optional explanation of why this is notable',
        },
      },
      required: ['label', 'content'],
    },
  },
};

export async function notable(
  input: Record<string, unknown>,
  _context: ToolContext
): Promise<string> {
  const label = input.label as string;
  const content = input.content as string;
  const reason = input.reason as string | undefined;

  if (!label || !content) {
    return 'Error: label and content are required';
  }

  const created = addNotable(label, content, reason);
  broadcastNotable(created);

  return `Notable created: "${label}"`;
}
