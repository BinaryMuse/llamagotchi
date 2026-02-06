export interface Message {
  id: number;
  source: string;
  content: string;
  tool_name: string | null;
  tool_input: string | null;
  timestamp: number;
  metadata: string | null;
}

export interface Notable {
  id: number;
  label: string;
  content: string;
  reason: string | null;
  timestamp: number;
  message_id: number | null;
}

export interface AgentState {
  mode: 'conversational' | 'autonomous';
  delay: number | 'infinite';
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface ContextPressure {
  tokens: number;
  maxTokens: number;
  ratio: number;
  level: 'normal' | 'soft' | 'hard';
}

export interface FsmState {
  state: string;
  turnNumber: number;
}

export interface WSMessage {
  type: 'message' | 'token' | 'reasoning' | 'state' | 'notable' | 'context_pressure' | 'fsm_state';
  data: unknown;
}
