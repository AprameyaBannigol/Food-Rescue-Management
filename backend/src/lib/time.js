// Time helpers. The pilot runs in Hubballi, so "local" means Asia/Kolkata (UTC+05:30, no DST).
const IST_OFFSET_MIN = 330;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * MINUTE);
}

// Minutes since local midnight for a Date, in IST.
function istMinuteOfDay(date) {
  const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes();
  return (utcMin + IST_OFFSET_MIN) % (24 * 60);
}

// Start of the IST calendar day containing `date`, returned as a UTC Date.
function istStartOfDay(date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MIN * MINUTE);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - IST_OFFSET_MIN * MINUTE);
}

// "HH:MM" -> minutes since midnight
function parseHHMM(value) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!m) throw new Error(`Invalid time "${value}", expected HH:MM`);
  return Number(m[1]) * 60 + Number(m[2]);
}

// Is `date` (IST) within the window from..to? Handles windows that cross midnight (22:00-07:00).
function isWithinDailyWindow(date, from, to) {
  const t = istMinuteOfDay(date);
  const a = parseHHMM(from);
  const b = parseHHMM(to);
  if (a === b) return true; // treat as open all day
  return a < b ? t >= a && t <= b : t >= a || t <= b;
}

module.exports = { MINUTE, HOUR, addMinutes, istMinuteOfDay, istStartOfDay, parseHHMM, isWithinDailyWindow };
