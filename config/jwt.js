import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// config/ sits one level below the project root, where .env.development and
// .env.production live (same depth config/express.js's projectRoot uses).
const projectRoot = path.join(__dirname, '..');

// Loaded here (not in server.js) so this file is fully self-contained regardless of
// which module imports it first or in what order — ESM hoists all static imports'
// module evaluation ahead of any code in the importing file, so relying on server.js
// to call dotenv.config() before this file runs would be fragile. dotenv.config()
// never overwrites a variable already present in process.env (e.g. real deployment
// env vars), it only fills in what's missing from the file.
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
dotenv.config({ path: path.join(projectRoot, envFile) });

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXP = process.env.JWT_EXP || '1d';

// Fail fast at startup rather than silently signing/verifying tokens with
// `undefined` as the secret — an incomplete config should never make it to a
// running server.
if (!JWT_SECRET) {
  throw new Error(`JWT_SECRET is not set. Add it to ${envFile} before starting the server.`);
}

export function sign(payload, options = {}) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXP, ...options });
}

export function verify(token) {
  return jwt.verify(token, JWT_SECRET);
}

export function decode(token) {
  return jwt.decode(token);
}

export default { sign, verify, decode };
