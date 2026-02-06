import type { ToolDefinition } from '../../llm/client.ts';
import type { ToolContext } from './index.ts';
import { config } from '../../config.ts';
import path from 'path';
import {
  createBackgroundTask,
  completeBackgroundTask,
  failBackgroundTask,
} from '../../db/messages.ts';

export const terminalDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'terminal',
    description:
      'Execute a shell command. Commands run in the workspace directory by default.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
        cwd: {
          type: 'string',
          description:
            'Working directory (relative to workspace, defaults to workspace root)',
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
      required: ['command'],
    },
  },
};

const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\/(?!\S)/,
  /rm\s+-rf\s+~(?!\S)/,
  /:\(\)\s*{\s*:\|:\s*&\s*}\s*;/,
  />\s*\/dev\/sd[a-z]/,
  /dd\s+if=.*of=\/dev/,
  /mkfs\./,
  /chmod\s+-R\s+777\s+\//,
];

function isCommandBlocked(command: string): boolean {
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(command));
}

function resolveCwd(relativeCwd?: string): string {
  if (!relativeCwd) {
    return path.resolve(config.workspacePath);
  }

  const resolved = path.resolve(config.workspacePath, relativeCwd);
  const workspaceAbs = path.resolve(config.workspacePath);

  if (!resolved.startsWith(workspaceAbs)) {
    throw new Error('Working directory escapes workspace');
  }

  return resolved;
}

async function runCommand(command: string, cwd: string): Promise<string> {
  const proc = Bun.spawn(['bash', '-c', command], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  let output = '';
  if (stdout) output += stdout;
  if (stderr) output += (output ? '\n' : '') + `[stderr] ${stderr}`;
  if (exitCode !== 0) output += `\n[exit code: ${exitCode}]`;

  return output || '(no output)';
}

export async function terminal(
  input: Record<string, unknown>,
  _context: ToolContext
): Promise<string> {
  const command = input.command as string;
  const cwd = input.cwd as string | undefined;
  const timeout = input.timeout as number | undefined;
  const background = input.background as boolean | undefined;

  if (!command) {
    return 'Error: command is required';
  }

  if (isCommandBlocked(command)) {
    return 'Error: Command blocked for safety reasons';
  }

  const resolvedCwd = resolveCwd(cwd);

  if (background) {
    const taskId = createBackgroundTask('terminal', input);

    runCommand(command, resolvedCwd)
      .then((result) => completeBackgroundTask(taskId, result))
      .catch((err) =>
        failBackgroundTask(taskId, err instanceof Error ? err.message : String(err))
      );

    return JSON.stringify({ task_id: taskId });
  }

  if (timeout) {
    const taskId = createBackgroundTask('terminal', input);

    try {
      const result = await Promise.race([
        runCommand(command, resolvedCwd),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), timeout)
        ),
      ]);

      completeBackgroundTask(taskId, result);
      return result;
    } catch (err) {
      if (err instanceof Error && err.message === 'timeout') {
        runCommand(command, resolvedCwd)
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

  return await runCommand(command, resolvedCwd);
}
