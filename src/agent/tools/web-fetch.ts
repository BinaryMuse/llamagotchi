import type { ToolDefinition } from '../../llm/client.ts';
import type { ToolContext } from './index.ts';
import TurndownService from 'turndown';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from '../../config.ts';
import {
  createBackgroundTask,
  completeBackgroundTask,
  failBackgroundTask,
} from '../../db/messages.ts';

export const webFetchDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'web_fetch',
    description:
      'Fetch a URL and convert the HTML content to markdown. If destination is specified, saves to that file path (relative to workspace) instead of returning content. For large files or binary data, use destination to save to disk. If the destination folder does not exist, saves to a temp file and returns that path.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch',
        },
        destination: {
          type: 'string',
          description:
            'Optional file path (relative to workspace) to save content to instead of returning it. Good for large or binary files.',
        },
        timeout: {
          type: 'number',
          description:
            'Timeout in milliseconds. If exceeded, operation backgrounds automatically.',
        },
        background: {
          type: 'boolean',
          description:
            'If true, return immediately with a task_id to check later.',
        },
      },
      required: ['url'],
    },
  },
};

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

turndown.remove(['script', 'style', 'nav', 'footer', 'header']);

interface FetchResult {
  content: string;
  binary?: Uint8Array;
  contentType: string;
}

async function doFetch(url: string): Promise<FetchResult> {
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; llamagotchi/1.0; +https://github.com/llamagotchi)',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('text/html')) {
    const html = await response.text();
    return { content: turndown.turndown(html), contentType };
  }

  if (contentType.includes('application/json')) {
    const json = await response.json();
    return {
      content: '```json\n' + JSON.stringify(json, null, 2) + '\n```',
      contentType,
    };
  }

  // For binary content types, return as binary
  if (
    contentType.includes('image/') ||
    contentType.includes('audio/') ||
    contentType.includes('video/') ||
    contentType.includes('application/octet-stream') ||
    contentType.includes('application/pdf') ||
    contentType.includes('application/zip')
  ) {
    const binary = new Uint8Array(await response.arrayBuffer());
    return { content: `[Binary data: ${binary.length} bytes]`, binary, contentType };
  }

  return { content: await response.text(), contentType };
}

async function saveToFile(
  result: FetchResult,
  destination: string
): Promise<string> {
  const fullPath = join(config.workspacePath, destination);
  const dir = dirname(fullPath);

  // Check if directory exists
  if (!existsSync(dir)) {
    // Save to temp file instead
    const tempPath = join(
      config.workspacePath,
      'tmp',
      `fetch-${Date.now()}-${destination.replace(/[/\\]/g, '-')}`
    );
    const tempDir = dirname(tempPath);
    mkdirSync(tempDir, { recursive: true });

    const dataToWrite = result.binary ?? result.content;
    await Bun.write(tempPath, dataToWrite);
    return `Destination folder does not exist. Saved to temp file: ${tempPath}`;
  }

  const dataToWrite = result.binary ?? result.content;
  await Bun.write(fullPath, dataToWrite);
  return `Saved to ${fullPath} (${result.binary ? result.binary.length + ' bytes' : result.content.length + ' chars'})`;
}

export async function webFetch(
  input: Record<string, unknown>,
  _context: ToolContext
): Promise<string> {
  const url = input.url as string;
  const destination = input.destination as string | undefined;
  const timeout = input.timeout as number | undefined;
  const background = input.background as boolean | undefined;

  if (!url) {
    return 'Error: url is required';
  }

  async function fetchAndMaybeSave(): Promise<string> {
    const result = await doFetch(url);
    if (destination) {
      return await saveToFile(result, destination);
    }
    return result.content;
  }

  if (background) {
    const taskId = createBackgroundTask('web_fetch', input);

    fetchAndMaybeSave()
      .then((result) => completeBackgroundTask(taskId, result))
      .catch((err) =>
        failBackgroundTask(taskId, err instanceof Error ? err.message : String(err))
      );

    return JSON.stringify({ task_id: taskId });
  }

  if (timeout) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const taskId = createBackgroundTask('web_fetch', input);

      const result = await Promise.race([
        fetchAndMaybeSave(),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () =>
            reject(new Error('timeout'))
          );
        }),
      ]);

      clearTimeout(timeoutId);
      completeBackgroundTask(taskId, result);
      return result;
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof Error && err.message === 'timeout') {
        const taskId = createBackgroundTask('web_fetch', input);
        fetchAndMaybeSave()
          .then((result) => completeBackgroundTask(taskId, result))
          .catch((e) =>
            failBackgroundTask(taskId, e instanceof Error ? e.message : String(e))
          );
        return JSON.stringify({
          task_id: taskId,
          message: 'Timeout exceeded, backgrounded',
        });
      }
      throw err;
    }
  }

  return await fetchAndMaybeSave();
}
