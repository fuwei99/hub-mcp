import http2 from 'http2';

async function main() {
  const query = "cats";
  const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
  const parsedUrl = new URL(url);

  return new Promise((resolve, reject) => {
    const client = http2.connect(parsedUrl.origin, {
      // Use TLS
      // Don't use ALPN negotiation to force HTTP/2
    });

    const timeout = setTimeout(() => {
      client.close();
      console.log("TIMEOUT");
      resolve(null);
    }, 15000);

    const req = client.request({
      ':method': 'GET',
      ':path': parsedUrl.pathname + parsedUrl.search,
      'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.5',
      'referer': 'https://duckduckgo.com/',
    });

    let data = '';
    req.on('data', (chunk) => data += chunk.toString());
    req.on('end', () => {
      clearTimeout(timeout);
      client.close();
      console.log("Status: 200");
      console.log("Body length:", data.length);
      const vqdMatch = data.match(/vqd=(["'])([^"']+)\1/);
      if (vqdMatch) {
        console.log("VQD found:", vqdMatch[2].slice(0, 40) + "...");
      } else {
        console.log("No VQD found in HTML");
      }
      resolve(null);
    });
    req.on('error', (err) => {
      clearTimeout(timeout);
      console.log("Error:", err.message);
      resolve(null);
    });
    req.end();
  });
}
main();
