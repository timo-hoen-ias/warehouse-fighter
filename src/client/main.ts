import './style.css';
import { CHARACTERS, getCharacter } from '../shared/characters';
import { type GameEvent, type GameState, ROUNDS_TO_WIN, TICK_RATE, createGame, step } from '../shared/game';
import { CpuController } from './ai';
import { sfx, unlockAudio } from './audio';
import { CONTROLS_HELP, initKeyboard, readInput } from './input';
import { NetClient, createRoom } from './net';
import { GameRenderer } from './renderer';

type Mode = 'cpu' | 'local' | 'online';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const screens = ['menu', 'select', 'lobby', 'result'] as const;
function show(screen: (typeof screens)[number] | null) {
  for (const s of screens) $(s).classList.toggle('hidden', s !== screen);
}

const renderer = new GameRenderer($<HTMLCanvasElement>('game'));
initKeyboard();
$('ctrl1').textContent = CONTROLS_HELP.p1;
$('ctrl2').textContent = CONTROLS_HELP.p2;

// --- Zustand -------------------------------------------------------------
let mode: Mode = 'cpu';
let state: GameState = createGame('gerd', 'kim');
let names: [string, string] = ['', ''];
let running = false; // true = Kampf läuft (Eingaben/Simulation)
let cpu: CpuController | null = null;
let net: NetClient | null = null;
let mySlot: 0 | 1 = 0;
let pendingRoom: string | null = null;
let accumulator = 0;

renderer.setFighters(['gerd', 'kim']);

// --- Banner & HUD ----------------------------------------------------------
function banner(text: string) {
  const el = $('banner');
  el.textContent = text;
  el.classList.remove('show');
  void el.offsetWidth; // Animation neu starten
  el.classList.add('show');
}

const comboTimers: number[] = [0, 0];
function showCombo(attacker: 0 | 1, count: number) {
  if (count < 2) return;
  const el = $(`combo${attacker}`);
  el.textContent = `${count} TREFFER!`;
  el.classList.add('show');
  clearTimeout(comboTimers[attacker]);
  comboTimers[attacker] = window.setTimeout(() => el.classList.remove('show'), 900);
}

function updateHud() {
  state.fighters.forEach((f, i) => {
    const pct = `${(Math.max(0, f.hp) / getCharacter(f.char).maxHp) * 100}%`;
    $(`hp${i}`).style.width = pct;
    $(`trail${i}`).style.width = pct;
    const pips = $(`pips${i}`);
    if (pips.childElementCount !== ROUNDS_TO_WIN) pips.innerHTML = '<i></i>'.repeat(ROUNDS_TO_WIN);
    Array.from(pips.children).forEach((p, k) => p.classList.toggle('on', k < f.wins));
  });
  $('timer').textContent = String(Math.ceil(state.timer / TICK_RATE));
  $('netinfo').textContent = net ? `Online · Ping ${net.ping} ms · Du bist Spieler ${mySlot + 1}` : '';
}

function handleEvents(events: GameEvent[]) {
  renderer.handleEvents(events);
  for (const e of events) {
    switch (e.type) {
      case 'roundStart':
        banner(`RUNDE ${e.round}`);
        sfx.bell();
        break;
      case 'fight':
        banner('SCHICHTBEGINN!');
        sfx.horn();
        break;
      case 'swing':
        sfx.swing();
        break;
      case 'projectile':
        if (e.kind === 'laser') sfx.scanner();
        else sfx.throw();
        break;
      case 'hit':
        sfx.hit(e.heavy);
        showCombo(e.target === 0 ? 1 : 0, state.fighters[e.target].combo);
        break;
      case 'block':
        sfx.block();
        break;
      case 'ko':
        banner('FEIERABEND!');
        sfx.ko();
        break;
      case 'timeout':
        banner('SCHICHTENDE!');
        break;
      case 'matchEnd':
        setTimeout(() => showResult(e.winner), 600);
        break;
    }
  }
}

function showResult(winner: 0 | 1 | -1) {
  running = false;
  let text = 'UNENTSCHIEDEN';
  if (winner !== -1) {
    text = `${names[winner].toUpperCase()} GEWINNT!`;
    if (mode === 'online') text = winner === mySlot ? 'DU GEWINNST!' : 'VERLOREN …';
  }
  $('resultText').textContent = text;
  $('resultStatus').textContent = '';
  show('result');
}

