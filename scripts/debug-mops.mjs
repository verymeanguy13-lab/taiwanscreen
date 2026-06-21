// scripts/debug-mops.mjs
// Run: node scripts/debug-mops.mjs
// Shows raw MOPS response so we can see what's actually coming back

// First get a session cookie from the main page
console.log('Getting session cookie...');
const sessionRes = await fetch('https://mops.twse.com.tw/mops/web/index', {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  },
});
const cookies = sessionRes.headers.get('set-cookie') ?? '';
console.log('Cookies:', cookies.slice(0, 100));

async function mopsFetch(path, body) {
  const url = `https://mops.twse.com.tw${path}`;
  const formBody = new URLSearchParams(body).toString();
  console.log(`\nPOST ${url}`);
  console.log('Body:', formBody);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': 'https://mops.twse.com.tw/mops/web/index',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Cookie': cookies,
    },
    body: formBody,
    signal: AbortSignal.timeout(60000),
  });

  console.log('Status:', res.status, res.statusText);
  const text = await res.text();
  console.log('Response length:', text.length);
  console.log('First 500 chars:', text.slice(0, 500));
  return text;
}

// Test balance sheet — 2025 Q3 = ROC year 114
await mopsFetch('/mops/web/ajax_t164sb03', {
  encodeURIComponent: '1',
  step: '1',
  firstin: '1',
  off: '1',
  keyword4: '',
  code1: '',
  TYPEK: 'sii',
  isnew: 'false',
  year: '114',
  season: '3',
});

// Also try the t05st22 book value endpoint
await mopsFetch('/mops/web/ajax_t05st22', {
  encodeURIComponent: '1',
  step: '1',
  firstin: '1',
  off: '1',
  keyword4: '',
  code1: '',
  TYPEK: 'sii',
  isnew: 'false',
  year: '114',
  season: '3',
});
