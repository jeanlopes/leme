/**
 * A tela do leme: lista de processos à esquerda, saída do escolhido à direita, teclas embaixo.
 *
 *   ↑↓ escolhe · Enter sobe/para (os marcados, se houver) · Espaço marca · a argumentos
 *   r reinicia · PgUp/PgDn rolam a saída · q sai (e para tudo o que o leme subiu)
 *
 * Nada aqui espera a rede nem o Docker para aparecer: a lista vem dos package.json (disco), e
 * git, compose, contêineres e portas vão chegando em segundo plano.
 */
import { copiar } from './copiar';
import { linhasDoXterm } from './desenho';
import { lerEntrada, type Mouse, type Tecla } from './entrada';
import { descobrirProjetos, lerCompose, portasUsadas, type Projeto, type Servico } from './descoberta';
import { Conteiner, garantirNoAr, lerDocker } from './docker';
import { lerGit, type EstadoGit } from './git';
import { portaEmUso, Processo, type Estado, type Item, type Tamanho } from './processo';
import { ajustar, amarelo, ciano, cinza, cortar, largura, negrito, resumoGit, verde, vermelho } from './tela';

const SIMBOLO: Record<Estado, string> = {
  parado: cinza('○'),
  preparando: amarelo('◌'),
  subindo: amarelo('◌'),
  'no-ar': verde('●'),
  caiu: vermelho('✗'),
  terminou: cinza('✓'),
  'por-fora': amarelo('◐'),
};

type Linha = { texto: string; item?: Item };

function geometria(): { cols: number; rows: number; esquerda: number; saida: Tamanho } {
  const cols = Math.max(60, process.stdout.columns || 100);
  const rows = Math.max(12, process.stdout.rows || 30);
  const esquerda = Math.min(46, Math.max(32, Math.floor(cols * 0.3)));
  return { cols, rows, esquerda, saida: { cols: cols - esquerda - 2, rows: rows - 4 } };
}

/** ┌─ título ───────┐ com exatamente `n` colunas. */
function borda(titulo: string, n: number, cantoE: string, cantoD: string): string {
  if (!titulo) return cinza(cantoE + '─'.repeat(n - 2) + cantoD);
  const t = cortar(titulo, n - 6);
  return cinza(cantoE + '─ ') + t + ' ' + cinza('─'.repeat(Math.max(0, n - 5 - largura(t))) + cantoD);
}

/** Um contêiner por nome: worktrees do mesmo repositório declaram os mesmos serviços. */
function semRepetir(servicos: Servico[]): Servico[] {
  const vistos = new Set<string>();
  return servicos.filter((s) => !vistos.has(s.container) && vistos.add(s.container));
}

