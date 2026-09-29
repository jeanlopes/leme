import { expect, test } from 'bun:test';
import { Terminal as Xterm } from '@xterm/headless';
import { cerca, linhasDoBuffer, mascarar, mesclarLogs, montarDiagnostico, type Foto } from '../src/diagnostico';

const escrever = (xt: Xterm, texto: string) => new Promise<void>((ok) => xt.write(texto, ok));

test('mascarar apaga senhas e tokens, e deixa o resto do log em paz', () => {
  expect(mascarar('conectando em postgres://leme:segredo123@localhost:5432/db')).toBe('conectando em postgres://leme:***@localhost:5432/db');
  expect(mascarar('DB_PASSWORD=abc123 PORT=3000')).toBe('DB_PASSWORD=*** PORT=3000');
  expect(mascarar('{"token": "abc.def", "ok": true}')).toBe('{"token": ***, "ok": true}');
  expect(mascarar('API_KEY: sk_live_x')).toBe('API_KEY: ***');
  expect(mascarar('Authorization: Bearer abcdefghij1234567890')).not.toContain('abcdefghij');
  expect(mascarar('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def')).toBe('jwt ***');
  expect(mascarar('gh ghp_abcdefghijklmnopqrstuvwxyz0123 fim')).toBe('gh *** fim');
  // o que não é segredo passa intacto
  for (const t of ['  ➜  Local:   http://localhost:5173/', 'FATAL: password authentication failed for user "postgres"', 'error: cannot find module ./x', '3 passed, 0 failed']) {
    expect(mascarar(t)).toBe(t);
  }
});

test('mascarar não atravessa linhas', () => {
  expect(mascarar('senha: \nsegunda linha')).toBe('senha: \nsegunda linha');
  expect(mascarar('password=\nsegunda linha')).toBe('password=\nsegunda linha');
});

test('cerca cresce para o conteúdo não fechar o bloco', () => {
  expect(cerca(['a'])).toEqual(['```', 'a', '```']);
  expect(cerca(['```ts', 'x', '```'])).toEqual(['````', '```ts', 'x', '```', '````']);
});

test('linhasDoBuffer: junta o que a largura quebrou, colapsa vazias e tira as das pontas', async () => {
  const xt = new Xterm({ cols: 10, rows: 3, scrollback: 50, allowProposedApi: true });
  await escrever(xt, '\r\n\r\n\r\nabcdefghijklmnopqrst\r\n\r\n\r\n\r\num  \r\ndois\r\n\r\n\r\n');
  expect(linhasDoBuffer(xt)).toEqual(['abcdefghijklmnopqrst', '', 'um', 'dois']);
});

test('linhasDoBuffer: terminal vazio dá lista vazia', () => {
  expect(linhasDoBuffer(new Xterm({ cols: 10, rows: 3, allowProposedApi: true }))).toEqual([]);
});

test('mesclarLogs: intercala stdout e stderr pelo carimbo e tira o carimbo', () => {
  const out = '2026-09-29T10:00:01.5Z segundo\n2026-09-29T10:00:03.000000000Z quarto\n';
  const err = '2026-09-29T10:00:00.000000000Z primeiro\n2026-09-29T10:00:02.000000000Z \x1b[31mterceiro\x1b[0m\n';
  expect(mesclarLogs(out, err)).toEqual(['primeiro', 'segundo', 'terceiro', 'quarto']);
  expect(mesclarLogs('sem carimbo\n', '')).toEqual(['sem carimbo']);
  // linhas só com espaço (prisma, npm…) não gastam o limite de linhas
  expect(mesclarLogs('2026-09-29T10:00:00.000000000Z a  \n2026-09-29T10:00:01.000000000Z  \n2026-09-29T10:00:02.000000000Z \n2026-09-29T10:00:03.000000000Z b\n', '')).toEqual(['a', '', 'b']);
});

