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

// Decodes a Bearer token into req.user when one is present and valid, but — unlike
// authenticate above — never rejects the request for a missing/invalid one; req.user
// is just left undefined and next() still runs. For the small set of routes that must
// work for a logged-out visitor (a non-confidential Contract Documents download link
// opened straight from an email, no session at all) while still telling a logged-in
// visitor who they are (so HIGH CONFIDENTIAL authorization — creator/`view`/approver —
// can be checked downstream, same hasConfidentialAccess rule every authenticated route
// already uses). Never apply this to a route that assumes req.user unconditionally
// exists (i.e. almost everything else) — only to a handler written to treat a missing
// req.user as "anonymous visitor" explicitly.
export async function optionalAuthenticate(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme === 'Bearer' && token) {
    try {
      req.user = verify(token);
    } catch (err) {
      // Invalid/expired token on an optional route: proceed as anonymous rather than
      // 401ing — same as no token at all. A route that actually requires a valid
      // session for a confidential document still ends up blocking correctly further
      // down (req.user stays undefined, hasConfidentialAccess(row, undefined) is
      // false for a confidential row), just with a clean "please log in" outcome
      // instead of surfacing this token's specific decode error.
    }
  }
  next();
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
