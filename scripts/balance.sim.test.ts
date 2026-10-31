// Balance-Simulation: CPU gegen CPU, jede Paarung mehrfach, feste Zufallssaat.
// Aufruf: npm run balance (läuft nicht in npm test)
import { it } from 'vitest';
import { CHARACTERS } from '../src/shared/characters';
import { createGame, step } from '../src/shared/game';
import { CpuController } from '../src/client/ai';

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

it('balance', () => {
  const ids = CHARACTERS.map((c) => c.id);
  const games = Number(process.env.GAMES ?? 6);
  const wins: Record<string, number> = Object.fromEntries(ids.map((i) => [i, 0]));
  const played: Record<string, number> = Object.fromEntries(ids.map((i) => [i, 0]));
  const matrix: Record<string, Record<string, number>> = {};
  let maxCombo = 0;
  const dmgBy: Record<string, Record<string, number>> = {};
  const taken: Record<string, number> = {};
  const dealt: Record<string, number> = {};
  let longestStun = 0;
  for (const a of ids) {
    matrix[a] = {};
    for (const b of ids) {
      if (a === b) continue;
      let w = 0;
      for (let g = 0; g < games; g++) {
        Math.random = seeded(1000 + g * 31 + ids.indexOf(a) * 7 + ids.indexOf(b));
        const s = createGame(a, b);
        const cpus = [new CpuController(0, 0.75), new CpuController(1, 0.75)];
        let streak = [0, 0];
        for (let t = 0; t < 30000 && s.phase !== 'matchEnd'; t++) {
          step(s, [cpus[0].next(s), cpus[1].next(s)]);
          for (const e of s.events) if (e.type === 'hit') {
            const who = s.fighters[e.target === 0 ? 1 : 0].char;
            dmgBy[who] ??= {};
            dmgBy[who][e.move] = (dmgBy[who][e.move] ?? 0) + e.damage;
            const vic = s.fighters[e.target].char;
            taken[vic] = (taken[vic] ?? 0) + e.damage;
            dealt[who] = (dealt[who] ?? 0) + e.damage;
          }
          s.fighters.forEach((f, i) => {
            maxCombo = Math.max(maxCombo, f.combo);
            const stunned = f.status === 'hitstun' || f.status === 'blockstun';
            streak[i] = stunned ? streak[i] + 1 : 0;
            longestStun = Math.max(longestStun, streak[i]);
          });
        }
        if (s.matchWinner === 0) w++;
        if (s.matchWinner === 0) wins[a]++;
        if (s.matchWinner === 1) wins[b]++;
        played[a]++;
        played[b]++;
      }
      matrix[a][b] = w / games;
    }
  }
  const rows = ids.map((i) => `${i.padEnd(7)} ${((wins[i] / played[i]) * 100).toFixed(0).padStart(3)} %   Schaden ausgeteilt/erlitten pro Match ${Math.round(dealt[i] / played[i])}/${Math.round(taken[i] / played[i])}`).join('\n');
  if (process.env.DETAIL) for (const [c, m] of Object.entries(dmgBy)) console.log(c, Object.entries(m).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => `${k}:${Math.round(v / games)}`).join(' '));
  console.log(`Siegquote (CPU vs CPU, ${games} Spiele je Paarung und Seite):\n${rows}\nlängste Kombo: ${maxCombo}, längster Stun am Stück: ${longestStun} Ticks`);
});
