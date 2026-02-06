import type { ChatMessage } from '../llm/client.ts';
import { streamCompletion } from '../llm/client.ts';
import { jsonrepair } from 'jsonrepair';
import { toolDefinitions, executeTool } from './tools/index.ts';
import {
  getSystemPrompt,
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
  broadcastFsmState,
} from '../server/websocket.ts';
import {
  getContextPressure,
  compactMessages,
  createHandoffSummary,
  getContextSize,
} from '../llm/context.ts';
import {
  transition,
  createContext,
  type State,
  type Context,
  type Event,
  type Effect,
} from './fsm.ts';
import type { WebSocketMessage } from '../server/index.ts';

// =============================================================================
// Agent Session - Effect Executor wrapping the FSM
// =============================================================================

export interface AgentSession {
  start(): void;
  stop(): void;
  handleWebSocketMessage(msg: WebSocketMessage): void;
}

export function createAgentSession(): AgentSession {
  let running = false;
  let state: State = { type: 'idle' };
  let context: Context = createContext();
  let delayTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingInterrupt = false;

  // =========================================================================
  // Initialization
  // =========================================================================

  function loadHistory(): ChatMessage[] {
    const dbMessages = getAllMessages();
    const messages: ChatMessage[] = [{ role: 'system', content: getSystemPrompt() }];

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

    return messages;
  }

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
            content: `[External message from ${dbMsg.source.replace('external:', '')}]\n${dbMsg.content}`,
          };
        }
        return null;
    }
  }

  // =========================================================================
  // Event Dispatch
  // =========================================================================

  function dispatch(event: Event): void {
    if (!running && event.type !== 'user_message') return;

    const result = transition(state, context, event);
    state = result.state;
    context = result.context;

    // Execute effects
    for (const effect of result.effects) {
      executeEffect(effect);
    }
  }

  // =========================================================================
  // Effect Execution
  // =========================================================================

  function executeEffect(effect: Effect): void {
    switch (effect.type) {
      case 'start_stream':
        startStream();
        break;

      case 'emit_token':
        broadcastToken(effect.streamId, effect.token);
        break;

      case 'emit_reasoning':
        broadcastReasoning(effect.streamId, effect.reasoning);
        break;

      case 'execute_tool':
        executeToolEffect(effect.name, effect.input, effect.toolCallId);
        break;

      case 'save_message': {
        const msg = addMessage(effect.source, effect.content, effect.toolName, effect.toolInput);
        // Note: we don't broadcast here since broadcast_message effect handles that
        break;
      }

      case 'broadcast_message': {
        // Create a message-like object for broadcasting
        const msg = addMessage(effect.source, effect.content, effect.toolName, effect.toolInput);
        broadcastMessage(msg);
        break;
      }

      case 'update_context_pressure':
        broadcastContextPressure({
          tokens: effect.tokens,
          maxTokens: effect.maxTokens,
          ratio: effect.ratio,
          level: effect.level,
        });
        break;

      case 'schedule_delay':
        if (delayTimer) clearTimeout(delayTimer);
        delayTimer = setTimeout(() => {
          delayTimer = null;
          dispatch({ type: 'delay_elapsed' });
        }, effect.delayMs);
        break;

      case 'wait_for_step':
        // Nothing to do - we just wait in the waiting_step state
        break;

      case 'check_context_pressure':
        checkAndHandleContextPressure();
        break;

      case 'log_error':
        console.error('Agent error:', effect.error);
        break;

      case 'broadcast_fsm_state':
        broadcastFsmState({
          state: effect.fsmState,
          turnNumber: effect.turnNumber,
        });
        break;
    }
  }

  // =========================================================================
  // Stream Handling
  // =========================================================================

  async function startStream(): Promise<void> {
    const streamId = Date.now();
    dispatch({ type: 'stream_start', streamId });

    try {
      const { message, usage } = await streamCompletion(
        context.messages,
        toolDefinitions,
        (chunk) => {
          if (chunk.content) {
            dispatch({ type: 'stream_chunk', content: chunk.content });
          }
          if (chunk.reasoning) {
            dispatch({ type: 'stream_chunk', reasoning: chunk.reasoning });
          }
        }
      );

      dispatch({ type: 'stream_end', message, usage });

      // If there are tool calls, start executing them
      if (message.tool_calls && message.tool_calls.length > 0 && state.type === 'executing_tools') {
        await executeToolsSequentially(message.tool_calls);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      dispatch({ type: 'stream_error', error: errorMessage });
    }
  }

  // =========================================================================
  // Tool Execution
  // =========================================================================

  async function executeToolsSequentially(toolCalls: ChatMessage['tool_calls']): Promise<void> {
    if (!toolCalls) return;

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      let toolInput: Record<string, unknown>;

      try {
        const repaired = jsonrepair(toolCall.function.arguments);
        toolInput = JSON.parse(repaired);
      } catch {
        toolInput = {};
      }

      // Broadcast tool call
      const toolCallMsg = addMessage(
        'tool_call',
        `Calling ${toolName}`,
        toolName,
        JSON.stringify(toolInput, null, 2)
      );
      broadcastMessage(toolCallMsg);

      // Execute tool
      const result = await executeTool(toolName, toolInput, {
        onInterrupt: () => pendingInterrupt,
      });

      // Broadcast tool result
      const toolResultMsg = addMessage('tool_result', result, toolCall.id);
      broadcastMessage(toolResultMsg);

      // Dispatch result to FSM
      dispatch({ type: 'tool_result', toolCallId: toolCall.id, result });
    }
  }

  async function executeToolEffect(
    name: string,
    input: Record<string, unknown>,
    toolCallId: string
  ): Promise<void> {
    const result = await executeTool(name, input, {
      onInterrupt: () => pendingInterrupt,
    });

    dispatch({ type: 'tool_result', toolCallId, result });
  }

  // =========================================================================
  // Context Pressure Management
  // =========================================================================

  function checkAndHandleContextPressure(): void {
    const pressure = getContextPressure(context.messages);

    broadcastContextPressure({
      tokens: pressure.tokens,
      maxTokens: getContextSize(),
      ratio: pressure.ratio,
      level: pressure.level,
    });

    if (pressure.level === 'hard') {
      const warningContent = `[System Notice] Context pressure is becoming critical. You should persist any important information now using your tools (filesystem, notable) before context compaction occurs.`;
      const warningMsg = addMessage('system', warningContent);
      broadcastMessage(warningMsg);
      context.messages.push({ role: 'system', content: warningContent });

      // Schedule compaction
      setTimeout(() => {
        performCompaction();
      }, 5000);
    } else if (pressure.level === 'soft') {
      // Soft compaction - summarize old messages
      context.messages = [context.messages[0]!, ...compactMessages(context.messages.slice(1))];
    }
  }

  function performCompaction(): void {
    const summary = createHandoffSummary(context.messages);
    endCurrentSession();
    const newSession = startSession(summary);

    context.messages = [
      { role: 'system', content: getSystemPrompt() },
      { role: 'system', content: formatSessionHandoff(summary) },
    ];

    const dividerMsg = addMessage('system', `--- Session ${newSession.id} ---`);
    broadcastMessage(dividerMsg);
  }

  // =========================================================================
  // Sync mode/delay from database state
  // =========================================================================

  function syncStateFromDb(): void {
    const mode = getState<'conversational' | 'autonomous'>('mode', 'conversational');
    const delay = getState<number | 'infinite'>('delay', 5);

    if (mode !== context.mode) {
      dispatch({ type: 'mode_changed', mode });
    }
    if (delay !== context.delay) {
      dispatch({ type: 'delay_changed', delay });
    }
  }

  // =========================================================================
  // Main Loop (polls for state changes)
  // =========================================================================

  async function mainLoop(): Promise<void> {
    while (running) {
      syncStateFromDb();
      await Bun.sleep(100);
    }
  }

  // =========================================================================
  // Public Interface
  // =========================================================================

  return {
    start() {
      if (running) return;
      running = true;

      // Load history and initialize context
      const messages = loadHistory();
      context = createContext(messages);

      // Sync initial state
      context.mode = getState<'conversational' | 'autonomous'>('mode', 'conversational');
      context.delay = getState<number | 'infinite'>('delay', 5);

      // Start main loop
      mainLoop().catch((err) => {
        console.error('Main loop error:', err);
        running = false;
      });

      // If starting in autonomous mode, kick off the first tick
      if (context.mode === 'autonomous') {
        dispatch({ type: 'autonomous_tick' });
      }
    },

    stop() {
      running = false;
      if (delayTimer) {
        clearTimeout(delayTimer);
        delayTimer = null;
      }
    },

    handleWebSocketMessage(msg: WebSocketMessage) {
      switch (msg.type) {
        case 'user_message':
          if (msg.content) {
            pendingInterrupt = true;
            setTimeout(() => {
              pendingInterrupt = false;
            }, 100);
            dispatch({ type: 'user_message', content: msg.content });
          }
          break;

        case 'step':
          dispatch({ type: 'step' });
          break;

        case 'set_mode':
        case 'set_delay':
          // These are handled by the server directly, we pick them up in syncStateFromDb
          break;
      }
    },
  };
}
