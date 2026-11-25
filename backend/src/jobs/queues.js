// BullMQ queue and helpers to schedule the timed steps of the flow.
const { Queue } = require('bullmq');
const { createRedis } = require('../lib/redis');
const { MINUTE } = require('../lib/time');

const QUEUE_NAME = 'food-rescue';
let queue = null;

function getQueue() {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: createRedis(),
      defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    });
  }
  return queue;
}

// jobIds are deterministic so the same step is never queued twice.
function scheduleListingWave(listingId, waveNo, delayMinutes = 0) {
  return getQueue().add(
    'listing-wave',
    { listingId, waveNo },
    { jobId: `listing-wave-${listingId}-${waveNo}`, delay: delayMinutes * MINUTE },
  );
}

function scheduleVolunteerStage(deliveryId, stage, round, delayMinutes = 0) {
  return getQueue().add(
    'volunteer-stage',
    { deliveryId, stage, round },
    { jobId: `volunteer-stage-${deliveryId}-${round}-${stage}`, delay: delayMinutes * MINUTE },
  );
}

// The minute-by-minute sweep: expiry, stale assignments, auto-confirm, stale offers.
async function ensureRepeatableJobs() {
  await getQueue().upsertJobScheduler('sweep-every-minute', { every: MINUTE }, { name: 'sweep', data: {} });
}

async function closeQueue() {
  if (queue) await queue.close();
  queue = null;
}

module.exports = { QUEUE_NAME, getQueue, scheduleListingWave, scheduleVolunteerStage, ensureRepeatableJobs, closeQueue };
