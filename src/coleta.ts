/**
 * Junta tudo o que o painel mostra: cada pasta com git, agrupada por repositório (worktrees do
 * mesmo repositório ficam juntos), o CI de cada branch e o da branch principal, e os avisos.
 */
import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Config } from './config';
import { lerGit, type EstadoGit } from './git';
import { GitHub, repoDoRemoto, type PR, type ResumoCI } from './github';

export type Checkout = {
  nome: string; // nome da pasta
  pasta: string;
  git: EstadoGit;
  ci: ResumoCI | null; // null = não deu para consultar
  pr: PR | null;
};

export type Grupo = {
  titulo: string; // "Dono/repo", ou o nome da pasta se não for do GitHub
  repo: string | null;
  ciPrincipal: ResumoCI | null;
  checkouts: Checkout[];
};

export type Estado = { raiz: string; grupos: Grupo[]; outras: string[]; avisos: string[] };

export async function coletar(raiz: string, config: Config): Promise<Estado> {
  const avisos: string[] = [];
  const { gh, aviso } = await GitHub.conectar(config.gh?.conta);
  if (aviso) avisos.push(aviso);
  const errosDoGh = new Set<string>();

  const ignorar = new Set(config.ignorar ?? []);
  const pastas = readdirSync(raiz, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !ignorar.has(d.name))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));
  let comGit = pastas.filter((p) => existsSync(join(raiz, p, '.git')));
  const outras = pastas.filter((p) => !comGit.includes(p));
  // rodando dentro de um repositório só (sem subpastas com git): mostra ele mesmo
  const soARaiz = comGit.length === 0 && existsSync(join(raiz, '.git'));
  if (soARaiz) comGit = ['.'];

  const checkouts: Checkout[] = await Promise.all(
    comGit.map(async (nome) => {
      const pasta = join(raiz, nome);
      const g = await lerGit(pasta);
      const repo = repoDoRemoto(g.remoto);
      const [ci, pr] = await Promise.all([
        repo && g.branch ? gh.ci(repo, g.branch) : null,
        repo && g.branch && g.branch !== g.nomePadrao ? gh.pr(repo, g.branch) : null,
      ]);
      if (ci && 'erro' in ci) errosDoGh.add(`${repo}: ${ci.erro}`);
      return { nome: soARaiz ? basename(raiz) : nome, pasta, git: g, ci: ci && !('erro' in ci) ? ci : null, pr };
    }),
  );

  // worktrees do mesmo repositório compartilham a pasta .git
  const porComum = new Map<string, Checkout[]>();
  for (const c of checkouts) porComum.set(c.git.comum, [...(porComum.get(c.git.comum) ?? []), c]);

  const grupos: Grupo[] = await Promise.all(
    [...porComum.values()].map(async (cs) => {
      const primeiro = cs[0]!;
      const repo = repoDoRemoto(primeiro.git.remoto);
      const principal = primeiro.git.nomePadrao;
      // se algum checkout já está na principal, o CI dela veio junto; senão, consulta uma vez
      const naPrincipal = cs.find((c) => c.git.branch === principal);
      let ciPrincipal: ResumoCI | null = naPrincipal?.ci ?? null;
      if (!naPrincipal && repo && principal) {
        const r = await gh.ci(repo, principal);
        if ('erro' in r) errosDoGh.add(`${repo}: ${r.erro}`);
        else ciPrincipal = r;
      }
      return { titulo: repo ?? primeiro.nome, repo, ciPrincipal, checkouts: cs };
    }),
  );
  grupos.sort((a, b) => a.titulo.localeCompare(b.titulo));

  // ---- avisos: o que merece atenção antes de trabalhar ----
  for (const g of grupos) {
    if (g.ciPrincipal?.situacao === 'falhou') {
      const falhas = g.ciPrincipal.execucoes.filter((e) => e.situacao === 'falhou').map((e) => e.workflow);
      avisos.push(`${g.titulo}: o CI da ${g.checkouts[0]!.git.nomePadrao} está FALHANDO (${falhas.join(', ')})`);
    }
  }
  for (const c of checkouts) {
    const g = c.git;
    const autor = config.git?.autor;
    if (autor && g.autor !== autor) avisos.push(`${c.nome}: commits sairiam com o autor "${g.autor ?? '(nenhum)'}", e não "${autor}"`);
    if (c.pr?.estado === 'MERGED' && g.nomePadrao && c.pr.base !== g.nomePadrao && g.naPadrao === false) {
      avisos.push(`${c.nome}: o PR #${c.pr.numero} foi mesclado em "${c.pr.base}", mas o conteúdo NÃO está na ${g.nomePadrao}`);
    }
    if (g.conflitos.length) avisos.push(`${c.nome}: ${g.conflitos.length} arquivo(s) em conflito`);
    if (g.branch === null) avisos.push(`${c.nome}: HEAD solto (fora de qualquer branch)`);
  }
  for (const e of errosDoGh) avisos.push(`gh — ${e}`);

  return { raiz, grupos, outras, avisos };
}
