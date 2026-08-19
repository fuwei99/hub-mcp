/**
 * DDG Challenge Solver — VM-based anti-bot bypass.
 *
 * Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute).
 * Solves DuckDuckGo's client-side JavaScript challenge without a browser.
 *
 * Flow:
 * 1. GET https://duck.ai/duckchat/v1/status → x-vqd-hash-1 header (base64 JS)
 * 2. Decode base64 → JS challenge code
 * 3. Execute in Node.js vm sandbox with fake browser env
 * 4. JS returns client_hashes → SHA-256 hash → base64 encode
 * 5. Send solved token back to DDG
 */

import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { parseFragment, serialize } from 'parse5';

// ─── Constants ──────────────────────────────────────────────────────────

const DUCKAI_BASE = 'https://duck.ai';
const STATUS_URL = `${DUCKAI_BASE}/duckchat/v1/status`;

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

const SEEDED_COOKIES: ReadonlyArray<readonly [string, string]> = [
  ['5', '1'],
  ['ah', 'wt-wt'],
  ['dcs', '1'],
  ['dcm', '3'],
  ['isRecentChatOn', '1'],
];

const FAKE_HEADERS: Record<string, string> = {
  Accept: '*/*',
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-store',
  Origin: DUCKAI_BASE,
  Pragma: 'no-cache',
  Referer: `${DUCKAI_BASE}/`,
  Priority: 'u=1, i',
  'Sec-Ch-Ua': '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Linux"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'User-Agent': DEFAULT_USER_AGENT,
};

// ─── Types ──────────────────────────────────────────────────────────────

export interface DdgChallengeResult {
  client_hashes: string[];
  server_hashes: string[];
  signals: Record<string, unknown>;
  meta: Record<string, unknown>;
  meta_v2: Record<string, unknown>;
}

export interface DdgAntiBotTokens {
  jsa: string;
  jsa_hash: string;
  dp: string;
}

// ─── Cookie helpers ─────────────────────────────────────────────────────

