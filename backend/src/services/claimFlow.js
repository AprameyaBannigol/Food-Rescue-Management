// NGO claims (all or part of) a listing. First come, first served, with a row
// lock on the listing so two NGOs can never claim the same servings.
const prisma = require('../lib/prisma');
const { badRequest, conflict, forbidden, notFound } = require('../lib/errors');
const { fourDigitCode } = require('../lib/codes');
const { istStartOfDay } = require('../lib/time');
const { getSettings } = require('./settings');
const { ngoCanClaim } = require('./matching');
const { recordStatus } = require('./statusEvents');
const { notifyUsers } = require('./notify');
const { emitTo, rooms } = require('../realtime/emitter');
const { startVolunteerMatching } = require('./deliveryFlow');

const REASON_TEXT = {
  not_open: 'This listing is no longer open',
  veg_only: 'Your NGO accepts veg food only',
  too_far: 'This listing is outside your area',
  out_of_range: 'This listing is outside your area',
  closed_at_eta: 'Your NGO is closed when this food would arrive',
  no_capacity: 'Your NGO has no capacity left today',
  too_late: 'This food would not reach you safely in time',
  not_offered_yet: 'This listing has not been offered to you yet',
};

async function claimListing(listingId, user, { servings }) {
  const settings = await getSettings();
  const ngo = await prisma.ngo.findUnique({ where: { userId: user.id } });
  if (!ngo || !ngo.verifiedAt) throw forbidden('NGO profile not verified');

  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing) throw notFound('Listing');

  const check = await ngoCanClaim(listing, ngo, settings);
  if (!check.ok) throw conflict(REASON_TEXT[check.reason] ?? 'You cannot claim this listing', { reason: check.reason });
  const match = check.match;

  const result = await prisma.$transaction(async (tx) => {
    // Lock the listing row, then the NGO row (capacity), always in that order.
    const [row] = await tx.$queryRaw`
      SELECT status, remaining_servings AS "remaining" FROM listings WHERE listing_id = ${listingId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT 1 FROM ngos WHERE ngo_id = ${ngo.id}::uuid FOR UPDATE`;

    if (!['posted', 'offered', 'partially_claimed'].includes(row.status) || row.remaining <= 0) {
      throw conflict('This listing was just fully claimed');
    }
    if (servings > row.remaining) {
      throw conflict(`Only ${row.remaining} servings are left`, { remaining: row.remaining });
    }
    const claimedToday = await tx.claim.aggregate({
      where: { ngoId: ngo.id, claimedAt: { gte: istStartOfDay(new Date()) }, status: { not: 'cancelled' } },
      _sum: { servings: true },
    });
    const capacityLeft = ngo.dailyCapacity - (claimedToday._sum.servings ?? 0);
    if (servings > capacityLeft) throw badRequest(`Your NGO can take only ${capacityLeft} more servings today`);

    const remaining = row.remaining - servings;
    const newStatus = remaining === 0 ? 'fully_claimed' : 'partially_claimed';
    await tx.listing.update({ where: { id: listingId }, data: { remainingServings: remaining, status: newStatus } });
    if (newStatus !== row.status) {
      await recordStatus(tx, { entityType: 'listing', entityId: listingId, fromStatus: row.status, toStatus: newStatus, actorUserId: user.id });
    }

    const claim = await tx.claim.create({ data: { listingId, ngoId: ngo.id, servings } });
    await recordStatus(tx, { entityType: 'claim', entityId: claim.id, toStatus: 'active', actorUserId: user.id });

    const delivery = await tx.delivery.create({
      data: {
        claimId: claim.id,
        pickupCode: fourDigitCode(),
        dropCode: fourDigitCode(),
        distanceKm: Number(match.distanceKm.toFixed(2)),
      },
    });
    await recordStatus(tx, { entityType: 'delivery', entityId: delivery.id, toStatus: 'unassigned', actorUserId: user.id });

    await tx.offer.updateMany({
      where: { listingId, recipientUserId: user.id, response: 'none' },
      data: { response: 'accepted' },
    });
    if (remaining === 0) {
      await tx.offer.updateMany({ where: { listingId, response: 'none' }, data: { response: 'expired' } });
    }
    return { claim, delivery, remaining, status: newStatus };
  });

  emitTo(rooms.listing(listingId), 'listing:status', { listingId, status: result.status, remainingServings: result.remaining });
  emitTo(rooms.admins, 'listing:status', { listingId, status: result.status, remainingServings: result.remaining });
  const donor = await prisma.donor.findUnique({ where: { id: listing.donorId } });
  await notifyUsers([donor.userId], {
    type: 'claimed',
    title: 'Your food was claimed',
    body: `${ngo.orgName} claimed ${servings} servings of "${listing.title}". Finding a volunteer now.`,
    data: { listingId, deliveryId: result.delivery.id },
  });

  await startVolunteerMatching(result.delivery.id);
  return result;
}

module.exports = { claimListing, REASON_TEXT };
