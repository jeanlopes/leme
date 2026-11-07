import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acharAlvo, comFila, conferirMigracoes, ehBancoLocal, interpretar, pulaConferencia } from '../src/migracoes';

const base = mkdtempSync(join(tmpdir(), 'leme-mig-'));
afterAll(() => rmSync(base, { recursive: true, force: true }));
const escrever = (caminho: string, conteudo: string) => {
  mkdirSync(join(caminho, '..'), { recursive: true });
  writeFileSync(caminho, conteudo);
};

describe('interpretar (resposta do db:pendentes --json)', () => {
  test('em dia', () => {
    expect(interpretar({ codigo: 0, saida: '{"banco":"localhost:3306/b","codigo":0,"estado":"em-dia"}\n', erro: '' })).toEqual({ tipo: 'em-dia', banco: 'localhost:3306/b' });
  });
  test('pendente, ignorando as linhas de ruído do gerenciador antes do JSON', () => {
    const saida = '$ bun scripts/x.ts --json\n{"banco":"localhost:3306/b","codigo":2,"estado":"pendente","pendentes":["0047_a","0048_b"],"total":49}\n';
    expect(interpretar({ codigo: 2, saida, erro: '' })).toEqual({ tipo: 'pendente', banco: 'localhost:3306/b', pendentes: ['0047_a', '0048_b'] });
  });
  test('banco inacessível', () => {
    expect(interpretar({ codigo: 3, saida: '{"banco":"x:1/b","estado":"inacessivel","causa":"ECONNREFUSED"}', erro: '' })).toEqual({ tipo: 'inacessivel', banco: 'x:1/b', causa: 'ECONNREFUSED' });
  });
  test('sem JSON: vira erro com a última linha do stderr', () => {
    expect(interpretar({ codigo: 1, saida: '', erro: 'boom\nScript not found "db:pendentes"' })).toEqual({ tipo: 'erro', causa: 'Script not found "db:pendentes"' });
  });
  test('JSON quebrado não derruba o leme', () => {
    expect(interpretar({ codigo: 0, saida: '{nao e json', erro: '' }).tipo).toBe('erro');
  });
});

test.each([
  ['dev', '', false],
  ['dev:tudo', '', false],
  ['dev:teste', '', true],
  ['teste', '', true],
  ['dev:tudo', '--teste', true],
  ['dev:tudo', '--x --teste', true],
  ['api:dev', '--testemunha', false],
  ['dev:multi', '', false],
])('pulaConferencia(%s, "%s") = %s', (script, args, esperado) => expect(pulaConferencia(script, args)).toBe(esperado));

test.each([
  ['localhost:3306/batuvia', true],
  ['127.0.0.1:3307/batuvia_test', true],
  ['host.docker.internal:3306/x', true],
  ['db.hostinger.example:3306/batuvia', false],
  ['mysql-abc.aivencloud.com:12345/defaultdb', false],
  ['?', false],
])('ehBancoLocal(%s) = %s', (banco, esperado) => expect(ehBancoLocal(banco)).toBe(esperado));

describe('acharAlvo', () => {
  test('script na raiz', () => {
    const p = join(base, 'raiz');
    escrever(join(p, 'package.json'), JSON.stringify({ scripts: { 'db:pendentes': 'x', 'db:migrate': 'y', 'db:backup': 'z' } }));
    expect(acharAlvo(p, 'bun')).toEqual({ cwd: p, gerente: 'bun', temBackup: true });
  });
  test('script num workspace apps/*, sem backup', () => {
    const p = join(base, 'mono');
    escrever(join(p, 'package.json'), JSON.stringify({ scripts: {} }));
    escrever(join(p, 'apps/api/package.json'), JSON.stringify({ scripts: { 'db:pendentes': 'x', 'db:migrate': 'y' } }));
    expect(acharAlvo(p, 'bun')).toEqual({ cwd: join(p, 'apps/api'), gerente: 'bun', temBackup: false });
  });
  test('projeto sem db:pendentes (ou sem db:migrate) não é incomodado', () => {
    const p = join(base, 'sem');
    escrever(join(p, 'package.json'), JSON.stringify({ scripts: { 'db:migrate': 'y' } }));
    expect(acharAlvo(p, 'bun')).toBeNull();
  });
});

