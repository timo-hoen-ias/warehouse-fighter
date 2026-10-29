import './style.css';
import { CHARACTERS, getCharacter } from '../shared/characters';
import { type GameEvent, type GameState, ROUNDS_TO_WIN, TICK_RATE, createGame, step } from '../shared/game';
import { STAGES, getStage } from '../shared/stages';
import { CpuController } from './ai';
import { sfx, unlockAudio } from './audio';
import { CONTROLS_HELP, initKeyboard, readInput } from './input';
import { NetClient, createRoom } from './net';
import { GameRenderer } from './renderer';

type Mode = 'arcade' | 'cpu' | 'local' | 'online';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const screens = ['menu', 'select', 'lobby', 'result', 'pause'] as const;
function show(screen: (typeof screens)[number] | null) {
  for (const s of screens) $(s).classList.toggle('hidden', s !== screen);
}

const renderer = new GameRenderer($<HTMLCanvasElement>('game'));
initKeyboard();
$('ctrl1').textContent = CONTROLS_HELP.p1;
$('ctrl2').textContent = CONTROLS_HELP.p2;
$('pctrl1').textContent = CONTROLS_HELP.p1;
$('pctrl2').textContent = CONTROLS_HELP.p2;

// --- Zustand -------------------------------------------------------------
let mode: Mode = 'cpu';
let state: GameState = createGame('gerd', 'kim', 'wareneingang');
let names: [string, string] = ['', ''];
let running = false; // true = Kampf läuft (Eingaben/Simulation)
let cpu: CpuController | null = null;
let net: NetClient | null = null;
let mySlot: 0 | 1 = 0;
let pendingRoom: string | null = null;
let accumulator = 0;
let paused = false;

// Arcade: nacheinander gegen alle anderen Kämpfer, jede Runde in einer anderen Arena
interface Ladder {
  player: string;
  opponents: string[];
  stages: string[];
  index: number;
}
let ladder: Ladder | null = null;

function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const randomStage = () => STAGES[Math.floor(Math.random() * STAGES.length)].id;

state = demoGame();

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
  const stage = getStage(state.stage).name;
  const info = ladder ? `Arcade ${ladder.index + 1}/${ladder.opponents.length} · ${stage}` : stage;
  $('netinfo').textContent = net ? `${stage} · Online · Ping ${net.ping} ms · Du bist Spieler ${mySlot + 1}` : info;
}

function handleEvents(events: GameEvent[]) {
  renderer.handleEvents(events, state);
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
        if (e.kind === 'laser' || e.kind === 'lidar' || e.kind === 'label') sfx.scanner();
        else if (e.kind === 'wave') sfx.horn();
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
        banner(e.finisher === 'wall' ? 'AB INS REGAL!' : e.finisher === 'head' ? 'KOPF AB – FEIERABEND!' : 'FEIERABEND!');
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
  paused = false;
  let text = 'UNENTSCHIEDEN';
  let button = 'Revanche';
  let status = '';
  if (winner !== -1) {
    text = `${names[winner].toUpperCase()} GEWINNT!`;
    if (mode === 'online') text = winner === mySlot ? 'DU GEWINNST!' : 'VERLOREN …';
  }
  if (ladder) {
    if (winner === 0 && ladder.index === ladder.opponents.length - 1) {
      text = 'MITARBEITER DES MONATS!';
      status = `Du hast alle ${ladder.opponents.length} Gegner in allen Hallen besiegt.`;
      button = 'Neue Arcade-Runde';
      ladder.index = -1;
      ladder.opponents = shuffle(ladder.opponents);
      ladder.stages = shuffle(ladder.stages);
    } else if (winner === 0) {
      const next = getCharacter(ladder.opponents[ladder.index + 1]);
      status = `Nächster Gegner: ${next.name} in „${getStage(ladder.stages[(ladder.index + 1) % ladder.stages.length]).name}“`;
      button = 'Nächster Gegner';
    } else {
      text = 'SCHICHT VERLOREN …';
      status = `Gegner ${ladder.index + 1} von ${ladder.opponents.length}. Versuch es noch einmal!`;
      button = 'Nochmal';
      ladder.index -= 1;
    }
  }
  $('resultText').textContent = text;
  $('resultStatus').textContent = status;
  $('rematch').textContent = button;
  show('result');
}

// --- Spielstart ------------------------------------------------------------
function startLocal(chars: [string, string], stage: string, cpuLevel = 0.6) {
  state = createGame(chars[0], chars[1], stage);
  names = [getCharacter(chars[0]).name, getCharacter(chars[1]).name];
  const vsCpu = mode === 'cpu' || mode === 'arcade';
  if (vsCpu) names[1] += ' (CPU)';
  cpu = vsCpu ? new CpuController(1, cpuLevel) : null;
  beginMatch(chars);
}

