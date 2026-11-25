// Express app (no listening here, so tests can import it).
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const pinoHttp = require('pino-http');
const env = require('./config/env');
const logger = require('./lib/logger');
const prisma = require('./lib/prisma');
const { redis } = require('./lib/redis');
const { notFoundHandler, errorHandler } = require('./middleware/error');

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(','), credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (env.NODE_ENV !== 'test') app.use(
      pinoHttp({
        logger,
        serializers: {
          req: (r) => ({ method: r.method, url: r.url }),
          res: (r) => ({ statusCode: r.statusCode }),
        },
      }),
    );

  app.get('/health', async (_req, res) => {
    const [db, cache] = await Promise.allSettled([prisma.$queryRaw`SELECT 1`, redis.ping()]);
    const ok = db.status === 'fulfilled' && cache.status === 'fulfilled';
    res.status(ok ? 200 : 503).json({ ok, db: db.status, redis: cache.status });
  });

  app.use('/api/auth', require('./modules/auth'));
  app.use('/api/profile', require('./modules/profiles').router);
  app.use('/api/listings', require('./modules/listings'));
  app.use('/api/deliveries', require('./modules/deliveries'));
  app.use('/api/offers', require('./modules/offers'));
  app.use('/api/issues', require('./modules/issues'));
  app.use('/api/stats', require('./modules/stats'));
  app.use('/api/admin', require('./modules/admin'));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
