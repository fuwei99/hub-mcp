// Test using Node.js global fetch with proxy via undici ProxyAgent
import { ProxyAgent } from 'undici';

async function main() {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  console.log("Proxy:", proxyUrl);
  
  const agent = new ProxyAgent(proxyUrl);
  
  try {
    console.log("Fetching DDG via proxy...");
    const r = await fetch("https://duckduckgo.com/?q=cats", {
      dispatcher: agent,
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    console.log("Status:", r.status);
    const text = await r.text();
    console.log("Body length:", text.length);
    const vqd = text.match(/vqd=(["'])([^"']+)\1/);
    if (vqd) console.log("VQD:", vqd[2].slice(0, 40) + "...");
    else console.log("No VQD");
  } catch (err) {
    console.log("Error:", err.name, err.message);
  } finally {
    agent.close();
  }
}
main();
