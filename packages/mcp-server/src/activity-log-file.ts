import { appendFile, copyFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ActivitySink, ActivitySinkEvent } from './activity-tracker.js';

export function mcpActivityLogPath(dataPath: string): string {
  return path.join(dataPath, 'mcp-activity.log');
}

export function formatActivityLogLine(event: ActivitySinkEvent): string {
  return `${JSON.stringify({
    callId: event.callId,
    toolName: event.toolName,
    phase: event.phase,
    resultCode: event.resultCode,
    durationMs: event.durationMs,
    timestamp: event.timestamp,
    ...(event.workspaceId === undefined ? {} : { workspaceId: event.workspaceId }),
    ...(event.workspaceLabel === undefined ? {} : { workspaceLabel: event.workspaceLabel }),
    ...(event.targetSummary === undefined ? {} : { targetSummary: event.targetSummary }),
    ...(event.resultMessage === undefined ? {} : { resultMessage: event.resultMessage }),
    ...(event.traceId === undefined ? {} : { traceId: event.traceId }),
    ...(event.traceParent === undefined ? {} : { traceParent: event.traceParent }),
  })}\n`;
}

export interface ActivityLogSinkOptions {
  readonly maxBytes?: number;
  readonly maxFiles?: number;
}

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_FILES = 3;

export function createFileActivitySink(filePath: string, options: ActivityLogSinkOptions = {}): ActivitySink {
  const maxBytes = boundedPositiveInteger(options.maxBytes, DEFAULT_MAX_BYTES, 1_024, 256 * 1024 * 1024);
  const maxFiles = boundedPositiveInteger(options.maxFiles, DEFAULT_MAX_FILES, 1, 20);
  let pending = Promise.resolve();
  return {
    async record(event: ActivitySinkEvent): Promise<void> {
      const operation = pending.then(async () => {
        await mkdir(path.dirname(filePath), { recursive: true });
        await appendFile(filePath, formatActivityLogLine(event), 'utf8');
        await rotateActivityLog(filePath, maxBytes, maxFiles);
      });
      pending = operation.then(() => undefined, () => undefined);
      await operation;
    },
  };
}

async function rotateActivityLog(filePath: string, maxBytes: number, maxFiles: number): Promise<void> {
  const current = await stat(filePath);
  if (current.size <= maxBytes) return;
  for (let index = maxFiles - 1; index >= 1; index -= 1) {
    const source = `${filePath}.${index}`;
    const destination = `${filePath}.${index + 1}`;
    await rm(destination, { force: true });
    await renameIfPresent(source, destination);
  }
  const firstBackup = `${filePath}.1`;
  await rm(firstBackup, { force: true });
  // Copy-and-truncate keeps the active path stable for a concurrently tailed
  // LogHub handle and makes rotation safe when Windows refuses to rename it.
  await copyFile(filePath, firstBackup);
  await writeFile(filePath, '', 'utf8');
}

async function renameIfPresent(source: string, destination: string): Promise<void> {
  try {
    await rename(source, destination);
  } catch (error: unknown) {
    if (!isMissingFileError(error)) throw error;
  }
}

function boundedPositiveInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isInteger(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT';
}

export function composeActivitySinks(sinks: readonly ActivitySink[]): ActivitySink {
  return {
    async record(event: ActivitySinkEvent): Promise<void> {
      const errors: unknown[] = [];
      for (const sink of sinks) {
        try {
          await sink.record(event);
        } catch (error: unknown) {
          errors.push(error);
        }
      }
      if (errors.length > 0) throw errors[0];
    },
  };
}
