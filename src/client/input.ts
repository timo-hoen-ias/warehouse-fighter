import { INPUT } from '../shared/game';
import { readTouch } from './touch';

type Layout = Record<string, number>;

// event.code ist layoutunabhängig (physische Taste). "Slash" ist auf deutscher Tastatur die "-"-Taste.
const P1: Layout = {
  KeyA: INPUT.LEFT,
  KeyD: INPUT.RIGHT,
  KeyW: INPUT.UP,
  KeyS: INPUT.DOWN,
  KeyF: INPUT.LIGHT,
  KeyG: INPUT.HEAVY,
  KeyH: INPUT.SPECIAL,
  KeyV: INPUT.KICK,
};

const P2: Layout = {
  ArrowLeft: INPUT.LEFT,
  ArrowRight: INPUT.RIGHT,
  ArrowUp: INPUT.UP,
  ArrowDown: INPUT.DOWN,
  Comma: INPUT.LIGHT,
  Period: INPUT.HEAVY,
  Slash: INPUT.SPECIAL,
  Numpad1: INPUT.LIGHT,
  Numpad2: INPUT.HEAVY,
  Numpad3: INPUT.SPECIAL,
  KeyM: INPUT.KICK,
  Numpad0: INPUT.KICK,
};

const held = new Set<string>();
// Kurze Tastendrücke zwischen zwei Frames nicht verlieren
const tapped = new Set<string>();

export function initKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code in P1 || e.code in P2) e.preventDefault();
    held.add(e.code);
    tapped.add(e.code);
  });
  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => held.clear());
}

function readLayout(layout: Layout) {
  let bits = 0;
  for (const code of held) bits |= layout[code] ?? 0;
  for (const code of tapped) {
    if (code in layout) {
      bits |= layout[code];
      tapped.delete(code);
    }
  }
  return bits;
}

function readGamepad(index: number) {
  const pad = navigator.getGamepads?.()[index];
  if (!pad) return 0;
  let bits = 0;
  const ax = pad.axes[0] ?? 0;
  const ay = pad.axes[1] ?? 0;
  const b = (i: number) => pad.buttons[i]?.pressed ?? false;
  if (ax < -0.4 || b(14)) bits |= INPUT.LEFT;
  if (ax > 0.4 || b(15)) bits |= INPUT.RIGHT;
  if (ay < -0.5 || b(12)) bits |= INPUT.UP;
  if (ay > 0.5 || b(13)) bits |= INPUT.DOWN;
  if (b(2)) bits |= INPUT.LIGHT; // X / Quadrat
  if (b(3)) bits |= INPUT.HEAVY; // Y / Dreieck
  if (b(0)) bits |= INPUT.KICK; // A / Kreuz
  if (b(1)) bits |= INPUT.SPECIAL; // B / Kreis
  if (b(5)) bits |= INPUT.LIGHT | INPUT.KICK; // RB / R1 = Wurf
  return bits;
}

/** Eingabe für einen Spieler. `solo`: beide Tastatur-Belegungen steuern denselben Kämpfer. */
export function readInput(player: 0 | 1, solo: boolean): number {
  // Touch steuert immer den eigenen Kämpfer (Spieler 1 bzw. online den eigenen Slot)
  if (solo) return readLayout(P1) | readLayout(P2) | readGamepad(0) | readTouch();
  return player === 0 ? readLayout(P1) | readGamepad(0) | readTouch() : readLayout(P2) | readGamepad(1);
}

/** Kurzhilfe für Menü und HUD. */
export const CONTROLS_HELP = {
  p1: 'WASD bewegen · F leicht · G schwer · V Tritt · H Spezial',
  p2: 'Pfeile bewegen · , leicht · . schwer · M Tritt · - Spezial',
};
