import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ActivityTracker, type ActivitySinkEvent } from './activity-tracker.js';
import { composeActivitySinks, createFileActivitySink, formatActivityLogLine, mcpActivityLogPath } from './activity-log-file.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('mcp activity log file', () => {
  it('resolves the activity log under the shared data path', () => {
    expect(mcpActivityLogPath('C:\\Users\\me\\AppData\\Roaming\\lnwjud')).toMatch(/mcp-activity\.log$/);
  });

  it('writes started and completed NDJSON lines that Live Logs can tail', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-activity-'));
    temporaryRoots.push(root);
    const filePath = mcpActivityLogPath(root);
    const tracker = new ActivityTracker(
      createFileActivitySink(filePath),
      undefined,
      512,
      async () => 'BEELZEBUB EA Lab',
    );

    const callId = await tracker.begin('read_file', { workspaceId: 'ws-beel', path: 'src\\app.ts' });
    await tracker.end(callId, 'SUCCESS', 4);

    const raw = await readFile(filePath, 'utf8');
    const lines = raw.trim().split('\n').map((line) => JSON.parse(line) as { callId: string; phase: string; toolName: string; workspaceLabel?: string });
    expect(lines).toEqual([
      expect.objectContaining({ callId, phase: 'started', toolName: 'read_file', workspaceLabel: 'BEELZEBUB EA Lab' }),
      expect.objectContaining({ callId, phase: 'completed', toolName: 'read_file', workspaceLabel: 'BEELZEBUB EA Lab' }),
    ]);
    expect(formatActivityLogLine({
      callId: 'c1',
      toolName: 'write_file',
      phase: 'completed',
      resultCode: 'FILE_NOT_FOUND',
      durationMs: 1,
      timestamp: '2026-01-01T00:00:00.000Z',
      resultMessage: 'missing',
    })).toContain('"toolName":"write_file"');
  });

  it('still records to later sinks when an earlier activity sink fails', async () => {
    const recorded: ActivitySinkEvent[] = [];
    const sink = composeActivitySinks([
      {
        async record(): Promise<void> {
          throw new Error('file sink unavailable');
        },
      },
      {
        async record(event): Promise<void> {
          recorded.push(event);
        },
      },
    ]);

    await expect(sink.record({
      callId: 'c1',
      toolName: 'read_file',
      phase: 'started',
      resultCode: 'STARTED',
      durationMs: 0,
      timestamp: '2026-08-17T00:00:00.000Z',
    })).rejects.toThrow('file sink unavailable');
    expect(recorded).toHaveLength(1);
  });

  it('rotates the persistent log while keeping the active tail bounded', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-activity-rotate-'));
    temporaryRoots.push(root);
    const filePath = mcpActivityLogPath(root);
    const sink = createFileActivitySink(filePath, { maxBytes: 1_024, maxFiles: 2 });
    await Promise.all(Array.from({ length: 40 }, (_, index) => sink.record({
      callId: `call-${index}`,
      toolName: 'read_file',
      phase: 'completed',
      resultCode: 'SUCCESS',
      durationMs: index,
      timestamp: '2026-08-28T00:00:00.000Z',
      resultMessage: 'bounded activity event',
    })));

    const files = await readdir(root);
    expect(files).toContain('mcp-activity.log');
    expect(files).toContain('mcp-activity.log.1');
    expect(files).toContain('mcp-activity.log.2');
    expect((await stat(filePath)).size).toBeLessThanOrEqual(1_024);
    expect((await readFile(`${filePath}.1`, 'utf8'))).toContain('call-');
  });
});
