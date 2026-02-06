import type { ChatMessage, Usage, ToolCall } from '../llm/client.ts';

// =============================================================================
// State
// =============================================================================

export type State =
  | { type: 'idle' }
  | { type: 'streaming'; streamId: number }
  | { type: 'executing_tools'; toolCalls: ToolCall[]; currentIndex: number }
  | { type: 'waiting_delay'; delayMs: number }
  | { type: 'waiting_step' };

// =============================================================================
// Context (mutable conversation state, separate from FSM state)
// =============================================================================

export interface Context {
  messages: ChatMessage[];
  mode: 'conversational' | 'autonomous';
  delay: number | 'infinite';
  queuedUserMessages: string[];
  consecutiveErrors: number;
  turnNumber: number;
  currentResponse: {
    content: string;
    reasoning: string;
  };
}

export function createContext(initialMessages: ChatMessage[] = []): Context {
  return {
    messages: initialMessages,
    mode: 'conversational',
    delay: 5,
    queuedUserMessages: [],
    consecutiveErrors: 0,
    turnNumber: 0,
    currentResponse: { content: '', reasoning: '' },
  };
}

// =============================================================================
// Events (inputs to the FSM)
// =============================================================================

export type Event =
  | { type: 'user_message'; content: string }
  | { type: 'external_message'; source: string; content: string }
  | { type: 'autonomous_tick' }
  | { type: 'stream_start'; streamId: number }
  | { type: 'stream_chunk'; content?: string; reasoning?: string }
  | { type: 'stream_end'; message: ChatMessage; usage: Usage | null }
  | { type: 'stream_error'; error: string }
  | { type: 'tool_result'; toolCallId: string; result: string }
  | { type: 'all_tools_complete' }
  | { type: 'mode_changed'; mode: 'conversational' | 'autonomous' }
  | { type: 'delay_changed'; delay: number | 'infinite' }
  | { type: 'step' }
  | { type: 'delay_elapsed' };

// =============================================================================
// Effects (outputs from the FSM that the executor must handle)
// =============================================================================

export type Effect =
  | { type: 'start_stream' }
  | { type: 'emit_token'; streamId: number; token: string }
  | { type: 'emit_reasoning'; streamId: number; reasoning: string }
  | { type: 'execute_tool'; name: string; input: Record<string, unknown>; toolCallId: string }
  | { type: 'save_message'; source: string; content: string; toolName?: string; toolInput?: string }
  | { type: 'broadcast_message'; source: string; content: string; toolName?: string; toolInput?: string }
  | { type: 'update_context_pressure'; tokens: number; maxTokens: number; ratio: number; level: 'normal' | 'soft' | 'hard' }
  | { type: 'schedule_delay'; delayMs: number }
  | { type: 'wait_for_step' }
  | { type: 'check_context_pressure' }
  | { type: 'log_error'; error: string }
  | { type: 'broadcast_fsm_state'; fsmState: string; turnNumber: number };

// =============================================================================
// Transition Result
// =============================================================================

export interface TransitionResult {
  state: State;
  context: Context;
  effects: Effect[];
}

// =============================================================================
// Pure FSM Transition Function
// =============================================================================

export function transition(
  state: State,
  context: Context,
  event: Event
): TransitionResult {
  const effects: Effect[] = [];

  let result: TransitionResult;

  switch (state.type) {
    case 'idle':
      result = handleIdle(state, context, event, effects);
      break;

    case 'streaming':
      result = handleStreaming(state, context, event, effects);
      break;

    case 'executing_tools':
      result = handleExecutingTools(state, context, event, effects);
      break;

    case 'waiting_delay':
      result = handleWaitingDelay(state, context, event, effects);
      break;

    case 'waiting_step':
      result = handleWaitingStep(state, context, event, effects);
      break;
  }

  // Broadcast state change if state type changed
  if (result.state.type !== state.type) {
    result.effects.push({
      type: 'broadcast_fsm_state',
      fsmState: result.state.type,
      turnNumber: result.context.turnNumber,
    });
  }

  return result;
}

// =============================================================================
// State Handlers
// =============================================================================

