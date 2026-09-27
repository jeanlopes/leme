/**
 * Pedaços de texto do painel: cores, tempo relativo, cortar/alinhar texto colorido e o resumo
 * git de um projeto em uma linha curta.
 */
import type { EstadoGit } from './git';

const comCor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const cor = (codigo: string) => (t: string) => (comCor ? `\x1b[${codigo}m${t}\x1b[0m` : t);
export const negrito = cor('1');
export const cinza = cor('90');
export const verde = cor('32');
export const vermelho = cor('31');
export const amarelo = cor('33');
export const ciano = cor('36');

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
export const semCor = (t: string) => t.replace(ANSI, '');
export const largura = (t: string) => semCor(t).length;

/** Corta em `n` colunas visíveis sem quebrar as cores (termina com reset se cortou). Pura (testada). */
export function cortar(t: string, n: number): string {
  if (largura(t) <= n) return t;
  let saida = '';
  let vistos = 0;
  for (let i = 0; i < t.length && vistos < n; ) {
    if (t[i] === '\x1b') {
      const m = t.slice(i).match(/^\x1b\[[0-9;?]*[A-Za-z]/);
      if (m) {
        saida += m[0];
        i += m[0].length;
        continue;
      }
    }
    saida += vistos === n - 1 ? '…' : t[i];
    vistos++;
    i++;
  }
  return saida + '\x1b[0m';
}

/** Corta ou completa com espaços até exatamente `n` colunas. Pura (testada). */
export function ajustar(t: string, n: number): string {
  const c = cortar(t, n);
  return c + ' '.repeat(Math.max(0, n - largura(c)));
}

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

/** "2 preparados · 1 alterado · 3 novos · ↑1 ↓5", ou '' se está tudo limpo e em dia. */
export function resumoGit(g: EstadoGit): string {
  const p: string[] = [];
  if (g.conflitos.length) p.push(vermelho(plural(g.conflitos.length, 'em conflito', 'em conflito')));
  if (g.preparados.length) p.push(verde(plural(g.preparados.length, 'preparado', 'preparados')));
  if (g.naoPreparados.length) p.push(amarelo(plural(g.naoPreparados.length, 'alterado', 'alterados')));
  if (g.novos.length) p.push(ciano(plural(g.novos.length, 'novo', 'novos')));
  if (g.frente) p.push(ciano(`↑${g.frente}`));
  if (g.atras) p.push(amarelo(`↓${g.atras}`));
  if (g.branch && g.upstream === null) p.push(cinza('sem remoto'));
  return p.join(cinza(' · '));
}
