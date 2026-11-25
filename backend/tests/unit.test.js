// Pure functions: time windows, food safety limits, NGO filters and score.
process.env.JWT_SECRET ??= 'test-secret-at-least-16-chars';
process.env.DATABASE_URL ??= 'postgresql://localhost/unused';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isWithinDailyWindow, istStartOfDay } = require('../src/lib/time');
const { resolveBestBefore } = require('../src/services/foodSafety');
const { filterAndScoreNgos } = require('../src/services/matching');
const { DEFAULTS } = require('../src/services/settings');

// 2026-11-25 23:30 IST = 18:00 UTC
const lateNight = new Date('2026-11-25T18:00:00Z');
const morning = new Date('2026-11-25T04:30:00Z'); // 10:00 IST

test('night window 22:00-07:00 crosses midnight', () => {
  assert.equal(isWithinDailyWindow(lateNight, '22:00', '07:00'), true);
  assert.equal(isWithinDailyWindow(morning, '22:00', '07:00'), false);
  assert.equal(isWithinDailyWindow(morning, '09:00', '18:00'), true);
});

test('IST day starts at 18:30 UTC the day before', () => {
  assert.equal(istStartOfDay(morning).toISOString(), '2026-11-24T18:30:00.000Z');
});

test('best-before is capped by FSSAI limits', () => {
  const cookedAt = new Date('2026-11-25T06:00:00Z');
  const hot = resolveBestBefore({ cookedAt, holding: 'hot' }, DEFAULTS);
  assert.equal(hot.toISOString(), '2026-11-25T10:00:00.000Z');
  const earlier = resolveBestBefore({ cookedAt, holding: 'chilled', requestedBestBefore: new Date('2026-11-25T08:00:00Z') }, DEFAULTS);
  assert.equal(earlier.toISOString(), '2026-11-25T08:00:00.000Z');
  const capped = resolveBestBefore({ cookedAt, holding: 'chilled', requestedBestBefore: new Date('2026-11-27T00:00:00Z') }, DEFAULTS);
  assert.equal(capped.toISOString(), '2026-11-25T18:00:00.000Z');
});

const listing = { foodType: 'non_veg', remainingServings: 40, bestBefore: new Date(morning.getTime() + 3 * 3600000) };
const ngo = (over) => ({
  ngoId: over.ngoId,
  userId: `u-${over.ngoId}`,
  dailyCapacity: 100,
  vegOnly: false,
  openFrom: '00:00',
  openTo: '23:59',
  distanceKm: 2,
  claimedToday: 0,
  received7d: 0,
  delivered30d: 0,
  failed30d: 0,
  ...over,
});

test('hard filters drop the right NGOs, with reasons', () => {
  const { passing, reasons } = filterAndScoreNgos(
    listing,
    [
      ngo({ ngoId: 'ok' }),
      ngo({ ngoId: 'veg', vegOnly: true }),
      ngo({ ngoId: 'closed', openFrom: '18:00', openTo: '22:00' }),
      ngo({ ngoId: 'full', claimedToday: 95 }),
      ngo({ ngoId: 'far', distanceKm: 9 }),
    ],
    DEFAULTS,
    morning,
  );
  assert.deepEqual(passing.map((p) => p.ngoId), ['ok']);
  assert.deepEqual(reasons, { veg: 'veg_only', closed: 'closed_at_eta', full: 'no_capacity', far: 'too_far' });
});

test('too late: arrival plus 30 min buffer must be before best-before', () => {
  const soon = { ...listing, bestBefore: new Date(morning.getTime() + 35 * 60000) };
  const { reasons } = filterAndScoreNgos(soon, [ngo({ ngoId: 'x', distanceKm: 3 })], DEFAULTS, morning);
  assert.equal(reasons.x, 'too_late');
});

test('score: fairness and reliability move NGOs down', () => {
  const { passing } = filterAndScoreNgos(
    listing,
    [
      ngo({ ngoId: 'busy', received7d: 500 }),
      ngo({ ngoId: 'flaky', delivered30d: 1, failed30d: 3 }),
      ngo({ ngoId: 'best' }),
    ],
    DEFAULTS,
    morning,
  );
  assert.equal(passing[0].ngoId, 'best');
  for (const p of passing) assert.ok(p.score >= 0 && p.score <= 1);
  const flaky = passing.find((p) => p.ngoId === 'flaky');
  assert.equal(flaky.factors.reliability, 0.25);
});
