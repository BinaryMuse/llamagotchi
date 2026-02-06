import { Database } from 'bun:sqlite';
import { config } from '../config.ts';
import path from 'path';
import { mkdirSync } from 'fs';

const dbPath = path.join(config.workspacePath, 'llamagotchi.db');

let _db: Database | null = null;

export function getDb(): Database {
  if (!_db) {
    mkdirSync(config.workspacePath, { recursive: true });
    _db = new Database(dbPath, { create: true });
  }
  return _db;
}

export function initDatabase() {
  const database = getDb();
  database.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_name TEXT,
      tool_input TEXT,
      timestamp INTEGER NOT NULL,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS notables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      content TEXT NOT NULL,
      reason TEXT,
      timestamp INTEGER NOT NULL,
      message_id INTEGER,
      FOREIGN KEY (message_id) REFERENCES messages(id)
    );

    CREATE TABLE IF NOT EXISTS state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS background_tasks (
      id TEXT PRIMARY KEY,
      tool_name TEXT NOT NULL,
      input TEXT NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at INTEGER NOT NULL,
      handoff_summary TEXT,
      ended_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_notables_timestamp ON notables(timestamp);
    CREATE INDEX IF NOT EXISTS idx_background_tasks_status ON background_tasks(status);
  `);
}
