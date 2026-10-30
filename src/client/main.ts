import './style.css';
import { CHARACTERS, MOVE_INPUTS, type MoveKey, getCharacter } from '../shared/characters';
import { type GameEvent, type GameState, ROUNDS_TO_WIN, TICK_RATE, createGame, step } from '../shared/game';
import { STAGES, getStage } from '../shared/stages';
import { CpuController } from './ai';
import {
  FIGHT_SONGS,
  SONGS,
  type Song,
  type Weight,
  announce,
  audioSettings,
  fightSong,
  setAnnouncerEnabled,
  setMusicEnabled,
  setMusicLevel,
  setMusicVolume,
  setSfxVolume,
  setTrack,
  sfx,
  startMusic,
  unlockAudio,
} from './audio';
import { initKeyboard, readInput } from './input';
import { initTouch, isTouchDevice } from './touch';
import { NetClient, createRoom } from './net';
import { GameRenderer } from './renderer';

type Mode = 'arcade' | 'cpu' | 'local' | 'online';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const screens = ['menu', 'select', 'lobby', 'result', 'pause', 'options', 'guide'] as const;
function show(screen: (typeof screens)[number] | null) {
  for (const s of screens) $(s).classList.toggle('hidden', s !== screen);
}

const renderer = new GameRenderer($<HTMLCanvasElement>('game'));
initKeyboard();

// Handy: Touch-Steuerung und Hochformat-Layout
const touch = isTouchDevice();
document.body.classList.toggle('touch', touch);
if (touch) initTouch(() => onBack());

/** HUD (und auf dem Handy die Touch-Steuerung) ein-/ausblenden. */
function setHud(on: boolean) {
  $('hud').classList.toggle('hidden', !on);
  $('touch').classList.toggle('hidden', !on || !touch);
  document.body.classList.toggle('fighting', on);
}

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
  setHud(true);
  show(null);
  running = true;
  paused = false;
  accumulator = 0;
  startMusic(matchSong());
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
  setHud(false);
  history.replaceState(null, '', location.pathname);
  showPanel('main');
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
      setHud(false);
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
      setHud(false);
      show('lobby');
      $('lobbyStatus').textContent = text;
    },
  });
}

// --- Pause ---------------------------------------------------------------------
function setPaused(on: boolean) {
  if (on && (!running || paused)) return;
  if (!on && !paused) return;
  paused = on;
  $('pauseInfo').textContent =
    mode === 'online' ? 'Online läuft der Kampf weiter – dein Gegner wartet nicht!' : 'Frühstückspause – 15 Minuten, nicht mehr!';
  $('restart').classList.toggle('hidden', mode === 'online');
  setMusicLevel(on ? 0.35 : 1);
  show(on ? 'pause' : null);
  last = performance.now();
}

function loadSetting(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function saveSetting(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // privater Modus – egal
  }
}

renderer.blood = loadSetting('wf-blood', 'on') !== 'off';
renderer.retro = Math.min(3, Math.max(0, Number(loadSetting('wf-retro', '2')) || 0));

// --- Hauptmenü-Panels ----------------------------------------------------------
type Panel = 'main' | 'play' | 'online';
function showPanel(panel: Panel) {
  document.querySelectorAll<HTMLElement>('#menu [data-panel]').forEach((el) => el.classList.toggle('hidden', el.dataset.panel !== panel));
  if (panel === 'online') $<HTMLInputElement>('roomInput').focus();
}
document.querySelectorAll<HTMLButtonElement>('#menu [data-open]').forEach((btn) =>
  btn.addEventListener('click', () => {
    sfx.menu();
    showPanel(btn.dataset.open as Panel);
  }),
);
const currentPanel = () => document.querySelector<HTMLElement>('#menu [data-panel]:not(.hidden)')?.dataset.panel ?? 'main';

// --- Untermenüs: Optionen und Kampfschule ---------------------------------------
let subReturn: 'menu' | 'pause' = 'menu';