const foto = (mudanca: Partial<Foto> = {}): Foto => ({
  quando: new Date('2026-09-29T17:00:00Z'),
  raiz: 'C:\\workspace\\org',
  cols: 150,
  rows: 36,
  naTela: 'loja · api:dev',
  projetos: [
    {
      nome: 'loja',
      pasta: 'C:\\workspace\\org\\loja',
      gerente: 'bun',
      temGit: true,
      git: {
        branch: 'main',
        upstream: 'origin/main',
        frente: 1,
        atras: 0,
        preparados: [],
        naoPreparados: [{ codigo: 'M', caminho: 'src/a.ts' }],
        novos: [],
        conflitos: [],
        comum: '',
        remoto: null,
        padrao: 'origin/main',
        nomePadrao: 'main',
        naPadrao: null,
        autor: null,
        buscadoEm: null,
        ultimoCommit: { hash: 'abc1234', quando: '2026-09-28T10:00:00-03:00', assunto: 'feat: x' },
      },
      processos: [
        { nome: 'api:dev', comando: 'bun run api:dev', cwd: 'C:\\workspace\\org\\loja', estado: 'caiu', codigo: 1, portas: [{ porta: 3333, respondendo: false }], jaRodou: true, saida: ['boot', 'Error: senha=abc', 'fim'] },
        { nome: 'web:dev', comando: 'bun run web:dev', cwd: 'C:\\workspace\\org\\loja', estado: 'parado', codigo: null, portas: [], jaRodou: false, saida: [] },
      ],
      bancos: [
        { porta: 3306, servico: 'mariadb', conteinerRodando: true, respondendo: true },
        { porta: 5432, servico: null, conteinerRodando: null, respondendo: false },
      ],
    },
  ],
  conteineres: [
    { servico: 'mariadb', container: 'loja-mariadb-1', projeto: 'loja', portas: [3306], profiles: [], existe: true, rodando: true, status: 'Up 2 hours (healthy)', logs: ['ready for connections'] },
    { servico: 'redis', container: 'loja-redis-1', projeto: 'loja', portas: [6379], profiles: ['cache'], existe: false, rodando: null, status: 'não existe', logs: null },
  ],
  ...mudanca,
});

test('montarDiagnostico: estado, atenção, saída e contêineres num texto só', () => {
  const t = montarDiagnostico(foto());
  expect(t).toContain('# Diagnóstico do leme');
  expect(t).toContain('- Quando: ');
  expect(t).toContain('- Na tela: loja · api:dev');
  expect(t).toContain('- Processos: 1 CAIU (código 1) · 1 parado');
  expect(t).toContain('- Contêineres: 1 rodando · 1 não existe');
  // pontos de atenção: o que caiu e o banco que ninguém atende
  expect(t).toContain('- loja · api:dev: CAIU (código 1)');
  expect(t).toContain('- loja: o .env usa a porta 5432 (nenhum contêiner do compose declara essa porta) e ninguém responde nela');
  expect(t).not.toContain('a porta 3306 (mariadb');
  expect(t).toContain('- Git: `main` (upstream origin/main) — 1 alterado · ↑1');
  expect(t).toContain('alterado   M src/a.ts');
  expect(t).toContain('- Portas: :3333 sem resposta');
  expect(t).toContain('### mariadb — rodando (Up 2 hours (healthy))');
  expect(t).toContain('ready for connections');
  expect(t).toContain('### redis — não existe');
  // processo que nunca subiu não vira um bloco vazio
  expect(t).toContain('- Não subiu nesta sessão do leme.');
  // a máscara vale para o texto todo
  expect(t).toContain('Error: senha=***');
  expect(t).not.toContain('senha=abc');
  expect(t).not.toMatch(/\x1b/);
  expect(t.endsWith('\n')).toBe(true);
});

test('montarDiagnostico: só as últimas linhas, e diz quantas cortou', () => {
  const saida = Array.from({ length: 200 }, (_, i) => `linha ${i + 1}`);
  const t = montarDiagnostico(foto({ projetos: [{ ...foto().projetos[0]!, processos: [{ ...foto().projetos[0]!.processos[0]!, saida }] }] }));
  expect(t).toContain('Saída (últimas 80 de 200 linhas):');
  expect(t).toContain('linha 200');
  expect(t).toContain('linha 121');
  expect(t).not.toContain('linha 120\n');
});

test('montarDiagnostico: tudo em ordem → nenhum ponto de atenção', () => {
  const p = foto().projetos[0]!;
  const t = montarDiagnostico(foto({ projetos: [{ ...p, bancos: [p.bancos[0]!], processos: [{ ...p.processos[1]!, estado: 'no-ar' }] }] }));
  expect(t).toContain('- Nenhum: nada caiu');
});

test('montarDiagnostico: linha gigante é cortada', () => {
  const p = foto().projetos[0]!;
  const t = montarDiagnostico(foto({ projetos: [{ ...p, processos: [{ ...p.processos[0]!, saida: ['x'.repeat(5000)] }] }] }));
  expect(t).toContain('… (+4700 caracteres)');
  expect(t.length).toBeLessThan(4000);
});
