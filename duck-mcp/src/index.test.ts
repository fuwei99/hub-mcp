import { describe, it, expect, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { resolve } from 'path';

// ─── Helpers ────────────────────────────────────────────────────────────

function sendRequest(
  proc: ChildProcess,
  request: unknown,
  timeoutMs = 8000,
): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Response timeout'));
    }, timeoutMs);

    let buffer = '';

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      // MCP sends newline-delimited JSON
      const lines = buffer.split('\n');
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>;
          // Check if this is a response to our request (has id field)
          if (parsed.id !== undefined) {
            clearTimeout(timeout);
            proc.stdout?.removeListener('data', onData);
            resolvePromise(parsed);
            return;
          }
        } catch {
          // Non-JSON or incomplete output, keep waiting
        }
      }
    };

    proc.stdout?.on('data', onData);
    proc.stdin?.write(JSON.stringify(request) + '\n');
  });
}

async function initializeServer(proc: ChildProcess): Promise<void> {
  const initResponse = await sendRequest(proc, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  });
  expect(initResponse.id).toBe(1);
  // Send initialized notification (no response expected)
  proc.stdin?.write(
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }) + '\n',
  );
  // Small delay for server to process
  await new Promise((r) => setTimeout(r, 200));
}

describe('MCP Server', () => {
  let proc: ChildProcess | null = null;

  afterAll(() => {
    if (proc && !proc.killed) {
      proc.kill();
    }
  });

  it('should respond to tools/list with 9 DuckDuckGo tools', async () => {
    proc = spawn('npx', ['tsx', resolve(__dirname, 'index.ts')], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' },
    });

    let stderrData = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrData += chunk.toString();
    });

    // 1. Initialize handshake
    await initializeServer(proc);

    // 2. Request tool list
    const response = await sendRequest(proc, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    }, 15000);

    // 3. Assertions
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(2);
    expect(response.result).toBeDefined();

    const result = response.result as Record<string, unknown>;
    expect(result.tools).toBeDefined();
    const tools = result.tools as Array<{ name: string; description?: string; inputSchema?: unknown }>;
    expect(tools).toHaveLength(9);

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toEqual([
      'ddg_get_answer',
      'ddg_search',
      'ddg_search_news',
      'ddg_search_images',
      'ddg_search_videos',
      'ddg_fetch_content',
      'ddg_get_suggestions',
      'ddg_get_definition',
      'ddg_convert_currency',
    ]);

    // 4. Verify each tool has a description and inputSchema
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
    }

    // 5. Clean up
    proc.kill();
    proc = null;
  }, 15000);
});
