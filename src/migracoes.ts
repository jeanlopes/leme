/**
 * Migrações pendentes: antes de subir QUALQUER script de um projeto, o leme pergunta ao próprio
 * projeto se o banco dele está em dia — e, se não estiver, oferece rodar a migração ali mesmo.
 *
 * O contrato com o projeto é um script `db:pendentes` no package.json (na raiz ou num workspace
 * `apps/*`/`packages/*`) que SÓ LÊ e responde `--json` com `{ banco, codigo, estado, pendentes[] }`:
 * código de saída 0 em dia · 2 pendente · 3 banco inacessível · 1 erro. Projeto sem o script não é
 * incomodado. Aplicar é o `db:migrate` do mesmo package.json.
 *
 * Por que existe: em 07/nov/2026 a `main` ganhou uma coluna, o banco local ficou para trás e a API
 * subiu dando 500 em toda rota — o erro só aparecia no log, e o leme mostrava o processo "no ar".
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Gerente } from './descoberta';
import { rodar, type Resultado } from './sh';

export type EstadoMigracao =
  | { tipo: 'em-dia'; banco: string }
  | { tipo: 'pendente'; banco: string; pendentes: string[] }
  | { tipo: 'inacessivel'; banco: string; causa: string }
  | { tipo: 'erro'; causa: string };

export type Alvo = { cwd: string; gerente: Gerente; temBackup: boolean };

type Pacote = { scripts?: Record<string, string> };

const lerPacote = (pasta: string): Pacote | null => {
  try {
    return JSON.parse(readFileSync(join(pasta, 'package.json'), 'utf8')) as Pacote;
  } catch {
    return null;
  }
};

const subpastas = (pasta: string): string[] => {
  try {
    return readdirSync(pasta, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'node_modules').map((d) => join(pasta, d.name));
  } catch {
    return [];
  }
};

/** Onde está o `db:pendentes` do projeto: a raiz primeiro, depois um nível de `apps/*` e `packages/*`. */
export function acharAlvo(pasta: string, gerente: Gerente): Alvo | null {
  const candidatas = [pasta, ...subpastas(join(pasta, 'apps')), ...subpastas(join(pasta, 'packages'))];
  for (const c of candidatas) {
    if (!existsSync(join(c, 'package.json'))) continue;
    const s = lerPacote(c)?.scripts;
    if (s?.['db:pendentes'] && s['db:migrate']) return { cwd: c, gerente, temBackup: Boolean(s['db:backup']) };
  }
  return null;
}

/**
 * Scripts que usam só um banco de TESTE e migram sozinhos (`dev:teste`, `dev:tudo -- --teste`): conferir o banco
 * principal seria ruído, e oferecer migrá-lo, errado.
 */
export const pulaConferencia = (script: string, args: string): boolean => /(^|:)teste?($|:)/i.test(script) || /(^|\s)--teste(\s|$)/.test(args);

/** Só se oferece aplicar em banco da própria máquina — nunca num banco remoto. */
export const ehBancoLocal = (banco: string): boolean => /^(localhost|127\.0\.0\.1|\[?::1\]?|host\.docker\.internal):/i.test(banco);

/** Traduz a resposta do `db:pendentes --json`. Pura (testada). */
export function interpretar(r: Pick<Resultado, 'codigo' | 'saida' | 'erro'>): EstadoMigracao {
  const linha = r.saida.trim().split(/\r?\n/).filter((l) => l.startsWith('{')).pop();
  if (!linha) {
    return { tipo: 'erro', causa: (r.erro || r.saida).trim().split(/\r?\n/).pop() || `saiu com código ${r.codigo} sem resposta` };
  }
  try {
    const j = JSON.parse(linha) as { banco?: string; estado?: string; pendentes?: string[]; causa?: string };
    const banco = j.banco ?? '?';
    if (j.estado === 'em-dia') return { tipo: 'em-dia', banco };
    if (j.estado === 'pendente') return { tipo: 'pendente', banco, pendentes: j.pendentes ?? [] };
    if (j.estado === 'inacessivel') return { tipo: 'inacessivel', banco, causa: j.causa ?? 'sem resposta' };
    return { tipo: 'erro', causa: j.causa ?? 'resposta desconhecida' };
  } catch {
    return { tipo: 'erro', causa: 'resposta ilegível do db:pendentes' };
  }
}

