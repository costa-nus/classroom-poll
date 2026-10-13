import { rpc, store, fmt, KeyError, MOCK } from './api.js';
import { PAIRS } from './stats.js';

const $ = s => document.querySelector(s);
const keyForm = $('#key-form'), waiting = $('#waiting'), pollForm = $('#poll-form');
const steps = $('#steps'), done = $('#done');
const answer = $('#answer'), status = $('#status');

// A random ID per browser, so resubmitting replaces the earlier answer.
let voter = store.get('cp.voter');
if (!voter) { voter = crypto.randomUUID(); store.set('cp.voter', voter); }

// A key in the link (#k=KEY, from the QR code) is saved, then removed from the address bar.
const fromLink = new URLSearchParams(location.hash.slice(1)).get('k');
if (fromLink) { store.set('cp.key', fromLink.trim().toUpperCase()); history.replaceState(null, '', location.pathname + location.search); }

if (MOCK) { $('#mock-banner').hidden = false; store.set('cp.key', 'MOCK'); }
let key = store.get('cp.key');
let poll = null, busy = false, editing = false;

function show(view) {
  for (const el of [keyForm, waiting, pollForm, steps, done]) el.hidden = el !== view;
}

function setStatus(text, cls = '') { status.textContent = text; status.className = `status ${cls}`; }

async function refresh() {
  if (!key) { show(keyForm); return; }
  try {
    const current = await rpc('poll_current', { p_key: key });
    if (!current) { poll = null; show(waiting); return; }
    if (poll?.id === current.id) return;
    poll = current;
    const mine = await rpc('poll_my_answer', { p_key: key, p_poll: poll.id, p_voter: voter });
    if (poll.kind === 'number') startNumber(mine?.value);
    else if (mine?.answer) show(done);
    else startSteps();
  } catch (e) {
    if (e instanceof KeyError) {
      store.del('cp.key'); key = null; poll = null;
      $('#key-status').textContent = 'That key is not right. Check it and try again.';
      show(keyForm);
    } else if (!pollForm.hidden) {
      setStatus(e.message, 'error');
    } else if (!steps.hidden) {
      $('#step-status').textContent = e.message;
    } else if (!poll) {
      $('#key-status').textContent = e.message; show(keyForm);
    }
  }
}

// ---- Number poll ----------------------------------------------------------
function startNumber(previous) {
  $('#question').textContent = poll.question;
  $('#answer-label').textContent = poll.unit ? `Your answer (${poll.unit})` : 'Your answer';
  answer.min = poll.min_value; answer.max = poll.max_value;
  answer.step = poll.integer_only ? '1' : 'any';
  answer.inputMode = poll.integer_only ? 'numeric' : 'decimal';
  $('#range').textContent = `Enter ${poll.integer_only ? 'a whole number' : 'a number'} from ${fmt(poll.min_value)} to ${fmt(poll.max_value)}${poll.unit ? ' ' + poll.unit : ''}.`;
  answer.value = ''; editing = false; setStatus('');
  if (previous !== null && previous !== undefined) {
    answer.value = previous;
    setStatus(`Submitted: ${fmt(previous)}${poll.unit ? ' ' + poll.unit : ''}. You can change it.`, 'ok');
  }
  show(pollForm);
}

answer.addEventListener('input', () => { editing = true; });

pollForm.addEventListener('submit', async e => {
  e.preventDefault();
  if (!answer.reportValidity() || !poll) return;
  busy = true; $('#submit').disabled = true; setStatus('Sending…');
  try {
    const r = await rpc('poll_submit', { p_key: key, p_poll: poll.id, p_voter: voter, p_value: Number(answer.value) });
    editing = false;
    setStatus(`Submitted: ${fmt(r.value)}${poll.unit ? ' ' + poll.unit : ''}. You can change it.`, 'ok');
  } catch (err) {
    setStatus(err.message, 'error');
    if (err.message.includes('closed')) poll = null;
  } finally {
    busy = false; $('#submit').disabled = false;
  }
});

// ---- Rating and ranking polls: one step at a time ---------------------------
// Each student sees the three items (rating) or three pairs (ranking) in a random
// order, and each pair with random sides. The order is kept per poll, so a reload
// shows the same sequence.
let plan = null, step = 0, picks = [];

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function planFor(p) {
  const saved = store.get(`cp.plan.${p.id}`);
  if (saved) return JSON.parse(saved);
  const made = { order: shuffle([0, 1, 2]), flip: [0, 1, 2].map(() => Math.random() < 0.5) };
  store.set(`cp.plan.${p.id}`, JSON.stringify(made));
  return made;
}

