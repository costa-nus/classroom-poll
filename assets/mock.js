// Mock run: the same RPC functions, answered in this browser from localStorage.
// Nothing is sent to Supabase. Used when the page URL has ?mock=1.
// The rules follow supabase/*.sql so a rehearsal behaves like class.

const DB_KEY = 'mock.db';
const load = () => { try { return JSON.parse(localStorage.getItem(DB_KEY)) || { polls: [], resp: {} }; } catch { return { polls: [], resp: {} }; } };
const save = db => { try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch { /* storage blocked */ } };
const fail = message => { throw new Error(message); };

export function resetMock(polls = []) {
  save({ polls: polls.map(p => ({ ...p, is_open: false, hidden_items: p.hidden_items || [] })), resp: {} });
}

export async function mockRpc(fn, a) {
  const db = load();
  const poll = id => db.polls.find(p => p.id === id) || fail('Poll not found');
  const responses = id => (db.resp[id] ||= {});
  const result = (() => {
    switch (fn) {
      case 'poll_current': {
        const p = db.polls.find(q => q.is_open);
        return p ? { id: p.id, question: p.question, unit: p.unit, min_value: p.min_value, max_value: p.max_value,
                     integer_only: p.integer_only, kind: p.kind, items: p.items } : null;
      }
      case 'poll_my_answer': {
        const r = db.resp[a.p_poll]?.[a.p_voter];
        return { value: r?.value ?? null, answer: r?.answer ?? null };
      }
      case 'poll_submit': {
        const p = poll(a.p_poll);
        if (p.kind !== 'number') fail('This poll does not take a number');
        if (!p.is_open) fail('This poll is closed');
        if (a.p_value < p.min_value || a.p_value > p.max_value) fail(`Answer must be between ${p.min_value} and ${p.max_value}`);
        if (p.integer_only && !Number.isInteger(a.p_value)) fail('Answer must be a whole number');
        responses(p.id)[a.p_voter] = { value: a.p_value };
        return { value: a.p_value };
      }
      case 'poll_submit_choice': {
        const p = poll(a.p_poll), ans = a.p_answer || {};
        if (p.kind === 'number') fail('This poll takes a number');
        if (!p.is_open) fail('This poll is closed');
        if (p.kind === 'rating') {
          const r = ans.ratings;
          if (!Array.isArray(r) || r.length !== 3 || r.some(v => !Number.isInteger(v) || v < 0 || v > 10)) fail('Ratings must be whole numbers from 0 to 10');
          if (new Set(r).size !== 3) fail('Give each item a different rating');
        } else {
          const w = ans.winners;
          if (!Array.isArray(w) || ![0, 1].includes(w[0]) || ![0, 2].includes(w[1]) || ![1, 2].includes(w[2])) fail('Choose one item in each pair');
        }
        responses(p.id)[a.p_voter] = { answer: ans };
        return { answer: ans };
      }
      case 'poll_create': {
        const id = crypto.randomUUID(), kind = a.p_kind || 'number';
        db.polls.unshift({ id, question: a.p_question.trim(), unit: kind === 'number' ? (a.p_unit || '') : '',
          min_value: kind === 'number' ? a.p_min : 0, max_value: kind === 'number' ? a.p_max : kind === 'rating' ? 10 : 1,
          integer_only: kind === 'number' ? a.p_integer_only : true, kind, items: kind === 'number' ? null : a.p_items,
          hidden_items: [], is_open: false, created_at: new Date().toISOString() });
        return { id };
      }
      case 'poll_set_open':
        for (const p of db.polls) {
          if (a.p_open && p.id !== a.p_poll) p.is_open = false;
          if (p.id === a.p_poll) p.is_open = a.p_open;
        }
        return null;
      case 'poll_set_hidden':
        poll(a.p_poll).hidden_items = [...new Set(a.p_hidden)];
        return null;
      case 'poll_list':
        return db.polls.map(p => ({ ...p, responses: Object.keys(db.resp[p.id] || {}).length }));
      case 'poll_results': {
        const p = db.polls.find(q => q.id === a.p_poll);
        if (!p) return null;
        const rs = Object.values(db.resp[p.id] || {});
        return { ...p, values: rs.filter(r => r.value != null).map(r => r.value), answers: rs.filter(r => r.answer).map(r => r.answer) };
      }
      case 'poll_delete':
        db.polls = db.polls.filter(p => p.id !== a.p_poll);
        delete db.resp[a.p_poll];
        return null;
      case 'poll_set_key':
        return null;  // keys are not used in a mock run
      default:
        return fail(`Unknown function ${fn}`);
    }
  })();
  save(db);
  return result;
}

// ---- simulated students ----------------------------------------------------
// Each poll gets a hidden "true quality" per item; simulated students rate or
// compare with noise around it, so results look like a real class (some
// disagreement, occasional ranking cycles).
function seeded(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return () => ((h = (h * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const noise = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2;  // roughly N(0, 1.4)

export function simulateAnswers(count) {
  const db = load();
  const p = db.polls.find(q => q.is_open);
  if (!p) return 'Open a poll first.';
  const rand = seeded(p.items ? p.items.join('|') : p.id);
  const quality = [0, 1, 2].map(() => 2 + rand() * 6);
  const rs = (db.resp[p.id] ||= {});
  for (let k = 0; k < count; k++) {
    let entry;
    if (p.kind === 'number') {
      const mid = (Number(p.min_value) + Number(p.max_value)) / 2, spread = (p.max_value - p.min_value) / 6;
      let v = mid + noise() * spread / 1.4;
      v = Math.min(p.max_value, Math.max(p.min_value, v));
      entry = { value: p.integer_only ? Math.round(v) : Math.round(v * 10) / 10 };
    } else if (p.kind === 'rating') {
      let r;
      do { r = quality.map(q => Math.min(10, Math.max(0, Math.round(q + noise())))); } while (new Set(r).size !== 3);
      entry = { answer: { ratings: r } };
    } else {
      const beats = (i, j) => Math.random() < 1 / (1 + Math.exp(-(quality[i] - quality[j]) / 1.5));
      entry = { answer: { winners: [beats(0, 1) ? 0 : 1, beats(0, 2) ? 0 : 2, beats(1, 2) ? 1 : 2] } };
    }
    rs[`sim-${crypto.randomUUID()}`] = entry;
  }
  save(db);
  return `Added ${count} simulated answers to "${p.question.slice(0, 50)}".`;
}
