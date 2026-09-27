/**
 * O estado git de uma pasta: branch, o que mudou, se já entrou na branch principal, quem é o
 * autor configurado. Só lê — nada aqui altera o repositório nem fala com a rede.
 */
import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { rodar } from './sh';

export type Arquivo = { codigo: string; caminho: string };

export type Status = {
  branch: string | null; // null = HEAD solto (detached)
  upstream: string | null;
  frente: number | null; // null = sem branch remota para comparar
  atras: number | null;
  preparados: Arquivo[]; // no stage (`git add` feito)
  naoPreparados: Arquivo[]; // alterados, fora do stage
  novos: Arquivo[]; // arquivos que o git ainda não acompanha
  conflitos: Arquivo[];
};

export type Commit = { hash: string; quando: string; assunto: string };

export type EstadoGit = Status & {
  comum: string; // pasta .git compartilhada: worktrees do mesmo repositório têm a mesma
  remoto: string | null; // URL do origin
  padrao: string | null; // ex.: "origin/main"
  nomePadrao: string | null; // ex.: "main"
  naPadrao: boolean | null; // a branch já está dentro da principal? null = não se aplica/não deu
  autor: string | null; // git config user.name nesta pasta
  buscadoEm: number | null; // último `git fetch` (ms)
  ultimoCommit: Commit | null;
};

/** Lê `git status --porcelain=v2 --branch`. Pura (testada). */
export function lerStatus(saida: string): Status {
  const s: Status = { branch: null, upstream: null, frente: null, atras: null, preparados: [], naoPreparados: [], novos: [], conflitos: [] };
  for (const linha of saida.split(/\r?\n/)) {
    if (linha.startsWith('# branch.head ')) {
      const v = linha.slice('# branch.head '.length);
      s.branch = v === '(detached)' ? null : v;
    } else if (linha.startsWith('# branch.upstream ')) {
      s.upstream = linha.slice('# branch.upstream '.length);
    } else if (linha.startsWith('# branch.ab ')) {
      const m = linha.match(/\+(\d+) -(\d+)/);
      if (m) [s.frente, s.atras] = [Number(m[1]), Number(m[2])];
    } else if (linha.startsWith('1 ') || linha.startsWith('2 ')) {
      // 1 XY sub mH mI mW hH hI caminho | 2 XY sub mH mI mW hH hI Rnn caminho<TAB>antigo
      const xy = linha.slice(2, 4);
      const campos = linha.split(' ');
      const caminho = campos.slice(linha.startsWith('1 ') ? 8 : 9).join(' ').split('\t')[0]!;
      if (xy[0] !== '.') s.preparados.push({ codigo: xy[0]!, caminho });
      if (xy[1] !== '.') s.naoPreparados.push({ codigo: xy[1]!, caminho });
    } else if (linha.startsWith('u ')) {
      s.conflitos.push({ codigo: 'U', caminho: linha.split(' ').slice(10).join(' ') });
    } else if (linha.startsWith('? ')) {
      s.novos.push({ codigo: '?', caminho: linha.slice(2) });
    }
  }
  return s;
}

/** Linhas `hash<TAB>data-iso<TAB>assunto` do `git log`. Pura (testada). */
export function lerCommits(saida: string): Commit[] {
  return saida
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const [hash = '', quando = '', ...resto] = l.split('\t');
      return { hash, quando, assunto: resto.join('\t') };
    });
}

const FORMATO = '--format=%h%x09%cI%x09%s';

function git(dir: string, ...args: string[]) {
  // quotepath=off: sem isso nomes com acento voltam como "\303\247"
  return rodar('git', ['-c', 'core.quotepath=off', ...args], { cwd: dir });
}

export async function lerGit(dir: string): Promise<EstadoGit> {
  const [status, comum, remoto, padraoRef, autor, ultimo] = await Promise.all([
    git(dir, 'status', '--porcelain=v2', '--branch'),
    git(dir, 'rev-parse', '--git-common-dir'),
    git(dir, 'remote', 'get-url', 'origin'),
    git(dir, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'),
    git(dir, 'config', 'user.name'),
    git(dir, 'log', '-1', FORMATO),
  ]);
  const st = lerStatus(status.saida);
  const pastaComum = resolve(dir, comum.saida.trim() || '.git');

  let padrao = padraoRef.ok ? padraoRef.saida.trim() : null;
  if (!padrao) {
    for (const c of ['origin/main', 'origin/master']) {
      if ((await git(dir, 'rev-parse', '--verify', '--quiet', c)).ok) {
        padrao = c;
        break;
      }
    }
  }
  const nomePadrao = padrao ? padrao.replace(/^origin\//, '') : null;

  // "já mesclada" = o último commit da branch está dentro da principal (o que o git sabe dela
  // desde o último fetch). Um PR marcado como mesclado NÃO basta: se a base dele era outra
  // branch, o conteúdo pode não ter chegado à principal.
  let naPadrao: boolean | null = null;
  if (padrao && st.branch && st.branch !== nomePadrao) {
    const r = await git(dir, 'merge-base', '--is-ancestor', 'HEAD', padrao);
    naPadrao = r.codigo === 0 ? true : r.codigo === 1 ? false : null;
  }

  let buscadoEm: number | null = null;
  try {
    buscadoEm = statSync(join(pastaComum, 'FETCH_HEAD')).mtimeMs;
  } catch {
    // nunca buscou
  }

  return {
    ...st,
    comum: pastaComum,
    remoto: remoto.ok ? remoto.saida.trim() : null,
    padrao,
    nomePadrao,
    naPadrao,
    autor: autor.ok ? autor.saida.trim() : null,
    buscadoEm,
    ultimoCommit: lerCommits(ultimo.saida)[0] ?? null,
  };
}

/** Commits ainda não enviados e os últimos da branch — só para a tela de detalhes. */
export async function lerHistorico(dir: string, temUpstream: boolean): Promise<{ naoEnviados: Commit[]; recentes: Commit[] }> {
  const [naoEnviados, recentes] = await Promise.all([
    temUpstream ? git(dir, 'log', FORMATO, '@{u}..HEAD') : Promise.resolve(null),
    git(dir, 'log', '-8', FORMATO),
  ]);
  return { naoEnviados: naoEnviados ? lerCommits(naoEnviados.saida) : [], recentes: lerCommits(recentes.saida) };
}
