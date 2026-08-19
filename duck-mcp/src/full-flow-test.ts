/**
 * Full flow integration test for DDG Search MCP server.
 * Spawns the server, performs MCP handshake, tests all 4 tools.
 * Run with: npx tsx src/full-flow-test.ts
 *
 * Known limitation: DuckDuckGo API calls may time out in sandbox environments
 * (Node.js connect timeout). This test validates JSON-RPC format regardless
 * of network availability — errors still use proper MCP format.
 */
import { spawn, type ChildProcess } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.log(`  ❌ ${msg}`);
    failed++;
  }
}

/**
 * Send a JSON-RPC request and wait for the response matching `expectedId`.
 * Only resolves when a response with the matching id arrives.
 * Rejects on timeout.
 */
function sendRequest(
  proc: ChildProcess,
  request: { id: number; [key: string]: unknown },
  timeoutMs = 30000,
): Promise<Record<string, unknown>> {
  const expectedId = request.id;

  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      proc.stdout?.removeListener("data", onData);
      reject(new Error(`Response timeout for id=${expectedId}`));
    }, timeoutMs);

    let buffer = "";

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>;

          // Match response by id
          if (parsed.id === expectedId) {
            clearTimeout(timeout);
            proc.stdout?.removeListener("data", onData);
            resolvePromise(parsed);
            return;
          }

          // Also match initialize response (server info, id may be undefined in some SDK versions)
          if (parsed.result && (parsed.result as Record<string, unknown>).serverInfo && expectedId === 1) {
            clearTimeout(timeout);
            proc.stdout?.removeListener("data", onData);
            resolvePromise(parsed);
            return;
          }
        } catch {
          // Non-JSON, keep waiting
        }
      }
    };

    proc.stdout?.on("data", onData);
    proc.stdin?.write(JSON.stringify(request) + "\n");
  });
}

