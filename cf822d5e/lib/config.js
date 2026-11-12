import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, 'data');
export const STORE_FILE = path.join(DATA_DIR, 'store.json');
export const AUDIT_FILE = path.join(DATA_DIR, 'audit.jsonl');

export const PORT = Number(process.env.PORT || 4173);
export const STORE_NAME = 'Northwind Supply Co.';
export const AGENT_NAME = 'Penelope';
