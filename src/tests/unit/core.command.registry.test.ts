import { describe, it, expect } from 'vitest';
import { CommandRegistry, CommandError } from '../../core/command/index.js';

describe('CommandRegistry', () => {
  it('registers and executes a command by id', async () => {
    const reg = new CommandRegistry<{ x: number }, number>();
    reg.register({
      id: 'add',
      args: [
        { name: 'a', required: true },
        { name: 'b', required: true },
      ],
      handler: (argv, ctx) => {
        const [a, b] = argv.map((v) => Number(v));
        return a + b + ctx.x;
      },
    });

    const res = await reg.execute('add', ['2', '3'], { x: 1 });
    expect(res).toBe(6);
  });

  it('looks up by alias and validates required args and enums', async () => {
    const reg = new CommandRegistry();
    reg.register({
      id: 'panel',
      aliases: ['p'],
      args: [
        { name: 'action', required: true, type: 'enum', options: ['open', 'close'] },
        { name: 'name', required: true },
      ],
      handler: (argv) => argv.join(' '),
    });

    await expect(reg.execute('p', ['open', 'chat'], {})).resolves.toBe('open chat');

    await expect(reg.execute('panel', ['close'], {})).rejects.toMatchObject({ code: 'EARGS' });
    await expect(reg.execute('panel', ['toggle', 'chat'], {})).rejects.toMatchObject({ code: 'EARG' });
  });

  it('rejects duplicate ids and alias conflicts', () => {
    const reg = new CommandRegistry();
    reg.register({ id: 'one', handler: () => {} });
    expect(() => reg.register({ id: 'one', handler: () => {} })).toThrowError(CommandError);
    expect(() => reg.register({ id: 'two', aliases: ['one'], handler: () => {} })).toThrowError(CommandError);
  });
});

