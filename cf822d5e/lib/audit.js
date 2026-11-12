import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { AUDIT_FILE, DATA_DIR } from './config.js';

function ensureFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(AUDIT_FILE)) fs.writeFileSync(AUDIT_FILE, '');
}

export function record(event) {
  ensureFile();
  const entry = {
    id: `evt_${randomUUID().slice(0, 8)}`,
    ts: new Date().toISOString(),
    actor: 'system',
    status: 'info',
    ...event
  };
  fs.appendFileSync(AUDIT_FILE, `${JSON.stringify(entry)}\n`);
  return entry;
}

export function readAudit({ sessionId = null, limit = 400 } = {}) {
  ensureFile();
  const lines = fs.readFileSync(AUDIT_FILE, 'utf8')
    .split('\n')
    .filter(Boolean);

  let entries;
  try {
    entries = lines.map((line) => JSON.parse(line));
  } catch {
    entries = [];
  }

  if (sessionId) entries = entries.filter((entry) => entry.sessionId === sessionId);
  return entries.slice(-Math.max(1, Math.min(Number(limit) || 400, 2000)));
}

export function auditCount() {
  ensureFile();
  return fs.readFileSync(AUDIT_FILE, 'utf8').split('\n').filter(Boolean).length;
}

export function clearAudit() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(AUDIT_FILE, '');
}
