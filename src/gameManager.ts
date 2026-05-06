import { GameState, GameFile, Round, ActivePlayer } from './types';

const defaultState = (): GameState => ({
  gameTitle: 'Family Feud',
  rounds: [],
  currentRoundIndex: 0,
  team1: { name: 'Team 1', score: 0 },
  team2: { name: 'Team 2', score: 0 },
  strikes: 0,
  activePlayer: 0,
  phase: 'pregame',
  controlContestActive: false,
  stealChanceActive: false,
  roundPoints: 0,
  loaded: false,
  usedRoundIndices: [],
});

export class GameManager {
  private state: GameState = defaultState();
  private onChange: (state: GameState) => void;
  private turnReveals = 0;
  private openingTeam: ActivePlayer = 0;
  private controlTargetPoints = 0;
  private faceoffHadStrike = false;
  private originalControlTeam: ActivePlayer = 0;

  constructor(onChange: (state: GameState) => void) {
    this.onChange = onChange;
  }

  getState(): GameState {
    return this.deepCopy();
  }

  loadGame(data: GameFile): void {
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
    this.state.phase = this.state.loaded ? 'idle' : 'pregame';
    this.turnReveals = 0;
    this.openingTeam = 0;
    this.state.controlContestActive = false;
    this.state.stealChanceActive = false;
    this.controlTargetPoints = 0;
    this.faceoffHadStrike = false;
    this.originalControlTeam = 0;
    this.emit();
  }

  setTeams(team1: string, team2: string): void {
    this.state.team1.name = team1 || 'Team 1';
    this.state.team2.name = team2 || 'Team 2';
    this.emit();
  }

  beginRound(index: number): void {
    if (index < 0 || index >= this.state.rounds.length) return;
    this.state.currentRoundIndex = index;
    if (!this.state.usedRoundIndices.includes(index)) {
      this.state.usedRoundIndices.push(index);
    }
    this.state.rounds[index].answers.forEach(a => { a.revealed = false; });
    this.state.strikes = 0;
    this.state.roundPoints = 0;
    this.state.activePlayer = 0;
    this.turnReveals = 0;
    this.openingTeam = 0;
    this.state.controlContestActive = false;
    this.state.stealChanceActive = false;
    this.controlTargetPoints = 0;
    this.faceoffHadStrike = false;
    this.originalControlTeam = 0;
    this.state.phase = 'buzzin';
    this.emit();
  }

  acknowledgeGameOver(): void {
    this.state.phase = 'pregame';
    this.emit();
  }

  // kept for Arduino ringer path
  startBuzzin(): void {
    this.state.phase = 'buzzin';
    this.state.activePlayer = 0;
    this.turnReveals = 0;
    this.openingTeam = 0;
    this.state.controlContestActive = false;
    this.state.stealChanceActive = false;
    this.controlTargetPoints = 0;
    this.faceoffHadStrike = false;
    this.originalControlTeam = 0;
    this.emit();
  }

  setActivePlayer(player: ActivePlayer): void {
    const fromBuzzin = this.state.phase === 'buzzin';
    this.turnReveals = 0;
    this.state.activePlayer = player;
    if (player !== 0) this.state.phase = fromBuzzin ? 'faceoff' : this.state.phase;
    if (fromBuzzin && player !== 0) {
      this.openingTeam = player;
      this.state.controlContestActive = false;
      this.state.stealChanceActive = false;
      this.controlTargetPoints = 0;
      this.faceoffHadStrike = false;
      this.originalControlTeam = 0;
    }
    this.emit();
  }

