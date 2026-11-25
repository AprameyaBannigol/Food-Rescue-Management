const http = require('node:http');
const env = require('./config/env');
const logger = require('./lib/logger');
const prisma = require('./lib/prisma');
const { createApp } = require('./app');
const { attachSocket } = require('./realtime/socket');
const { startWorkers } = require('./jobs/workers');

async function main() {
  const app = createApp();
  const server = http.createServer(app);
  attachSocket(server);
  const worker = env.RUN_WORKERS ? await startWorkers() : null;

  server.listen(env.PORT, () => logger.info(`API listening on http://localhost:${env.PORT}`));

  const shutdown = async () => {
    logger.info('shutting down');
    server.close();
    if (worker) await worker.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'failed to start');
  process.exit(1);
});
