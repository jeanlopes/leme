import { describe, expect, test } from 'bun:test';
import { repoDoRemoto, resumirCI } from '../src/github';

describe('repoDoRemoto', () => {
  test.each([
    ['git@github.com:Batuvia/backoffice.git', 'Batuvia/backoffice'],
    ['https://github.com/Batuvia/batuvia', 'Batuvia/batuvia'],
    ['https://github.com/Batuvia/batuvia.git\n', 'Batuvia/batuvia'],
    ['ssh://git@github.com/dono/repo.com.br.git', 'dono/repo.com.br'],
  ])('%s', (url, esperado) => expect(repoDoRemoto(url)).toBe(esperado));

  test('fora do GitHub ou sem remoto: null', () => {
    expect(repoDoRemoto('git@gitlab.com:dono/repo.git')).toBeNull();
    expect(repoDoRemoto(null)).toBeNull();
  });
});

describe('resumirCI', () => {
  const run = (workflowName: string, createdAt: string, conclusion: string, status = 'completed') => ({ workflowName, createdAt, conclusion, status, url: `u/${workflowName}/${createdAt}` });

  test('sem execuções: nenhum', () => {
    expect(resumirCI([])).toEqual({ situacao: 'nenhum', quando: null, execucoes: [] });
  });

  test('fica a última de cada workflow; um Release verde não esconde o CI vermelho', () => {
    const r = resumirCI([
      run('Release', '2026-09-27T01:53:25Z', 'success'),
      run('CI', '2026-09-27T01:53:25Z', 'failure'),
      run('CI', '2026-09-26T10:00:00Z', 'success'),
    ]);
    expect(r.situacao).toBe('falhou');
    expect(r.execucoes.map((e) => [e.workflow, e.situacao])).toEqual([
      ['Release', 'ok'],
      ['CI', 'falhou'],
    ]);
  });

  test('uma execução em andamento manda na situação', () => {
    expect(resumirCI([run('CI', '2026-09-27T12:00:00Z', '', 'in_progress'), run('Lint', '2026-09-27T11:00:00Z', 'failure')]).situacao).toBe('rodando');
  });

  test('cancelada não conta como falha; pulada conta como ok', () => {
    expect(resumirCI([run('CI', '2026-09-27T12:00:00Z', 'cancelled')]).situacao).toBe('cancelado');
    expect(resumirCI([run('CI', '2026-09-27T12:00:00Z', 'skipped')]).situacao).toBe('ok');
  });
});
