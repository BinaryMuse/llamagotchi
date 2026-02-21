import type { ChatMessage } from './client.ts';
import { config } from '../config.ts';

const SOFT_LIMIT_RATIO = 0.7;
const HARD_LIMIT_RATIO = 0.9;
const OVERFLOW_LIMIT_RATIO = 1.1;

export function getContextSize(): number {
  return config.contextSize;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateMessageTokens(message: ChatMessage): number {
  let tokens = estimateTokens(message.content);
  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      tokens += estimateTokens(tc.function.name);
      tokens += estimateTokens(tc.function.arguments);
    }
  }
  return tokens + 4;
}

export function estimateTotalTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}

export function getContextPressure(messages: ChatMessage[]): {
  tokens: number;
  ratio: number;
  level: 'normal' | 'soft' | 'hard' | 'overflow';
} {
  const tokens = estimateTotalTokens(messages);
  const ratio = tokens / getContextSize();

  let level: 'normal' | 'soft' | 'hard' | 'overflow' = 'normal';
  if (ratio >= OVERFLOW_LIMIT_RATIO) {
    level = 'overflow';
  } else if (ratio >= HARD_LIMIT_RATIO) {
    level = 'hard';
  } else if (ratio >= SOFT_LIMIT_RATIO) {
    level = 'soft';
  }

  return { tokens, ratio, level };
}

export function summarizeMessage(message: ChatMessage): ChatMessage {
  if (message.role === 'tool') {
    const content = message.content;
    if (content.length > 500) {
      return {
        ...message,
        content: `[Summarized tool result: ${content.slice(0, 200)}... (${content.length} chars total)]`,
      };
    }
  }
  return message;
}

export function compactMessages(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg) continue;

    if (i < messages.length - 10) {
      result.push(summarizeMessage(msg));
    } else {
      result.push(msg);
    }
  }

  return result;
}

export function createHandoffSummary(messages: ChatMessage[]): string {
  const assistantMessages = messages.filter((m) => m.role === 'assistant');
  const toolMessages = messages.filter((m) => m.role === 'tool');

  const summary = `
Session Summary:
- Total messages: ${messages.length}
- Assistant turns: ${assistantMessages.length}
- Tool uses: ${toolMessages.length}

Recent context: The agent was engaged in conversation and tool use.
`.trim();

  return summary;
}
