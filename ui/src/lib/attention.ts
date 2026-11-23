// Whether the person is at Flint's window (milestone 63, D-136): the page tells the core
// when the window gains or loses the focus, and, at most every INPUT_EVERY_MS, that a key
// or the mouse was used in it. The core sends no phone alert while both say someone is
// there. Only trusted events count: the end-to-end runs' synthetic events do not.

/** At most one `input` report this often; the core's window is 60 s. */
export const INPUT_EVERY_MS = 10_000;

export interface AttentionSink {
  focus: (focused: boolean) => void;
  input: () => void;
}

export function attentionReporter(sink: AttentionSink, now: () => number = Date.now) {
  let lastInput = -Infinity;
  return {
    // The focus alone is not someone there: Flint brings its own window to the front.
    focus(focused: boolean) {
      sink.focus(focused);
    },
    input(trusted: boolean) {
      if (!trusted) return;
      const t = now();
      if (t - lastInput < INPUT_EVERY_MS) return;
      lastInput = t;
      sink.input();
    },
  };
}
