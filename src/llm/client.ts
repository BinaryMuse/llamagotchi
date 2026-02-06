import { config } from '../config.ts';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionChunk {
  choices: Array<{
    delta: {
      content?: string;
      reasoning?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: Usage;
}

export interface ChatCompletionResponse {
  choices: Array<{
    message: ChatMessage;
    finish_reason: string;
  }>;
  usage?: Usage;
}

export interface CompletionResult {
  message: ChatMessage;
  usage: Usage | null;
}

export type StreamCallback = (chunk: {
  content?: string;
  reasoning?: string;
  toolCalls?: Array<{
    index: number;
    id?: string;
    name?: string;
    arguments?: string;
  }>;
  done: boolean;
}) => void;

export async function streamCompletion(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  onChunk: StreamCallback
): Promise<CompletionResult> {
  const endpoint = `${config.ollamaEndpoint}/v1/chat/completions`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollamaModel,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama API error: ${response.status} ${text}`);
  }

  if (!response.body) {
    throw new Error('No response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let content = '';
  let reasoning = '';
  let usage: Usage | null = null;
  const toolCalls: Array<{
    id: string;
    function: { name: string; arguments: string };
  }> = [];
  const pendingToolCalls: Map<
    number,
    { id: string; name: string; arguments: string }
  > = new Map();

  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') {
        onChunk({ done: true });
        continue;
      }

      try {
        const chunk = JSON.parse(data) as ChatCompletionChunk;

        // Capture usage stats if present (usually in final chunk)
        if (chunk.usage) {
          usage = chunk.usage;
        }

        const delta = chunk.choices[0]?.delta;

        if (delta?.content) {
          content += delta.content;
          onChunk({ content: delta.content, done: false });
        }

        // Handle reasoning/thinking content (used by DeepSeek, some Qwen models, etc.)
        if (delta?.reasoning) {
          reasoning += delta.reasoning;
          onChunk({ reasoning: delta.reasoning, done: false });
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            let pending = pendingToolCalls.get(tc.index);
            if (!pending) {
              pending = { id: tc.id ?? '', name: '', arguments: '' };
              pendingToolCalls.set(tc.index, pending);
            }
            if (tc.id) pending.id = tc.id;
            if (tc.function?.name) pending.name = tc.function.name;
            if (tc.function?.arguments) pending.arguments += tc.function.arguments;

            onChunk({
              toolCalls: [
                {
                  index: tc.index,
                  id: tc.id,
                  name: tc.function?.name,
                  arguments: tc.function?.arguments,
                },
              ],
              done: false,
            });
          }
        }
      } catch (e) {
        // Ignore parse errors for incomplete chunks
      }
    }
  }

  for (const [, tc] of pendingToolCalls) {
    toolCalls.push({
      id: tc.id || crypto.randomUUID(),
      function: { name: tc.name, arguments: tc.arguments },
    });
  }

  const message: ChatMessage = {
    role: 'assistant',
    content,
  };

  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: tc.function,
    }));
  }

  return { message, usage };
}

export async function completion(
  messages: ChatMessage[],
  tools: ToolDefinition[]
): Promise<CompletionResult> {
  const endpoint = `${config.ollamaEndpoint}/v1/chat/completions`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollamaModel,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      stream: false,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama API error: ${response.status} ${text}`);
  }

  const data = (await response.json()) as ChatCompletionResponse;
  return {
    message: data.choices[0]?.message ?? { role: 'assistant', content: '' },
    usage: data.usage ?? null,
  };
}