function nextArcadeFight() {
  if (!ladder) return;
  ladder.index += 1;
  const i = ladder.index;
  // CPU wird von Gegner zu Gegner stärker
  const level = 0.35 + (0.55 * i) / Math.max(1, ladder.opponents.length - 1);
  startLocal([ladder.player, ladder.opponents[i]], ladder.stages[i % ladder.stages.length], level);
  banner(`GEGNER ${i + 1}/${ladder.opponents.length}`);
}

function beginMatch(chars: [string, string]) {
  renderer.setFighters(chars);
  renderer.smoothing = mode === 'online';
  $('name0').textContent = names[0];
  $('name1').textContent = names[1];
  $('hud').classList.remove('hidden');
  show(null);
  running = true;
  paused = false;
  accumulator = 0;
  handleEvents(state.events);
}

function toMenu() {
  running = false;
  paused = false;
  renderer.smoothing = false;
  net?.close();
  net = null;
  cpu = null;
  ladder = null;
  pendingRoom = null;
  $('hud').classList.add('hidden');
  history.replaceState(null, '', location.pathname);
  show('menu');
}

// --- Auswahl (Kämpfer und Arena) ----------------------------------------------
type SelectStep = 'p1' | 'p2' | 'cpu' | 'stage';
let steps: SelectStep[] = [];
let picks: string[] = [];
let stagePick = '';

const STEP_TITLES: Record<SelectStep, string> = {
  p1: 'Wähle deinen Lagerarbeiter',
  p2: 'Spieler 2: Wähle deinen Lagerarbeiter',
  cpu: 'Wähle deinen CPU-Gegner',
  stage: 'Wähle die Arena',
};

function openSelect() {
  picks = [];
  stagePick = '';
  steps = {
    arcade: ['p1'],
    cpu: ['p1', 'cpu', 'stage'],
    local: ['p1', 'p2', 'stage'],
    online: pendingRoom ? ['p1'] : ['p1', 'stage'],
  }[mode] as SelectStep[];
  renderSelect();
  show('select');
}

function currentStep(): SelectStep {
  return steps[picks.length + (stagePick ? 1 : 0)] ?? 'p1';
}

function renderSelect() {
  const step = currentStep();
  let title = STEP_TITLES[step];
  if (step === 'p1' && mode === 'local') title = 'Spieler 1: Wähle deinen Lagerarbeiter';
  if (step === 'p1' && mode === 'arcade') title = 'Arcade: Wähle deinen Lagerarbeiter – danach warten alle anderen';
  if (step === 'stage' && mode === 'online') title = 'Wähle die Arena für das Online-Match';
  $('selectTitle').textContent = title;
  $('cards').innerHTML = '';
  $('cards').classList.toggle('stages', step === 'stage');
  if (step === 'stage') renderStageCards();
  else renderFighterCards();
}

function renderFighterCards() {
  const stars = (v: number) => '■'.repeat(Math.max(1, Math.min(5, v))) + '□'.repeat(5 - Math.max(1, Math.min(5, v)));
  for (const c of CHARACTERS) {
    const card = document.createElement('div');
    card.className = 'card';
    const vest = `#${c.colors.vest.toString(16).padStart(6, '0')}`;
    const power = Math.round((c.moves.heavy.damage / 135) * 5);
    const speed = Math.round((c.walkSpeed / 0.082) * 5);
    const hp = Math.round((c.maxHp / 1250) * 5);
    card.innerHTML = `
      <div class="swatch" style="background:repeating-linear-gradient(-45deg, ${vest} 0 14px, #222 14px 28px)">${c.icon}</div>
      <h3>${c.name}</h3>
      <div class="job">${c.job}</div>
      <div class="bio">${c.bio}</div>
      <div class="stats">Kraft ${stars(power)}<br/>Tempo ${stars(speed)}<br/>Ausdauer ${stars(hp)}<br/>Spezial: ${c.moves.special.name}</div>`;
    picks.forEach((p, i) => {
      if (p === c.id) card.insertAdjacentHTML('beforeend', `<span class="badge p${i + 1}">${steps[i] === 'cpu' ? 'CPU' : `P${i + 1}`}</span>`);
    });
    card.addEventListener('click', () => pick(c.id));
    $('cards').appendChild(card);
  }
}

function renderStageCards() {
  const all = [...STAGES, { id: 'random', name: 'Zufall', subtitle: 'Überrasch mich', colors: ['#333', '#ffcc00'] as [string, string] }];
  for (const st of all) {
    const card = document.createElement('div');
    card.className = 'card stage';
    card.innerHTML = `
      <div class="swatch" style="background:linear-gradient(135deg, ${st.colors[0]} 0 55%, ${st.colors[1]} 55% 100%)">${st.id === 'random' ? '🎲' : ''}</div>
      <h3>${st.name}</h3>
      <div class="bio">${st.subtitle}</div>`;
    card.addEventListener('click', () => pickStage(st.id === 'random' ? randomStage() : st.id));
    $('cards').appendChild(card);
  }
}

