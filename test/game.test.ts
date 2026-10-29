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

  it('Fernangriff lässt sich nicht spammen (Abklingzeit, schwächer als Nahkampf)', () => {
    const s = fightReady('ingrid', 'gerd');
    let shots = 0;
    // 3 Sekunden lang Spezial im Dauerfeuer
    for (let i = 0; i < 180; i++) {
      step(s, [i % 2 ? INPUT.SPECIAL : 0, 0]);
      shots += s.events.filter((e) => e.type === 'projectile').length;
    }
    expect(shots).toBeLessThanOrEqual(2);
    for (const c of ['gerd', 'kim', 'piet', 'lena', 'ludger', 'paul', 'ingrid', 'kalle', 'rita', 'robo']) {
      const m = getCharacter(c).moves;
      expect(m.special.damage).toBeLessThan(m.heavy.damage);
    }
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

describe('Finisher', () => {
  it('KO startet Zeitlupe und wählt einen Finisher', () => {
    const s = fightReady();
    s.fighters[1].hp = 1;
    placeClose(s);
    step(s, [INPUT.LIGHT, 0]);
    let ko = false;
    for (let i = 0; i < 12 && !ko; i++) {
      step(s, [0, 0]);
      ko = s.phase === 'roundEnd';
    }
    expect(ko).toBe(true);
    expect(s.finisher?.loser).toBe(1);
    expect(['head', 'arm', 'wall']).toContain(s.finisher?.kind);
    expect(s.slowmo).toBeGreaterThan(0);
    // In der Zeitlupe läuft die Simulation nur mit einem Viertel der Geschwindigkeit
    const before = s.phaseTime;
    run(s, 40);
    expect(s.phaseTime - before).toBe(10);
  });

  it('neue Runde setzt Zeitlupe und Finisher zurück', () => {
    const s = fightReady();
    s.fighters[1].hp = 0;
    step(s, [0, 0]);
    expect(s.finisher).not.toBeNull();
    let guard = 0;
    while (s.phase !== 'intro' && guard++ < 2000) step(s, [0, 0]);
    expect(s.round).toBe(2);
    expect(s.finisher).toBeNull();
    expect(s.slowmo).toBe(0);
  });
});

describe('Tekken-System', () => {
  function press(s: GameState, bits: number, holdTicks: number, p2 = 0) {
    step(s, [bits, p2]);
    run(s, holdTicks, [0, p2]);
  }

  it('Kette Leicht, Leicht, Schwer trifft dreimal', () => {
    const s = fightReady();
    placeClose(s);
    const hits: number[] = [];
    const record = () => s.events.forEach((e) => e.type === 'hit' && hits.push(e.combo));
    for (const bits of [INPUT.LIGHT, INPUT.LIGHT, INPUT.HEAVY]) {
      step(s, [bits, 0]);
      record();
      for (let i = 0; i < 9; i++) {
        step(s, [0, 0]);
        record();
      }
    }
    run(s, 20);
    expect(hits).toEqual([1, 2, 3]);
    expect(s.fighters[0].move === 'finisher' || hits.length === 3).toBe(true);
  });

  it('Launcher schleudert hoch, Juggle-Treffer, Landung im Knockdown', () => {
    const s = fightReady();
    placeClose(s);
    // Spieler 1 schaut nach rechts: zurück = links
    press(s, INPUT.LEFT | INPUT.HEAVY, 0);
    let launched = false;
    for (let i = 0; i < 20; i++) {
      step(s, [0, 0]);
      if (s.fighters[1].y > 0.3) launched = true;
    }
    expect(launched).toBe(true);
    // warten, bis der Angreifer frei ist und der Gegner herunterfällt
    let guard = 0;
    while ((s.fighters[0].status !== 'idle' || s.fighters[1].y > 1.6 || s.fighters[1].vy > 0) && guard++ < 200) step(s, [0, 0]);
    s.fighters[0].x = s.fighters[1].x - 0.8;
    step(s, [INPUT.LIGHT, 0]);
    let juggled = s.events.some((e) => e.type === 'hit' && e.combo === 2);
    let down = false;
    for (let i = 0; i < 80; i++) {
      step(s, [0, 0]);
      if (s.events.some((e) => e.type === 'hit' && e.combo === 2)) juggled = true;
      if (s.fighters[1].status === 'down') down = true;
    }
    expect(juggled).toBe(true);
    expect(down).toBe(true);
  });

  it('Wurf geht durch den Block und wirft zu Boden', () => {
    const s = fightReady();
    placeClose(s);
    step(s, [INPUT.LIGHT | INPUT.KICK, INPUT.RIGHT]);
    expect(s.fighters[0].move).toBe('throw');
    let down = false;
    for (let i = 0; i < 80; i++) {
      step(s, [0, INPUT.RIGHT]);
      if (s.fighters[1].status === 'down') down = true;
    }
    expect(down).toBe(true);
    expect(s.fighters[1].hp).toBe(1000 - getCharacter('piet').moves.throw.damage);
  });

  it('Am Boden ist man unverwundbar und steht wieder auf', () => {
    const s = fightReady();
    placeClose(s);
    press(s, INPUT.DOWN | INPUT.HEAVY, 0, 0);
    let guard = 0;
    while (s.fighters[1].status !== 'down' && guard++ < 80) step(s, [INPUT.DOWN, 0]);
    expect(s.fighters[1].status).toBe('down');
    const hp = s.fighters[1].hp;
    s.fighters[0].x = s.fighters[1].x - 0.8;
    step(s, [INPUT.LIGHT, 0]);
    run(s, 10);
    expect(s.fighters[1].hp).toBe(hp);
    run(s, 80);
    expect(s.fighters[1].status).toBe('idle');
  });

  it('Doppeltipp vorwärts startet einen Dash', () => {
    const s = fightReady();
    step(s, [INPUT.RIGHT, 0]);
    run(s, 3);
    step(s, [INPUT.RIGHT, 0]);
    expect(s.fighters[0].status).toBe('dash');
    expect(s.fighters[0].vx).toBeGreaterThan(0.1);
  });

  it('jeder Kämpfer hat die komplette Moveliste', () => {
    for (const id of ['gerd', 'kim', 'piet', 'lena', 'ludger', 'paul', 'ingrid', 'kalle', 'rita', 'robo']) {
      const moves = getCharacter(id).moves;
      expect(Object.keys(moves).length).toBe(18);
      for (const m of Object.values(moves)) {
        expect(m.name.length).toBeGreaterThan(2);
        expect(m.startup).toBeGreaterThan(0);
      }
    }
  });
});
