import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ok, type Result } from '@lnwjud/domain';
import type { CapabilityBackend } from './local-capability-service.js';
import { RemoteSshCapabilityBackend } from './remote-ssh-backend.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('RemoteSshCapabilityBackend', () => {
  it('reports native key/agent authentication and strict host-key checking', async () => {
    const backend = new RemoteSshCapabilityBackend({
      runner: runner([]),
      allowedRoots: [process.cwd()],
      availabilityProbe: async (): Promise<Result<unknown>> => ok({ available: true, ready: true }),
    });

    await expect(backend.execute({ operation: 'status' })).resolves.toMatchObject({
      ok: true,
      value: { available: true, ready: true, backend: 'ssh', authentication: 'ssh_config_key_or_agent', strict_host_key_checking: true },
    });
  });

  it('tests a validated SSH config alias without accepting password input', async () => {
    const calls: Record<string, unknown>[] = [];
    const backend = new RemoteSshCapabilityBackend({ runner: runner(calls), allowedRoots: [process.cwd()] });

    const result = await backend.execute({ operation: 'test', workspaceId: 'workspace-1', profile: 'nava-vps' });

    expect(result).toMatchObject({ ok: true, value: { backend: 'ssh', operation: 'test', profile: 'nava-vps' } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ executable: 'ssh.exe', execution: 'foreground' });
    expect(calls[0]?.arguments).toEqual(expect.arrayContaining(['BatchMode=yes', 'StrictHostKeyChecking=yes', 'nava-vps', 'exit 0']));
    await expect(backend.execute({ operation: 'test', workspaceId: 'workspace-1', profile: '-oProxyCommand=bad' })).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it('quotes argv for the selected remote shell and keeps task ownership scoped', async () => {
    const calls: Record<string, unknown>[] = [];
    const backend = new RemoteSshCapabilityBackend({ runner: runner(calls, { task_id: 'task-1', state: 'running' }), allowedRoots: [process.cwd()] });

    const result = await backend.execute({
      operation: 'run', workspaceId: 'workspace-1', profile: 'nava-vps', remote_shell: 'posix',
      executable: 'printf', arguments: ['%s', "safe'value"], execution: 'background',
    });

    expect(result).toMatchObject({ ok: true, value: { task_id: 'task-1', profile: 'nava-vps' } });
    expect(calls[0]?.arguments).toEqual(expect.arrayContaining(["'printf' '%s' 'safe'\"'\"'value'"]));
    await expect(backend.execute({ operation: 'logs', workspaceId: 'workspace-2', task_id: 'task-1' })).resolves.toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    await expect(backend.execute({ operation: 'logs', workspaceId: 'workspace-1', profile: 'other', task_id: 'task-1' })).resolves.toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
  });

  it('scopes upload and download paths to registered roots', async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    const upload = path.join(root, 'upload.txt');
    await writeFile(upload, 'safe', 'utf8');
    await mkdir(path.join(root, 'downloads'));
    const calls: Record<string, unknown>[] = [];
    const backend = new RemoteSshCapabilityBackend({ runner: runner(calls), allowedRoots: [root] });

    await expect(backend.execute({ operation: 'upload', workspaceId: 'w', profile: 'vps', local_path: upload, remote_path: '/tmp/upload.txt' })).resolves.toMatchObject({ ok: true });
    await expect(backend.execute({ operation: 'download', workspaceId: 'w', profile: 'vps', local_path: path.join(root, 'downloads', 'result.txt'), remote_path: '/tmp/result.txt' })).resolves.toMatchObject({ ok: true });
    await expect(backend.execute({ operation: 'upload', workspaceId: 'w', profile: 'vps', local_path: path.join(outside, 'outside.txt'), remote_path: '/tmp/outside.txt' })).resolves.toMatchObject({ ok: false });
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.executable === 'scp.exe')).toBe(true);
  });
});

function runner(calls: Record<string, unknown>[], result: Record<string, unknown> = { state: 'completed', exit_code: 0 }): CapabilityBackend {
  return {
    async execute(input): Promise<Result<unknown>> {
      calls.push(input as Record<string, unknown>);
      return ok(result);
    },
  };
}

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nava-ssh-'));
  temporaryRoots.push(root);
  return root;
}
