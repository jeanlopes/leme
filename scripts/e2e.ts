/**
 * Teste de ponta a ponta da TELA: roda o leme dentro de um terminal falso (Bun.Terminal), manda
 * teclas e fotografa o que aparece — o jeito de testar o painel sem ninguém no teclado.
 *
 *   bun scripts/e2e.ts <pasta-dos-projetos> '<passos>'
 *
 * Passos: JSON de [tecla, espera_ms, nome_da_foto?]. Ex. (desce 2, Enter, fotografa, sai):
 *   bun scripts/e2e.ts C:\workspace\minha-org '[["",2000,"abertura"],["\u001b[B",100],["\u001b[B",100],["\r",8000,"subindo"],["q",3000]]'
 *
 * Teclas: "\u001b[A"/"\u001b[B" setas, "\r" Enter, " " Espaço, "\u001b[5~" PgUp, "\u001b" Esc.
 * A memória do leme vai para um arquivo temporário (não suja a sua) e o que ele "copiaria" (mouse,
 * Ctrl+C, `d`) também: no fim, o e2e imprime esse texto em vez de mexer na sua área de transferência.
 */
import { Terminal as Xterm } from '@xterm/headless';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [pasta = process.cwd(), passosJson = '[["",2000,"abertura"],["q",2000]]'] = process.argv.slice(2);
const COLS = 150;
const ROWS = 36;
const copiado = join(tmpdir(), `leme-e2e-${process.pid}.clip.txt`);
const xt = new Xterm({ cols: COLS, rows: ROWS, allowProposedApi: true });
const p = Bun.spawn(['bun', resolve(import.meta.dir, '..', 'src', 'main.ts')], {
  cwd: pasta,
  env: { ...process.env, LEME_ESTADO: join(tmpdir(), `leme-e2e-${process.pid}.json`), LEME_CLIPBOARD: `arquivo:${copiado}` },
  terminal: { cols: COLS, rows: ROWS, data: (_t, d) => xt.write(d) },
});

const foto = (titulo: string) => {
  const b = xt.buffer.active;
  const linhas: string[] = [];
  for (let y = b.baseY; y < b.baseY + ROWS; y++) linhas.push(b.getLine(y)?.translateToString(true) ?? '');
  console.log(`\n===== ${titulo}\n${linhas.join('\n')}`);
};

for (const [tecla, espera, nome] of JSON.parse(passosJson) as [string, number, string?][]) {
  if (tecla) p.terminal!.write(tecla);
  await Bun.sleep(espera);
  if (nome) foto(nome);
}
const saiu = await Promise.race([p.exited, Bun.sleep(8000).then(() => null)]);
console.log(`\nleme saiu com: ${saiu ?? 'NÃO SAIU (derrubado)'}`);
if (existsSync(copiado)) {
  console.log(`\n===== o que foi copiado (última cópia)\n${readFileSync(copiado, 'utf8')}`);
  rmSync(copiado);
}
if (saiu === null) Bun.spawnSync(['taskkill', '/PID', String(p.pid), '/T', '/F']);
process.exit(saiu === 0 ? 0 : 1);
