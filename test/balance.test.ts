import { describe, expect, it } from 'vitest';
import { CHARACTERS, type MoveKey, getCharacter } from '../src/shared/characters';
import { COMBO_LIMIT, type GameState, INPUT, createGame, step } from '../src/shared/game';

function fightReady(a: string, b: string): GameState {
  const s = createGame(a, b);
  while (s.phase !== 'fight') step(s, [0, 0]);
  s.fighters[0].x = -0.5;
  s.fighters[1].x = 0.5;
  return s;
}

const IDS = CHARACTERS.map((c) => c.id);
const free = (s: GameState, i: 0 | 1) => ['idle', 'walk', 'crouch', 'attack', 'jump', 'dash', 'backdash'].includes(s.fighters[i].status);

/** Eingaben für den Start eines Moves (Spieler 1 schaut nach rechts). */
const START: Partial<Record<MoveKey, number>> = {
  light: INPUT.LIGHT,
  heavy: INPUT.HEAVY,
  kick: INPUT.KICK,
  lowLight: INPUT.DOWN | INPUT.LIGHT,
  fwdLight: INPUT.RIGHT | INPUT.LIGHT,
};
const BUTTON: Record<string, number> = { light: INPUT.LIGHT, heavy: INPUT.HEAVY, kick: INPUT.KICK };

/** Aggressiver Spieler: läuft heran, sobald er außer Reichweite ist, und hämmert sonst dieselbe Taste. */
function aggressor(s: GameState, bits: number, t: number) {
  const [a, b] = s.fighters;
  if (a.status !== 'attack' && b.x - a.x > 1.15) return INPUT.RIGHT;
  return t % 2 ? bits : bits & (INPUT.DOWN | INPUT.RIGHT);
}

describe('Kein Stunlock', () => {
  // Angreifer hämmert dieselbe Taste so schnell es geht, der Verteidiger drückt ebenfalls nur wild Leicht.
  // Der Verteidiger muss irgendwann dazwischenkommen.
  const spam: [string, number][] = [
    ['Leicht', INPUT.LIGHT],
    ['Tritt', INPUT.KICK],
    ['Schwer', INPUT.HEAVY],
    ['↓ Leicht', INPUT.DOWN | INPUT.LIGHT],
    ['→ Leicht', INPUT.RIGHT | INPUT.LIGHT],
  ];
  for (const atk of IDS) {
    for (const [label, bits] of spam) {
      it(`${atk}: ${label}-Dauerfeuer lässt sich unterbrechen`, () => {
        for (const def of IDS) {
          const s = fightReady(atk, def);
          let defenderHits = 0;
          const mash = bits & INPUT.DOWN ? INPUT.DOWN | INPUT.LIGHT : INPUT.LIGHT;
          for (let t = 0; t < 600 && s.phase === 'fight'; t++) {
            // Verteidiger hämmert ebenfalls – blockt aber, wenn ein Angriff sichtbar anläuft (Panzerung schlägt reines Hämmern)
            const a = s.fighters[0];
            const windup = a.status === 'attack' && a.move && a.statusTime < getCharacter(atk).moves[a.move].startup && getCharacter(atk).moves[a.move].armor;
            step(s, [aggressor(s, bits, t), windup ? INPUT.RIGHT | (bits & INPUT.DOWN) : t % 2 ? 0 : mash]);
            defenderHits += s.events.filter((e) => e.type === 'hit' && e.target === 0).length;
            expect(s.fighters[1].heat).toBeLessThanOrEqual(COMBO_LIMIT);
          }
          expect(defenderHits, `${atk} vs ${def}`).toBeGreaterThan(0);
        }
      });
    }
  }

  it('wer nichts tut, bekommt trotzdem regelmäßig Luft (Combo-Limit, Hitstun-Decay)', () => {
    for (const atk of IDS) {
      for (const [, bits] of spam) {
        const s = fightReady(atk, 'gerd');
        let stunnedStreak = 0;
        let worst = 0;
        for (let t = 0; t < 600 && s.phase === 'fight'; t++) {
          // nichts tun heißt: nicht angreifen, nicht blocken – nur am Boden aufrappeln
          step(s, [aggressor(s, bits, t), s.fighters[1].status === 'down' ? INPUT.UP : 0]);
          stunnedStreak = free(s, 1) ? 0 : stunnedStreak + 1;
          worst = Math.max(worst, stunnedStreak);
        }
        // nie länger als 2,5 Sekunden am Stück wehrlos (inkl. Hitstop, Knockdown und Aufstehen)
        expect(worst, `${atk} ${bits}`).toBeLessThan(150);
      }
    }
  });

  it('nach dem Aufstehen ist man kurz unverwundbar (kein Knockdown-Loop)', () => {
    const s = fightReady('gerd', 'piet');
    s.fighters[1].status = 'getup';
    s.fighters[1].statusTime = 19;
    step(s, [0, 0]);
    expect(s.fighters[1].status).toBe('idle');
    s.fighters[0].x = s.fighters[1].x - 0.8;
    const hp = s.fighters[1].hp;
    step(s, [INPUT.LIGHT, 0]);
    for (let i = 0; i < 8; i++) step(s, [0, 0]);
    expect(s.fighters[1].hp).toBe(hp);
  });

  it('Würfe greifen nicht im Blockstun und gleichzeitige Würfe lösen sich', () => {
    const s = fightReady('piet', 'piet');
    s.fighters[1].status = 'blockstun';
    s.fighters[1].stun = 20;
    s.fighters[1].statusTime = 0;
    step(s, [INPUT.LIGHT | INPUT.KICK, 0]);
    for (let i = 0; i < 8; i++) step(s, [0, 0]);
    expect(s.fighters[1].hp).toBe(1000);

    const t = fightReady('piet', 'piet');
    let tech = false;
    step(t, [INPUT.LIGHT | INPUT.KICK, INPUT.LIGHT | INPUT.KICK]);
    for (let i = 0; i < 10; i++) {
      step(t, [0, 0]);
      if (t.events.some((e) => e.type === 'tech')) tech = true;
    }
    expect(tech).toBe(true);
    expect(t.fighters[0].hp + t.fighters[1].hp).toBe(2000);
  });
});

