import { expect, test } from 'bun:test';
import { haQuanto } from '../src/tela';

test('haQuanto', () => {
  const agora = Date.parse('2026-09-27T12:00:00Z');
  expect(haQuanto(null, agora)).toBe('nunca');
  expect(haQuanto('2026-09-27T11:59:30Z', agora)).toBe('agora');
  expect(haQuanto('2026-09-27T11:55:00Z', agora)).toBe('há 5 min');
  expect(haQuanto('2026-09-27T01:00:00Z', agora)).toBe('há 11 h');
  expect(haQuanto('2026-09-26T11:00:00Z', agora)).toBe('há 1 dia');
  expect(haQuanto('2026-09-20T12:00:00Z', agora)).toBe('há 7 dias');
  expect(haQuanto('2026-05-01T12:00:00Z', agora)).toBe('há 4 meses');
  expect(haQuanto(agora + 5000, agora)).toBe('agora'); // relógio adiantado não vira "há -1 min"
});
