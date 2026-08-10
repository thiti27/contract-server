import config from './config/config.js';
import { createApp } from './config/express.js';
import { initDatabase } from './config/mysql.js';
import routes from './app/routes/index.js';
import { registerJobs } from './app/jobs/index.js';

const app = createApp();
app.use(routes);
registerJobs();

initDatabase()
  .then(() => app.listen(config.port, () => console.log(`Contract server running at http://localhost:${config.port} (MySQL: ${config.db.name})`)))
  .catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
