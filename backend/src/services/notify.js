// One place to tell people things. Sends a live Socket.IO event to the user's
// room; urgent ones also go by SMS (web push on iPhone needs the PWA installed,
// so SMS is the reliable channel for expiry and escalation alerts).
const prisma = require('../lib/prisma');
const { emitTo, rooms } = require('../realtime/emitter');
const { sendSms } = require('./sms');
const logger = require('../lib/logger');

async function notifyUsers(userIds, { type, title, body, data = {}, urgent = false }) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return;
  const payload = { type, title, body, data, at: new Date().toISOString() };
  for (const id of ids) emitTo(rooms.user(id), 'notification', payload);
  if (urgent) {
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { phone: true } });
    await Promise.all(
      users.map((u) => sendSms(u.phone, `${title}: ${body}`).catch((err) => logger.error({ err }, 'SMS failed'))),
    );
  }
}

async function notifyAdmins(message) {
  const admins = await prisma.user.findMany({ where: { role: 'admin', status: 'verified' }, select: { id: true } });
  emitTo(rooms.admins, 'admin:alert', message);
  await notifyUsers(admins.map((a) => a.id), message);
}

module.exports = { notifyUsers, notifyAdmins };
