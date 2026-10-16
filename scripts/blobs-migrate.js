// Blobs migration tool — The Build Session.
// Usage (Node 18+, credentials in environment only, never in code):
//   NETLIFY_SITE_ID=... NETLIFY_AUTH_TOKEN=... node scripts/blobs-migrate.js backup
//   NETLIFY_SITE_ID=... NETLIFY_AUTH_TOKEN=... node scripts/blobs-migrate.js push --from data/applicants.json
//   NETLIFY_SITE_ID=... NETLIFY_AUTH_TOKEN=... node scripts/blobs-migrate.js restore --file backups/blobs-2026-10-15T12-00-00.json
//
// push ALWAYS writes a timestamped backup to backups/ first (that file is your rollback).
// restore uploads a backup file back to the Blobs store (after backing up current state).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStore } from '@netlify/blobs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const STORE_NAME = 'build-session';
const KEY = 'applicants.json';

function store() {
  const { NETLIFY_SITE_ID: siteID, NETLIFY_AUTH_TOKEN: token } = process.env;
  if (!siteID || !token) throw new Error('Set NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN in the environment.');
  return getStore({ name: STORE_NAME, siteID, token });
}

function backupPath() {
  fs.mkdirSync(path.join(ROOT, 'backups'), { recursive: true });
  return path.join(ROOT, 'backups', `blobs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
}

function normalize(d) {
  if (!d) return { applicants: [], processedEvents: [] };
  if (Array.isArray(d)) return { applicants: d, processedEvents: [] };
  return { applicants: d.applicants || [], processedEvents: d.processedEvents || [] };
}

function validateShape(d) {
  if (!d || !Array.isArray(d.applicants) || !Array.isArray(d.processedEvents)) {
    throw new Error('Invalid data shape: expected { applicants: [], processedEvents: [] }');
  }
  for (const a of d.applicants) {
    if (!a.reference || !a.email) throw new Error('Invalid applicant row (missing reference/email)');
  }
}

const cmd = process.argv[2];
const flag = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
};

if (cmd === 'backup') {
  const s = store();
  const current = normalize(await s.get(KEY, { type: 'json' }));
  const file = backupPath();
  fs.writeFileSync(file, JSON.stringify(current, null, 2));
  console.log(`Backed up ${current.applicants.length} applicant(s), ${current.processedEvents.length} event(s) -> ${path.relative(ROOT, file)}`);
} else if (cmd === 'push') {
  const from = flag('--from');
  if (!from) throw new Error('Usage: push --from <local-json-file>');
  const local = normalize(JSON.parse(fs.readFileSync(path.resolve(ROOT, from), 'utf8')));
  validateShape(local);
  const s = store();
  const current = normalize(await s.get(KEY, { type: 'json' }));
  const file = backupPath();
  fs.writeFileSync(file, JSON.stringify(current, null, 2));
  console.log(`Pre-push backup (${current.applicants.length} row(s)) -> ${path.relative(ROOT, file)}`);
  await s.setJSON(KEY, local);
  console.log(`Pushed ${local.applicants.length} applicant(s) to Blobs store "${STORE_NAME}/${KEY}"`);
} else if (cmd === 'restore') {
  const file = flag('--file');
  if (!file) throw new Error('Usage: restore --file <backup-json-file>');
  const data = normalize(JSON.parse(fs.readFileSync(path.resolve(ROOT, file), 'utf8')));
  validateShape(data);
  const s = store();
  const current = normalize(await s.get(KEY, { type: 'json' }));
  const bk = backupPath();
  fs.writeFileSync(bk, JSON.stringify(current, null, 2));
  console.log(`Pre-restore backup -> ${path.relative(ROOT, bk)}`);
  await s.setJSON(KEY, data);
  console.log(`Restored ${data.applicants.length} applicant(s) from ${file}`);
} else {
  console.log('Usage: backup | push --from <file> | restore --file <backup>');
  process.exit(1);
}
