import { describe, it, expect } from 'vitest';
import { parseCommand, tokenize } from '../../core/command/index.js';

describe('Command Parser', () => {
  it('parses command id and argv with/without slash', () => {
    const a = parseCommand('/open specs');
    expect(a.id).toBe('open');
    expect(a.argv).toEqual(['specs']);

    const b = parseCommand("chat open 'Side Panel'");
    expect(b.id).toBe('chat');
    expect(b.argv).toEqual(['open', 'Side Panel']);
  });

  it('tokenizes quoted args and escapes', () => {
    expect(tokenize('cmd "a b" c')).toEqual(['cmd', 'a b', 'c']);
    // Backslash-escaped quote is included literally within single quotes
    expect(tokenize("cmd 'x \\' y'")).toEqual(['cmd', "x ' y"]);
  });

  it('errors on bad input', () => {
    expect(() => parseCommand('')).toThrowError();
    expect(() => tokenize('cmd "unterminated')).toThrowError();
  });
});
