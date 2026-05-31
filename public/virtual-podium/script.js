// ── LED matrix geometry (matches Arduino: 6 cols × 12 rows, serpentine) ──────
const COLS = 6;
const ROWS = 12;
const NUM_LEDS = COLS * ROWS;
const CELL   = 26;   // px between LED centres
const RADIUS = 9;    // LED radius in px
const PAD    = 13;   // canvas edge padding

const CANVAS_W = PAD * 2 + (COLS - 1) * CELL + RADIUS * 2;  // 186
const CANVAS_H = PAD * 2 + (ROWS - 1) * CELL + RADIUS * 2;  // 316

// ── Colors matching Arduino constants exactly ─────────────────────────────────
const CLR_OFF        = [0,   0,   0  ];
const CLR_ROYAL_BLUE = [10,  20,  180];
const CLR_WHITE      = [255, 255, 255];
const CLR_DIM_BLUE   = [5,   10,  90 ];
const CLR_RED        = [255, 0,   0  ];
const CLR_RED_DIM    = [102, 0,   0  ];  // thickening pixels on X

// ── Podium state objects ───────────────────────────────────────────────────────
const podiums = [0, 1].map(i => ({
  canvas:  null,
  ctx:     null,
  leds:    Array.from({ length: NUM_LEDS }, () => [...CLR_OFF]),
  mosfet:  0,       // 0-255
}));

// ── Game state (from state:update) ───────────────────────────────────────────
let serverStrikes      = 0;
let serverActivePlayer = 0;
let serverPhase        = 'pregame';

// ── Demo mode strike tracking (client-side only, game state not involved) ────
let inDemoMode       = false;
let demoStrikePlayer = 0;   // which podium is showing demo Xs
let demoStrikeCount  = 0;   // 0 = none, 1-3 = X count

// ── Animation state ───────────────────────────────────────────────────────────
let globalState     = 'clear';   // clear | reset | buzzin | active1 | active2 | win1 | win2 | strike
let buzzEnabled     = false;

// Buzzin pulse (mirrors Arduino timing)
let pulseBrightness = 30;
let pulseDelta      = 5;
let lastPulseMs     = 0;

// Win rainbow (mirrors Arduino timing)
let rainbowPhase  = 0;
let lastRainbowMs = 0;

// Loser bouncing lines (during WIN state)
const LOSER_SPEED    = 120;                // ms per row step
const LOSER_PRIMARY  = [0, 22, 55];       // dim teal-blue
const LOSER_TRAIL    = [0, 7, 18];        // fade trail
let lastLoserMs      = 0;
let loserLines       = [{ row: 0, dir: 1 }, { row: 6, dir: -1 }];

// Strike flash + hold-before-switch
let strikeActive      = false;
let strikeEndMs       = 0;
let strikeCount       = 0;   // count parsed from STRIKE:n
let strikeWhoWas      = 0;   // player who was active when the strike happened

// Track ACTIVE:n command sequence so we can detect a switch that happened
// just before the STRIKE command arrives (state:update timing can't be relied on).
let lastActiveCmd        = 0;   // last player number from an ACTIVE:n command
let switchedBeforeStrike = false;
let originalBeforeSwitch = 0;   // the player who was active before the switch

// After the flash, if a 3rd-strike steal occurred we hold so the audience sees
// who struck out (with 3 Xs) before switching to the steal team.
let strikeHoldActive  = false;
let strikeHoldEndMs   = 0;
let strikeHoldPlayer  = 0;   // original player shown during hold
let strikeHoldCount   = 0;   // strike count shown during hold

// ── Serpentine index (matches Arduino serpIdx) ─────────────────────────────────
function serpIdx(col, row) {
  return (row % 2 === 0)
    ? row * COLS + col
    : row * COLS + (COLS - 1 - col);
}

// ── Fill helpers ───────────────────────────────────────────────────────────────
function fillStrip(idx, color) {
  const leds = podiums[idx].leds;
  for (let i = 0; i < NUM_LEDS; i++) leds[i] = [...color];
}

function fillBoth(color) {
  fillStrip(0, color);
  fillStrip(1, color);
}

function setMosfet(idx, val) {
  podiums[idx].mosfet = val;
}

function setAllMosfets(val) {
  setMosfet(0, val);
  setMosfet(1, val);
}

