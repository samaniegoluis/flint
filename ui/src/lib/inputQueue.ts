// Terminal input in order (Tether 14a1461). Each keystroke is an RPC, and a burst
// written in one tick (xterm.js answering a TUI's ~258 colour queries at once) must
// reach the remote in the order it was written. A per-session FIFO keeps at most one
// write in flight; whatever arrives meanwhile is joined into the next single write.

export type Send = (session: string, data: string) => Promise<unknown>;

export class InputQueue {
  private waiting = new Map<string, string>();
  private busy = new Set<string>();

  constructor(private send: Send) {}

  push(session: string, data: string) {
    if (!data) return;
    this.waiting.set(session, (this.waiting.get(session) ?? '') + data);
    if (!this.busy.has(session)) void this.drain(session);
  }

  /** Drops what has not been sent yet (the session ended). */
  drop(session: string) {
    this.waiting.delete(session);
  }

  private async drain(session: string) {
    this.busy.add(session);
    try {
      for (;;) {
        const data = this.waiting.get(session);
        if (!data) break;
        this.waiting.delete(session);
        try {
          await this.send(session, data);
        } catch {
          // A failed write (the session just ended) loses only that chunk.
        }
      }
    } finally {
      this.busy.delete(session);
    }
  }
}
