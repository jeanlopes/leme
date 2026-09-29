/**
 * O diagnóstico (tecla `d`): um retrato em Markdown de tudo o que o painel está vendo — projetos e
 * git, processos (estado, comando, portas e o fim da saída), os bancos que os .env pedem e os
 * contêineres — para colar num chat ou numa issue sem print nem seleção de log.
 *
 * Nenhum valor de .env entra (só as portas) e o texto inteiro passa por `mascarar`, que apaga
 * senhas e tokens que apareçam nas saídas. É uma rede de proteção, não uma garantia: confira
 * antes de compartilhar.
 *
 * Duas partes: `diagnosticar` junta o que está vivo (confere portas, lê `docker logs`) e
 * `montarDiagnostico` escreve o texto — esta é pura e é a que os testes cobrem.
 */
import type { Terminal as Xterm } from '@xterm/headless';
import { release } from 'node:os';
import { portasUsadas, type Projeto } from './descoberta';
import type { Conteiner } from './docker';
import type { EstadoGit } from './git';
import { portaEmUso, type Estado, type Processo } from './processo';
import { rodar } from './sh';
import { resumoGit, semCor } from './tela';

const LINHAS_PROCESSO = 80;
const LINHAS_CONTEINER = 40;
const LINHAS_GIT = 30;
const LARGURA_MAXIMA = 300; // um bundle minificado numa linha só não pode engolir o diagnóstico

export type FotoProcesso = {
  nome: string;
  comando: string;
  cwd: string;
  estado: Estado;
  codigo: number | null;
  portas: { porta: number; respondendo: boolean }[];
  jaRodou: boolean;
  saida: string[]; // linhas lógicas (ver `linhasDoBuffer`)
};

/** Uma porta de banco que o .env do projeto usa, e quem responde por ela. */
export type FotoBanco = { porta: number; servico: string | null; conteinerRodando: boolean | null; respondendo: boolean };

export type FotoProjeto = {
  nome: string;
  pasta: string;
  gerente: string;
  temGit: boolean;
  git: EstadoGit | null; // null = ainda não lido
  processos: FotoProcesso[];
  bancos: FotoBanco[];
};

export type FotoConteiner = {
  servico: string;
  container: string;
  projeto: string;
  portas: number[];
  profiles: string[];
  existe: boolean;
  rodando: boolean | null;
  status: string;
  logs: string[] | null; // null = o docker não respondeu
};

export type Foto = {
  quando: Date;
  raiz: string;
  cols: number;
  rows: number;
  naTela: string | null; // o que estava selecionado
  projetos: FotoProjeto[];
  conteineres: FotoConteiner[];
};

// ---------- pedaços puros ----------

const REGRAS_MASCARA: [RegExp, string][] = [
  // usuário:senha@ numa URL de conexão
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+@/gi, '$1***@'],
  [/\b(Bearer[ \t]+)[\w.~+/=-]{8,}/gi, '$1***'],
  // senha=…, "token": "…", API_KEY: …
  [
    /([\w.-]*(?:pass(?:word|wd|phrase)|senha|segredo|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential|authorization)[\w.-]*["']?[ \t]*[=:][ \t]*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&]+)/gi,
    '$1***',
  ],
  [/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]*/g, '***'], // JWT
  [/\b(?:gh[pousr]_|github_pat_|sk-|xox[abprs]-)[\w-]{16,}|\bAKIA[0-9A-Z]{16}\b/g, '***'],
];

/** Apaga senhas e tokens que a saída de um processo possa ter escrito. Pura (testada). */
export function mascarar(texto: string): string {
  return REGRAS_MASCARA.reduce((t, [re, troca]) => t.replace(re, troca), texto);
}

/** Sem espaço no fim das linhas, sem vazias repetidas (viram uma) e sem vazias no começo nem no fim. */
function enxugar(linhas: string[]): string[] {
  const saida: string[] = [];
  for (const l of linhas.map((x) => x.trimEnd())) if (l || saida.at(-1)) saida.push(l);
  while (saida.at(-1) === '') saida.pop();
  return saida;
}

/**
 * O que está escrito no terminal invisível, em linhas lógicas: as que o xterm quebrou pela largura
 * do painel voltam a ser uma só, e as vazias que o leme empurra para o histórico ao subir um
 * processo somem (ver `enxugar`). Pura (testada).
 */
