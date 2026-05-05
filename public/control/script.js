// ── Socket ────────────────────────────────────────────────────────────────────
const socket = io();
let state = null;
let selectedRoundIndex = 0;

socket.on('connect',    () => setDot(true));
socket.on('disconnect', () => setDot(false));

socket.on('state:update', s => {
  state = s;
  applyState(s);
});

socket.on('arduino:ringer', player => {
  toast(`🔔 Podium ${player} buzzed in!`);
});

function emit(event, data) { socket.emit(event, data); }

// ── View routing ──────────────────────────────────────────────────────────────
function applyState(s) {
  updateStatusStrip(s);
  const view = s.phase === 'pregame' ? 'pregame' : s.phase;
  showView(view);
  updateViewContent(s, view);
}

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  const el = document.getElementById('view-' + name);
  if (el) el.classList.remove('hidden');
}

function showPregame() {
  if (state) { showView('pregame'); updateViewContent(state, 'pregame'); }
}

// ── Status strip ──────────────────────────────────────────────────────────────
function updateStatusStrip(s) {
  setText('stat-round', s.loaded ? `${s.currentRoundIndex + 1}/${s.rounds.length}` : '—');
  setText('stat-strikes', s.strikes);
  setText('stat-t1-name', s.team1.name);
  setText('stat-t2-name', s.team2.name);
  setText('stat-t1-score', s.team1.score);
  setText('stat-t2-score', s.team2.score);

  const strikeEl = document.getElementById('stat-strikes');
  if (strikeEl) strikeEl.className = 'stat-val strikes-val' + (s.strikes > 0 ? ' has-strikes' : '');
}

// ── View content ──────────────────────────────────────────────────────────────
function updateViewContent(s, view) {
  const round = s.rounds[s.currentRoundIndex];

  if (view === 'pregame') {
    const t1 = document.getElementById('inp-t1');
    const t2 = document.getElementById('inp-t2');
    if (t1 && !t1.value) t1.value = s.team1.name !== 'Team 1' ? s.team1.name : '';
    if (t2 && !t2.value) t2.value = s.team2.name !== 'Team 2' ? s.team2.name : '';
  }

  if (view === 'idle') {
    const usedCount = s.usedRoundIndices.length;
    const totalCount = s.rounds.length;
    setText('idle-round-badge',
      usedCount === 0 ? 'SELECT A ROUND' : `${usedCount} OF ${totalCount} ROUNDS PLAYED`);
    renderRoundList(s);
  }

  if (view === 'buzzin') {
    setText('buzzin-question', round ? round.question : '');
    setText('buzz-t1-name', s.team1.name);
    setText('buzz-t2-name', s.team2.name);
  }

  if (view === 'playing') {
    setText('play-round-badge', `R${s.currentRoundIndex + 1}`);
    setText('play-active-label', s.activePlayer > 0
      ? (s.activePlayer === 1 ? s.team1.name : s.team2.name) + ' answering'
      : 'Answering');
    setText('play-question', round ? round.question : '');
    renderStrikes(s.strikes);
    renderAnswerList(round ? round.answers : []);
  }

  if (view === 'roundover') {
    const hasPoints = s.roundPoints > 0;
    setText('award-pts', s.roundPoints);
    setText('award-btn-1', `→ ${s.team1.name}`);
    setText('award-btn-2', `→ ${s.team2.name}`);
    const awardSection = document.getElementById('award-section');
    if (awardSection) awardSection.style.display = hasPoints ? '' : 'none';

    const allUsed = s.usedRoundIndices.length >= s.rounds.length;
    setText('btn-next-round', allUsed ? 'END GAME ⏹' : 'NEXT ROUND ⏭');

    document.getElementById('roundover-scores').innerHTML = scoreHTML(s);
  }

  if (view === 'gameover') {
    document.getElementById('final-scores').innerHTML = scoreHTML(s);
    const t1 = s.team1.score, t2 = s.team2.score;
    const winner = t1 > t2 ? s.team1.name : t2 > t1 ? s.team2.name : null;
    setText('winner-label', winner ? `🏆 ${winner} wins!` : "🏆 It's a tie!");
  }
}

