import { GameState, GameFile, Round, ActivePlayer } from './types';

const defaultState = (): GameState => ({
  gameTitle: 'Family Feud',
  rounds: [],
  currentRoundIndex: 0,
  team1: { name: 'Team 1', score: 0 },
  team2: { name: 'Team 2', score: 0 },
  strikes: 0,
  activePlayer: 0,
  phase: 'idle',
  roundPoints: 0,
  loaded: false,
});

export class GameManager {
  private state: GameState = defaultState();
  private onChange: (state: GameState) => void;

  constructor(onChange: (state: GameState) => void) {
    this.onChange = onChange;
  }

  getState(): GameState {
    return this.deepCopy();
  }

  loadGame(data: GameFile, startRoundIndex = 0): void {
    const teams = { team1: this.state.team1.name, team2: this.state.team2.name };
    this.state = defaultState();
    this.state.gameTitle = data.title || 'Family Feud';
    this.state.team1.name = teams.team1;
    this.state.team2.name = teams.team2;
    this.state.rounds = data.rounds.map(r => ({
      question: r.question,
      answers: r.answers.map(a => ({ text: a.text, points: a.points, revealed: false })),
    }));
    this.state.loaded = this.state.rounds.length > 0;
    if (this.state.loaded) {
      this.state.currentRoundIndex = Math.max(0, Math.min(startRoundIndex, this.state.rounds.length - 1));
    }
    this.emit();
  }

  setTeams(team1: string, team2: string): void {
    this.state.team1.name = team1 || 'Team 1';
    this.state.team2.name = team2 || 'Team 2';
    this.emit();
  }

  startBuzzin(): void {
    this.state.phase = 'buzzin';
    this.state.activePlayer = 0;
    this.emit();
  }

  setActivePlayer(player: ActivePlayer): void {
    this.state.activePlayer = player;
    if (player !== 0) this.state.phase = 'playing';
    this.emit();
  }

  revealAnswer(index: number): void {
    const round = this.currentRound();
    if (!round) return;
    if (index < 0 || index >= round.answers.length) return;
    if (round.answers[index].revealed) return;

    round.answers[index].revealed = true;
    this.state.roundPoints += round.answers[index].points;

    if (round.answers.every(a => a.revealed)) {
      this.state.phase = 'roundover';
    }
    this.emit();
  }

  addStrike(): void {
    this.state.strikes = Math.min(this.state.strikes + 1, 3);
    if (this.state.strikes >= 3) {
      this.state.phase = 'roundover';
    }
    this.emit();
  }

  awardPoints(team: 1 | 2): void {
    if (team === 1) {
      this.state.team1.score += this.state.roundPoints;
    } else {
      this.state.team2.score += this.state.roundPoints;
    }
    this.state.roundPoints = 0;
    this.state.phase = 'roundover';
    this.emit();
  }

  nextRound(): void {
    if (this.state.currentRoundIndex < this.state.rounds.length - 1) {
      this.state.currentRoundIndex++;
      this.state.strikes = 0;
      this.state.activePlayer = 0;
      this.state.roundPoints = 0;
      this.state.phase = 'idle';
    } else {
      this.state.phase = 'gameover';
    }
    this.emit();
  }

  resetRound(): void {
    const round = this.currentRound();
    if (round) {
      round.answers.forEach(a => { a.revealed = false; });
    }
    this.state.strikes = 0;
    this.state.activePlayer = 0;
    this.state.roundPoints = 0;
    this.state.phase = 'idle';
    this.emit();
  }

  resetGame(): void {
    const title = this.state.gameTitle;
    const rounds = this.state.rounds;
    const t1 = this.state.team1.name;
    const t2 = this.state.team2.name;
    this.state = defaultState();
    this.state.gameTitle = title;
    this.state.team1.name = t1;
    this.state.team2.name = t2;
    this.state.rounds = rounds.map(r => ({
      ...r,
      answers: r.answers.map(a => ({ ...a, revealed: false })),
    }));
    this.state.loaded = this.state.rounds.length > 0;
    this.emit();
  }

  private currentRound(): Round | null {
    return this.state.rounds[this.state.currentRoundIndex] ?? null;
  }

  private deepCopy(): GameState {
    return {
      ...this.state,
      team1: { ...this.state.team1 },
      team2: { ...this.state.team2 },
      rounds: this.state.rounds.map(r => ({
        ...r,
        answers: r.answers.map(a => ({ ...a })),
      })),
    };
  }

  private emit(): void {
    this.onChange(this.deepCopy());
  }
}
