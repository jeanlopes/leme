/**
 * `bun run instalar` — deixa o comando `leme` disponível em qualquer terminal.
 *
 * Cria um atalho na pasta de programas do bun (`~/.bun/bin`, que o instalador do bun já pôs no
 * PATH) apontando para ESTE código. Editou o leme? Vale na próxima vez que rodar, sem reinstalar.
 *
 * (O `bun link --global` seria o caminho natural, mas no Windows ele cria o atalho apontando para
 * uma pasta que não existe — testado com bun 1.3.14.)
 */
import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const principal = resolve(import.meta.dir, '..', 'src', 'main.ts');
const pastaBin = join(process.env.BUN_INSTALL ?? join(homedir(), '.bun'), 'bin');

if (!existsSync(pastaBin)) {
  console.error(`Não achei a pasta de programas do bun (${pastaBin}).`);
  process.exit(1);
}

let atalho: string;
if (process.platform === 'win32') {
  // .ps1 (e não .cmd): Ctrl+C num .cmd pergunta "Terminate batch job (Y/N)?" no meio do menu
  atalho = join(pastaBin, 'leme.ps1');
  writeFileSync(atalho, `# criado por \`bun run instalar\` do leme — aponta para o código; para remover, apague este arquivo\n& bun "${principal}" @args\nexit $LASTEXITCODE\n`);
} else {
  atalho = join(pastaBin, 'leme');
  writeFileSync(atalho, `#!/bin/sh\n# criado por \`bun run instalar\` do leme — aponta para o código; para remover, apague este arquivo\nexec bun "${principal}" "$@"\n`);
  chmodSync(atalho, 0o755);
}

const noPath = (process.env.PATH ?? '').split(delimiter).some((p) => resolve(p).toLowerCase() === resolve(pastaBin).toLowerCase());
console.log(`✓ leme instalado: ${atalho}`);
console.log(noPath ? '  Abra um terminal e digite: leme' : `  ⚠ ${pastaBin} não está no PATH — adicione para o comando funcionar.`);
