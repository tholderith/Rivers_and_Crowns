// Balance report: AI plays both sides many times from both ends of the field.
// Run with:  BALANCE=1 npx vitest run tests/balance.test.ts
import { describe, it } from 'vitest';
import { act, begin, createBattle, alive, unitOf } from '../src/sim/battle';
import { chooseAbility, chooseAction } from '../src/sim/ai';

describe.skipIf(!process.env.BALANCE)('balance', () => {
  it('reports win rates', () => {
    const wins: Record<string, number> = { french: 0, haudenosaunee: 0, draw: 0 };
    let rounds = 0;
    const survivors: Record<string, number> = {};
    const N = Number(process.env.BALANCE_N ?? 200);
    for (let i = 0; i < N; i++) {
      const flip = i % 2 === 1;
      const st = createBattle('forest-edge', 1000 + i, flip ? 'haudenosaunee' : 'french', flip ? 'french' : 'haudenosaunee');
      const scale = Number(process.env.FR_SCALE ?? 1);
      for (const s of st.stacks) if (st.sides[s.side].faction === 'french') { s.count = Math.round(s.count * scale); s.startCount = s.count; }
      begin(st);
      for (let n = 0; n < 3000 && st.winner === null; n++) {
        const ab = chooseAbility(st);
        if (ab) act(st, ab);
        act(st, chooseAction(st));
      }
      rounds += st.round;
      const w = st.winner === 'draw' || st.winner === null ? 'draw' : st.sides[st.winner].faction;
      wins[w]++;
      for (const s of alive(st)) survivors[unitOf(s).name] = (survivors[unitOf(s).name] ?? 0) + s.count / s.startCount;
    }
    console.log('wins', wins, 'avg rounds', (rounds / N).toFixed(1));
    console.log('avg surviving share by unit', Object.fromEntries(Object.entries(survivors).map(([k, v]) => [k, (v / N).toFixed(2)])));
  });
});
