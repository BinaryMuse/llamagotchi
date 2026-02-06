import { existsSync } from 'fs';
import { config } from '../config.ts';

// Template variables that can be used in prompt files with {{variable}} syntax
function getTemplateVariables(): Record<string, string> {
  return {
    port: String(config.port),
    workspace: config.workspacePath,
    ollama_endpoint: config.ollamaEndpoint,
    ollama_model: config.ollamaModel,
    context_size: String(config.contextSize),
  };
}

// Replace {{variable}} placeholders with actual values
function applyTemplate(content: string): string {
  const vars = getTemplateVariables();
  return content.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return vars[key] ?? match;
  });
}

// Fallback prompts in case files can't be read
const FALLBACK_SYSTEM_PROMPT = `You are an autonomous AI agent. You have tools available to interact with the filesystem, terminal, and web.`;

const FALLBACK_AUTONOMOUS_NUDGE = `Continue pursuing your goals. What would you like to do next?`;

// Lazily loaded prompts (loaded on first access)
let _systemPrompt: string | null = null;
let _autonomousNudge: string | null = null;

export function getSystemPrompt(): string {
  if (_systemPrompt === null) {
    throw new Error('Prompts not initialized - call initPrompts() first');
  }
  return _systemPrompt;
}

export function getAutonomousNudge(): string {
  if (_autonomousNudge === null) {
    throw new Error('Prompts not initialized - call initPrompts() first');
  }
  return _autonomousNudge;
}

// Initialize prompts asynchronously at startup
export async function initPrompts(): Promise<void> {
  try {
    if (existsSync(config.systemPromptPath)) {
      const raw = await Bun.file(config.systemPromptPath).text();
      _systemPrompt = applyTemplate(raw);
      console.log(`Loaded system prompt from ${config.systemPromptPath}`);
    } else {
      _systemPrompt = FALLBACK_SYSTEM_PROMPT;
      console.warn(`System prompt file not found at ${config.systemPromptPath}, using fallback`);
    }
  } catch (err) {
    console.warn(`Failed to load system prompt:`, err);
    _systemPrompt = FALLBACK_SYSTEM_PROMPT;
  }

  try {
    if (existsSync(config.autonomousPromptPath)) {
      const raw = await Bun.file(config.autonomousPromptPath).text();
      _autonomousNudge = applyTemplate(raw);
      console.log(`Loaded autonomous prompt from ${config.autonomousPromptPath}`);
    } else {
      _autonomousNudge = FALLBACK_AUTONOMOUS_NUDGE;
      console.warn(`Autonomous prompt file not found at ${config.autonomousPromptPath}, using fallback`);
    }
  } catch (err) {
    console.warn(`Failed to load autonomous prompt:`, err);
    _autonomousNudge = FALLBACK_AUTONOMOUS_NUDGE;
  }
}

// For backwards compatibility
export const SYSTEM_PROMPT = FALLBACK_SYSTEM_PROMPT;
export const AUTONOMOUS_NUDGE = FALLBACK_AUTONOMOUS_NUDGE;

export const CONTEXT_PRESSURE_WARNING = `[System Notice] Context pressure is becoming critical. You should persist any important information now using your tools (filesystem, notable) before context compaction occurs. After compaction, older messages will be summarized and you'll continue in a new session with a handoff summary.`;

export function formatUserMessage(content: string): string {
  return content;
}

export function formatExternalMessage(source: string, content: string): string {
  return `[External message from ${source}]\n${content}`;
}

export function formatSessionHandoff(summary: string): string {
  return `[Session Handoff]\nThis is a continuation of a previous session. Here's the context from before:\n\n${summary}\n\nYou may continue from where you left off or start fresh.`;
}
