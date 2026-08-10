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
};
