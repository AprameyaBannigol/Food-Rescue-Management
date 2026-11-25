const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

before(async () => {
  await h.resetDb();
});
beforeEach(async () => {
  await h.resetDb();
});
after(async () => {
  await h.closeAll();
});

test('happy path: post -> offer -> claim -> volunteer -> pickup -> drop -> confirm', async () => {
  const adm = await h.admin();
  const donor = await h.makeDonor(adm);
  const ngo = await h.makeNgo(adm, h.north(2), { orgName: 'Near NGO' });
  const vol = await h.makeVolunteer(adm, h.north(0.5));

  // Donor posts
  const post = await donor.api.post('/api/listings').send(h.listingBody());
  assert.equal(post.status, 201, JSON.stringify(post.body));
  const listing = post.body.listing;
  assert.equal(listing.status, 'offered');
  assert.equal(listing.items.length, 2);
  assert.equal(listing.items[0].itemNo, 1);
  // Hot food: best-before is capped at cooked_at + 4 h
  assert.equal(new Date(listing.bestBefore) - new Date(listing.cookedAt), 4 * 3600 * 1000);
  assert.equal(post.body.firstWave.offered, 1);

  // NGO sees it in the feed with a score
  const feed = await ngo.api.get('/api/listings/feed');
  assert.equal(feed.status, 200);
  assert.equal(feed.body.listings.length, 1);
  assert.ok(feed.body.listings[0].match.score > 0);

  // Claims part of it
  const claim = await ngo.api.post(`/api/listings/${listing.id}/claim`).send({ servings: 30 });
  assert.equal(claim.status, 201, JSON.stringify(claim.body));
  assert.equal(claim.body.listing.status, 'partially_claimed');
  assert.equal(claim.body.listing.remainingServings, 10);
  assert.match(claim.body.delivery.dropCode, /^\d{4}$/);
  assert.equal(claim.body.delivery.pickupCode, undefined, 'NGO must not see the pickup code');
  const deliveryId = claim.body.delivery.id;

  // Volunteer was offered the task
  const offers = await vol.api.get('/api/offers/mine');
  assert.equal(offers.status, 200);
  assert.equal(offers.body.offers.length, 1);
  assert.equal(offers.body.offers[0].delivery.id, deliveryId);
  assert.equal(offers.body.offers[0].delivery.pickupCode, undefined);

  const accept = await vol.api.post(`/api/offers/${offers.body.offers[0].id}/accept`);
  assert.equal(accept.status, 200, JSON.stringify(accept.body));
  assert.equal(accept.body.status, 'assigned');

  // Donor sees the pickup code, volunteer does not
  const donorView = await donor.api.get(`/api/deliveries/${deliveryId}`);
  const pickupCode = donorView.body.delivery.pickupCode;
  assert.match(pickupCode, /^\d{4}$/);
  assert.equal(donorView.body.delivery.dropCode, undefined);
  const volView = await vol.api.get(`/api/deliveries/${deliveryId}`);
  assert.equal(volView.body.delivery.pickupCode, undefined);
  assert.equal(volView.body.delivery.donor.address, 'Station Road, Hubballi');

  // Wrong code rejected, right code accepted
  const wrong = String((Number(pickupCode) + 1) % 10000).padStart(4, '0');
  const bad = await vol.api.post(`/api/deliveries/${deliveryId}/pickup`).send({ code: wrong, photoUrl: 'https://example.com/p.jpg' });
  assert.equal(bad.status, 400);
  const pick = await vol.api
    .post(`/api/deliveries/${deliveryId}/pickup`)
    .send({ code: pickupCode, photoUrl: 'https://example.com/p.jpg', ...h.HUBLI });
  assert.equal(pick.status, 200, JSON.stringify(pick.body));
  assert.equal(pick.body.delivery.status, 'picked_up');

  const ngoView = await ngo.api.get(`/api/deliveries/${deliveryId}`);
  const drop = await vol.api
    .post(`/api/deliveries/${deliveryId}/drop`)
    .send({ code: ngoView.body.delivery.dropCode, photoUrl: 'https://example.com/d.jpg' });
  assert.equal(drop.status, 200, JSON.stringify(drop.body));
  assert.equal(drop.body.delivery.status, 'delivered');

  const confirm = await ngo.api.post(`/api/deliveries/${deliveryId}/confirm`).send({ rating: 5, foodOk: true });
  assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
  assert.equal(confirm.body.delivery.status, 'confirmed');

  // Impact numbers
  const dStats = await donor.api.get('/api/stats/me');
  assert.equal(dStats.body.mealsDonated, 30);
  assert.equal(dStats.body.kgSaved, 8);
  const vStats = await vol.api.get('/api/stats/me');
  assert.equal(vStats.body.deliveries, 1);
  assert.deepEqual(vStats.body.badges, ['first_delivery']);

  // Full history is recorded
  const hist = await donor.api.get(`/api/listings/${listing.id}/history`);
  const deliverySteps = hist.body.events.filter((e) => e.entityType === 'delivery').map((e) => e.toStatus);
  assert.deepEqual(deliverySteps, ['unassigned', 'assigned', 'picked_up', 'delivered', 'confirmed']);
});

