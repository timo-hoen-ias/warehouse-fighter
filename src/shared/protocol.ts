// Nachrichten zwischen Browser und Durable Object (JSON über WebSocket).
import type { GameState } from './game';

export type ClientMessage =
  | { t: 'join'; char: string; name: string }
  | { t: 'input'; i: number }
  | { t: 'rematch' }
  | { t: 'ping'; ts: number };

export type ServerMessage =
  | { t: 'welcome'; slot: 0 | 1; room: string }
  | { t: 'waiting' }
  | { t: 'start'; chars: [string, string]; names: [string, string] }
  | { t: 'state'; s: GameState }
  | { t: 'opponentLeft' }
  | { t: 'rematchRequested'; slot: 0 | 1 }
  | { t: 'full' }
  | { t: 'pong'; ts: number };

export const ROOM_CODE_RE = /^[A-Z0-9]{4,8}$/;
