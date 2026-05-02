import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const SOUNDS_DIR = path.join(__dirname, '..', 'sounds');

const SOUND_FILES: Record<string, string> = {
  ding:   'ding.wav',
  wrong:  'wrong.wav',
  theme:  'theme.wav',
  winner: 'winner.wav',
  strike: 'strike.wav',
  reveal: 'reveal.wav',
};

export function playSound(name: string): void {
  const filename = SOUND_FILES[name];
  if (!filename) return;

  const filepath = path.join(SOUNDS_DIR, filename);
  if (!fs.existsSync(filepath)) {
    console.warn(`Sound file missing: ${filepath}`);
    return;
  }

  // aplay works on Pi with ALSA; swap for mpg123/ffplay if using mp3
  const proc = spawn('aplay', [filepath], { detached: true, stdio: 'ignore' });
  proc.unref();
}
