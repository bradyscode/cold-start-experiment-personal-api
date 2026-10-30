import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './palette';

const read = (f: string) => readFileSync(resolve(__dirname, f), 'utf8');
const token = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(read('tokens.css'))![1]!;

describe('theme CSS', () => {
  it('primary buttons use the dark text token, readable on cobalt', () => {
    const rule = /\.btn-primary\s*\{([^}]*)\}/.exec(read('app.css'))![1]!;
    expect(rule).toContain('color: var(--steel)');
    expect(contrastRatio(token('cobalt'), token('steel'))).toBeGreaterThanOrEqual(4.5);
  });

  it('form fields use a border token that reaches 3:1 on the field background', () => {
    const rule = /\.field\s*\{([^}]*)\}/.exec(read('app.css'))![1]!;
    expect(rule).toContain('border: 1px solid var(--field-border)');
    expect(contrastRatio(token('field-border'), token('card-dark'))).toBeGreaterThanOrEqual(3);
  });

  it('hides the feed scroller scrollbar visually', () => {
    const css = read('app.css');
    expect(/\.feed-scroller\s*\{[^}]*scrollbar-width:\s*none/.test(css)).toBe(true);
    expect(css).toContain('.feed-scroller::-webkit-scrollbar { display: none; }');
  });
});
