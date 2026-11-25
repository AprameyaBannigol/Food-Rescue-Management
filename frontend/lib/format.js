// Formatting helpers. Times are shown in India time, since the pilot is in Hubballi.
const TZ = 'Asia/Kolkata';

export function fmtTime(d) {
  if (!d) return '';
  return new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
}

export function fmtDateTime(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: TZ });
}

export function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
}

export function fmtMonth(yyyyMm) {
  const [y, m] = yyyyMm.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: TZ });
}

// "1 h 20 min", "12 min", "now"
export function fmtDuration(minutes) {
  if (minutes == null || Number.isNaN(minutes)) return '';
  const m = Math.max(0, Math.round(minutes));
  if (m === 0) return 'now';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function minutesUntil(d, now = Date.now()) {
  return (new Date(d).getTime() - now) / 60000;
}

export function timeAgo(d, now = Date.now()) {
  const m = (now - new Date(d).getTime()) / 60000;
  if (m < 1) return 'just now';
  if (m < 60) return `${Math.floor(m)} min ago`;
  if (m < 24 * 60) return `${Math.floor(m / 60)} h ago`;
  return fmtDate(d);
}

export function fmtKm(km) {
  if (km == null) return '';
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

export const FOOD_TYPE = { veg: 'Veg', non_veg: 'Non-veg', mixed: 'Veg + non-veg' };
export const HOLDING = { hot: 'Kept hot (above 60°C)', room_temp: 'Room temperature', chilled: 'Chilled (below 5°C)' };
export const DONOR_TYPE = { hotel: 'Hotel', restaurant: 'Restaurant', mess: 'Mess', caterer: 'Caterer' };
export const VEHICLE = { bike: 'Bike', car: 'Car', none: 'On foot' };
export const ROLE = { donor: 'Donor', ngo: 'NGO', volunteer: 'Volunteer', admin: 'Admin' };

export const LISTING_STATUS = {
  posted: 'Posted',
  offered: 'Offered to NGOs',
  partially_claimed: 'Partly claimed',
  fully_claimed: 'Fully claimed',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

export const DELIVERY_STATUS = {
  unassigned: 'Finding a volunteer',
  assigned: 'Volunteer on the way',
  picked_up: 'Picked up',
  delivered: 'Delivered',
  confirmed: 'Confirmed',
  failed: 'Failed',
};

export const ISSUE_TYPE = {
  food_quality: 'Food quality',
  no_show: 'No show',
  wrong_quantity: 'Wrong quantity',
  safety: 'Safety',
  unmatched: 'No NGO claimed',
  no_volunteer: 'No volunteer',
  other: 'Other',
};

export const FLAG = {
  unmatched: 'Unmatched',
  expiring_soon: 'Expiring soon',
  no_volunteer: 'No volunteer',
  pickup_late: 'Pickup late',
};

export const BADGE = {
  first_delivery: { label: 'First delivery', icon: '🚲' },
  ten_deliveries: { label: '10 deliveries', icon: '⭐' },
  fifty_deliveries: { label: '50 deliveries', icon: '🏅' },
  thousand_meals: { label: '1,000 meals', icon: '🍛' },
};

export function maskPhone(phone) {
  if (!phone) return '';
  return `${phone.slice(0, 3)} ••••• ${phone.slice(-4)}`;
}

// Opens Google Maps with directions to a point (the app on phones).
export function navigateUrl(lat, lng, origin) {
  const o = origin ? `&origin=${origin.lat},${origin.lng}` : '';
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}${o}&travelmode=driving`;
}

export function distanceKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// For <input type="datetime-local">: local wall-clock string for a Date.
export function toLocalInput(d) {
  const x = new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

export const HUBBALLI = { lat: 15.3647, lng: 75.124 };
