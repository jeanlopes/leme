/**
 * Põe texto na área de transferência. No Windows pelo `Set-Clipboard` do PowerShell (o `clip.exe`
 * estraga acento); fora dele, pela sequência OSC 52, que o próprio terminal atende.
 * `LEME_CLIPBOARD=off` não mexe na área de transferência (é o que o e2e usa).
 */
import { spawn } from 'node:child_process';

export function copiar(texto: string): void {
  if (process.env.LEME_CLIPBOARD === 'off') return;
  if (process.platform === 'win32') {
    const p = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::InputEncoding=[Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())'], {
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
    });
    p.on('error', () => undefined);
    p.stdin.end(texto, 'utf8');
    return;
  }
  process.stdout.write(`\x1b]52;c;${Buffer.from(texto, 'utf8').toString('base64')}\x07`);
}
