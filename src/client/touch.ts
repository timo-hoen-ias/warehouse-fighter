import { INPUT } from '../shared/game';

// Touch-Steuerung fürs Handy: schwebender Stick links, Angriffstasten rechts.
// Alles über Pointer-Events mit Mehrfachberührung. Kurze Tipper werden bis zum
// nächsten Simulationsschritt gemerkt, damit ein schneller Doppeltipp (Dash)
// oder ein kurzer Knopfdruck nicht verloren geht.

export const isTouchDevice = () =>
  typeof window !== 'undefined' && (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);

const DEAD_X = 16;
const DEAD_UP = 26;
const DEAD_DOWN = 20;
const RADIUS = 46;

let stickBits = 0;
let buttonBits = 0;
let latched = 0;
const buttonsDown = new Map<number, number>(); // pointerId -> Bits

function setStick(bits: number) {
  latched |= bits & ~stickBits;
  stickBits = bits;
}

function refreshButtons() {
  let bits = 0;
  for (const b of buttonsDown.values()) bits |= b;
  latched |= bits & ~buttonBits;
  buttonBits = bits;
}

/** Aktuelle Touch-Eingabe (inkl. gemerkter Tipper seit dem letzten Aufruf). */
export function readTouch(): number {
  const bits = stickBits | buttonBits | latched;
  latched = 0;
  return bits;
}

export function initTouch(onPause: () => void) {
  const root = document.getElementById('touch')!;
  const zone = document.getElementById('stickZone')!;
  const base = document.getElementById('stickBase')!;
  const knob = document.getElementById('stickKnob')!;

  // iOS: kein Pinch-Zoom, kein Scrollen/Kontextmenü auf den Tasten. Doppeltipp-Zoom verhindert
  // touch-action (CSS), damit schnelle Doppeltipps für den Dash ankommen.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false } as AddEventListenerOptions);
  }
  root.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  root.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  // Stick
  let stickId: number | null = null;
  let ox = 0;
  let oy = 0;
  const moveStick = (x: number, y: number) => {
    let dx = x - ox;
    let dy = y - oy;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) {
      // Stick wandert mit, wenn der Daumen weiter rutscht
      ox += (dx / len) * (len - RADIUS);
      oy += (dy / len) * (len - RADIUS);
      dx = x - ox;
      dy = y - oy;
      base.style.transform = `translate(${ox}px, ${oy}px)`;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    let bits = 0;
    if (dx > DEAD_X) bits |= INPUT.RIGHT;
    if (dx < -DEAD_X) bits |= INPUT.LEFT;
    if (dy < -DEAD_UP) bits |= INPUT.UP;
    if (dy > DEAD_DOWN) bits |= INPUT.DOWN;
    setStick(bits);
  };
  // Ruheposition des Sticks: Mitte der linken Hälfte
  const restStick = () => {
    const r = zone.getBoundingClientRect();
    base.style.transform = `translate(${Math.round(r.width / 2)}px, ${Math.round(r.height * 0.55)}px)`;
  };
  new ResizeObserver(restStick).observe(zone);
  const local = (e: PointerEvent) => {
    const r = zone.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  zone.addEventListener('pointerdown', (e) => {
    if (stickId !== null) return;
    stickId = e.pointerId;
    try {
      zone.setPointerCapture(e.pointerId);
    } catch {
      // synthetische Events ohne aktiven Pointer
    }
    [ox, oy] = local(e);
    base.style.transform = `translate(${ox}px, ${oy}px)`;
    knob.style.transform = 'translate(0px, 0px)';
    base.classList.add('active');
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickId) return;
    const [x, y] = local(e);
    moveStick(x, y);
  });
  const endStick = (e: PointerEvent) => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    setStick(0);
    knob.style.transform = 'translate(0px, 0px)';
    base.classList.remove('active');
    restStick();
  };
  zone.addEventListener('pointerup', endStick);
  zone.addEventListener('pointercancel', endStick);

  // Angriffstasten
  root.querySelectorAll<HTMLElement>('[data-bits]').forEach((btn) => {
    const bits = Number(btn.dataset.bits);
    btn.addEventListener('pointerdown', (e) => {
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        // s. o.
      }
      buttonsDown.set(e.pointerId, bits);
      btn.classList.add('down');
      refreshButtons();
      navigator.vibrate?.(8);
    });
    const up = (e: PointerEvent) => {
      if (!buttonsDown.delete(e.pointerId)) return;
      btn.classList.remove('down');
      refreshButtons();
    };
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
  });

  document.getElementById('touchPause')!.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    onPause();
  });

  // App im Hintergrund: nichts festhalten
  document.addEventListener('visibilitychange', () => {
    buttonsDown.clear();
    refreshButtons();
    setStick(0);
    latched = 0;
  });
}
