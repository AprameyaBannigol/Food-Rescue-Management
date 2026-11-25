// Socket.IO: auth, room permissions and live volunteer location.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { io: connect } = require('socket.io-client');
const h = require('./helpers');
const { attachSocket } = require('../src/realtime/socket');

let server;
let io;
let url;
const sockets = [];

before(async () => {
  await h.resetDb();
  server = http.createServer(h.app);
  io = attachSocket(server);
  await new Promise((r) => server.listen(0, r));
  url = `http://localhost:${server.address().port}`;
});

after(async () => {
  sockets.forEach((s) => s.close());
  io.close();
  await h.closeAll();
});

function open(token) {
  const s = connect(url, { auth: { token }, transports: ['websocket'], reconnection: false });
  sockets.push(s);
  return new Promise((resolve, reject) => {
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

const emitAck = (s, ev, arg) => new Promise((r) => s.emit(ev, arg, r));
const once = (s, ev, ms = 3000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no ${ev} within ${ms}ms`)), ms);
    s.once(ev, (p) => {
      clearTimeout(t);
      resolve(p);
    });
  });

test('rejects connections without a valid token', async () => {
  await assert.rejects(open('not-a-token'));
});

test('NGO follows the delivery and sees the volunteer move; outsiders cannot subscribe', async () => {
  const adm = await h.admin();
  const donor = await h.makeDonor(adm);
  const ngo = await h.makeNgo(adm, h.north(2));
  const other = await h.makeNgo(adm, h.north(3), { orgName: 'Other NGO' });
  const vol = await h.makeVolunteer(adm, h.north(0.5));
  const post = await donor.api.post('/api/listings').send(h.listingBody());
  const claim = await ngo.api.post(`/api/listings/${post.body.listing.id}/claim`).send({ servings: 10 });
  const deliveryId = claim.body.delivery.id;

  const ngoSocket = await open(ngo.token);
  const otherSocket = await open(other.token);
  const volSocket = await open(vol.token);

  assert.deepEqual(await emitAck(ngoSocket, 'subscribe:delivery', deliveryId), { ok: true });
  assert.deepEqual(await emitAck(otherSocket, 'subscribe:delivery', deliveryId), { ok: false });

  // Accepting the offer pushes a status update to the NGO
  const offer = (await vol.api.get('/api/offers/mine')).body.offers[0];
  const statusP = once(ngoSocket, 'delivery:status');
  await vol.api.post(`/api/offers/${offer.id}/accept`);
  const status = await statusP;
  assert.equal(status.status, 'assigned');

  const locP = once(ngoSocket, 'volunteer:location');
  assert.deepEqual(await emitAck(volSocket, 'location:update', { lat: 15.37, lng: 75.125 }), { ok: true });
  const loc = await locP;
  assert.equal(loc.deliveryId, deliveryId);
  assert.equal(loc.lat, 15.37);

  const v = await h.prisma.volunteer.findUnique({ where: { userId: vol.user.id } });
  assert.equal(v.currentLat, 15.37);
});
