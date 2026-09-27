/**
 * O menu. Setas escolhem, Enter confirma, Esc ou Ctrl+C volta/sai — não há comando para decorar.
 */
import * as p from '@clack/prompts';
import { coletar, type Estado } from './coleta';
import type { Config } from './config';
import { lerHistorico } from './git';
import { rodarNaTela } from './sh';
import { cinza, desenharDetalhes, desenharResumo, negrito } from './tela';

async function coletarComEspera(raiz: string, config: Config): Promise<Estado> {
  const s = p.spinner();
  s.start('Lendo os projetos (git e CI)…');
  const estado = await coletar(raiz, config);
  s.stop('Pronto');
  return estado;
}

async function voltar(): Promise<void> {
  await p.select({ message: '', options: [{ value: 'voltar', label: 'Voltar ao painel' }] });
}

async function detalhes(estado: Estado): Promise<void> {
  const todos = estado.grupos.flatMap((g) => g.checkouts);
  if (!todos.length) return;
  const escolhido = await p.select({
    message: 'Qual projeto?',
    options: todos.map((c) => ({ value: c, label: c.nome, hint: c.git.branch ?? 'HEAD solto' })),
  });
  if (p.isCancel(escolhido)) return;
  const historico = await lerHistorico(escolhido.pasta, escolhido.git.upstream !== null);
  console.clear();
  console.log(desenharDetalhes(escolhido, historico) + '\n');
  await voltar();
}

/** `git fetch` em cada repositório (uma vez por repositório, não por worktree), à vista: se pedir senha, você vê. */
async function buscar(estado: Estado): Promise<void> {
  console.clear();
  for (const g of estado.grupos) {
    const c = g.checkouts[0]!;
    console.log(negrito(`\n${g.titulo}`) + cinza(`  (git fetch --prune em ${c.nome})`));
    const codigo = await rodarNaTela('git', ['fetch', '--prune'], c.pasta);
    if (codigo !== 0) console.log(`  o fetch terminou com erro (código ${codigo})`);
  }
}

export async function abrirMenu(raiz: string, config: Config): Promise<void> {
  let estado = await coletarComEspera(raiz, config);
  for (;;) {
    console.clear();
    console.log(desenharResumo(estado) + '\n');
    const escolha = await p.select({
      message: 'O que fazer?',
      options: [
        { value: 'detalhes', label: 'Ver detalhes de um projeto', hint: 'arquivos alterados, commits, PR e CI' },
        { value: 'buscar', label: 'Buscar do remoto', hint: 'git fetch em todos os repositórios' },
        { value: 'atualizar', label: 'Atualizar a tela' },
        { value: 'sair', label: 'Sair' },
      ],
    });
    if (p.isCancel(escolha) || escolha === 'sair') break;
    if (escolha === 'detalhes') await detalhes(estado);
    if (escolha === 'buscar') await buscar(estado);
    if (escolha === 'buscar' || escolha === 'atualizar') estado = await coletarComEspera(raiz, config);
  }
}
