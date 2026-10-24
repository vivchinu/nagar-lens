import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '.env') });

const { getDb, resetToSeed, MEDIA_DIR } = await import('./store.js');
const { runAgent, runTool, fileReport } = await import('./agent.js');
const { hasGemini, modelName } = await import('./gemini.js');
const { BADGES, STAGES, TITLES, POINTS } = await import('./tools.js');

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use('/media', express.static(MEDIA_DIR, { maxAge: '1h' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, gemini: hasGemini(), model: hasGemini() ? modelName() : 'offline' }));

app.get('/api/state', (_req, res) => {
  const db = getDb();
  res.json({
    meta: db.meta, wards: db.wards, departments: db.departments, complaints: db.complaints,
    users: db.users.map(({ inbox, awardLog, ...u }) => ({ ...u, unseen: inbox?.length || 0 })),
    catalog: { badges: BADGES, stages: STAGES, titles: TITLES, points: POINTS },
    agent: { gemini: hasGemini(), model: hasGemini() ? modelName() : 'offline' },
  });
});

// Shared NDJSON streaming wrapper: ?stream=1 sends tool events as they happen, then { type: 'done', ... }.
async function streamOrJson(req, res, fn) {
  const stream = req.query.stream === '1';
  if (stream) {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.flushHeaders();
  }
  const send = (ev) => stream && res.write(JSON.stringify(ev) + '\n');
  try {
    const out = await fn(send);
    if (stream) { send({ type: 'done', ...out }); res.end(); } else res.json(out);
  } catch (e) {
    console.error(req.path, e);
    if (stream) { send({ type: 'error', error: e.message }); res.end(); } else res.status(400).json({ error: e.message });
  }
}

// Report step 2: citizen confirmed the draft. Body: { user, issueType, severity, description, note, wardId, photoUrl, location, areaName, force }
app.post('/api/report/file', (req, res) => streamOrJson(req, res, (send) => fileReport(req.body || {}, send)));

// Main agent endpoint. Body: { message, image?(data URL), location?{lat,lng,accuracy}, areaName?, user, role, ticketId?, history? }
// Add ?stream=1 to receive newline-delimited JSON events (tool calls as they happen, then { type: 'done', ... }).
app.post('/api/agent', async (req, res) => {
  const stream = req.query.stream === '1';
  if (stream) {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
  }
  const send = (ev) => stream && res.write(JSON.stringify(ev) + '\n');
  try {
    const out = await runAgent(req.body || {}, send);
    if (stream) { send({ type: 'done', ...out }); res.end(); } else res.json(out);
  } catch (e) {
    console.error('[agent]', e);
    if (stream) { send({ type: 'error', error: e.message }); res.end(); } else res.status(400).json({ error: e.message });
  }
});

// Direct single-tool calls from UI buttons. Body: { args, user, role, image?, photoName? }
app.post('/api/tools/:name', async (req, res) => {
  const allowed = ['plus_one', 'update_status', 'verify_completion', 'get_status', 'get_badges', 'get_leaderboard', 'list_complaints', 'lookup_ward_department', 'check_duplicates'];
  if (!allowed.includes(req.params.name)) return res.status(404).json({ error: 'Unknown tool' });
  try {
    res.json(await runTool(req.params.name, req.body || {}));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/demo/reset', (_req, res) => {
  resetToSeed();
  res.json({ ok: true, message: 'Demo data restored from seed.' });
});

// Optional: serve the built client from the same port (npm run build in client/).
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) => (req.method === 'GET' && !req.path.startsWith('/api') ? res.sendFile(path.join(dist, 'index.html')) : next()));
}

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  getDb();
  console.log(`Nagar Lens server on http://localhost:${PORT}  (agent: ${hasGemini() ? modelName() : 'OFFLINE — set GEMINI_API_KEY'})`);
});
