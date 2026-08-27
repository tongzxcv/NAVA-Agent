import { describe, expect, it } from 'vitest';
import { appError, err, ok, type Result } from '@lnwjud/domain';
import { ToolRegistry, type McpApplicationServices } from '../tool-registry.js';
import type { WorkspaceLeasePort, WorkspaceLeaseRecord } from './tool-types.js';

const actor = { clientId: 'test', clientName: 'test' };
const leaseId = '11111111-1111-4111-8111-111111111111';

class MemoryWorkspaceLeases implements WorkspaceLeasePort {
  private lease: WorkspaceLeaseRecord | undefined;

  public async acquire(workspaceId: string, owner: string, ttlSeconds: number): Promise<Result<WorkspaceLeaseRecord>> {
    void ttlSeconds;
    if (this.lease !== undefined) return err(appError('PERMISSION_REQUIRED', 'busy', true));
    this.lease = { workspaceId, leaseId, owner, acquiredAt: new Date(0).toISOString(), heartbeatAt: new Date(0).toISOString(), expiresAt: new Date(60_000).toISOString() };
    return ok(this.lease);
  }
  public async status(workspaceId?: string): Promise<Result<readonly WorkspaceLeaseRecord[]>> {
    return ok(this.lease !== undefined && (workspaceId === undefined || workspaceId === this.lease.workspaceId) ? [this.lease] : []);
  }
  public async renew(workspaceId: string, candidate: string): Promise<Result<WorkspaceLeaseRecord>> {
    return this.lease?.workspaceId === workspaceId && this.lease.leaseId === candidate ? ok(this.lease) : err(appError('PERMISSION_REQUIRED', 'wrong lease', true));
  }
  public async release(workspaceId: string, candidate: string): Promise<Result<{ readonly released: boolean }>> {
    if (this.lease?.workspaceId !== workspaceId || this.lease.leaseId !== candidate) return err(appError('PERMISSION_REQUIRED', 'wrong lease', true));
    this.lease = undefined;
    return ok({ released: true });
  }
  public async assertMutationAllowed(workspaceId: string, candidate?: string): Promise<Result<void>> {
    return this.lease === undefined || this.lease.workspaceId !== workspaceId || this.lease.leaseId === candidate
      ? ok(undefined)
      : err(appError('PERMISSION_REQUIRED', 'workspace is leased', true));
  }
}

describe('workspace lease tools', () => {
  it('advertises the exact non-flattened wrapper fields', () => {
    const registry = new ToolRegistry({}, actor);
    const tool = registry.list().find((entry) => entry.name === 'workspace_lease_call');

    expect(tool?.description).toContain('workspaceId');
    expect(tool?.description).toContain('leaseId');
    expect(tool?.description).toContain('tool');
    expect(tool?.description).toContain('arguments');
    expect(tool?.description).toContain('Do not flatten');
  });

  it('allows reads, blocks conflicting writes, and runs the matching leased mutation', async () => {
    const writes: string[] = [];
    const leases = new MemoryWorkspaceLeases();
    const services: McpApplicationServices = {
      workspaceLeases: leases,
      workspaceInfo: {
        async info(): Promise<ReturnType<typeof ok>> { return ok({ id: 'ws-1', realRootPath: 'C:\\work' }); },
        async list(): Promise<ReturnType<typeof ok>> { return ok([{ id: 'ws-1', realRootPath: 'C:\\work' }]); },
      },
      file: {
        async readFile(): Promise<ReturnType<typeof ok>> { return ok({ content: 'ok' }); },
        async writeFile(_actor, _workspaceId, request): Promise<ReturnType<typeof ok>> { writes.push(request.path); return ok({ path: request.path }); },
      } as McpApplicationServices['file'],
    };
    const registry = new ToolRegistry(services, actor);

    await expect(registry.invoke('workspace_lease_acquire', { workspaceId: 'ws-1', owner: 'chat-a' })).resolves.toMatchObject({ structuredContent: { leaseId } });
    expect((await registry.invoke('read_file', { workspaceId: 'ws-1', path: 'a.txt' })).isError).not.toBe(true);
    await expect(registry.invoke('write_file', { workspaceId: 'ws-1', path: 'a.txt', content: 'blocked' })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: 'PERMISSION_REQUIRED' } } });
    await expect(registry.invoke('workspace_lease_call', {
      workspaceId: 'ws-1', leaseId, tool: 'write_file', arguments: { path: 'a.txt', content: 'allowed' },
    })).resolves.toMatchObject({ structuredContent: { tool: 'write_file', workspaceId: 'ws-1' } });
    expect(writes).toEqual(['a.txt']);
  });

  it('attributes an absolute shell cwd to the longest containing workspace', async () => {
    const leases = new MemoryWorkspaceLeases();
    await leases.acquire('project', 'chat-a', 300);
    let executed = false;
    const registry = new ToolRegistry({
      workspaceLeases: leases,
      workspaceInfo: {
        async info(): Promise<ReturnType<typeof ok>> { return ok({}); },
        async list(): Promise<ReturnType<typeof ok>> { return ok([{ id: 'drive', realRootPath: 'D:\\' }, { id: 'project', realRootPath: 'D:\\EA\\Project' }]); },
      },
      capabilities: { async execute(): Promise<ReturnType<typeof ok>> { executed = true; return ok({}); } },
    }, actor);

    await expect(registry.invoke('shell', { operation: 'run', executable: 'git', arguments: ['status'], cwd: 'D:\\EA\\Project' })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: 'PERMISSION_REQUIRED' } } });
    expect(executed).toBe(false);
  });
});