// --- Spielstart ------------------------------------------------------------
function startLocal(chars: [string, string]) {
  state = createGame(chars[0], chars[1]);
  names = [getCharacter(chars[0]).name, getCharacter(chars[1]).name];
  if (mode === 'cpu') names[1] += ' (CPU)';
  cpu = mode === 'cpu' ? new CpuController(1) : null;
  beginMatch(chars);
}

function beginMatch(chars: [string, string]) {
  renderer.setFighters(chars);
  renderer.smoothing = mode === 'online';
  $('name0').textContent = names[0];
  $('name1').textContent = names[1];
  $('hud').classList.remove('hidden');
  show(null);
  running = true;
  accumulator = 0;
  handleEvents(state.events);
}

function toMenu() {
  running = false;
  renderer.smoothing = false;
  net?.close();
  net = null;
  cpu = null;
  pendingRoom = null;
  $('hud').classList.add('hidden');
  history.replaceState(null, '', location.pathname);
  show('menu');
}

// --- Charakterauswahl --------------------------------------------------------
let picks: string[] = [];

function openSelect() {
  picks = [];
  const title =
    mode === 'local' ? 'Spieler 1: Wähle deinen Lagerarbeiter' : mode === 'online' ? 'Wähle deinen Kämpfer für das Online-Match' : 'Wähle deinen Lagerarbeiter';
  $('selectTitle').textContent = title;
  renderCards();
  show('select');
}

function renderCards() {
  const icons: Record<string, string> = { gerd: '🏗️', kim: '📟', piet: '📦' };
  $('cards').innerHTML = '';
  for (const c of CHARACTERS) {
    const card = document.createElement('div');
    card.className = 'card';
    const vest = `#${c.colors.vest.toString(16).padStart(6, '0')}`;
    const stars = (v: number) => '■'.repeat(v) + '□'.repeat(5 - v);
    const power = Math.round((c.moves.heavy.damage / 120) * 5);
    const speed = Math.round((c.walkSpeed / 0.075) * 5);
    const hp = Math.round((c.maxHp / 1150) * 5);
    card.innerHTML = `
      <div class="swatch" style="background:repeating-linear-gradient(-45deg, ${vest} 0 14px, #222 14px 28px)">${icons[c.id] ?? '👷'}</div>
      <h3>${c.name}</h3>
      <div class="job">${c.job}</div>
      <div class="bio">${c.bio}</div>
      <div class="stats">Kraft ${stars(power)}<br/>Tempo ${stars(speed)}<br/>Ausdauer ${stars(hp)}<br/>Spezial: ${c.moves.special.name}</div>`;
    picks.forEach((p, i) => {
      if (p === c.id) card.insertAdjacentHTML('beforeend', `<span class="badge p${i + 1}">P${i + 1}</span>`);
    });
    card.addEventListener('click', () => pick(c.id));
    $('cards').appendChild(card);
  }
}

function pick(id: string) {
  unlockAudio();
  picks.push(id);
  if (mode === 'local' && picks.length === 1) {
    $('selectTitle').textContent = 'Spieler 2: Wähle deinen Lagerarbeiter';
    renderCards();
    return;
  }
  if (mode === 'cpu') {
    const others = CHARACTERS.filter((c) => c.id !== id);
    picks.push(others[Math.floor(Math.random() * others.length)].id);
  }
  if (mode === 'online') {
    void connectOnline(id);
    return;
  }
  startLocal([picks[0], picks[1]]);
}

