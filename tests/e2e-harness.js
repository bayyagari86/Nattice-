// Shared harness for the browser E2E tests: local PeerJS broker, static
// server with vendored CDN libs, Chromium launcher and small helpers.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { PeerServer } = require('peer');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..');

function startStaticServer(port) {
  const mimeTypes = {
    '.html': 'text/html', '.js': 'application/javascript',
    '.css': 'text/css', '.json': 'application/json',
    '.png': 'image/png', '.svg': 'image/svg+xml',
  };
  const vendor = {
    '/__vendor/peerjs.min.js': 'vendor/peerjs.min.js',
    '/__vendor/qrcode.min.js': 'vendor/qrcode.min.js',
  };
  const server = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    // The test container has no outbound internet, so CDN libs are served
    // from tests/vendor/. Production is unaffected.
    if (vendor[urlPath]) {
      res.setHeader('Content-Type', 'application/javascript');
      return fs.createReadStream(path.join(__dirname, vendor[urlPath])).pipe(res);
    }
    const filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
    if (!filePath.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.statusCode = 404; res.end('not found'); return; }
      const ext = path.extname(filePath);
      res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      if (ext === '.html') {
        let html = data.toString('utf8');
        html = html.replace(/https:\/\/unpkg\.com\/peerjs[^"']+/g, '/__vendor/peerjs.min.js');
        html = html.replace(/https:\/\/cdnjs\.cloudflare\.com\/[^"']*qrcode[^"']+/g, '/__vendor/qrcode.min.js');
        return res.end(html);
      }
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

async function startPeerServer(port) {
  const peerServer = PeerServer({ port, path: '/', allow_discovery: true });
  await new Promise(r => setTimeout(r, 500));
  return peerServer;
}

function stopPeerServer(peerServer) {
  try {
    if (peerServer._server) peerServer._server.close();
    else if (peerServer.close) peerServer.close();
  } catch (_) {}
}

function launchBrowser() {
  return puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--allow-loopback-in-peer-connection'],
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitFor(page, fn, { timeoutMs = 15000, pollMs = 200, label = 'condition', arg } = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    try {
      last = await page.evaluate(fn, arg);
      if (last) return last;
    } catch (_) { /* page may be navigating */ }
    await sleep(pollMs);
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms: ${label}`);
}

// Forward page output. verbose=false keeps only warnings/errors and network
// lifecycle lines so a failing run is still diagnosable.
function tapConsole(page, tag, { verbose = !!process.env.E2E_VERBOSE } = {}) {
  page.on('console', msg => {
    const text = msg.text();
    const important = msg.type() === 'error' || msg.type() === 'warning' ||
      /migrat|promot|step|term|rejoin|reconnect|host|reject/i.test(text);
    if (verbose || important) console.log(`      [${tag}] ${text}`);
  });
  page.on('pageerror', err => console.log(`      [${tag}] PAGE ERROR: ${err.message}`));
}

module.exports = { startStaticServer, startPeerServer, stopPeerServer, launchBrowser, waitFor, tapConsole, sleep };
