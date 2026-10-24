// Tiny JSON-file "database" for the mock AMC system.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_FILE = path.join(__dirname, 'data', 'amc.json');
export const SEED_FILE = path.join(__dirname, 'data', 'amc.seed.json');
export const MEDIA_DIR = path.join(__dirname, 'media');
export const UPLOAD_DIR = path.join(MEDIA_DIR, 'uploads');

let db = null;

export function load() {
  if (!fs.existsSync(DATA_FILE)) fs.copyFileSync(SEED_FILE, DATA_FILE);
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  return db;
}

export function getDb() {
  return db || load();
}

export function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

export function resetToSeed() {
  fs.copyFileSync(SEED_FILE, DATA_FILE);
  db = null;
  return load();
}

const MIME_EXT = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/jpg': 'jpg' };

// Saves a base64 data URL to media/uploads and returns { url, mime, base64 }.
export function saveDataUrl(dataUrl, prefix = 'photo') {
  const m = /^data:(image\/[\w+.-]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!m) throw new Error('Image must be a base64 data URL (data:image/...;base64,...)');
  const mime = m[1] === 'image/jpg' ? 'image/jpeg' : m[1];
  const ext = MIME_EXT[mime];
  if (!ext) throw new Error(`Unsupported image type ${mime}. Use JPEG, PNG or WebP.`);
  const name = `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), Buffer.from(m[2], 'base64'));
  return { url: `/media/uploads/${name}`, mime, base64: m[2] };
}

// Loads a stored image so it can be sent to Gemini. SVG seed art is skipped (Gemini can't read SVG).
export function readImageForModel(url) {
  if (!url || !url.startsWith('/media/')) return null;
  const file = path.normalize(path.join(MEDIA_DIR, url.slice('/media/'.length)));
  if (!file.startsWith(MEDIA_DIR) || !fs.existsSync(file)) return null;
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[ext];
  if (!mime) return null;
  return { url, mime, base64: fs.readFileSync(file).toString('base64') };
}
