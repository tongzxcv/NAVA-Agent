import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GitAdapter } from '@lnwjud/git';
import type { Workspace, WorkspaceRepository } from '@lnwjud/workspace';
import { forbiddenGitArg, GitService, isDestructiveGitCommand } from './git-service.js';
import { permissionProfiles, type PermissionProfile } from '@lnwjud/permissions';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createWorkspace(): Promise<Workspace> {
  const rawRoot = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-git-service-'));
  temporaryRoots.push(rawRoot);
  const root = await realpath(rawRoot);
  return {
    id: 'workspace-1',
    displayName: 'Fixture',
    rootPath: root,
    realRootPath: root,
    createdAt: new Date(0).toISOString(),
  };
}

function repository(workspace: Workspace): WorkspaceRepository {
  return {
    async list(): Promise<Workspace[]> { return [workspace]; },
    async get(id: string): Promise<Workspace | null> { return id === workspace.id ? workspace : null; },
    async insert(): Promise<void> {},
    async delete(): Promise<void> {},
  };
}

describe('GitService', () => {
  it('forwards cancellation to every MCP-exposed Git adapter operation', async () => {
    const workspace = await createWorkspace();
    const observedSignals: Array<AbortSignal | undefined> = [];
    const adapter = {
      async status(_cwd: string, signal?: AbortSignal) {
        observedSignals.push(signal);
        return { ok: true as const, value: { entries: [] } };
      },
      async diff(_cwd: string, _request: unknown, signal?: AbortSignal) {
        observedSignals.push(signal);
        return { ok: true as const, value: { patch: '', truncated: false } };
      },
      async log(_cwd: string, _request: unknown, signal?: AbortSignal) {
        observedSignals.push(signal);
        return { ok: true as const, value: { entries: [], truncated: false } };
      },
      async run(_cwd: string, _args: readonly string[], _timeoutMs: number | undefined, signal?: AbortSignal) {
        observedSignals.push(signal);
        return { ok: true as const, value: { exitCode: 0, stdout: '', stderr: '' } };
      },
    } as unknown as GitAdapter;
    const service = new GitService(repository(workspace), undefined, adapter);
    const actor = { clientId: 'test', clientName: 'test' };
    const signal = new AbortController().signal;

    await service.status(actor, workspace.id, signal);
    await service.diff(actor, workspace.id, {}, signal);
    await service.log(actor, workspace.id, {}, signal);
    await service.run(actor, { args: ['status'], workspaceId: workspace.id }, signal);

    expect(observedSignals).toEqual([signal, signal, signal, signal]);
  });

  it('guards a diff path before delegating to the Git adapter', async () => {
    const workspace = await createWorkspace();
    const adapter = {
      async status(): Promise<never> { throw new Error('not used'); },
      async diff(rootPath: string, request: { path?: string; staged?: boolean; maxBytes?: number }): Promise<{ ok: true; value: { patch: string; truncated: boolean } }> {
        expect(rootPath).toBe(workspace.realRootPath);
        expect(request.path).toBe(path.join('src', 'new.txt'));
        return { ok: true, value: { patch: '', truncated: false } };
      },
      async log(): Promise<never> { throw new Error('not used'); },
    } as unknown as GitAdapter;
    const service = new GitService(repository(workspace), undefined, adapter);

    const result = await service.diff({ clientId: 'test', clientName: 'test' }, workspace.id, { path: 'src\\new.txt' });

    expect(result).toEqual({ ok: true, value: { patch: '', truncated: false } });
  });

  it('rejects a diff path outside the workspace', async () => {
    const workspace = await createWorkspace();
    const service = new GitService(repository(workspace), undefined, {
      async status(): Promise<never> { throw new Error('not used'); },
      async diff(): Promise<never> { throw new Error('must not run'); },
      async log(): Promise<never> { throw new Error('not used'); },
    } as unknown as GitAdapter);

    const result = await service.diff({ clientId: 'test', clientName: 'test' }, workspace.id, { path: '..\\outside.txt' });

    expect(result).toMatchObject({ ok: false, error: { code: 'PATH_OUTSIDE_WORKSPACE' } });
  });

  it('runs git against an absolute cwd in a registered workspace', async () => {
    const workspace = await createWorkspace();
    const adapter = {
      async status(): Promise<never> { throw new Error('not used'); },
      async diff(): Promise<never> { throw new Error('not used'); },
      async log(): Promise<never> { throw new Error('not used'); },
      async run(cwd: string, args: readonly string[]): Promise<{ ok: true; value: { exitCode: number; stdout: string; stderr: string } }> {
        expect(path.resolve(cwd).toLowerCase()).toBe(path.resolve(workspace.realRootPath).toLowerCase());
        expect(args).toEqual(['init']);
        return { ok: true, value: { exitCode: 0, stdout: 'Initialized empty Git repository', stderr: '' } };
      },
    } as unknown as GitAdapter;
    const service = new GitService(repository(workspace), undefined, adapter);

    const result = await service.run({ clientId: 'test', clientName: 'test' }, {
      args: ['init'],
      cwd: workspace.realRootPath,
    });

    expect(result).toEqual({
      ok: true,
      value: { exitCode: 0, stdout: 'Initialized empty Git repository', stderr: '' },
    });
  });

  it('requires workspaceId unless cwd is an absolute path', async () => {
    const workspace = await createWorkspace();
    const service = new GitService(repository(workspace));

    const result = await service.run({ clientId: 'test', clientName: 'test' }, { args: ['status'] });

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });
});