describe('Eigene Moves und Kombos', () => {
  it('jeder Kämpfer hat eigene Signatur-Moves und einen eigenen Kombo-Abschluss', () => {
    const names = new Set<string>();
    for (const c of CHARACTERS) {
      for (const k of ['sig1', 'sig2', 'ender'] as const) {
        expect(names.has(c.moves[k].name), c.moves[k].name).toBe(false);
        names.add(c.moves[k].name);
      }
      expect(c.combos.length).toBeGreaterThanOrEqual(3);
      // der Abschluss ist über eine eigene Kette erreichbar
      expect(Object.values(c.chains).some((r) => Object.values(r ?? {}).includes('ender'))).toBe(true);
    }
  });

  for (const c of CHARACTERS) {
    it(`${c.id}: eigene Kombo trifft komplett`, () => {
      const route = c.combos[0].moves;
      const s = fightReady(c.id, 'ludger');
      const hits: MoveKey[] = [];
      let idx = 0;
      let next: number = START[route[0]]!;
      for (let t = 0; t < 240; t++) {
        let bits = 0;
        if (next) {
          bits = next;
          next = 0;
        }
        step(s, [bits, 0]);
        for (const e of s.events) if (e.type === 'hit' && e.target === 1 && s.fighters[0].hitCount === 1) hits.push(e.move);
        // nächste Taste kurz nach dem Treffer des aktuellen Moves (wie ein Spieler)
        if (s.fighters[0].move === route[idx] && s.events.some((e) => e.type === 'hit') && idx + 1 < route.length) {
          idx += 1;
          const routes = c.chains[route[idx - 1]] ?? {};
          const btn = Object.entries(routes).find(([, k]) => k === route[idx])![0];
          next = BUTTON[btn];
        }
      }
      expect(hits).toEqual(route);
    });
  }

  it('Konterhaltung fängt einen Schlag ab, tiefe Angriffe gehen durch', () => {
    const s = fightReady('piet', 'ingrid');
    step(s, [0, INPUT.DOWN | INPUT.SPECIAL]);
    for (let i = 0; i < 4; i++) step(s, [0, INPUT.DOWN]);
    step(s, [INPUT.HEAVY, 0]);
    let parried = false;
    for (let i = 0; i < 20; i++) {
      step(s, [0, 0]);
      if (s.events.some((e) => e.type === 'parry')) parried = true;
    }
    expect(parried).toBe(true);
    expect(s.fighters[1].hp).toBe(getCharacter('ingrid').maxHp);
    expect(s.fighters[0].status).toBe('hitstun');
  });

  it('Gerds Hydraulik-Panzer übersteht einen Jab und trifft trotzdem', () => {
    const s = fightReady('kim', 'gerd');
    step(s, [0, INPUT.RIGHT | INPUT.SPECIAL]);
    expect(s.fighters[1].move).toBe('sig2');
    for (let i = 0; i < 6; i++) step(s, [0, 0]);
    step(s, [INPUT.LIGHT, 0]);
    let armor = false;
    let hitKim = false;
    for (let i = 0; i < 40; i++) {
      step(s, [0, 0]);
      if (s.events.some((e) => e.type === 'armor')) armor = true;
      if (s.events.some((e) => e.type === 'hit' && e.target === 0)) hitKim = true;
    }
    expect(armor).toBe(true);
    expect(hitKim).toBe(true);
  });

  it('Uppercut mit Unverwundbarkeit schlägt Sprungangriffe', () => {
    const s = fightReady('kim', 'lena');
    s.fighters[0].x = -1.6;
    step(s, [INPUT.UP | INPUT.RIGHT, 0]);
    let t = 0;
    while (s.fighters[0].vy > -0.02 && t++ < 60) step(s, [0, 0]);
    step(s, [INPUT.KICK, INPUT.DOWN | INPUT.SPECIAL]);
    let lenaHit = false;
    for (let i = 0; i < 40; i++) {
      step(s, [0, 0]);
      if (s.events.some((e) => e.type === 'hit' && e.target === 1)) lenaHit = true;
    }
    expect(lenaHit).toBe(false);
    expect(s.fighters[0].hp).toBeLessThan(getCharacter('kim').maxHp);
  });

  it('Mehrfachtreffer zählen einzeln', () => {
    const s = fightReady('paul', 'gerd');
    step(s, [INPUT.LEFT | INPUT.SPECIAL, 0]);
    expect(s.fighters[0].move).toBe('sig2');
    let hits = 0;
    for (let i = 0; i < 60; i++) {
      step(s, [0, 0]);
      hits += s.events.filter((e) => e.type === 'hit').length;
    }
    expect(hits).toBe(5);
  });
});
