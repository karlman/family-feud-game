import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import * as path from 'path';
import multer from 'multer';

import { GameManager } from './gameManager';
import { SerialManager } from './serialManager';
import { playSound } from './soundManager';
import * as db from './db';
import { GameFile, GameState, ClientToServerEvents, ServerToClientEvents } from './types';

const APP_VERSION = process.env.APP_VERSION || '2026.05.06-v7';
const APP_STARTED_AT = new Date().toISOString();

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
const upload = multer({ storage: multer.memoryStorage() });

// ─── Static files ────────────────────────────────────────────────────────────
const PUBLIC = path.join(__dirname, '..', 'public');
app.use('/gameboard',      express.static(path.join(PUBLIC, 'gameboard')));
app.use('/control',        express.static(path.join(PUBLIC, 'control')));
app.use('/settings',       express.static(path.join(PUBLIC, 'settings')));
app.use('/virtual-podium', express.static(path.join(PUBLIC, 'virtual-podium')));
app.use(express.json({ limit: '2mb' }));

// ─── Serial / Arduino ────────────────────────────────────────────────────────
const SERIAL_PORT = process.env.SERIAL_PORT || '/dev/ttyACM0';
const serial = new SerialManager();
serial.connect(SERIAL_PORT);

// ─── Arduino broadcast helper ────────────────────────────────────────────────
function sendArduino(command: string): void {
  serial.send(command);
  io.emit('arduino:command', command);
}

// ─── Game manager ────────────────────────────────────────────────────────────
const game = new GameManager((state: GameState) => {
  io.emit('state:update', state);
  syncArduino(state);
});

// Load persisted state if it exists (e.g., after power loss)
const persistedState = GameManager.loadPersistedState();
if (persistedState) {
  console.log(`Restoring game state from power loss (phase: ${persistedState.phase})`);
  game.restoreFromState(persistedState);
  // Emit the restored state to any connected clients
  setTimeout(() => io.emit('state:update', game.getState()), 100);
}

function syncArduino(state: GameState): void {
  switch (state.phase) {
    case 'pregame':
    case 'idle':
      sendArduino('RESET');
      break;
    case 'buzzin':
      sendArduino('BUZZIN');
      break;
    case 'faceoff':
    case 'control':
    case 'playing':
      sendArduino(`ACTIVE:${state.activePlayer}`);
      break;
    case 'roundover':
    case 'gameover':
      if (state.activePlayer > 0) sendArduino(`WIN:${state.activePlayer}`);
      break;
  }
}

// ─── Demo mode ───────────────────────────────────────────────────────────────
let demoMode = false;
let demoResetTimer: ReturnType<typeof setTimeout> | null = null;

function clearDemoTimer(): void {
  if (demoResetTimer) { clearTimeout(demoResetTimer); demoResetTimer = null; }
}

function demoBuzzed(player: 1 | 2): void {
  clearDemoTimer();
  sendArduino(`ACTIVE:${player}`);
  playSound('ding');
  io.emit('arduino:ringer', player);
  io.emit('demo:strikes_reset');
  demoResetTimer = setTimeout(() => { if (demoMode) sendArduino('BUZZIN'); }, 3000);
}

function handleRinger(player: 1 | 2): void {
  if (demoMode) { demoBuzzed(player); return; }
  game.setActivePlayer(player);
  io.emit('arduino:ringer', player);
  playSound('ding');
}

serial.on('ringer', handleRinger);

