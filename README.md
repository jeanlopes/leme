# leme

Painel de terminal para uma pasta com vários projetos. Digite `leme` na pasta e ele mostra, numa
tela só, tudo o que dá para subir — e a saída de cada um, ao vivo. Sem configuração: ele lê o que
os projetos já declaram.

```
 leme · C:\workspace\minha-org
┌─ PROCESSOS ─────────────────────────┐┌─ loja · web:dev ─ bun run web:dev ─ no ar :5173 ───────┐
│loja main                            ││  VITE v6.4.3  ready in 659 ms                           │
│    2 alterados · ↑1                 ││                                                         │
│   ○ dev                             ││  ➜  Local:   http://localhost:5173/                     │
│   ● web:dev :5173                   ││                                                         │
│   ✗ api:dev :3333 (1)               ││                                                         │
│pagamentos plano-12                  ││                                                         │
│  ◆○ dev                             ││                                                         │
│docker                               ││                                                         │
│   ● mariadb :3306                   ││                                                         │
│   ○ redis :6379                     ││                                                         │
└─────────────────────────────────────┘└─────────────────────────────────────────────────────────┘
 ↑↓ escolher   Enter subir/parar   Espaço marcar   a argumentos   r reiniciar   d diagnóstico   q sair
```

## Instalar

Precisa de [bun](https://bun.sh) (1.3+), git e, para os contêineres, Docker.

```powershell
cd C:\workspace\leme
bun install
bun run instalar
```

O `instalar` cria `~/.bun/bin/leme.ps1` apontando para este código — editou, vale na hora.
Para desinstalar, apague esse arquivo.

## O que ele descobre sozinho

| o que aparece | de onde vem |
|---|---|
| projetos | subpastas com `package.json` (ou a própria pasta, se for um projeto) |
| processos | os scripts de dev do `package.json`: `dev`, `dev:*`, `*:dev`. Monorepo sem nenhum na raiz: os dos workspaces |
| git | branch, preparado / alterado / novo, à frente / atrás do remoto |
| contêineres | o `docker-compose.yml` de cada projeto (`docker compose config`, todos os profiles) |
| bancos que cada projeto usa | as connection strings **locais** dos `.env` (o `.env.example` vale como padrão, o `.env` por cima). Só a porta é lida; hosts remotos e endereços `http`/`ws` ficam de fora |
| portas de cada processo | o endereço que o próprio processo anuncia na saída (`Local: http://localhost:5173`), lembrado para a próxima vez |

## Usar

- **Enter** sobe ou para o escolhido — ou todos os marcados com **Espaço**, em paralelo.
- Antes de subir, o leme confere os contêineres dos bancos que o projeto usa: rodando, nada;
  parado, `docker start`; inexistente, `docker compose up -d <serviço>` na pasta de quem o declara.
  Nunca um `compose up` às cegas.
- **a** sobe com argumentos (ex.: `--teste`). O leme lembra para a próxima vez.
- **r** reinicia. **PgUp/PgDn** rolam a saída, **End** volta ao fim.
- **Mouse:** a roda sobre a saída rola o log (sobre a lista, troca o item); clique na lista escolhe;
  **arrastar sobre a saída seleciona linhas só daquele painel** e, ao soltar, copia para a área de
  transferência. A seleção nativa do terminal (que atravessa as duas colunas) continua no
  **Shift+arrastar**.
- **d** copia um **diagnóstico** de tudo para a área de transferência, em Markdown, pronto para
  colar num chat ou numa issue (sem print, sem selecionar log). Vai nele: quando/onde/sistema, o que
  estava na tela, **pontos de atenção** (o que caiu, porta ocupada por outro programa, banco do
  `.env` que ninguém atende), git de cada projeto (branch, arquivos alterados, último commit) e,
  de cada processo, estado, comando, portas e as últimas 80 linhas da saída; dos contêineres,
  estado e as últimas 40 linhas de `docker logs`. Nenhum valor de `.env` entra (só as portas) e
  senhas/tokens que apareceram nas saídas viram `***` — é uma rede de proteção, não uma garantia:
  confira antes de compartilhar.
- Um processo que escreveu erro enquanto você olhava outro ganha um **!** vermelho na lista.
- **q** sai e para tudo o que o leme subiu (os contêineres continuam).
- **Ctrl+C não sai** (o hábito de copiar derrubava tudo): com linhas selecionadas, copia de novo;
  sem seleção, só lembra que sair é o **q**. Um segundo **q** enquanto ele para os processos força a saída.

Fora de um terminal interativo (saída redirecionada), o leme só imprime o que descobriu e sai.

A memória do leme (portas vistas, argumentos usados) fica em `%LOCALAPPDATA%\leme\estado.json`
(`~/.local/state/leme/` fora do Windows) — nunca dentro dos projetos.

## O código

| arquivo | o que faz |
|---|---|
| `src/main.ts` | entrada: abre a tela (ou imprime o resumo) |
| `src/painel.ts` | a tela: lista, saída, teclas |
| `src/descoberta.ts` | projetos, scripts, compose, bancos dos `.env` |
| `src/processo.ts` | um processo num terminal próprio (PTY) — subir, parar a árvore, porta |
| `src/docker.ts` | contêineres: estado, logs, garantir no ar |
| `src/desenho.ts` | a tela guardada do processo → linhas coloridas do painel |
| `src/diagnostico.ts` | o retrato em Markdown que a tecla `d` copia (e a máscara de senhas) |
| `src/git.ts` | estado git de uma pasta (só leitura) |
| `src/github.ts` | CI e PR pelo `gh` (entra na tela na fase C) |
| `src/estado.ts` | a memória do leme |
| `src/tela.ts`, `src/dotenv.ts`, `src/sh.ts` | texto, `.env`, rodar comandos |

`bun test` roda os testes; `bun run typecheck`, os tipos. `scripts/e2e.ts` testa a tela de
verdade: roda o leme num terminal falso, manda teclas e fotografa (instruções no topo do arquivo).

Dependência: `@xterm/headless` (MIT, sem dependências) — o terminal "invisível" que guarda a saída
de cada processo.
