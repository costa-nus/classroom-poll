import { rpc, store, fmt, KeyError, MOCK } from './api.js';
import { summarize, binValues, summarizeOrders, orderLabel, LETTERS, ORDERS, CYCLE } from './stats.js';
import { histogramSvg, orderChartSvg, escapeHtml } from './histogram.js';

const $ = s => document.querySelector(s);
let adminKey = store.get('cp.admin');
let polls = [];             // last poll_list
let selected = null;        // id of the poll shown in the results view
let latest = null;          // last poll_results payload for it
let comparing = null;       // { rating, ranking } poll results shown in the comparison
let presentMode = null;     // 'poll' | 'compare' while full screen
let presentView = 'count';  // full-screen view: count | averages | agreement | revealed | top2 | all

const studentUrl = new URL('./', location.href).href + (MOCK ? '?mock=1' : '');
const KIND_NAMES = { number: 'Number', rating: 'Rating', ranking: 'Ranking' };
const pct = x => (x === null || x === undefined ? '–' : `${Math.round(x * 100)}%`);
const short = (s, n = 140) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

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

function kindText(p) {
  if (p.kind === 'rating') return 'Rating 0–10';
  if (p.kind === 'ranking') return 'Ranking, 3 pairs';
  return `Number ${fmt(p.min_value)}–${fmt(p.max_value)} ${escapeHtml(p.unit)}${p.integer_only ? '' : ' (decimals)'}`;
}

