/// <reference lib="webworker" />
import { reconcile } from '../engine';
import type { ReconcileInput } from '../contracts/engine';
self.onmessage = (event: MessageEvent<{ id: string; input: ReconcileInput }>) => {
  const started = performance.now();
  try {
    const result = reconcile(event.data.input);
    self.postMessage({
      id: event.data.id,
      ok: true,
      result,
      duration_ms: performance.now() - started,
    });
  } catch {
    // Never return financial source rows through an exception/telemetry message.
    self.postMessage({
      id: event.data.id,
      ok: false,
      error: 'Reconciliation stopped. Check input validation and try again.',
    });
  }
};
