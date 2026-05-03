let currentEditId = null;
let roundCounter = 0;
let answerCounters = {};

// ── Init ──────────────────────────────────────────────────────────────────────
loadSets();

async function loadSets() {
  try {
    const sets = await fetch('/api/sets').then(r => r.json());
    renderSetList(sets);
  } catch { toast('Failed to load question sets', true); }
}

function renderSetList(sets) {
  const container = document.getElementById('sets-container');
  if (!sets.length) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No question sets yet.</p>
        <p class="muted">Click <strong>+ NEW SET</strong> to create one, or import a JSON file.</p>
      </div>`;
    return;
  }

  container.innerHTML = sets.map(s => `
    <div class="set-card">
      <div class="set-card-header">
        <span class="set-title">${escHtml(s.title)}</span>
        <div class="set-actions">
          <button class="btn btn-dim btn-sm" onclick="editSet(${s.id})">✏ Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteSet(${s.id}, ${JSON.stringify(escHtml(s.title))})">🗑</button>
        </div>
      </div>
      <div class="set-meta">
        ${s.source ? `<span class="meta-tag">📋 ${escHtml(s.source)}</span>` : ''}
        ${s.date_collected ? `<span class="meta-tag">📅 ${escHtml(s.date_collected)}</span>` : ''}
        ${s.last_played_at ? `<span class="meta-tag">▶ Played ${s.play_count}x, last ${fmtDate(s.last_played_at)}</span>` : `<span class="meta-tag muted">Never played</span>`}
      </div>
      ${s.description ? `<p class="set-desc">${escHtml(s.description)}</p>` : ''}
    </div>`).join('');
}

// ── Editor ────────────────────────────────────────────────────────────────────
function newSet() {
  currentEditId = null;
  roundCounter = 0;
  answerCounters = {};
  document.getElementById('editor-heading').textContent = 'NEW QUESTION SET';
  document.getElementById('ed-title').value = '';
  document.getElementById('ed-desc').value = '';
  document.getElementById('ed-source').value = '';
  document.getElementById('ed-date').value = '';
  document.getElementById('rounds-container').innerHTML = '';
  document.getElementById('import-filename').textContent = 'No file chosen';
  showEditor();
  addRound();
}

async function editSet(id) {
  try {
    const set = await fetch(`/api/sets/${id}`).then(r => r.json());
    currentEditId = id;
    roundCounter = 0;
    answerCounters = {};
    document.getElementById('editor-heading').textContent = 'EDIT QUESTION SET';
    document.getElementById('ed-title').value = set.title;
    document.getElementById('ed-desc').value = set.description || '';
    document.getElementById('ed-source').value = set.source || '';
    document.getElementById('ed-date').value = set.date_collected || '';
    document.getElementById('rounds-container').innerHTML = '';
    document.getElementById('import-filename').textContent = 'No file chosen';
    set.rounds.forEach(r => addRound(r.question, r.answers));
    showEditor();
  } catch { toast('Failed to load set', true); }
}

function cancelEdit() {
  showList();
}

async function saveSet() {
  const title = document.getElementById('ed-title').value.trim();
  if (!title) { toast('Title is required', true); return; }

  const rounds = collectRounds();
  if (!rounds.length) { toast('Add at least one round', true); return; }

  const payload = {
    title,
    description: document.getElementById('ed-desc').value.trim(),
    source:      document.getElementById('ed-source').value.trim(),
    date_collected: document.getElementById('ed-date').value,
    rounds,
  };

  try {
    const url    = currentEditId ? `/api/sets/${currentEditId}` : '/api/sets';
    const method = currentEditId ? 'PUT' : 'POST';
    const res    = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(r => r.json());

    if (res.error) { toast('Error: ' + res.error, true); return; }
    toast(currentEditId ? 'Set updated!' : 'Set saved!');
    showList();
    loadSets();
  } catch { toast('Save failed', true); }
}

async function deleteSet(id, title) {
  if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
  try {
    await fetch(`/api/sets/${id}`, { method: 'DELETE' });
    toast('Set deleted');
    loadSets();
  } catch { toast('Delete failed', true); }
}

// ── Round / Answer building ───────────────────────────────────────────────────
function addRound(question = '', answers = []) {
  roundCounter++;
  const idx = roundCounter;
  answerCounters[idx] = 0;

  const div = document.createElement('div');
  div.className = 'round-editor';
  div.id = `re-${idx}`;
  div.innerHTML = `
    <div class="round-editor-header">
      <span class="round-editor-label">ROUND ${idx}</span>
      <input type="text" class="round-question" placeholder="Question text" value="${escAttr(question)}">
      <button class="btn btn-danger btn-xs" onclick="document.getElementById('re-${idx}').remove()">✕</button>
    </div>
    <div class="answers-editor" id="ae-${idx}"></div>
    <div class="round-footer">
      <button class="btn btn-dim btn-xs add-answer-btn" onclick="addAnswer(${idx})">+ Answer</button>
      <button class="btn btn-blue btn-xs" onclick="saveSet()">💾 Save Round</button>
    </div>`;

  document.getElementById('rounds-container').appendChild(div);

  if (answers.length) {
    answers.forEach(a => addAnswer(idx, a.text, a.points));
  } else {
    for (let i = 0; i < 5; i++) addAnswer(idx);
  }
}

function addAnswer(roundIdx, text = '', points = '') {
  answerCounters[roundIdx] = (answerCounters[roundIdx] || 0) + 1;
  const aIdx = answerCounters[roundIdx];
  const container = document.getElementById(`ae-${roundIdx}`);
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'answer-editor-row';
  row.id = `aer-${roundIdx}-${aIdx}`;
  row.innerHTML = `
    <span class="answer-editor-num">${aIdx}</span>
    <input type="text"   class="ans-text" placeholder="Answer text" value="${escAttr(text)}">
    <input type="number" class="ans-pts"  placeholder="Pts" min="1" max="999" value="${points}">
    <button class="btn btn-dim btn-xs" onclick="document.getElementById('aer-${roundIdx}-${aIdx}').remove()">✕</button>`;

  container.appendChild(row);
}

function collectRounds() {
  const rounds = [];
  document.querySelectorAll('.round-editor').forEach(rDiv => {
    const question = rDiv.querySelector('.round-question')?.value.trim();
    if (!question) return;

    const answers = [];
    rDiv.querySelectorAll('.answer-editor-row').forEach(row => {
      const text   = row.querySelector('.ans-text')?.value.trim();
      const points = parseInt(row.querySelector('.ans-pts')?.value || '0', 10);
      if (text && points > 0) answers.push({ text, points });
    });

    if (answers.length) rounds.push({ question, answers });
  });
  return rounds;
}

// ── JSON Import ───────────────────────────────────────────────────────────────
function importJson(input) {
  const file = input.files[0];
  if (!file) return;
  document.getElementById('import-filename').textContent = file.name;

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.rounds?.length) { toast('No rounds found in file', true); return; }

      if (!document.getElementById('ed-title').value.trim() && data.title) {
        document.getElementById('ed-title').value = data.title;
      }

      document.getElementById('rounds-container').innerHTML = '';
      roundCounter = 0;
      answerCounters = {};
      data.rounds.forEach(r => addRound(r.question, r.answers));
      toast(`Imported ${data.rounds.length} round(s) — fill in metadata and save`);
    } catch { toast('Invalid JSON file', true); }
  };
  reader.readAsText(file);
  input.value = '';
}

// ── View switching ────────────────────────────────────────────────────────────
function showEditor() {
  document.getElementById('view-list').classList.add('hidden');
  document.getElementById('view-editor').classList.remove('hidden');
  window.scrollTo(0, 0);
}

function showList() {
  document.getElementById('view-list').classList.remove('hidden');
  document.getElementById('view-editor').classList.add('hidden');
  window.scrollTo(0, 0);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(str) { return escHtml(str); }

function fmtDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return isNaN(d) ? isoStr : d.toLocaleDateString();
}

let toastTimer;
function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.background = isError ? '#b91c1c' : '#1f6feb';
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}
