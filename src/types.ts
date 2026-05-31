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

export type GamePhase = 'pregame' | 'idle' | 'buzzin' | 'faceoff' | 'control' | 'playing' | 'roundover' | 'gameover';
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
  controlContestActive: boolean;
  stealChanceActive: boolean;
  roundPoints: number;
  loaded: boolean;
  usedRoundIndices: number[];
}

export type DemoAction = 'buzz1' | 'buzz2' | 'strike' | 'win1' | 'win2' | 'reset';

export interface ClientToServerEvents {
  'arduino:sim_ringer':   (player: 1 | 2) => void;
  'demo:start':           () => void;
  'demo:stop':            () => void;
  'demo:action':          (action: DemoAction) => void;
  'demo:strike_cycle':    (player: 1 | 2) => void;
  'game:load':            (data: GameFile) => void;
  'game:loadSet':         (data: { setId: number; startRoundIndex: number }) => void;
  'game:setTeams':        (data: { team1: string; team2: string }) => void;
  'game:startBuzzin':     () => void;
  'game:setActivePlayer': (player: ActivePlayer) => void;
  'game:startPlay':       () => void;
  'game:revealAnswer':    (index: number) => void;
  'game:revealRoundOverAnswer': () => void;
  'game:addStrike':       () => void;
  'game:undoStrike':      () => void;
  'game:swapActiveTeam':  () => void;
  'game:awardPoints':     (team: 1 | 2) => void;
  'game:nextRound':       () => void;
  'game:resetRound':      () => void;
  'game:resetGame':            () => void;
  'game:playSound':            (sound: string) => void;
  'game:beginRound':           (index: number) => void;
  'game:acknowledgeGameOver':  () => void;
  'board:reload':              () => void;
}

export interface ServerToClientEvents {
  'state:update':     (state: GameState) => void;
  'arduino:ringer':   (player: 1 | 2) => void;
  'arduino:command':  (command: string) => void;
  'demo:state':         (active: boolean) => void;
  'demo:strikes_reset': () => void;
  'sound:play':       (sound: string) => void;
  'board:reload':     () => void;
}
