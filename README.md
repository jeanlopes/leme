# leme

Painel de terminal para uma pasta com vários projetos. Digite `leme` e ele mostra, para cada
projeto: a branch, o que está preparado para commit e o que não está, se a branch já entrou na
principal, o PR e o último CI. Tudo pelo menu — setas, Enter, Esc. Nada para decorar.

```
leme · C:\workspace\batuvia-org

  PASTA            BRANCH                          ALTERAÇÕES        MESCLADA    CI          PR

Batuvia/batuvia   main: Release ✓ há 11 h · CI ✗ há 11 h   ·   buscado do remoto há 1 min
  batuvia          plano-020-backoffice ↓5         3 novos           ✓ na main   ✓ há 11 h   #99 mesclado
  batuvia-021      plano-021-preco-por-regiao      limpo             não         ✓ há 11 h   #100 mesclado

⚠ Batuvia/batuvia: o CI da main está FALHANDO (CI)
⚠ batuvia-021: o PR #100 foi mesclado em "plano-020-backoffice", mas o conteúdo NÃO está na main
```

## Instalar

Precisa de [bun](https://bun.sh), git e, para CI e PR, o [gh](https://cli.github.com) logado.

```powershell
cd C:\workspace\leme
bun install
bun run instalar
```

O `instalar` cria `~/.bun/bin/leme.ps1` apontando para este código — editou, vale na hora.
Para desinstalar, apague esse arquivo.

## Usar

Em qualquer pasta que tenha projetos com git dentro: `leme`.

- **Ver detalhes de um projeto** — arquivos alterados (preparados, não preparados, novos),
  commits ainda não enviados, últimos commits, PR e cada workflow do CI com o link.
- **Buscar do remoto** — `git fetch` em cada repositório. O painel NÃO busca sozinho: a coluna
  "mesclada" compara com o que o git sabia no último fetch (o cabeçalho de cada repositório diz
  quando foi).
- **Atualizar a tela** — lê tudo de novo.

Worktrees do mesmo repositório aparecem juntos. Pastas sem git aparecem numa linha no fim.
Fora de um terminal interativo (saída redirecionada), o leme só imprime o resumo e sai.

## `.leme.json` (opcional)

Na pasta dos projetos. O leme procura esse arquivo subindo a partir de onde você está, então
`leme` dentro de `projeto/src` ainda mostra a pasta inteira.

```json
{
  "gh": { "conta": "jeanlopes" },
  "git": { "autor": "jeanlopes" },
  "ignorar": ["pasta-de-backup"]
}
```

- `gh.conta` — a conta do gh usada nas consultas. Cada chamada leva o token dela, então funciona
  mesmo com outra conta ativa no gh.
- `git.autor` — avisa quando algum projeto commitaria com outro `user.name`.
- `ignorar` — pastas que não aparecem.

## O código

| arquivo | o que faz |
|---|---|
| `src/main.ts` | entrada: acha a pasta, abre o menu (ou imprime o resumo) |
| `src/menu.ts` | o menu (`@clack/prompts`) |
| `src/coleta.ts` | junta git + CI + PR de cada pasta e monta os avisos |
| `src/git.ts` | lê o estado git de uma pasta (só leitura) |
| `src/github.ts` | CI e PR pelo `gh` |
| `src/tela.ts` | transforma o estado em texto |
| `src/config.ts` | `.leme.json` |
| `src/sh.ts` | roda comandos |

`bun test` roda os testes; `bun run typecheck`, os tipos.

Dependência: `@clack/prompts` (MIT) e o que ela puxa (`@clack/core`, `sisteransi`,
`fast-wrap-ansi`, `fast-string-width`, `fast-string-truncated-width` — todos MIT).
