import './style.css';
import { CHARACTERS, MOVE_INPUTS, type MoveKey, getCharacter } from '../shared/characters';
import { type GameEvent, type GameState, ROUNDS_TO_WIN, TICK_RATE, createGame, step } from '../shared/game';
import { STAGES, getStage } from '../shared/stages';
import { CpuController } from './ai';
import { type Weight, announce, audioSettings, setAnnouncerEnabled, setMusicEnabled, setMusicLevel, sfx, startMusic, unlockAudio } from './audio';
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

const HEAVY_MOVES = new Set<MoveKey>(['heavy', 'finisher', 'launcher', 'overhead', 'rush', 'throw', 'fwdKick', 'special']);
const MID_MOVES = new Set<MoveKey>(['kick', 'kick2', 'lowKick', 'fwdLight', 'air', 'airKick', 'low']);
const KICK_MOVES = new Set<MoveKey>(['kick', 'kick2', 'lowKick', 'fwdKick', 'airKick', 'low']);
const weightOf = (m: MoveKey): Weight => (HEAVY_MOVES.has(m) ? 'heavy' : MID_MOVES.has(m) ? 'mid' : 'light');
const ROUND_WORDS = ['eins', 'zwei', 'drei', 'vier', 'fünf'];

function handleEvents(events: GameEvent[]) {
  renderer.handleEvents(events, state);
  for (const e of events) {
    switch (e.type) {
      case 'roundStart':
        banner(`RUNDE ${e.round}`);
        sfx.bell();
        announce(`Runde ${ROUND_WORDS[e.round - 1] ?? e.round}`);
        break;
      case 'fight':
        banner('SCHICHTBEGINN!');
        sfx.horn();
        announce('Schichtbeginn!');
        break;
      case 'swing':
        if (e.move === 'throw') sfx.grab();
        else sfx.swing(weightOf(e.move), KICK_MOVES.has(e.move));
        break;
      case 'dash':
        sfx.dash();
        break;
      case 'projectile':
        sfx.projectile(e.kind);
        break;
      case 'hit':
        sfx.hit(weightOf(e.move), e.combo);
        sfx.comboTick(e.combo);
        showCombo(e.target === 0 ? 1 : 0, e.combo);
        if (e.move === 'launcher') banner('AB IN DIE LUFT!');
        break;
      case 'knockdown':
        sfx.knockdown();
        break;
      case 'block':
        sfx.block();
        break;
      case 'ko':
        banner(e.finisher === 'wall' ? 'AB INS REGAL!' : e.finisher === 'head' ? 'KOPF AB – FEIERABEND!' : 'FEIERABEND!');
        sfx.ko();
        if (e.finisher === 'wall') setTimeout(sfx.wallSlam, 700);
        else setTimeout(sfx.gore, 120);
        announce('Feierabend!');
        break;
      case 'timeout':
        banner('SCHICHTENDE!');
        announce('Schichtende!');
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
  startMusic('fight');
  setMusicLevel(1);
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
  startMusic('menu');
  setMusicLevel(1);
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
  if (on) renderMoveList();
  $('movelist').classList.add('hidden');
  $('pause').classList.remove('moves');
  setMusicLevel(on ? 0.35 : 1);
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

// --- Befehlsliste ------------------------------------------------------------
const MOVE_ORDER: MoveKey[] = ['light', 'light2', 'finisher', 'heavy', 'kick', 'kick2', 'fwdLight', 'fwdKick', 'overhead', 'launcher', 'lowLight', 'lowKick', 'low', 'air', 'airKick', 'special', 'rush', 'throw'];
const COMBOS = [
  'Leicht, Leicht, Schwer',
  'Leicht, Leicht, Tritt',
  'Leicht, Tritt, Tritt',
  'Schwer, Tritt',
  '→ + Leicht, Schwer',
  '↓ + Leicht, ↓ + Leicht, ↓ + Tritt',
  '← + Schwer (Launcher), dann in der Luft: Leicht, Leicht, Schwer',
];

function moveTag(char: string, m: MoveKey) {
  const def = getCharacter(char).moves[m];
  const tags: string[] = [];
  if (def.height === 'low') tags.push('tief');
  if (def.height === 'high' && m !== 'air' && m !== 'airKick') tags.push('hoch');
  if (def.launch) tags.push('Launcher');
  if (def.grab) tags.push('Wurf');
  else if (def.knockdown) tags.push('wirft um');
  if (def.projectile) tags.push('Geschoss');
  return tags.join(' · ');
}

function renderMoveList() {
  const el = $('movelist');
  const seen = new Set<string>();
  el.innerHTML = '';
  state.fighters.forEach((f) => {
    if (seen.has(f.char)) return;
    seen.add(f.char);
    const c = getCharacter(f.char);
    const rows = MOVE_ORDER.map((m) => `<tr><td class="in">${MOVE_INPUTS[m]}</td><td>${c.moves[m].name}</td><td class="tag">${moveTag(c.id, m)}</td></tr>`).join('');
    el.insertAdjacentHTML('beforeend', `<div><h3>${c.icon} ${c.name}</h3><table>${rows}</table></div>`);
  });
  el.insertAdjacentHTML(
    'beforeend',
    `<div class="combos"><b>Kombos:</b> ${COMBOS.join(' &nbsp;|&nbsp; ')}<br/><b>Bewegung:</b> → → Dash, ← ← Rückwärts-Dash, ↓ halten = tief blocken, ← halten = blocken. Würfe sind nicht blockbar, tiefe Angriffe nur geduckt.</div>`,
  );
}

function applyToggle(id: string, label: string, on: boolean) {
  $(id).textContent = `${label}: ${on ? 'an' : 'aus'}`;
}
applyToggle('toggleMusic', 'Musik', audioSettings.music);
applyToggle('toggleAnnouncer', 'Ansager', audioSettings.announcer);
$('toggleMusic').addEventListener('click', () => {
  setMusicEnabled(!audioSettings.music);
  setMusicLevel(paused ? 0.35 : 1);
  applyToggle('toggleMusic', 'Musik', audioSettings.music);
});
$('toggleAnnouncer').addEventListener('click', () => {
  setAnnouncerEnabled(!audioSettings.announcer);
  applyToggle('toggleAnnouncer', 'Ansager', audioSettings.announcer);
});
$('toggleMoves').addEventListener('click', () => {
  const open = $('movelist').classList.toggle('hidden') === false;
  $('pause').classList.toggle('moves', open);
});

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

// Musik startet mit der ersten Eingabe (Browser erlauben vorher keinen Ton)
function firstGesture() {
  unlockAudio();
  if (!running) startMusic('menu');
  window.removeEventListener('pointerdown', firstGesture);
  window.removeEventListener('keydown', firstGesture);
}
window.addEventListener('pointerdown', firstGesture);
window.addEventListener('keydown', firstGesture);

// Retro-Pixelfilter: aus / leicht / mittel / stark
const RETRO_LABELS = ['aus', 'leicht', 'mittel', 'stark'];
function loadRetro() {
  try {
    const v = Number(localStorage.getItem('wf-retro') ?? 2);
    return v >= 0 && v <= 3 ? v : 2;
  } catch {
    return 2;
  }
}
function applyRetro(level: number) {
  renderer.retro = level;
  for (const id of ['retroMenu', 'retroPause']) $(id).textContent = `Retro-Filter: ${RETRO_LABELS[level]}`;
  try {
    localStorage.setItem('wf-retro', String(level));
  } catch {
    // egal
  }
}
applyRetro(loadRetro());
for (const id of ['retroMenu', 'retroPause']) $(id).addEventListener('click', () => applyRetro((renderer.retro + 1) % 4));

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
let wasSlow = false;

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
  const slow = state.slowmo > 0;
  if (slow !== wasSlow && !paused) setMusicLevel(slow ? 0.25 : 1);
  wasSlow = slow;
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