describe('isDestructiveGitCommand', () => {
  it('flags destructive subcommands and flag combinations', () => {
    expect(isDestructiveGitCommand(['clean', '-fdx'])).toBe(true);
    expect(isDestructiveGitCommand(['reset', '--hard', 'HEAD~1'])).toBe(true);
    expect(isDestructiveGitCommand(['push', '--force', 'origin', 'main'])).toBe(true);
    expect(isDestructiveGitCommand(['push', '-f'])).toBe(true);
    expect(isDestructiveGitCommand(['push', '--force-with-lease'])).toBe(true);
    expect(isDestructiveGitCommand(['filter-branch', '--all'])).toBe(true);
    expect(isDestructiveGitCommand(['rm', 'file.txt'])).toBe(true);
    expect(isDestructiveGitCommand(['reflog', 'expire', '--all'])).toBe(true);
    expect(isDestructiveGitCommand(['branch', '-D', 'wip'])).toBe(true);
    expect(isDestructiveGitCommand(['stash', 'clear'])).toBe(true);
  });

  it('leaves routine subcommands alone', () => {
    expect(isDestructiveGitCommand(['status', '--porcelain'])).toBe(false);
    expect(isDestructiveGitCommand(['add', '.'])).toBe(false);
    expect(isDestructiveGitCommand(['commit', '-m', 'msg'])).toBe(false);
    expect(isDestructiveGitCommand(['push', 'origin', 'main'])).toBe(false);
    expect(isDestructiveGitCommand(['reset', 'HEAD~1'])).toBe(false);
    expect(isDestructiveGitCommand(['branch', '-d', 'merged'])).toBe(false);
  });
});

describe('forbiddenGitArg', () => {
  it('rejects config injection and ext transports', () => {
    expect(forbiddenGitArg(['-c', 'protocol.ext.allow=always', 'fetch', 'ext::sh -c evil'])).toBe('-c');
    expect(forbiddenGitArg(['fetch', 'ext::sh -c evil'])).toBe('ext::sh -c evil');
    expect(forbiddenGitArg(['--exec-path=/tmp'])).toBe('--exec-path=/tmp');
    expect(forbiddenGitArg(['status'])).toBeNull();
  });
});

describe('GitService.run permission gate', () => {
  const actor = { clientId: 'test', clientName: 'test' };

  function gateAdapter(runs: Array<readonly string[]>): GitAdapter {
    return {
      async status(): Promise<never> { throw new Error('not used'); },
      async diff(): Promise<never> { throw new Error('not used'); },
      async log(): Promise<never> { throw new Error('not used'); },
      async run(_cwd: string, args: readonly string[]) {
        runs.push(args);
        return { ok: true as const, value: { exitCode: 0, stdout: '', stderr: '' } };
      },
    } as unknown as GitAdapter;
  }

  it('runs non-destructive commands without confirmation', async () => {
    const workspace = await createWorkspace();
    const runs: Array<readonly string[]> = [];
    const service = new GitService(repository(workspace), undefined, gateAdapter(runs));

    const result = await service.run(actor, { workspaceId: workspace.id, args: ['status', '--porcelain'] });

    expect(result.ok).toBe(true);
    expect(runs).toEqual([['status', '--porcelain']]);
  });

  it('requires userConfirmed for destructive subcommands', async () => {
    const workspace = await createWorkspace();
    const runs: Array<readonly string[]> = [];
    const service = new GitService(repository(workspace), undefined, gateAdapter(runs));

    const denied = await service.run(actor, { workspaceId: workspace.id, args: ['clean', '-fdx'] });
    expect(denied).toMatchObject({ ok: false, error: { code: 'PERMISSION_REQUIRED' } });
    expect(runs).toEqual([]);

    const confirmed = await service.run(actor, { workspaceId: workspace.id, args: ['clean', '-fdx'], userConfirmed: true });
    expect(confirmed.ok).toBe(true);
    expect(runs).toEqual([['clean', '-fdx']]);
  });

  it('rejects config injection before resolving the workspace', async () => {
    const workspace = await createWorkspace();
    const runs: Array<readonly string[]> = [];
    const service = new GitService(repository(workspace), undefined, gateAdapter(runs));

    const result = await service.run(actor, {
      workspaceId: workspace.id,
      args: ['-c', 'protocol.ext.allow=always', 'fetch', 'ext::x'],
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    expect(runs).toEqual([]);
  });

  it('hard-denies destructive commands under the safe profile even when confirmed', async () => {
    const workspace = await createWorkspace();
    const runs: Array<readonly string[]> = [];
    const service = new GitService(repository(workspace), undefined, gateAdapter(runs), {
      profileProvider: (): PermissionProfile => permissionProfiles.safe,
    });

    const result = await service.run(actor, { workspaceId: workspace.id, args: ['push', '--force'], userConfirmed: true });

    expect(result).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    expect(runs).toEqual([]);
  });

  it('requires confirmation when the profile answers ASK', async () => {
    const workspace = await createWorkspace();
    const runs: Array<readonly string[]> = [];
    const service = new GitService(repository(workspace), undefined, gateAdapter(runs), {
      profileProvider: (): PermissionProfile => permissionProfiles.balanced,
    });

    const denied = await service.run(actor, { workspaceId: workspace.id, args: ['clean', '-fd'] });
    expect(denied).toMatchObject({ ok: false, error: { code: 'PERMISSION_REQUIRED' } });

    const confirmed = await service.run(actor, { workspaceId: workspace.id, args: ['clean', '-fd'], userConfirmed: true });
    expect(confirmed.ok).toBe(true);
    expect(runs).toEqual([['clean', '-fd']]);
  });
});
