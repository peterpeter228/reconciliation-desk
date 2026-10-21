/// <reference lib="webworker" />
import { inspectXlsx, parseXlsx, type XlsxOptions } from '../ingestion/xlsx';
import type { SourceKind } from '../ingestion/types';
self.onmessage = async (
  event: MessageEvent<{
    id: string;
    operation: 'inspect' | 'parse';
    bytes: Uint8Array;
    kind: SourceKind;
    options: XlsxOptions;
  }>,
) => {
  const { id, operation, bytes, kind, options } = event.data;
  try {
    const result =
      operation === 'inspect'
        ? inspectXlsx(bytes, options.fileName)
        : await parseXlsx(bytes, kind, options);
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'Workbook inspection failed.',
    });
  }
};
