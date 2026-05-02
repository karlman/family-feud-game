export interface Answer {
  text: string;
  points: number;
  revealed: boolean;
}

export interface Round {
  question: string;
  answers: Answer[];
}

export interface GameFile {
  title: string;
  rounds: Round[];
}

export interface Team {
  name: string;
  score: number;
}

export type GamePhase = 'idle' | 'buzzin' | 'playing' | 'roundover' | 'gameover';
export type ActivePlayer = 0 | 1 | 2;

export interface GameState {
  gameTitle: string;
  rounds: Round[];
  currentRoundIndex: number;
  team1: Team;
  team2: Team;
  strikes: number;
  activePlayer: ActivePlayer;
  phase: GamePhase;
  roundPoints: number;
  loaded: boolean;
}

export interface ClientToServerEvents {
  'game:load': (data: GameFile) => void;
  'game:setTeams': (data: { team1: string; team2: string }) => void;
  'game:startBuzzin': () => void;
  'game:setActivePlayer': (player: ActivePlayer) => void;
  'game:revealAnswer': (index: number) => void;
  'game:addStrike': () => void;
  'game:awardPoints': (team: 1 | 2) => void;
  'game:nextRound': () => void;
  'game:resetRound': () => void;
  'game:resetGame': () => void;
  'game:playSound': (sound: string) => void;
}

export interface ServerToClientEvents {
  'state:update': (state: GameState) => void;
  'arduino:ringer': (player: 1 | 2) => void;
  'sound:play': (sound: string) => void;
}
