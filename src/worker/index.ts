// Cloudflare Worker: liefert das Spiel aus (Static Assets) und vermittelt
// Online-Kämpfe. Pro Raum gibt es ein Durable Object, das die Simulation
// serverautoritativ mit 60 Ticks/s rechnet und den Zustand an beide Spieler sendet.

import { DurableObject } from 'cloudflare:workers';
import { CHARACTERS } from '../shared/characters';
import { STAGES } from '../shared/stages';
import { type GameEvent, type GameState, TICK_RATE, createGame, step } from '../shared/game';
import { type ClientMessage, ROOM_CODE_RE, type ServerMessage } from '../shared/protocol';

interface Env {
  ASSETS: Fetcher;
  MATCH_ROOM: DurableObjectNamespace<MatchRoom>;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(length = 5) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      return Response.json({ room: randomCode() });
    }

    const match = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]+)\/ws$/);
    if (match) {
      const code = match[1].toUpperCase();
      if (!ROOM_CODE_RE.test(code)) return new Response('Ungültiger Raumcode', { status: 400 });
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('WebSocket erwartet', { status: 426 });
      }
      const stub = env.MATCH_ROOM.get(env.MATCH_ROOM.idFromName(code));
      return stub.fetch(request);
    }

    if (url.pathname.startsWith('/api/')) return new Response('Nicht gefunden', { status: 404 });
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

interface Attachment {
  slot: 0 | 1 | null;
  char: string;
  name: string;
  /** Arenawunsch – es gilt der von Spieler 1 (Raum-Ersteller). */
  stage: string;
}

const SEND_EVERY = 2; // Snapshots mit 30 Hz
const MAX_CATCHUP = 10;

export class MatchRoom extends DurableObject<Env> {
  private game: GameState | null = null;
  private inputs: [number, number] = [0, 0];
  // Tasten, die zwischen zwei Ticks gedrückt und wieder losgelassen wurden
  private taps: [number, number] = [0, 0];
  private rematch: [boolean, boolean] = [false, false];
  private loop: ReturnType<typeof setInterval> | null = null;
  private loopStart = 0;
  private ticksDone = 0;
  private pendingEvents: GameEvent[] = [];

  async fetch(request: Request): Promise<Response> {
    const code = new URL(request.url).pathname.split('/')[3]?.toUpperCase() ?? '';
    const taken = this.players().map((p) => p.att.slot);
    const slot = ([0, 1] as const).find((s) => !taken.includes(s));

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);

    if (slot === undefined) {
      this.send(server, { t: 'full' });
      server.close(4000, 'Raum voll');
      return new Response(null, { status: 101, webSocket: client });
    }
    server.serializeAttachment({ slot, char: '', name: '', stage: '' } satisfies Attachment);
    this.send(server, { t: 'welcome', slot, room: code });
    return new Response(null, { status: 101, webSocket: client });
  }

  private players() {
    return this.ctx
      .getWebSockets()
      .map((ws) => ({ ws, att: ws.deserializeAttachment() as Attachment | null }))
      .filter((p): p is { ws: WebSocket; att: Attachment } => p.att !== null && p.att.slot !== null);
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Verbindung bereits zu
    }
  }

  private broadcast(msg: ServerMessage) {
    const data = JSON.stringify(msg);
    for (const { ws } of this.players()) {
      try {
        ws.send(data);
      } catch {
        // ignorieren
      }
    }
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > 512) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att || att.slot === null) return;
    const slot = att.slot;

    switch (msg.t) {
      case 'join': {
        const char = CHARACTERS.some((c) => c.id === msg.char) ? msg.char : CHARACTERS[0].id;
        const name = String(msg.name ?? '').slice(0, 16) || `Spieler ${slot + 1}`;
        const stage = STAGES.some((s) => s.id === msg.stage) ? msg.stage : '';
        ws.serializeAttachment({ slot, char, name, stage } satisfies Attachment);
        this.tryStart();
        break;
      }
      case 'input':
        if (Number.isInteger(msg.i)) {
          const bits = msg.i & 0xff;
          this.taps[slot] |= bits & ~this.inputs[slot];
          this.inputs[slot] = bits;
        }
        break;
      case 'rematch':
        if (this.game?.phase !== 'matchEnd') break;
        this.rematch[slot] = true;
        this.broadcast({ t: 'rematchRequested', slot });
        if (this.rematch[0] && this.rematch[1]) this.startMatch();
        break;
      case 'ping':
        this.send(ws, { t: 'pong', ts: msg.ts });
        break;
    }
  }

  private tryStart() {
    const ready = this.players().filter((p) => p.att.char);
    if (ready.length < 2) {
      this.broadcast({ t: 'waiting' });
      return;
    }
    if (!this.game) this.startMatch();
  }

  private startMatch() {
    const players = this.players().sort((a, b) => a.att.slot! - b.att.slot!);
    if (players.length < 2) return;
    const chars: [string, string] = [players[0].att.char, players[1].att.char];
    const names: [string, string] = [players[0].att.name, players[1].att.name];
    const stage = players[0].att.stage || players[1].att.stage || STAGES[Math.floor(Math.random() * STAGES.length)].id;
    this.game = createGame(chars[0], chars[1], stage);
    this.inputs = [0, 0];
    this.taps = [0, 0];
    this.rematch = [false, false];
    this.pendingEvents = [...this.game.events];
    this.broadcast({ t: 'start', chars, names, stage });
    this.startLoop();
  }

  private startLoop() {
    this.stopLoop();
    this.loopStart = Date.now();
    this.ticksDone = 0;
    this.loop = setInterval(() => this.tick(), 1000 / TICK_RATE);
  }

  private stopLoop() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }

  private tick() {
    const game = this.game;
    if (!game) return this.stopLoop();
    const target = Math.floor(((Date.now() - this.loopStart) * TICK_RATE) / 1000);
    let steps = Math.min(MAX_CATCHUP, target - this.ticksDone);
    if (target - this.ticksDone > MAX_CATCHUP) this.ticksDone = target - MAX_CATCHUP;
    while (steps-- > 0) {
      step(game, [this.inputs[0] | this.taps[0], this.inputs[1] | this.taps[1]]);
      this.taps = [0, 0];
      this.ticksDone += 1;
      this.pendingEvents.push(...game.events);
      if (game.tick % SEND_EVERY === 0 || game.events.length) {
        this.broadcast({ t: 'state', s: { ...game, events: this.pendingEvents } });
        this.pendingEvents = [];
      }
    }
    if (game.phase === 'matchEnd' && game.phaseTime > TICK_RATE * 120) {
      // Niemand will eine Revanche – Raum aufräumen
      this.stopLoop();
    }
  }

  async webSocketClose(ws: WebSocket) {
    ws.serializeAttachment(null);
    this.onLeave();
  }

  async webSocketError(ws: WebSocket) {
    ws.serializeAttachment(null);
    this.onLeave();
  }

  private onLeave() {
    this.stopLoop();
    this.game = null;
    this.broadcast({ t: 'opponentLeft' });
  }
}
