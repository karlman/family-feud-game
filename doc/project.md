# family-feud-game

## Links
- **GitHub:** https://github.com/karlman/family-feud

## Overview
A Family Feud game server running on a Raspberry Pi. Manages game state, drives the display board, handles physical podium buzz-ins via serial, plays sounds, and exposes a web-based control panel for the host.

## Stack
- **Node.js / TypeScript** — Express + Socket.io server
- **SQLite** (`better-sqlite3`) — Questions and game state persistence
- **SerialPort** — Communication with the physical podium Arduino (family-feud-podium)
- **Socket.io** — Real-time sync between server, gameboard display, and control panel

## Web Interfaces
| Route | Purpose |
|-------|---------|
| `/gameboard` | The main display shown on TV — answers, scores, strikes |
| `/control` | Host control panel — reveal answers, add strikes, control game flow |
| `/virtual-podium` | Software podium for testing without physical hardware |
| `/settings` | Game configuration |

## How It Works
1. Server loads questions from SQLite (`feud.db`)
2. Host uses control panel to manage game flow
3. Physical podium buzzes in via serial → server receives `RINGER:1` or `RINGER:2`
4. Server sends commands back to podium (`ACTIVE:1`, `STRIKE:N`, `WIN:1`, etc.)
5. Gameboard display updates in real-time via Socket.io
6. Sound effects triggered via `soundManager`

## Key Files
- `src/index.ts` — Server entry point, Express + Socket.io setup
- `src/gameManager.ts` — Core game state logic
- `src/serialManager.ts` — Serial port communication with Arduino podium
- `src/soundManager.ts` — Sound effect management
- `src/db.ts` — SQLite database access
- `data/feud.db` — Questions database
- `data/game-state.json` — Persisted game state

## Related Repos
- `family-feud-podium` — Arduino firmware for the physical buzz-in podiums
- `family-feud-survey` — Web app for collecting and tabulating survey questions