function openSub(screen: 'options' | 'guide', tab?: GuideTab) {
  unlockAudio();
  sfx.menu();
  subReturn = paused ? 'pause' : 'menu';
  if (screen === 'guide') {
    // im Kampf zuerst die Befehlsliste des eigenen Kämpfers zeigen
    if (running) guideFighter = state.fighters[mode === 'online' ? mySlot : 0].char;
    renderGuide(tab ?? (paused ? 'moves' : 'basics'));
  }
  else renderOptions();
  show(screen);
}

function closeSub() {
  sfx.menu();
  // Vorschau aus den Optionen beenden: wieder den passenden Titel spielen
  if (running) startMusic(matchSong());
  else startMusic('menu');
  show(subReturn === 'pause' && paused ? 'pause' : 'menu');
}

const subOpen = () => !$('options').classList.contains('hidden') || !$('guide').classList.contains('hidden');

document.querySelectorAll<HTMLButtonElement>('[data-options]').forEach((b) => b.addEventListener('click', () => openSub('options')));
document.querySelectorAll<HTMLButtonElement>('[data-guide]').forEach((b) =>
  b.addEventListener('click', () => openSub('guide', b.dataset.tab as GuideTab | undefined)),
);
document.querySelectorAll<HTMLButtonElement>('[data-back]').forEach((b) => b.addEventListener('click', closeSub));

/** Kampftitel des laufenden Matches (Arena bzw. Optionen, Arcade-Finale = Endgegner). */
function matchSong() {
  const finale = !!ladder && ladder.index === ladder.opponents.length - 1;
  return fightSong(Math.max(0, STAGES.findIndex((st) => st.id === state.stage)), finale);
}

// Optionen
const RETRO_LABELS = ['aus', 'leicht', 'mittel', 'stark'];
const TRACKS = ['auto', ...FIGHT_SONGS];
const trackLabel = (t: string) => (t === 'auto' ? 'Automatisch (je Arena)' : SONGS[t as Song].title);
const onOff = (on: boolean) => (on ? 'an' : 'aus');

function renderOptions() {
  $('optRetro').textContent = RETRO_LABELS[renderer.retro];
  $('optBlood').textContent = onOff(renderer.blood);
  $('optMusic').textContent = onOff(audioSettings.music);
  $('optTrack').textContent = trackLabel(audioSettings.track);
  $('optAnnouncer').textContent = onOff(audioSettings.announcer);
  $<HTMLInputElement>('optMusicVol').value = String(Math.round(audioSettings.musicVolume * 100));
  $<HTMLInputElement>('optSfxVol').value = String(Math.round(audioSettings.sfxVolume * 100));
}

function option(id: string, change: () => void) {
  $(id).addEventListener('click', (e) => {
    e.preventDefault();
    change();
    sfx.menu();
    renderOptions();
  });
}
option('optRetro', () => {
  renderer.retro = (renderer.retro + 1) % 4;
  saveSetting('wf-retro', String(renderer.retro));
});
option('optBlood', () => {
  renderer.blood = !renderer.blood;
  saveSetting('wf-blood', renderer.blood ? 'on' : 'off');
});
option('optMusic', () => setMusicEnabled(!audioSettings.music));
option('optTrack', () => {
  const t = TRACKS[(TRACKS.indexOf(audioSettings.track) + 1) % TRACKS.length];
  setTrack(t);
  // Vorschau
  startMusic(t === 'auto' ? (running ? matchSong() : 'menu') : (t as Song));
});
option('optAnnouncer', () => {
  setAnnouncerEnabled(!audioSettings.announcer);
  if (audioSettings.announcer) announce('Schichtbeginn!');
});
$<HTMLInputElement>('optMusicVol').addEventListener('input', (e) => setMusicVolume(Number((e.target as HTMLInputElement).value) / 100));
$<HTMLInputElement>('optSfxVol').addEventListener('input', (e) => setSfxVolume(Number((e.target as HTMLInputElement).value) / 100));
$<HTMLInputElement>('optSfxVol').addEventListener('change', () => sfx.hit('mid'));

// Kampfschule
type GuideTab = 'basics' | 'combos' | 'moves' | 'controls';
const MOVE_ORDER: MoveKey[] = ['light', 'light2', 'finisher', 'heavy', 'kick', 'kick2', 'fwdLight', 'fwdKick', 'overhead', 'launcher', 'lowLight', 'lowKick', 'low', 'air', 'airKick', 'special', 'rush', 'throw'];
let guideFighter = '';