// --- Online ----------------------------------------------------------------
async function connectOnline(char: string) {
  show('lobby');
  $('lobbyStatus').textContent = 'Verbinde …';
  let room = pendingRoom;
  try {
    if (!room) room = await createRoom();
  } catch (err) {
    $('lobbyStatus').textContent = String(err);
    return;
  }
  $('lobbyCode').textContent = room;
  history.replaceState(null, '', `?room=${room}`);
  net = new NetClient(room, char, getCharacter(char).name, {
    onWelcome(slot) {
      mySlot = slot;
      $('lobbyStatus').textContent = slot === 0 ? 'Teile den Code oder Link mit deinem Gegner.' : 'Verbunden – gleich geht es los.';
    },
    onWaiting() {
      if (!running) $('lobbyStatus').textContent = 'Warte auf zweiten Spieler …';
    },
    onStart(chars, n) {
      names = [n[0], n[1]];
      names[mySlot] += ' (Du)';
      state = createGame(chars[0], chars[1]);
      beginMatch(chars);
    },
    onState(s) {
      state = s;
      handleEvents(s.events);
    },
    onOpponentLeft() {
      running = false;
      $('hud').classList.add('hidden');
      show('lobby');
      $('lobbyStatus').textContent = 'Gegner hat den Raum verlassen. Warte auf neuen Gegner …';
    },
    onRematchRequested(slot) {
      $('resultStatus').textContent = slot === mySlot ? 'Warte auf Gegner …' : 'Gegner will eine Revanche!';
    },
    onError(text) {
      if (!net) return;
      net = null;
      running = false;
      $('hud').classList.add('hidden');
      show('lobby');
      $('lobbyStatus').textContent = text;
    },
  });
}

// --- UI-Verdrahtung ----------------------------------------------------------
document.querySelectorAll<HTMLButtonElement>('#menu button[data-mode]').forEach((btn) =>
  btn.addEventListener('click', () => {
    unlockAudio();
    const m = btn.dataset.mode!;
    if (m === 'join') {
      const code = $<HTMLInputElement>('roomInput').value.trim().toUpperCase();
      if (!/^[A-Z0-9]{4,8}$/.test(code)) {
        $<HTMLInputElement>('roomInput').focus();
        return;
      }
      pendingRoom = code;
      mode = 'online';
    } else if (m === 'host') {
      pendingRoom = null;
      mode = 'online';
    } else {
      mode = m as Mode;
    }
    openSelect();
  }),
);
$('selectBack').addEventListener('click', toMenu);
$('lobbyBack').addEventListener('click', toMenu);
$('toMenu').addEventListener('click', toMenu);
$('copyLink').addEventListener('click', () => {
  void navigator.clipboard?.writeText(location.href);
  $('copyLink').textContent = 'Link kopiert!';
  setTimeout(() => ($('copyLink').textContent = 'Einladungslink kopieren'), 1500);
});
$('rematch').addEventListener('click', () => {
  if (mode === 'online') {
    net?.rematch();
    return;
  }
  startLocal([state.fighters[0].char, state.fighters[1].char]);
});

// Direkt-Einladung per Link: ?room=CODE
const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam && /^[A-Za-z0-9]{4,8}$/.test(roomParam)) {
  pendingRoom = roomParam.toUpperCase();
  mode = 'online';
  openSelect();
} else {
  show('menu');
}

// --- Hauptschleife -----------------------------------------------------------
const STEP = 1 / TICK_RATE;
let last = performance.now();

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (running && mode !== 'online') {
    accumulator += dt;
    while (accumulator >= STEP) {
      const p1 = readInput(0, mode === 'cpu');
      const p2 = mode === 'cpu' ? cpu!.next(state) : readInput(1, false);
      step(state, [p1, p2]);
      handleEvents(state.events);
      accumulator -= STEP;
    }
  } else if (running && net) {
    net.sendInput(readInput(mySlot, true));
  } else if (!running && $('hud').classList.contains('hidden')) {
    // Hintergrund-Demo im Menü: zwei CPUs prügeln sich
    demo(dt);
  }

  renderer.render(state, dt);
  if (running) updateHud();
  requestAnimationFrame(frame);
}

const demoCpu: [CpuController, CpuController] = [new CpuController(0, 0.5), new CpuController(1, 0.5)];
let demoAcc = 0;
function demo(dt: number) {
  demoAcc += dt;
  while (demoAcc >= STEP) {
    if (state.phase === 'matchEnd') state = createGame(state.fighters[0].char, state.fighters[1].char);
    step(state, [demoCpu[0].next(state), demoCpu[1].next(state)]);
    renderer.handleEvents(state.events.filter((e) => e.type === 'hit' || e.type === 'block'));
    demoAcc -= STEP;
  }
}

requestAnimationFrame(frame);
