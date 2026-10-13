import { rpc, store, fmt, KeyError } from './api.js';
import { summarize, binValues } from './stats.js';
import { histogramSvg, escapeHtml } from './histogram.js';

const $ = s => document.querySelector(s);
let adminKey = store.get('cp.admin');
let selected = null;        // id of the poll shown in the results view
let latest = null;          // last poll_results payload
let showDistribution = false; // present mode starts with the count only

const studentUrl = new URL('./', location.href).href;

function setStatus(el, text, cls = '') { el.textContent = text; el.className = `status ${cls}`; }

function signOut(message = '') {
  store.del('cp.admin'); adminKey = null;
  $('#app').hidden = true; $('#login').hidden = false;
  setStatus($('#login-status'), message, 'error');
}

async function call(fn, args) {
  try { return await rpc(fn, { p_admin: adminKey, ...args }); }
  catch (e) { if (e instanceof KeyError) signOut('That instructor key is not right.'); throw e; }
}

// ---- list ---------------------------------------------------------------
async function loadList() {
  const polls = await call('poll_list', {});
  $('#list-empty').hidden = polls.length > 0;
  $('#list').innerHTML = polls.map(p => `
    <tr>
      <td>${escapeHtml(p.question)}</td>
      <td>${fmt(p.min_value)}–${fmt(p.max_value)} ${escapeHtml(p.unit)}${p.integer_only ? '' : ' (decimals)'}</td>
      <td>${p.responses}</td>
      <td><span class="badge ${p.is_open ? 'open' : ''}">${p.is_open ? 'Open' : 'Closed'}</span></td>
      <td class="actions">
        <button class="small" data-act="view" data-id="${p.id}">Results</button>
        <button class="small" data-act="${p.is_open ? 'close' : 'open'}" data-id="${p.id}">${p.is_open ? 'Close' : 'Open'}</button>
        <button class="small danger" data-act="delete" data-id="${p.id}">Delete</button>
      </td>
    </tr>`).join('');
}

$('#list').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const id = b.dataset.id;
  if (b.dataset.act === 'view') return view(id);
  if (b.dataset.act === 'open' || b.dataset.act === 'close') {
    await call('poll_set_open', { p_poll: id, p_open: b.dataset.act === 'open' });
  }
  if (b.dataset.act === 'delete') {
    if (!confirm('Delete this poll and all its answers? This cannot be undone.')) return;
    await call('poll_delete', { p_poll: id });
    if (selected === id) closeView();
  }
  loadList();
});

// ---- create -------------------------------------------------------------
$('#create').addEventListener('submit', async e => {
  e.preventDefault();
  const open = e.submitter?.dataset.open === '1';
  const min = Number($('#c-min').value), max = Number($('#c-max').value);
  const st = $('#create-status');
  if (!(min < max)) return setStatus(st, 'The lowest value must be below the highest.', 'error');
  try {
    const { id } = await call('poll_create', {
      p_question: $('#c-question').value, p_unit: $('#c-unit').value,
      p_min: min, p_max: max, p_integer_only: $('#c-integer').checked,
    });
    if (open) await call('poll_set_open', { p_poll: id, p_open: true });
    $('#c-question').value = '';
    setStatus(st, open ? 'Created and opened. Opening a poll closes any other open poll.' : 'Created.', 'ok');
    await loadList();
    if (open) view(id);
  } catch (err) { setStatus(st, err.message, 'error'); }
});

// ---- results view -------------------------------------------------------
async function view(id) {
  selected = id; $('#results').hidden = false;
  await refreshResults();
  $('#results').scrollIntoView({ behavior: 'smooth' });
}
function closeView() { selected = null; latest = null; $('#results').hidden = true; }

async function refreshResults() {
  if (!selected) return;
  latest = await call('poll_results', { p_poll: selected });
  if (!latest) return closeView();
  render();
}

function render() {
  const p = latest, s = summarize(p.values);
  const unit = p.unit ? ` ${p.unit}` : '';
  $('#r-question').textContent = p.question;
  $('#r-meta').textContent = `${p.is_open ? 'Open' : 'Closed'} · range ${fmt(p.min_value)}–${fmt(p.max_value)}${unit} · ${p.integer_only ? 'whole numbers' : 'decimals allowed'}`;
  $('#r-toggle').textContent = p.is_open ? 'Close poll' : 'Open poll';
  const cells = s.n ? [['Answers', s.n], ['Mean', fmt(s.mean)], ['Median', fmt(s.median)], ['SD', fmt(s.sd)],
    ['Min', fmt(s.min)], ['Q1', fmt(s.q1)], ['Q3', fmt(s.q3)], ['Max', fmt(s.max)]] : [['Answers', 0]];
  $('#r-stats').innerHTML = cells.map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
  const hist = histogram(s);
  $('#r-hist').innerHTML = hist;

  // Present mode
  $('#p-question').textContent = p.question;
  $('#p-count').textContent = `${s.n} ${s.n === 1 ? 'answer' : 'answers'}`;
  $('#p-hist').innerHTML = showDistribution ? hist : '';
  $('#p-toggle').textContent = p.is_open ? 'Close poll' : 'Open poll';
  $('#p-show').textContent = showDistribution ? 'Hide distribution' : 'Show distribution';
}

