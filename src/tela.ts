/**
 * Como o estado vira texto: o resumo (uma linha por pasta, agrupadas por repositório) e a tela
 * de detalhes de uma pasta. Só formata — quem busca os dados é `coleta.ts`.
 */
import type { Checkout, Estado, Grupo } from './coleta';
import type { Commit } from './git';
import type { ResumoCI, Situacao } from './github';

const comCor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const cor = (codigo: number) => (t: string) => (comCor ? `\x1b[${codigo}m${t}\x1b[0m` : t);
export const negrito = cor(1);
export const cinza = cor(90);
export const verde = cor(32);
export const vermelho = cor(31);
export const amarelo = cor(33);
export const ciano = cor(36);

const semCor = (t: string) => t.replace(/\x1b\[[0-9;]*m/g, '');
const preencher = (t: string, n: number) => t + ' '.repeat(Math.max(0, n - semCor(t).length));

/** "há 5 min", "há 3 h", "há 2 dias". Pura (testada). */
export function haQuanto(quando: string | number | null, agora = Date.now()): string {
  if (quando === null) return 'nunca';
  const s = Math.max(0, (agora - new Date(quando).getTime()) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d < 60 ? `há ${d} ${d === 1 ? 'dia' : 'dias'}` : `há ${Math.floor(d / 30)} meses`;
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

const SIMBOLO: Record<Situacao, string> = { ok: verde('✓'), falhou: vermelho('✗'), rodando: amarelo('●'), cancelado: cinza('⊘') };

export function textoCI(ci: ResumoCI | null): string {
  if (!ci) return cinza('?');
  if (ci.situacao === 'nenhum') return cinza('sem CI');
  return `${SIMBOLO[ci.situacao]} ${haQuanto(ci.quando)}`;
}

/** "CI ✗ há 9 h · Release ✓ há 9 h" — um por workflow. */
function textoCIPorWorkflow(ci: ResumoCI | null): string {
  if (!ci) return cinza('CI ?');
  if (ci.situacao === 'nenhum') return cinza('sem CI');
  return ci.execucoes.map((e) => `${e.workflow} ${SIMBOLO[e.situacao]} ${haQuanto(e.quando)}`).join(cinza(' · '));
}

function textoBranch(c: Checkout): string {
  const g = c.git;
  if (g.branch === null) return amarelo('(HEAD solto)');
  const marcas: string[] = [];
  if (g.upstream === null) marcas.push(cinza('sem remoto'));
  if (g.frente) marcas.push(ciano(`↑${g.frente}`));
  if (g.atras) marcas.push(amarelo(`↓${g.atras}`));
  return [g.branch, ...marcas].join(' ');
}

function textoMudancas(c: Checkout): string {
  const g = c.git;
  const partes: string[] = [];
  if (g.conflitos.length) partes.push(vermelho(plural(g.conflitos.length, 'em conflito', 'em conflito')));
  if (g.preparados.length) partes.push(verde(plural(g.preparados.length, 'preparado', 'preparados')));
  if (g.naoPreparados.length) partes.push(amarelo(plural(g.naoPreparados.length, 'não preparado', 'não preparados')));
  if (g.novos.length) partes.push(ciano(plural(g.novos.length, 'novo', 'novos')));
  return partes.length ? partes.join(cinza(' · ')) : cinza('limpo');
}

function textoMesclada(c: Checkout): string {
  const g = c.git;
  if (!g.nomePadrao || g.branch === null) return cinza('—');
  if (g.branch === g.nomePadrao) return cinza(`é a ${g.nomePadrao}`);
  if (g.naPadrao === true) return verde(`✓ na ${g.nomePadrao}`);
  if (g.naPadrao === false) return amarelo('não');
  return cinza('?');
}

function textoPR(c: Checkout): string {
  if (!c.pr) return '';
  const estado = { OPEN: verde('aberto'), MERGED: ciano('mesclado'), CLOSED: cinza('fechado') }[c.pr.estado];
  return `#${c.pr.numero} ${estado}`;
}

export function desenharResumo(e: Estado): string {
  const linhas: string[] = [];
  linhas.push(`${negrito('leme')} ${cinza('·')} ${e.raiz}`);

  const cabecalho = ['PASTA', 'BRANCH', 'ALTERAÇÕES', 'MESCLADA', 'CI', 'PR'];
  const tabela = e.grupos.map((g) => g.checkouts.map((c) => ['  ' + c.nome, textoBranch(c), textoMudancas(c), textoMesclada(c), textoCI(c.ci), textoPR(c)]));
  const larguras = cabecalho.map((h, i) => Math.max(h.length + (i === 0 ? 2 : 0), ...tabela.flat().map((l) => semCor(l[i]!).length)));
  const linha = (cols: string[]) => cols.map((t, i) => preencher(t, larguras[i]!)).join('   ').trimEnd();

  if (e.grupos.length === 0) {
    linhas.push('', cinza('Nenhum projeto com git nesta pasta.'));
  } else {
    linhas.push('', cinza(linha(['  ' + cabecalho[0]!, ...cabecalho.slice(1)])));
  }
  e.grupos.forEach((g: Grupo, i) => {
    const principal = g.checkouts[0]!.git.nomePadrao;
    const buscado = g.checkouts[0]!.git.buscadoEm;
    const info = [principal ? `${principal}: ${textoCIPorWorkflow(g.ciPrincipal)}` : null, cinza(`buscado do remoto ${haQuanto(buscado)}`)].filter(Boolean);
    linhas.push('', `${negrito(g.titulo)}   ${info.join(cinza('   ·   '))}`);
    for (const cols of tabela[i]!) linhas.push(linha(cols));
  });

  if (e.outras.length) linhas.push('', cinza(`sem git: ${e.outras.join(', ')}`));
  if (e.avisos.length) {
    linhas.push('');
    for (const a of e.avisos) linhas.push(amarelo('⚠ ') + a);
  }
  return linhas.join('\n');
}

const NOME_DO_CODIGO: Record<string, string> = { M: 'alterado', A: 'novo', D: 'apagado', R: 'renomeado', C: 'copiado', T: 'tipo mudou', U: 'conflito', '?': 'novo' };

export function desenharDetalhes(c: Checkout, historico: { naoEnviados: Commit[]; recentes: Commit[] }): string {
  const g = c.git;
  const l: string[] = [];
  const campo = (nome: string, valor: string) => l.push(`${cinza(nome.padEnd(10))}${valor}`);

  l.push(`${negrito(c.nome)}  ${cinza(c.pasta)}`, '');
  campo('Branch', `${textoBranch(c)}${g.upstream ? cinza(`  → ${g.upstream}`) : ''}`);
  campo('Mesclada', `${textoMesclada(c)}${g.padrao ? cinza(`  (comparado com ${g.padrao}, buscado ${haQuanto(g.buscadoEm)})`) : ''}`);
  campo('Autor', g.autor ?? amarelo('(nenhum configurado)'));
  if (c.pr) campo('PR', `${textoPR(c)} em ${c.pr.base} — ${c.pr.titulo}  ${cinza(c.pr.url)}`);
  if (c.ci?.execucoes.length) {
    c.ci.execucoes.forEach((ex, i) => campo(i === 0 ? 'CI' : '', `${ex.workflow} ${SIMBOLO[ex.situacao]} ${haQuanto(ex.quando)}  ${cinza(ex.url)}`));
  } else {
    campo('CI', textoCI(c.ci));
  }

  const lista = (titulo: string, arquivos: { codigo: string; caminho: string }[], pintar: (t: string) => string) => {
    if (!arquivos.length) return;
    l.push('', negrito(`${titulo} (${arquivos.length})`));
    for (const a of arquivos.slice(0, 30)) l.push(`  ${pintar((NOME_DO_CODIGO[a.codigo] ?? a.codigo).padEnd(11))}${a.caminho}`);
    if (arquivos.length > 30) l.push(cinza(`  … e mais ${arquivos.length - 30}`));
  };
  lista('Em conflito', g.conflitos, vermelho);
  lista('Preparados para o commit', g.preparados, verde);
  lista('Alterados, não preparados', g.naoPreparados, amarelo);
  lista('Novos (o git ainda não acompanha)', g.novos, ciano);
  if (!g.conflitos.length && !g.preparados.length && !g.naoPreparados.length && !g.novos.length) l.push('', verde('Nada alterado — tudo commitado.'));

  const commits = (titulo: string, cs: Commit[]) => {
    if (!cs.length) return;
    l.push('', negrito(titulo));
    for (const x of cs) l.push(`  ${ciano(x.hash)} ${x.assunto} ${cinza(haQuanto(x.quando))}`);
  };
  commits(`Commits ainda não enviados (${historico.naoEnviados.length})`, historico.naoEnviados);
  if (g.upstream === null && g.branch) l.push('', amarelo('Esta branch não tem branch remota — nada dela foi enviado ainda.'));
  commits('Últimos commits', historico.recentes);
  return l.join('\n');
}
