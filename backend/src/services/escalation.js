// Escalations: an ISSUE row plus an urgent alert. By day the alert goes to the
// admins (project creators); from night_from to night_to (default 10 PM to 7 AM IST)
// it goes to verified volunteers who switched on "on call". If nobody is on call,
// admins are alerted anyway so an escalation is never dropped.
const prisma = require('../lib/prisma');
const { isWithinDailyWindow } = require('../lib/time');
const { getSettings } = require('./settings');
const { notifyUsers, notifyAdmins } = require('./notify');
const { emitTo, rooms } = require('../realtime/emitter');

async function isNight(now = new Date()) {
  const s = await getSettings();
  return isWithinDailyWindow(now, s.night_from, s.night_to);
}

async function escalate({ type, listingId = null, deliveryId = null, description }) {
  // Do not open a duplicate escalation for the same thing.
  const existing = await prisma.issue.findFirst({
    where: { type, listingId, deliveryId, status: { in: ['open', 'in_progress'] } },
  });
  if (existing) return existing;

  const issue = await prisma.issue.create({
    data: { type, listingId, deliveryId, description, raisedById: null },
  });

  const message = {
    type: 'escalation',
    title: type === 'unmatched' ? 'No NGO claimed food' : 'No volunteer for a delivery',
    body: description,
    data: { issueId: issue.id, listingId, deliveryId },
    urgent: true,
  };

  emitTo(rooms.admins, 'issue:new', { issueId: issue.id, type });

  if (await isNight()) {
    const onCall = await prisma.volunteer.findMany({
      where: { isOnCall: true, verifiedAt: { not: null }, user: { status: 'verified' } },
      select: { userId: true },
    });
    if (onCall.length > 0) {
      await notifyUsers(onCall.map((v) => v.userId), message);
      return issue;
    }
  }
  await notifyAdmins(message);
  return issue;
}

module.exports = { escalate, isNight };
