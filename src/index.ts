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

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
const upload = multer({ storage: multer.memoryStorage() });

// ─── Static files ────────────────────────────────────────────────────────────
const PUBLIC = path.join(__dirname, '..', 'public');
app.use('/gameboard', express.static(path.join(PUBLIC, 'gameboard')));
app.use('/control',   express.static(path.join(PUBLIC, 'control')));
app.use('/settings',  express.static(path.join(PUBLIC, 'settings')));
app.use(express.json({ limit: '2mb' }));

// ─── Serial / Arduino ────────────────────────────────────────────────────────
const SERIAL_PORT = process.env.SERIAL_PORT || '/dev/ttyACM0';
const serial = new SerialManager();
serial.connect(SERIAL_PORT);

// ─── Game manager ────────────────────────────────────────────────────────────
const game = new GameManager((state: GameState) => {
  io.emit('state:update', state);
  syncArduino(state);
});

function syncArduino(state: GameState): void {
  switch (state.phase) {
    case 'idle':
      serial.send('RESET');
      break;
    case 'buzzin':
      serial.send('BUZZIN');
      break;
    case 'playing':
      serial.send(`ACTIVE:${state.activePlayer}`);
      if (state.strikes > 0) serial.send(`STRIKE:${state.strikes}`);
      break;
    case 'roundover':
    case 'gameover':
      if (state.activePlayer > 0) serial.send(`WIN:${state.activePlayer}`);
      break;
  }
}

serial.on('ringer', (player: 1 | 2) => {
  game.setActivePlayer(player);
  io.emit('arduino:ringer', player);
  playSound('ding');
});

// ─── Socket.IO ───────────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log(`Client connected: ${socket.id}`);
  socket.emit('state:update', game.getState());

  socket.on('game:load',            data => game.loadGame(data));
  socket.on('game:loadSet',         ({ setId, startRoundIndex }) => {
    const set = db.getSet(setId);
    if (!set) return;
    db.recordPlay(setId);
    const gameFile: GameFile = {
      title: set.title,
      rounds: set.rounds.map(r => ({
        question: r.question,
        answers: r.answers.map(a => ({ text: a.text, points: a.points })),
      })),
    };
    game.loadGame(gameFile, startRoundIndex);
  });
  socket.on('game:setTeams',        ({ team1, team2 }) => game.setTeams(team1, team2));
  socket.on('game:startBuzzin',     () => { game.startBuzzin(); playSound('theme'); });
  socket.on('game:setActivePlayer', player => game.setActivePlayer(player));
  socket.on('game:revealAnswer',    index => { game.revealAnswer(index); playSound('reveal'); });
  socket.on('game:addStrike',       () => { game.addStrike(); playSound('wrong'); });
  socket.on('game:awardPoints',     team => { game.awardPoints(team); playSound('winner'); });
  socket.on('game:nextRound',       () => game.nextRound());
  socket.on('game:resetRound',      () => game.resetRound());
  socket.on('game:resetGame',       () => game.resetGame());
  socket.on('game:playSound',       sound => playSound(sound));

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

app.get('/', (_req, res) => res.redirect('/gameboard'));

// ─── Start ───────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`\nFamily Feud server running on port ${PORT}`);
  console.log(`  Game Board : http://localhost:${PORT}/gameboard`);
  console.log(`  Control UI : http://<pi-ip>:${PORT}/control`);
  console.log(`  Settings   : http://<pi-ip>:${PORT}/settings\n`);
});
