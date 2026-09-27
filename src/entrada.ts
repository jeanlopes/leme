/**
 * A entrada crua do terminal (modo "raw") → eventos de tecla e de mouse. Pura (testada).
 *
 * O mouse chega no formato SGR (`\x1b[<botão;coluna;linha M|m`), que o painel liga ao abrir
 * (`?1000h` cliques, `?1002h` arrastar, `?1006h` formato SGR). Com o mouse ligado, a seleção
 * nativa do terminal passa a ser Shift+arrastar — a do leme fica presa ao painel da saída.
 */
export type Tecla = { tipo: 'tecla'; nome: string; texto: string; ctrl: boolean };
export type Mouse = { tipo: 'mouse'; acao: 'apertar' | 'arrastar' | 'soltar' | 'roda'; x: number; y: number; delta: number };
export type Evento = Tecla | Mouse;

const SEQUENCIAS: Record<string, string> = {
  '\x1b[A': 'up',
  '\x1b[B': 'down',
  '\x1b[C': 'right',
  '\x1b[D': 'left',
  '\x1bOA': 'up',
  '\x1bOB': 'down',
  '\x1b[5~': 'pageup',
  '\x1b[6~': 'pagedown',
  '\x1b[H': 'home',
  '\x1b[1~': 'home',
  '\x1bOH': 'home',
  '\x1b[F': 'end',
  '\x1b[4~': 'end',
  '\x1bOF': 'end',
  '\x1b[3~': 'delete',
};

// mouse SGR | outra sequência CSI | SS3 | Esc sozinho | um caractere (inclusive fora do BMP)
const PEDACO = /\x1b\[<\d+;\d+;\d+[Mm]|\x1b\[[0-9;?]*[A-Za-z~]|\x1bO[A-Za-z]|\x1b|[\s\S]/gu;

export function lerEntrada(dados: string): Evento[] {
  const eventos: Evento[] = [];
  for (const [p] of dados.matchAll(PEDACO)) {
    const m = p.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/);
    if (m) {
      const b = Number(m[1]);
      const x = Number(m[2]);
      const y = Number(m[3]);
      if (b & 64) eventos.push({ tipo: 'mouse', acao: 'roda', x, y, delta: (b & 1) === 0 ? 1 : -1 }); // 64 = para cima, 65 = para baixo
      else if ((b & 3) === 0) eventos.push({ tipo: 'mouse', acao: m[4] === 'm' ? 'soltar' : b & 32 ? 'arrastar' : 'apertar', x, y, delta: 0 });
      continue; // botão do meio/direito: ignorados
    }
    const nome = SEQUENCIAS[p];
    if (nome) eventos.push({ tipo: 'tecla', nome, texto: '', ctrl: false });
    else if (p === '\x1b') eventos.push({ tipo: 'tecla', nome: 'escape', texto: '', ctrl: false });
    else if (p === '\r' || p === '\n') eventos.push({ tipo: 'tecla', nome: 'return', texto: '', ctrl: false });
    else if (p === '\x7f' || p === '\b') eventos.push({ tipo: 'tecla', nome: 'backspace', texto: '', ctrl: false });
    else if (p === ' ') eventos.push({ tipo: 'tecla', nome: 'space', texto: ' ', ctrl: false });
    else if (p.length === 1 && p.charCodeAt(0) < 32) eventos.push({ tipo: 'tecla', nome: String.fromCharCode(p.charCodeAt(0) + 96), texto: '', ctrl: true }); // Ctrl+C = \x03 → "c"
    else if (!p.startsWith('\x1b')) eventos.push({ tipo: 'tecla', nome: p.toLowerCase(), texto: p, ctrl: false });
  }
  return eventos;
}
