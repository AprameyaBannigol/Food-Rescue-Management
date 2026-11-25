// Entry point to run the workers as their own process: `npm run worker`.
// Use it with RUN_WORKERS=false on the API process.
const logger = require('../lib/logger');
const { startWorkers } = require('./workers');

startWorkers().catch((err) => {
  logger.error({ err }, 'worker failed to start');
  process.exit(1);
});