function serializeCookieJar(cookieJar: Map<string, string>): string {
  return Array.from(cookieJar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function splitSetCookieHeader(header: string): string[] {
  const cookies: string[] = [];
  let start = 0;
  for (let index = 0; index < header.length; index++) {
    if (header[index] !== ',') continue;
    const rest = header.slice(index + 1);
    if (/^\s*[^=;\s]+\s*=/.test(rest)) {
      cookies.push(header.slice(start, index).trim());
      start = index + 1;
    }
  }
  cookies.push(header.slice(start).trim());
  return cookies.filter(Boolean);
}

function applySetCookie(cookieJar: Map<string, string>, setCookie: string): void {
  const pair = setCookie.split(';', 1)[0]?.trim();
  if (!pair) return;
  const separator = pair.indexOf('=');
  if (separator <= 0) return;
  cookieJar.set(pair.slice(0, separator), pair.slice(separator + 1));
}

// ─── HTML Lookup (for innerHTML mock) ───────────────────────────────────

function countHtmlElements(node: unknown): number {
  if (!node || typeof node !== 'object') return 0;
  const record = node as { nodeName?: string; childNodes?: unknown[] };
  const own = record.nodeName && record.nodeName !== '#document-fragment' ? 1 : 0;
  let childCount = 0;
  for (const child of record.childNodes ?? []) {
    childCount += countHtmlElements(child);
  }
  return own + childCount;
}

function buildHtmlLookup(js: string): Record<string, { html: string; count: number }> {
  const lookup: Record<string, { html: string; count: number }> = {};
  const seen = new Set<string>();
  const pattern = /(['"])(<[^'"]{1,400}?)\1/g;
  for (const match of js.matchAll(pattern)) {
    const html = match[2];
    if (seen.has(html)) continue;
    seen.add(html);
    const fragment = parseFragment(html);
    lookup[html] = {
      html: serialize(fragment),
      count: Math.max(0, countHtmlElements(fragment) - 1),
    };
  }
  return lookup;
}

// ─── SHA-256 helper ─────────────────────────────────────────────────────

function sha256Base64(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64');
}

// ─── Challenge Stubs (fake browser env) ─────────────────────────────────

const CHALLENGE_STUBS = String.raw`
var __ua = __DDG_REAL_UA__;
var __HTML_LOOKUP = __DDG_HTML_LOOKUP__;
function __makeHtmlElement(tag) {
  var state = { _innerHTML: '', _qsaCount: 0, _cssText: '' };
  var el = {
    tagName: String(tag).toUpperCase(), nodeName: String(tag).toUpperCase(), nodeType: 1,
    children: [], childNodes: [], classList: [], dataset: {},
    offsetWidth: 1, offsetHeight: 1, clientWidth: 1, clientHeight: 1, scrollHeight: 1, scrollWidth: 1,
    getBoundingClientRect: function(){ return { x: 0, y: 0, top: 0, left: 0, right: 1, bottom: 1, width: 1, height: 1, toJSON: function(){ return {}; } }; },
    setAttribute: function(){}, removeAttribute: function(){},
    getAttribute: function(a){ if(a==='srcdoc') return state._srcdoc||''; return null; },
    hasAttribute: function(){ return false; }, appendChild: function(c){ return c; }, removeChild: function(c){ return c; },
    addEventListener: function(){}, removeEventListener: function(){}, querySelector: function(){ return null; },
    querySelectorAll: function(s){ if (s === '*') { var arr = []; arr.length = state._qsaCount; return arr; } return []; },
    cloneNode: function(){ return __makeHtmlElement(tag); }
  };
  Object.defineProperty(el, 'style', { value: new Proxy({}, { set: function(t, k, v){ t[k] = v; if (k === 'cssText') state._cssText = String(v); return true; }, get: function(t, k){ if (k === 'cssText') return state._cssText; return t[k] || ''; } }), enumerable: true, configurable: true });
  Object.defineProperty(el, 'innerHTML', { get: function(){ return state._innerHTML; }, set: function(v){ var key = String(v); var entry = __HTML_LOOKUP && __HTML_LOOKUP[key]; if (entry) { state._innerHTML = String(entry.html); state._qsaCount = entry.count|0; } else { state._innerHTML = key; state._qsaCount = 0; } }, enumerable: true, configurable: true });
  Object.defineProperty(el, 'outerHTML', { get: function(){ return '<' + tag + '>' + state._innerHTML + '</' + tag + '>'; }, enumerable: true });
  Object.defineProperty(el, 'srcdoc', { get: function(){ return state._srcdoc||''; }, set: function(v){ state._srcdoc = String(v); }, enumerable: true });
  Object.defineProperty(el, 'contentWindow', { get: function(){ var w = {}; w.document = __ifDoc; w.Proxy = Proxy; w.self = w; w.top = w; w.parent = w; w.window = w; return w; }, enumerable: true });
  Object.defineProperty(el, 'contentDocument', { get: function(){ return __ifDoc; }, enumerable: true });
  return el;
}
function __mkObj(name, base) {
  base = base || {};
  return new Proxy(base, {
    get: function(t, k) {
      if (k in t) return t[k];
      if (k === Symbol.toPrimitive) return function(){ return ''; };
      if (k === Symbol.iterator) return undefined;
      if (k === 'then' || k === 'catch' || k === 'finally') return undefined;
      if (k === 'constructor') return Object;
      if (k === 'toString' || k === 'valueOf') return function(){ return '[object ' + name + ']'; };
      if (k === 'length') return 0;
      if (k === 'nodeType') return 1;
      if (k === 'tagName' || k === 'nodeName') return 'DIV';
      if (k === 'innerHTML' || k === 'outerHTML' || k === 'textContent' || k === 'innerText' || k === 'value') return '';
      if (k === 'children' || k === 'childNodes' || k === 'classList') return [];
      if (k === 'offsetWidth' || k === 'offsetHeight' || k === 'clientWidth' || k === 'clientHeight' || k === 'scrollHeight' || k === 'scrollWidth') return 1;
      if (k === 'getBoundingClientRect') return function(){ return { x: 0, y: 0, top: 0, left: 0, right: 1, bottom: 1, width: 1, height: 1, toJSON: function(){ return {}; } }; };
      if (typeof k === 'string' && (k.indexOf('get') === 0 || k.indexOf('query') === 0 || k.indexOf('find') === 0)) return function(){ return k === 'querySelectorAll' || k === 'getElementsByTagName' || k === 'getElementsByClassName' ? [] : null; };
      return function(){ return __mkObj(name + '.' + String(k)); };
    },
    has: function(t, k){ return k in t; }, set: function(t, k, v){ t[k] = v; return true; }
  });
}
function __parseCssDisplay(cssText){ if(!cssText) return ''; var m = String(cssText).match(/(?:^|;)\\s*display\\s*:\\s*([^;]+)/i); return m ? String(m[1]).trim() : ''; }
function __getComputedStyle(el){ var cssText = el && el.style && el.style.cssText || ''; var display = __parseCssDisplay(cssText); return { getPropertyValue: function(name){ if(String(name).toLowerCase()==='display') return display; return ''; }, cssText: cssText, display: display }; }
var __ifMeta = __mkObj('meta', { getAttribute: function(a){ return a==='content' ? "default-src 'none'; script-src 'unsafe-inline';" : null; }, hasAttribute: function(a){ return a==='content'; }, tagName: 'META', nodeName: 'META' });
var __ifDoc = __mkObj('iframeDoc', { querySelector: function(s){ if (s && s.indexOf('Content-Security-Policy') !== -1) return __ifMeta; if (s === 'meta') return __ifMeta; return null; }, querySelectorAll: function(s){ if (s && s.indexOf('Content-Security-Policy') !== -1) return [__ifMeta]; if (s === 'meta') return [__ifMeta]; return []; }, getElementsByTagName: function(t){ return t && t.toLowerCase()==='meta' ? [__ifMeta] : []; }, body: __mkObj('iframeBody'), head: __mkObj('iframeHead'), documentElement: __mkObj('iframeRoot'), createElement: function(){ return __mkObj('elem', {setAttribute:function(){}, appendChild:function(){}, removeChild:function(){}, getAttribute:function(){return null;}, hasAttribute:function(){return false;}}); }, cookie: '', readyState: 'complete' });
var __iframeEl = __mkObj('iframe', { contentDocument: __ifDoc, contentWindow: __mkObj('iframeWin', { document: __ifDoc, top: undefined, parent: undefined }), document: __ifDoc, getAttribute: function(a){ if (a==='sandbox') return 'allow-scripts allow-same-origin'; if (a==='srcdoc') return ''; if (a==='id') return 'jsa'; return null; }, hasAttribute: function(a){ return a==='sandbox'||a==='id'; }, tagName: 'IFRAME', nodeName: 'IFRAME', id: 'jsa' });
var document = __mkObj('document', { querySelector: function(s){ if (s === '#jsa') return __iframeEl; if (s && s.indexOf('Content-Security-Policy') !== -1) return __ifMeta; return null; }, querySelectorAll: function(s){ if (s === '#jsa') return [__iframeEl]; if (s && s.indexOf('Content-Security-Policy') !== -1) return [__ifMeta]; return []; }, getElementById: function(id){ return id==='jsa' ? __iframeEl : null; }, getElementsByTagName: function(t){ if(t&&t.toLowerCase()==='iframe') return [__iframeEl]; return []; }, getElementsByClassName: function(){ return []; }, body: __mkObj('body', {appendChild:function(){}, removeChild:function(){}, querySelector:function(s){return s==='#jsa'?__iframeEl:null;}, querySelectorAll:function(s){return s==='#jsa'?[__iframeEl]:[];}}), head: __mkObj('head'), documentElement: __mkObj('root'), createElement: function(tag){ return __makeHtmlElement(tag||'div'); }, createTextNode: function(t){ return {nodeType:3, nodeValue:String(t||''), textContent:String(t||'')}; }, cookie: '', readyState: 'complete', title: '', addEventListener: function(){}, removeEventListener: function(){} });
  var window = __mkObj('window', { document: document, __DDG_BE_VERSION__: 1, __DDG_FE_CHAT_HASH__: 1, navigator: __mkObj('navigator', { userAgent: __ua, webdriver: false, language: 'en-US', languages: ['en-US','en'], platform: 'Linux x86_64', vendor: 'Google Inc.', appVersion: '5.0 (X11)', cookieEnabled: true, onLine: true, hardwareConcurrency: 8, deviceMemory: 8 }), innerWidth: 1280, innerHeight: 800, outerWidth: 1280, outerHeight: 800, devicePixelRatio: 1, screen: __mkObj('screen', { width:1920, height:1080, availWidth:1920, availHeight:1080, colorDepth:24, pixelDepth:24 }), location: __mkObj('location', { href:'https://duck.ai/', origin:'https://duck.ai', host:'duck.ai', hostname:'duck.ai', protocol:'https:', pathname:'/' }), performance: __mkObj('perf', { now: function(){ return 0; }, timeOrigin: 0 }), history: __mkObj('history', { length: 1, state: null }), addEventListener: function(){}, removeEventListener: function(){}, dispatchEvent: function(){return true;}, setTimeout: function(fn){ try{fn();}catch(e){} return 0; }, clearTimeout: function(){}, hasOwnProperty: function(k){ if (k==='__DDG_BE_VERSION__'||k==='__DDG_FE_CHAT_HASH__') return true; return Object.prototype.hasOwnProperty.call(this,k); } });
window.top = window; window.self = window; window.window = window; window.parent = window; window.globalThis = window;
var top = window, self = window, parent = window, navigator = window.navigator, location = window.location, screen = window.screen, performance = window.performance, history = window.history;
var __R = null, __E = null;
function __HTMLClass(name){ var c = function(){}; c.prototype = __mkObj(name+'.proto'); return c; }
var HTMLElement = __HTMLClass('HTMLElement'), HTMLDivElement = __HTMLClass('HTMLDivElement'), HTMLIFrameElement = __HTMLClass('HTMLIFrameElement'), HTMLDocument = __HTMLClass('HTMLDocument'), Document = __HTMLClass('Document'), Element = __HTMLClass('Element'), Node = __HTMLClass('Node'), Window = __HTMLClass('Window'), Event = __HTMLClass('Event'), MouseEvent = __HTMLClass('MouseEvent'), KeyboardEvent = __HTMLClass('KeyboardEvent'), TouchEvent = __HTMLClass('TouchEvent'), XMLHttpRequest = __HTMLClass('XMLHttpRequest'), WebSocket = __HTMLClass('WebSocket'), Image = __HTMLClass('Image'), FormData = __HTMLClass('FormData'), Blob = __HTMLClass('Blob'), File = __HTMLClass('File'), FileReader = __HTMLClass('FileReader'), URL = __HTMLClass('URL'), URLSearchParams = __HTMLClass('URLSearchParams'), Headers = __HTMLClass('Headers'), Request = __HTMLClass('Request'), Response = __HTMLClass('Response');
var fetch = function(){ return Promise.resolve(__mkObj('resp', {ok:true, status:200, json:function(){return Promise.resolve({});}, text:function(){return Promise.resolve('');}})); };
var getComputedStyle = __getComputedStyle;
`;

// ─── Challenge Solver ───────────────────────────────────────────────────

/**
 * Solve DDG's client-side JavaScript challenge.
 * Decodes base64 challenge, executes in VM sandbox with browser mocks,
 * and returns solved token for DDG API access.
 */
async function solveDuckDuckGoChallenge(
  challenge: string,
  userAgent: string,
): Promise<string> {
  const js = Buffer.from(challenge, 'base64').toString('utf8');
  const stubs = CHALLENGE_STUBS
    .replace('__DDG_REAL_UA__', JSON.stringify(userAgent))
    .replace('__DDG_HTML_LOOKUP__', JSON.stringify(buildHtmlLookup(js)));

  const context = vm.createContext({});
  vm.runInContext(stubs, context, { timeout: 5000 });

  const result = (await vm.runInContext(js, context, {
    timeout: 5000,
  })) as DdgChallengeResult;

  const clientHashes = Array.isArray(result.client_hashes) ? result.client_hashes : [];
  if (clientHashes.length === 0) {
    throw new Error('DuckDuckGo challenge returned empty client_hashes');
  }

  // First hash is replaced with the user agent
  clientHashes[0] = userAgent;
  result.client_hashes = clientHashes.map((hash) => sha256Base64(String(hash)));

  return Buffer.from(JSON.stringify(result), 'utf8').toString('base64');
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Solve DDG challenge and return anti-bot tokens.
 *
 * Flow:
 * 1. Seed browser cookies
 * 2. GET /duckchat/v1/status → x-vqd-hash-1 (challenge)
 * 3. Solve challenge in VM sandbox
 * 4. Return solved token
 */
export async function solveChallenge(options?: {
  userAgent?: string;
  proxyUrl?: string;
}): Promise<string> {
  const userAgent = options?.userAgent ?? DEFAULT_USER_AGENT;
  const cookieJar = new Map<string, string>();

  // Seed cookies
  for (const [name, value] of SEEDED_COOKIES) {
    cookieJar.set(name, value);
  }

  const headers: Record<string, string> = {
    ...FAKE_HEADERS,
    'x-vqd-accept': '1',
  };

  const cookie = serializeCookieJar(cookieJar);
  if (cookie) {
    headers['Cookie'] = cookie;
  }

  // Fetch status endpoint to get challenge
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(STATUS_URL, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`DDG status endpoint returned HTTP ${response.status}`);
    }

    // Collect cookies from response
    const setCookieHeader = response.headers.getSetCookie?.() ?? [];
    for (const sc of setCookieHeader) {
      applySetCookie(cookieJar, sc);
    }

    // Get challenge from x-vqd-hash-1 header
    const challenge = response.headers.get('x-vqd-hash-1');
    if (!challenge) {
      throw new Error('No x-vqd-hash-1 header in DDG status response');
    }

    // Solve challenge
    const solved = await solveDuckDuckGoChallenge(challenge, userAgent);

    return solved;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

/**
 * Get the anti-bot tokens (jsa, jsa_hash, dp) for DDG search APIs.
 * Uses the challenge solver to get the dp token.
 *
 * jsa=334 is static, jsa_hash is a static MD5 hash.
 * dp is the session fingerprint from the challenge solver.
 */
export async function getAntiBotTokens(): Promise<DdgAntiBotTokens> {
  const dp = await solveChallenge();

  return {
    jsa: '334',
    jsa_hash: '6f908ed2f5dfacd650dd321a8b805c8b',
    dp,
  };
}
