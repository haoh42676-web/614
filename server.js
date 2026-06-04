const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_ACCOUNT = process.env.ADMIN_ACCOUNT || '13246429006';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '102906';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_OWNER = process.env.GITHUB_OWNER || '';
const GITHUB_REPO = process.env.GITHUB_REPO || '';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const GITHUB_DATA_PATH = process.env.GITHUB_DATA_PATH || 'cloud/events.json';
const ADMIN_TOKEN = crypto
  .createHash('sha256')
  .update(`${ADMIN_ACCOUNT}:${ADMIN_PASSWORD}:${process.env.ADMIN_SECRET || '614-dorm-platform'}`)
  .digest('hex');

const rootDir = __dirname;
const dataDir = path.join(rootDir, 'data');
const eventsFile = path.join(dataDir, 'events.json');
const htmlFile = path.join(rootDir, '614宿舍综合平台.html');

function ensureDataFile() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(eventsFile)) fs.writeFileSync(eventsFile, '[]\n', 'utf8');
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload));
}

function sanitizeEvent(event) {
  return {
    id: String(event.id || `ACT${Date.now()}`),
    action: String(event.action || 'unknown'),
    page: String(event.page || ''),
    user: String(event.user || 'guest'),
    details: event.details && typeof event.details === 'object' ? event.details : {},
    deviceId: String(event.deviceId || ''),
    userAgent: String(event.userAgent || '').slice(0, 300),
    createdAt: String(event.createdAt || new Date().toISOString()),
    receivedAt: new Date().toISOString()
  };
}

function appendEvents(incoming) {
  ensureDataFile();
  const current = JSON.parse(fs.readFileSync(eventsFile, 'utf8') || '[]');
  const events = (Array.isArray(incoming) ? incoming : [incoming]).map(sanitizeEvent);
  const merged = current.concat(events).slice(-5000);
  fs.writeFileSync(eventsFile, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return { events, allEvents: merged };
}

function githubRequest(method, apiPath, payload) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : '';
    const req = https.request({
      hostname: 'api.github.com',
      path: apiPath,
      method,
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': '614-dorm-platform',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        const data = text ? JSON.parse(text) : {};
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
        else reject(new Error(`GitHub ${res.statusCode}: ${text}`));
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function syncToGitHub(allEvents) {
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) return { skipped: true };
  const apiPath = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(GITHUB_DATA_PATH).replace(/%2F/g, '/')}`;
  let sha = undefined;
  try {
    const existing = await githubRequest('GET', `${apiPath}?ref=${encodeURIComponent(GITHUB_BRANCH)}`);
    sha = existing.sha;
  } catch (error) {
    if (!String(error.message).includes('GitHub 404')) throw error;
  }
  const content = Buffer.from(JSON.stringify(allEvents, null, 2) + '\n', 'utf8').toString('base64');
  await githubRequest('PUT', apiPath, {
    message: `sync dorm events ${new Date().toISOString()}`,
    content,
    sha,
    branch: GITHUB_BRANCH
  });
  return { skipped: false };
}

function serveStatic(res, filePath, contentType) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.url === '/' || req.url === '/index.html') {
    serveStatic(res, htmlFile, 'text/html; charset=utf-8');
    return;
  }

  if (req.url === '/api/events' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req);
      const incoming = Array.isArray(payload.events) ? payload.events : payload.event;
      const result = appendEvents(incoming || []);
      let github = { skipped: true };
      try {
        github = await syncToGitHub(result.allEvents);
      } catch (error) {
        github = { skipped: false, error: error.message };
      }
      sendJson(res, 200, { ok: true, received: result.events.length, github });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (req.url === '/api/admin/login' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req);
      const ok = payload.account === ADMIN_ACCOUNT && payload.password === ADMIN_PASSWORD;
      sendJson(res, 200, { ok, adminToken: ok ? ADMIN_TOKEN : '' });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (req.url === '/api/admin/events' && req.method === 'GET') {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${ADMIN_TOKEN}`) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }
    ensureDataFile();
    sendJson(res, 200, { events: JSON.parse(fs.readFileSync(eventsFile, 'utf8') || '[]') });
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

ensureDataFile();
server.listen(PORT, () => {
  console.log(`614 dorm platform listening on http://localhost:${PORT}`);
});
