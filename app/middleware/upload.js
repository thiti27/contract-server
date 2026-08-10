import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// app/middleware/ sits two levels below the project root (where storage/ lives).
const projectRoot = path.join(__dirname, '..', '..');

// Uploaded documents are stored on disk under a generated UUID with no extension —
// the original name + extension only ever live in the file_uploads table, so a
// leaked/guessed storage filename reveals nothing about the file's real name or type.
export const uploadsDir = path.join(projectRoot, 'storage', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, _file, cb) => cb(null, randomUUID()),
});

export const upload = multer({ storage: uploadStorage, limits: { fileSize: 25 * 1024 * 1024 } });