/** Um projeto de mentira: `db:pendentes` lê o arquivo `aplicado`; `db:migrate` o cria (ou falha se existir `quebrar`). */
function projetoFalso(nome: string, opcoes: { banco?: string; backup?: 'ok' | 'falha' | 'nenhum'; migrarFalha?: boolean } = {}) {
  const p = join(base, nome);
  const banco = opcoes.banco ?? 'localhost:3306/b';
  escrever(
    join(p, 'pend.ts'),
    `import { existsSync } from 'node:fs';
     const ok = existsSync('aplicado');
     console.log('$ ruido do gerenciador');
     console.log(JSON.stringify(ok ? { banco: '${banco}', estado: 'em-dia' } : { banco: '${banco}', estado: 'pendente', pendentes: ['0047_a', '0048_b'] }));
     process.exit(ok ? 0 : 2);`,
  );
  escrever(join(p, 'mig.ts'), opcoes.migrarFalha ? `console.error('coluna duplicada'); process.exit(1);` : `await Bun.write('aplicado', '1'); await Bun.write('migrou-' + Date.now(), '1');`);
  escrever(join(p, 'bkp.ts'), opcoes.backup === 'falha' ? `console.error('docker fora'); process.exit(1);` : `await Bun.write('backup-feito', '1');`);
  const scripts: Record<string, string> = { 'db:pendentes': 'bun pend.ts', 'db:migrate': 'bun mig.ts' };
  if (opcoes.backup && opcoes.backup !== 'nenhum') scripts['db:backup'] = 'bun bkp.ts';
  escrever(join(p, 'package.json'), JSON.stringify({ scripts }));
  return { p, alvo: acharAlvo(p, 'bun')! };
}

describe('conferirMigracoes (fluxo completo, com bun de verdade)', () => {
  const sim = async () => true;
  const nao = async () => false;

  test('em dia: sobe e não pergunta nada', async () => {
    const { p, alvo } = projetoFalso('em-dia');
    writeFileSync(join(p, 'aplicado'), '1');
    let perguntou = false;
    const r = await conferirMigracoes(alvo, () => {}, async () => ((perguntou = true), true));
    expect(r).toBe(true);
    expect(perguntou).toBe(false);
  });

  test('pendente + "sim": faz backup, migra e sobe', async () => {
    const { p, alvo } = projetoFalso('sim', { backup: 'ok' });
    let texto = '';
    let pergunta = '';
    const r = await conferirMigracoes(alvo, (t) => (texto += t), async (q) => ((pergunta = q), true));
    expect(r).toBe(true);
    expect(pergunta).toContain('2 migração(ões) pendente(s)');
    expect(pergunta).toContain('com backup antes');
    expect(existsSync(join(p, 'backup-feito'))).toBe(true);
    expect(existsSync(join(p, 'aplicado'))).toBe(true);
    expect(texto).toContain('migrações aplicadas');
  });

  test('pendente + "não": não migra, avisa, mas deixa subir', async () => {
    const { p, alvo } = projetoFalso('nao');
    let texto = '';
    expect(await conferirMigracoes(alvo, (t) => (texto += t), nao)).toBe(true);
    expect(existsSync(join(p, 'aplicado'))).toBe(false);
    expect(texto).toContain('NÃO aplicada');
  });

  test('banco remoto: nem pergunta, nem migra', async () => {
    const { p, alvo } = projetoFalso('remoto', { banco: 'db.aivencloud.com:3306/x' });
    let perguntou = false;
    let texto = '';
    const r = await conferirMigracoes(alvo, (t) => (texto += t), async () => ((perguntou = true), true));
    expect(r).toBe(true);
    expect(perguntou).toBe(false);
    expect(existsSync(join(p, 'aplicado'))).toBe(false);
    expect(texto).toContain('NÃO é um banco desta máquina');
  });

  test('backup falha: não migra e não sobe', async () => {
    const { p, alvo } = projetoFalso('backup-falha', { backup: 'falha' });
    let texto = '';
    expect(await conferirMigracoes(alvo, (t) => (texto += t), sim)).toBe(false);
    expect(existsSync(join(p, 'aplicado'))).toBe(false);
    expect(texto).toContain('o backup falhou');
  });

  test('migração falha: não sobe e mostra o erro', async () => {
    const { alvo } = projetoFalso('mig-falha', { migrarFalha: true });
    let texto = '';
    expect(await conferirMigracoes(alvo, (t) => (texto += t), sim)).toBe(false);
    expect(texto).toContain('a migração falhou');
    expect(texto).toContain('coluna duplicada');
  });
});

describe('comFila', () => {
  test('uma tarefa por vez, na ordem de chegada, mesmo que a primeira falhe', async () => {
    const fila = comFila<string>();
    const ordem: string[] = [];
    const a = fila(async () => {
      await Bun.sleep(30);
      ordem.push('a');
      throw new Error('falhou');
    });
    const b = fila(async () => (ordem.push('b'), 'b'));
    await expect(a).rejects.toThrow('falhou');
    expect(await b).toBe('b');
    expect(ordem).toEqual(['a', 'b']);
  });
});
