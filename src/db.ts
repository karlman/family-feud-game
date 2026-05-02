import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'feud.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS question_sets (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT    NOT NULL,
    description    TEXT    NOT NULL DEFAULT '',
    source         TEXT    NOT NULL DEFAULT '',
    date_collected TEXT    NOT NULL DEFAULT '',
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    last_played_at TEXT,
    play_count     INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS rounds (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    set_id     INTEGER NOT NULL REFERENCES question_sets(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL,
    question   TEXT    NOT NULL
  );
  CREATE TABLE IF NOT EXISTS answers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id   INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL,
    text       TEXT    NOT NULL,
    points     INTEGER NOT NULL
  );
`);

export interface SetMeta {
  id: number;
  title: string;
  description: string;
  source: string;
  date_collected: string;
  created_at: string;
  last_played_at: string | null;
  play_count: number;
}

export interface RoundData {
  id: number;
  sort_order: number;
  question: string;
  answers: { id: number; sort_order: number; text: string; points: number }[];
}

export interface SetFull extends SetMeta {
  rounds: RoundData[];
}

export interface SetInput {
  title: string;
  description?: string;
  source?: string;
  date_collected?: string;
  rounds: { question: string; answers: { text: string; points: number }[] }[];
}

export function listSets(): SetMeta[] {
  return db.prepare(
    'SELECT * FROM question_sets ORDER BY title COLLATE NOCASE'
  ).all() as SetMeta[];
}

export function getSet(id: number): SetFull | null {
  const meta = db.prepare('SELECT * FROM question_sets WHERE id = ?').get(id) as SetMeta | undefined;
  if (!meta) return null;
  const rows = db.prepare('SELECT * FROM rounds WHERE set_id = ? ORDER BY sort_order').all(id) as any[];
  for (const r of rows) {
    r.answers = db.prepare('SELECT * FROM answers WHERE round_id = ? ORDER BY sort_order').all(r.id);
  }
  return { ...meta, rounds: rows };
}

export function createSet(data: SetInput): number {
  return db.transaction(() => {
    const { lastInsertRowid } = db.prepare(
      `INSERT INTO question_sets (title, description, source, date_collected) VALUES (?, ?, ?, ?)`
    ).run(data.title, data.description ?? '', data.source ?? '', data.date_collected ?? '');
    const setId = Number(lastInsertRowid);
    insertRounds(setId, data.rounds);
    return setId;
  })() as number;
}

export function updateSet(id: number, data: SetInput): boolean {
  return db.transaction(() => {
    const { changes } = db.prepare(
      `UPDATE question_sets SET title=?, description=?, source=?, date_collected=? WHERE id=?`
    ).run(data.title, data.description ?? '', data.source ?? '', data.date_collected ?? '', id);
    if (changes === 0) return false;
    db.prepare('DELETE FROM rounds WHERE set_id = ?').run(id);
    insertRounds(id, data.rounds);
    return true;
  })() as boolean;
}

export function deleteSet(id: number): boolean {
  return db.prepare('DELETE FROM question_sets WHERE id = ?').run(id).changes > 0;
}

export function recordPlay(id: number): void {
  db.prepare(
    `UPDATE question_sets SET last_played_at = datetime('now'), play_count = play_count + 1 WHERE id = ?`
  ).run(id);
}

function insertRounds(setId: number, rounds: SetInput['rounds']): void {
  const insRound  = db.prepare('INSERT INTO rounds (set_id, sort_order, question) VALUES (?, ?, ?)');
  const insAnswer = db.prepare('INSERT INTO answers (round_id, sort_order, text, points) VALUES (?, ?, ?, ?)');
  rounds.forEach((r, ri) => {
    const { lastInsertRowid } = insRound.run(setId, ri, r.question);
    r.answers.forEach((a, ai) => insAnswer.run(Number(lastInsertRowid), ai, a.text, a.points));
  });
}
