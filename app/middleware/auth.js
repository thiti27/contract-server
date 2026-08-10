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