// ── Strike flash X — bold pattern matching small persistent Xs ────────────────
// rows 0-2 & 9-11: ##..##  (cols 0,1,4,5)
// rows 3-4 & 7-8:  .####.  (cols 1,2,3,4)
// rows 5-6:        ..##..  (cols 2,3)
function drawStrikeX(idx) {
  const leds = podiums[idx].leds;
  for (let i = 0; i < NUM_LEDS; i++) leds[i] = [...CLR_OFF];

  for (let row = 0; row < ROWS; row++) {
    const cols = (row <= 2 || row >= 9) ? [0,1,4,5]
               : (row === 5 || row === 6) ? [2,3]
               : [1,2,3,4];
    for (const col of cols) leds[serpIdx(col, row)] = [...CLR_RED];
  }
}

// ── HSV → RGB (matches NeoPixel ColorHSV, hue 0-65535) ───────────────────────
function hsvToRgb(hue16) {
  hue16 = ((hue16 % 65536) + 65536) % 65536;
  const h = (hue16 / 65535) * 6;
  const sector = Math.floor(h);
  const f = h - sector;
  let r, g, b;
  switch (sector % 6) {
    case 0: r = 255; g = Math.round(f * 255);       b = 0;                      break;
    case 1: r = Math.round((1 - f) * 255); g = 255; b = 0;                      break;
    case 2: r = 0;   g = 255;              b = Math.round(f * 255);             break;
    case 3: r = 0;   g = Math.round((1 - f) * 255); b = 255;                   break;
    case 4: r = Math.round(f * 255);       g = 0;   b = 255;                   break;
    case 5: r = 255; g = 0;                b = Math.round((1 - f) * 255);      break;
    default: r = g = b = 0;
  }
  return [r, g, b];
}

// ── Command handler (mirrors Arduino processCommand) ──────────────────────────
function handleCommand(cmd) {
  if (cmd === 'CLEAR') {
    globalState          = 'clear';
    buzzEnabled          = false;
    lastActiveCmd        = 0;
    switchedBeforeStrike = false;
    demoStrikePlayer     = 0;
    demoStrikeCount      = 0;
    fillBoth(CLR_OFF);
    setAllMosfets(0);

  } else if (cmd === 'RESET') {
    globalState          = 'reset';
    buzzEnabled          = false;
    lastActiveCmd        = 0;
    switchedBeforeStrike = false;
    demoStrikePlayer     = 0;
    demoStrikeCount      = 0;
    fillBoth(CLR_ROYAL_BLUE);
    setAllMosfets(0);

  } else if (cmd === 'BUZZIN') {
    globalState          = 'buzzin';
    buzzEnabled          = true;
    pulseBrightness      = 30;
    pulseDelta           = 5;
    lastActiveCmd        = 0;
    switchedBeforeStrike = false;
    demoStrikePlayer     = 0;
    demoStrikeCount      = 0;
    setAllMosfets(0);

  } else if (cmd === 'ACTIVE:1') {
    switchedBeforeStrike = lastActiveCmd === 2;
    if (switchedBeforeStrike) originalBeforeSwitch = 2;
    lastActiveCmd = 1;
    globalState = 'active1';
    buzzEnabled = false;
    fillStrip(0, CLR_WHITE);
    fillStrip(1, CLR_DIM_BLUE);
    setMosfet(0, 255);
    setMosfet(1, 60);

  } else if (cmd === 'ACTIVE:2') {
    switchedBeforeStrike = lastActiveCmd === 1;
    if (switchedBeforeStrike) originalBeforeSwitch = 1;
    lastActiveCmd = 2;
    globalState = 'active2';
    buzzEnabled = false;
    fillStrip(0, CLR_DIM_BLUE);
    fillStrip(1, CLR_WHITE);
    setMosfet(0, 60);
    setMosfet(1, 255);

  } else if (cmd.startsWith('STRIKE:')) {
    if (strikeActive) return;
    strikeCount  = parseInt(cmd.slice(7)) || 0;
    strikeWhoWas = switchedBeforeStrike ? originalBeforeSwitch : lastActiveCmd;
    switchedBeforeStrike = false;
    strikeActive = true;
    strikeEndMs  = performance.now() + 700;
    globalState  = 'strike';
    buzzEnabled  = false;
    drawStrikeX(0);
    drawStrikeX(1);
    setAllMosfets(0);

  } else if (cmd === 'WIN:1') {
    globalState  = 'win1';
    buzzEnabled  = false;
    rainbowPhase = 0;
    loserLines   = [{ row: 0, dir: 1 }, { row: 6, dir: -1 }];
    fillStrip(1, CLR_OFF);
    setMosfet(0, 255);
    setMosfet(1, 0);

  } else if (cmd === 'WIN:2') {
    globalState  = 'win2';
    buzzEnabled  = false;
    rainbowPhase = 0;
    loserLines   = [{ row: 0, dir: 1 }, { row: 6, dir: -1 }];
    fillStrip(0, CLR_OFF);
    setMosfet(0, 0);
    setMosfet(1, 255);
  }

  updateBuzzButtons();
}