function handleIdle(
  _state: State,
  context: Context,
  event: Event,
  effects: Effect[]
): TransitionResult {
  switch (event.type) {
    case 'user_message': {
      // Add user message to context and start streaming
      const newContext = {
        ...context,
        messages: [...context.messages, { role: 'user' as const, content: event.content }],
        consecutiveErrors: 0,
        turnNumber: context.turnNumber + 1,
        currentResponse: { content: '', reasoning: '' },
      };

      effects.push({ type: 'save_message', source: 'user', content: event.content });
      effects.push({ type: 'broadcast_message', source: 'user', content: event.content });
      effects.push({ type: 'check_context_pressure' });
      effects.push({ type: 'start_stream' });

      return {
        state: { type: 'streaming', streamId: Date.now() },
        context: newContext,
        effects,
      };
    }

    case 'external_message': {
      const formattedContent = `[External message from ${event.source}]\n${event.content}`;
      const newContext = {
        ...context,
        messages: [...context.messages, { role: 'user' as const, content: formattedContent }],
        consecutiveErrors: 0,
        turnNumber: context.turnNumber + 1,
        currentResponse: { content: '', reasoning: '' },
      };

      effects.push({ type: 'save_message', source: `external:${event.source}`, content: event.content });
      effects.push({ type: 'broadcast_message', source: `external:${event.source}`, content: event.content });
      effects.push({ type: 'check_context_pressure' });
      effects.push({ type: 'start_stream' });

      return {
        state: { type: 'streaming', streamId: Date.now() },
        context: newContext,
        effects,
      };
    }

    case 'autonomous_tick': {
      if (context.mode !== 'autonomous') {
        return { state: { type: 'idle' }, context, effects };
      }

      // Check for queued user messages first
      if (context.queuedUserMessages.length > 0) {
        const [content, ...rest] = context.queuedUserMessages;
        const newContext = {
          ...context,
          messages: [...context.messages, { role: 'user' as const, content: content! }],
          queuedUserMessages: rest,
          consecutiveErrors: 0,
          turnNumber: context.turnNumber + 1,
          currentResponse: { content: '', reasoning: '' },
        };

        effects.push({ type: 'save_message', source: 'user', content: content! });
        effects.push({ type: 'broadcast_message', source: 'user', content: content! });
        effects.push({ type: 'check_context_pressure' });
        effects.push({ type: 'start_stream' });

        return {
          state: { type: 'streaming', streamId: Date.now() },
          context: newContext,
          effects,
        };
      }

      // Add autonomous nudge
      const nudge = 'You are running in autonomous mode. Continue pursuing your own goals.\n\nWhat would you like to do next?';
      const newContext = {
        ...context,
        messages: [...context.messages, { role: 'user' as const, content: nudge }],
        turnNumber: context.turnNumber + 1,
        currentResponse: { content: '', reasoning: '' },
      };

      effects.push({ type: 'check_context_pressure' });
      effects.push({ type: 'start_stream' });

      return {
        state: { type: 'streaming', streamId: Date.now() },
        context: newContext,
        effects,
      };
    }

    case 'mode_changed': {
      const newContext = { ...context, mode: event.mode };
      // If switching to autonomous, trigger a tick
      if (event.mode === 'autonomous') {
        return transition({ type: 'idle' }, newContext, { type: 'autonomous_tick' });
      }
      return { state: { type: 'idle' }, context: newContext, effects };
    }

    case 'delay_changed': {
      return { state: { type: 'idle' }, context: { ...context, delay: event.delay }, effects };
    }

    default:
      // Queue user messages that arrive in other states
      if (event.type === 'user_message') {
        return {
          state: { type: 'idle' },
          context: { ...context, queuedUserMessages: [...context.queuedUserMessages, event.content] },
          effects,
        };
      }
      return { state: { type: 'idle' }, context, effects };
  }
}

