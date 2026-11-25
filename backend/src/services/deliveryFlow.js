// Round 2 of matching and the delivery lifecycle:
// unassigned -> assigned -> picked_up -> delivered -> confirmed (or failed).
const prisma = require('../lib/prisma');
const { addMinutes } = require('../lib/time');
const { conflict, badRequest, forbidden, notFound } = require('../lib/errors');
const { safeEqual } = require('../lib/codes');
const { getSettings } = require('./settings');
const { rankVolunteersForDelivery } = require('./matching');
const { recordStatus } = require('./statusEvents');
const { notifyUsers } = require('./notify');
const { escalate } = require('./escalation');
const { emitTo, rooms } = require('../realtime/emitter');
const { scheduleVolunteerStage } = require('../jobs/queues');

const deliveryInclude = {
  claim: { include: { listing: { include: { donor: true } }, ngo: true } },
  volunteer: true,
};

async function loadDelivery(db, id) {
  const delivery = await db.delivery.findUnique({ where: { id }, include: deliveryInclude });
  if (!delivery) throw notFound('Delivery');
  return delivery;
}

// The "round" increases each time a delivery goes back to unassigned, so stale
// timers from an earlier round can tell they no longer apply.
async function currentRound(deliveryId) {
  return prisma.statusEvent.count({
    where: { entityType: 'delivery', entityId: deliveryId, toStatus: 'unassigned' },
  });
}

function broadcastDelivery(delivery, status, extra = {}) {
  const payload = { deliveryId: delivery.id, listingId: delivery.claim.listingId, status, ...extra };
  emitTo(rooms.delivery(delivery.id), 'delivery:status', payload);
  emitTo(rooms.listing(delivery.claim.listingId), 'delivery:status', payload);
  emitTo(rooms.admins, 'delivery:status', payload);
}

// Offers the delivery to the best `count` volunteers within radiusKm who were not offered it before.
async function offerToVolunteers(delivery, { radiusKm, count, waveNo }, settings) {
  const previous = await prisma.offer.findMany({ where: { deliveryId: delivery.id }, select: { recipientUserId: true } });
  const ranked = await rankVolunteersForDelivery(delivery, settings, {
    radiusKm,
    excludeUserIds: previous.map((p) => p.recipientUserId),
  });
  const chosen = ranked.slice(0, count);
  if (chosen.length === 0) return 0;
  const expiresAt = addMinutes(new Date(), settings.volunteer_widen_after_minutes);
  await prisma.offer.createMany({
    data: chosen.map((v) => ({
      deliveryId: delivery.id,
      recipientUserId: v.userId,
      waveNo,
      score: -v.tripMinutes, // lower trip time is better
      expiresAt,
    })),
  });
  const listing = delivery.claim.listing;
  await notifyUsers(
    chosen.map((v) => v.userId),
    {
      type: 'task_offered',
      title: 'Pickup task near you',
      body: `${delivery.claim.servings} servings from ${listing.donor.orgName} to ${delivery.claim.ngo.orgName}. First to accept gets it.`,
      data: { deliveryId: delivery.id },
    },
  );
  return chosen.length;
}

// stage 0: offer within volunteer_radius_km
// stage 1 (after 10 min): widen to volunteer_radius_widened_km
// stage 2 (after 20 min): escalate (admin by day, on-call volunteer at night) and ask the NGO to collect
async function runVolunteerStage(deliveryId, stage, round, { schedule = scheduleVolunteerStage } = {}) {
  const settings = await getSettings();
  const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId }, include: deliveryInclude });
  if (!delivery || delivery.status !== 'unassigned') return { skipped: 'not_unassigned' };
  if (round !== undefined && round !== (await currentRound(deliveryId))) return { skipped: 'stale_round' };

  await prisma.offer.updateMany({
    where: { deliveryId, response: 'none', expiresAt: { lte: new Date() } },
    data: { response: 'expired' },
  });

  const widenAfter = settings.volunteer_widen_after_minutes;
  const escalateAfter = settings.volunteer_escalate_after_minutes;

  if (stage === 0) {
    const n = await offerToVolunteers(delivery, { radiusKm: settings.volunteer_radius_km, count: settings.volunteer_offer_size, waveNo: 1 }, settings);
    await schedule(deliveryId, 1, round, widenAfter);
    return { offered: n };
  }
  if (stage === 1) {
    const n = await offerToVolunteers(
      delivery,
      { radiusKm: settings.volunteer_radius_widened_km, count: settings.volunteer_offer_size, waveNo: 2 },
      settings,
    );
    await schedule(deliveryId, 2, round, escalateAfter - widenAfter);
    return { offered: n };
  }
  const listing = delivery.claim.listing;
  await escalate({
    type: 'no_volunteer',
    deliveryId,
    listingId: listing.id,
    description: `No volunteer accepted the pickup of ${delivery.claim.servings} servings from ${listing.donor.orgName} to ${delivery.claim.ngo.orgName} within ${escalateAfter} minutes.`,
  });
  await notifyUsers([delivery.claim.ngo.userId], {
    type: 'collect_yourself',
    title: 'No volunteer yet',
    body: `Can you collect "${listing.title}" from ${listing.donor.orgName} yourself? Call us if so.`,
    data: { deliveryId },
    urgent: true,
  });
  return { escalated: true };
}

