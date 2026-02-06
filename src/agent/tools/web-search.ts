import type { ToolDefinition } from '../../llm/client.ts';
import type { ToolContext } from './index.ts';
import { config } from '../../config.ts';
import {
  createBackgroundTask,
  completeBackgroundTask,
  failBackgroundTask,
} from '../../db/messages.ts';

export const webSearchDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'web_search',
    description:
      'Search the web using Brave Search API. Returns search results with titles, URLs, and snippets.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query',
        },
        count: {
          type: 'number',
          description: 'Number of results to return (default: 5, max: 20)',
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
      required: ['query'],
    },
  },
};

interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
}

interface BraveSearchResponse {
  web?: {
    results: BraveSearchResult[];
  };
}

async function doSearch(query: string, count: number): Promise<string> {
  if (!config.braveApiKey) {
    return 'Error: BRAVE_API_KEY not configured';
  }

  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(Math.min(count, 20)));

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': config.braveApiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Brave Search API error: ${response.status}`);
  }

  const data = (await response.json()) as BraveSearchResponse;
  const results = data.web?.results ?? [];

  if (results.length === 0) {
    return 'No results found.';
  }

  return results
    .map(
      (r, i) =>
        `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description}`
    )
    .join('\n\n');
}

export async function webSearch(
  input: Record<string, unknown>,
  _context: ToolContext
): Promise<string> {
  const query = input.query as string;
  const count = (input.count as number) ?? 5;
  const timeout = input.timeout as number | undefined;
  const background = input.background as boolean | undefined;

  if (!query) {
    return 'Error: query is required';
  }

  if (background) {
    const taskId = createBackgroundTask('web_search', input);

    doSearch(query, count)
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
      const result = await Promise.race([
        doSearch(query, count),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () =>
            reject(new Error('timeout'))
          );
        }),
      ]);

      clearTimeout(timeoutId);
      return result;
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof Error && err.message === 'timeout') {
        const taskId = createBackgroundTask('web_search', input);
        doSearch(query, count)
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

  return await doSearch(query, count);
}
