const socket = io();

function scaleBoard() {
  const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  document.getElementById('app').style.transform = `scale(${scale})`;
}
window.addEventListener('resize', scaleBoard);
scaleBoard();

let renderedRoundIndex = -1;
let renderedAnswerCount = 0;
let renderedStrikes = -1;   // -1 = not yet received first state
let renderedIdleBoard = false;

socket.on('connect',       () => console.log('Board connected'));
socket.on('disconnect',    () => console.log('Board disconnected'));
socket.on('state:update',  renderState);

loadVersionBadge('gameboard');

// ── Main render ──────────────────────────────────────────────────────────────
function renderState(state) {
  document.body.className = 'phase-' + state.phase;

  // Teams
  setText('team1-name',  state.team1.name);
  setText('team2-name',  state.team2.name);
  setText('team1-score', state.team1.score);
  setText('team2-score', state.team2.score);

  setClass('team1-panel', 'active', state.activePlayer === 1);
  setClass('team2-panel', 'active', state.activePlayer === 2);

  // Strikes
  for (let i = 1; i <= 3; i++) {
    setClass('s' + i, 'active', state.strikes >= i);
  }
  if (renderedStrikes !== -1 && state.strikes > renderedStrikes) flashStrikes(state.strikes);
  renderedStrikes = state.strikes;

  // Question — hidden until buzz-in is called
  const round = state.rounds[state.currentRoundIndex];
  const showQuestion = state.phase !== 'idle' && state.phase !== 'buzzin';
  setText('question-text', showQuestion && round ? round.question.toUpperCase() : 'SURVEY SAYS…');

  // Round points
  setText('points-value', state.roundPoints);

  // Answer grid — rebuild if round changed or answer count changed
  const isIdle = state.phase === 'idle';
  const answers = isIdle
    ? Array.from({ length: 6 }, () => ({ text: '', points: 0, revealed: false }))
    : (round ? round.answers : []);
  const changed = state.currentRoundIndex !== renderedRoundIndex
               || answers.length !== renderedAnswerCount
               || renderedIdleBoard !== isIdle;

  if (changed) {
    buildGrid(answers);
    renderedRoundIndex  = state.currentRoundIndex;
    renderedAnswerCount = answers.length;
    renderedStrikes     = 0;
    renderedIdleBoard   = isIdle;
  } else {
    updateTiles(answers);
  }
}

// ── Build grid from scratch ──────────────────────────────────────────────────
function buildGrid(answers) {
  const grid = document.getElementById('answers-grid');
  grid.innerHTML = '';
  const single = answers.length <= 4;
  grid.className = single ? 'single-col' : '';
  const cols = single ? 1 : 2;
  const rows = Math.ceil(answers.length / cols);
  grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

  answers.forEach((answer, i) => {
    grid.appendChild(makeTile(i, answer));
  });
}

function makeTile(i, answer) {
  const dashCount = Math.min(7, Math.max(3, Math.round(answer.text.length / 2.5)));
  const dashes = Array(dashCount).fill('<div class="dash"></div>').join('');

  const tile = document.createElement('div');
  tile.className = 'answer-tile' + (answer.revealed ? ' revealed' : '');
  tile.id = 'tile-' + i;

  tile.innerHTML = `
    <div class="tile-inner">
      <div class="tile-front">
        <div class="tile-num">${i + 1}</div>
        <div class="tile-dashes">${dashes}</div>
      </div>
      <div class="tile-back">
        <div class="tile-num">${i + 1}</div>
        <div class="tile-text">${escHtml(answer.text)}</div>
        <div class="tile-pts">${answer.points}</div>
      </div>
    </div>`;

  return tile;
}

// ── Update existing tiles (only flip state changes) ──────────────────────────
function updateTiles(answers) {
  answers.forEach((answer, i) => {
    const tile = document.getElementById('tile-' + i);
    if (!tile) return;
    const isRevealed = tile.classList.contains('revealed');
    if (answer.revealed && !isRevealed) tile.classList.add('revealed');
    if (!answer.revealed && isRevealed) tile.classList.remove('revealed');
  });
}

// ── Strike flash overlay ──────────────────────────────────────────────────────
let strikeFlashTimer = null;

function flashStrikes(count) {
  const overlay = document.getElementById('strike-overlay');
  overlay.innerHTML = Array(count).fill('<span class="x-mark">X</span>').join('');
  overlay.classList.remove('flash');
  void overlay.offsetWidth; // force reflow to restart animation
  overlay.classList.add('flash');
  clearTimeout(strikeFlashTimer);
  strikeFlashTimer = setTimeout(() => overlay.classList.remove('flash'), 1700);
}

// ── Utilities ────────────────────────────────────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id);
  if (el && el.textContent !== String(val)) el.textContent = val;
}

function setClass(id, cls, on) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle(cls, on);
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function loadVersionBadge(pageName) {
  const el = document.getElementById('app-version');
  if (!el) return;
  try {
    const data = await fetch('/api/version').then(r => r.json());
    const started = new Date(data.startedAt);
    const startedText = Number.isNaN(started.getTime()) ? 'unknown start' : started.toLocaleTimeString();
    el.textContent = `${pageName} • v${data.version} • ${startedText}`;
  } catch {
    el.textContent = `${pageName} • version unavailable`;
  }
}