// Called right after a claim creates a delivery.
async function startVolunteerMatching(deliveryId) {
  const round = await currentRound(deliveryId);
  return runVolunteerStage(deliveryId, 0, round);
}

// After a decline, offer the next best volunteer at the current radius.
async function topUpVolunteerOffers(deliveryId) {
  const settings = await getSettings();
  const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId }, include: deliveryInclude });
  if (!delivery || delivery.status !== 'unassigned') return 0;
  const agg = await prisma.offer.aggregate({ where: { deliveryId }, _max: { waveNo: true } });
  const waveNo = agg._max.waveNo ?? 1;
  const radiusKm = waveNo >= 2 ? settings.volunteer_radius_widened_km : settings.volunteer_radius_km;
  return offerToVolunteers(delivery, { radiusKm, count: 1, waveNo }, settings);
}

// ---------- Volunteer actions ----------

async function acceptOffer(offerId, user) {
  const offer = await prisma.offer.findUnique({ where: { id: offerId } });
  if (!offer || offer.recipientUserId !== user.id) throw notFound('Offer');
  if (!offer.deliveryId) throw badRequest('This offer is for an NGO; use the claim endpoint');
  if (offer.response !== 'none' || offer.expiresAt < new Date()) throw conflict('This offer is no longer open');

  const volunteer = await prisma.volunteer.findUnique({ where: { userId: user.id } });
  if (!volunteer || !volunteer.verifiedAt) throw forbidden('Volunteer profile not verified');

  try {
    await prisma.$transaction(async (tx) => {
      // Row lock: the first volunteer to accept wins.
      const [row] = await tx.$queryRaw`SELECT status FROM deliveries WHERE delivery_id = ${offer.deliveryId}::uuid FOR UPDATE`;
      if (!row || row.status !== 'unassigned') throw conflict('Someone else already accepted this task');
      await tx.delivery.update({
        where: { id: offer.deliveryId },
        data: { status: 'assigned', volunteerId: volunteer.id, assignedAt: new Date() },
      });
      await tx.offer.update({ where: { id: offerId }, data: { response: 'accepted' } });
      await tx.offer.updateMany({
        where: { deliveryId: offer.deliveryId, response: 'none', id: { not: offerId } },
        data: { response: 'expired' },
      });
      await recordStatus(tx, {
        entityType: 'delivery',
        entityId: offer.deliveryId,
        fromStatus: 'unassigned',
        toStatus: 'assigned',
        actorUserId: user.id,
      });
    });
  } catch (err) {
    // Partial unique index: one active delivery per volunteer.
    if (err.code === 'P2002' || /deliveries_one_active_per_volunteer/.test(String(err.message))) {
      throw conflict('Finish your current delivery before accepting another');
    }
    throw err;
  }

  const delivery = await loadDelivery(prisma, offer.deliveryId);
  broadcastDelivery(delivery, 'assigned', { volunteerId: volunteer.id });
  await notifyUsers([delivery.claim.listing.donor.userId, delivery.claim.ngo.userId], {
    type: 'volunteer_assigned',
    title: 'Volunteer on the way',
    body: `A volunteer accepted the pickup of "${delivery.claim.listing.title}".`,
    data: { deliveryId: delivery.id },
  });
  return delivery;
}

