// Distance and travel-time estimates. Uses straight-line distance from PostGIS
// times a road factor; swap in Google Distance Matrix or OSRM here later.
function travelMinutes(distanceKm, settings) {
  const roadKm = distanceKm * settings.road_factor;
  return Math.ceil((roadKm / settings.avg_speed_kmph) * 60);
}

// Haversine distance in km, for places where we already have both points in memory.
function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

module.exports = { travelMinutes, haversineKm };