  revealAnswer(index: number): void {
    const round = this.currentRound();
    if (!round) return;
    if (index < 0 || index >= round.answers.length) return;
    if (round.answers[index].revealed) return;

    const revealedBefore = round.answers.filter(a => a.revealed).length;
    const answerPoints = round.answers[index].points;
    const bestPoints = Math.max(...round.answers.map(a => a.points));
    const revealingTeam = this.state.activePlayer;

    round.answers[index].revealed = true;
    this.state.roundPoints += answerPoints;
    this.turnReveals += 1;

    if (this.state.phase === 'playing' && this.state.stealChanceActive && revealingTeam !== 0) {
      this.finishRoundWithAward(revealingTeam);
      return;
    }

    if (this.state.phase === 'faceoff') {
      if (this.faceoffHadStrike && revealingTeam !== 0) {
        this.faceoffHadStrike = false;
        this.openingTeam = revealingTeam;
        this.state.controlContestActive = false;
        this.state.stealChanceActive = false;
        this.controlTargetPoints = 0;
        this.state.strikes = 0;
        this.turnReveals = 0;
        this.state.phase = 'playing';
        this.emit();
        return;
      }

      if (revealedBefore === 0 && answerPoints === bestPoints && revealingTeam !== 0) {
        this.faceoffHadStrike = false;
        this.openingTeam = revealingTeam;
        this.state.controlContestActive = false;
        this.state.stealChanceActive = false;
        this.controlTargetPoints = 0;
        this.state.strikes = 0;
        this.turnReveals = 0;
        this.state.phase = 'playing';
        this.emit();
        return;
      }

      if (revealedBefore === 0 && answerPoints < bestPoints && revealingTeam !== 0) {
        this.openingTeam = revealingTeam;
        this.state.controlContestActive = true;
        this.state.stealChanceActive = false;
        this.controlTargetPoints = answerPoints;
        this.state.activePlayer = revealingTeam === 1 ? 2 : 1;
        this.state.strikes = 0;
        this.turnReveals = 0;
        this.emit();
        return;
      }

      if (this.state.controlContestActive && revealingTeam !== 0 && revealingTeam !== this.openingTeam) {
        const beatOpeningAnswer = answerPoints > this.controlTargetPoints;
        this.state.controlContestActive = false;
        this.state.stealChanceActive = false;
        this.state.strikes = 0;
        this.turnReveals = 0;
        this.controlTargetPoints = 0;
        this.faceoffHadStrike = false;
        if (beatOpeningAnswer) {
          this.openingTeam = revealingTeam;
          this.state.phase = 'playing';
          this.emit();
          return;
        }

        this.state.activePlayer = this.openingTeam;
        this.state.phase = 'playing';
        this.emit();
        return;
      }

      if (revealingTeam !== 0) {
        this.faceoffHadStrike = false;
        this.openingTeam = revealingTeam;
        this.state.controlContestActive = false;
        this.state.stealChanceActive = false;
        this.controlTargetPoints = 0;
        this.state.strikes = 0;
        this.turnReveals = 0;
        this.state.phase = 'playing';
        this.emit();
        return;
      }
    }

    if (round.answers.every(a => a.revealed)) {
      if (this.state.phase === 'playing' && this.state.activePlayer !== 0) {
        this.finishRoundWithAward(this.state.activePlayer);
        return;
      }
      this.state.phase = 'roundover';
    }
    this.emit();
  }

  revealRoundOverAnswer(): void {
    if (this.state.phase !== 'roundover') return;

    const round = this.currentRound();
    if (!round) return;

    const nextAnswer = round.answers.find(answer => !answer.revealed);
    if (!nextAnswer) return;

    nextAnswer.revealed = true;
    this.emit();
  }

