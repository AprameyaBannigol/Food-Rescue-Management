// Runs every minute (BullMQ repeatable job). Moves stuck things along:
//  1. Expiry: food whose best-before minus travel time has passed, not yet picked up -> expired.
//     This rule wins over every other state.
//  2. Assigned deliveries not picked up by pickup_until -> back to unassigned.
//  3. Delivered deliveries the NGO has not confirmed in 2 hours -> auto-confirmed.
//  4. Unanswered offers past their expiry -> expired.
const prisma = require('../lib/prisma');
const logger = require('../lib/logger');
const { addMinutes, HOUR } = require('../lib/time');
const { getSettings } = require('./settings');
const { travelMinutes } = require('./geo');
const { recordStatus } = require('./statusEvents');
const { notifyUsers, notifyAdmins } = require('./notify');
const { emitTo, rooms } = require('../realtime/emitter');
const { failDelivery, unassignDelivery, confirmReceipt } = require('./deliveryFlow');

const NOT_PICKED_UP = ['unassigned', 'assigned'];
const PICKED_OR_LATER = ['picked_up', 'delivered', 'confirmed'];

async function expireListings(now, settings) {
  // Generous window first; the exact per-listing check is below.
  const horizon = addMinutes(now, 180);
  const candidates = await prisma.listing.findMany({
    where: {
      status: { in: ['posted', 'offered', 'partially_claimed', 'fully_claimed'] },
      bestBefore: { lte: horizon },
    },
    include: { donor: true, claims: { include: { delivery: true } } },
  });

  let expired = 0;
  for (const listing of candidates) {
    const deliveries = listing.claims.map((c) => c.delivery).filter(Boolean);
    const waiting = deliveries.filter((d) => NOT_PICKED_UP.includes(d.status));
    const unclaimedLeft = listing.remainingServings > 0 && ['posted', 'offered', 'partially_claimed'].includes(listing.status);
    if (waiting.length === 0 && !unclaimedLeft) continue;

    // Deliveries already waiting: expire each one whose own trip no longer fits.
    for (const d of waiting) {
      const minutes = travelMinutes(d.distanceKm ?? 0, settings);
      if (addMinutes(listing.bestBefore, -minutes) <= now) {
        await failDelivery(d.id, null, {
          reason: 'Food reached its safe time limit before pickup',
          claimStatus: 'cancelled', // not the NGO's fault: does not hurt its reliability
          openIssue: false,
        });
      }
    }

    // The unclaimed remainder: use a default trip estimate.
    const stillWaiting = await prisma.delivery.count({
      where: { claim: { listingId: listing.id }, status: { in: NOT_PICKED_UP } },
    });
    const pastLimit = addMinutes(listing.bestBefore, -settings.default_travel_minutes) <= now;
    if (!pastLimit || stillWaiting > 0) continue;

    const anyPicked = await prisma.delivery.count({
      where: { claim: { listingId: listing.id }, status: { in: PICKED_OR_LATER } },
    });
    if (anyPicked > 0) {
      // Part of it went out; close the rest.
      if (listing.remainingServings > 0) {
        await prisma.listing.update({ where: { id: listing.id }, data: { remainingServings: 0 } });
        await recordStatus(prisma, {
          entityType: 'listing',
          entityId: listing.id,
          fromStatus: listing.status,
          toStatus: listing.status,
          note: `${listing.remainingServings} unclaimed servings expired`,
        });
      }
      continue;
    }

    await prisma.listing.update({ where: { id: listing.id }, data: { status: 'expired', remainingServings: 0 } });
    await prisma.offer.updateMany({ where: { listingId: listing.id, response: 'none' }, data: { response: 'expired' } });
    await recordStatus(prisma, {
      entityType: 'listing',
      entityId: listing.id,
      fromStatus: listing.status,
      toStatus: 'expired',
      note: 'best-before minus travel time passed before pickup',
    });
    emitTo(rooms.listing(listing.id), 'listing:status', { listingId: listing.id, status: 'expired' });
    emitTo(rooms.admins, 'listing:status', { listingId: listing.id, status: 'expired' });
    const message = {
      type: 'expired',
      title: 'Food expired',
      body: `"${listing.title}" could not be delivered in its safe window. Please dispose of it safely.`,
      data: { listingId: listing.id },
      urgent: true,
    };
    await notifyUsers([listing.donor.userId], message);
    await notifyAdmins({ ...message, urgent: false });
    expired += 1;
  }
  return expired;
}

async function unassignLate(now) {
  const late = await prisma.delivery.findMany({
    where: { status: 'assigned', claim: { listing: { pickupUntil: { lt: now } } } },
    select: { id: true },
  });
  for (const d of late) await unassignDelivery(d.id, 'Volunteer did not reach the donor before the pickup window closed');
  return late.length;
}

async function autoConfirm(now, settings) {
  const cutoff = new Date(now.getTime() - settings.auto_confirm_hours * HOUR);
  const due = await prisma.delivery.findMany({
    where: { status: 'delivered', deliveredAt: { lte: cutoff } },
    select: { id: true },
  });
  for (const d of due) await confirmReceipt(d.id, null, { auto: true });
  return due.length;
}

async function expireOffers(now) {
  const { count } = await prisma.offer.updateMany({
    where: { response: 'none', expiresAt: { lte: now } },
    data: { response: 'expired' },
  });
  return count;
}

async function runSweep(now = new Date()) {
  const settings = await getSettings();
  const result = {
    expiredListings: await expireListings(now, settings),
    unassigned: await unassignLate(now),
    autoConfirmed: await autoConfirm(now, settings),
    expiredOffers: await expireOffers(now),
  };
  if (Object.values(result).some((n) => n > 0)) logger.info(result, 'sweep');
  return result;
}

module.exports = { runSweep };
