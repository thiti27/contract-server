import path from 'node:path';
import { clientBuildPath } from '../../config/express.js';

// Serves the React frontend's index.html for any path not matched by an API route or
// a static file — lets client-side routing (react-router) handle deep links/refreshes.
export function serveIndex(req, res) {
  res.sendFile(path.join(clientBuildPath, 'index.html'));
}
