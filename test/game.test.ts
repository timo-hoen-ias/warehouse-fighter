import { describe, expect, it } from 'vitest';
import { getCharacter } from '../src/shared/characters';
import { type GameState, INPUT, createGame, step } from '../src/shared/game';

function fightReady(a = 'piet', b = 'piet'): GameState {
  const s = createGame(a, b);
  while (s.phase !== 'fight') step(s, [0, 0]);
  return s;
}

function run(s: GameState, ticks: number, inputs: [number, number] = [0, 0]) {
  for (let i = 0; i < ticks; i++) step(s, inputs);
}

function placeClose(s: GameState) {
  s.fighters[0].x = -0.5;
  s.fighters[1].x = 0.5;
}

describe('Simulation', () => {
  it('startet nach dem Intro die Runde', () => {
    const s = fightReady();
    expect(s.phase).toBe('fight');
    expect(s.fighters.map((f) => f.hp)).toEqual([1000, 1000]);
  });

  it('leichter Schlag trifft und verursacht Schaden', () => {
    const s = fightReady();
    placeClose(s);
    step(s, [INPUT.LIGHT, 0]);
    run(s, 10);
    expect(s.fighters[1].hp).toBe(1000 - getCharacter('piet').moves.light.damage);
  });

  it('Blocken reduziert den Schaden auf Chip-Schaden', () => {
    const s = fightReady();
    placeClose(s);
    // Spieler 2 schaut nach links, "zurück" ist also rechts
    step(s, [INPUT.LIGHT, INPUT.RIGHT]);
    run(s, 10, [0, INPUT.RIGHT]);
    expect(s.fighters[1].hp).toBe(1000 - Math.round(getCharacter('piet').moves.light.damage * 0.1));
  });

  it('Tiefschlag geht durch einen stehenden Block', () => {
    const s = fightReady();
    placeClose(s);
    step(s, [INPUT.DOWN | INPUT.HEAVY, INPUT.RIGHT]);
    run(s, 20, [INPUT.DOWN, INPUT.RIGHT]);
    expect(s.fighters[1].hp).toBe(1000 - getCharacter('piet').moves.low.damage);
  });

  it('Tiefschlag wird geduckt geblockt', () => {
    const s = fightReady();
    placeClose(s);
    step(s, [INPUT.DOWN | INPUT.HEAVY, INPUT.RIGHT | INPUT.DOWN]);
    run(s, 20, [INPUT.DOWN, INPUT.RIGHT | INPUT.DOWN]);
    expect(s.fighters[1].hp).toBeGreaterThan(990);
  });

  it('Projektil fliegt und trifft auf Distanz', () => {
    const s = fightReady('kim', 'gerd');
    step(s, [INPUT.SPECIAL, 0]);
    expect(s.fighters[0].move).toBe('special');
    run(s, 60);
    expect(s.fighters[1].hp).toBe(getCharacter('gerd').maxHp - getCharacter('kim').moves.special.damage);
  });

  it('Kämpfer können sich nicht durchdringen und bleiben in der Arena', () => {
    const s = fightReady();
    run(s, 300, [INPUT.RIGHT, INPUT.LEFT]);
    expect(s.fighters[1].x - s.fighters[0].x).toBeGreaterThanOrEqual(0.69);
    run(s, 600, [INPUT.LEFT, INPUT.RIGHT]);
    expect(Math.abs(s.fighters[0].x)).toBeLessThanOrEqual(7);
    expect(s.fighters[1].x - s.fighters[0].x).toBeLessThanOrEqual(9.0001);
  });

  it('Match endet nach zwei gewonnenen Runden', () => {
    const s = fightReady();
    placeClose(s);
    let guard = 0;
    while (s.phase !== 'matchEnd' && guard++ < 20000) {
      if (s.phase === 'fight') {
        s.fighters[0].x = s.fighters[1].x - 0.8;
      }
      step(s, [s.tick % 20 === 0 ? INPUT.HEAVY : 0, 0]);
    }
    expect(s.phase).toBe('matchEnd');
    expect(s.matchWinner).toBe(0);
    expect(s.fighters[0].wins).toBe(2);
  });

  it('Zeitablauf entscheidet nach verbleibender Energie', () => {
    const s = fightReady();
    s.fighters[1].hp = 500;
    s.timer = 1;
    step(s, [0, 0]);
    expect(s.phase).toBe('roundEnd');
    expect(s.roundWinner).toBe(0);
  });

  it('State ist JSON-serialisierbar (für Online-Snapshots)', () => {
    const s = fightReady();
    placeClose(s);
    step(s, [INPUT.LIGHT, 0]);
    run(s, 8);
    const copy = JSON.parse(JSON.stringify(s)) as GameState;
    run(copy, 30);
    run(s, 30);
    expect(copy.fighters).toEqual(s.fighters);
  });
});