// ── Round dropdown (idle view) ────────────────────────────────────────────────
function renderRoundList(s) {
  const sel = document.getElementById('round-select');
  if (!sel) return;

  // default to first unused round if current selection is used
  const unused = s.rounds.map((_, i) => i).filter(i => !s.usedRoundIndices.includes(i));
  if (unused.length > 0 && s.usedRoundIndices.includes(selectedRoundIndex)) {
    selectedRoundIndex = unused[0];
  }

  sel.innerHTML = s.rounds.map((r, i) => {
    const used = s.usedRoundIndices.includes(i);
    const label = `${i + 1}. ${r.question.substring(0, 60)}${r.question.length > 60 ? '…' : ''}${used ? ' ✓' : ''}`;
    return `<option value="${i}" ${i === selectedRoundIndex ? 'selected' : ''}>${escHtml(label)}</option>`;
  }).join('');
}

function beginRound() {
  const sel = document.getElementById('round-select');
  selectedRoundIndex = parseInt(sel.value);
  emit('game:beginRound', selectedRoundIndex);
}

// ── Answers ───────────────────────────────────────────────────────────────────
function renderAnswerList(answers) {
  const list = document.getElementById('answer-list');
  if (!answers.length) { list.innerHTML = ''; return; }

  list.innerHTML = answers.map((a, i) => `
    <div class="answer-row ${a.revealed ? 'revealed' : ''}">
      <div class="answer-num">${i + 1}</div>
      <div class="answer-text">${escHtml(a.text)}</div>
      <div class="answer-pts">${a.points}</div>
      ${a.revealed
        ? '<span class="revealed-check">✓</span>'
        : `<button class="btn btn-blue reveal-btn" onclick="emit('game:revealAnswer', ${i})">REVEAL</button>`
      }
    </div>`).join('');
}

function renderStrikes(count) {
  const el = document.getElementById('play-strikes');
  if (!el) return;
  el.textContent = count > 0 ? '✗'.repeat(count) : '';
  el.className = 'strike-display' + (count >= 3 ? ' max-strikes' : '');
}

function scoreHTML(s) {
  return `
    <div class="score-row">
      <span class="score-name">${escHtml(s.team1.name)}</span>
      <span class="score-pts">${s.team1.score}</span>
    </div>
    <div class="score-row">
      <span class="score-name">${escHtml(s.team2.name)}</span>
      <span class="score-pts">${s.team2.score}</span>
    </div>`;
}

// ── Pregame actions ───────────────────────────────────────────────────────────
async function loadSets() {
  try {
    const sets = await fetch('/api/sets').then(r => r.json());
    const sel = document.getElementById('set-select');
    if (!sets.length) {
      sel.innerHTML = '<option value="">— No sets saved. Go to Settings. —</option>';
    } else {
      sel.innerHTML = '<option value="">— Choose a question set —</option>'
        + sets.map(s => `<option value="${s.id}">${escHtml(s.title)}${s.source ? ' (' + escHtml(s.source) + ')' : ''}</option>`).join('');
    }
  } catch { /* server may not be ready yet */ }
}

function startGame() {
  const setId = parseInt(document.getElementById('set-select').value);
  if (!setId) { toast('Choose a question set first', true); return; }
  const t1 = document.getElementById('inp-t1').value.trim() || 'Team 1';
  const t2 = document.getElementById('inp-t2').value.trim() || 'Team 2';
  emit('game:setTeams', { team1: t1, team2: t2 });
  selectedRoundIndex = 0;
  emit('game:loadSet', { setId });
}

// ── Team names ────────────────────────────────────────────────────────────────
function setTeams() {
  const t1 = document.getElementById('inp-t1').value.trim() || 'Team 1';
  const t2 = document.getElementById('inp-t2').value.trim() || 'Team 2';
  emit('game:setTeams', { team1: t1, team2: t2 });
  toast('Team names saved');
}

function confirmReset() {
  if (confirm('Reset scores? The loaded question set will be kept.')) {
    emit('game:resetGame');
    toast('Scores reset');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(val);
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

// ── Init ──────────────────────────────────────────────────────────────────────
loadSets();