// ---- list ---------------------------------------------------------------
async function loadList() {
  polls = await call('poll_list', {});
  $('#list-empty').hidden = polls.length > 0;
  $('#list').innerHTML = polls.map(p => `
    <tr>
      <td>${escapeHtml(p.question)}</td>
      <td>${kindText(p)}</td>
      <td>${p.responses}</td>
      <td><span class="badge ${p.is_open ? 'open' : ''}">${p.is_open ? 'Open' : 'Closed'}</span></td>
      <td class="actions">
        <button class="small" data-act="view" data-id="${p.id}">Results</button>
        <button class="small" data-act="${p.is_open ? 'close' : 'open'}" data-id="${p.id}">${p.is_open ? 'Close' : 'Open'}</button>
        <button class="small danger" data-act="delete" data-id="${p.id}">Delete</button>
      </td>
    </tr>`).join('');
  fillCompareSelects();
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
function updateCreateForm() {
  const kind = $('#c-kind').value, choice = kind !== 'number';
  $('#c-number-fields').hidden = choice;
  $('#c-choice-fields').hidden = !choice;
  $('#c-question-label').textContent = choice ? 'Question shown above the items' : 'Question';
  $('#c-question').placeholder = choice
    ? 'Which answer explains self-attention best?'
    : 'How much GPU memory does a 7B model need for full training?';
  $('#c-both-label').textContent = kind === 'rating'
    ? 'Also create a ranking poll with the same question and items (closed)'
    : 'Also create a rating poll with the same question and items (closed)';
}
$('#c-kind').onchange = updateCreateForm;

$('#create').addEventListener('submit', async e => {
  e.preventDefault();
  const open = e.submitter?.dataset.open === '1';
  const kind = $('#c-kind').value, st = $('#create-status');
  const question = $('#c-question').value;
  let args;
  if (kind === 'number') {
    const min = Number($('#c-min').value), max = Number($('#c-max').value);
    if ($('#c-min').value === '' || $('#c-max').value === '' || !(min < max)) {
      return setStatus(st, 'Set a lowest value below the highest value.', 'error');
    }
    args = { p_question: question, p_unit: $('#c-unit').value, p_min: min, p_max: max,
             p_integer_only: $('#c-integer').checked, p_kind: 'number', p_items: null };
  } else {
    const items = [0, 1, 2].map(i => $(`#c-item-${i}`).value.trim());
    if (items.some(t => !t)) return setStatus(st, 'Fill in all three items.', 'error');
    args = { p_question: question, p_unit: '', p_min: 0, p_max: 10, p_integer_only: true, p_kind: kind, p_items: items };
  }
  try {
    const { id } = await call('poll_create', args);
    let made = `${KIND_NAMES[kind]} poll created`;
    if (kind !== 'number' && $('#c-both').checked) {
      const other = kind === 'rating' ? 'ranking' : 'rating';
      await call('poll_create', { ...args, p_kind: other });
      made += ` with a closed ${other} poll on the same items`;
    }
    if (open) await call('poll_set_open', { p_poll: id, p_open: true });
    $('#c-question').value = '';
    for (const i of [0, 1, 2]) $(`#c-item-${i}`).value = '';
    setStatus(st, `${made}${open ? ' and opened. Opening a poll closes any other open poll.' : '.'}`, 'ok');
    await loadList();
    if (open) view(id);
  } catch (err) { setStatus(st, err.message, 'error'); }
});

// ---- results view -------------------------------------------------------
async function view(id) {
  closeCompare();
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

function legendHtml(p, summary) {
  return p.items.map((text, i) => {
    let extra = '';
    if (summary?.n) {
      extra = p.kind === 'rating'
        ? ` <span class="note">— mean rating ${summary.perItem[i].toFixed(1)}</span>`
        : ` <span class="note">— won ${summary.perItem[i]} of ${2 * summary.n} pairs</span>`;
    }
    return `<li><b>${LETTERS[i]}</b> ${escapeHtml(short(text))}${extra}</li>`;
  }).join('');
}

function topText(s) {
  return s.top.length ? s.top.map(orderLabel).join(' / ') : '–';
}

function render() {
  const p = latest;
  $('#r-question').textContent = p.question;
  $('#r-toggle').textContent = p.is_open ? 'Close poll' : 'Open poll';
  $('#p-toggle').textContent = p.is_open ? 'Close poll' : 'Open poll';
  $('#p-question').textContent = p.question;
  let chart, presentHtml = '', n;

  if (p.kind === 'number') {
    const s = summarize(p.values); n = s.n;
    const unit = p.unit ? ` ${p.unit}` : '';
    $('#r-meta').textContent = `Number · ${p.is_open ? 'open' : 'closed'} · range ${fmt(p.min_value)}–${fmt(p.max_value)}${unit} · ${p.integer_only ? 'whole numbers' : 'decimals allowed'}`;
    const cells = s.n ? [['Answers', s.n], ['Mean', fmt(s.mean)], ['Median', fmt(s.median)], ['SD', fmt(s.sd)],
      ['Min', fmt(s.min)], ['Q1', fmt(s.q1)], ['Q3', fmt(s.q3)], ['Max', fmt(s.max)]] : [['Answers', 0]];
    $('#r-stats').innerHTML = cells.map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
    $('#r-legend').innerHTML = '';
    $('#r-number-controls').hidden = false;
    $('#r-hidden-controls').hidden = true;
    const bins = binValues(p.values.map(Number), Number(p.min_value), Number(p.max_value), p.integer_only);
    const answerText = $('#r-answer').value;
    chart = histogramSvg(bins, p.integer_only, p.unit, {
      mean: $('#r-mean').checked && s.n ? s.mean : undefined,
      answer: answerText === '' ? undefined : Number(answerText),
    });
    if (presentView === 'all') presentHtml = chart;
  } else {
    const s = summarizeOrders(p.kind, p.answers); n = s.n;
    $('#r-meta').textContent = `${KIND_NAMES[p.kind]} · ${p.is_open ? 'open' : 'closed'} · ${p.kind === 'rating'
      ? 'each student rates A, B, C from 0 to 10 (all different)'
      : 'each student picks the better item in A–B, A–C, B–C'}`;
    const cells = [['Answers', s.n], ['Most popular order', topText(s)], ['Agree on it', pct(s.topShare)]];
    if (p.kind === 'ranking') cells.push(['No order (cycle)', s.n ? `${s.cycles} (${pct(s.cycles / s.n)})` : '0']);
    $('#r-stats').innerHTML = cells.map(([k, v]) => `<div><b>${escapeHtml(String(v))}</b><span>${k}</span></div>`).join('');
    $('#r-legend').innerHTML = legendHtml(p, s);
    $('#r-number-controls').hidden = true;
    const cls = p.kind === 'rating' ? 'rating-bar' : 'ranking-bar';
    chart = orderChartSvg(s.keys, [{ name: KIND_NAMES[p.kind], cls, summary: s }], orderLabel);
    showHiddenControls(p);
    presentHtml = choicePresentHtml(p, s, chart);
  }
  $('#r-chart').innerHTML = chart;
  if (presentMode === 'poll') {
    $('#p-count').textContent = `${n} ${n === 1 ? 'answer' : 'answers'}`;
    $('#p-chart').innerHTML = presentHtml;
    updatePresentButtons(p.kind);
  }
}

// What the full-screen view shows for a rating or ranking poll.
function choicePresentHtml(p, s, chart) {
  const legend = `<ul class="legend">${legendHtml(p, null)}</ul>`;
  const agreement = `<div class="big">${pct(s.topShare)}</div>
    <p>of students gave the most popular order${s.top.length > 1 ? 's (tied)' : ''}</p>`;
  switch (presentView) {
    case 'averages': {
      if (p.kind !== 'rating') return '';
      const hidden = p.hidden_items || [];
      const cards = [0, 1, 2].filter(i => !hidden.includes(i)).map(i => `
        <div class="avg-card"><b>${s.n ? s.perItem[i].toFixed(1) : '–'}</b>
          <span class="letter">${LETTERS[i]}</span> <span class="note">average of ${s.n} ratings</span>
          <p>${escapeHtml(short(p.items[i], 200))}</p></div>`).join('');
      return `<div class="avg-cards">${cards}</div>`;
    }
    case 'agreement':
    case 'revealed': {
      const blurred = presentView === 'agreement';
      return `<div class="agree">${agreement}
        <button type="button" class="glass ${blurred ? 'blurred' : ''}" aria-label="${blurred ? 'Hidden order. Click to reveal.' : 'Most popular order'}">
          <span class="glass-text" ${blurred ? 'aria-hidden="true"' : ''}>${escapeHtml(topText(s))}</span></button></div>${legend}`;
    }
    case 'top2': {
      const two = ORDERS.filter(k => s.counts[k] > 0).sort((a, b) => s.counts[b] - s.counts[a]).slice(0, 2);
      const rows = two.map((k, i) => `<li>${i + 1}. ${escapeHtml(orderLabel(k))}<span>${pct(s.counts[k] / s.n)}</span></li>`).join('');
      const cycles = p.kind === 'ranking' && s.cycles ? `<p class="note">No order (cycle): ${pct(s.cycles / s.n)}</p>` : '';
      return `<div class="agree">${agreement}<ol class="top-orders">${rows || '<li>–</li>'}</ol>${cycles}</div>${legend}`;
    }
    case 'all':
      return `<p class="verdict">Most popular: ${escapeHtml(topText(s))} · ${pct(s.topShare)} agree</p>${legend}${chart}`;
    default:
      return '';
  }
}

function updatePresentButtons(kind) {
  const show = { 'p-avg': kind === 'rating', 'p-agree': kind !== 'number',
    'p-reveal': kind === 'rating' && presentView === 'agreement', 'p-top2': kind === 'ranking',
    'p-show': presentView !== 'all', 'p-hide': presentView !== 'count' };
  for (const [id, visible] of Object.entries(show)) $(`#${id}`).hidden = !visible;
}

function setView(view) { presentView = view; if (latest) render(); }
$('#p-avg').onclick = () => setView('averages');
$('#p-agree').onclick = () => setView('agreement');
$('#p-reveal').onclick = () => setView('revealed');
$('#p-top2').onclick = () => setView('top2');
$('#p-show').onclick = () => setView('all');
$('#p-hide').onclick = () => setView('count');
// Clicking the blurred cover reveals: the order (rating) or the top two orders (ranking).
$('#p-chart').addEventListener('click', e => {
  if (presentMode === 'poll' && e.target.closest('.glass.blurred')) setView(latest.kind === 'rating' ? 'revealed' : 'top2');
});

// Rating polls: which items the averages view shows. Stored on the poll.
function showHiddenControls(p) {
  const box = $('#r-hidden-controls');
  box.hidden = p.kind !== 'rating';
  for (const cb of box.querySelectorAll('input')) cb.checked = !(p.hidden_items || []).includes(Number(cb.dataset.item));
}
$('#r-hidden-controls').addEventListener('change', async () => {
  const hidden = [...$('#r-hidden-controls').querySelectorAll('input')].filter(cb => !cb.checked).map(cb => Number(cb.dataset.item));
  await call('poll_set_hidden', { p_poll: selected, p_hidden: hidden });
  await refreshResults();
});

async function toggleOpen() {
  await call('poll_set_open', { p_poll: selected, p_open: !latest.is_open });
  await Promise.all([refreshResults(), loadList()]);
}
$('#r-toggle').onclick = toggleOpen;
$('#p-toggle').onclick = toggleOpen;
$('#r-close-view').onclick = closeView;
$('#r-answer').oninput = () => latest && render();
$('#r-mean').onchange = () => latest && render();

// ---- rating vs ranking comparison ---------------------------------------
const sameItems = (a, b) => JSON.stringify(a.items) === JSON.stringify(b.items);

function fillCompareSelects() {
  const ratings = polls.filter(p => p.kind === 'rating'), rankings = polls.filter(p => p.kind === 'ranking');
  const fill = (sel, list) => {
    const html = list.map(p => `<option value="${p.id}">${escapeHtml(short(p.question, 70))} (${p.responses})</option>`).join('');
    if (sel.dataset.html === html) return;  // unchanged: do not close an open dropdown
    const keep = sel.value;
    sel.innerHTML = html; sel.dataset.html = html;
    if (list.some(p => p.id === keep)) sel.value = keep;
  };
  const keptRanking = $('#cmp-ranking').value;
  fill($('#cmp-rating'), ratings);
  fill($('#cmp-ranking'), rankings);
  if (!rankings.some(p => p.id === keptRanking)) matchRanking();
  $('#cmp-show').disabled = !ratings.length || !rankings.length;
  $('#cmp-pick-note').textContent = ratings.length && rankings.length
    ? 'Each list shows the question and its number of answers, newest first.'
    : 'Create a rating poll and a ranking poll first (tick "Also create…" to make both at once).';
}

// Pick the newest ranking poll with the same items as the chosen rating poll.
function matchRanking() {
  const rating = polls.find(p => p.id === $('#cmp-rating').value);
  const match = rating && polls.find(p => p.kind === 'ranking' && sameItems(p, rating));
  if (match) $('#cmp-ranking').value = match.id;
}
$('#cmp-rating').onchange = matchRanking;

$('#cmp-show').onclick = async () => {
  closeView();
  comparing = { ratingId: $('#cmp-rating').value, rankingId: $('#cmp-ranking').value };
  $('#compare').hidden = false;
  await refreshCompare();
  $('#compare').scrollIntoView({ behavior: 'smooth' });
};
function closeCompare() { comparing = null; $('#compare').hidden = true; }
$('#cmp-close').onclick = closeCompare;

async function refreshCompare() {
  if (!comparing) return;
  const [rating, ranking] = await Promise.all([
    call('poll_results', { p_poll: comparing.ratingId }),
    call('poll_results', { p_poll: comparing.rankingId }),
  ]);
  if (!rating || !ranking) return closeCompare();
  const html = compareHtml(rating, ranking);
  $('#cmp-body').innerHTML = html;
  $('#cmp-note').textContent = [rating, ranking].some(p => p.is_open)
    ? 'A poll is still open; the numbers update as answers arrive.' : 'Both polls are closed.';
  if (presentMode === 'compare') $('#p-chart').innerHTML = html;
}

function compareHtml(rating, ranking) {
  const a = summarizeOrders('rating', rating.answers), b = summarizeOrders('ranking', ranking.answers);
  const same = a.top.length && b.top.length && a.top.join() === b.top.join();
  const overlap = a.top.filter(k => b.top.includes(k));
  let verdict;
  if (!a.n || !b.n) verdict = 'Waiting for answers in both polls.';
  else if (same) verdict = `Both polls agree: the most popular order is ${a.top.map(orderLabel).join(' / ')}.`;
  else if (overlap.length) verdict = `The polls share ${overlap.map(orderLabel).join(' / ')} among their most popular orders.`;
  else verdict = `The polls disagree: rating puts ${topText(a)} first, ranking puts ${topText(b)} first.`;

  const diff = a.n && b.n ? Math.round((b.topShare - a.topShare) * 100) : null;
  const row = (label, x, y) => `<tr><th>${label}</th><td>${x}</td><td>${y}</td></tr>`;
  const table = `<div class="table-wrap"><table>
    <thead><tr><th></th><th>Rating poll</th><th>Ranking poll</th></tr></thead>
    <tbody>
      ${row('Answers', a.n, b.n)}
      ${row('Most popular order', escapeHtml(topText(a)), escapeHtml(topText(b)))}
      ${row('Agree on it', pct(a.topShare), pct(b.topShare))}
      ${row('No order (cycle)', '— (ties not allowed)', b.n ? `${b.cycles} (${pct(b.cycles / b.n)})` : '0')}
    </tbody></table></div>`;
  const itemsNote = sameItems(rating, ranking) ? ''
    : '<p class="status error">These two polls do not have the same three items, so the letters do not mean the same thing.</p>';
  const chart = orderChartSvg([...ORDERS, CYCLE], [
    { name: 'Rating poll', cls: 'rating-bar', summary: a },
    { name: 'Ranking poll', cls: 'ranking-bar', summary: b },
  ], orderLabel);
  return `<p class="verdict">${escapeHtml(verdict)}${diff === null ? ''
      : ` Agreement: rating ${pct(a.topShare)}, ranking ${pct(b.topShare)} (${diff >= 0 ? '+' : ''}${diff} points for ranking).`}</p>
    ${itemsNote}<ul class="legend">${legendHtml(rating, null)}</ul>${table}${chart}`;
}

// ---- present mode -------------------------------------------------------
function studentLink() {
  const k = store.get('cp.studentKey');
  return k ? `${studentUrl}#k=${encodeURIComponent(k)}` : studentUrl;
}
function enterPresent(mode) {
  presentMode = mode;
  const compare = mode === 'compare';
  $('#present').classList.toggle('compare', compare);
  $('#p-join').hidden = compare;
  $('#p-toggle').hidden = compare;
  for (const id of ['p-avg', 'p-agree', 'p-reveal', 'p-top2', 'p-show', 'p-hide']) $(`#${id}`).hidden = compare;
  $('#p-count').hidden = compare;
  if (compare) {
    $('#p-question').textContent = 'Rating vs ranking';
    $('#p-chart').innerHTML = $('#cmp-body').innerHTML;
  } else {
    const qr = qrcode(0, 'M'); qr.addData(studentLink()); qr.make();
    $('#p-qr').innerHTML = qr.createSvgTag({ cellSize: 8, margin: 4, scalable: true });
    $('#p-url').textContent = studentUrl.replace(/^https?:\/\//, '');
    $('#p-key').textContent = store.get('cp.studentKey') || '';
    presentView = 'count'; render();
  }
  $('#present').hidden = false;
  document.documentElement.requestFullscreen?.().catch(() => {});
}
function exitPresent() {
  presentMode = null;
  $('#present').hidden = true;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
$('#r-present').onclick = () => enterPresent('poll');
$('#cmp-present').onclick = () => enterPresent('compare');
$('#p-exit').onclick = exitPresent;
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

// ---- mock run -------------------------------------------------------------
// Copies the real polls (questions, items, settings; no answers) into this
// browser and reloads the page in mock mode, where every call stays local.
$('#mock-start').onclick = async () => {
  const { resetMock } = await import('./mock.js');
  resetMock(polls.map(({ responses, ...p }) => p));
  location.href = 'admin.html?mock=1';
};
if (MOCK) {
  $('#mock-tools').hidden = false;
  $('#mock-start').hidden = true;
  $('#sign-out').hidden = true;
  document.title = 'Mock run · Class Poll';
  if (!adminKey) { adminKey = 'MOCK'; store.set('cp.admin', 'MOCK'); }
  store.set('cp.studentKey', 'MOCK');
  const mockStatus = t => setStatus($('#m-status'), t, 'ok');
  const sim = async n => {
    const { simulateAnswers } = await import('./mock.js');
    mockStatus(simulateAnswers(n));
    await Promise.all([loadList(), refreshResults(), refreshCompare()]);
  };
  $('#m-sim10').onclick = () => sim(10);
  $('#m-sim1').onclick = () => sim(1);
  $('#m-student').onclick = () => window.open('./?mock=1', '_blank');
  $('#m-reset').onclick = async () => {
    if (!confirm('Start over? All mock answers are cleared and all polls closed.')) return;
    const { resetMock, mockRpc } = await import('./mock.js');
    const current = await mockRpc('poll_list', {});
    resetMock(current.map(({ responses, ...p }) => p));
    closeView(); closeCompare(); await loadList();
    mockStatus('All mock answers cleared and all polls closed.');
  };
  $('#m-exit').onclick = () => { location.href = 'admin.html'; };
}

async function start() {
  await loadList();
  $('#login').hidden = true; $('#app').hidden = false; $('#admin-key').value = '';
  showStudentLink();
}

updateCreateForm();
if (adminKey) {
  start().catch(e => { if (!(e instanceof KeyError)) { $('#login').hidden = false; setStatus($('#login-status'), e.message, 'error'); } });
} else $('#login').hidden = false;

// Live refresh while signed in.
setInterval(() => {
  if (!adminKey || document.hidden) return;
  if (selected) refreshResults().catch(() => {});
  if (comparing) refreshCompare().catch(() => {});
  if ($('#present').hidden) loadList().catch(() => {});
}, 2000);
