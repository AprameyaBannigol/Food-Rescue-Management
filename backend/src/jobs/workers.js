// BullMQ worker: runs the timed steps of the flow.
const { Worker } = require('bullmq');
const { createRedis } = require('../lib/redis');
const logger = require('../lib/logger');
const { QUEUE_NAME, ensureRepeatableJobs } = require('./queues');
const { runListingWave } = require('../services/listingFlow');
const { runVolunteerStage } = require('../services/deliveryFlow');
const { runSweep } = require('../services/sweep');

async function processJob(job) {
  switch (job.name) {
    case 'listing-wave':
      return runListingWave(job.data.listingId, job.data.waveNo);
    case 'volunteer-stage':
      return runVolunteerStage(job.data.deliveryId, job.data.stage, job.data.round);
    case 'sweep':
      return runSweep();
    default:
      throw new Error(`Unknown job ${job.name}`);
  }
}

async function startWorkers() {
  await ensureRepeatableJobs();
  const worker = new Worker(QUEUE_NAME, processJob, { connection: createRedis(), concurrency: 5 });
  worker.on('failed', (job, err) => logger.error({ err, job: job?.name, data: job?.data }, 'job failed'));
  logger.info('BullMQ worker started');
  return worker;
}

module.exports = { startWorkers, processJob };
