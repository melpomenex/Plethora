export interface ExportCheckpoint { cursor: number; exported: number; bytes: number }

export async function incrementalExport<T>(args: {
  records: T[];
  maxRecordsPerSession?: number;
  maxBytesPerSession?: number;
  encode?: (record: T) => string;
  publish: (record: T) => Promise<void>;
  checkpoint?: (checkpoint: ExportCheckpoint) => Promise<void>;
}): Promise<ExportCheckpoint> {
  const maxRecords = args.maxRecordsPerSession ?? 50;
  const maxBytes = args.maxBytesPerSession ?? 256 * 1024;
  const encode = args.encode ?? ((record) => JSON.stringify(record));
  let bytes = 0;
  let exported = 0;
  for (let cursor = 0; cursor < args.records.length && exported < maxRecords; cursor += 1) {
    const encodedBytes = encode(args.records[cursor]).length;
    if (bytes + encodedBytes > maxBytes && exported > 0) break;
    await args.publish(args.records[cursor]);
    bytes += encodedBytes;
    exported += 1;
    await args.checkpoint?.({ cursor: cursor + 1, exported, bytes });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return { cursor: exported, exported, bytes };
}
