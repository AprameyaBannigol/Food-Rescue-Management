const IORedis = require('ioredis');
const env = require('../config/env');

// BullMQ needs maxRetriesPerRequest: null on the connections it uses.
function createRedis() {
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

const redis = createRedis();

module.exports = { redis, createRedis };
