import { describe, expect, test } from 'bun:test';
import { lerEntrada } from '../src/entrada';

const nomes = (s: string) => lerEntrada(s).map((e) => (e.tipo === 'tecla' ? `${e.ctrl ? 'ctrl+' : ''}${e.nome}` : `${e.acao}@${e.x},${e.y}${e.delta ? `(${e.delta})` : ''}`));

describe('lerEntrada', () => {
  test('teclas: setas, Enter, Espaço, PgUp/PgDn, Home/End, Esc, Backspace e letras', () => {
    expect(nomes('\x1b[A\x1b[B\r \x1b[5~\x1b[6~\x1b[H\x1b[F\x1b\x7fq')).toEqual(['up', 'down', 'return', 'space', 'pageup', 'pagedown', 'home', 'end', 'escape', 'backspace', 'q']);
  });

  test('Ctrl+C vira "c" com ctrl; letra maiúscula vira o nome minúsculo mas guarda o texto', () => {
    const [c, A] = lerEntrada('\x03A');
    expect(c).toEqual({ tipo: 'tecla', nome: 'c', texto: '', ctrl: true });
    expect(A).toEqual({ tipo: 'tecla', nome: 'a', texto: 'A', ctrl: false });
  });

  test('texto com acento e emoji chega inteiro (para digitar argumentos)', () => {
    expect(lerEntrada('ção🙂').map((e) => (e.tipo === 'tecla' ? e.texto : ''))).toEqual(['ç', 'ã', 'o', '🙂']);
  });

  test('mouse SGR: roda para cima/baixo, apertar, arrastar e soltar (várias no mesmo pedaço)', () => {
    expect(nomes('\x1b[<64;60;10M\x1b[<65;60;10M\x1b[<0;61;8M\x1b[<32;61;12M\x1b[<0;61;12m')).toEqual(['roda@60,10(1)', 'roda@60,10(-1)', 'apertar@61,8', 'arrastar@61,12', 'soltar@61,12']);
  });

  test('botão do meio e direito são ignorados; sequência desconhecida não vira letra', () => {
    expect(nomes('\x1b[<1;5;5M\x1b[<2;5;5M\x1b[99Z')).toEqual([]);
  });
});
