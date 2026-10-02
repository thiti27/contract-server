// Default values used when the corresponding process.env var isn't set. These match
// exactly what db/sequelize.js hardcoded before this refactor — kept identical to
// production.js on purpose (see config/env/production.js for why) so introducing
// per-environment config doesn't silently change which DB either environment talks to.
export default {
  PORT: 1312,
  DB_HOST: '127.0.0.1',
  DB_PORT: '3306',
  DB_USER: 'root',
  DB_PASSWORD: '12345',
  DB_NAME: 'contract_db',
  EMAIL_HOST: '10.227.101.30',
  EMAIL_PORT: 25,
  EMAIL_FROM: 'Contract_Online@dsst.Daicel.com',
  // The real deployed Contract Online System web app (frontend on port 7012, distinct
  // from this server's own PORT 1312 above) — every caller can still override this
  // per-email via data.systemUrl (see contractEmail.service.js), so this default only
  // matters when a caller doesn't pass one, which today is every caller (the frontend
  // never actually sends systemUrl — see notifyRequestorApproved's own comment on that).
  SYSTEM_URL: 'http://localhost:5173/',
};
