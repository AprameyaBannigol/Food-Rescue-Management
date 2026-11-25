// Demo data for local development: verified donors, NGOs and volunteers around Hubballi.
// Names are placeholders; coordinates are approximate.
// Run: npm run db:seed   (log in with any of these phones; OTPs print in the server log)
require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const now = new Date();

const donors = [
  { phone: '+919800000101', name: 'Demo Hotel Manager', orgName: 'Demo Hotel (Station Road)', type: 'hotel', lat: 15.3509, lng: 75.1388, address: 'Station Road, Hubballi' },
  { phone: '+919800000102', name: 'Demo Mess Incharge', orgName: 'Demo College Mess (Vidyanagar)', type: 'mess', lat: 15.3687, lng: 75.1236, address: 'Vidyanagar, Hubballi' },
];
const ngos = [
  { phone: '+919800000201', name: 'Demo Shelter Lead', orgName: 'Demo Night Shelter', lat: 15.3577, lng: 75.1452, address: 'Old Hubli', dailyCapacity: 150, vegOnly: false, openFrom: '06:00', openTo: '23:00' },
  { phone: '+919800000202', name: 'Demo Orphanage Lead', orgName: 'Demo Children\'s Home', lat: 15.3772, lng: 75.1105, address: 'Keshwapur, Hubballi', dailyCapacity: 80, vegOnly: true, openFrom: '07:00', openTo: '21:00' },
  { phone: '+919800000203', name: 'Demo Kitchen Lead', orgName: 'Demo Community Kitchen', lat: 15.3441, lng: 75.1289, address: 'Gokul Road, Hubballi', dailyCapacity: 300, vegOnly: false, openFrom: '00:00', openTo: '23:59' },
];
const volunteers = [
  { phone: '+919800000301', name: 'Demo Volunteer Bike', vehicle: 'bike', lat: 15.3601, lng: 75.1301 },
  { phone: '+919800000302', name: 'Demo Volunteer Car', vehicle: 'car', lat: 15.3655, lng: 75.1402 },
  { phone: '+919800000303', name: 'Demo Volunteer On Call', vehicle: 'bike', lat: 15.3523, lng: 75.1201, isOnCall: true },
];

async function main() {
  for (const d of donors) {
    const { phone, name, ...profile } = d;
    await prisma.user.upsert({
      where: { phone },
      update: {},
      create: {
        phone, name, role: 'donor', status: 'verified',
        donor: { create: { ...profile, fssaiLicenceNo: '10000000000000', licenceUrl: 'https://example.com/fssai.pdf', verifiedAt: now } },
      },
    });
  }
  for (const n of ngos) {
    const { phone, name, ...profile } = n;
    await prisma.user.upsert({
      where: { phone },
      update: {},
      create: {
        phone, name, role: 'ngo', status: 'verified',
        ngo: { create: { ...profile, regCertNo: 'DEMO/REG/001', regCertUrl: 'https://example.com/cert.pdf', verifiedAt: now } },
      },
    });
  }
  for (const v of volunteers) {
    const { phone, name, lat, lng, isOnCall = false, vehicle } = v;
    await prisma.user.upsert({
      where: { phone },
      update: {},
      create: {
        phone, name, role: 'volunteer', status: 'verified',
        volunteer: {
          create: { vehicle, idProofUrl: 'https://example.com/id.jpg', isAvailable: true, isOnCall, currentLat: lat, currentLng: lng, lastSeenAt: now, verifiedAt: now },
        },
      },
    });
  }
  console.log(`Seeded ${donors.length} donors, ${ngos.length} NGOs, ${volunteers.length} volunteers.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