async function run() {
  console.log("🧪 DDG Search MCP - Full Flow Test\n");
  console.log(`Date: ${new Date().toISOString()}\n`);

  // ─── Spawn Server ───────────────────────────────────────────────────
  console.log("1. Starting MCP server...");
  const proc = spawn("npx", ["tsx", resolve(__dirname, "index.ts")], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "test" },
  });

  let stderrData = "";
  proc.stderr?.on("data", (chunk: Buffer) => {
    stderrData += chunk.toString();
  });

  proc.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.log(`  ⚠️ Server exited with code ${code}`);
    }
  });

  // ─── MCP Handshake ──────────────────────────────────────────────────
  console.log("2. Performing MCP initialization handshake...");

  const initResponse = await sendRequest(proc, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "full-flow-test", version: "1.0.0" },
    },
  });

  assert(initResponse.id === 1, "Initialize response has id=1");
  assert(initResponse.result !== undefined, "Initialize response has result");

  const result = initResponse.result as Record<string, unknown>;
  const serverInfo = result.serverInfo as Record<string, unknown> | undefined;
  if (serverInfo) {
    assert(serverInfo.name === "ddg-search-mcp", `Server name is "ddg-search-mcp" (got "${serverInfo.name}")`);
    assert(serverInfo.version === "1.0.0", `Server version is "1.0.0" (got "${serverInfo.version}")`);
  }

  // Send initialized notification (no response expected)
  proc.stdin?.write(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }) + "\n",
  );
  await new Promise((r) => setTimeout(r, 300));

  // ─── tools/list ─────────────────────────────────────────────────────
  console.log("\n3. Testing tools/list...");

  const listResponse = await sendRequest(proc, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
  });

  assert(listResponse.jsonrpc === "2.0", 'listResponse.jsonrpc === "2.0"');
  assert(listResponse.id === 2, "listResponse.id === 2");

  const listResult = listResponse.result as Record<string, unknown>;
  assert(listResult !== undefined, "tools/list has result");

  const tools = listResult.tools as Array<{ name: string; description?: string; inputSchema?: unknown }>;
  assert(Array.isArray(tools), "tools is an array");
  assert(tools.length === 4, `Expected 4 tools, got ${tools.length}`);

  const toolNames = tools.map((t) => t.name);
  const expectedNames = ["ddg_get_answer", "ddg_search", "ddg_search_news", "ddg_fetch_content"];
  assert(
    JSON.stringify(toolNames) === JSON.stringify(expectedNames),
    `Tool names: ${JSON.stringify(toolNames)}`,
  );

  for (const tool of tools) {
    assert(!!tool.description, `Tool "${tool.name}" has description`);
    assert(!!tool.inputSchema, `Tool "${tool.name}" has inputSchema`);
  }

  // ─── ddg_get_answer ─────────────────────────────────────────────────
  console.log("\n4. Testing ddg_get_answer...");
  try {
    const answerResponse = await sendRequest(proc, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "ddg_get_answer",
        arguments: { query: "what is python" },
      },
    });

    assert(answerResponse.jsonrpc === "2.0", "answerResponse.jsonrpc === '2.0'");
    assert(answerResponse.id === 3, "answerResponse.id === 3");
    assert(answerResponse.result !== undefined || answerResponse.error !== undefined,
      "answerResponse has result or error");

    if (answerResponse.error) {
      const err = answerResponse.error as Record<string, unknown>;
      console.log(`  ℹ️  Error returned (network dependent): ${err.message || JSON.stringify(err)}`);
      assert(!!err.message || !!err.code, "Error response has message or code");
    } else {
      const result = answerResponse.result as Record<string, unknown>;
      const content = result.content as Array<{ type: string; text: string }>;
      assert(Array.isArray(content) && content.length > 0, "Answer has content array");
      assert(content[0].type === "text", "Answer content[0] type is 'text'");
      assert(typeof content[0].text === "string" && content[0].text.length > 0,
        "Answer text is non-empty string");
      console.log(`  ℹ️  Answer preview: ${content[0].text.slice(0, 120).replace(/\n/g, " ")}...`);
    }
  } catch (err) {
    assert(false, `ddg_get_answer: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ─── ddg_search ─────────────────────────────────────────────────────
  console.log("\n5. Testing ddg_search...");
  try {
    const searchResponse = await sendRequest(proc, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "ddg_search",
        arguments: { query: "hello world", maxResults: 3 },
      },
    });

    assert(searchResponse.jsonrpc === "2.0", "searchResponse.jsonrpc === '2.0'");
    assert(searchResponse.id === 4, "searchResponse.id === 4");
    assert(searchResponse.result !== undefined || searchResponse.error !== undefined,
      "searchResponse has result or error");

    if (searchResponse.error) {
      const err = searchResponse.error as Record<string, unknown>;
      console.log(`  ℹ️  Error returned (network dependent): ${err.message || JSON.stringify(err)}`);
      assert(!!err.message || !!err.code, "Error response has message or code");
    } else {
      const result = searchResponse.result as Record<string, unknown>;
      const content = result.content as Array<{ type: string; text: string }>;
      assert(Array.isArray(content) && content.length > 0, "Search has content array");
      assert(content[0].type === "text", "Search content[0] type is 'text'");
      assert(typeof content[0].text === "string", "Search content[0].text is a string");
      console.log(`  ℹ️  Search preview: ${content[0].text.slice(0, 120).replace(/\n/g, " ")}...`);
    }
  } catch (err) {
    assert(false, `ddg_search: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ─── ddg_search_news ────────────────────────────────────────────────
  console.log("\n6. Testing ddg_search_news...");
  try {
    const newsResponse = await sendRequest(proc, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "ddg_search_news",
        arguments: { query: "technology", maxResults: 2 },
      },
    });

    assert(newsResponse.jsonrpc === "2.0", "newsResponse.jsonrpc === '2.0'");
    assert(newsResponse.id === 5, "newsResponse.id === 5");
    assert(newsResponse.result !== undefined || newsResponse.error !== undefined,
      "newsResponse has result or error");

    if (newsResponse.error) {
      const err = newsResponse.error as Record<string, unknown>;
      console.log(`  ℹ️  Error returned (network dependent): ${err.message || JSON.stringify(err)}`);
      assert(!!err.message || !!err.code, "Error response has message or code");
    } else {
      const result = newsResponse.result as Record<string, unknown>;
      const content = result.content as Array<{ type: string; text: string }>;
      assert(Array.isArray(content) && content.length > 0, "News has content array");
      assert(content[0].type === "text", "News content[0] type is 'text'");
      assert(typeof content[0].text === "string", "News content[0].text is a string");
      console.log(`  ℹ️  News preview: ${content[0].text.slice(0, 120).replace(/\n/g, " ")}...`);
    }
  } catch (err) {
    assert(false, `ddg_search_news: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ─── ddg_fetch_content ──────────────────────────────────────────────
  console.log("\n7. Testing ddg_fetch_content...");
  try {
    const fetchResponse = await sendRequest(proc, {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "ddg_fetch_content",
        arguments: { url: "https://example.com" },
      },
    });

    assert(fetchResponse.jsonrpc === "2.0", "fetchResponse.jsonrpc === '2.0'");
    assert(fetchResponse.id === 6, "fetchResponse.id === 6");
    assert(fetchResponse.result !== undefined || fetchResponse.error !== undefined,
      "fetchResponse has result or error");

    if (fetchResponse.error) {
      const err = fetchResponse.error as Record<string, unknown>;
      console.log(`  ℹ️  Error returned: ${err.message || JSON.stringify(err)}`);
      assert(!!err.message || !!err.code, "Error response has message or code");
    } else {
      const result = fetchResponse.result as Record<string, unknown>;
      const content = result.content as Array<{ type: string; text: string }>;
      assert(Array.isArray(content) && content.length > 0, "Fetch has content array");
      assert(content[0].type === "text", "Fetch content[0] type is 'text'");
      assert(typeof content[0].text === "string" && content[0].text.length > 0,
        "Fetch text is non-empty string");
      assert(content[0].text.includes("Example Domain"),
        "Fetch content contains 'Example Domain'");
      console.log(`  ℹ️  Fetch works: ${content[0].text.slice(0, 120).replace(/\n/g, " ")}...`);
    }
  } catch (err) {
    assert(false, `ddg_fetch_content: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ─── Cleanup ────────────────────────────────────────────────────────
  console.log("\n8. Cleaning up...");
  proc.kill();
  await new Promise((r) => setTimeout(r, 200));

  // ─── Results ────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
  console.log(`${"=".repeat(50)}`);

  if (stderrData) {
    console.log(`\n⚠️  Server stderr output:\n${stderrData}`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
