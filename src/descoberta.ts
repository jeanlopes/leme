/**
 * O que o leme descobre sozinho numa pasta — sem nenhuma configuração:
 *
 *  - projetos: subpastas com `package.json` (ou a própria pasta, se for um projeto);
 *  - processos: os scripts de dev do `package.json` (`dev`, `dev:*`, `*:dev`). Se a raiz de um
 *    monorepo não tiver nenhum, os dos workspaces;
 *  - ações: os outros scripts (test, lint, build…);
 *  - bancos usados: as portas das connection strings LOCAIS dos `.env` do projeto (raiz e
 *    workspaces). Só a porta é lida — o valor nunca é guardado nem mostrado; hosts remotos são
 *    ignorados;
 *  - serviços: o `docker-compose.yml` de cada projeto (`docker compose config`), com contêiner,
 *    portas e profiles.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { lerDotenv } from './dotenv';
import { rodar } from './sh';

export type Gerente = 'bun' | 'pnpm' | 'yarn' | 'npm';

export type DefProcesso = {
  projeto: string; // nome da pasta do projeto
  nome: string; // o que aparece na lista: o script, ou "apps/web · dev" num workspace
  script: string;
  cwd: string;
  gerente: Gerente;
};

export type Projeto = {
  nome: string;
  pasta: string;
  gerente: Gerente;
  temGit: boolean;
  processos: DefProcesso[];
  acoes: string[];
  pastasComEnv: string[]; // raiz + workspaces
  temCompose: boolean;
};

export type Servico = { projeto: string; pasta: string; servico: string; container: string; portas: number[]; profiles: string[] };

const COMPOSE = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];

/** `dev`, `dev:tudo`, `api:dev`… Pura (testada). */
export const ehScriptDeDev = (nome: string) => /(^|:)dev($|:)/.test(nome);

type Pacote = { scripts?: Record<string, string>; workspaces?: string[] | { packages?: string[] } };

function lerPacote(pasta: string): Pacote | null {
  try {
    return JSON.parse(readFileSync(join(pasta, 'package.json'), 'utf8')) as Pacote;
  } catch {
    return null;
  }
}

function gerenteDe(pasta: string): Gerente {
  const tem = (f: string) => existsSync(join(pasta, f));
  if (tem('bun.lock') || tem('bun.lockb')) return 'bun';
  if (tem('pnpm-lock.yaml')) return 'pnpm';
  if (tem('yarn.lock')) return 'yarn';
  return 'npm';
}

/** "apps/*" → as subpastas de apps que têm package.json; caminho exato → ele mesmo. */
function pastasDosWorkspaces(raiz: string, pacote: Pacote): string[] {
  const padroes = Array.isArray(pacote.workspaces) ? pacote.workspaces : (pacote.workspaces?.packages ?? []);
  const pastas: string[] = [];
  for (const p of padroes) {
    if (p.endsWith('/*')) {
      const base = join(raiz, p.slice(0, -2));
      if (!existsSync(base)) continue;
      for (const d of readdirSync(base, { withFileTypes: true })) {
        if (d.isDirectory() && existsSync(join(base, d.name, 'package.json'))) pastas.push(join(base, d.name));
      }
    } else if (existsSync(join(raiz, p, 'package.json'))) {
      pastas.push(join(raiz, p));
    }
  }
  return pastas;
}

function lerProjeto(nome: string, pasta: string): Projeto | null {
  const pacote = lerPacote(pasta);
  if (!pacote) return null;
  const gerente = gerenteDe(pasta);
  const scripts = Object.keys(pacote.scripts ?? {});
  const workspaces = pastasDosWorkspaces(pasta, pacote);
  let processos: DefProcesso[] = scripts.filter(ehScriptDeDev).map((s) => ({ projeto: nome, nome: s, script: s, cwd: pasta, gerente }));
  if (!processos.length) {
    // monorepo que não expõe dev na raiz: os dev dos workspaces
    for (const ws of workspaces) {
      const sub = lerPacote(ws);
      const rel = ws.slice(pasta.length + 1).replace(/\\/g, '/');
      for (const s of Object.keys(sub?.scripts ?? {}).filter(ehScriptDeDev)) processos.push({ projeto: nome, nome: `${rel} · ${s}`, script: s, cwd: ws, gerente });
    }
  }
  return {
    nome,
    pasta,
    gerente,
    temGit: existsSync(join(pasta, '.git')),
    processos,
    // predev/postinstall… rodam sozinhos junto do script deles: não são ações
    acoes: scripts.filter((s) => !ehScriptDeDev(s) && !/^(pre|post)./.test(s)),
    pastasComEnv: [pasta, ...workspaces],
    temCompose: COMPOSE.some((f) => existsSync(join(pasta, f))),
  };
}

