import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { arquivoDoComando, descobrirProjetos, ehScriptDeDev, portasDaSaida, portasDeBanco, portasUsadas, primeiraLinhaDoCabecalho, servicosDoCompose } from '../src/descoberta';
import { lerDotenv } from '../src/dotenv';

const base = mkdtempSync(join(tmpdir(), 'leme-'));
afterAll(() => rmSync(base, { recursive: true, force: true }));
const escrever = (caminho: string, conteudo: string) => {
  mkdirSync(join(caminho, '..'), { recursive: true });
  writeFileSync(caminho, conteudo);
};

test.each([
  ['dev', true],
  ['dev:tudo', true],
  ['api:dev', true],
  ['web:dev:rapido', true],
  ['predev', false],
  ['devtools', false],
  ['test', false],
  ['db:dev-seed', false],
])('ehScriptDeDev(%s) = %s', (nome, esperado) => expect(ehScriptDeDev(nome)).toBe(esperado));

describe('portasDeBanco', () => {
  test('só connection strings locais que não são http/ws — e só a porta sai', () => {
    const vars = lerDotenv(
      [
        'DATABASE_URL="mysql://u:senha@localhost:3306/app"',
        'POI=postgres://u:p@127.0.0.1:55432/poi',
        'CACHE=redis://host.docker.internal:6379',
        'REMOTO=mysql://u:segredo@banco.nuvem.com:14572/x', // remoto: fora
        'WEB_ORIGIN=http://localhost:5173', // endereço de app: fora
        'SOCKET=ws://localhost:3001',
        'PORT=14572', // sem esquema: fora
        '# COMENTADO=mysql://localhost:9999',
      ].join('\n'),
    );
    expect(portasDeBanco(vars).sort()).toEqual([3306, 55432, 6379].sort());
  });
});

test('portasUsadas: .env.example é o padrão, o .env sobrepõe, workspaces entram', () => {
  const p = join(base, 'usa');
  escrever(join(p, '.env.example'), 'DATABASE_URL=postgres://u:p@localhost:55432/x\nOUTRO=mysql://localhost:3306/a\n');
  escrever(join(p, '.env'), 'OUTRO=mysql://localhost:3310/a\n');
  escrever(join(p, 'apps', 'api', '.env'), 'FILA=amqp://localhost:5672\n');
  expect(portasUsadas({ pastasComEnv: [p, join(p, 'apps', 'api')] } as never)).toEqual([3310, 5672, 55432]);
});

