// Small fetch wrapper for the Express API.
// The API sets an HTTP-only cookie at login. We also keep the returned JWT and send it
// as a Bearer token, because some phone browsers block cookies across domains
// (for example the web app on Vercel and the API on Render).
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');

const TOKEN_KEY = 'fr_token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // private mode: the cookie still works
  }
}

export class ApiError extends Error {
  constructor(message, status, error) {
    super(message);
    this.status = status;
    this.code = error?.code;
    this.details = error?.details;
  }
}

// Turns zod's flattened errors into one readable line.
function describe(error, status) {
  if (!error) return `Request failed (${status})`;
  const fields = error.details?.fieldErrors;
  if (fields && Object.keys(fields).length) {
    return Object.entries(fields)
      .map(([k, v]) => `${k}: ${[].concat(v).join(', ')}`)
      .join('; ');
  }
  const form = error.details?.formErrors;
  if (form?.length) return form.join('; ');
  return error.message || `Request failed (${status})`;
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  const token = getToken();
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'include',
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Cannot reach the server. Check your internet connection.', 0);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('fr:unauthorized'));
    }
    throw new ApiError(describe(data.error, res.status), res.status, data.error);
  }
  return data;
}

export const get = (path, opts) => api(path, opts);
export const post = (path, body = {}) => api(path, { method: 'POST', body });
export const put = (path, body = {}) => api(path, { method: 'PUT', body });
export const patch = (path, body = {}) => api(path, { method: 'PATCH', body });