export async function consultar(a: Alvo): Promise<EstadoMigracao> {
  return interpretar(await rodar(a.gerente, ['run', 'db:pendentes', ...(a.gerente === 'npm' ? ['--'] : []), '--json'], { cwd: a.cwd }));
}

const cinza = (t: string) => `\x1b[90m${t}\x1b[0m\n`;
const verde = (t: string) => `\x1b[32m${t}\x1b[0m\n`;
const amarelo = (t: string) => `\x1b[33m${t}\x1b[0m\n`;
const vermelho = (t: string) => `\x1b[31m${t}\x1b[0m\n`;

export type Perguntar = (texto: string) => Promise<boolean>;

/**
 * Confere e, se houver pendência, pergunta. Devolve `true` para o script SUBIR de qualquer jeito
 * (a escolha é da pessoa: "não" só deixa o aviso no log); `false` só quando rodar a migração falhou —
 * subir uma API com a migração pela metade é pior que não subir.
 */
export async function conferirMigracoes(alvo: Alvo, escrever: (t: string) => void, perguntar: Perguntar): Promise<boolean> {
  const e = await consultar(alvo);
  switch (e.tipo) {
    case 'em-dia':
      escrever(cinza(`[leme] migrações em dia ✓  (${e.banco})`));
      return true;
    case 'inacessivel':
      escrever(amarelo(`[leme] não consegui conferir as migrações: banco inacessível (${e.banco}: ${e.causa}).`));
      return true;
    case 'erro':
      escrever(amarelo(`[leme] não consegui conferir as migrações: ${e.causa}`));
      return true;
    case 'pendente': {
      const lista = e.pendentes.join(', ');
      escrever(amarelo(`[leme] ${e.pendentes.length} migração(ões) pendente(s) em ${e.banco}: ${lista}`));
      if (!ehBancoLocal(e.banco)) {
        escrever(vermelho(`[leme] ${e.banco} NÃO é um banco desta máquina — não ofereço migrar por aqui. Rode você mesmo, sabendo qual banco é.`));
        return true;
      }
      const quer = await perguntar(`${e.pendentes.length} migração(ões) pendente(s) em ${e.banco}. Rodar agora${alvo.temBackup ? ' (com backup antes)' : ''}?`);
      if (!quer) {
        escrever(amarelo('[leme] migração NÃO aplicada — o script sobe assim mesmo e pode dar erro de coluna/tabela.'));
        return true;
      }
      if (alvo.temBackup) {
        escrever(cinza(`[leme] ${alvo.gerente} run db:backup -- --tag migracao`));
        const b = await rodar(alvo.gerente, ['run', 'db:backup', '--', '--tag', 'migracao'], { cwd: alvo.cwd });
        if (!b.ok) {
          escrever(vermelho(`[leme] o backup falhou — NÃO migrei. ${(b.erro || b.saida).trim().split(/\r?\n/).pop() ?? ''}`));
          return false;
        }
      }
      escrever(cinza(`[leme] ${alvo.gerente} run db:migrate`));
      const m = await rodar(alvo.gerente, ['run', 'db:migrate'], { cwd: alvo.cwd });
      if (!m.ok) {
        escrever(vermelho(`[leme] a migração falhou (código ${m.codigo}):\n${(m.erro || m.saida).trim().split(/\r?\n/).slice(-6).join('\n')}`));
        return false;
      }
      const depois = await consultar(alvo);
      if (depois.tipo === 'em-dia') {
        escrever(verde(`[leme] migrações aplicadas ✓  (${depois.banco})`));
        return true;
      }
      escrever(vermelho('[leme] migrei, mas a conferência seguinte ainda acusa pendência — confira o db:migrate.'));
      return false;
    }
  }
}

/**
 * Uma conferência por vez por projeto: `Enter` em vários scripts marcados sobe todos juntos, e sem a
 * fila cada um faria a própria pergunta e rodaria a migração duas vezes. Quem chega depois espera a
 * primeira terminar e já encontra o banco em dia.
 */
export function comFila<T>(): (tarefa: () => Promise<T>) => Promise<T> {
  let cauda: Promise<unknown> = Promise.resolve();
  return (tarefa) => {
    const r = cauda.then(tarefa, tarefa);
    cauda = r.catch(() => undefined);
    return r;
  };
}
