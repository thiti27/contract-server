import development from './env/development.js';
import production from './env/production.js';

const envDefaults = process.env.NODE_ENV === 'production' ? production : development;

// Real environment variables always win over the per-NODE_ENV defaults above —
// mirrors exactly how db/sequelize.js previously resolved each value
// (`process.env.DB_HOST || '127.0.0.1'`, etc.) before this refactor.
export default {
  port: process.env.PORT || envDefaults.PORT,
  db: {
    host: process.env.DB_HOST || envDefaults.DB_HOST,
    port: process.env.DB_PORT || envDefaults.DB_PORT,
    user: process.env.DB_USER || envDefaults.DB_USER,
    password: process.env.DB_PASSWORD || envDefaults.DB_PASSWORD,
    name: process.env.DB_NAME || envDefaults.DB_NAME,
  },
};
