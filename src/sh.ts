/**
 * Roda um comando e devolve o que ele escreveu. Nunca lança: comando ausente (sem `gh`, sem
 * `docker`) volta como `ok: false` com a mensagem em `erro`.
 *
 * `stdin: 'ignore'` de propósito: um git/ssh pedindo senha aqui dentro travaria o painel em
 * silêncio. Sem stdin ele falha na hora.
 */
export type Resultado = { ok: boolean; codigo: number; saida: string; erro: string };

export async function rodar(
  cmd: string,
  args: string[],
  opcoes: { cwd?: string; env?: Record<string, string> } = {},
): Promise<Resultado> {
  try {
    const p = Bun.spawn([cmd, ...args], {
      cwd: opcoes.cwd,
      env: { ...process.env, ...opcoes.env },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [saida, erro, codigo] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { ok: codigo === 0, codigo, saida, erro };
  } catch (e) {
    return { ok: false, codigo: -1, saida: '', erro: String(e) };
  }
}
