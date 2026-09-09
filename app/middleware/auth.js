import { verify } from '../../config/jwt.js';

// Every /api route except login requires `Authorization: Bearer <token>` (see
// app/routes/index.js). jsonwebtoken's verify() throws for a missing/invalid
// signature (JsonWebTokenError) and separately for an expired token
// (TokenExpiredError) — both map to the same 401 response, since the client-side
// handling is identical either way (send the user back to login).
export async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    req.user = verify(token);
    next();
  } catch (err) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
  }
}

// Applied in addition to authenticate above (never instead of it) — for routes that
// need more than just "logged in", e.g. Settings > Role Management (see role.routes.js).
// The frontend already hides these actions from non-admins (RequireRole on /settings),
// but that's only a UI convenience; this is what actually stops a non-admin who's
// still a valid logged-in user from calling the API directly.
export function requireAdmin(req, res, next) {
  if (!req.user?.admin) {
    return res.status(403).json({ success: false, message: 'Admin permission is required.' });
  }
  next();
}
