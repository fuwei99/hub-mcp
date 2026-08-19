// Test the DDGS library's VQD approach: GET duckduckgo.com and parse HTML for vqd="..."
async function main() {
  const query = "cats";
  console.log(`Fetching https://duckduckgo.com/?q=${query}...`);
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 15000);
    const r = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Referer": "https://duckduckgo.com/",
      },
      signal: controller.signal,
    });
    console.log("Status:", r.status);
    const text = await r.text();
    console.log("Body length:", text.length);
    
    // Look for vqd="..." pattern
    const vqdMatch = text.match(/vqd=(["'])([^"']+)\1/);
    if (vqdMatch) {
      console.log("VQD found:", vqdMatch[2].slice(0, 30) + "...");
    } else {
      console.log("No VQD found in HTML");
      // Show context around "vqd"
      const idx = text.indexOf("vqd");
      if (idx >= 0) {
        console.log("Context around vqd:", text.slice(Math.max(0, idx - 20), idx + 50));
      }
    }
  } catch (err) {
    console.log("Error:", err.name, err.message);
  }
}
main();
