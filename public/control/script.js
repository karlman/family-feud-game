// ── Socket ────────────────────────────────────────────────────────────────────
const socket = io();
let state = null;
let showingPicker = false;  // true until first state arrives or user forces picker

socket.on('connect',    () => setDot(true));
socket.on('disconnect', () => setDot(false));

socket.on('state:update', s => {
  state = s;
  if (!s.loaded) showingPicker = true;
  applyState(s);
});

socket.on('arduino:ringer', player => {
  toast(`🔔 Podium ${player} buzzed in!`);
});

function emit(event, data) { socket.emit(event, data); }

// ── View routing ──────────────────────────────────────────────────────────────
function applyState(s) {
  updateStatusStrip(s);

  const view = (!s.loaded || showingPicker) ? 'picker' : s.phase;
  showView(view);
  updateViewContent(s, view);
}

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  const el = document.getElementById('view-' + name);
  if (el) el.classList.remove('hidden');
}

function showPicker() {
  showingPicker = true;
  if (state) applyState(state);
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

  if (view === 'picker') {
    const t1 = document.getElementById('inp-t1');
    const t2 = document.getElementById('inp-t2');
    if (t1 && !t1.value) t1.value = s.team1.name !== 'Team 1' ? s.team1.name : '';
    if (t2 && !t2.value) t2.value = s.team2.name !== 'Team 2' ? s.team2.name : '';
  }

  if (view === 'idle') {
    setText('idle-round-badge', `ROUND ${s.currentRoundIndex + 1} OF ${s.rounds.length}`);
    setText('idle-question', round ? round.question : '');
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

    const isLastRound = s.currentRoundIndex >= s.rounds.length - 1;
    setText('btn-next-round', isLastRound ? 'END GAME ⏹' : 'NEXT ROUND ⏭');

    document.getElementById('roundover-scores').innerHTML = scoreHTML(s);
  }

  if (view === 'gameover') {
    document.getElementById('final-scores').innerHTML = scoreHTML(s);
    const t1 = s.team1.score, t2 = s.team2.score;
    const winner = t1 > t2 ? s.team1.name : t2 > t1 ? s.team2.name : null;
    setText('winner-label', winner ? `🏆 ${winner} wins!` : "🏆 It's a tie!");
  }
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

// ── Picker actions ────────────────────────────────────────────────────────────
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

document.getElementById('set-select').addEventListener('change', async function () {
  const setId = this.value;
  const roundSel = document.getElementById('round-select');
  if (!setId) {
    roundSel.innerHTML = '<option value="0">— select a set first —</option>';
    roundSel.disabled = true;
    return;
  }
  try {
    const data = await fetch(`/api/sets/${setId}`).then(r => r.json());
    if (!data.rounds.length) {
      roundSel.innerHTML = '<option value="0">No rounds in this set</option>';
      roundSel.disabled = true;
    } else {
      roundSel.disabled = false;
      roundSel.innerHTML = data.rounds.map((r, i) =>
        `<option value="${i}">Round ${i + 1}: ${escHtml(r.question.substring(0, 55))}</option>`
      ).join('');
    }
  } catch { toast('Failed to load set details', true); }
});

function loadSelectedSet() {
  const setId = parseInt(document.getElementById('set-select').value);
  const startRoundIndex = parseInt(document.getElementById('round-select').value) || 0;
  if (!setId) { toast('Choose a question set first', true); return; }
  emit('game:loadSet', { setId, startRoundIndex });
  showingPicker = false;
}

// ── Team names ────────────────────────────────────────────────────────────────
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
