import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CommandRoomPage } from '../src/renderer/features/command-room/CommandRoomPage.js';

describe('Command Room Extension UI', () => {
  it('keeps the dynamic Lead expansion control wired to the trusted Desktop IPC surface', async () => {
    const source = await readFile(new URL('../src/renderer/features/command-room/CommandRoomPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('window.lnwjud.addCommandRoomLead');
    expect(source).toContain("text(locale, 'เพิ่ม Lead', 'Add Lead')");
    expect(source).toContain("room.agents.filter((agent) => agent.role === 'LEAD').length >= 5");
    expect(source).toContain('requiredConnectionEpoch');
    expect(source).toContain('window.lnwjud.reissueCommandRoomBootPrompt');
    expect(source).toContain("text(locale, 'ออก Boot Prompt ใหม่', 'Reissue Boot Prompt')");
    expect(source).toContain('agent.connectionEpoch === 0');
    expect(source).toContain("scrollIntoView({ behavior: 'smooth', block: 'start' })");
    expect(source).toContain('window.lnwjud.bindCommandRoomLeadProject');
    expect(source).toContain("text(locale, 'ผูกโปรเจกต์', 'Bind project')");
    expect(source).toContain('workspaces.filter((workspace) => !isMachineRootWorkspace(workspace))');
    expect(source).not.toContain('projectKeyForWorkspace');
    const bindBlock = source.slice(source.indexOf('async function bindProject'), source.indexOf('async function createRoom'));
    expect(bindBlock).not.toContain('agentSessionId');
    expect(bindBlock).not.toContain('projectKey:');
  });

  it('renders the Phase 3 opt-in boundary without exposing pairing secrets by default', () => {
    const markup = renderToStaticMarkup(createElement(CommandRoomPage, { locale: 'en' }));
    expect(markup).toContain('Browser Extension Wake (Phase 3)');
    expect(markup).toContain('OPT-IN OFF');
    expect(markup).toContain('loopback-only');
    expect(markup).toContain('DELIVERED / SUBMITTED');
    expect(markup).toContain('auto-refreshes every 5 seconds');
    expect(markup).not.toContain('pairing-secret');
    expect(markup).not.toContain('agentSessionId');
  });
});
