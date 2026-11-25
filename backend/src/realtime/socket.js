// Socket.IO: live status for listings and deliveries, and the volunteer's live location.
//
// Client -> server
//   "subscribe:listing"  (listingId, ack)   donor/claiming NGO/admin follow a listing
//   "subscribe:delivery" (deliveryId, ack)  any party to the delivery follows it
//   "location:update"    ({ lat, lng }, ack) volunteer sends GPS while the task page is open
// Server -> client
//   "notification", "listing:status", "delivery:status", "volunteer:location",
//   "admin:alert", "issue:new", "verification:new"
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const cookie = require('cookie');
const env = require('../config/env');
const prisma = require('../lib/prisma');
const logger = require('../lib/logger');
const { createRedis } = require('../lib/redis');
const { verifyToken } = require('../lib/jwt');
const { COOKIE_NAME } = require('../middleware/auth');
const { rooms } = require('./emitter');
const { updateVolunteerLocation } = require('../modules/profiles');

function tokenFromHandshake(handshake) {
  if (handshake.auth?.token) return handshake.auth.token;
  const header = handshake.headers.cookie;
  if (header) return cookie.parse(header)[COOKIE_NAME];
  return null;
}

async function canSeeListing(user, listingId) {
  if (user.role === 'admin') return true;
  const l = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { donor: { select: { userId: true } }, claims: { select: { ngo: { select: { userId: true } } } } },
  });
  if (!l) return false;
  return l.donor.userId === user.id || l.claims.some((c) => c.ngo.userId === user.id);
}

async function canSeeDelivery(user, deliveryId) {
  if (user.role === 'admin') return true;
  const d = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    select: {
      volunteer: { select: { userId: true } },
      claim: { select: { ngo: { select: { userId: true } }, listing: { select: { donor: { select: { userId: true } } } } } },
    },
  });
  if (!d) return false;
  return [d.volunteer?.userId, d.claim.ngo.userId, d.claim.listing.donor.userId].includes(user.id);
}

const isUuid = (v) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

function attachSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.CORS_ORIGIN.split(','), credentials: true },
  });
  io.adapter(createAdapter(createRedis(), createRedis()));

  io.use(async (socket, next) => {
    try {
      const token = tokenFromHandshake(socket.handshake);
      if (!token) return next(new Error('unauthorized'));
      const { sub } = verifyToken(token);
      const user = await prisma.user.findUnique({ where: { id: sub } });
      if (!user || user.status === 'suspended') return next(new Error('unauthorized'));
      socket.data.user = user;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(rooms.user(user.id));
    if (user.role === 'admin') socket.join(rooms.admins);

    socket.on('subscribe:listing', async (listingId, ack = () => {}) => {
      if (!isUuid(listingId) || !(await canSeeListing(user, listingId))) return ack({ ok: false });
      socket.join(rooms.listing(listingId));
      ack({ ok: true });
    });

    socket.on('subscribe:delivery', async (deliveryId, ack = () => {}) => {
      if (!isUuid(deliveryId) || !(await canSeeDelivery(user, deliveryId))) return ack({ ok: false });
      socket.join(rooms.delivery(deliveryId));
      ack({ ok: true });
    });

    socket.on('location:update', async (msg, ack = () => {}) => {
      try {
        if (user.role !== 'volunteer') return ack({ ok: false });
        const lat = Number(msg?.lat);
        const lng = Number(msg?.lng);
        if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return ack({ ok: false });
        const v = await updateVolunteerLocation(user.id, { lat, lng });
        // Share it only with the parties of the volunteer's active delivery.
        const active = await prisma.delivery.findFirst({
          where: { volunteerId: v.id, status: { in: ['assigned', 'picked_up'] } },
          select: { id: true },
        });
        if (active) {
          io.to(rooms.delivery(active.id)).to(rooms.admins).emit('volunteer:location', {
            deliveryId: active.id,
            lat,
            lng,
            at: v.lastSeenAt,
          });
        }
        ack({ ok: true });
      } catch (err) {
        logger.error({ err }, 'location update failed');
        ack({ ok: false });
      }
    });
  });

  return io;
}

module.exports = { attachSocket };
