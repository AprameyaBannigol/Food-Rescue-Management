// Photo and document uploads. The API only stores URLs.
// With Cloudinary configured, files go there through an unsigned upload preset.
// Otherwise (demo mode) we make a tiny JPEG thumbnail as a data URL that fits the
// API's 2,000-character URL limit, so the whole flow can be tried locally.
const CLOUD = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
const PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

export const uploadsConfigured = Boolean(CLOUD && PRESET);

export async function uploadFile(file, folder = 'food-rescue') {
  if (uploadsConfigured) {
    const form = new FormData();
    form.append('file', file);
    form.append('upload_preset', PRESET);
    form.append('folder', folder);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/auto/upload`, { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.secure_url) throw new Error(data.error?.message || 'Upload failed');
    return data.secure_url;
  }
  if (!file.type.startsWith('image/')) {
    // Demo mode cannot store a PDF; keep a placeholder link with the file name.
    return `https://example.org/demo-upload/${encodeURIComponent(file.name.slice(0, 80))}`;
  }
  return tinyThumbnail(file);
}

async function tinyThumbnail(file) {
  const bitmap = await loadImage(file);
  const canvas = document.createElement('canvas');
  for (const [size, quality] of [[64, 0.6], [48, 0.5], [40, 0.4], [32, 0.35], [24, 0.3]]) {
    const scale = size / Math.max(bitmap.width, bitmap.height);
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length < 1900) return url;
  }
  throw new Error('Could not shrink the photo');
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      resolve(img);
    };
    img.onerror = () => reject(new Error('That file is not an image'));
    img.src = URL.createObjectURL(file);
  });
}

// One GPS reading. Resolves null if the user says no or it times out.
export function currentPosition({ timeout = 10000 } = {}) {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 60000 },
    );
  });
}