describe('descobrirProjetos', () => {
  const raiz = join(base, 'org');
  escrever(join(raiz, 'loja', 'package.json'), JSON.stringify({ scripts: { dev: 'x', 'dev:tudo': 'y', 'api:dev': 'z', predev: 'p', test: 't' } }));
  escrever(join(raiz, 'loja', 'bun.lock'), '');
  escrever(join(raiz, 'loja', 'docker-compose.yml'), 'services: {}');
  escrever(join(raiz, 'mono', 'package.json'), JSON.stringify({ workspaces: ['apps/*'], scripts: { build: 'b' } }));
  escrever(join(raiz, 'mono', 'pnpm-lock.yaml'), '');
  escrever(join(raiz, 'mono', 'apps', 'web', 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));
  escrever(join(raiz, 'mono', 'apps', 'lib', 'package.json'), JSON.stringify({ scripts: { test: 't' } }));
  mkdirSync(join(raiz, 'backups'), { recursive: true }); // sem package.json: não é projeto
  mkdirSync(join(raiz, 'node_modules', 'x'), { recursive: true });

  test('acha os projetos, os scripts de dev e as ações', () => {
    const ps = descobrirProjetos(raiz);
    expect(ps.map((p) => p.nome)).toEqual(['loja', 'mono']);
    const loja = ps[0]!;
    expect(loja.gerente).toBe('bun');
    expect(loja.temCompose).toBe(true);
    expect(loja.processos.map((p) => p.script)).toEqual(['dev', 'dev:tudo', 'api:dev']);
    expect(loja.acoes).toEqual(['test']); // predev roda sozinho com o dev
  });

  test('monorepo sem dev na raiz: os dev dos workspaces, rodando na pasta deles', () => {
    const mono = descobrirProjetos(raiz)[1]!;
    expect(mono.gerente).toBe('pnpm');
    expect(mono.processos).toEqual([{ projeto: 'mono', nome: 'apps/web · dev', script: 'dev', cwd: join(raiz, 'mono', 'apps', 'web'), gerente: 'pnpm', descricao: undefined }]);
  });

  test('descrição: scripts-info do package.json; senão, o cabeçalho do arquivo que o script roda', () => {
    const p = join(base, 'descr');
    escrever(
      join(p, 'site', 'package.json'),
      JSON.stringify({
        scripts: { dev: 'vite', 'dev:tudo': 'bun scripts/tudo.ts --x', 'dev:velho': 'node scripts/velho.js', 'dev:nada': 'bun run --cwd x dev' },
        'scripts-info': { dev: 'só a web', 'dev:velho': 42 },
      }),
    );
    escrever(join(p, 'site', 'scripts', 'tudo.ts'), '#!/usr/bin/env bun\n/**\n * `bun run dev:tudo` — sobe tudo de uma vez.\n *\n * detalhes\n */\n');
    escrever(join(p, 'site', 'scripts', 'velho.js'), '// liga o servidor antigo\n// segunda linha\nrequire("x")\n');
    const d = Object.fromEntries(descobrirProjetos(p)[0]!.processos.map((x) => [x.script, x.descricao]));
    expect(d).toEqual({ dev: 'só a web', 'dev:tudo': 'sobe tudo de uma vez.', 'dev:velho': 'liga o servidor antigo', 'dev:nada': undefined });
  });

  test('rodando dentro de um projeto só: ele mesmo', () => {
    expect(descobrirProjetos(join(raiz, 'loja')).map((p) => p.nome)).toEqual(['loja']);
  });
});

test('servicosDoCompose: contêiner, portas publicadas e profiles', () => {
  const s = servicosDoCompose(
    {
      name: 'app',
      services: {
        banco: { container_name: 'app-db', ports: [{ published: '3306' }], profiles: [] },
        teste: { container_name: 'app-db-test', ports: [{ published: 3307 }], profiles: ['test'] },
        fila: {},
      },
    },
    { nome: 'app', pasta: '/x/app' },
  );
  expect(s.map((x) => [x.servico, x.container, x.portas, x.profiles])).toEqual([
    ['banco', 'app-db', [3306], []],
    ['teste', 'app-db-test', [3307], ['test']],
    ['fila', 'app-fila-1', [], []],
  ]);
});

test.each([
  ['bun scripts/dev-tudo.ts', 'scripts/dev-tudo.ts'],
  ['bun run scripts/x.mjs --teste', 'scripts/x.mjs'],
  ['node --experimental-strip-types scripts/ensure-env.ts && next dev', 'scripts/ensure-env.ts'],
  ['tsx src/main.tsx', 'src/main.tsx'],
  ["bun run --filter './apps/*' dev", null],
  ['bun run --cwd apps/web dev', null],
  ['vite', null],
])('arquivoDoComando(%s)', (cmd, esperado) => expect(arquivoDoComando(cmd)).toBe(esperado));

test('primeiraLinhaDoCabecalho', () => {
  expect(primeiraLinhaDoCabecalho('/**\n * `bun run dev:multi` — testar a colaboração À MÃO.\n */')).toBe('testar a colaboração À MÃO.');
  expect(primeiraLinhaDoCabecalho('/* liga tudo */\ncodigo()')).toBe('liga tudo');
  expect(primeiraLinhaDoCabecalho('import x from "y";\n/** tarde demais */')).toBeUndefined();
});

test('portasDaSaida: o endereço que vite/next/astro anunciam', () => {
  expect(portasDaSaida('  ➜  Local:   http://localhost:5173/\n  ➜  Network: use --host')).toEqual([5173]);
  expect(portasDaSaida('- Local: http://127.0.0.1:3100\nready')).toEqual([3100]);
  expect(portasDaSaida('Server running at http://[::1]:4321/ e de novo http://localhost:4321')).toEqual([4321]);
  expect(portasDaSaida('conectando em https://api.github.com')).toEqual([]);
});
