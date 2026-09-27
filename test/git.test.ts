import { describe, expect, test } from 'bun:test';
import { lerCommits, lerStatus } from '../src/git';

describe('lerStatus (git status --porcelain=v2 --branch)', () => {
  test('branch com remoto, à frente e atrás, e cada tipo de alteração', () => {
    const s = lerStatus(
      [
        '# branch.oid 1234',
        '# branch.head plano-021',
        '# branch.upstream origin/plano-021',
        '# branch.ab +2 -5',
        '1 M. N... 100644 100644 100644 aaa bbb src/preparado.ts',
        '1 .M N... 100644 100644 100644 aaa aaa src/não preparado com espaço.ts',
        '1 MM N... 100644 100644 100644 aaa bbb src/os dois.ts',
        '2 R. N... 100644 100644 100644 aaa bbb R100 src/novo-nome.ts\tsrc/nome-antigo.ts',
        'u UU N... 100644 100644 100644 100644 a b c src/conflito.ts',
        '? rascunho.md',
      ].join('\n'),
    );
    expect(s.branch).toBe('plano-021');
    expect(s.upstream).toBe('origin/plano-021');
    expect([s.frente, s.atras]).toEqual([2, 5]);
    expect(s.preparados.map((a) => a.caminho)).toEqual(['src/preparado.ts', 'src/os dois.ts', 'src/novo-nome.ts']);
    expect(s.naoPreparados.map((a) => a.caminho)).toEqual(['src/não preparado com espaço.ts', 'src/os dois.ts']);
    expect(s.preparados[2]!.codigo).toBe('R');
    expect(s.conflitos.map((a) => a.caminho)).toEqual(['src/conflito.ts']);
    expect(s.novos.map((a) => a.caminho)).toEqual(['rascunho.md']);
  });

  test('sem branch remota: à frente/atrás ficam null, não zero', () => {
    const s = lerStatus('# branch.oid 1234\r\n# branch.head nova\r\n');
    expect(s.branch).toBe('nova');
    expect(s.upstream).toBeNull();
    expect(s.frente).toBeNull();
    expect(s.atras).toBeNull();
  });

  test('HEAD solto vira branch null', () => {
    expect(lerStatus('# branch.head (detached)').branch).toBeNull();
  });
});

test('lerCommits separa hash, data e assunto (assunto pode ter TAB)', () => {
  expect(lerCommits('abc1234\t2026-09-27T01:53:39Z\tfeat: coisa\tcom tab\n\n')).toEqual([
    { hash: 'abc1234', quando: '2026-09-27T01:53:39Z', assunto: 'feat: coisa\tcom tab' },
  ]);
});
