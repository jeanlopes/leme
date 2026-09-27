/**
 * Transforma a tela guardada num terminal "invisível" (@xterm/headless) em linhas de texto com
 * cor, do tamanho exato do painel — é assim que a saída de cada processo aparece à direita.
 */
import type { IBufferCell, Terminal as Xterm } from '@xterm/headless';

function sgr(c: IBufferCell): string {
  const p: number[] = [];
  if (c.isBold()) p.push(1);
  if (c.isDim()) p.push(2);
  if (c.isItalic()) p.push(3);
  if (c.isUnderline()) p.push(4);
  if (c.isInverse()) p.push(7);
  const cor = (paleta: boolean, rgb: boolean, n: number, base: number, clara: number, estendida: number) => {
    if (paleta) {
      if (n < 8) p.push(base + n);
      else if (n < 16) p.push(clara + n - 8);
      else p.push(estendida, 5, n);
    } else if (rgb) {
      p.push(estendida, 2, (n >> 16) & 255, (n >> 8) & 255, n & 255);
    }
  };
  cor(c.isFgPalette(), c.isFgRGB(), c.getFgColor(), 30, 90, 38);
  cor(c.isBgPalette(), c.isBgRGB(), c.getBgColor(), 40, 100, 48);
  return p.join(';');
}

/**
 * `altura` linhas de `largura` colunas. `rolagem` = quantas linhas acima do fim (0 = acompanhando
 * o fim, como um terminal normal).
 */
export function linhasDoXterm(xt: Xterm, largura: number, altura: number, rolagem: number): string[] {
  const b = xt.buffer.active;
  const topo = Math.max(0, b.baseY - rolagem);
  const celula = b.getNullCell();
  const linhas: string[] = [];
  for (let y = topo; y < topo + altura; y++) {
    const linha = b.getLine(y);
    if (!linha) {
      linhas.push(' '.repeat(largura));
      continue;
    }
    let saida = '';
    let atual = '';
    let colunas = 0;
    for (let x = 0; x < xt.cols && colunas < largura; x++) {
      const c = linha.getCell(x, celula);
      if (!c) break;
      const w = c.getWidth();
      if (w === 0) continue; // segunda metade de um caractere largo
      if (colunas + w > largura) break;
      const s = sgr(c);
      if (s !== atual) {
        saida += '\x1b[0m' + (s ? `\x1b[${s}m` : '');
        atual = s;
      }
      saida += c.getChars() || ' ';
      colunas += w;
    }
    linhas.push(saida + '\x1b[0m' + ' '.repeat(Math.max(0, largura - colunas)));
  }
  return linhas;
}
