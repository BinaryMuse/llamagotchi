import { getDb } from './index.ts';
import type { Database, Statement } from 'bun:sqlite';

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

export interface BackgroundTask {
  id: string;
  tool_name: string;
  input: string;
  status: 'running' | 'completed' | 'failed';
  result: string | null;
  error: string | null;
  created_at: number;
  completed_at: number | null;
}

export interface Session {
  id: number;
  started_at: number;
  handoff_summary: string | null;
  ended_at: number | null;
}

type PreparedStatements = {
  insertMessage: Statement<Message, [string, string, string | null, string | null, number, string | null]>;
  selectAllMessages: Statement<Message, []>;
  selectRecentMessages: Statement<Message, [number]>;
  insertNotable: Statement<Notable, [string, string, string | null, number, number | null]>;
  selectAllNotables: Statement<Notable, []>;
  insertBackgroundTask: Statement<BackgroundTask, [string, string, string, string, number]>;
  updateBackgroundTask: Statement<BackgroundTask, [string, string | null, string | null, number, string]>;
  selectBackgroundTask: Statement<BackgroundTask, [string]>;
  getStateValue: Statement<{ value: string }, [string]>;
  upsertState: Statement<unknown, [string, string]>;
  insertSession: Statement<Session, [number, string | null]>;
  updateSessionEnded: Statement<Session, [number, number]>;
  selectCurrentSession: Statement<Session, []>;
};

let _statements: PreparedStatements | null = null;

function getStatements(): PreparedStatements {
  if (_statements) return _statements;

  const db = getDb();

  _statements = {
    insertMessage: db.prepare(
      `INSERT INTO messages (source, content, tool_name, tool_input, timestamp, metadata) VALUES (?, ?, ?, ?, ?, ?)`
    ),
    selectAllMessages: db.prepare(`SELECT * FROM messages ORDER BY timestamp ASC`),
    selectRecentMessages: db.prepare(`SELECT * FROM messages ORDER BY timestamp DESC LIMIT ?`),
    insertNotable: db.prepare(
      `INSERT INTO notables (label, content, reason, timestamp, message_id) VALUES (?, ?, ?, ?, ?)`
    ),
    selectAllNotables: db.prepare(`SELECT * FROM notables ORDER BY timestamp DESC`),
    insertBackgroundTask: db.prepare(
      `INSERT INTO background_tasks (id, tool_name, input, status, created_at) VALUES (?, ?, ?, ?, ?)`
    ),
    updateBackgroundTask: db.prepare(
      `UPDATE background_tasks SET status = ?, result = ?, error = ?, completed_at = ? WHERE id = ?`
    ),
    selectBackgroundTask: db.prepare(`SELECT * FROM background_tasks WHERE id = ?`),
    getStateValue: db.prepare(`SELECT value FROM state WHERE key = ?`),
    upsertState: db.prepare(
      `INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ),
    insertSession: db.prepare(`INSERT INTO sessions (started_at, handoff_summary) VALUES (?, ?)`),
    updateSessionEnded: db.prepare(`UPDATE sessions SET ended_at = ? WHERE id = ?`),
    selectCurrentSession: db.prepare(
      `SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1`
    ),
  };

  return _statements;
}

export function addMessage(
  source: string,
  content: string,
  toolName?: string,
  toolInput?: string,
  metadata?: Record<string, unknown>
): Message {
  const timestamp = Date.now();
  const result = getStatements().insertMessage.run(
    source,
    content,
    toolName ?? null,
    toolInput ?? null,
    timestamp,
    metadata ? JSON.stringify(metadata) : null
  );
  return {
    id: Number(result.lastInsertRowid),
    source,
    content,
    tool_name: toolName ?? null,
    tool_input: toolInput ?? null,
    timestamp,
    metadata: metadata ? JSON.stringify(metadata) : null,
  };
}

export function getAllMessages(): Message[] {
  return getStatements().selectAllMessages.all();
}

export function getRecentMessages(limit: number): Message[] {
  return getStatements().selectRecentMessages.all(limit).reverse();
}

export function addNotable(
  label: string,
  content: string,
  reason?: string,
  messageId?: number
): Notable {
  const timestamp = Date.now();
  const result = getStatements().insertNotable.run(
    label,
    content,
    reason ?? null,
    timestamp,
    messageId ?? null
  );
  return {
    id: Number(result.lastInsertRowid),
    label,
    content,
    reason: reason ?? null,
    timestamp,
    message_id: messageId ?? null,
  };
}

export function getAllNotables(): Notable[] {
  return getStatements().selectAllNotables.all();
}

export function createBackgroundTask(toolName: string, input: Record<string, unknown>): string {
  const id = crypto.randomUUID();
  const now = Date.now();
  getStatements().insertBackgroundTask.run(id, toolName, JSON.stringify(input), 'running', now);
  return id;
}

export function completeBackgroundTask(id: string, result: string) {
  getStatements().updateBackgroundTask.run('completed', result, null, Date.now(), id);
}

export function failBackgroundTask(id: string, error: string) {
  getStatements().updateBackgroundTask.run('failed', null, error, Date.now(), id);
}

export function getBackgroundTask(id: string): BackgroundTask | null {
  return getStatements().selectBackgroundTask.get(id) ?? null;
}

export function getState<T>(key: string, defaultValue: T): T {
  const row = getStatements().getStateValue.get(key);
  if (!row) return defaultValue;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return defaultValue;
  }
}

export function setState<T>(key: string, value: T) {
  getStatements().upsertState.run(key, JSON.stringify(value));
}

export function startSession(handoffSummary?: string): Session {
  const now = Date.now();
  const result = getStatements().insertSession.run(now, handoffSummary ?? null);
  return {
    id: Number(result.lastInsertRowid),
    started_at: now,
    handoff_summary: handoffSummary ?? null,
    ended_at: null,
  };
}

export function endCurrentSession(): void {
  const current = getStatements().selectCurrentSession.get();
  if (current) {
    getStatements().updateSessionEnded.run(Date.now(), current.id);
  }
}

export function getCurrentSession(): Session | null {
  return getStatements().selectCurrentSession.get() ?? null;
}
