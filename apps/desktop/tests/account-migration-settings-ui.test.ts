import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DashboardSnapshot } from '@lnwjud/ipc-contracts';
import { SettingsPage } from '../src/renderer/features/settings/SettingsPage.js';

const noop = async (): Promise<void> => undefined;
const dashboard: DashboardSnapshot = {
  selectedWorkspace: null,
  gitSummary: { branch: null, changedFiles: 0, stagedFiles: 0, message: '' },
  mcp: { running: false, url: null, workspaceId: null },
  codex: { installed: true, version: '0.149.0' },
  managedProcessCount: 0,
  auditEventCount: 0,
  recentAuditEvents: [],
  permissionProfile: 'full',
  capabilities: [],
  agentState: 'idle',
  mode: 'WORK',
  locale: 'th',
  unrestricted: true,
  allowAiDelete: false,
  stdioPermissionProfile: 'full',
  stdioStrictRoots: false,
  stdioAllowedRoots: [],
  backups: [],
  connectionModes: { httpUrl: 'http://127.0.0.1:18765/mcp', stdioCommand: '"NAVA Agent.exe" --mcp-stdio' },
  workLog: [],
  inFlight: [],
  tunnel: { state: 'stopped', source: 'desktop', hasApiKey: true, clientPath: 'D:\\Program Files\\NAVA Agent\\tunnel-client.exe', profileExists: true, message: null, logPath: null },
  appVersion: '4.8.5',
};

function render(locale: 'th' | 'en'): string {
  return renderToStaticMarkup(createElement(SettingsPage, {
    locale,
    initialSection: 'tunnel',
    dashboard: { ...dashboard, locale },
    onLocaleChange: noop,
    onPermissionProfileChange: noop,
    onUnrestrictedChange: async (): Promise<boolean> => false,
    onAiDeleteChange: noop,
    onStdioPolicyChange: async (): Promise<boolean> => false,
    onCreateBackup: noop,
    onScheduleRestoreBackup: async (): Promise<boolean> => false,
    onSaveTunnelApiKey: noop,
    onSetTunnelClientPath: noop,
    onUserSettingsChange: async (): Promise<boolean> => false,
    onChooseTunnelClientPath: async (): Promise<string | null> => null,
    onConfigureTunnelProfile: async (): Promise<string> => '',
  }));
}

describe('OpenAI account migration settings', () => {
  it('explains the safe Thai account-switch workflow without revealing the stored key', () => {
    const markup = render('th');

    expect(markup).toContain('เปลี่ยนบัญชี OpenAI / ย้าย Tunnel');
    expect(markup).toContain('Tunnels Read + Use');
    expect(markup).toContain('ระบบจะไม่แสดงคีย์เดิมกลับมา');
    expect(markup).toContain('autoComplete="new-password"');
    expect(markup).toContain('<button type="button" class="btn-save-gold" disabled="">เปลี่ยนคีย์</button>');
    expect(markup).not.toContain('sk-proj-');
  });

  it('provides the same account and workspace distinction in English', () => {
    const markup = render('en');

    expect(markup).toContain('Switch OpenAI account / move Tunnel');
    expect(markup).toContain('New account, same organization/workspace');
    expect(markup).toContain('New organization or workspace');
    expect(markup).toContain('NAVA never displays the saved key.');
  });
});
