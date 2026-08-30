import { pathToFileURL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_VERSION, ipcChannels, type TunnelStatus } from '@lnwjud/ipc-contracts';

const electronHarness = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>(),
  quit: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    requestSingleInstanceLock: vi.fn(() => false),
    quit: electronHarness.quit,
    on: vi.fn(),
    whenReady: vi.fn(async () => undefined),
    setName: vi.fn(),
    setPath: vi.fn(),
    getPath: vi.fn(() => ''),
    setAppUserModelId: vi.fn(),
    isPackaged: false,
  },
  BrowserWindow: class BrowserWindow {
    public static getAllWindows(): unknown[] { return []; }
  },
  dialog: {
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn(async () => ({ response: 1 })),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>) => {
      electronHarness.handlers.set(channel, handler);
    }),
  },
  Menu: { buildFromTemplate: vi.fn() },
  nativeImage: { createFromPath: vi.fn() },
  Tray: class Tray {},
}));

vi.mock('electron-updater', () => ({
  autoUpdater: {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    on: vi.fn(),
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
  },
}));

import { registerIpcHandlers, type DesktopIpcServices } from '../src/main/main.js';
import { getRendererEntryPath } from '../src/main/window.js';

const stoppedTunnel: TunnelStatus = {
  state: 'stopped',
  source: 'desktop',
  hasApiKey: false,
  clientPath: null,
  profileExists: false,
  message: null,
  logPath: null,
};

