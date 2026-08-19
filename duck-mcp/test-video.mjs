async function main() {
  // Direct fetch to DDG for VQD
  console.log("Fetching DDG for VQD token...");
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const resp = await fetch("https://duckduckgo.com/", {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:134.0) Gecko/20100101 Firefox/134.0",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: "q=cats",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    
    console.log("Status:", resp.status);
    console.log("VQD:", resp.headers.get("x-vqd-4"));
    const text = await resp.text();
    console.log("Body length:", text.length);
    console.log("Body:", text.slice(0, 300));
  } catch (err) {
    console.log("Fetch error:", err.name, err.message);
  }
}

main();