export async function abrirPainel(raiz: string): Promise<void> {
  const projetos = descobrirProjetos(raiz);
  let geo = geometria();
  let pendente = false;
  const pedirDesenho = () => {
    if (pendente) return;
    pendente = true;
    setTimeout(() => {
      pendente = false;
      desenhar();
    }, 30);
  };

  // compose de todos os projetos, em segundo plano (é o docker que demora)
  const composePronto: Promise<Servico[][]> = Promise.all(projetos.map(lerCompose));

  /** Os contêineres que um projeto usa: os das portas locais dos .env dele + os do compose dele (sem profile). */
  async function prepararProjeto(p: Projeto, escrever: (t: string) => void): Promise<boolean> {
    const porProjeto = await composePronto;
    const todos = semRepetir(porProjeto.flat());
    const precisa: Servico[] = [];
    for (const porta of portasUsadas(p)) {
      const s = todos.find((x) => x.portas.includes(porta));
      if (s) precisa.push(s);
      else if (!(await portaEmUso(porta))) escrever(`\x1b[33m[leme] o .env de ${p.nome} usa a porta ${porta}, mas nada responde nela e nenhum compose da pasta declara um contêiner nela.\x1b[0m\n`);
    }
    precisa.push(...(porProjeto[projetos.indexOf(p)] ?? []).filter((s) => !s.profiles.length));
    return garantirNoAr(semRepetir(precisa), escrever);
  }

  const procs = projetos.flatMap((p) => p.processos.map((d) => new Processo(d, geo.saida, pedirDesenho, (esc) => prepararProjeto(p, esc))));
  let conts: Conteiner[] = [];
  let itens: Item[] = [...procs];
  const git = new Map<string, EstadoGit>();
  const marcados = new Set<Item>();
  const rolagem = new Map<Item, number>();
  let sel = 0;
  let mensagem = '';
  let mensagemAte = 0;
  let saindo = false;
  let anterior: string[] = [];
  let digitando: { item: Processo; texto: string } | null = null;
  // seleção de linhas no painel da saída (arrastar com o mouse): linhas do histórico do xterm
  let selecao: { item: Item; ancora: number; ponta: number; arrastou: boolean } | null = null;
  // o que foi desenhado na lista (o clique precisa saber que item está em cada linha)
  let layout: { lista: Linha[]; inicio: number; alturaLista: number } = { lista: [], inicio: 0, alturaLista: 0 };

  const avisar = (m: string) => {
    mensagem = m;
    mensagemAte = Date.now() + 5000;
    pedirDesenho();
  };
  const selecionado = () => itens[sel];

  // ---------- desenho ----------

  function linhaDoProcesso(p: Processo, escolhido: boolean): string {
    const e = p.visivel;
    const marca = marcados.has(p) ? ciano('◆') : ' ';
    const extra: string[] = [];
    if (p.args) extra.push(ciano(p.args));
    if (p.portas.length) extra.push(cinza(p.portas.map((x) => `:${x}`).join(' ')));
    if (e === 'caiu' && p.codigo !== null) extra.push(vermelho(`(${p.codigo})`));
    if (p.temErro && !escolhido) extra.push(vermelho('!'));
    if (p.def.descricao) extra.push(cinza(p.def.descricao)); // por último: é o que o corte come
    return `  ${marca}${SIMBOLO[e]} ${p.def.nome} ${extra.join(' ')}`;
  }

  function linhaDoConteiner(c: Conteiner): string {
    const marca = marcados.has(c) ? ciano('◆') : ' ';
    const s = c.ocupado ? amarelo('◌') : c.rodando ? verde('●') : c.rodando === false ? cinza('○') : cinza('?');
    const porta = c.servico.portas.length ? cinza(c.servico.portas.map((x) => `:${x}`).join(' ')) : '';
    const perfil = c.servico.profiles.length ? cinza(`(${c.servico.profiles.join(',')})`) : '';
    return `  ${marca}${s} ${c.servico.servico} ${porta} ${perfil} ${c.existe ? '' : cinza('não existe')}`;
  }

  function linhasDaLista(): Linha[] {
    const l: Linha[] = [];
    for (const p of projetos) {
      const g = git.get(p.nome);
      l.push({ texto: `${negrito(p.nome)} ${cinza(g ? (g.branch ?? '(HEAD solto)') : p.temGit ? '…' : 'sem git')}` });
      const r = g ? resumoGit(g) : '';
      if (r) l.push({ texto: `    ${r}` });
      for (const x of procs.filter((x) => x.def.projeto === p.nome)) l.push({ texto: linhaDoProcesso(x, x === selecionado()), item: x });
      if (!p.processos.length) l.push({ texto: cinza('    (sem script de dev)') });
    }
    if (conts.length) {
      l.push({ texto: negrito('docker') });
      for (const c of conts) l.push({ texto: linhaDoConteiner(c), item: c });
    }
    return l;
  }

  function tituloDaSaida(item: Item): string {
    if (item instanceof Processo) {
      const e = item.visivel;
      const portas = item.portas.map((x) => `:${x}`).join(' ');
      const estado = {
        parado: cinza('parado'),
        preparando: amarelo('conferindo os bancos…'),
        subindo: amarelo(`subindo… ${portas}`),
        'no-ar': verde(portas ? `no ar ${portas}` : 'rodando'),
        caiu: vermelho(`caiu (código ${item.codigo})`),
        terminou: cinza('terminou'),
        'por-fora': amarelo(`${portas} ocupada por outro programa`),
      }[e];
      return `${negrito(item.titulo)} ─ ${item.comando} ─ ${estado}`;
    }
    const c = item as Conteiner;
    return `${negrito(c.titulo)} ─ ${c.servico.container} ─ ${c.rodando ? verde(c.status) : cinza(c.status)}`;
  }

  function conteudoDaSaida(item: Item): string[] {
    const { cols, rows } = geo.saida;
    const dica = (linhas: string[]) => Array.from({ length: rows }, (_, i) => ajustar(i >= 1 && i - 1 < linhas.length ? '  ' + linhas[i - 1] : '', cols));
    if (item instanceof Processo && !item.jaRodou && !item.portaRespondendo) {
      return dica([
        ...(item.def.descricao ? [negrito(item.def.descricao), ''] : []),
        cinza('Parado.'),
        '',
        `Enter sobe:  ${item.comando}`,
        cinza(`em ${item.def.cwd}`),
        '',
        cinza('a  sobe com argumentos (ex.: --teste) — o leme lembra para a próxima vez'),
        ...(item.def.descricao ? [] : ['', cinza('Sem descrição. Ponha uma em "scripts-info" no package.json: { "scripts-info": { "' + item.def.script + '": "…" } }')]),
      ]);
    }
    if (item instanceof Conteiner && !item.rodando && item.xt.buffer.active.length <= 1) {
      return dica([cinza(item.existe ? 'Parado. Enter liga o contêiner.' : `Não existe. Enter cria (docker compose up -d ${item.servico.servico}, em ${item.servico.projeto}).`)]);
    }
    const linhas = linhasDoXterm(item.xt, cols, rows, rolagem.get(item) ?? 0);
    if (selecao?.item !== item) return linhas;
    const topo = topoDaSaida(item);
    const [de, ate] = [Math.min(selecao.ancora, selecao.ponta), Math.max(selecao.ancora, selecao.ponta)];
    return linhas.map((l, i) => (topo + i >= de && topo + i <= ate ? '\x1b[7m' + l.replace(/\x1b\[0m/g, '\x1b[0m\x1b[7m') + '\x1b[0m' : l));
  }

  /** A linha do histórico do xterm que está no topo do painel (a rolagem conta de baixo para cima). */
  function topoDaSaida(item: Item): number {
    return Math.max(0, item.xt.buffer.active.baseY - (rolagem.get(item) ?? 0));
  }

  function rodapeDeTeclas(): string {
    if (digitando) {
      return ` ${negrito(`argumentos para ${digitando.item.def.script}:`)} ${digitando.texto}${'\x1b[7m \x1b[0m'}   ${cinza('Enter sobe · Esc cancela')}`;
    }
    const k = (t: string, o: string) => `${negrito(t)} ${cinza(o)}`;
    return ' ' + [
      k('↑↓', 'escolher'),
      k('Enter', marcados.size ? `subir/parar os ${marcados.size} marcados` : 'subir/parar'),
      k('Espaço', 'marcar'),
      k('a', 'argumentos'),
      k('r', 'reiniciar'),
      k('PgUp/PgDn', 'rolar'),
      k('mouse', 'roda rola · arrastar copia'),
      k('q', 'sair'),
    ].join('   ');
  }

  function desenhar(): void {
    const { cols, rows, esquerda } = geo;
    const direita = cols - esquerda;
    const item = selecionado();
    if (item) item.temErro = false; // está olhando: já viu

    const quadro: string[] = [];
    const msg = Date.now() < mensagemAte ? '   ' + amarelo(mensagem) : '';
    // o aviso não pode sumir atrás de um caminho longo: o caminho encolhe
    const caminho = cortar(raiz, Math.max(10, cols - 12 - largura(msg)));
    quadro.push(ajustar(` ${negrito('leme')} ${cinza('·')} ${caminho}${msg}`, cols));

    const lista = linhasDaLista();
    const alturaLista = rows - 4;
    const idxSel = lista.findIndex((l) => l.item === item);
    const inicio = Math.max(0, Math.min(idxSel - Math.floor(alturaLista / 2), lista.length - alturaLista));
    layout = { lista, inicio, alturaLista };
    const saida = item ? conteudoDaSaida(item) : [];
    const rol = item ? (rolagem.get(item) ?? 0) : 0;

    quadro.push(borda(negrito('PROCESSOS'), esquerda, '┌', '┐') + borda(item ? tituloDaSaida(item) : '', direita, '┌', '┐'));
    for (let i = 0; i < alturaLista; i++) {
      const l = lista[inicio + i];
      let e = ajustar(l ? l.texto : '', esquerda - 2);
      if (l?.item && l.item === item) e = '\x1b[48;5;237m' + e.replace(/\x1b\[0m/g, '\x1b[0m\x1b[48;5;237m') + '\x1b[0m';
      quadro.push(cinza('│') + e + cinza('│') + cinza('│') + (saida[i] ?? ' '.repeat(direita - 2)) + cinza('│'));
    }
    const rodape = rol ? amarelo(`↑ ${rol} linhas acima do fim — End volta`) : '';
    quadro.push(borda('', esquerda, '└', '┘') + borda(rodape, direita, '└', '┘'));
    quadro.push(ajustar(rodapeDeTeclas(), cols));

    let out = '\x1b[?2026h';
    quadro.forEach((l, i) => {
      if (anterior[i] !== l) out += `\x1b[${i + 1};1H${l}\x1b[0m`;
    });
    out += '\x1b[?2026l';
    anterior = quadro;
    process.stdout.write(out);
  }

  // ---------- ações ----------

  function acionar(): void {
    const alvos = marcados.size ? itens.filter((i) => marcados.has(i)) : [selecionado()].filter((i): i is Item => Boolean(i));
    marcados.clear();
    const ps = alvos.filter((i): i is Processo => i instanceof Processo);
    const subir = ps.some((p) => !p.rodando);
    for (const p of ps) {
      if (subir && !p.rodando) void p.subir();
      if (!subir) void p.parar();
    }
    for (const c of alvos.filter((i): i is Conteiner => i instanceof Conteiner)) void c.alternar();
    pedirDesenho();
  }

  function rolar(delta: number): void {
    const item = selecionado();
    if (!item) return;
    rolagem.set(item, Math.max(0, Math.min(item.xt.buffer.active.baseY, (rolagem.get(item) ?? 0) + delta)));
    pedirDesenho();
  }

  function escolher(delta: number): void {
    if (!itens.length) return;
    sel = (sel + delta + itens.length) % itens.length;
    const item = selecionado();
    if (item instanceof Conteiner) item.seguirLogs();
    pedirDesenho();
  }

  async function sair(): Promise<void> {
    if (saindo) process.exit(1); // segundo q enquanto para: sai sem esperar
    saindo = true;
    const rodando = procs.filter((p) => p.rodando);
    if (rodando.length) {
      avisar(`parando ${rodando.length} processo(s)…`);
      desenhar();
      await Promise.all(rodando.map((p) => p.parar()));
    }
    for (const c of conts) c.encerrar();
    restaurar();
    process.exit(0);
  }

  // ---------- em segundo plano: git, compose/contêineres, portas ----------

  async function verGit(): Promise<void> {
    await Promise.all(projetos.filter((p) => p.temGit).map(async (p) => git.set(p.nome, await lerGit(p.pasta))));
    pedirDesenho();
  }
  async function verDocker(): Promise<void> {
    if (!conts.length) return;
    const situacao = await lerDocker();
    for (const c of conts) c.atualizar(situacao);
    const item = selecionado();
    if (item instanceof Conteiner) item.seguirLogs();
  }
  async function verPortas(): Promise<void> {
    await Promise.all(
      procs.filter((p) => p.portas.length).map(async (p) => {
        const antes = p.portaRespondendo;
        p.portaRespondendo = (await Promise.all(p.portas.map(portaEmUso))).some(Boolean);
        if (antes !== p.portaRespondendo) pedirDesenho();
      }),
    );
  }
  const repetir = (f: () => Promise<void>, ms: number) => {
    const vez = () => void f().finally(() => setTimeout(vez, ms));
    vez();
  };
  void composePronto.then((porProjeto) => {
    conts = semRepetir(porProjeto.flat()).map((s) => new Conteiner(s, geo.saida, pedirDesenho));
    itens = [...procs, ...conts];
    repetir(verDocker, 3_000);
    pedirDesenho();
  });

  // ---------- terminal ----------

  // mouse: ?1000 cliques, ?1002 arrastar, ?1006 formato SGR (coordenadas sem limite de 223)
  const MOUSE_LIGA = '\x1b[?1000h\x1b[?1002h\x1b[?1006h';
  const MOUSE_DESLIGA = '\x1b[?1000l\x1b[?1002l\x1b[?1006l';

  function restaurar(): void {
    process.stdout.write(MOUSE_DESLIGA + '\x1b[?25h\x1b[?1049l');
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  }
  process.on('SIGINT', () => avisar('Ctrl+C não sai: para sair, aperte q'));
  process.on('uncaughtException', (e) => {
    for (const p of procs) if (p.rodando) void p.parar();
    restaurar();
    console.error(e);
    process.exit(1);
  });

  function teclaDigitando(t: Tecla): void {
    const d = digitando!;
    if (t.nome === 'escape') digitando = null;
    else if (t.nome === 'return') {
      digitando = null;
      void d.item.reiniciar(d.texto.trim());
    } else if (t.nome === 'backspace') d.texto = d.texto.slice(0, -1);
    else if (t.texto && !t.ctrl) d.texto += t.texto;
    pedirDesenho();
  }

  /** Ctrl+C copia de novo o que estiver selecionado; sem seleção, lembra que sair é o q. */
  function ctrlC(): void {
    const sel = textoSelecionado();
    if (sel) {
      copiar(sel.texto);
      return avisar(`${sel.linhas} linha(s) copiada(s) — para sair, aperte q`);
    }
    avisar('Ctrl+C não sai: para sair, aperte q (arrastar sobre a saída já copia)');
  }

  /** O texto das linhas selecionadas no painel da saída (do item que está na tela), ou null. */
  function textoSelecionado(): { texto: string; linhas: number } | null {
    const item = selecionado();
    if (!selecao || !item || selecao.item !== item) return null;
    const [de, ate] = [Math.min(selecao.ancora, selecao.ponta), Math.max(selecao.ancora, selecao.ponta)];
    const b = item.xt.buffer.active;
    const texto = Array.from({ length: ate - de + 1 }, (_, i) => b.getLine(de + i)?.translateToString(true) ?? '')
      .join('\n')
      .replace(/\n+$/, '');
    return texto.trim() ? { texto, linhas: ate - de + 1 } : null;
  }

  function tecla(t: Tecla): void {
    // Ctrl+C NÃO sai (pedido do dono: o hábito de copiar derrubava tudo) — só o q sai
    if (t.ctrl && t.nome === 'c') return ctrlC();
    if (digitando) return teclaDigitando(t);
    const item = selecionado();
    switch (t.nome) {
      case 'q':
        return void sair();
      case 'up':
      case 'k':
        return escolher(-1);
      case 'down':
      case 'j':
        return escolher(1);
      case 'return':
        return acionar();
      case 'space':
        if (item) marcados.has(item) ? marcados.delete(item) : marcados.add(item);
        return pedirDesenho();
      case 'escape':
        marcados.clear();
        selecao = null;
        return pedirDesenho();
      case 'a':
        if (item instanceof Processo) digitando = { item, texto: item.args };
        return pedirDesenho();
      case 'r':
        if (item instanceof Processo) void item.reiniciar();
        if (item instanceof Conteiner && item.rodando) avisar('contêiner: Enter desliga, Enter de novo liga');
        return pedirDesenho();
      case 'pageup':
        return rolar(geo.saida.rows - 2);
      case 'pagedown':
        return rolar(-(geo.saida.rows - 2));
      case 'home':
        return rolar(Number.MAX_SAFE_INTEGER);
      case 'end':
        if (item) rolagem.set(item, 0);
        return pedirDesenho();
    }
  }

  /**
   * Mouse. A tela: linha 1 cabeçalho, 2 borda, 3… conteúdo, penúltima borda, última teclas;
   * a lista ocupa as colunas 2…esquerda-1 e a saída esquerda+2…cols-1 (coordenadas a partir de 1).
   * Roda: sobre a saída rola o log, sobre a lista troca o item. Clique na lista escolhe. Arrastar
   * sobre a saída seleciona linhas SÓ dela e, ao soltar, copia para a área de transferência.
   */
  function mouse(m: Mouse): void {
    const linha = m.y - 3;
    const naSaida = m.x > geo.esquerda;
    const item = selecionado();
    if (m.acao === 'roda') return naSaida ? rolar(3 * m.delta) : escolher(-m.delta);
    if (m.acao === 'apertar') {
      selecao = null;
      if (linha < 0 || linha >= layout.alturaLista) return pedirDesenho();
      if (!naSaida) {
        const alvo = layout.lista[layout.inicio + linha]?.item;
        if (alvo) {
          sel = itens.indexOf(alvo);
          if (alvo instanceof Conteiner) alvo.seguirLogs();
        }
      } else if (item) {
        const abs = topoDaSaida(item) + linha;
        selecao = { item, ancora: abs, ponta: abs, arrastou: false };
      }
      return pedirDesenho();
    }
    if (!selecao || selecao.item !== item || !item) return;
    // arrastando para fora da borda de cima/baixo, o log rola junto
    if (linha < 0) rolar(1);
    else if (linha >= layout.alturaLista) rolar(-1);
    const dentro = Math.max(0, Math.min(layout.alturaLista - 1, linha));
    selecao.ponta = topoDaSaida(item) + dentro;
    if (m.acao === 'arrastar') selecao.arrastou = true;
    // clique simples (sem arrastar) não copia nada: só limpa
    if (m.acao === 'soltar' && !selecao.arrastou) selecao = null;
    else if (m.acao === 'soltar') {
      const sel = textoSelecionado();
      if (sel) {
        copiar(sel.texto);
        avisar(`${sel.linhas} linha(s) copiada(s)`);
      } else selecao = null;
    }
    pedirDesenho();
  }

  process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[2J' + MOUSE_LIGA);
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  process.stdin.on('data', (dados: string) => {
    for (const ev of lerEntrada(dados)) ev.tipo === 'tecla' ? tecla(ev) : mouse(ev);
  });
  process.stdout.on('resize', () => {
    geo = geometria();
    for (const i of itens) i.redimensionar(geo.saida);
    anterior = [];
    process.stdout.write('\x1b[2J');
    pedirDesenho();
  });

  desenhar();
  repetir(verGit, 10_000);
  repetir(verPortas, 1_500);
  setInterval(() => {
    if (mensagem && Date.now() > mensagemAte) {
      mensagem = '';
      pedirDesenho();
    }
  }, 1000);
}