// ── Render a single LED on canvas ─────────────────────────────────────────────
function drawLED(ctx, x, y, r, g, b) {
  const brightness = (r + g + b) / (255 * 3);

  // Outer glow when lit
  if (brightness > 0.015) {
    const glowR = RADIUS * 2.8;
    const grad  = ctx.createRadialGradient(x, y, RADIUS * 0.3, x, y, glowR);
    grad.addColorStop(0, `rgba(${r},${g},${b},0.55)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, glowR, 0, Math.PI * 2);
    ctx.fill();
  }

  // LED body
  ctx.fillStyle = brightness > 0.015
    ? `rgb(${r},${g},${b})`
    : '#111';
  ctx.beginPath();
  ctx.arc(x, y, RADIUS, 0, Math.PI * 2);
  ctx.fill();

  // Specular highlight
  if (brightness > 0.015) {
    const spec = ctx.createRadialGradient(
      x - RADIUS * 0.32, y - RADIUS * 0.32, 0,
      x, y, RADIUS
    );
    spec.addColorStop(0, 'rgba(255,255,255,0.38)');
    spec.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = spec;
    ctx.beginPath();
    ctx.arc(x, y, RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Strike X overlay: red X marks stacked vertically, one per strike ──────────
// Each X is 3 rows tall with a 1-row gap. Pattern (6 cols):
//   row 0: X X . . X X   cols 0,1,4,5
//   row 1: . . X X . .   cols 2,3
//   row 2: X X . . X X   cols 0,1,4,5
//   row 3: (gap)
function buildStrikeOverlay(strikes) {
  const overlay  = new Map();
  const SECTION  = 4;
  const outerCols = [0, 1, 4, 5];
  const innerCols = [2, 3];

  for (let s = 0; s < strikes; s++) {
    const r = s * SECTION;
    for (const col of outerCols) {
      overlay.set(serpIdx(col, r + 0), CLR_RED);
      overlay.set(serpIdx(col, r + 2), CLR_RED);
    }
    for (const col of innerCols) {
      overlay.set(serpIdx(col, r + 1), CLR_RED);
    }
  }
  return overlay;
}

// ── Render the full LED matrix for one podium ─────────────────────────────────
function renderMatrix(idx) {
  const { ctx, leds } = podiums[idx];
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  // Priority: strike-hold > demo strikes > normal game strikes
  const playPhases    = ['faceoff', 'control', 'playing'];
  const overlayPlayer = strikeHoldActive ? strikeHoldPlayer
    : (inDemoMode && demoStrikePlayer !== 0) ? demoStrikePlayer
    : serverActivePlayer;
  const overlayCount  = strikeHoldActive ? strikeHoldCount
    : (inDemoMode && demoStrikePlayer !== 0) ? demoStrikeCount
    : serverStrikes;

  const showOverlay = !strikeActive
    && overlayCount > 0
    && (inDemoMode || playPhases.includes(serverPhase))
    && (idx + 1) === overlayPlayer;

  const overlay = showOverlay ? buildStrikeOverlay(overlayCount) : null;

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const si = serpIdx(col, row);
      const color = overlay ? (overlay.has(si) ? overlay.get(si) : CLR_OFF) : leds[si];
      const [r, g, b] = color;
      const x = PAD + RADIUS + col * CELL;
      const y = PAD + RADIUS + row * CELL;
      drawLED(ctx, x, y, r, g, b);
    }
  }
}

// ── Update light elements (TOP LIGHT, FRONT LIGHT, button backlight) ──────────
function updateLights(idx) {
  const t     = podiums[idx].mosfet / 255;  // 0.0 – 1.0
  const topEl   = document.getElementById(`top${idx + 1}`);
  const frontEl = document.getElementById(`front${idx + 1}`);
  const btnEl   = document.getElementById(`btn${idx + 1}`);

  if (t > 0.01) {
    const glowSize = Math.round(8 + t * 22);
    const alpha    = 0.3 + t * 0.7;

    topEl.style.background  = `rgba(255,255,255,${0.65 + t * 0.35})`;
    topEl.style.boxShadow   = `0 0 ${glowSize}px ${glowSize / 2}px rgba(255,255,255,${alpha}),`
                            + `0 0 ${glowSize * 2}px rgba(255,255,255,${alpha * 0.4})`;

    frontEl.style.borderColor = `rgba(255,255,255,${0.45 + t * 0.55})`;
    frontEl.style.boxShadow   = `0 0 ${glowSize * 1.5}px ${glowSize * 0.7}px rgba(255,255,255,${alpha * 0.55})`;

    if (!btnEl.classList.contains('enabled')) {
      btnEl.style.boxShadow = `0 0 ${glowSize}px rgba(255,255,255,${alpha * 0.6})`;
    }
  } else {
    topEl.style.background  = '#1e1e1e';
    topEl.style.boxShadow   = 'none';
    frontEl.style.borderColor = '#252525';
    frontEl.style.boxShadow   = 'none';
    if (!btnEl.classList.contains('enabled')) {
      btnEl.style.boxShadow = 'none';
    }
  }
}

// ── Cycle demo strike count on the held player's podium ───────────────────────
function cycleStrike(player, socket) {
  if (demoStrikePlayer !== player) {
    demoStrikeCount  = 1;
    demoStrikePlayer = player;
  } else {
    demoStrikeCount = (demoStrikeCount % 3) + 1;
  }
  socket.emit('demo:strike_cycle', player);
}

// ── Buzz button enabled state ─────────────────────────────────────────────────
function updateBuzzButtons() {
  [1, 2].forEach(n => {
    // In demo mode both buttons are always interactive (tap or hold)
    document.getElementById(`btn${n}`).classList.toggle('enabled', buzzEnabled || inDemoMode);
  });
}

// ── Main animation loop ───────────────────────────────────────────────────────
function tick(ms) {
  requestAnimationFrame(tick);

  // Buzzin pulsing blue (18 ms interval, mirrors Arduino)
  if (globalState === 'buzzin' && ms - lastPulseMs >= 18) {
    lastPulseMs      = ms;
    pulseBrightness += pulseDelta;
    if (pulseBrightness >= 210) { pulseBrightness = 210; pulseDelta = -5; }
    else if (pulseBrightness <= 25) { pulseBrightness = 25;  pulseDelta =  5; }
    const r = Math.round(10  * pulseBrightness / 210);
    const g = Math.round(20  * pulseBrightness / 210);
    const b = Math.round(180 * pulseBrightness / 210);
    fillBoth([r, g, b]);
  }

  // Win rainbow (28 ms interval, mirrors Arduino)
  if ((globalState === 'win1' || globalState === 'win2') && ms - lastRainbowMs >= 28) {
    lastRainbowMs = ms;
    rainbowPhase  = (rainbowPhase + 1) & 0xFF;

    const winIdx = globalState === 'win1' ? 0 : 1;
    for (let i = 0; i < NUM_LEDS; i++) {
      const hue = (rainbowPhase * 256 + Math.round(i * 65536 / NUM_LEDS)) & 0xFFFF;
      podiums[winIdx].leds[i] = hsvToRgb(hue);
    }
    // Mosfet pulse: alternates 255/140 every 32 animation steps
    setMosfet(winIdx, (rainbowPhase & 0x3F) < 32 ? 255 : 140);
  }

  // Loser bouncing lines
  if ((globalState === 'win1' || globalState === 'win2') && ms - lastLoserMs >= LOSER_SPEED) {
    lastLoserMs = ms;
    const loseIdx = globalState === 'win1' ? 1 : 0;

    fillStrip(loseIdx, CLR_OFF);

    for (const line of loserLines) {
      // Fade trail one row behind the direction of travel
      const trailRow = line.row - line.dir;
      if (trailRow >= 0 && trailRow < ROWS) {
        for (let col = 0; col < COLS; col++)
          podiums[loseIdx].leds[serpIdx(col, trailRow)] = [...LOSER_TRAIL];
      }

      // Advance line and bounce
      line.row += line.dir;
      if (line.row <= 0)        { line.row = 0;        line.dir =  1; }
      if (line.row >= ROWS - 1) { line.row = ROWS - 1; line.dir = -1; }

      // Draw primary line
      for (let col = 0; col < COLS; col++)
        podiums[loseIdx].leds[serpIdx(col, line.row)] = [...LOSER_PRIMARY];
    }
  }

  // Strike flash ends: hold before switching (3rd-strike steal only), else restore
  if (strikeActive && ms >= strikeEndMs) {
    strikeActive = false;
    const playPhases = ['faceoff', 'control', 'playing'];
    const playerSwitched = strikeWhoWas !== 0
      && serverActivePlayer !== 0
      && serverActivePlayer !== strikeWhoWas
      && playPhases.includes(serverPhase);

    if (playerSwitched && strikeCount === 3) {
      // 3rd-strike steal: show the losing player lit with 3 Xs for 2 s
      strikeHoldActive = true;
      strikeHoldEndMs  = ms + 2000;
      strikeHoldPlayer = strikeWhoWas;
      strikeHoldCount  = strikeCount;
      handleCommand(`ACTIVE:${strikeWhoWas}`);
    } else if (serverActivePlayer !== 0 && playPhases.includes(serverPhase)) {
      handleCommand(`ACTIVE:${serverActivePlayer}`);
    } else {
      fillBoth(CLR_ROYAL_BLUE);
      setAllMosfets(0);
      globalState = 'reset';
    }
  }

  // Hold ends: now light up the new active player
  if (strikeHoldActive && ms >= strikeHoldEndMs) {
    strikeHoldActive = false;
    strikeHoldPlayer = 0;
    strikeHoldCount  = 0;
    const playPhases = ['faceoff', 'control', 'playing'];
    if (serverActivePlayer !== 0 && playPhases.includes(serverPhase)) {
      handleCommand(`ACTIVE:${serverActivePlayer}`);
    } else {
      fillBoth(CLR_ROYAL_BLUE);
      setAllMosfets(0);
      globalState = 'reset';
    }
  }

  // Draw everything
  for (let i = 0; i < 2; i++) {
    renderMatrix(i);
    updateLights(i);
  }
}

// ── Startup ───────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  // Init canvases
  podiums.forEach((p, i) => {
    const canvas = document.getElementById(`matrix${i + 1}`);
    canvas.width  = CANVAS_W;
    canvas.height = CANVAS_H;
    p.canvas = canvas;
    p.ctx    = canvas.getContext('2d');
  });

  // Socket.IO
  const socket = io();
  const statusEl = document.getElementById('status');

  socket.on('connect',    () => { statusEl.textContent = 'Connected'; statusEl.style.color = '#2a4a2a'; });
  socket.on('disconnect', () => { statusEl.textContent = 'Disconnected'; statusEl.style.color = '#4a2a2a'; });

  socket.on('state:update', state => {
    serverStrikes      = state.strikes;
    serverActivePlayer = state.activePlayer;
    serverPhase        = state.phase;
  });

  socket.on('arduino:command', cmd => handleCommand(cmd));

  socket.on('demo:state', active => {
    inDemoMode = active;
    if (!active) { demoStrikePlayer = 0; demoStrikeCount = 0; }
    updateBuzzButtons();
  });

  socket.on('demo:strikes_reset', () => {
    demoStrikePlayer = 0;
    demoStrikeCount  = 0;
  });

  // Buzz buttons — short tap = buzz in, hold 600 ms = cycle demo strikes
  const HOLD_MS = 600;
  [1, 2].forEach(n => {
    const btn = document.getElementById(`btn${n}`);
    let holdTimer = null;
    let didHold   = false;

    function onDown(e) {
      e.preventDefault();
      didHold = false;
      btn.classList.add('pressing');
      holdTimer = setTimeout(() => {
        didHold = true;
        btn.classList.remove('pressing');
        cycleStrike(n, socket);
      }, HOLD_MS);
    }

    function onUp() {
      clearTimeout(holdTimer);
      holdTimer = null;
      btn.classList.remove('pressing');
      if (didHold) { didHold = false; return; }
      // Short tap
      if (inDemoMode) {
        demoStrikePlayer = 0;
        demoStrikeCount  = 0;
        socket.emit('arduino:sim_ringer', n);
      } else if (buzzEnabled) {
        buzzEnabled = false;
        updateBuzzButtons();
        socket.emit('arduino:sim_ringer', n);
      }
    }

    function onCancel() {
      clearTimeout(holdTimer);
      holdTimer = null;
      btn.classList.remove('pressing');
      didHold = false;
    }

    btn.addEventListener('mousedown',   onDown);
    btn.addEventListener('mouseup',     onUp);
    btn.addEventListener('mouseleave',  onCancel);
    btn.addEventListener('touchstart',  onDown,  { passive: false });
    btn.addEventListener('touchend',    onUp);
    btn.addEventListener('touchcancel', onCancel);
  });

  requestAnimationFrame(tick);
});
