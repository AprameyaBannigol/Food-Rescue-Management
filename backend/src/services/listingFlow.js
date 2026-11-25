// Round 1 of matching as a timed flow: offer a listing to NGOs in waves.
const prisma = require('../lib/prisma');
const logger = require('../lib/logger');
const { addMinutes } = require('../lib/time');
const { getSettings } = require('./settings');
const { rankNgosForListing, finalOpenWave, OPEN_LISTING_STATUSES } = require('./matching');
const { recordStatus } = require('./statusEvents');
const { notifyUsers } = require('./notify');
const { escalate } = require('./escalation');
const { emitTo, rooms } = require('../realtime/emitter');
const { scheduleListingWave } = require('../jobs/queues');

// Wave n (1-based):
//   1..k   -> offer to the next offer_wave_sizes[n-1] best NGOs not yet offered
//   k+1    -> open to every NGO that passes the filters
//   k+2    -> final check: nobody claimed at all -> escalate "unmatched"
async function runListingWave(listingId, waveNo, { schedule = scheduleListingWave } = {}) {
  const settings = await getSettings();
  const now = new Date();
  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing) return { skipped: 'missing' };
  if (!OPEN_LISTING_STATUSES.includes(listing.status) || listing.remainingServings <= 0) {
    return { skipped: 'closed' };
  }

  // Offers from earlier waves that were not answered in time.
  await prisma.offer.updateMany({
    where: { listingId, response: 'none', expiresAt: { lte: now } },
    data: { response: 'expired' },
  });

  const openWave = finalOpenWave(settings);
  const claimCount = await prisma.claim.count({ where: { listingId, status: { not: 'cancelled' } } });

  if (waveNo > openWave) {
    if (claimCount === 0) {
      await escalate({
        type: 'unmatched',
        listingId,
        description: `No NGO claimed "${listing.title}" (${listing.remainingServings} servings) after every offer wave.`,
      });
      return { escalated: true };
    }
    return { done: true };
  }

  const { passing } = await rankNgosForListing(listing, settings, now);
  const alreadyOffered = new Set(
    (await prisma.offer.findMany({ where: { listingId }, select: { recipientUserId: true } })).map((o) => o.recipientUserId),
  );
  const fresh = passing.filter((p) => !alreadyOffered.has(p.userId));
  const take = waveNo < openWave ? settings.offer_wave_sizes[waveNo - 1] : fresh.length;
  const chosen = fresh.slice(0, take);

  const expiresAt = addMinutes(now, settings.offer_wave_minutes);
  if (chosen.length > 0) {
    await prisma.offer.createMany({
      data: chosen.map((c) => ({
        listingId,
        recipientUserId: c.userId,
        waveNo,
        score: c.score,
        expiresAt,
      })),
    });
    await notifyUsers(
      chosen.map((c) => c.userId),
      {
        type: 'listing_offered',
        title: 'New food nearby',
        body: `${listing.remainingServings} servings of "${listing.title}". Claim within ${settings.offer_wave_minutes} minutes.`,
        data: { listingId },
      },
    );
  }

  if (listing.status === 'posted') {
    await prisma.listing.update({ where: { id: listingId }, data: { status: 'offered' } });
    await recordStatus(prisma, {
      entityType: 'listing',
      entityId: listingId,
      fromStatus: 'posted',
      toStatus: 'offered',
      note: `wave ${waveNo}: ${chosen.length} NGOs`,
    });
    emitTo(rooms.listing(listingId), 'listing:status', { listingId, status: 'offered' });
  }

  // Nobody eligible at all and nobody ever offered: escalate now instead of waiting.
  if (alreadyOffered.size === 0 && chosen.length === 0 && claimCount === 0) {
    await escalate({
      type: 'unmatched',
      listingId,
      description: `No eligible NGO within ${settings.ngo_radius_km} km for "${listing.title}".`,
    });
    return { escalated: true, offered: 0 };
  }

  if (schedule) await schedule(listingId, waveNo + 1, settings.offer_wave_minutes);
  logger.info({ listingId, waveNo, offered: chosen.length }, 'listing wave');
  return { offered: chosen.length };
}

module.exports = { runListingWave };
