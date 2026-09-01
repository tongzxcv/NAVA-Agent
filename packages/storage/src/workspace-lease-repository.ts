import { randomUUID } from 'node:crypto';
import { appError, err, ok, type Result } from '@lnwjud/domain';
import type { SqliteDatabase } from './database.js';

export interface WorkspaceLease {
  readonly workspaceId: string;
  readonly leaseId: string;
  readonly owner: string;
  readonly acquiredAt: string;
  readonly heartbeatAt: string;
  readonly expiresAt: string;
}

interface WorkspaceLeaseRow {
  readonly workspace_id: string;
  readonly lease_id: string;
  readonly owner: string;
  readonly acquired_at: string;
  readonly heartbeat_at: string;
  readonly expires_at: string;
}

export class SqliteWorkspaceLeaseRepository {
  public constructor(
    private readonly database: SqliteDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async acquire(workspaceId: string, owner: string, ttlSeconds: number): Promise<Result<WorkspaceLease>> {
    const connection = this.database.connection;
    connection.exec('BEGIN IMMEDIATE;');
    try {
      this.deleteExpired();
      const existing = this.read(workspaceId);
      if (existing !== null) {
        connection.exec('ROLLBACK;');
        return err(appError('PERMISSION_REQUIRED', conflictMessage(existing), true));
      }
      const acquiredAt = this.now().toISOString();
      const lease: WorkspaceLease = {
        workspaceId,
        leaseId: randomUUID(),
        owner,
        acquiredAt,
        heartbeatAt: acquiredAt,
        expiresAt: new Date(Date.parse(acquiredAt) + ttlSeconds * 1_000).toISOString(),
      };
      connection.prepare('INSERT INTO workspace_leases (workspace_id, lease_id, owner, acquired_at, heartbeat_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(lease.workspaceId, lease.leaseId, lease.owner, lease.acquiredAt, lease.heartbeatAt, lease.expiresAt);
      connection.exec('COMMIT;');
      return ok(lease);
    } catch (error: unknown) {
      rollback(connection);
      return err(appError('INTERNAL_ERROR', error instanceof Error ? error.message : 'Workspace lease acquisition failed', true));
    }
  }

  public async status(workspaceId?: string): Promise<Result<readonly WorkspaceLease[]>> {
    try {
      const rows = workspaceId === undefined
        ? this.database.connection.prepare('SELECT workspace_id, lease_id, owner, acquired_at, heartbeat_at, expires_at FROM workspace_leases WHERE expires_at > ? ORDER BY workspace_id').all(this.now().toISOString())
        : this.database.connection.prepare('SELECT workspace_id, lease_id, owner, acquired_at, heartbeat_at, expires_at FROM workspace_leases WHERE workspace_id = ? AND expires_at > ?').all(workspaceId, this.now().toISOString());
      return ok(rows.flatMap((row) => {
        const lease = toLease(row);
        return lease === null ? [] : [lease];
      }));
    } catch (error: unknown) {
      return err(appError('INTERNAL_ERROR', error instanceof Error ? error.message : 'Workspace lease status failed', true));
    }
  }

  public async renew(workspaceId: string, leaseId: string, ttlSeconds: number): Promise<Result<WorkspaceLease>> {
    const connection = this.database.connection;
    connection.exec('BEGIN IMMEDIATE;');
    try {
      this.deleteExpired();
      const heartbeatAt = this.now().toISOString();
      const expiresAt = new Date(Date.parse(heartbeatAt) + ttlSeconds * 1_000).toISOString();
      // The conditional UPDATE closes the read-then-write window: a lease that
      // expires or is replaced between two racing calls can never be renewed.
      const updated = connection.prepare('UPDATE workspace_leases SET heartbeat_at = ?, expires_at = ? WHERE workspace_id = ? AND lease_id = ? AND expires_at > ?')
        .run(heartbeatAt, expiresAt, workspaceId, leaseId, heartbeatAt);
      const current = updated.changes === 1 ? this.read(workspaceId) : null;
      if (current === null || current.leaseId !== leaseId) {
        connection.exec('ROLLBACK;');
        return err(appError('PERMISSION_REQUIRED', 'Workspace lease is missing, expired, or owned by another chat', true));
      }
      connection.exec('COMMIT;');
      return ok({ ...current, heartbeatAt, expiresAt });
    } catch (error: unknown) {
      rollback(connection);
      return err(appError('INTERNAL_ERROR', error instanceof Error ? error.message : 'Workspace lease renewal failed', true));
    }
  }

  public async release(workspaceId: string, leaseId: string): Promise<Result<{ readonly released: boolean }>> {
    const connection = this.database.connection;
    connection.exec('BEGIN IMMEDIATE;');
    try {
      this.deleteExpired();
      const result = connection.prepare('DELETE FROM workspace_leases WHERE workspace_id = ? AND lease_id = ?').run(workspaceId, leaseId);
      if (result.changes !== 1) {
        connection.exec('ROLLBACK;');
        return err(appError('PERMISSION_REQUIRED', 'Workspace lease is missing, expired, or owned by another chat', true));
      }
      connection.exec('COMMIT;');
      return ok({ released: true });
    } catch (error: unknown) {
      rollback(connection);
      return err(appError('INTERNAL_ERROR', error instanceof Error ? error.message : 'Workspace lease release failed', true));
    }
  }

  public async assertMutationAllowed(workspaceId: string, leaseId?: string): Promise<Result<void>> {
    const connection = this.database.connection;
    connection.exec('BEGIN IMMEDIATE;');
    try {
      const active = this.readActive(workspaceId);
      if (active === null || active.leaseId === leaseId) {
        connection.exec('COMMIT;');
        return ok(undefined);
      }
      connection.exec('ROLLBACK;');
      return err(appError('PERMISSION_REQUIRED', conflictMessage(active), true));
    } catch (error: unknown) {
      rollback(connection);
      return err(appError('INTERNAL_ERROR', error instanceof Error ? error.message : 'Workspace lease check failed', true));
    }
  }

  private deleteExpired(): void {
    this.database.connection.prepare('DELETE FROM workspace_leases WHERE expires_at <= ?').run(this.now().toISOString());
  }

  private read(workspaceId: string): WorkspaceLease | null {
    return toLease(this.database.connection.prepare('SELECT workspace_id, lease_id, owner, acquired_at, heartbeat_at, expires_at FROM workspace_leases WHERE workspace_id = ?').get(workspaceId));
  }

  private readActive(workspaceId: string): WorkspaceLease | null {
    const lease = this.read(workspaceId);
    return lease !== null && lease.expiresAt > this.now().toISOString() ? lease : null;
  }
}

function toLease(value: unknown): WorkspaceLease | null {
  if (!isLeaseRow(value)) return null;
  return {
    workspaceId: value.workspace_id,
    leaseId: value.lease_id,
    owner: value.owner,
    acquiredAt: value.acquired_at,
    heartbeatAt: value.heartbeat_at,
    expiresAt: value.expires_at,
  };
}

function isLeaseRow(value: unknown): value is WorkspaceLeaseRow {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return ['workspace_id', 'lease_id', 'owner', 'acquired_at', 'heartbeat_at', 'expires_at']
    .every((key) => typeof row[key] === 'string');
}

function conflictMessage(lease: WorkspaceLease): string {
  return `Workspace is leased by ${lease.owner} until ${lease.expiresAt}. Use workspace_lease_status, wait for expiry, or ask the owner to release it.`;
}

function rollback(connection: SqliteDatabase['connection']): void {
  try {
    connection.exec('ROLLBACK;');
  } catch {
    // The transaction may already be closed.
  }
}
