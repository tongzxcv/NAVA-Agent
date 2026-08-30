import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CommandRoomPage } from '../src/renderer/features/command-room/CommandRoomPage.js';

describe('Command Room Extension UI', () => {
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
