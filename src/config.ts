export interface Config {
  ollamaEndpoint: string;
  ollamaModel: string;
  braveApiKey: string | null;
  port: number;
  workspacePath: string;
  contextSize: number;
}

export function loadConfig(): Config {
  return {
    ollamaEndpoint: process.env.OLLAMA_ENDPOINT ?? 'http://localhost:11434',
    ollamaModel: process.env.OLLAMA_MODEL ?? 'gpt-oss-oc',
    braveApiKey: process.env.BRAVE_API_KEY ?? null,
    port: parseInt(process.env.PORT ?? '3000', 10),
    workspacePath: process.env.WORKSPACE_PATH ?? './workspace',
    contextSize: parseInt(process.env.CONTEXT_SIZE ?? '128000', 10),
  };
}

export const config = loadConfig();
