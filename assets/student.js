import { rpc, store, fmt, KeyError } from './api.js';

const $ = s => document.querySelector(s);
const keyForm = $('#key-form'), waiting = $('#waiting'), pollForm = $('#poll-form');
const answer = $('#answer'), status = $('#status');

// A random ID per browser, so resubmitting replaces the earlier answer.
let voter = store.get('cp.voter');
if (!voter) { voter = crypto.randomUUID(); store.set('cp.voter', voter); }

// A key in the link (#k=KEY, from the QR code) is saved, then removed from the address bar.
const fromLink = new URLSearchParams(location.hash.slice(1)).get('k');
if (fromLink) { store.set('cp.key', fromLink.trim().toUpperCase()); history.replaceState(null, '', location.pathname); }

let key = store.get('cp.key');
let poll = null, busy = false, editing = false;

function show(view) {
  for (const el of [keyForm, waiting, pollForm]) el.hidden = el !== view;
}

function setStatus(text, cls = '') { status.textContent = text; status.className = `status ${cls}`; }

async function refresh() {
  if (!key) { show(keyForm); return; }
  try {
    const current = await rpc('poll_current', { p_key: key });
    if (!current) { poll = null; show(waiting); return; }
    if (poll?.id !== current.id) {
      poll = current;
      $('#question').textContent = poll.question;
      $('#answer-label').textContent = poll.unit ? `Your answer (${poll.unit})` : 'Your answer';
      answer.min = poll.min_value; answer.max = poll.max_value;
      answer.step = poll.integer_only ? '1' : 'any';
      answer.inputMode = poll.integer_only ? 'numeric' : 'decimal';
      $('#range').textContent = `Enter ${poll.integer_only ? 'a whole number' : 'a number'} from ${fmt(poll.min_value)} to ${fmt(poll.max_value)}${poll.unit ? ' ' + poll.unit : ''}.`;
      answer.value = ''; editing = false; setStatus('');
      const mine = await rpc('poll_my_answer', { p_key: key, p_poll: poll.id, p_voter: voter });
      if (mine?.value !== null && mine?.value !== undefined) {
        answer.value = mine.value;
        setStatus(`Submitted: ${fmt(mine.value)}${poll.unit ? ' ' + poll.unit : ''}. You can change it.`, 'ok');
      }
    }
    show(pollForm);
  } catch (e) {
    if (e instanceof KeyError) {
      store.del('cp.key'); key = null;
      $('#key-status').textContent = 'That key is not right. Check it and try again.';
      show(keyForm);
    } else if (!pollForm.hidden) {
      setStatus(e.message, 'error');
    } else {
      $('#key-status').textContent = e.message; show(keyForm);
    }
  }
}

keyForm.addEventListener('submit', e => {
  e.preventDefault();
  key = $('#key-input').value.trim().toUpperCase();
  store.set('cp.key', key);
  $('#key-status').textContent = '';
  refresh();
});

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

$('#change-key').addEventListener('click', e => {
  e.preventDefault(); store.del('cp.key'); key = null; poll = null;
  $('#key-input').value = ''; show(keyForm); $('#key-input').focus();
});

refresh();
// Check for a newly opened or closed poll; do not interrupt a student who is typing.
setInterval(() => { if (!busy && !editing) refresh(); }, 3000);
