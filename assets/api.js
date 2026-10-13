import { SUPABASE_URL, PUBLISHABLE_KEY } from './config.js';

export class KeyError extends Error {}

// Mock run (?mock=1): answers come from this browser, nothing goes online.
export const MOCK = new URLSearchParams(location.search).has('mock');

// Calls one RPC function. Throws KeyError for a wrong key, Error otherwise.
export async function rpc(fn, args) {
  if (MOCK) {
    const { mockRpc } = await import('./mock.js');
    return mockRpc(fn, args);
  }
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
// A mock run keeps its own copies, so it never touches the real key or answers.
const memory = {};
const ns = k => (MOCK ? `mock.${k}` : k);
export const store = {
  get(k) { try { return localStorage.getItem(ns(k)); } catch { return memory[ns(k)] ?? null; } },
  set(k, v) { try { localStorage.setItem(ns(k), v); } catch { memory[ns(k)] = v; } },
  del(k) { try { localStorage.removeItem(ns(k)); } catch { delete memory[ns(k)]; } },
};

export function fmt(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return '–';
  const n = Number(x);
  return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(4)));
}