function handleStreaming(
  state: Extract<State, { type: 'streaming' }>,
  context: Context,
  event: Event,
  effects: Effect[]
): TransitionResult {
  switch (event.type) {
    case 'stream_chunk': {
      const newResponse = { ...context.currentResponse };

      if (event.content) {
        newResponse.content += event.content;
        effects.push({ type: 'emit_token', streamId: state.streamId, token: event.content });
      }
      if (event.reasoning) {
        newResponse.reasoning += event.reasoning;
        effects.push({ type: 'emit_reasoning', streamId: state.streamId, reasoning: event.reasoning });
      }

      return {
        state,
        context: { ...context, currentResponse: newResponse },
        effects,
      };
    }

    case 'stream_end': {
      const newContext = {
        ...context,
        messages: [...context.messages, event.message],
        consecutiveErrors: 0,
      };

      // Save reasoning if present
      if (context.currentResponse.reasoning) {
        effects.push({
          type: 'save_message',
          source: 'reasoning',
          content: context.currentResponse.reasoning,
        });
        effects.push({
          type: 'broadcast_message',
          source: 'reasoning',
          content: context.currentResponse.reasoning,
        });
      }

      // Save assistant message if present
      if (event.message.content) {
        effects.push({
          type: 'save_message',
          source: 'assistant',
          content: event.message.content,
        });
        effects.push({
          type: 'broadcast_message',
          source: 'assistant',
          content: event.message.content,
        });
      }

      // Update context pressure with actual usage
      if (event.usage) {
        const maxTokens = 128000; // Will be injected by executor
        const ratio = event.usage.prompt_tokens / maxTokens;
        let level: 'normal' | 'soft' | 'hard' = 'normal';
        if (ratio >= 0.9) level = 'hard';
        else if (ratio >= 0.7) level = 'soft';

        effects.push({
          type: 'update_context_pressure',
          tokens: event.usage.prompt_tokens,
          maxTokens,
          ratio,
          level,
        });
      }

      // Check for tool calls
      if (event.message.tool_calls && event.message.tool_calls.length > 0) {
        return {
          state: { type: 'executing_tools', toolCalls: event.message.tool_calls, currentIndex: 0 },
          context: newContext,
          effects,
        };
      }

      // No tool calls - determine next state based on mode
      return transitionToPostTurn(newContext, effects);
    }

    case 'stream_error': {
      const newConsecutiveErrors = context.consecutiveErrors + 1;
      effects.push({ type: 'log_error', error: event.error });
      effects.push({ type: 'save_message', source: 'system', content: `Error: ${event.error}` });
      effects.push({ type: 'broadcast_message', source: 'system', content: `Error: ${event.error}` });

      if (newConsecutiveErrors < 3) {
        // Add recovery prompt and retry
        const recoveryPrompt = `[System: The previous response caused an error: "${event.error}". Please try again with a simpler approach.]`;
        const newContext = {
          ...context,
          messages: [...context.messages, { role: 'user' as const, content: recoveryPrompt }],
          consecutiveErrors: newConsecutiveErrors,
          currentResponse: { content: '', reasoning: '' },
        };

        effects.push({ type: 'start_stream' });
        return {
          state: { type: 'streaming', streamId: Date.now() },
          context: newContext,
          effects,
        };
      }

      // Too many errors - go idle
      effects.push({
        type: 'save_message',
        source: 'system',
        content: `Too many consecutive errors (${newConsecutiveErrors}). Pausing. Send a message to resume.`,
      });
      effects.push({
        type: 'broadcast_message',
        source: 'system',
        content: `Too many consecutive errors (${newConsecutiveErrors}). Pausing. Send a message to resume.`,
      });

      return {
        state: { type: 'idle' },
        context: { ...context, consecutiveErrors: 0 },
        effects,
      };
    }

    case 'user_message': {
      // Queue the message for after current operation
      return {
        state,
        context: { ...context, queuedUserMessages: [...context.queuedUserMessages, event.content] },
        effects,
      };
    }

    case 'mode_changed': {
      return { state, context: { ...context, mode: event.mode }, effects };
    }

    case 'delay_changed': {
      return { state, context: { ...context, delay: event.delay }, effects };
    }

    default:
      return { state, context, effects };
  }
}