export function linhasDoBuffer(xt: Xterm): string[] {
  const b = xt.buffer.active;
  const logicas: string[] = [];
  let atual = '';
  for (let y = 0; y < b.length; y++) {
    const continua = b.getLine(y + 1)?.isWrapped ?? false;
    atual += b.getLine(y)?.translateToString(!continua) ?? ''; // linha cheia guarda o espaço da emenda
    if (continua) continue;
    logicas.push(atual);
    atual = '';
  }
  return enxugar(logicas);
}

const TIMESTAMP = /^\d{4}-\d\d-\d\dT[\d:.]+Z /;
const chaveDoTempo = (l: string) => (l.match(TIMESTAMP)?.[0] ?? '').replace(/\.(\d+)Z/, (_, f: string) => `.${f.padEnd(9, '0')}Z`);

/** `docker logs --timestamps` separa stdout de stderr: intercala de volta na ordem e tira o carimbo. Pura (testada). */
export function mesclarLogs(saida: string, erro: string): string[] {
  const ordenadas = [...saida.split(/\r?\n/), ...erro.split(/\r?\n/)]
    .filter(Boolean)
    .sort((a, b) => {
      const [ta, tb] = [chaveDoTempo(a), chaveDoTempo(b)];
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
  return enxugar(ordenadas.map((l) => semCor(l.replace(TIMESTAMP, ''))));
}

/** Um bloco de código que o próprio conteúdo não consegue fechar. Pura (testada). */
export function cerca(linhas: string[]): string[] {
  let maior = 0;
  for (const l of linhas) for (const m of l.match(/`+/g) ?? []) maior = Math.max(maior, m.length);
  const c = '`'.repeat(Math.max(3, maior + 1));
  return [c, ...linhas, c];
}

const cortarLinha = (l: string) => (l.length > LARGURA_MAXIMA ? `${l.slice(0, LARGURA_MAXIMA)}… (+${l.length - LARGURA_MAXIMA} caracteres)` : l);

function saidaEmBloco(linhas: string[], max: number): string[] {
  const titulo = linhas.length > max ? `Saída (últimas ${max} de ${linhas.length} linhas):` : `Saída (${linhas.length} ${linhas.length === 1 ? 'linha' : 'linhas'}):`;
  return [titulo, '', ...cerca(linhas.slice(-max).map(cortarLinha)), ''];
}

const ROTULO: Record<Estado, string> = {
  parado: 'parado',
  preparando: 'preparando (conferindo os bancos)',
  subindo: 'subindo',
  'no-ar': 'no ar',
  caiu: 'CAIU',
  terminou: 'terminou',
  'por-fora': 'parado, mas a porta responde (outro programa?)',
};

const rotuloDoProcesso = (p: FotoProcesso) => (p.estado === 'caiu' && p.codigo !== null ? `CAIU (código ${p.codigo})` : ROTULO[p.estado]);

const rotuloDoConteiner = (c: FotoConteiner) => (!c.existe ? 'não existe' : c.rodando ? 'rodando' : c.rodando === false ? 'parado' : c.status || 'ainda não lido');

/** "2 no ar · 1 CAIU". */
function contar(rotulos: string[]): string {
  const n = new Map<string, number>();
  for (const r of rotulos) n.set(r, (n.get(r) ?? 0) + 1);
  return [...n].map(([r, q]) => `${q} ${r}`).join(' · ') || 'nenhum';
}

function pontosDeAtencao(f: Foto): string[] {
  const l: string[] = [];
  for (const p of f.projetos) {
    for (const x of p.processos) {
      if (x.estado === 'caiu') l.push(`${p.nome} · ${x.nome}: ${rotuloDoProcesso(x)}`);
      if (x.estado === 'por-fora') l.push(`${p.nome} · ${x.nome}: a porta responde, mas quem está nela não é este processo do leme`);
    }
    for (const b of p.bancos) {
      if (b.respondendo) continue;
      const quem = b.servico ? `${b.servico}, contêiner ${b.conteinerRodando ? 'rodando' : b.conteinerRodando === false ? 'parado' : 'sem estado'}` : 'nenhum contêiner do compose declara essa porta';
      l.push(`${p.nome}: o .env usa a porta ${b.porta} (${quem}) e ninguém responde nela`);
    }
  }
  return l;
}

function secaoGit(p: FotoProjeto): string[] {
  if (!p.temGit) return ['- Git: não é um repositório', ''];
  const g = p.git;
  if (!g) return ['- Git: ainda não lido', ''];
  const l = [`- Git: \`${g.branch ?? '(HEAD solto)'}\`${g.upstream ? ` (upstream ${g.upstream})` : ''} — ${semCor(resumoGit(g)) || 'limpo e em dia'}`];
  if (g.ultimoCommit) l.push(`- Último commit: \`${g.ultimoCommit.hash}\` ${g.ultimoCommit.quando} — ${g.ultimoCommit.assunto}`);
  const arquivos = [
    ...g.conflitos.map((a) => `conflito   ${a.codigo} ${a.caminho}`),
    ...g.preparados.map((a) => `preparado  ${a.codigo} ${a.caminho}`),
    ...g.naoPreparados.map((a) => `alterado   ${a.codigo} ${a.caminho}`),
    ...g.novos.map((a) => `novo       ${a.codigo} ${a.caminho}`),
  ];
  if (arquivos.length) {
    const resto = arquivos.length - LINHAS_GIT;
    l.push('', 'Arquivos:', '', ...cerca([...arquivos.slice(0, LINHAS_GIT), ...(resto > 0 ? [`… e mais ${resto}`] : [])]));
  }
  return [...l, ''];
}

function secaoProcesso(p: FotoProcesso): string[] {
  const l = [`### ${p.nome} — ${rotuloDoProcesso(p)}`, '', `- Comando: \`${p.comando}\` (em ${p.cwd})`];
  if (p.portas.length) l.push(`- Portas: ${p.portas.map((x) => `:${x.porta} ${x.respondendo ? 'respondendo' : 'sem resposta'}`).join(' · ')}`);
  if (!p.jaRodou) return [...l, '- Não subiu nesta sessão do leme.', ''];
  if (!p.saida.length) return [...l, '- Sem saída.', ''];
  return [...l, '', ...saidaEmBloco(p.saida, LINHAS_PROCESSO)];
}

function secaoBancos(p: FotoProjeto): string[] {
  if (!p.bancos.length) return [];
  return [
    '### Bancos que os .env pedem (só as portas)',
    '',
    ...p.bancos.map((b) => `- :${b.porta} — ${b.servico ? `${b.servico} (contêiner ${b.conteinerRodando ? 'rodando' : b.conteinerRodando === false ? 'parado' : 'sem estado'})` : 'nenhum contêiner declara'} — ${b.respondendo ? 'respondendo' : 'sem resposta'}`),
    '',
  ];
}

function secaoConteiner(c: FotoConteiner): string[] {
  const estado = rotuloDoConteiner(c);
  const detalhe = c.existe && c.status && c.status !== estado ? ` (${c.status})` : '';
  const l = [`### ${c.servico} — ${estado}${detalhe}`, '', `- Contêiner: \`${c.container}\` · projeto ${c.projeto}${c.portas.length ? ` · portas ${c.portas.map((p) => `:${p}`).join(' ')}` : ''}${c.profiles.length ? ` · profiles ${c.profiles.join(', ')}` : ''}`];
  if (!c.existe) return [...l, ''];
  if (c.logs === null) return [...l, '- Logs: o docker não respondeu.', ''];
  if (!c.logs.length) return [...l, '- Sem logs.', ''];
  return [...l, '', ...saidaEmBloco(c.logs, LINHAS_CONTEINER)];
}

/** "2026-09-29T14:03:22-03:00": a hora do relógio de quem pediu, com o fuso. */
function horaLocal(d: Date): string {
  const off = -d.getTimezoneOffset();
  const dois = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, '0');
  const sem = new Date(d.getTime() + off * 60_000).toISOString().slice(0, 19);
  return `${sem}${off >= 0 ? '+' : '-'}${dois(off / 60)}:${dois(off % 60)}`;
}

/** O diagnóstico em Markdown. Pura (testada). */
export function montarDiagnostico(f: Foto): string {
  const procs = f.projetos.flatMap((p) => p.processos);
  const atencao = pontosDeAtencao(f);
  const l: string[] = [
    '# Diagnóstico do leme',
    '',
    `- Quando: ${horaLocal(f.quando)}`,
    `- Pasta: ${f.raiz}`,
    `- Sistema: ${process.platform} ${release()} · Bun ${Bun.version} · terminal ${f.cols}×${f.rows}`,
    `- Na tela: ${f.naTela ?? '—'}`,
    `- Processos: ${contar(procs.map((p) => rotuloDoProcesso(p)))}`,
    `- Contêineres: ${contar(f.conteineres.map(rotuloDoConteiner))}`,
    '',
    `> Nenhum valor de .env está aqui (só portas). Senhas e tokens que apareceram nas saídas foram trocados por \`***\` — isso pode apagar a mais e não é garantia: confira antes de compartilhar.`,
    '',
    '## Pontos de atenção',
    '',
    ...(atencao.length ? atencao.map((a) => `- ${a}`) : ['- Nenhum: nada caiu e os bancos que os .env pedem estão respondendo.']),
    '',
  ];
  for (const p of f.projetos) {
    l.push(`## ${p.nome}`, '', `- Pasta: ${p.pasta} · gerente ${p.gerente}`, ...secaoGit(p));
    if (!p.processos.length) l.push('- Sem script de dev.', '');
    for (const x of p.processos) l.push(...secaoProcesso(x));
    l.push(...secaoBancos(p));
  }
  if (f.conteineres.length) {
    l.push('## Contêineres (compose dos projetos)', '');
    for (const c of f.conteineres) l.push(...secaoConteiner(c));
  }
  return mascarar(l.join('\n').replace(/\n+$/, '') + '\n');
}

// ---------- juntar o que está vivo ----------

export type Entrada = {
  raiz: string;
  cols: number;
  rows: number;
  projetos: Projeto[];
  git: Map<string, EstadoGit>;
  procs: Processo[];
  conts: Conteiner[];
  naTela: string | null;
};

async function logsDoConteiner(nome: string): Promise<string[] | null> {
  const r = await Promise.race([rodar('docker', ['logs', '--timestamps', '--tail', String(LINHAS_CONTEINER), nome]), Bun.sleep(6000).then(() => null)]);
  return r?.ok ? mesclarLogs(r.saida, r.erro) : null;
}

/** Confere o que só se sabe na hora (portas, logs dos contêineres) e escreve o diagnóstico. */
export async function diagnosticar(e: Entrada): Promise<{ texto: string; linhas: number; kb: number }> {
  const respostas = new Map<number, Promise<boolean>>();
  const responde = (porta: number) => {
    let r = respostas.get(porta);
    if (!r) respostas.set(porta, (r = portaEmUso(porta)));
    return r;
  };

  const [projetos, conteineres] = await Promise.all([
    Promise.all(
      e.projetos.map(async (p): Promise<FotoProjeto> => ({
        nome: p.nome,
        pasta: p.pasta,
        gerente: p.gerente,
        temGit: p.temGit,
        git: e.git.get(p.nome) ?? null,
        processos: await Promise.all(
          e.procs
            .filter((x) => x.def.projeto === p.nome)
            .map(async (x): Promise<FotoProcesso> => ({
              nome: x.def.nome,
              comando: x.comando,
              cwd: x.def.cwd,
              estado: x.visivel,
              codigo: x.codigo,
              portas: await Promise.all(x.portas.map(async (porta) => ({ porta, respondendo: await responde(porta) }))),
              jaRodou: x.jaRodou,
              saida: linhasDoBuffer(x.xt),
            })),
        ),
        bancos: await Promise.all(
          portasUsadas(p).map(async (porta): Promise<FotoBanco> => {
            const c = e.conts.find((x) => x.servico.portas.includes(porta));
            return { porta, servico: c?.servico.servico ?? null, conteinerRodando: c ? c.rodando : null, respondendo: await responde(porta) };
          }),
        ),
      })),
    ),
    Promise.all(
      e.conts.map(async (c): Promise<FotoConteiner> => ({
        servico: c.servico.servico,
        container: c.servico.container,
        projeto: c.servico.projeto,
        portas: c.servico.portas,
        profiles: c.servico.profiles,
        existe: c.existe,
        rodando: c.rodando,
        status: c.status,
        logs: c.existe ? await logsDoConteiner(c.servico.container) : null,
      })),
    ),
  ]);

  const texto = montarDiagnostico({ quando: new Date(), raiz: e.raiz, cols: e.cols, rows: e.rows, naTela: e.naTela, projetos, conteineres });
  return { texto, linhas: texto.trimEnd().split('\n').length, kb: Math.max(1, Math.round(Buffer.byteLength(texto) / 1024)) };
}
