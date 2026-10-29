import type { GameState } from '../shared/game';
import type { ClientMessage, ServerMessage } from '../shared/protocol';

export interface NetHandlers {
  onWelcome(slot: 0 | 1, room: string): void;
  onWaiting(): void;
  onStart(chars: [string, string], names: [string, string], stage: string): void;
  onState(s: GameState): void;
  onOpponentLeft(): void;
  onRematchRequested(slot: 0 | 1): void;
  onError(text: string): void;
}

export async function createRoom(): Promise<string> {
  const res = await fetch('/api/rooms', { method: 'POST' });
  if (!res.ok) throw new Error('Raum konnte nicht erstellt werden');
  return ((await res.json()) as { room: string }).room;
}

export class NetClient {
  private ws: WebSocket;
  private lastInput = -1;
  private pingTimer: ReturnType<typeof setInterval>;
  private closed = false;
  ping = 0;

  constructor(room: string, private char: string, private name: string, private stage: string, h: NetHandlers) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/api/rooms/${room}/ws`);
    this.ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data) as ServerMessage;
      switch (msg.t) {
        case 'welcome':
          h.onWelcome(msg.slot, msg.room);
          this.send({ t: 'join', char: this.char, name: this.name, stage: this.stage });
          break;
        case 'waiting':
          h.onWaiting();
          break;
        case 'start':
          this.lastInput = -1;
          h.onStart(msg.chars, msg.names, msg.stage);
          break;
        case 'state':
          h.onState(msg.s);
          break;
        case 'opponentLeft':
          h.onOpponentLeft();
          break;
        case 'rematchRequested':
          h.onRematchRequested(msg.slot);
          break;
        case 'full':
          h.onError('Der Raum ist voll.');
          break;
        case 'pong':
          this.ping = Math.round(performance.now() - msg.ts);
          break;
      }
    });
    this.ws.addEventListener('close', () => {
      clearInterval(this.pingTimer);
      if (!this.closed) h.onError('Verbindung getrennt.');
    });
    this.pingTimer = setInterval(() => this.send({ t: 'ping', ts: performance.now() }), 2000);
  }

  sendInput(bits: number) {
    if (bits === this.lastInput) return;
    this.lastInput = bits;
    this.send({ t: 'input', i: bits });
  }

  rematch() {
    this.send({ t: 'rematch' });
  }

  close() {
    this.closed = true;
    clearInterval(this.pingTimer);
    this.ws.close();
  }

  private send(msg: ClientMessage) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