function pick(id: string) {
  unlockAudio();
  picks.push(id);
  if (mode === 'arcade') {
    const others = CHARACTERS.filter((c) => c.id !== id).map((c) => c.id);
    ladder = { player: id, opponents: shuffle(others), stages: shuffle(STAGES.map((st) => st.id)), index: -1 };
    nextArcadeFight();
    return;
  }
  advance();
}

function pickStage(id: string) {
  stagePick = id;
  advance();
}

function advance() {
  if (picks.length + (stagePick ? 1 : 0) < steps.length) {
    renderSelect();
    return;
  }
  if (mode === 'online') {
    void connectOnline(picks[0], stagePick);
    return;
  }
  startLocal([picks[0], picks[1]], stagePick || randomStage());
}

// --- Online ----------------------------------------------------------------
async function connectOnline(char: string, stage: string) {
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
  net = new NetClient(room, char, getCharacter(char).name, stage, {
    onWelcome(slot) {
      mySlot = slot;
      $('lobbyStatus').textContent = slot === 0 ? 'Teile den Code oder Link mit deinem Gegner.' : 'Verbunden – gleich geht es los.';
    },
    onWaiting() {
      if (!running) $('lobbyStatus').textContent = 'Warte auf zweiten Spieler …';
    },
    onStart(chars, n, stage) {
      names = [n[0], n[1]];
      names[mySlot] += ' (Du)';
      state = createGame(chars[0], chars[1], stage);
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

// --- Pause -------------------------------------------------------------------
function setPaused(on: boolean) {
  if (on && (!running || paused)) return;
  if (!on && !paused) return;
  paused = on;
  $('pauseInfo').textContent =
    mode === 'online' ? 'Online läuft der Kampf weiter – dein Gegner wartet nicht!' : 'Frühstückspause – 15 Minuten, nicht mehr!';
  $('restart').classList.toggle('hidden', mode === 'online');
  show(on ? 'pause' : null);
  last = performance.now();
}

function loadBloodSetting() {
  try {
    return localStorage.getItem('wf-blood') !== 'off';
  } catch {
    return true;
  }
}
function applyBlood(on: boolean) {
  renderer.blood = on;
  $('toggleBlood').textContent = `Blut: ${on ? 'an' : 'aus'}`;
  try {
    localStorage.setItem('wf-blood', on ? 'on' : 'off');
  } catch {
    // privater Modus – egal
  }
}
applyBlood(loadBloodSetting());

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' || e.code === 'KeyP') setPaused(!paused);
});
$('resume').addEventListener('click', () => setPaused(false));
$('toggleBlood').addEventListener('click', () => applyBlood(!renderer.blood));
$('pauseMenu').addEventListener('click', toMenu);
$('restart').addEventListener('click', () => {
  paused = false;
  if (ladder) {
    ladder.index -= 1;
    nextArcadeFight();
  } else {
    startLocal([state.fighters[0].char, state.fighters[1].char], state.stage);
  }
});

let padStartWasDown = false;
function pollPadPause() {
  const down = Array.from(navigator.getGamepads?.() ?? []).some((p) => p?.buttons[9]?.pressed);
  if (down && !padStartWasDown) setPaused(!paused);
  padStartWasDown = down;
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
  if (ladder) {
    nextArcadeFight();
    return;
  }
  startLocal([state.fighters[0].char, state.fighters[1].char], state.stage);
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
  pollPadPause();

  if (paused && mode !== 'online') {
    // Standbild
  } else if (running && mode !== 'online') {
    accumulator += dt;
    while (accumulator >= STEP) {
      const p1 = readInput(0, cpu !== null);
      const p2 = cpu ? cpu.next(state) : readInput(1, false);
      step(state, [p1, p2]);
      handleEvents(state.events);
      accumulator -= STEP;
    }
  } else if (running && net) {
    net.sendInput(paused ? 0 : readInput(mySlot, true));
  } else if (!running && $('hud').classList.contains('hidden')) {
    // Hintergrund-Demo im Menü: zwei CPUs prügeln sich
    demo(dt);
  }

  renderer.render(state, paused && mode !== 'online' ? 0 : dt);
  if (running) updateHud();
  requestAnimationFrame(frame);
}

const demoCpu: [CpuController, CpuController] = [new CpuController(0, 0.5), new CpuController(1, 0.5)];
function demoGame() {
  const [a, b] = shuffle(CHARACTERS.map((c) => c.id));
  renderer.setFighters([a, b]);
  return createGame(a, b, randomStage());
}
let demoAcc = 0;
function demo(dt: number) {
  demoAcc += dt;
  while (demoAcc >= STEP) {
    if (state.phase === 'matchEnd') state = demoGame();
    step(state, [demoCpu[0].next(state), demoCpu[1].next(state)]);
    renderer.handleEvents(state.events, state);
    demoAcc -= STEP;
  }
}

requestAnimationFrame(frame);
