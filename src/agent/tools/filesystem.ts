import type { ToolDefinition } from '../../llm/client.ts';
import type { ToolContext } from './index.ts';
import { config } from '../../config.ts';
import path from 'path';

export const filesystemDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'filesystem',
    description:
      'Perform file system operations: read, write, list, mkdir, delete. Paths are relative to the workspace directory.',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['read', 'write', 'list', 'mkdir', 'delete'],
          description: 'The operation to perform',
        },
        path: {
          type: 'string',
          description: 'The file or directory path (relative to workspace)',
        },
        content: {
          type: 'string',
          description: 'Content to write (for write operation)',
        },
      },
      required: ['operation', 'path'],
    },
  },
};

function resolvePath(relativePath: string): string {
  const resolved = path.resolve(config.workspacePath, relativePath);

  const workspaceAbs = path.resolve(config.workspacePath);
  if (!resolved.startsWith(workspaceAbs)) {
    throw new Error('Path escapes workspace directory');
  }

  return resolved;
}

export async function ensureWorkspaceExists(): Promise<void> {
  const dir = Bun.file(config.workspacePath);
  try {
    await Bun.$`mkdir -p ${config.workspacePath}`;
  } catch {
    // Directory may already exist
  }
}

export async function filesystem(
  input: Record<string, unknown>,
  _context: ToolContext
): Promise<string> {
  const operation = input.operation as string;
  const relativePath = input.path as string;
  const content = input.content as string | undefined;

  if (!operation || !relativePath) {
    return 'Error: operation and path are required';
  }

  const fullPath = resolvePath(relativePath);

  switch (operation) {
    case 'read': {
      const file = Bun.file(fullPath);
      const exists = await file.exists();
      if (!exists) {
        return `Error: File not found: ${relativePath}`;
      }
      return await file.text();
    }

    case 'write': {
      if (content === undefined) {
        return 'Error: content is required for write operation';
      }
      const dir = path.dirname(fullPath);
      await Bun.$`mkdir -p ${dir}`;
      await Bun.write(fullPath, content);
      return `Written ${content.length} bytes to ${relativePath}`;
    }

    case 'list': {
      try {
        const entries: string[] = [];
        const glob = new Bun.Glob('*');
        for await (const entry of glob.scan({ cwd: fullPath })) {
          entries.push(entry);
        }
        if (entries.length === 0) {
          return 'Directory is empty';
        }
        return entries.join('\n');
      } catch {
        return `Error: Cannot list directory: ${relativePath}`;
      }
    }

    case 'mkdir': {
      await Bun.$`mkdir -p ${fullPath}`;
      return `Created directory: ${relativePath}`;
    }

    case 'delete': {
      const file = Bun.file(fullPath);
      const exists = await file.exists();
      if (!exists) {
        return `Error: Path not found: ${relativePath}`;
      }
      await Bun.$`rm -rf ${fullPath}`;
      return `Deleted: ${relativePath}`;
    }

    default:
      return `Error: Unknown operation: ${operation}`;
  }
}
