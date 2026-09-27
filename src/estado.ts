/**
 * A memória do próprio leme: as portas que cada processo anunciou e os argumentos que você usou
 * da última vez. Fica na pasta do leme no seu usuário — NUNCA dentro dos projetos.
 *
 *   Windows: %LOCALAPPDATA%\leme\estado.json    outros: ~/.local/state/leme/estado.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

type Lembranca = { portas?: number[]; args?: string };

const ARQUIVO = process.env.LEME_ESTADO ?? (process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'leme', 'estado.json') : join(homedir(), '.local', 'state', 'leme', 'estado.json'));

let memoria: Record<string, Lembranca> | null = null;

function carregar(): Record<string, Lembranca> {
  if (memoria) return memoria;
  try {
    memoria = existsSync(ARQUIVO) ? (JSON.parse(readFileSync(ARQUIVO, 'utf8')) as Record<string, Lembranca>) : {};
  } catch {
    memoria = {};
  }
  return memoria;
}

const chave = (cwd: string, script: string) => `${cwd.toLowerCase()}|${script}`;

export function lembrar(cwd: string, script: string): Lembranca {
  return carregar()[chave(cwd, script)] ?? {};
}

export function guardar(cwd: string, script: string, mudanca: Lembranca): void {
  const m = carregar();
  m[chave(cwd, script)] = { ...m[chave(cwd, script)], ...mudanca };
  try {
    mkdirSync(dirname(ARQUIVO), { recursive: true });
    writeFileSync(ARQUIVO, JSON.stringify(m, null, 2));
  } catch {
    // sem onde gravar: segue só na memória
  }
}