// ─── Socket.IO ───────────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log(`Client connected: ${socket.id}`);
  socket.emit('state:update', game.getState());

  socket.on('game:load',            data => game.loadGame(data));
  socket.on('game:loadSet',         ({ setId }) => {
    const set = db.getSet(setId);
    if (!set) return;
    db.recordPlay(setId);
    const gameFile: GameFile = {
      title: set.title,
      rounds: set.rounds.map(r => ({
        question: r.question,
        answers: r.answers.map(a => ({ text: a.text, points: a.points, revealed: false })),
      })),
    };
    game.loadGame(gameFile);
  });
  socket.on('game:setTeams',              ({ team1, team2 }) => game.setTeams(team1, team2));
  socket.on('game:startBuzzin',           () => { game.startBuzzin(); playSound('theme'); });
  socket.on('game:beginRound',            index => { game.beginRound(index); playSound('theme'); });
  socket.on('game:acknowledgeGameOver',   () => game.acknowledgeGameOver());
  socket.on('game:setActivePlayer',       player => game.setActivePlayer(player));
  socket.on('game:startPlay',             () => game.startPlay());
  socket.on('game:revealAnswer',          index => { game.revealAnswer(index); playSound('reveal'); });
  socket.on('game:revealRoundOverAnswer', () => { game.revealRoundOverAnswer(); playSound('reveal'); });
  socket.on('game:addStrike', () => {
    const prev        = game.getState();
    const prevPlayer  = prev.activePlayer;
    const prevStrikes = prev.strikes;
    const willSteal   = prevStrikes === 2
      && prev.phase === 'playing'
      && prevPlayer !== 0
      && !prev.stealChanceActive;

    game.addStrike();
    playSound('strike');
    sendArduino(`STRIKE:${Math.min(prevStrikes + 1, 3)}`);

    const playPhases = ['faceoff', 'control', 'playing'];
    if (willSteal) {
      // Hold original player lit for 2 s after flash, then switch to steal team
      setTimeout(() => { sendArduino(`ACTIVE:${prevPlayer}`); }, 800);
      setTimeout(() => {
        const s = game.getState();
        if (s.activePlayer !== 0) sendArduino(`ACTIVE:${s.activePlayer}`);
      }, 2800);
    } else {
      // Restore whoever is active now (handles faceoff switch + normal strikes)
      setTimeout(() => {
        const s = game.getState();
        if (s.activePlayer !== 0 && playPhases.includes(s.phase)) {
          sendArduino(`ACTIVE:${s.activePlayer}`);
        }
      }, 800);
    }
  });
  socket.on('game:undoStrike',            () => game.undoStrike());
  socket.on('game:swapActiveTeam',        () => game.swapActiveTeam());
  socket.on('game:awardPoints',           team => { game.awardPoints(team); playSound('winner'); });
  socket.on('game:nextRound',             () => game.nextRound());
  socket.on('game:resetRound',            () => game.resetRound());
  socket.on('game:resetGame',             () => game.resetGame());
  socket.on('game:playSound',             sound => playSound(sound));
  socket.on('board:reload',               () => io.emit('board:reload'));

  socket.on('arduino:sim_ringer', (player: 1 | 2) => handleRinger(player));

  socket.on('demo:start', () => {
    demoMode = true;
    clearDemoTimer();
    sendArduino('BUZZIN');
    playSound('theme');
    io.emit('demo:state', true);
  });

  socket.on('demo:stop', () => {
    demoMode = false;
    clearDemoTimer();
    sendArduino('RESET');
    io.emit('demo:state', false);
  });

  socket.on('demo:strike_cycle', (player: 1 | 2) => {
    if (!demoMode) return;
    clearDemoTimer();
    sendArduino(`ACTIVE:${player}`);
    playSound('strike');
  });

  socket.on('demo:action', (action) => {
    if (!demoMode) return;
    clearDemoTimer();
    switch (action) {
      case 'buzz1': demoBuzzed(1); break;
      case 'buzz2': demoBuzzed(2); break;
      case 'strike':
        sendArduino('STRIKE:3');
        playSound('strike');
        io.emit('demo:strikes_reset');
        demoResetTimer = setTimeout(() => { if (demoMode) sendArduino('BUZZIN'); }, 2500);
        break;
      case 'win1': sendArduino('WIN:1'); playSound('winner'); io.emit('demo:strikes_reset'); break;
      case 'win2': sendArduino('WIN:2'); playSound('winner'); io.emit('demo:strikes_reset'); break;
      case 'reset': sendArduino('BUZZIN'); io.emit('demo:strikes_reset'); break;
    }
  });

  socket.on('disconnect', () => console.log(`Client disconnected: ${socket.id}`));
});

// ─── REST: question sets ─────────────────────────────────────────────────────
app.get('/api/sets', (_req, res) => {
  res.json(db.listSets());
});

app.get('/api/sets/:id', (req, res) => {
  const set = db.getSet(Number(req.params.id));
  if (!set) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(set);
});

app.post('/api/sets', (req, res) => {
  const { title, description, source, date_collected, rounds } = req.body;
  if (!title || !Array.isArray(rounds)) {
    res.status(400).json({ error: 'title and rounds are required' }); return;
  }
  const id = db.createSet({ title, description, source, date_collected, rounds });
  res.json({ ok: true, id });
});

app.put('/api/sets/:id', (req, res) => {
  const { title, description, source, date_collected, rounds } = req.body;
  if (!title || !Array.isArray(rounds)) {
    res.status(400).json({ error: 'title and rounds are required' }); return;
  }
  const ok = db.updateSet(Number(req.params.id), { title, description, source, date_collected, rounds });
  if (!ok) { res.status(404).json({ error: 'Not found' }); return; }
  res.json({ ok: true });
});

app.delete('/api/sets/:id', (req, res) => {
  const ok = db.deleteSet(Number(req.params.id));
  if (!ok) { res.status(404).json({ error: 'Not found' }); return; }
  res.json({ ok: true });
});

// ─── REST: legacy file upload (still works, loads game directly) ──────────────
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No file' }); return; }
    const data: GameFile = JSON.parse(req.file.buffer.toString('utf8'));
    if (!data.rounds?.length) throw new Error('No rounds');
    game.loadGame(data);
    res.json({ ok: true, title: data.title, rounds: data.rounds.length });
  } catch (e) {
    res.status(400).json({ error: 'Invalid game file: ' + (e as Error).message });
  }
});

app.get('/api/state', (_req, res) => res.json(game.getState()));

app.get('/api/version', (_req, res) => {
  res.json({ version: APP_VERSION, startedAt: APP_STARTED_AT });
});

app.get('/', (_req, res) => res.redirect('/gameboard'));

// ─── Start ───────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`\nFamily Feud server running on port ${PORT}`);
  console.log(`  Game Board : http://localhost:${PORT}/gameboard`);
  console.log(`  Control UI : http://<pi-ip>:${PORT}/control`);
  console.log(`  Settings   : http://<pi-ip>:${PORT}/settings\n`);
});