const COMBO_TABLE: [string, string, string, string][] = [
  ['Leicht, Leicht, Schwer', '3', 'Die Grundkette. Der letzte Schlag stößt den Gegner weit zurück.', '★'],
  ['Leicht, Leicht, Tritt', '3', 'Endet mit einem Doppeltritt, der Gegner bleibt nah bei dir.', '★'],
  ['Leicht, Tritt, Tritt', '3', 'Schnell und sicher, gut als Antwort auf einen geblockten Angriff.', '★'],
  ['Schwer, Tritt', '2', 'Trifft der schwere Schlag, sofort Tritt hinterher.', '★★'],
  ['→ + Leicht, Schwer', '2', 'Vorstoß mit Reichweite, holt den Gegner aus der Distanz.', '★★'],
  ['↓ Leicht, ↓ Leicht, ↓ Tritt', '3', 'Komplett tief – muss geduckt geblockt werden.', '★★'],
  ['← + Schwer, nachlaufen, Leicht, Leicht, Schwer', 'bis 4', 'Launcher-Juggle: Gegner hochschleudern, hinterher (→ oder Dash) und zuschlagen, sobald er wieder fällt.', '★★★'],
  ['← + Schwer, Dash, Leicht, Tritt, Tritt', 'bis 4', 'Juggle-Variante mit Tritten, trägt den Gegner Richtung Wand.', '★★★'],
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

function renderGuide(tab: GuideTab) {
  document.querySelectorAll<HTMLButtonElement>('#guide .tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  const body = $('guideBody');
  if (tab === 'basics') {
    body.innerHTML = `
      <div class="cols">
        <div><h3>Blocken</h3><p><b>Vom Gegner weg halten</b> blockt hohe und mittlere Angriffe. <b>↓ + zurück</b> blockt tief.
          Tiefe Angriffe (alle ↓-Moves, Feger) gehen nur geduckt zu blocken, <b>Überkopf (→ + Schwer)</b> und Sprungangriffe nur stehend.</p></div>
        <div><h3>Bewegen</h3><p><b>→ →</b> Dash nach vorn, <b>← ←</b> Rückwärts-Dash zum Ausweichen. <b>↑</b> springt, in der Luft gehen Leicht, Schwer und Tritt.</p></div>
        <div><h3>Würfe</h3><p><b>Leicht + Tritt gleichzeitig</b>, nah am Gegner. Würfe gehen durch jeden Block und werfen zu Boden. Gegner in der Luft lassen sich nicht werfen.</p></div>
        <div><h3>Am Boden</h3><p>Feger, Überkopf, Ansturm, Wurf und Juggles werfen um. Am Boden liegt man kurz <b>unverwundbar</b> und steht dann automatisch auf – nicht blind draufhauen, sondern abwarten.</p></div>
        <div><h3>Spezial</h3><p><b>Spezial</b> wirft das Geschoss deines Kämpfers, <b>→ + Spezial</b> ist ein Ansturm quer durch die Halle, der umwirft.</p></div>
        <div><h3>Runden</h3><p>Best of 3, 99 Sekunden pro Runde. Wer zuerst zwei Runden gewinnt, hat <b>Feierabend</b>. Der letzte Schlag kommt in Zeitlupe.</p></div>
      </div>`;
  } else if (tab === 'combos') {
    const rows = COMBO_TABLE.map(([input, hits, text, diff]) => `<tr><td class="in">${input}</td><td class="hits">${hits}</td><td>${text}</td><td class="tag">${diff}</td></tr>`).join('');
    body.innerHTML = `
      <p class="intro"><b>So funktionieren Kombos:</b> Trifft ein Angriff, kannst du ihn mit dem nächsten Knopf <b>abbrechen</b> und direkt weiterschlagen.
        Drück den nächsten Knopf kurz nachdem der Schlag trifft – ein Eingabepuffer merkt sich Tastendrücke etwa eine Achtelsekunde lang.
        Wird der erste Schlag geblockt, endet die Kette. Jeder weitere Treffer macht etwas weniger Schaden, der Zähler am Bildrand zeigt die Treffer.</p>
      <table><tr><th>Eingabe</th><th>Treffer</th><th>Erklärung</th><th>Schwierigkeit</th></tr>${rows}</table>
      <p class="intro"><b>Mixup-Tipp:</b> Blockt der Gegner viel, <b>werfen</b>. Duckt er, <b>Überkopf (→ + Schwer)</b>. Steht er, <b>Feger (↓ + Schwer)</b>.</p>`;
  } else if (tab === 'moves') {
    if (!guideFighter || !CHARACTERS.some((c) => c.id === guideFighter)) guideFighter = running ? state.fighters[mode === 'online' ? mySlot : 0].char : CHARACTERS[0].id;
    const c = getCharacter(guideFighter);
    const options = CHARACTERS.map((f) => `<option value="${f.id}"${f.id === c.id ? ' selected' : ''}>${f.icon} ${f.name}</option>`).join('');
    const rows = MOVE_ORDER.map((m) => `<tr><td class="in">${MOVE_INPUTS[m]}</td><td>${c.moves[m].name}</td><td class="tag">${moveTag(c.id, m)}</td></tr>`).join('');
    body.innerHTML = `<label class="pick">Kämpfer <select id="guideFighter">${options}</select></label><table>${rows}</table>`;
    $<HTMLSelectElement>('guideFighter').addEventListener('change', (e) => {
      guideFighter = (e.target as HTMLSelectElement).value;
      renderGuide('moves');
    });
  } else {
    body.innerHTML = `
      <table>
        <tr><th>Aktion</th><th>Spieler 1</th><th>Spieler 2</th><th>Gamepad</th></tr>
        <tr><td>Bewegen / Springen / Ducken</td><td class="in">W A S D</td><td class="in">Pfeiltasten</td><td class="in">Stick / D-Pad</td></tr>
        <tr><td>Leicht</td><td class="in">F</td><td class="in">,</td><td class="in">X / □</td></tr>
        <tr><td>Schwer</td><td class="in">G</td><td class="in">.</td><td class="in">Y / △</td></tr>
        <tr><td>Tritt</td><td class="in">V</td><td class="in">M</td><td class="in">A / ✕</td></tr>
        <tr><td>Spezial</td><td class="in">H</td><td class="in">-</td><td class="in">B / ○</td></tr>
        <tr><td>Wurf</td><td class="in">F + V</td><td class="in">, + M</td><td class="in">RB / R1</td></tr>
        <tr><td>Pause</td><td class="in" colspan="2">Esc oder P</td><td class="in">Start</td></tr>
      </table>
      <p class="intro"><b>Handy:</b> Linke Bildschirmhälfte ist ein Stick (überall hintippen und ziehen), zweimal kurz nach vorn = Dash,
        nach oben = Springen, nach unten = Ducken. Rechts liegen Leicht, Schwer, Tritt, Spezial und eine eigene Wurf-Taste, oben rechts die Pause.
        Am besten hochkant spielen.</p>
      <p class="intro">Gegen CPU und online funktionieren beide Tastaturbelegungen. Ziffernblock für Spieler 2: 1 leicht, 2 schwer, 3 Spezial, 0 Tritt.</p>`;
  }
}
document.querySelectorAll<HTMLButtonElement>('#guide .tabs button').forEach((b) =>
  b.addEventListener('click', () => {
    sfx.menu();
    renderGuide(b.dataset.tab as GuideTab);
  }),
);

/** Esc / Start: Untermenü schließen, sonst Pause umschalten. */
function onBack() {
  if (subOpen()) closeSub();
  else if (!$('menu').classList.contains('hidden') && currentPanel() !== 'main') showPanel('main');
  else setPaused(!paused);
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
    if (e.code !== 'Escape') return;
  }
  if (e.code === 'Escape' || (e.code === 'KeyP' && !subOpen())) onBack();
});
$('resume').addEventListener('click', () => setPaused(false));
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
  if (down && !padStartWasDown) onBack();
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
