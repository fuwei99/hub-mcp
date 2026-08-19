import https from 'https';

// Test: bare minimum https.get
const url = 'https://duckduckgo.com/?q=cats';
console.log(`GET ${url}`);
const req = https.get(url, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
  },
  timeout: 10000,
}, (res) => {
  console.log('Status:', res.statusCode);
  let data = '';
  res.on('data', (c) => data += c.toString());
  res.on('end', () => {
    console.log('Body length:', data.length);
    const vqd = data.match(/vqd=(["'])([^"']+)\1/);
    if (vqd) console.log('VQD:', vqd[2].slice(0, 40) + '...');
    else console.log('No VQD found');
  });
});
req.on('error', (e) => console.log('Error:', e.message));
req.on('timeout', () => { console.log('Timeout'); req.destroy(); });
