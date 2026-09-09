import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// config/ is one level below the project root (where server.js lives) — same
// relative depth server.js's own __dirname used to sit at before this refactor.
const projectRoot = path.join(__dirname, '..');

export function createApp() {
  const app = express();
  // Content-Disposition isn't one of the browser's default CORS-safelisted response
  // headers — without explicitly exposing it, the frontend's own download helpers
  // (downloadUploadFile, downloadUploadFileFromPath) can't read the real filename+
  // extension res.download() below (and uploadController.downloadUpload) sets, and end
  // up saving the file with no extension at all.
  app.use(cors({ exposedHeaders: ['Content-Disposition'] }));
  app.use(express.json());
  app.use('/files', express.static(path.join(projectRoot, 'storage')));

  return app;
}
