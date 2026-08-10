import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// config/ is one level below the project root (where server.js lives) — same
// relative depth server.js's own __dirname used to sit at before this refactor.
const projectRoot = path.join(__dirname, '..');

// Serves the React frontend build — computed here (not inline in createApp) so the
// SPA fallback route (app/routes/spa.routes.js) can reuse the exact same path
// instead of recomputing it.
export const clientBuildPath = path.join(projectRoot, '../client/build');

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/files', express.static(path.join(projectRoot, 'storage')));

  // === เพิ่มด้านล่างนี้ ===
  // Serve React frontend
  app.use(express.static(clientBuildPath));

  return app;
}