async function declineOffer(offerId, user) {
  const offer = await prisma.offer.findUnique({ where: { id: offerId } });
  if (!offer || offer.recipientUserId !== user.id) throw notFound('Offer');
  if (offer.response !== 'none') throw conflict('This offer was already answered');
  await prisma.offer.update({ where: { id: offerId }, data: { response: 'declined' } });
  if (offer.deliveryId) await topUpVolunteerOffers(offer.deliveryId);
  return { ok: true };
}

async function assertVolunteerOwns(delivery, user) {
  const volunteer = await prisma.volunteer.findUnique({ where: { userId: user.id } });
  if (!volunteer || delivery.volunteerId !== volunteer.id) throw forbidden('This is not your delivery');
  return volunteer;
}

async function confirmPickup(deliveryId, user, { code, photoUrl, lat, lng }) {
  const delivery = await loadDelivery(prisma, deliveryId);
  await assertVolunteerOwns(delivery, user);
  if (delivery.status !== 'assigned') throw conflict(`Delivery is ${delivery.status}, not assigned`);
  if (!safeEqual(code, delivery.pickupCode)) throw badRequest('Wrong pickup code');

  const listing = delivery.claim.listing;
  if (listing.status === 'expired' || listing.bestBefore < new Date()) throw conflict('This food is past its safe time');

  await prisma.$transaction(async (tx) => {
    await tx.delivery.update({
      where: { id: deliveryId },
      data: { status: 'picked_up', pickedUpAt: new Date(), pickupPhotoUrl: photoUrl, pickupLat: lat, pickupLng: lng },
    });
    await recordStatus(tx, { entityType: 'delivery', entityId: deliveryId, fromStatus: 'assigned', toStatus: 'picked_up', actorUserId: user.id });
  });
  broadcastDelivery(delivery, 'picked_up');
  await notifyUsers([delivery.claim.ngo.userId], {
    type: 'picked_up',
    title: 'Food picked up',
    body: `"${listing.title}" is on its way to you.`,
    data: { deliveryId },
  });
  return loadDelivery(prisma, deliveryId);
}

async function confirmDrop(deliveryId, user, { code, photoUrl, lat, lng }) {
  const delivery = await loadDelivery(prisma, deliveryId);
  await assertVolunteerOwns(delivery, user);
  if (delivery.status !== 'picked_up') throw conflict(`Delivery is ${delivery.status}, not picked up`);
  if (!safeEqual(code, delivery.dropCode)) throw badRequest('Wrong drop code');

  await prisma.$transaction(async (tx) => {
    await tx.delivery.update({
      where: { id: deliveryId },
      data: { status: 'delivered', deliveredAt: new Date(), dropPhotoUrl: photoUrl, dropLat: lat, dropLng: lng },
    });
    await tx.claim.update({ where: { id: delivery.claimId }, data: { status: 'delivered' } });
    await recordStatus(tx, { entityType: 'delivery', entityId: deliveryId, fromStatus: 'picked_up', toStatus: 'delivered', actorUserId: user.id });
    await recordStatus(tx, { entityType: 'claim', entityId: delivery.claimId, fromStatus: 'active', toStatus: 'delivered', actorUserId: user.id });
  });
  broadcastDelivery(delivery, 'delivered');
  await notifyUsers([delivery.claim.ngo.userId], {
    type: 'please_confirm',
    title: 'Food delivered',
    body: 'Please confirm receipt and rate the food.',
    data: { deliveryId },
  });
  await refreshNgoReliability(delivery.claim.ngoId);
  return loadDelivery(prisma, deliveryId);
}