describe('production desktop IPC acceptance', () => {
  beforeEach(() => {
    electronHarness.handlers.clear();
    electronHarness.quit.mockClear();
  });

  it('routes critical MCP and tunnel start/stop/status calls through registered production handlers', async () => {
    const services = desktopServices();
    registerIpcHandlers(() => ({}) as never, services);

    const event = { senderFrame: { url: pathToFileURL(getRendererEntryPath()).href } };
    const startMcp = requiredHandler(ipcChannels.startMcp);
    const stopMcp = requiredHandler(ipcChannels.stopMcp);
    const startTunnel = requiredHandler(ipcChannels.startTunnel);
    const stopTunnel = requiredHandler(ipcChannels.stopTunnel);
    const getTunnelStatus = requiredHandler(ipcChannels.getTunnelStatus);

    await expect(startMcp(event, { workspaceId: 'workspace-production' })).resolves.toEqual({ running: true, url: null, workspaceId: 'workspace-production' });
    await expect(stopMcp(event)).resolves.toEqual({ running: false, url: null, workspaceId: null });
    await expect(startTunnel(event)).resolves.toMatchObject({ state: 'running', source: 'desktop' });
    await expect(getTunnelStatus(event)).resolves.toMatchObject({ state: 'running', source: 'desktop' });
    await expect(stopTunnel(event)).resolves.toMatchObject({ state: 'stopped', source: 'desktop' });

    expect(services.startMcp).toHaveBeenCalledWith({ workspaceId: 'workspace-production' });
    expect(services.stopMcp).toHaveBeenCalledOnce();
    expect(services.startTunnel).toHaveBeenCalledOnce();
    expect(services.getTunnelStatus).toHaveBeenCalledOnce();
    expect(services.stopTunnel).toHaveBeenCalledOnce();
  });

  it('routes and validates AI delete and STDIO security policy changes', async () => {
    const services = desktopServices();
    registerIpcHandlers(() => ({}) as never, services);
    const trusted = { senderFrame: { url: pathToFileURL(getRendererEntryPath()).href } };

    await expect(requiredHandler(ipcChannels.setAiDeletePolicy)(trusted, { enabled: true })).resolves.toEqual({ enabled: true });
    await expect(requiredHandler(ipcChannels.setStdioPolicy)(trusted, { profile: 'safe', strictRoots: true, allowedRoots: ['E:\\work'] }))
      .resolves.toMatchObject({ profile: 'safe', strictRoots: true, allowedRoots: ['E:\\work'] });
    await expect(requiredHandler(ipcChannels.setStdioPolicy)(trusted, { profile: 'safe', strictRoots: true, allowedRoots: [] }))
      .rejects.toThrow(/requires at least one allowed root/);
  });

  it('routes a bounded Command Room overview and validates Main 1 + Lead 5 creation', async () => {
    const services = desktopServices();
    registerIpcHandlers(() => ({}) as never, services);
    const trusted = { senderFrame: { url: pathToFileURL(getRendererEntryPath()).href } };

    await expect(requiredHandler(ipcChannels.getCommandRoomOverview)(trusted)).resolves.toEqual({ rooms: [] });
    await expect(requiredHandler(ipcChannels.createCommandRoom)(trusted, { name: '  EA Portfolio  ' })).resolves.toMatchObject({
      room: { name: 'EA Portfolio', agents: [{ slotKey: 'MAIN' }] },
      joinCodes: { MAIN: 'one-time-main' },
    });
    await expect(requiredHandler(ipcChannels.createCommandRoom)(trusted, { name: '' })).rejects.toThrow('Invalid IPC payload: name');
    await expect(requiredHandler(ipcChannels.createCommandRoom)(trusted, { name: 'x'.repeat(121) })).rejects.toThrow('Invalid IPC payload: name');
    await expect(requiredHandler(ipcChannels.addCommandRoomLead)(trusted, { roomId: 'room-1', expectedVersion: 7 })).resolves.toMatchObject({
      slotKey: 'LEAD-4', requiredConnectionEpoch: 1, joinCode: 'one-time-lead-4',
    });
    await expect(requiredHandler(ipcChannels.addCommandRoomLead)(trusted, { roomId: 'room-1', expectedVersion: 0 })).rejects.toThrow('Invalid IPC payload: expectedVersion');

    expect(services.createCommandRoom).toHaveBeenCalledWith({ name: 'EA Portfolio' });
    expect(services.addCommandRoomLead).toHaveBeenCalledWith({ roomId: 'room-1', expectedVersion: 7 });
  });

  it('routes Command Room Extension opt-in, pairing, wake, and revoke through trusted IPC only', async () => {
    const services = desktopServices();
    registerIpcHandlers(() => ({}) as never, services);
    const trusted = { senderFrame: { url: pathToFileURL(getRendererEntryPath()).href } };
    const origin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    await expect(requiredHandler(ipcChannels.getCommandRoomExtensionOverview)(trusted)).resolves.toMatchObject({
      bridge: { enabled: false, running: false }, agents: [],
    });
    await expect(requiredHandler(ipcChannels.setCommandRoomExtensionConfig)(trusted, { enabled: true, allowedOrigins: [origin] })).resolves.toMatchObject({
      enabled: true, running: true, allowedOrigins: [origin],
    });
    await expect(requiredHandler(ipcChannels.createCommandRoomPairing)(trusted, { roomId: 'room-1', slotKey: 'LEAD-1' })).resolves.toMatchObject({
      roomId: 'room-1', slotKey: 'LEAD-1', bindingId: 'binding-1',
    });
    await expect(requiredHandler(ipcChannels.wakeCommandRoomAgent)(trusted, { roomId: 'room-1', slotKey: 'LEAD-1' })).resolves.toMatchObject({
      outcome: 'queued', wake: { id: 'wake-1', state: 'QUEUED' },
    });
    await expect(requiredHandler(ipcChannels.revokeCommandRoomExtensionBinding)(trusted, { roomId: 'room-1', slotKey: 'LEAD-1' })).resolves.toEqual({ revoked: true });

    await expect(requiredHandler(ipcChannels.setCommandRoomExtensionConfig)(trusted, { enabled: true, allowedOrigins: 'not-an-array' }))
      .rejects.toThrow('Invalid IPC payload: Command Room extension config');
    await expect(requiredHandler(ipcChannels.createCommandRoomPairing)(trusted, { roomId: 'room-1', slotKey: 'LEAD-9' }))
      .rejects.toThrow('Invalid IPC payload: slotKey');
    await expect(requiredHandler(ipcChannels.wakeCommandRoomAgent)({ senderFrame: { url: 'https://example.invalid/' } }, { roomId: 'room-1', slotKey: 'LEAD-1' }))
      .rejects.toThrow('IPC sender rejected');

    expect(services.setCommandRoomExtensionConfig).toHaveBeenCalledWith({ enabled: true, allowedOrigins: [origin] });
    expect(services.createCommandRoomPairing).toHaveBeenCalledWith({ roomId: 'room-1', slotKey: 'LEAD-1' });
    expect(services.wakeCommandRoomAgent).toHaveBeenCalledWith({ roomId: 'room-1', slotKey: 'LEAD-1' });
    expect(services.revokeCommandRoomExtensionBinding).toHaveBeenCalledWith({ roomId: 'room-1', slotKey: 'LEAD-1' });
  });

  it('notifies the native tray after a trusted locale change', async () => {
    const services = desktopServices();
    const onLocaleChanged = vi.fn();
    registerIpcHandlers(() => ({}) as never, services, { onLocaleChanged });
    const trusted = { senderFrame: { url: pathToFileURL(getRendererEntryPath()).href } };

    await expect(requiredHandler(ipcChannels.setLocale)(trusted, { locale: 'en' })).resolves.toEqual({ locale: 'en' });

    expect(services.setLocale).toHaveBeenCalledWith({ locale: 'en' });
    expect(onLocaleChanged).toHaveBeenCalledExactlyOnceWith('en');
  });

  it('exposes updater status, manual check, and install actions through trusted IPC', async () => {
    const services = desktopServices();
    registerIpcHandlers(() => ({}) as never, services);
    const trusted = { senderFrame: { url: pathToFileURL(getRendererEntryPath()).href } };

    await expect(requiredHandler(ipcChannels.getUpdateStatus)(trusted)).resolves.toMatchObject({
      phase: 'unavailable',
      currentVersion: APP_VERSION,
      canInstall: false,
    });
    await expect(requiredHandler(ipcChannels.checkForUpdates)(trusted)).resolves.toMatchObject({ phase: 'unavailable' });
    await expect(requiredHandler(ipcChannels.installUpdate)(trusted)).resolves.toMatchObject({
      accepted: false,
      status: { phase: 'unavailable' },
    });
  });

  it('enforces the production IPC sender and payload guards before invoking services', async () => {
    const services = desktopServices();
    registerIpcHandlers(() => ({}) as never, services);
    const handler = requiredHandler(ipcChannels.startMcp);
    const trusted = { senderFrame: { url: pathToFileURL(getRendererEntryPath()).href } };

    await expect(handler(trusted, { workspaceId: '' })).rejects.toThrow('Invalid IPC payload: workspaceId');
    await expect(handler({ senderFrame: { url: 'https://example.invalid/' } }, { workspaceId: 'workspace-production' })).rejects.toThrow('IPC sender rejected');
    expect(services.startMcp).not.toHaveBeenCalled();
  });
});

