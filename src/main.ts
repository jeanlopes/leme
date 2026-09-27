#!/usr/bin/env bun
/**
 * leme — painel de terminal para uma pasta com vários projetos.
 *
 * Digite `leme` em qualquer lugar: ele acha a pasta dos projetos (a que tem o `.leme.json`,
 * ou a atual), mostra o estado de cada um e abre o menu.
 *
 * Fora de um terminal interativo (saída redirecionada, CI, outro programa chamando) ele só
 * imprime o resumo e sai — sem menu para travar esperando tecla.
 */
import { acharRaiz, lerConfig } from './config';
import { coletar } from './coleta';
import { abrirMenu } from './menu';
import { desenharResumo } from './tela';

const raiz = acharRaiz(process.cwd());
const config = lerConfig(raiz);

if (process.stdin.isTTY && process.stdout.isTTY) {
  await abrirMenu(raiz, config);
} else {
  console.log(desenharResumo(await coletar(raiz, config)));
}
