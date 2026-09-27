/**
 * O leme fora de um terminal interativo: imprime o que descobriu na pasta — projetos, git,
 * processos (scripts de dev), bancos que cada um usa e os contêineres dos compose — e sai.
 */
import { descobrirProjetos, lerCompose, portasUsadas, type Servico } from './descoberta';
import { lerDocker } from './docker';
import { lerGit } from './git';
import { lembrar } from './estado';
import { portaEmUso } from './processo';
import { amarelo, ciano, cinza, negrito, resumoGit, verde } from './tela';

export async function imprimirResumo(raiz: string): Promise<void> {
  const projetos = descobrirProjetos(raiz);
  const [gits, compose, situacao] = await Promise.all([
    Promise.all(projetos.map((p) => (p.temGit ? lerGit(p.pasta) : Promise.resolve(null)))),
    Promise.all(projetos.map(lerCompose)),
    lerDocker(),
  ]);
  const vistos = new Set<string>();
  const todos: Servico[] = compose.flat().filter((s) => !vistos.has(s.container) && vistos.add(s.container));
  const estadoDe = (container: string) => {
    const i = situacao?.get(container);
    return situacao === null ? cinza('? Docker fora do ar') : !i ? cinza('não existe') : i.rodando ? verde('●') : cinza('○ parado');
  };

  const l: string[] = [`${negrito('leme')} ${cinza('·')} ${raiz}`];
  for (const [i, p] of projetos.entries()) {
    const g = gits[i];
    const r = g ? resumoGit(g) : '';
    l.push('', `${negrito(p.nome)} ${cinza(g ? (g.branch ?? '(HEAD solto)') : 'sem git')}${r ? '   ' + r : ''}`);
    const procs = await Promise.all(
      p.processos.map(async (d) => {
        const lem = lembrar(d.cwd, d.script);
        const no = lem.portas?.length ? (await Promise.all(lem.portas.map(portaEmUso))).some(Boolean) : null;
        const portas = lem.portas?.length ? cinza(lem.portas.map((x) => `:${x}`).join(' ')) : '';
        return `${no ? verde('●') : cinza('○')} ${d.nome}${lem.args ? ' ' + ciano(lem.args) : ''}${portas ? ' ' + portas : ''}`;
      }),
    );
    l.push(`  processos:  ${procs.length ? procs.join('   ') : cinza('nenhum script de dev')}`);
    const usadas = portasUsadas(p).map((porta) => {
      const s = todos.find((x) => x.portas.includes(porta));
      return s ? `${porta} → ${s.container} ${estadoDe(s.container)}` : amarelo(`${porta} → nenhum contêiner declara`);
    });
    if (usadas.length) l.push(`  bancos (.env): ${usadas.join('   ')}`);
    const proprios = compose[i] ?? [];
    if (proprios.length) l.push(`  compose:    ${proprios.map((s) => `${s.servico}${s.profiles.length ? cinza(`(${s.profiles.join(',')})`) : ''} ${estadoDe(s.container)}`).join('   ')}`);
    if (p.acoes.length) l.push(cinza(`  ações:      ${p.acoes.join(', ')}`));
  }
  console.log(l.join('\n'));
}
