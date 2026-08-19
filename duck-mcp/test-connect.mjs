async function main() {
  // Try d.js with various approaches
  const tests = [
    { name: "d.js without VQD", url: "https://links.duckduckgo.com/d.js?q=test&o=json" },
    { name: "d.js with vqd=1", url: "https://links.duckduckgo.com/d.js?q=cats&o=json&vqd=1" },
    { name: "html page", url: "https://html.duckduckgo.com/html?q=cats" },
  ];

  for (const { name, url } of tests) {
    console.log(`\n### ${name}`);
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 10000);
      const r = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
          "Accept": "*/*",
        },
        signal: controller.signal,
      });
      console.log("Status:", r.status);
      console.log("VQD response:", r.headers.get("x-vqd-4"));
      const text = await r.text();
      console.log("Body:", text.slice(0, 300));
    } catch (err) {
      console.log("Error:", err.name, err.message);
    }
  }
}
main();