test('unverified users cannot post, and pending donors are in the verification queue', async () => {
  const adm = await h.admin();
  const u = await h.login(h.nextPhone(), 'donor');
  const a = h.api(u.token);
  await a.put('/api/profile/donor').send({
    orgName: 'Mess Hall',
    type: 'mess',
    fssaiLicenceNo: '12345678901234',
    licenceUrl: 'https://example.com/f.pdf',
    address: 'Vidyanagar, Hubballi',
    ...h.HUBLI,
  });
  const r = await a.post('/api/listings').send(h.listingBody());
  assert.equal(r.status, 403);
  const q = await adm.api.get('/api/admin/verifications');
  assert.equal(q.body.users.length, 1);
  assert.equal(q.body.users[0].donor.orgName, 'Mess Hall');
});

test('veg-only NGO is never offered non-veg food', async () => {
  const adm = await h.admin();
  const donor = await h.makeDonor(adm);
  const vegNgo = await h.makeNgo(adm, h.north(1), { vegOnly: true });
  const post = await donor.api.post('/api/listings').send(h.listingBody({ foodType: 'non_veg', title: 'Chicken curry' }));
  assert.equal(post.status, 201);
  // Nobody eligible -> escalated as unmatched straight away
  assert.equal(post.body.firstWave.escalated, true);
  const feed = await vegNgo.api.get('/api/listings/feed');
  assert.equal(feed.body.listings.length, 0);
  const claim = await vegNgo.api.post(`/api/listings/${post.body.listing.id}/claim`).send({ servings: 10 });
  assert.equal(claim.status, 409);
  assert.equal(claim.body.error.details.reason, 'veg_only');
  const issues = await adm.api.get('/api/issues');
  assert.equal(issues.body.issues[0].type, 'unmatched');
});

test('NGOs beyond 8 km are filtered out', async () => {
  const adm = await h.admin();
  const donor = await h.makeDonor(adm);
  const far = await h.makeNgo(adm, h.north(12));
  const post = await donor.api.post('/api/listings').send(h.listingBody());
  assert.equal(post.body.firstWave.escalated, true);
  const feed = await far.api.get('/api/listings/feed');
  assert.equal(feed.body.listings.length, 0);
});

test('two NGOs claiming the same servings at once: only one wins', async () => {
  const adm = await h.admin();
  const donor = await h.makeDonor(adm);
  const a = await h.makeNgo(adm, h.north(1), { orgName: 'NGO A' });
  const b = await h.makeNgo(adm, h.north(2), { orgName: 'NGO B' });
  const post = await donor.api.post('/api/listings').send(h.listingBody({ totalServings: 40 }));
  const id = post.body.listing.id;
  const [ra, rb] = await Promise.all([
    a.api.post(`/api/listings/${id}/claim`).send({ servings: 30 }),
    b.api.post(`/api/listings/${id}/claim`).send({ servings: 30 }),
  ]);
  const statuses = [ra.status, rb.status].sort();
  assert.deepEqual(statuses, [201, 409]);
  const l = await h.prisma.listing.findUnique({ where: { id } });
  assert.equal(l.remainingServings, 10);
});

test('food safety: hot food older than 4 h is refused, chilled food gets 12 h', async () => {
  const adm = await h.admin();
  const donor = await h.makeDonor(adm);
  const fiveHoursAgo = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
  const hot = await donor.api.post('/api/listings').send(h.listingBody({ cookedAt: fiveHoursAgo }));
  assert.equal(hot.status, 400);

  const chilled = await donor.api.post('/api/listings').send(
    h.listingBody({ cookedAt: fiveHoursAgo, holding: 'chilled', bestBefore: new Date(Date.now() + 48 * 3600 * 1000).toISOString() }),
  );
  assert.equal(chilled.status, 201, JSON.stringify(chilled.body));
  const l = chilled.body.listing;
  // Donor asked for 48 h; capped at cooked + 12 h
  assert.equal(new Date(l.bestBefore) - new Date(l.cookedAt), 12 * 3600 * 1000);
  assert.match(chilled.body.handling, /74°C/);
});

test('checklist must be fully ticked', async () => {
  const adm = await h.admin();
  const donor = await h.makeDonor(adm);
  const body = h.listingBody();
  body.checklist.noPlateLeftovers = false;
  const r = await donor.api.post('/api/listings').send(body);
  assert.equal(r.status, 400);
});

