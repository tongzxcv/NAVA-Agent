import type { MenuItemConstructorOptions } from 'electron';
import type { CloseBehavior, UiLocale, UpdateStatus } from '@lnwjud/ipc-contracts';
import { nativeMessages } from './native-i18n.js';
import type { TunnelConnectionDisplayState } from './tunnel-connection-monitor.js';

export interface TrayMenuActions {
  readonly locale: UiLocale;
  readonly openMainWindow: () => void;
  readonly checkForUpdates: () => void;
  readonly updateLabel?: string;
  readonly connectionLabel?: string;
  readonly quit: () => void;
}

export function createTrayMenuTemplate(actions: TrayMenuActions): MenuItemConstructorOptions[] {
  const labels = nativeMessages(actions.locale);
  return [
    ...(actions.connectionLabel === undefined ? [] : [
      { label: actions.connectionLabel, enabled: false },
      { type: 'separator' as const },
    ]),
    { label: labels.trayOpen, click: actions.openMainWindow },
    { label: actions.updateLabel ?? labels.trayCheckUpdates, click: actions.checkForUpdates },
    { type: 'separator' },
    { label: labels.trayQuit, click: actions.quit },
  ];
}

export function createTrayUpdateLabel(status: UpdateStatus, locale: UiLocale): string {
  const messages = nativeMessages(locale);
  const version = status.availableVersion;
  if (status.phase === 'ready' && version !== null) return messages.trayInstall(version);
  if (status.phase === 'installing' && version !== null) return messages.trayPreparing(version);
  if (status.phase === 'downloading' && version !== null) return messages.trayDownloading(version, status.progressPercent);
  if (status.phase === 'checking') return messages.updaterChecking;
  return messages.trayCheckUpdates;
}

export function createTrayConnectionLabel(locale: UiLocale, state: TunnelConnectionDisplayState): string {
  const messages = nativeMessages(locale);
  switch (state) {
    case 'healthy': return messages.trayConnectionHealthy;
    case 'recovering': return messages.trayConnectionRecovering;
    case 'disconnected': return messages.trayConnectionDisconnected;
    case 'stopped': return messages.trayConnectionStopped;
  }
}

export function createTrayToolTip(locale: UiLocale, state?: TunnelConnectionDisplayState): string {
  const messages = nativeMessages(locale);
  if (state === undefined) return messages.trayTooltip;
  return `${messages.trayTooltip} — ${createTrayConnectionLabel(locale, state).replace(/^[^ ]+\s*/, '')}`;
}

export function shouldHideMainWindowOnClose(quitRequested: boolean, closeBehavior: CloseBehavior = 'tray'): boolean {
  return !quitRequested && closeBehavior === 'tray';
}
