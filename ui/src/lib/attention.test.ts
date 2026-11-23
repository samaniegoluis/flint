import { describe, expect, it } from 'vitest';
import { attentionReporter, INPUT_EVERY_MS } from './attention';

function setup() {
  const sent: string[] = [];
  let t = 1000;
  const r = attentionReporter({ focus: (f) => sent.push('focus:' + f), input: () => sent.push('input') }, () => t);
  return { sent, r, at: (v: number) => { t = v; } };
}

describe('attentionReporter', () => {
  it('reports the focus both ways', () => {
    const { sent, r } = setup();
    r.focus(true);
    r.focus(false);
    expect(sent).toEqual(['focus:true', 'focus:false']);
  });

  it('reports trusted input at most every INPUT_EVERY_MS', () => {
    const { sent, r, at } = setup();
    r.input(true);
    at(1000 + INPUT_EVERY_MS - 1);
    r.input(true);
    at(1000 + INPUT_EVERY_MS);
    r.input(true);
    expect(sent).toEqual(['input', 'input']);
  });

  it('ignores synthetic events', () => {
    const { sent, r } = setup();
    r.input(false);
    expect(sent).toEqual([]);
  });

  it('counts a regained focus as input (the core notes it), so the next report waits', () => {
    const { sent, r, at } = setup();
    r.focus(true);
    at(2000);
    r.input(true);
    expect(sent).toEqual(['focus:true']);
  });
});