function requiredHandler(channel: string): (event: unknown, payload?: unknown) => Promise<unknown> {
  const handler = electronHarness.handlers.get(channel);
  if (handler === undefined) throw new Error(`Production IPC handler was not registered: ${channel}`);
  return handler;
}

function desktopServices(): DesktopIpcServices {
  let tunnelStatus: TunnelStatus = stoppedTunnel;
  return {
    listWorkspaces: vi.fn(async () => []),
    addWorkspace: vi.fn(async () => { throw new Error('unused'); }),
    selectWorkspace: vi.fn(async () => { throw new Error('unused'); }),
    getDashboard: vi.fn(async () => { throw new Error('unused'); }),
    getCommandRoomOverview: vi.fn(async () => ({ rooms: [] })),
    createCommandRoom: vi.fn(async (request) => ({
      duplicate: false,
      room: {
        id: 'room-1', name: request.name, status: 'ACTIVE', version: 1,
        createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
        agents: [{ slotKey: 'MAIN', role: 'MAIN', provider: 'CHATGPT', state: 'AVAILABLE' }],
        tasks: [],
      },
      joinCodes: { MAIN: 'one-time-main' },
    })),
    addCommandRoomLead: vi.fn(async (request) => ({
      duplicate: false,
      room: {
        id: request.roomId, name: 'Existing Room', status: 'ACTIVE', version: request.expectedVersion + 1,
        createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
        agents: [
          { slotKey: 'MAIN', role: 'MAIN', provider: 'CHATGPT', state: 'ONLINE' },
          { slotKey: 'LEAD-4', role: 'LEAD', provider: 'CHATGPT', state: 'AVAILABLE' },
        ],
        tasks: [], writerLeases: [], resources: [], resourceLeases: [], resourceQueueDepth: 0,
      },
      slotKey: 'LEAD-4', requiredConnectionEpoch: 1, joinCode: 'one-time-lead-4',
    })),
    deleteCommandRoom: vi.fn(async () => ({ deleted: true })),
    getCommandRoomExtensionOverview: vi.fn(async () => ({
      bridge: { enabled: false, running: false, url: null, allowedOrigins: [], message: null },
      agents: [],
    })),
    setCommandRoomExtensionConfig: vi.fn(async (request) => ({
      enabled: request.enabled, running: request.enabled, url: request.enabled ? 'http://127.0.0.1:18766' : null,
      allowedOrigins: request.allowedOrigins, message: null,
    })),
    createCommandRoomPairing: vi.fn(async (request) => ({
      roomId: request.roomId, slotKey: request.slotKey, bindingId: 'binding-1', challenge: 'x'.repeat(32),
      expiresAt: new Date(300_000).toISOString(), connectionEpoch: 1, bridgeUrl: 'http://127.0.0.1:18766',
      allowedOrigins: ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    })),
    wakeCommandRoomAgent: vi.fn(async () => ({
      outcome: 'queued' as const, duplicate: false, wake: {
        id: 'wake-1', reason: 'USER_WAKE' as const, state: 'QUEUED' as const, attemptCount: 0, updatedAt: new Date(0).toISOString(),
      },
    })),
    revokeCommandRoomExtensionBinding: vi.fn(async () => ({ revoked: true })),
    setPermissionProfile: vi.fn(async (request) => ({ profile: request.profile })),
    setUnrestrictedMode: vi.fn(async (request) => ({ unrestricted: request.enabled, restartRequired: false })),
    setAiDeletePolicy: vi.fn(async (request) => ({ enabled: request.enabled })),
    setStdioPolicy: vi.fn(async (request) => ({ profile: request.profile, strictRoots: request.strictRoots, allowedRoots: request.allowedRoots, restartRequired: false })),
    listProcesses: vi.fn(async () => []),
    startProcess: vi.fn(async () => { throw new Error('unused'); }),
    stopProcess: vi.fn(async () => ({ stopped: true })),
    startMcp: vi.fn(async (request) => ({ running: true, url: null, workspaceId: request.workspaceId })),
    stopMcp: vi.fn(async () => ({ running: false, url: null, workspaceId: null })),
    restartMcp: vi.fn(async () => ({ running: true, url: null, workspaceId: 'workspace-production' })),
    clearWorkLog: vi.fn(async () => ({ cleared: true })),
    saveTunnelApiKey: vi.fn(async () => ({ saved: true })),
    startTunnel: vi.fn(async () => {
      tunnelStatus = { ...stoppedTunnel, state: 'running' };
      return tunnelStatus;
    }),
    stopTunnel: vi.fn(async () => {
      tunnelStatus = stoppedTunnel;
      return tunnelStatus;
    }),
    getTunnelStatus: vi.fn(async () => tunnelStatus),
    setTunnelClientPath: vi.fn(async (request) => ({ clientPath: request.clientPath })),
    setLocale: vi.fn(async (request) => ({ locale: request.locale })),
    launchManagedBrowser: vi.fn(async () => ({ ready: true, port: 9222, launched: false })),
    runDoctor: vi.fn(async () => ({ checks: [], exitCode: 0 })),
    getLogSnapshot: vi.fn(async () => ({ lines: [], tunnelLogPath: null, tunnelLogExists: false })),
    clearLogBuffer: vi.fn(async () => ({ cleared: true })),
    captureIncident: vi.fn(async () => ({
      schemaVersion: 1,
      capturedAt: new Date(0).toISOString(),
      appVersion: 'test',
      tunnelClientVersion: null,
      tunnelClientVersionReason: 'test',
      classification: 'healthy_or_inconclusive',
      classificationReasons: [],
      updaterEventTail: [],
      tunnel: { state: 'stopped', source: 'desktop', instanceIds: [], requestIds: [], health: { state: 'unavailable', message: 'test' } },
      mcpCalls: [],
      tunnelLogTail: [],
      processTree: { available: false, entries: [], error: 'test' },
      tcpListeners: { available: false, entries: [], error: 'test' },
    })),
  };
}