function histogram(s) {
  const p = latest;
  const values = p.values.map(Number);
  const bins = binValues(values, Number(p.min_value), Number(p.max_value), p.integer_only);
  const answerText = $('#r-answer').value;
  return histogramSvg(bins, p.integer_only, p.unit, {
    mean: $('#r-mean').checked && s.n ? s.mean : undefined,
    answer: answerText === '' ? undefined : Number(answerText),
  });
}

async function toggleOpen() {
  await call('poll_set_open', { p_poll: selected, p_open: !latest.is_open });
  await Promise.all([refreshResults(), loadList()]);
}
$('#r-toggle').onclick = toggleOpen;
$('#p-toggle').onclick = toggleOpen;
$('#r-close-view').onclick = closeView;
$('#r-answer').oninput = () => latest && render();
$('#r-mean').onchange = () => latest && render();

// ---- present mode -------------------------------------------------------
function studentLink() {
  const k = store.get('cp.studentKey');
  return k ? `${studentUrl}#k=${encodeURIComponent(k)}` : studentUrl;
}
function present() {
  const qr = qrcode(0, 'M'); qr.addData(studentLink()); qr.make();
  $('#p-qr').innerHTML = qr.createSvgTag({ cellSize: 8, margin: 4, scalable: true });
  $('#p-url').textContent = studentUrl.replace(/^https?:\/\//, '');
  $('#p-key').textContent = store.get('cp.studentKey') || '';
  showDistribution = false; render();
  $('#present').hidden = false;
  document.documentElement.requestFullscreen?.().catch(() => {});
}
function exitPresent() {
  $('#present').hidden = true;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
$('#r-present').onclick = present;
$('#p-exit').onclick = exitPresent;
$('#p-show').onclick = () => { showDistribution = !showDistribution; render(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#present').hidden) exitPresent(); });

// ---- student key (local only) and key rotation --------------------------
function showStudentLink() {
  const k = store.get('cp.studentKey');
  $('#student-key').value = k || '';
  $('#student-link').textContent = k ? `QR link: ${studentUrl}#k=${k}` : `Student page: ${studentUrl}`;
}
$('#student-key-save').onclick = async () => {
  const k = $('#student-key').value.trim().toUpperCase();
  try {
    await rpc('poll_current', { p_key: k });
    store.set('cp.studentKey', k); showStudentLink();
  } catch (e) {
    $('#student-link').textContent = e instanceof KeyError ? 'That is not the current student key.' : e.message;
  }
};

$('#rotate').addEventListener('submit', async e => {
  e.preventDefault();
  const role = $('#k-role').value, next = $('#k-new').value.trim();
  const value = role === 'student' ? next.toUpperCase() : next;
  if (!confirm(`Change the ${role} key? The old one stops working at once.`)) return;
  try {
    await call('poll_set_key', { p_role: role, p_new: value });
    if (role === 'instructor') { adminKey = value; store.set('cp.admin', value); }
    else { store.set('cp.studentKey', value); showStudentLink(); }
    $('#k-new').value = '';
    setStatus($('#rotate-status'), `The ${role} key is changed. Store it in your password manager.`, 'ok');
  } catch (err) { setStatus($('#rotate-status'), err.message, 'error'); }
});

// ---- sign in ------------------------------------------------------------
$('#login').addEventListener('submit', async e => {
  e.preventDefault();
  adminKey = $('#admin-key').value.trim();
  try { await start(); store.set('cp.admin', adminKey); }
  catch (err) { if (!(err instanceof KeyError)) setStatus($('#login-status'), err.message, 'error'); }
});
$('#sign-out').onclick = () => signOut();

async function start() {
  await loadList();
  $('#login').hidden = true; $('#app').hidden = false; $('#admin-key').value = '';
  showStudentLink();
}

if (adminKey) {
  start().catch(e => { if (!(e instanceof KeyError)) { $('#login').hidden = false; setStatus($('#login-status'), e.message, 'error'); } });
} else $('#login').hidden = false;

// Live refresh while signed in.
setInterval(() => {
  if (!adminKey || document.hidden) return;
  if (selected) refreshResults().catch(() => {});
  if (!$('#list-section').hidden && $('#present').hidden) loadList().catch(() => {});
}, 2000);
