/** Lê um `.env` simples (CHAVE=valor, aspas opcionais, `export` opcional, # comentário). Pura (testada). */
export function lerDotenv(texto: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const linha of texto.split(/\r?\n/)) {
    const m = linha.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    vars[m[1]!] = m[2]!.replace(/^(["'])(.*)\1$/, '$2');
  }
  return vars;
}
