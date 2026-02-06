import { dirname, join } from 'path';

export interface Config {
  ollamaEndpoint: string;
  ollamaModel: string;
  braveApiKey: string | null;
  port: number;
  workspacePath: string;
  contextSize: number;
  systemPromptPath: string;
  autonomousPromptPath: string;
}

// Get the directory where the binary/script is located
function getDefaultPromptsDir(): string {
  // import.meta.dir gives us the directory of this file
  // We go up one level to get to the project root, then into prompts/
  return join(dirname(import.meta.dir), 'prompts');
}

export function loadConfig(): Config {
  const defaultPromptsDir = getDefaultPromptsDir();

  return {
    ollamaEndpoint: process.env.OLLAMA_ENDPOINT ?? 'http://localhost:11434',
    ollamaModel: process.env.OLLAMA_MODEL ?? 'gpt-oss-oc',
    braveApiKey: process.env.BRAVE_API_KEY ?? null,
    port: parseInt(process.env.PORT ?? '3000', 10),
    workspacePath: process.env.WORKSPACE_PATH ?? './workspace',
    contextSize: parseInt(process.env.CONTEXT_SIZE ?? '128000', 10),
    systemPromptPath: process.env.SYSTEM_PROMPT_PATH ?? join(defaultPromptsDir, 'system.txt'),
    autonomousPromptPath: process.env.AUTONOMOUS_PROMPT_PATH ?? join(defaultPromptsDir, 'autonomous.txt'),
  };
}

export const config = loadConfig();