/** Os projetos da pasta. Síncrono e rápido: só lê package.json. */
export function descobrirProjetos(raiz: string): Projeto[] {
  const base = resolve(raiz);
  const projetos = readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b))
    .map((n) => lerProjeto(n, join(base, n)))
    .filter((p): p is Projeto => p !== null);
  if (projetos.length) return projetos;
  const sozinho = lerProjeto(base.split(/[\\/]/).pop() ?? base, base);
  return sozinho ? [sozinho] : [];
}

// connection string com host local; http/ws ficam de fora (são endereços de app, não de banco)
const LOCAL = /\b([a-z][a-z0-9+.-]*):\/\/(?:[^@\s/'"]*@)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal|\[::1\]):(\d{2,5})/gi;
const DE_APP = new Set(['http', 'https', 'ws', 'wss']);

/** Portas dos bancos LOCAIS nas variáveis de um `.env`. Não devolve nenhum valor além da porta. Pura (testada). */
export function portasDeBanco(vars: Record<string, string>): number[] {
  const portas = new Set<number>();
  for (const valor of Object.values(vars)) {
    for (const m of valor.matchAll(LOCAL)) if (!DE_APP.has(m[1]!.toLowerCase())) portas.add(Number(m[2]));
  }
  return [...portas];
}

/**
 * As portas dos bancos que um projeto usa. Em cada pasta (raiz e workspaces), o `.env.example`
 * vale como padrão — é onde o projeto declara o valor que o código usa quando o `.env` não diz —
 * e o `.env`/`.env.local` por cima.
 */
export function portasUsadas(p: Projeto): number[] {
  const portas = new Set<number>();
  for (const pasta of p.pastasComEnv) {
    const vars: Record<string, string> = {};
    for (const f of ['.env.example', '.env', '.env.local']) {
      const arq = join(pasta, f);
      if (existsSync(arq)) Object.assign(vars, lerDotenv(readFileSync(arq, 'utf8')));
    }
    for (const porta of portasDeBanco(vars)) portas.add(porta);
  }
  return [...portas].sort((a, b) => a - b);
}

type ComposeJson = { services?: Record<string, { container_name?: string; ports?: { published?: string | number }[]; profiles?: string[] }> };

/** Serviços do compose de um projeto (todos os profiles). Lento (chama o docker): rode em segundo plano. */
export async function lerCompose(p: Projeto): Promise<Servico[]> {
  if (!p.temCompose) return [];
  const r = await rodar('docker', ['compose', '--profile', '*', 'config', '--format', 'json'], { cwd: p.pasta });
  if (!r.ok) return [];
  try {
    return servicosDoCompose(JSON.parse(r.saida) as ComposeJson, p);
  } catch {
    return [];
  }
}

/** Pura (testada). Sem `container_name`, o Compose chama o contêiner de "<projeto>-<serviço>-1". */
export function servicosDoCompose(j: ComposeJson & { name?: string }, p: Pick<Projeto, 'nome' | 'pasta'>): Servico[] {
  return Object.entries(j.services ?? {}).map(([servico, s]) => ({
    projeto: p.nome,
    pasta: p.pasta,
    servico,
    container: s.container_name ?? `${j.name ?? p.nome}-${servico}-1`,
    portas: (s.ports ?? []).map((x) => Number(x.published)).filter((n) => Number.isFinite(n) && n > 0),
    profiles: s.profiles ?? [],
  }));
}

/** O endereço local que um processo anunciou na saída (vite, next, astro, nest imprimem). Pura (testada). */
export function portasDaSaida(texto: string): number[] {
  const portas = new Set<number>();
  for (const m of texto.matchAll(/\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})/g)) portas.add(Number(m[1]));
  return [...portas];
}
