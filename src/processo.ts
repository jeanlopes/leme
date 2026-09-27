/**
 * Um processo do painel: um script de dev de um projeto (`bun run dev`, `bun run api:dev`…).
 *
 * Cada um roda num terminal próprio (PTY — ConPTY no Windows): o programa acha que está num
 * terminal de verdade, então a saída sai igual, com cores. O que ele escreve vai para um
 * terminal "invisível" (@xterm/headless), que guarda a tela e o histórico; o painel só desenha
 * o pedaço visível.
 *
 * A porta não é configurada: o leme lê da própria saída ("Local: http://localhost:5173") e
 * lembra para a próxima vez. Parar derruba a ÁRVORE inteira (`bun run dev` sobe o vite/next
 * como filhos; matar só o pai deixaria a porta presa).
 */
import { Terminal as Xterm } from '@xterm/headless';
import { spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { portasDaSaida, type DefProcesso } from './descoberta';
import { guardar, lembrar } from './estado';

export type Estado = 'parado' | 'preparando' | 'subindo' | 'no-ar' | 'caiu' | 'terminou' | 'por-fora';

export type Tamanho = { cols: number; rows: number };

/** Algo que aparece na lista e tem uma saída para mostrar: processo ou contêiner. */
export interface Item {
  readonly titulo: string;
  readonly xt: Xterm;
  temErro: boolean;
  redimensionar(t: Tamanho): void;
}

const ERRO = /\b(error|erro|exception|failed|falhou|fatal)\b|ERR!|⨯|✗/i;
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;

export function novoXterm(t: Tamanho): Xterm {
  return new Xterm({ cols: t.cols, rows: t.rows, scrollback: 5000, allowProposedApi: true });
}

/** Alguém respondendo nessa porta? Testa 127.0.0.1 e ::1 (o vite no Windows às vezes só abre um dos dois). */
export async function portaEmUso(porta: number): Promise<boolean> {
  const tenta = (host: string) =>
    new Promise<boolean>((ok) => {
      const s = createConnection({ port: porta, host });
      const fim = (v: boolean) => {
        s.destroy();
        ok(v);
      };
      s.setTimeout(400, () => fim(false));
      s.once('connect', () => fim(true));
      s.once('error', () => fim(false));
    });
  return (await tenta('127.0.0.1')) || (await tenta('::1'));
}

export function matarArvore(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-pid, 'SIGTERM'); // o PTY faz do filho líder de um grupo: mata o grupo
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // já tinha saído
      }
    }
  }
}

const comandoDoShell = (cmd: string) => (process.platform === 'win32' ? ['cmd', '/d', '/s', '/c', cmd] : ['sh', '-c', cmd]);

export class Processo implements Item {
  readonly xt: Xterm;
  estado: Estado = 'parado';
  codigo: number | null = null;
  temErro = false;
  portaRespondendo = false;
  jaRodou = false;
  args: string;
  portas: number[];
  private filho: Bun.Subprocess | null = null;
  private geracao = 0;
  private decodificador = new TextDecoder();
  private rabo = ''; // fim da última saída: um endereço pode chegar cortado entre dois pedaços

  constructor(
    readonly def: DefProcesso,
    tamanho: Tamanho,
    private readonly mudou: () => void,
    /** Antes de subir (conferir os bancos do projeto). false = não sobe. */
    private readonly preparar: (escrever: (t: string) => void) => Promise<boolean>,
  ) {
    this.xt = novoXterm(tamanho);
    const l = lembrar(def.cwd, def.script);
    this.args = l.args ?? '';
    this.portas = l.portas ?? [];
  }

  get titulo(): string {
    return `${this.def.projeto} · ${this.def.nome}`;
  }

  get comando(): string {
    const extra = this.args ? ` ${this.def.gerente === 'npm' ? '-- ' : ''}${this.args}` : '';
    return `${this.def.gerente} run ${this.def.script}${extra}`;
  }

  get rodando(): boolean {
    return this.filho !== null || this.estado === 'preparando';
  }

