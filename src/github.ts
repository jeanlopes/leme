/**
 * CI e PR pelo `gh`. Se o `.leme.json` diz qual conta usar, cada chamada leva o token dessa
 * conta (`GH_TOKEN`) — funciona mesmo que a conta ATIVA do gh seja outra (ex.: a do trabalho).
 */
import { rodar } from './sh';

export type Situacao = 'ok' | 'falhou' | 'rodando' | 'cancelado';

export type Execucao = { workflow: string; situacao: Situacao; quando: string; url: string };

/** Última execução de cada workflow. `situacao` resume todas; 'nenhum' = o repositório não tem CI nessa branch. */
export type ResumoCI = { situacao: Situacao | 'nenhum'; quando: string | null; execucoes: Execucao[] };

export type PR = { numero: number; estado: 'OPEN' | 'CLOSED' | 'MERGED'; base: string; url: string; titulo: string };

type RunDoGh = { workflowName: string; status: string; conclusion: string; createdAt: string; url: string };

/** `git@github.com:Dono/repo.git`, `https://github.com/Dono/repo` → "Dono/repo". Pura (testada). */
export function repoDoRemoto(url: string | null): string | null {
  if (!url) return null;
  const m = url.trim().match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

function situacaoDe(r: RunDoGh): Situacao {
  if (r.status !== 'completed') return 'rodando';
  if (['success', 'skipped', 'neutral'].includes(r.conclusion)) return 'ok';
  if (r.conclusion === 'cancelled') return 'cancelado';
  return 'falhou';
}

/** A última execução de cada workflow e a situação geral. Pura (testada). */
export function resumirCI(runs: RunDoGh[]): ResumoCI {
  const ordenadas = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const porWorkflow = new Map<string, Execucao>();
  for (const r of ordenadas) {
    if (porWorkflow.has(r.workflowName)) continue;
    porWorkflow.set(r.workflowName, { workflow: r.workflowName, situacao: situacaoDe(r), quando: r.createdAt, url: r.url });
  }
  const execucoes = [...porWorkflow.values()];
  if (execucoes.length === 0) return { situacao: 'nenhum', quando: null, execucoes };
  const tem = (s: Situacao) => execucoes.some((e) => e.situacao === s);
  const situacao: Situacao = tem('rodando') ? 'rodando' : tem('falhou') ? 'falhou' : tem('cancelado') ? 'cancelado' : 'ok';
  return { situacao, quando: execucoes[0]!.quando, execucoes };
}

export class GitHub {
  private constructor(private readonly env: Record<string, string>) {}

  /** Monta o acesso ao gh. Devolve também um aviso quando a conta pedida não está logada. */
  static async conectar(conta?: string): Promise<{ gh: GitHub; aviso?: string }> {
    if (!conta) return { gh: new GitHub({}) };
    const r = await rodar('gh', ['auth', 'token', '--user', conta]);
    if (!r.ok) return { gh: new GitHub({}), aviso: `a conta "${conta}" (do .leme.json) não está logada no gh — rode: gh auth login` };
    return { gh: new GitHub({ GH_TOKEN: r.saida.trim() }) };
  }

  private async json<T>(args: string[]): Promise<{ dados: T } | { erro: string }> {
    const r = await rodar('gh', args, { env: this.env });
    if (!r.ok) return { erro: (r.erro.trim().split(/\r?\n/)[0] ?? '') || 'gh falhou' };
    try {
      return { dados: JSON.parse(r.saida) as T };
    } catch {
      return { erro: 'resposta do gh ilegível' };
    }
  }

  async ci(repo: string, branch: string): Promise<ResumoCI | { erro: string }> {
    const r = await this.json<RunDoGh[]>(['run', 'list', '--repo', repo, '--branch', branch, '--limit', '20', '--json', 'workflowName,status,conclusion,createdAt,url']);
    return 'erro' in r ? r : resumirCI(r.dados);
  }

  async pr(repo: string, branch: string): Promise<PR | null> {
    const r = await this.json<{ number: number; state: PR['estado']; baseRefName: string; url: string; title: string }[]>([
      'pr', 'list', '--repo', repo, '--head', branch, '--state', 'all', '--limit', '1', '--json', 'number,state,baseRefName,url,title',
    ]);
    if ('erro' in r || !r.dados[0]) return null;
    const p = r.dados[0];
    return { numero: p.number, estado: p.state, base: p.baseRefName, url: p.url, titulo: p.title };
  }
}