  addStrike(): void {
    this.state.strikes = Math.min(this.state.strikes + 1, 3);

    if (this.state.phase === 'faceoff' && this.state.activePlayer !== 0) {
      this.emit();
      this.state.activePlayer = this.state.activePlayer === 1 ? 2 : 1;
      this.state.strikes = 0;
      this.turnReveals = 0;
      this.state.controlContestActive = false;
      this.state.stealChanceActive = false;
      this.controlTargetPoints = 0;
      this.faceoffHadStrike = true;
      this.state.phase = 'faceoff';
      this.emit();
      return;
    }

    if (this.state.phase === 'playing' && this.state.stealChanceActive) {
      if (this.originalControlTeam === 0) {
        this.state.phase = 'roundover';
        this.emit();
        return;
      }

      this.emit();
      this.state.activePlayer = this.originalControlTeam;
      this.finishRoundWithAward(this.originalControlTeam);
      return;
    }

    if (this.state.phase === 'playing' && this.state.strikes >= 3 && this.state.activePlayer !== 0) {
      this.originalControlTeam = this.state.activePlayer;
      this.emit();
      this.state.activePlayer = this.state.activePlayer === 1 ? 2 : 1;
      this.state.strikes = 0;
      this.turnReveals = 0;
      this.state.controlContestActive = false;
      this.state.stealChanceActive = true;
      this.controlTargetPoints = 0;
      this.emit();
      return;
    }

    if (this.state.strikes >= 3) this.state.phase = 'roundover';
    this.emit();
  }

  swapActiveTeam(): void {
    if ((this.state.phase !== 'playing' && this.state.phase !== 'faceoff') || this.state.activePlayer === 0) return;
    this.state.activePlayer = this.state.activePlayer === 1 ? 2 : 1;
    this.state.strikes = 0;
    this.turnReveals = 0;
    this.state.controlContestActive = false;
    this.state.stealChanceActive = false;
    this.controlTargetPoints = 0;
    this.faceoffHadStrike = false;
    if (this.state.phase === 'faceoff') {
      this.openingTeam = this.state.activePlayer;
    }
    if (this.state.phase === 'playing') {
      this.originalControlTeam = 0;
    }
    this.emit();
  }

  awardPoints(team: 1 | 2): void {
    if (team === 1) this.state.team1.score += this.state.roundPoints;
    else           this.state.team2.score += this.state.roundPoints;
    this.state.roundPoints = 0;
    this.state.phase = 'roundover';
    this.emit();
  }

  nextRound(): void {
    this.state.strikes = 0;
    this.state.activePlayer = 0;
    this.state.roundPoints = 0;
    this.turnReveals = 0;
    this.openingTeam = 0;
    this.state.controlContestActive = false;
    this.state.stealChanceActive = false;
    this.controlTargetPoints = 0;
    this.faceoffHadStrike = false;
    this.originalControlTeam = 0;
    const allUsed = this.state.usedRoundIndices.length >= this.state.rounds.length;
    this.state.phase = allUsed ? 'gameover' : 'idle';
    this.emit();
  }

  resetRound(): void {
    const round = this.currentRound();
    if (round) round.answers.forEach(a => { a.revealed = false; });
    this.state.strikes = 0;
    this.state.activePlayer = 0;
    this.state.roundPoints = 0;
    this.turnReveals = 0;
    this.openingTeam = 0;
    this.state.controlContestActive = false;
    this.state.stealChanceActive = false;
    this.controlTargetPoints = 0;
    this.faceoffHadStrike = false;
    this.originalControlTeam = 0;
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
    this.turnReveals = 0;
    this.openingTeam = 0;
    this.state.controlContestActive = false;
    this.state.stealChanceActive = false;
    this.controlTargetPoints = 0;
    this.faceoffHadStrike = false;
    this.originalControlTeam = 0;
    this.emit();
  }

  private finishRoundWithAward(team: 1 | 2): void {
    if (team === 1) this.state.team1.score += this.state.roundPoints;
    else this.state.team2.score += this.state.roundPoints;

    this.state.roundPoints = 0;
    this.state.strikes = 0;
    this.turnReveals = 0;
    this.openingTeam = 0;
    this.state.controlContestActive = false;
    this.state.stealChanceActive = false;
    this.controlTargetPoints = 0;
    this.faceoffHadStrike = false;
    this.originalControlTeam = 0;
    this.state.phase = 'roundover';
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
      usedRoundIndices: [...this.state.usedRoundIndices],
    };
  }

  private emit(): void {
    this.onChange(this.deepCopy());
  }
}
