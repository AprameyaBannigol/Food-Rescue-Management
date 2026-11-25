// Timed steps: offer waves, volunteer escalation (day vs night), expiry, auto-confirm.
// Jobs are called directly with a fake scheduler, so no waiting for real minutes.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { runListingWave } = require('../src/services/listingFlow');
const { runVolunteerStage, currentRound } = require('../src/services/deliveryFlow');
const { runSweep } = require('../src/services/sweep');
const { istMinuteOfDay } = require('../src/lib/time');
const { clearSettingsCache } = require('../src/services/settings');

const noSchedule = async () => {};

before(async () => h.resetDb());
beforeEach(async () => h.resetDb());
after(async () => h.closeAll());

async function setConfig(key, value) {
  await h.prisma.config.upsert({ where: { key }, update: { value }, create: { key, value } });
  clearSettingsCache();
}

function hhmm(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Makes "night" either cover now or not, whatever time the tests run.
async function makeItNight(isNight) {
  const now = istMinuteOfDay(new Date());
  if (isNight) {
    await setConfig('night_from', hhmm(now - 60));
    await setConfig('night_to', hhmm(now + 60));
  } else {
    await setConfig('night_from', hhmm(now + 60));
    await setConfig('night_to', hhmm(now + 120));
  }
}

test('offer waves: top 3, then next 5, then everyone, then escalate if no one claims', async () => {
  const adm = await h.admin();
  const donor = await h.makeDonor(adm);
  for (let i = 0; i < 10; i++) await h.makeNgo(adm, h.north(0.5 + i * 0.5), { orgName: `NGO ${i}` });

  const post = await donor.api.post('/api/listings').send(h.listingBody());
  const id = post.body.listing.id;
  assert.equal(post.body.firstWave.offered, 3);

  // The first three offered are the closest (proximity dominates when everything else is equal)
  const wave1 = await h.prisma.offer.findMany({ where: { listingId: id }, include: { recipient: { include: { ngo: true } } } });
  assert.deepEqual(wave1.map((o) => o.recipient.ngo.orgName).sort(), ['NGO 0', 'NGO 1', 'NGO 2']);

  assert.equal((await runListingWave(id, 2, { schedule: noSchedule })).offered, 5);
  assert.equal((await runListingWave(id, 3, { schedule: noSchedule })).offered, 2);
  const result = await runListingWave(id, 4, { schedule: noSchedule });
  assert.equal(result.escalated, true);
  const issue = await h.prisma.issue.findFirst({ where: { listingId: id } });
  assert.equal(issue.type, 'unmatched');

  // Running the final step again does not open a duplicate issue
  await runListingWave(id, 4, { schedule: noSchedule });
  assert.equal(await h.prisma.issue.count({ where: { listingId: id } }), 1);
});

test('NGO outside the first wave cannot claim until the listing opens to all', async () => {
  const adm = await h.admin();
  const donor = await h.makeDonor(adm);
  const ngos = [];
  for (let i = 0; i < 4; i++) ngos.push(await h.makeNgo(adm, h.north(0.5 + i), { orgName: `NGO ${i}` }));
  const post = await donor.api.post('/api/listings').send(h.listingBody());
  const id = post.body.listing.id;
  const fourth = ngos[3];
  const early = await fourth.api.post(`/api/listings/${id}/claim`).send({ servings: 5 });
  assert.equal(early.status, 409);
  assert.equal(early.body.error.details.reason, 'not_offered_yet');
  await runListingWave(id, 2, { schedule: noSchedule });
  const later = await fourth.api.post(`/api/listings/${id}/claim`).send({ servings: 5 });
  assert.equal(later.status, 201);
});

async function claimedDelivery({ volunteerAt } = {}) {
  const adm = await h.admin();
  const donor = await h.makeDonor(adm);
  const ngo = await h.makeNgo(adm, h.north(2));
  const vol = volunteerAt ? await h.makeVolunteer(adm, volunteerAt) : null;
  const post = await donor.api.post('/api/listings').send(h.listingBody());
  const claim = await ngo.api.post(`/api/listings/${post.body.listing.id}/claim`).send({ servings: 20 });
  return { adm, donor, ngo, vol, listingId: post.body.listing.id, deliveryId: claim.body.delivery.id };
}

test('volunteer radius widens from 4 km to 6 km at stage 1', async () => {
  const ctx = await claimedDelivery({ volunteerAt: h.north(5) }); // 5 km away
  let offers = await h.prisma.offer.count({ where: { deliveryId: ctx.deliveryId } });
  assert.equal(offers, 0);
  const round = await currentRound(ctx.deliveryId);
  const r = await runVolunteerStage(ctx.deliveryId, 1, round, { schedule: noSchedule });
  assert.equal(r.offered, 1);
  offers = await h.prisma.offer.count({ where: { deliveryId: ctx.deliveryId } });
  assert.equal(offers, 1);
});

test('large orders go only to volunteers with a car', async () => {
  const adm = await h.admin();
  const donor = await h.makeDonor(adm);
  const ngo = await h.makeNgo(adm, h.north(2), { dailyCapacity: 500 });
  const bike = await h.makeVolunteer(adm, h.north(0.3), 'bike');
  const car = await h.makeVolunteer(adm, h.north(1), 'car');
  const post = await donor.api.post('/api/listings').send(h.listingBody({ totalServings: 120 }));
  await ngo.api.post(`/api/listings/${post.body.listing.id}/claim`).send({ servings: 120 });
  assert.equal((await bike.api.get('/api/offers/mine')).body.offers.length, 0);
  assert.equal((await car.api.get('/api/offers/mine')).body.offers.length, 1);
});

test('no volunteer after 20 minutes: by day the admin gets the escalation', async () => {
  await makeItNight(false);
  const ctx = await claimedDelivery();
  const onCall = await h.makeVolunteer(ctx.adm, h.north(30)); // far away, on call
  await onCall.api.patch('/api/profile/volunteer/availability').send({ isOnCall: true });

  const round = await currentRound(ctx.deliveryId);
  const r = await runVolunteerStage(ctx.deliveryId, 2, round, { schedule: noSchedule });
  assert.equal(r.escalated, true);
  const issue = await h.prisma.issue.findFirst({ where: { deliveryId: ctx.deliveryId } });
  assert.equal(issue.type, 'no_volunteer');

  // By day the on-call volunteer cannot see the issue list; the admin can
  const volIssues = await onCall.api.get('/api/issues');
  assert.equal(volIssues.body.issues.length, 0);
  const admIssues = await ctx.adm.api.get('/api/issues');
  assert.equal(admIssues.body.issues.length, 1);
});

test('at night the on-call volunteer can see and resolve escalations', async () => {
  await makeItNight(true);
  const ctx = await claimedDelivery();
  const onCall = await h.makeVolunteer(ctx.adm, h.north(30));
  await onCall.api.patch('/api/profile/volunteer/availability').send({ isOnCall: true });
  const round = await currentRound(ctx.deliveryId);
  await runVolunteerStage(ctx.deliveryId, 2, round, { schedule: noSchedule });

  const list = await onCall.api.get('/api/issues');
  assert.equal(list.body.issues.length, 1);
  const resolve = await onCall.api.patch(`/api/issues/${list.body.issues[0].id}`).send({ status: 'resolved', note: 'NGO collected it' });
  assert.equal(resolve.status, 200, JSON.stringify(resolve.body));
  assert.equal(resolve.body.issue.resolvedById, onCall.user.id);
});

test('stale timers from an earlier round are ignored', async () => {
  const ctx = await claimedDelivery();
  const r = await runVolunteerStage(ctx.deliveryId, 2, 99, { schedule: noSchedule });
  assert.equal(r.skipped, 'stale_round');
});

test('expiry: unclaimed listing past best-before minus travel time expires', async () => {
  const adm = await h.admin();
  const donor = await h.makeDonor(adm);
  await h.makeNgo(adm, h.north(1));
  const post = await donor.api.post('/api/listings').send(h.listingBody());
  const id = post.body.listing.id;
  // Pretend the safe window ends in 10 minutes (default travel estimate is 20)
  await h.prisma.listing.update({ where: { id }, data: { bestBefore: new Date(Date.now() + 10 * 60000) } });
  const res = await runSweep();
  assert.equal(res.expiredListings, 1);
  const l = await h.prisma.listing.findUnique({ where: { id } });
  assert.equal(l.status, 'expired');
  assert.equal(l.remainingServings, 0);
});

test('expiry wins over a waiting delivery; it does not count against the NGO', async () => {
  const ctx = await claimedDelivery();
  await h.prisma.listing.update({ where: { id: ctx.listingId }, data: { bestBefore: new Date(Date.now() + 5 * 60000) } });
  await runSweep();
  const d = await h.prisma.delivery.findUnique({ where: { id: ctx.deliveryId }, include: { claim: true } });
  assert.equal(d.status, 'failed');
  assert.equal(d.claim.status, 'cancelled');
  const l = await h.prisma.listing.findUnique({ where: { id: ctx.listingId } });
  assert.equal(l.status, 'expired');
});

test('auto-confirm 2 hours after delivery, and late volunteers lose the task', async () => {
  const ctx = await claimedDelivery({ volunteerAt: h.north(0.5) });
  const offer = (await ctx.vol.api.get('/api/offers/mine')).body.offers[0];
  await ctx.vol.api.post(`/api/offers/${offer.id}/accept`);

  // Pickup window closes before the volunteer arrives -> back to unassigned
  await h.prisma.listing.update({ where: { id: ctx.listingId }, data: { pickupFrom: new Date(Date.now() - 30 * 60000), pickupUntil: new Date(Date.now() - 60000) } });
  let res = await runSweep();
  assert.equal(res.unassigned, 1);
  let d = await h.prisma.delivery.findUnique({ where: { id: ctx.deliveryId } });
  assert.equal(d.status, 'unassigned');
  assert.equal(d.volunteerId, null);

  // Delivered 3 hours ago and never confirmed -> auto-confirmed
  await h.prisma.delivery.update({ where: { id: ctx.deliveryId }, data: { status: 'delivered', deliveredAt: new Date(Date.now() - 3 * 3600000) } });
  res = await runSweep();
  assert.equal(res.autoConfirmed, 1);
  d = await h.prisma.delivery.findUnique({ where: { id: ctx.deliveryId } });
  assert.equal(d.status, 'confirmed');
});
