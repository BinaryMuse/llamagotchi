import type { ChatMessage } from '../llm/client.ts';
import { streamCompletion } from '../llm/client.ts';
import { jsonrepair } from 'jsonrepair';
import { toolDefinitions, executeTool } from './tools/index.ts';
import {
  SYSTEM_PROMPT,
  AUTONOMOUS_NUDGE,
  CONTEXT_PRESSURE_WARNING,
  formatExternalMessage,
  formatSessionHandoff,
} from './prompts.ts';
import {
  addMessage,
  getAllMessages,
  getState,
  setState,
  getCurrentSession,
  startSession,
  endCurrentSession,
  type Message,
} from '../db/messages.ts';
import {
  broadcastMessage,
  broadcastToken,
  broadcastReasoning,
  broadcastContextPressure,
} from '../server/websocket.ts';
import {
  getContextPressure,
  compactMessages,
  createHandoffSummary,
  getContextSize,
} from '../llm/context.ts';
import type { WebSocketMessage } from '../server/index.ts';

type Mode = 'conversational' | 'autonomous';

export interface AgentHarness {
  start(): void;
  stop(): void;
  handleWebSocketMessage(msg: WebSocketMessage): void;
}

export function createAgentHarness(): AgentHarness {
  let running = false;
  let messages: ChatMessage[] = [];
  let pendingInterrupt = false;
  let stepSignal: (() => void) | null = null;
  let pendingUserMessages: string[] = [];
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 3;

  function dbToChat(dbMsg: Message): ChatMessage | null {
    switch (dbMsg.source) {
      case 'user':
        return { role: 'user', content: dbMsg.content };
      case 'assistant':
        if (dbMsg.tool_name && dbMsg.tool_input) {
          return {
            role: 'assistant',
            content: dbMsg.content,
            tool_calls: [
              {
                id: dbMsg.tool_name,
                type: 'function',
                function: {
                  name: dbMsg.tool_name,
                  arguments: dbMsg.tool_input,
                },
              },
            ],
          };
        }
        return { role: 'assistant', content: dbMsg.content };
      case 'system':
        return { role: 'system', content: dbMsg.content };
      case 'tool_result':
        return {
          role: 'tool',
          content: dbMsg.content,
          tool_call_id: dbMsg.tool_name ?? undefined,
        };
      default:
        if (dbMsg.source.startsWith('external:')) {
          return {
            role: 'user',
            content: formatExternalMessage(
              dbMsg.source.replace('external:', ''),
              dbMsg.content
            ),
          };
        }
        return null;
    }
  }

  function loadHistory() {
    const dbMessages = getAllMessages();
    messages = [{ role: 'system', content: SYSTEM_PROMPT }];

    const session = getCurrentSession();
    if (session?.handoff_summary) {
      messages.push({
        role: 'system',
        content: formatSessionHandoff(session.handoff_summary),
      });
    }

    for (const dbMsg of dbMessages) {
      const chatMsg = dbToChat(dbMsg);
      if (chatMsg) {
        messages.push(chatMsg);
      }
    }
  }

  function checkContextPressure() {
    const pressure = getContextPressure(messages);

    // Broadcast current pressure to UI
    broadcastContextPressure({
      tokens: pressure.tokens,
      maxTokens: getContextSize(),
      ratio: pressure.ratio,
      level: pressure.level,
    });

    if (pressure.level === 'hard') {
      const warningMsg = addMessage('system', CONTEXT_PRESSURE_WARNING);
      broadcastMessage(warningMsg);
      messages.push({ role: 'system', content: CONTEXT_PRESSURE_WARNING });

      setTimeout(() => {
        performCompaction();
      }, 5000);
    } else if (pressure.level === 'soft') {
      messages = [messages[0]!, ...compactMessages(messages.slice(1))];
    }
  }

  function performCompaction() {
    const summary = createHandoffSummary(messages);
    endCurrentSession();
    const newSession = startSession(summary);

    messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'system', content: formatSessionHandoff(summary) },
    ];

    const dividerMsg = addMessage('system', `--- Session ${newSession.id} ---`);
    broadcastMessage(dividerMsg);
  }

  async function runAgentTurn(): Promise<boolean> {
    checkContextPressure();

    const streamingId = Date.now();
    let fullContent = '';
    let fullReasoning = '';

    try {
      const { message: assistantMessage, usage } = await streamCompletion(
        messages,
        toolDefinitions,
        (chunk) => {
          if (chunk.content) {
            fullContent += chunk.content;
            broadcastToken(streamingId, chunk.content);
          }
          if (chunk.reasoning) {
            fullReasoning += chunk.reasoning;
            broadcastReasoning(streamingId, chunk.reasoning);
          }
        }
      );

      // Reset error counter on success
      consecutiveErrors = 0;

      // Broadcast accurate context pressure using actual token counts if available
      if (usage) {
        const ratio = usage.prompt_tokens / getContextSize();
        let level: 'normal' | 'soft' | 'hard' = 'normal';
        if (ratio >= 0.9) level = 'hard';
        else if (ratio >= 0.7) level = 'soft';

        broadcastContextPressure({
          tokens: usage.prompt_tokens,
          maxTokens: getContextSize(),
          ratio,
          level,
        });
      }

      messages.push(assistantMessage);

      // Save reasoning as a separate message if present
      if (fullReasoning) {
        const reasoningMsg = addMessage('reasoning', fullReasoning);
        broadcastMessage(reasoningMsg);
      }

      if (assistantMessage.content) {
        const savedMsg = addMessage('assistant', assistantMessage.content);
        broadcastMessage(savedMsg);
      }

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name;
          let toolInput: Record<string, unknown>;

          try {
            // Use jsonrepair to fix common LLM JSON issues (unescaped newlines, missing quotes, etc)
            const repaired = jsonrepair(toolCall.function.arguments);
            toolInput = JSON.parse(repaired);
          } catch {
            toolInput = {};
          }

          const toolCallMsg = addMessage(
            'tool_call',
            `Calling ${toolName}`,
            toolName,
            JSON.stringify(toolInput, null, 2)
          );
          broadcastMessage(toolCallMsg);

          const result = await executeTool(toolName, toolInput, {
            onInterrupt: () => pendingInterrupt,
          });

          const toolResultMsg = addMessage('tool_result', result, toolCall.id);
          broadcastMessage(toolResultMsg);

          messages.push({
            role: 'tool',
            content: result,
            tool_call_id: toolCall.id,
          });
        }

        return true;
      }

      return false;
    } catch (err) {
      consecutiveErrors++;
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('Agent turn error:', errorMessage);

      // Show error to user
      const errorMsg = addMessage('system', `Error: ${errorMessage}`);
      broadcastMessage(errorMsg);

      // If we haven't hit max errors, add error context and let the agent try to recover
      if (consecutiveErrors < MAX_CONSECUTIVE_ERRORS) {
        // Add a user message explaining the error so the model can adapt
        const recoveryPrompt = `[System: The previous response caused an error: "${errorMessage}". Please try again with a simpler approach. If you were trying to use a tool, make sure to format the tool call correctly as JSON.]`;
        messages.push({ role: 'user', content: recoveryPrompt });

        // Brief pause before retry
        await Bun.sleep(1000);
        return true; // Continue the loop to let the model try again
      } else {
        // Too many consecutive errors, break the loop
        const breakMsg = addMessage(
          'system',
          `Too many consecutive errors (${consecutiveErrors}). Pausing agent loop. Send a message to resume.`
        );
        broadcastMessage(breakMsg);
        consecutiveErrors = 0;
        return false;
      }
    }
  }

  async function conversationalLoop() {
    while (running) {
      const mode = getState<Mode>('mode', 'conversational');
      if (mode !== 'conversational') {
        break; // Return to mainLoop to switch to autonomousLoop
      }

      if (pendingUserMessages.length === 0) {
        await Bun.sleep(100);
        continue;
      }

      const userContent = pendingUserMessages.shift()!;
      const userMsg = addMessage('user', userContent);
      broadcastMessage(userMsg);
      messages.push({ role: 'user', content: userContent });

      // Reset error counter when user sends a message
      consecutiveErrors = 0;

      let continueLoop = true;
      while (continueLoop && running) {
        continueLoop = await runAgentTurn();

        // Check if mode changed mid-loop
        const currentMode = getState<Mode>('mode', 'conversational');
        if (currentMode !== 'conversational') {
          break;
        }
      }
    }
  }

  async function autonomousLoop() {
    while (running) {
      const mode = getState<Mode>('mode', 'conversational');
      if (mode !== 'autonomous') {
        break; // Return to mainLoop to switch to conversationalLoop
      }

      // Handle any pending user messages first
      if (pendingUserMessages.length > 0) {
        const userContent = pendingUserMessages.shift()!;
        const userMsg = addMessage('user', userContent);
        broadcastMessage(userMsg);
        messages.push({ role: 'user', content: userContent });
        consecutiveErrors = 0; // Reset on user message
      } else {
        // Always add nudge in autonomous mode to keep the loop going
        messages.push({ role: 'user', content: AUTONOMOUS_NUDGE });
      }

      let continueLoop = true;
      while (continueLoop && running) {
        continueLoop = await runAgentTurn();

        // Check if mode changed mid-loop
        const currentMode = getState<Mode>('mode', 'conversational');
        if (currentMode !== 'autonomous') {
          break;
        }
      }

      // Only wait for delay if still in autonomous mode
      const currentMode = getState<Mode>('mode', 'conversational');
      if (currentMode !== 'autonomous') {
        break; // Return to mainLoop to switch to conversationalLoop
      }

      const delay = getState<number | 'infinite'>('delay', 5);

      if (delay === 'infinite') {
        await new Promise<void>((resolve) => {
          stepSignal = resolve;
        });
        stepSignal = null;
      } else if (delay > 0) {
        await Bun.sleep(delay * 1000);
      }
    }
  }

  async function mainLoop() {
    loadHistory();

    while (running) {
      const mode = getState<Mode>('mode', 'conversational');

      try {
        if (mode === 'conversational') {
          await conversationalLoop();
        } else {
          await autonomousLoop();
        }
      } catch (err) {
        console.error('Loop error:', err);
        // Don't crash, just log and continue
        await Bun.sleep(1000);
      }
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      mainLoop().catch((err) => {
        console.error('Main loop error:', err);
        running = false;
      });
    },

    stop() {
      running = false;
    },

    handleWebSocketMessage(msg: WebSocketMessage) {
      switch (msg.type) {
        case 'user_message':
          if (msg.content) {
            pendingUserMessages.push(msg.content);
            pendingInterrupt = true;
            setTimeout(() => {
              pendingInterrupt = false;
            }, 100);
          }
          break;

        case 'step':
          if (stepSignal) {
            stepSignal();
          }
          break;

        case 'set_mode':
        case 'set_delay':
          // These are handled by the server directly
          break;
      }
    },
  };
}