// NGO confirms receipt (with feedback) or the sweep auto-confirms after 2 hours.
async function confirmReceipt(deliveryId, actorUserId, { auto = false } = {}) {
  const delivery = await loadDelivery(prisma, deliveryId);
  if (delivery.status !== 'delivered') throw conflict(`Delivery is ${delivery.status}, not delivered`);
  await prisma.$transaction(async (tx) => {
    await tx.delivery.update({ where: { id: deliveryId }, data: { status: 'confirmed', confirmedAt: new Date() } });
    await recordStatus(tx, {
      entityType: 'delivery',
      entityId: deliveryId,
      fromStatus: 'delivered',
      toStatus: 'confirmed',
      actorUserId,
      note: auto ? 'auto-confirmed: NGO did not respond' : null,
    });
  });
  broadcastDelivery(delivery, 'confirmed');
  const listing = delivery.claim.listing;
  await notifyUsers([listing.donor.userId, delivery.claim.ngo.userId, delivery.volunteer?.userId], {
    type: 'delivery_complete',
    title: 'Delivery complete',
    body: `${delivery.claim.servings} meals from "${listing.title}" reached ${delivery.claim.ngo.orgName}.`,
    data: { deliveryId, meals: delivery.claim.servings },
  });
  return loadDelivery(prisma, deliveryId);
}

async function failDelivery(deliveryId, actorUserId, { reason, claimStatus = 'failed', openIssue = true }) {
  const delivery = await loadDelivery(prisma, deliveryId);
  if (['delivered', 'confirmed', 'failed'].includes(delivery.status)) {
    throw conflict(`Delivery is already ${delivery.status}`);
  }
  await prisma.$transaction(async (tx) => {
    await tx.delivery.update({ where: { id: deliveryId }, data: { status: 'failed' } });
    await tx.claim.update({ where: { id: delivery.claimId }, data: { status: claimStatus } });
    await tx.offer.updateMany({ where: { deliveryId, response: 'none' }, data: { response: 'expired' } });
    await recordStatus(tx, { entityType: 'delivery', entityId: deliveryId, fromStatus: delivery.status, toStatus: 'failed', actorUserId, note: reason });
    await recordStatus(tx, { entityType: 'claim', entityId: delivery.claimId, fromStatus: delivery.claim.status, toStatus: claimStatus, actorUserId, note: reason });
    if (openIssue) {
      await tx.issue.create({
        data: { type: 'other', deliveryId, listingId: delivery.claim.listingId, raisedById: actorUserId, description: reason },
      });
    }
  });
  broadcastDelivery(delivery, 'failed', { reason });
  await notifyUsers([delivery.claim.ngo.userId, delivery.claim.listing.donor.userId, delivery.volunteer?.userId], {
    type: 'delivery_failed',
    title: 'Delivery cancelled',
    body: reason,
    data: { deliveryId },
  });
  if (claimStatus === 'failed') await refreshNgoReliability(delivery.claim.ngoId);
  return loadDelivery(prisma, deliveryId);
}

// An assigned volunteer who has not picked up by pickup_until loses the task.
async function unassignDelivery(deliveryId, note) {
  const delivery = await loadDelivery(prisma, deliveryId);
  if (delivery.status !== 'assigned') return null;
  await prisma.$transaction(async (tx) => {
    await tx.delivery.update({ where: { id: deliveryId }, data: { status: 'unassigned', volunteerId: null, assignedAt: null } });
    await recordStatus(tx, { entityType: 'delivery', entityId: deliveryId, fromStatus: 'assigned', toStatus: 'unassigned', note });
  });
  broadcastDelivery(delivery, 'unassigned');
  if (delivery.volunteer) {
    await notifyUsers([delivery.volunteer.userId], { type: 'task_removed', title: 'Task reassigned', body: note, data: { deliveryId } });
  }
  await startVolunteerMatching(deliveryId);
  return true;
}

// Share of claims the NGO actually received in the last 30 days.
async function refreshNgoReliability(ngoId) {
  const since = addMinutes(new Date(), -30 * 24 * 60);
  const [delivered, failed] = await Promise.all([
    prisma.claim.count({ where: { ngoId, status: 'delivered', claimedAt: { gte: since } } }),
    prisma.claim.count({ where: { ngoId, status: 'failed', claimedAt: { gte: since } } }),
  ]);
  const score = delivered + failed > 0 ? delivered / (delivered + failed) : 1;
  await prisma.ngo.update({ where: { id: ngoId }, data: { reliabilityScore: score } });
}

module.exports = {
  deliveryInclude,
  loadDelivery,
  currentRound,
  runVolunteerStage,
  startVolunteerMatching,
  topUpVolunteerOffers,
  acceptOffer,
  declineOffer,
  confirmPickup,
  confirmDrop,
  confirmReceipt,
  failDelivery,
  unassignDelivery,
  refreshNgoReliability,
  broadcastDelivery,
};