  /** O estado que a tela mostra: junta o que o processo está fazendo com a porta respondendo ou não. */
  get visivel(): Estado {
    if (this.estado === 'subindo' && (!this.portas.length || this.portaRespondendo)) return 'no-ar';
    if (!this.rodando && this.portaRespondendo) return 'por-fora';
    return this.estado;
  }

  // o xterm interpreta o que recebe um pouco depois: redesenha quando ele termina
  private escrever = (texto: string): void => {
    this.xt.write(texto.replace(/\r?\n/g, '\r\n'), this.mudou);
    this.mudou();
  };

  private receber(dados: Uint8Array): void {
    this.xt.write(dados, this.mudou);
    const texto = this.decodificador.decode(dados, { stream: true }).replace(ANSI, '');
    if (ERRO.test(texto)) this.temErro = true;
    const novas = portasDaSaida(this.rabo + texto).filter((p) => !this.portas.includes(p));
    this.rabo = texto.slice(-120);
    if (novas.length) {
      this.portas = [...this.portas, ...novas];
      guardar(this.def.cwd, this.def.script, { portas: this.portas });
    }
  }

  redimensionar(t: Tamanho): void {
    if (t.cols === this.xt.cols && t.rows === this.xt.rows) return;
    this.xt.resize(t.cols, t.rows);
    try {
      this.filho?.terminal?.resize(t.cols, t.rows);
    } catch {
      // terminal já fechado
    }
  }

  /** Sobe. `args` novos (tecla `a`) ficam lembrados para a próxima vez. */
  async subir(args?: string): Promise<void> {
    if (this.rodando) return;
    if (args !== undefined && args !== this.args) {
      this.args = args;
      this.portas = []; // outros argumentos podem abrir outras portas
      guardar(this.def.cwd, this.def.script, { args, portas: [] });
    }
    const geracao = ++this.geracao;
    this.jaRodou = true;
    this.codigo = null;
    this.temErro = false;
    this.estado = 'preparando';
    this.escrever(`\n`);
    const pronto = await this.preparar(this.escrever);
    if (this.geracao !== geracao) return; // parado no meio
    if (!pronto) {
      this.estado = 'caiu';
      this.escrever(`\x1b[31m[leme] ${this.def.nome} não subiu: falta serviço (veja acima).\x1b[0m\n`);
      return;
    }
    const ocupadas: number[] = [];
    for (const p of this.portas) if (await portaEmUso(p)) ocupadas.push(p);
    if (ocupadas.length) this.escrever(`\x1b[33m[leme] a porta ${ocupadas.join(', ')} já responde — outro programa pode estar nela.\x1b[0m\n`);
    this.escrever(`\x1b[90m[leme] ${this.comando}\x1b[0m\n`);
    // o terminal do Windows (e o vite) limpam a tela ao começar: empurra as linhas do leme para o
    // histórico, onde a limpeza não alcança (PgUp mostra)
    this.escrever('\n'.repeat(this.xt.rows));
    this.estado = 'subindo';
    this.mudou();

    const filho = Bun.spawn(comandoDoShell(this.comando), {
      cwd: this.def.cwd,
      env: process.env,
      terminal: { cols: this.xt.cols, rows: this.xt.rows, data: (_t, d) => this.receber(d) },
    });
    this.filho = filho;
    const codigo = await filho.exited;
    try {
      filho.terminal?.close();
    } catch {
      // já fechado
    }
    if (this.filho === filho) this.filho = null;
    if (this.geracao !== geracao) return;
    this.codigo = codigo;
    this.estado = codigo === 0 ? 'terminou' : 'caiu';
    this.escrever(codigo === 0 ? `\x1b[90m[leme] terminou.\x1b[0m\n` : `\x1b[31m[leme] caiu (código ${codigo}).\x1b[0m\n`);
  }

  async parar(): Promise<void> {
    this.geracao++;
    const filho = this.filho;
    const estava = this.rodando;
    this.estado = 'parado';
    this.portaRespondendo = false;
    if (filho) {
      matarArvore(filho.pid);
      await filho.exited;
    }
    if (estava) this.escrever(`\x1b[90m[leme] parado.\x1b[0m\n`);
    this.mudou();
  }

  async reiniciar(args?: string): Promise<void> {
    await this.parar();
    void this.subir(args);
  }
}
