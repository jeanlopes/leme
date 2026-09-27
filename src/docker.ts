/**
 * Contêineres na lista (os declarados nos compose dos projetos) e a garantia de que os bancos de
 * um projeto estão de pé antes de subir o dev dele — sem rodar `docker compose up` às cegas:
 *
 *   rodando          → nada;
 *   existe, parado   → `docker start <contêiner>` (não cria nada);
 *   não existe       → `docker compose up -d <serviço>` na pasta do projeto que o declara.
 */
import type { Terminal as Xterm } from '@xterm/headless';
import type { Servico } from './descoberta';
import { matarArvore, novoXterm, portaEmUso, type Item, type Tamanho } from './processo';
import { rodar } from './sh';

export type Situacao = Map<string, { rodando: boolean; status: string }> | null;

/** `docker ps -a` → contêiner → rodando? e status ("Up 13 hours (healthy)"). null = Docker fora do ar. */
export async function lerDocker(): Promise<Situacao> {
  const r = await rodar('docker', ['ps', '-a', '--format', '{{.Names}}\t{{.State}}\t{{.Status}}']);
  if (!r.ok) return null;
  const mapa = new Map<string, { rodando: boolean; status: string }>();
  for (const linha of r.saida.split(/\r?\n/).filter(Boolean)) {
    const [nome = '', estado = '', status = ''] = linha.split('\t');
    mapa.set(nome, { rodando: estado === 'running', status });
  }
  return mapa;
}

const cinza = (t: string) => `\x1b[90m${t}\x1b[0m\n`;
const verde = (t: string) => `\x1b[32m${t}\x1b[0m\n`;
const vermelho = (t: string) => `\x1b[31m${t}\x1b[0m\n`;

/** Liga o que estiver parado e espera a porta responder. Devolve false se algum não subiu. */
export async function garantirNoAr(servicos: Servico[], escrever: (t: string) => void): Promise<boolean> {
  if (!servicos.length) return true;
  const situacao = await lerDocker();
  if (situacao === null) {
    escrever(vermelho(`[leme] Docker fora do ar — não consigo conferir ${servicos.map((s) => s.container).join(', ')}.`));
    return false;
  }
  let tudoOk = true;
  for (const s of servicos) {
    const info = situacao.get(s.container);
    if (info?.rodando) {
      escrever(cinza(`[leme] ${s.servico} (${s.container}) no ar ✓`));
      continue;
    }
    const r = info
      ? (escrever(cinza(`[leme] ${s.servico} (${s.container}) parado → docker start ${s.container}`)), await rodar('docker', ['start', s.container]))
      : (escrever(cinza(`[leme] ${s.container} não existe → docker compose up -d ${s.servico}  (em ${s.projeto})`)),
        await rodar('docker', ['compose', ...s.profiles.flatMap((p) => ['--profile', p]), 'up', '-d', s.servico], { cwd: s.pasta }));
    if (!r.ok) {
      escrever(vermelho(`[leme] não subiu ${s.container}: ${r.erro.trim().split(/\r?\n/).pop()}`));
      tudoOk = false;
      continue;
    }
    for (const porta of s.portas) {
      let ok = false;
      for (let i = 0; i < 60 && !(ok = await portaEmUso(porta)); i++) await Bun.sleep(1000);
      escrever(ok ? verde(`[leme] ${s.servico} respondendo na porta ${porta} ✓`) : vermelho(`[leme] ${s.servico} subiu, mas a porta ${porta} não respondeu em 60 s`));
      tudoOk &&= ok;
    }
  }
  return tudoOk;
}

export class Conteiner implements Item {
  readonly xt: Xterm;
  rodando: boolean | null = null; // null = ainda não sei / não existe
  existe = true;
  status = '';
  temErro = false; // log de banco é cheio de "warning"/"error" inofensivos: não marca
  ocupado = false;
  private logs: Bun.Subprocess | null = null;

  constructor(
    readonly servico: Servico,
    tamanho: Tamanho,
    private readonly mudou: () => void,
  ) {
    this.xt = novoXterm(tamanho);
  }

  get titulo(): string {
    return `docker · ${this.servico.servico}`;
  }

  atualizar(situacao: Situacao): void {
    const info = situacao?.get(this.servico.container);
    const antes = `${this.rodando}${this.existe}${this.status}`;
    this.existe = situacao === null || Boolean(info);
    this.rodando = info ? info.rodando : null;
    this.status = situacao === null ? 'Docker fora do ar' : (info?.status ?? 'não existe');
    if (antes !== `${this.rodando}${this.existe}${this.status}`) this.mudou();
  }

  redimensionar(t: Tamanho): void {
    if (t.cols === this.xt.cols && t.rows === this.xt.rows) return;
    this.xt.resize(t.cols, t.rows);
    try {
      this.logs?.terminal?.resize(t.cols, t.rows);
    } catch {
      // já fechado
    }
  }

  /** Segue os logs do contêiner (uma vez; recomeça se ele reiniciar). */
  seguirLogs(): void {
    if (this.logs || !this.rodando) return;
    const p = Bun.spawn(['docker', 'logs', '-f', '--tail', '300', this.servico.container], {
      terminal: { cols: this.xt.cols, rows: this.xt.rows, data: (_t, d) => this.xt.write(d, this.mudou) },
    });
    this.logs = p;
    void p.exited.then(() => {
      if (this.logs === p) this.logs = null;
    });
  }

  /** Enter na lista: liga (garantindo, como antes de um dev) ou desliga. */
  async alternar(): Promise<void> {
    if (this.ocupado) return;
    this.ocupado = true;
    this.mudou();
    const escrever = (t: string) => this.xt.write(t.replace(/\r?\n/g, '\r\n'), this.mudou);
    if (this.rodando) {
      escrever(cinza(`\n[leme] docker stop ${this.servico.container}`));
      const r = await rodar('docker', ['stop', this.servico.container]);
      if (!r.ok) escrever(vermelho(`[leme] falhou: ${r.erro.trim()}`));
    } else {
      await garantirNoAr([this.servico], escrever);
    }
    this.ocupado = false;
    this.mudou();
  }

  encerrar(): void {
    if (this.logs) matarArvore(this.logs.pid);
  }
}
