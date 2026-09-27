import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acharRaiz, lerConfig } from '../src/config';

const base = mkdtempSync(join(tmpdir(), 'leme-'));
afterAll(() => rmSync(base, { recursive: true, force: true }));

test('acha o .leme.json subindo a partir de uma subpasta', () => {
  const fundo = join(base, 'org', 'projeto', 'src');
  mkdirSync(fundo, { recursive: true });
  writeFileSync(join(base, 'org', '.leme.json'), '{"gh":{"conta":"fulano"}}');
  expect(acharRaiz(fundo)).toBe(join(base, 'org'));
  expect(lerConfig(join(base, 'org'))).toEqual({ gh: { conta: 'fulano' } });
});

test('sem .leme.json em lugar nenhum: a própria pasta, e config vazia', () => {
  const solta = join(base, 'solta');
  mkdirSync(solta);
  expect(acharRaiz(solta)).toBe(solta);
  expect(lerConfig(solta)).toEqual({});
});

test('.leme.json quebrado diz qual arquivo', () => {
  const q = join(base, 'quebrado');
  mkdirSync(q);
  writeFileSync(join(q, '.leme.json'), '{ nada');
  expect(() => lerConfig(q)).toThrow(/quebrado.*\.leme\.json não é um JSON válido/);
});