function startSteps() {
  plan = planFor(poll); step = 0; picks = [null, null, null]; editing = false;
  show(steps); renderStep();
}

function renderStep() {
  const rating = poll.kind === 'rating';
  $('#step-count').textContent = `${rating ? 'Item' : 'Pair'} ${step + 1} of 3`;
  $('#step-prompt').textContent = poll.question;
  $('#step-status').textContent = '';
  $('#step-back').hidden = step === 0;
  $('#step-next').textContent = step === 2 ? 'Submit' : 'Next';
  const body = $('#step-body');
  body.replaceChildren();

  if (rating) {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.textContent = poll.items[plan.order[step]];
    const scale = document.createElement('div');
    scale.className = 'scale'; scale.setAttribute('role', 'group'); scale.setAttribute('aria-label', 'Rating from 0 to 10');
    // Ratings must all differ, so values used on other steps are disabled.
    const used = picks.filter((v, i) => i !== step && v !== null);
    for (let v = 0; v <= 10; v++) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = v;
      b.setAttribute('aria-pressed', String(picks[step] === v));
      b.disabled = used.includes(v);
      if (b.disabled) b.title = 'Already used for another item';
      b.onclick = () => { picks[step] = v; editing = true; renderStep(); };
      scale.append(b);
    }
    const ends = document.createElement('div');
    ends.className = 'scale-ends';
    ends.innerHTML = '<span>0 = worst</span><span>10 = best</span>';
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'Give each item a different rating.';
    body.append(card, scale, ends, note);
  } else {
    const pair = PAIRS[plan.order[step]];
    const sides = plan.flip[plan.order[step]] ? [pair[1], pair[0]] : pair;
    const q = document.createElement('p');
    q.innerHTML = '<b>Which one is better?</b>';
    const row = document.createElement('div');
    row.className = 'pair';
    for (const item of sides) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'item-card';
      b.textContent = poll.items[item];
      b.setAttribute('aria-pressed', String(picks[step] === item));
      b.onclick = () => { picks[step] = item; editing = true; renderStep(); };
      row.append(b);
    }
    body.append(q, row);
  }
}

$('#step-back').onclick = () => { if (step > 0) { step -= 1; renderStep(); } };

$('#step-next').onclick = async () => {
  if (picks[step] === null) {
    $('#step-status').textContent = poll.kind === 'rating' ? 'Choose a rating first.' : 'Choose one first.';
    return;
  }
  if (step < 2) { step += 1; renderStep(); return; }

  // picks[] is in the order shown; the server wants answers per item / per pair.
  const answerBody = { shown: plan.order };
  if (poll.kind === 'rating') {
    const ratings = [0, 0, 0];
    plan.order.forEach((item, i) => { ratings[item] = picks[i]; });
    answerBody.ratings = ratings;
  } else {
    const winners = [0, 0, 0];
    plan.order.forEach((pairIndex, i) => { winners[pairIndex] = picks[i]; });
    answerBody.winners = winners;
    answerBody.shown = { pairs: plan.order, flip: plan.flip };
  }
  busy = true; $('#step-next').disabled = true; $('#step-status').textContent = 'Sending…';
  try {
    await rpc('poll_submit_choice', { p_key: key, p_poll: poll.id, p_voter: voter, p_answer: answerBody });
    editing = false; show(done);
  } catch (err) {
    $('#step-status').textContent = err.message;
    if (err.message.includes('closed')) { poll = null; editing = false; }
  } finally {
    busy = false; $('#step-next').disabled = false;
  }
};

$('#redo').onclick = () => startSteps();

// ---- Key ------------------------------------------------------------------
keyForm.addEventListener('submit', e => {
  e.preventDefault();
  key = $('#key-input').value.trim().toUpperCase();
  store.set('cp.key', key);
  $('#key-status').textContent = '';
  refresh();
});

$('#change-key').addEventListener('click', e => {
  e.preventDefault(); store.del('cp.key'); key = null; poll = null;
  $('#key-input').value = ''; show(keyForm); $('#key-input').focus();
});

refresh();
// Check for a newly opened or closed poll; do not interrupt a student who is answering.
setInterval(() => {
  if (busy) return;
  if (editing) checkClosed(); else refresh();
}, 3000);

// While answering, only notice a closed or replaced poll; keep the student's work.
async function checkClosed() {
  try {
    const current = await rpc('poll_current', { p_key: key });
    if (!current || current.id !== poll?.id) { editing = false; poll = null; refresh(); }
  } catch { /* try again on the next tick */ }
}
