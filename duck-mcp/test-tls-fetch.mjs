import { tlsFetch } from "./src/tls.js";

async function main() {
  try {
    console.log("Fetching DDG via TLS agent...");
    const result = await tlsFetch("https://duckduckgo.com/?q=cats", {
      timeout: 15000,
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      }
    });
    console.log("Status:", result.status);
    
    if (result.status === 200) {
      const vqdMatch = result.body.match(/vqd=(["'])([^"']+)\1/);
      if (vqdMatch) {
        console.log("VQD found:", vqdMatch[2].slice(0, 40) + "...");
      } else {
        console.log("No VQD found in HTML");
        const idx = result.body.indexOf("vqd");
        if (idx >= 0) {
          console.log("vqd context:", result.body.slice(Math.max(0, idx - 10), idx + 40));
        }
      }
    } else {
      console.log("Body preview:", result.body.slice(0, 300));
    }
  } catch (err) {
    console.log("Error:", err.name, err.message);
  }
}
main();
