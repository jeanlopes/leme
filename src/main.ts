#!/usr/bin/env bun
/**
 * leme — painel de terminal para uma pasta com vários projetos.
 *
 * Digite `leme` na pasta que tem os projetos. Sem configuração nenhuma: ele lê o package.json e
 * o docker-compose.yml de cada projeto e abre a tela — processos à esquerda, a saída do escolhido
 * à direita.
 *
 * Fora de um terminal interativo ele só imprime o que descobriu e sai — sem tela para travar
 * esperando tecla.
 */
import { abrirPainel } from './painel';
import { imprimirResumo } from './resumo';

const raiz = process.cwd();

if (process.stdin.isTTY && process.stdout.isTTY) {
  await abrirPainel(raiz);
} else {
  await imprimirResumo(raiz);
}
