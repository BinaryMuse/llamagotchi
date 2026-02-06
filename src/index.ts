import { config } from './config.ts';
import { initDatabase } from './db/index.ts';
import { startServer, setWebSocketMessageHandler } from './server/index.ts';
import { createAgentHarness } from './agent/harness.ts';
import { ensureWorkspaceExists } from './agent/tools/filesystem.ts';
import { startSession, getCurrentSession } from './db/messages.ts';

async function main() {
  console.log('llamagotchi starting...');
  console.log(`Workspace: ${config.workspacePath}`);
  console.log(`Ollama: ${config.ollamaEndpoint} (model: ${config.ollamaModel})`);
  console.log(`Context size: ${config.contextSize.toLocaleString()} tokens`);

  await ensureWorkspaceExists();
  initDatabase();

  let session = getCurrentSession();
  if (!session) {
    session = startSession();
    console.log(`Started new session: ${session.id}`);
  } else {
    console.log(`Resuming session: ${session.id}`);
  }

  const server = startServer();
  const harness = createAgentHarness();

  setWebSocketMessageHandler((msg, ws) => {
    harness.handleWebSocketMessage(msg);
  });

  harness.start();

  console.log(`Server running at http://localhost:${config.port}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