function handleExecutingTools(
  state: Extract<State, { type: 'executing_tools' }>,
  context: Context,
  event: Event,
  effects: Effect[]
): TransitionResult {
  switch (event.type) {
    case 'tool_result': {
      // Add tool result to messages
      const newContext = {
        ...context,
        messages: [
          ...context.messages,
          { role: 'tool' as const, content: event.result, tool_call_id: event.toolCallId },
        ],
      };

      // Move to next tool or complete
      const nextIndex = state.currentIndex + 1;
      if (nextIndex < state.toolCalls.length) {
        return {
          state: { ...state, currentIndex: nextIndex },
          context: newContext,
          effects,
        };
      }

      // All tools done - continue with another turn
      effects.push({ type: 'check_context_pressure' });
      effects.push({ type: 'start_stream' });

      return {
        state: { type: 'streaming', streamId: Date.now() },
        context: { ...newContext, currentResponse: { content: '', reasoning: '' } },
        effects,
      };
    }

    case 'user_message': {
      return {
        state,
        context: { ...context, queuedUserMessages: [...context.queuedUserMessages, event.content] },
        effects,
      };
    }

    case 'mode_changed': {
      return { state, context: { ...context, mode: event.mode }, effects };
    }

    case 'delay_changed': {
      return { state, context: { ...context, delay: event.delay }, effects };
    }

    default:
      return { state, context, effects };
  }
}

function handleWaitingDelay(
  state: Extract<State, { type: 'waiting_delay' }>,
  context: Context,
  event: Event,
  effects: Effect[]
): TransitionResult {
  switch (event.type) {
    case 'delay_elapsed': {
      return transition({ type: 'idle' }, context, { type: 'autonomous_tick' });
    }

    case 'user_message': {
      // User message interrupts delay - process immediately
      return transition({ type: 'idle' }, context, event);
    }

    case 'mode_changed': {
      if (event.mode === 'conversational') {
        return { state: { type: 'idle' }, context: { ...context, mode: event.mode }, effects };
      }
      return { state, context: { ...context, mode: event.mode }, effects };
    }

    case 'delay_changed': {
      return { state, context: { ...context, delay: event.delay }, effects };
    }

    default:
      return { state, context, effects };
  }
}

function handleWaitingStep(
  _state: State,
  context: Context,
  event: Event,
  effects: Effect[]
): TransitionResult {
  switch (event.type) {
    case 'step': {
      return transition({ type: 'idle' }, context, { type: 'autonomous_tick' });
    }

    case 'user_message': {
      // User message interrupts wait - process immediately
      return transition({ type: 'idle' }, context, event);
    }

    case 'mode_changed': {
      if (event.mode === 'conversational') {
        return { state: { type: 'idle' }, context: { ...context, mode: event.mode }, effects };
      }
      return { state: { type: 'waiting_step' }, context: { ...context, mode: event.mode }, effects };
    }

    case 'delay_changed': {
      const newContext = { ...context, delay: event.delay };
      // If delay changed from infinite, start the delay timer
      if (event.delay !== 'infinite') {
        effects.push({ type: 'schedule_delay', delayMs: event.delay * 1000 });
        return { state: { type: 'waiting_delay', delayMs: event.delay * 1000 }, context: newContext, effects };
      }
      return { state: { type: 'waiting_step' }, context: newContext, effects };
    }

    default:
      return { state: { type: 'waiting_step' }, context, effects };
  }
}

// =============================================================================
// Helper: Transition to post-turn state
// =============================================================================

function transitionToPostTurn(context: Context, effects: Effect[]): TransitionResult {
  // Check for queued messages first
  if (context.queuedUserMessages.length > 0) {
    const [content, ...rest] = context.queuedUserMessages;
    return transition(
      { type: 'idle' },
      { ...context, queuedUserMessages: rest },
      { type: 'user_message', content: content! }
    );
  }

  // In conversational mode, go idle
  if (context.mode === 'conversational') {
    return { state: { type: 'idle' }, context, effects };
  }

  // In autonomous mode, schedule next turn
  if (context.delay === 'infinite') {
    effects.push({ type: 'wait_for_step' });
    return { state: { type: 'waiting_step' }, context, effects };
  }

  if (context.delay > 0) {
    effects.push({ type: 'schedule_delay', delayMs: context.delay * 1000 });
    return { state: { type: 'waiting_delay', delayMs: context.delay * 1000 }, context, effects };
  }

  // No delay - immediate next tick
  return transition({ type: 'idle' }, context, { type: 'autonomous_tick' });
}
