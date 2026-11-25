// Emits Socket.IO events from anywhere (API routes or a separate worker process)
// by publishing through Redis. The Socket.IO server uses the Redis adapter, so
// every server instance delivers the event to its connected clients.
const { Emitter } = require('@socket.io/redis-emitter');
const { createRedis } = require('../lib/redis');

let emitter = null;

function getEmitter() {
  if (!emitter) emitter = new Emitter(createRedis());
  return emitter;
}

const rooms = {
  user: (id) => `user:${id}`,
  delivery: (id) => `delivery:${id}`,
  listing: (id) => `listing:${id}`,
  admins: 'role:admin',
};

function emitTo(room, event, payload) {
  getEmitter().to(room).emit(event, payload);
}

module.exports = { emitTo, rooms };
