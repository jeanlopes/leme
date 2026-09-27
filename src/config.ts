/**
 * `.leme.json` — o que o leme não consegue adivinhar sozinho, guardado na pasta dos projetos.
 *
 * Tudo é opcional; sem o arquivo o leme funciona com o que descobre. Exemplo:
 *
 *   {
 *     "gh":  { "conta": "jeanlopes" },   // conta do gh usada nas consultas de CI e PR
 *     "git": { "autor": "jeanlopes" },   // avisa se algum projeto commita com outro nome
 *     "ignorar": ["pasta-de-backup"]     // pastas que não aparecem no painel
 *   }
 *
 * A raiz é a pasta onde está o `.leme.json`, procurada de onde você está para cima (como o git
 * procura o `.git`). Assim `leme` dentro de `projeto/src/` ainda mostra a pasta inteira.
 * Sem `.leme.json` em lugar nenhum, a raiz é a pasta atual.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type Config = {
  gh?: { conta?: string };
  git?: { autor?: string };
  ignorar?: string[];
};

export const ARQUIVO = '.leme.json';

export function acharRaiz(inicio: string): string {
  let dir = resolve(inicio);
  for (;;) {
    if (existsSync(join(dir, ARQUIVO))) return dir;
    const pai = dirname(dir);
    if (pai === dir) return resolve(inicio);
    dir = pai;
  }
}

export function lerConfig(raiz: string): Config {
  const arquivo = join(raiz, ARQUIVO);
  if (!existsSync(arquivo)) return {};
  try {
    return JSON.parse(readFileSync(arquivo, 'utf8')) as Config;
  } catch (e) {
    throw new Error(`${arquivo} não é um JSON válido: ${(e as Error).message}`);
  }
}