test('a volunteer can hold only one active delivery', async () => {
  const adm = await h.admin();
  const donor = await h.makeDonor(adm);
  const n1 = await h.makeNgo(adm, h.north(1), { orgName: 'N1' });
  const n2 = await h.makeNgo(adm, h.north(2), { orgName: 'N2' });
  const vol = await h.makeVolunteer(adm, h.north(0.2));
  const post = await donor.api.post('/api/listings').send(h.listingBody({ totalServings: 40 }));
  const id = post.body.listing.id;
  await n1.api.post(`/api/listings/${id}/claim`).send({ servings: 20 });
  await n2.api.post(`/api/listings/${id}/claim`).send({ servings: 20 });
  const offers = (await vol.api.get('/api/offers/mine')).body.offers;
  assert.equal(offers.length, 2);
  const first = await vol.api.post(`/api/offers/${offers[0].id}/accept`);
  assert.equal(first.status, 200);
  const second = await vol.api.post(`/api/offers/${offers[1].id}/accept`);
  assert.equal(second.status, 409);
});

test('donor can cancel before pickup; NGO is told', async () => {
  const adm = await h.admin();
  const donor = await h.makeDonor(adm);
  const ngo = await h.makeNgo(adm, h.north(1));
  const post = await donor.api.post('/api/listings').send(h.listingBody());
  const id = post.body.listing.id;
  const claim = await ngo.api.post(`/api/listings/${id}/claim`).send({ servings: 10 });
  const cancel = await donor.api.post(`/api/listings/${id}/cancel`).send({ reason: 'Function got extended' });
  assert.equal(cancel.status, 200);
  const d = await h.prisma.delivery.findUnique({ where: { id: claim.body.delivery.id }, include: { claim: true } });
  assert.equal(d.status, 'failed');
  assert.equal(d.claim.status, 'cancelled');
  const l = await h.prisma.listing.findUnique({ where: { id } });
  assert.equal(l.status, 'cancelled');
});

test('two "food not OK" reports pause the donor', async () => {
  const adm = await h.admin();
  const donor = await h.makeDonor(adm);
  const ngo = await h.makeNgo(adm, h.north(1));
  const vol = await h.makeVolunteer(adm, h.north(0.3));

  for (let i = 0; i < 2; i++) {
    const post = await donor.api.post('/api/listings').send(h.listingBody({ totalServings: 10 }));
    const claim = await ngo.api.post(`/api/listings/${post.body.listing.id}/claim`).send({ servings: 10 });
    const deliveryId = claim.body.delivery.id;
    const offer = (await vol.api.get('/api/offers/mine')).body.offers[0];
    await vol.api.post(`/api/offers/${offer.id}/accept`);
    const codes = await h.prisma.delivery.findUnique({ where: { id: deliveryId } });
    await vol.api.post(`/api/deliveries/${deliveryId}/pickup`).send({ code: codes.pickupCode, photoUrl: 'https://example.com/a.jpg' });
    await vol.api.post(`/api/deliveries/${deliveryId}/drop`).send({ code: codes.dropCode, photoUrl: 'https://example.com/b.jpg' });
    const c = await ngo.api.post(`/api/deliveries/${deliveryId}/confirm`).send({ rating: 2, foodOk: false, comment: 'Smelled off' });
    assert.equal(c.status, 200);
  }
  const u = await h.prisma.user.findUnique({ where: { id: donor.user.id } });
  assert.equal(u.status, 'suspended');
  const blocked = await donor.api.get('/api/listings/mine');
  assert.equal(blocked.status, 403);
});

test('OTP: wrong code is rejected and new users must pick a role', async () => {
  const phone = h.nextPhone();
  const r1 = await h.request(h.app).post('/api/auth/otp/request').send({ phone });
  assert.equal(r1.status, 200);
  const wrongCode = r1.body.devCode === '000000' ? '111111' : '000000';
  const bad = await h.request(h.app).post('/api/auth/otp/verify').send({ phone, code: wrongCode, role: 'donor' });
  assert.equal(bad.status, 401);
  const noRole = await h.request(h.app).post('/api/auth/otp/verify').send({ phone, code: r1.body.devCode });
  assert.equal(noRole.status, 400);
  const ok = await h.request(h.app).post('/api/auth/otp/verify').send({ phone, code: r1.body.devCode, role: 'ngo' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.status, 'pending');
  assert.ok(ok.headers['set-cookie'][0].includes('HttpOnly'));
  // Local numbers are normalised to +91
  const r2 = await h.request(h.app).post('/api/auth/otp/request').send({ phone: '09876543210' });
  assert.equal(r2.status, 200);
  const adminLogin = await h.login('+919900000001');
  assert.equal(adminLogin.user.role, 'admin');
  assert.equal(adminLogin.user.status, 'verified');
});
