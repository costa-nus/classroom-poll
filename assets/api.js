import { SUPABASE_URL, PUBLISHABLE_KEY } from './config.js';

export class KeyError extends Error {}

// Calls one RPC function. Throws KeyError for a wrong key, Error otherwise.
export async function rpc(fn, args) {
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
  } catch {
    throw new Error('Cannot reach the poll server. Check your connection and try again.');
  }
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    if (body?.code === '28000') throw new KeyError('Wrong key.');
    if (response.status === 540 || response.status === 503) {
      throw new Error('The poll server is paused. The instructor must resume it in Supabase.');
    }
    throw new Error(body?.message || `Server error (${response.status}).`);
  }
  return body;
}

// localStorage can throw (private windows, blocked storage); fall back to memory.
const memory = {};
export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return memory[k] ?? null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { memory[k] = v; } },
  del(k) { try { localStorage.removeItem(k); } catch { delete memory[k]; } },
};

export function fmt(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return '–';
  const n = Number(x);
  return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(4)));
}
