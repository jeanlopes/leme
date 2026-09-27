import { expect, test } from 'bun:test';
import { Terminal as Xterm } from '@xterm/headless';
import { linhasDoXterm } from '../src/desenho';
import { ajustar, cortar, haQuanto, largura } from '../src/tela';

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

test('cortar e ajustar contam só o visível e não quebram a cor', () => {
  const t = '\x1b[32mverde\x1b[0m e mais';
  expect(largura(t)).toBe(12);
  expect(largura(cortar(t, 7))).toBe(7);
  expect(cortar(t, 7).endsWith('…\x1b[0m')).toBe(true);
  expect(largura(ajustar('ab', 5))).toBe(5);
  expect(ajustar(t, 30)).toBe(t + ' '.repeat(18));
});

test('linhasDoXterm: a tela do processo vira linhas do tamanho do painel, com cor', async () => {
  const xt = new Xterm({ cols: 20, rows: 3, allowProposedApi: true });
  await new Promise<void>((ok) => xt.write('um\r\n\x1b[31mdois\x1b[0m\r\ntrês\r\nquatro', ok));
  const linhas = linhasDoXterm(xt, 10, 3, 0);
  expect(linhas.map((l) => largura(l))).toEqual([10, 10, 10]);
  expect(linhas.map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trimEnd())).toEqual(['dois', 'três', 'quatro']);
  expect(linhas[0]).toContain('\x1b[31m'); // vermelho preservado
  // rolando uma linha para cima aparece o "um"
  expect(linhasDoXterm(xt, 10, 3, 1)[0]!.replace(/\x1b\[[0-9;]*m/g, '').trimEnd()).toBe('um');
});
