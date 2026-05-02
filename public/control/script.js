// ── Socket ────────────────────────────────────────────────────────────────────
const socket = io();
let state = null;

socket.on('connect',    () => setDot(true));
socket.on('disconnect', () => setDot(false));

socket.on('state:update', s => {
  state = s;
  applyState(s);
});

socket.on('arduino:ringer', player => {
  toast(`🔔 Podium ${player} buzzed in!`);
  document.getElementById('card-play').classList.add('ringer-flash');
  setTimeout(() => document.getElementById('card-play').classList.remove('ringer-flash'), 900);
});

function emit(event, data) {
  socket.emit(event, data);
}

// ── State rendering ───────────────────────────────────────────────────────────
function applyState(s) {
  // Status strip
  const roundLabel = s.loaded
    ? `${s.currentRoundIndex + 1} / ${s.rounds.length}`
    : '—';
  setText('stat-round',   roundLabel);
  setText('stat-phase',   s.phase);
  setText('stat-active',  s.activePlayer === 0 ? '—' : `P${s.activePlayer}`);
  setText('stat-strikes', s.strikes);
  setText('stat-points',  s.roundPoints);

  // Award points labels
  setText('award-pts', s.roundPoints);
  setText('award-t1',  s.team1.name);
  setText('award-t2',  s.team2.name);
  setText('p1-name-btn', s.team1.name ? `(${s.team1.name})` : '');
  setText('p2-name-btn', s.team2.name ? `(${s.team2.name})` : '');

  // Active player highlight
  toggle('btn-p1', 'active', s.activePlayer === 1);
  toggle('btn-p2', 'active', s.activePlayer === 2);

  // Prefill team inputs if empty
  const t1 = document.getElementById('inp-t1');
  const t2 = document.getElementById('inp-t2');
  if (!t1.value) t1.value = s.team1.name !== 'Team 1' ? s.team1.name : '';
  if (!t2.value) t2.value = s.team2.name !== 'Team 2' ? s.team2.name : '';

  // Answers
  const round = s.rounds[s.currentRoundIndex];
  const answerRoundLbl = document.getElementById('answer-round-lbl');
  if (answerRoundLbl) answerRoundLbl.textContent = round ? `— Round ${s.currentRoundIndex + 1}` : '';
  renderAnswerList(round ? round.answers : null);
}

function renderAnswerList(answers) {
  const list = document.getElementById('answer-list');
  if (!answers) {
    list.innerHTML = '<p class="muted">Load a game to see answers.</p>';
    return;
  }

  list.innerHTML = answers.map((a, i) => `
    <div class="answer-row ${a.revealed ? 'revealed' : ''}" id="arow-${i}">
      <div class="answer-num">${i + 1}</div>
      <div class="answer-text">${escHtml(a.text)}</div>
      <div class="answer-pts">${a.points}</div>
      ${a.revealed
        ? '<span class="muted" style="font-size:18px">✓</span>'
        : `<button class="btn btn-blue reveal-btn" onclick="emit('game:revealAnswer', ${i})">REVEAL</button>`
      }
    </div>`).join('');
}

// ── Actions ───────────────────────────────────────────────────────────────────
function setTeams() {
  const t1 = document.getElementById('inp-t1').value.trim() || 'Team 1';
  const t2 = document.getElementById('inp-t2').value.trim() || 'Team 2';
  emit('game:setTeams', { team1: t1, team2: t2 });
  toast('Team names saved');
}

function confirmReset() {
  if (confirm('Reset the entire game? Scores will be cleared.')) {
    emit('game:resetGame');
    toast('Game reset');
  }
}

// ── File upload ───────────────────────────────────────────────────────────────
function uploadFile(input) {
  const file = input.files[0];
  if (!file) return;
  document.getElementById('file-name').textContent = file.name;

  const fd = new FormData();
  fd.append('file', file);

  fetch('/api/upload', { method: 'POST', body: fd })
    .then(r => r.json())
    .then(data => {
      if (data.error) { toast('Error: ' + data.error, true); return; }
      toast(`Loaded "${data.title}" — ${data.rounds} rounds`);
    })
    .catch(() => toast('Upload failed', true));

  input.value = '';
}

// ── Manual entry ──────────────────────────────────────────────────────────────
let manualRoundCount = 0;

function addRound() {
  manualRoundCount++;
  const idx = manualRoundCount;
  const container = document.getElementById('manual-rounds');

  const div = document.createElement('div');
  div.className = 'manual-round';
  div.id = `mround-${idx}`;
  div.innerHTML = `
    <div class="manual-round-header">
      <strong style="color:var(--gold);font-size:13px">ROUND ${idx}</strong>
      <input type="text" placeholder="Question text" id="mq-${idx}" style="flex:1">
      <button class="btn btn-danger" style="padding:6px 10px;font-size:12px"
        onclick="document.getElementById('mround-${idx}').remove()">✕</button>
    </div>
    <div class="manual-answers" id="mans-${idx}"></div>
    <button class="btn btn-dim" style="font-size:12px;padding:7px 12px"
      onclick="addAnswer(${idx})">+ Answer</button>`;

  container.appendChild(div);
  // Pre-add 5 answer rows
  for (let i = 0; i < 5; i++) addAnswer(idx);
}

let answerCounters = {};
function addAnswer(roundIdx) {
  answerCounters[roundIdx] = (answerCounters[roundIdx] || 0) + 1;
  const aIdx = answerCounters[roundIdx];
  const container = document.getElementById(`mans-${roundIdx}`);
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'answer-input-row';
  row.id = `mans-${roundIdx}-${aIdx}`;
  row.innerHTML = `
    <span style="color:var(--muted);font-size:14px;width:20px;text-align:right">${aIdx}</span>
    <input type="text"   placeholder="Answer text" id="mat-${roundIdx}-${aIdx}">
    <input type="number" placeholder="Pts" min="1" max="999" id="map-${roundIdx}-${aIdx}">
    <button class="btn btn-dim" style="padding:6px 8px;font-size:11px"
      onclick="document.getElementById('mans-${roundIdx}-${aIdx}').remove()">✕</button>`;

  container.appendChild(row);
}

function loadManual() {
  const title = document.getElementById('inp-title').value.trim() || 'Family Feud';
  const rounds = [];

  document.querySelectorAll('.manual-round').forEach(rDiv => {
    const id = rDiv.id.replace('mround-', '');
    const question = document.getElementById(`mq-${id}`)?.value.trim();
    if (!question) return;

    const answers = [];
    rDiv.querySelectorAll('.answer-input-row').forEach(aRow => {
      const aId = aRow.id.replace(`mans-${id}-`, '');
      const text   = document.getElementById(`mat-${id}-${aId}`)?.value.trim();
      const points = parseInt(document.getElementById(`map-${id}-${aId}`)?.value || '0', 10);
      if (text && points > 0) answers.push({ text, points });
    });

    if (answers.length) rounds.push({ question, answers });
  });

  if (!rounds.length) { toast('Add at least one round with answers', true); return; }
  emit('game:load', { title, rounds });
  toast(`Loaded "${title}" — ${rounds.length} rounds`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(val);
}

function toggle(id, cls, on) {
  document.getElementById(id)?.classList.toggle(cls, on);
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function setDot(online) {
  const dot = document.getElementById('status-dot');
  dot.className = online ? 'online' : 'offline';
  dot.title = online ? 'Connected' : 'Disconnected';
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
