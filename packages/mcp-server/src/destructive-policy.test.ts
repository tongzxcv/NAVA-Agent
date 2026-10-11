import { describe, expect, it } from 'vitest';
import { inspectDestructiveOperation } from './destructive-policy.js';

describe('central destructive policy', () => {
  it.each([
    [['reset', '--hard'], true],
    [['clean', '-fd'], true],
    [['rm', 'file.txt'], true],
    [['checkout', '--', 'file.txt'], true],
    [['checkout', '-B', 'main', 'HEAD~1'], true],
    [['switch', '-C', 'main', 'HEAD~1'], true],
    [['branch', '-f', 'main', 'HEAD~1'], true],
    [['branch', '-D', 'old'], true],
    [['tag', '-f', 'v1'], true],
    [['stash', 'pop'], true],
    [['stash', 'clear'], true],
    [['reflog', 'expire', '--expire=now', '--all'], true],
    [['push', '--force', 'origin', 'main'], true],
    [['status', '--short'], false],
    [['diff'], false],
    [['reflog', 'show'], false],
  ])('classifies git %j destructive=%s', (args, destructive) => {
    expect(inspectDestructiveOperation('git', { args }).destructive).toBe(destructive);
  });

  it('detects destructive commands hidden behind process_start node scripts', () => {
    expect(inspectDestructiveOperation('process_start', {
      executable: 'node',
      args: ['-e', "require('fs').rmSync('x', { recursive: true })"],
    }).destructive).toBe(true);
  });

  it.each(['rm', 'del'])('detects PowerShell %s aliases hidden behind process_start', (command) => {
    expect(inspectDestructiveOperation('process_start', {
      executable: 'powershell',
      args: ['-Command', `${command} x.txt`],
    }).destructive).toBe(true);
  });

  it('classifies process termination as destructive across shell boundaries', () => {
    expect(inspectDestructiveOperation('shell', {
      operation: 'run', executable: 'powershell.exe', arguments: ['-Command', 'Get-Process pythonw | Stop-Process -Force'],
    }).destructive).toBe(true);
    expect(inspectDestructiveOperation('process_start', {
      executable: 'powershell.exe', args: ['-Command', 'Stop-Process -Id 1234 -Force'],
    }).destructive).toBe(true);
    expect(inspectDestructiveOperation('shell', {
      operation: 'run', executable: 'taskkill.exe', arguments: ['/PID', '1234', '/F'],
    }).destructive).toBe(true);
    expect(inspectDestructiveOperation('shell', {
      operation: 'run', executable: 'cmd.exe', arguments: ['/c', 'taskkill /PID 1234 /F'],
    }).destructive).toBe(true);
    expect(inspectDestructiveOperation('remote_ssh', {
      operation: 'run', executable: 'taskkill.exe', arguments: ['/PID', '1234', '/F'],
    }).destructive).toBe(true);
    expect(inspectDestructiveOperation('shell', {
      operation: 'run', executable: 'powershell.exe', arguments: ['-Command', 'Get-Process pythonw'],
    }).destructive).toBe(false);
  });

  it('treats opaque UI and delegated-agent mutation boundaries conservatively', () => {
    expect(inspectDestructiveOperation('dom_cdp', { action: 'click', parameters: { selector: '#submit' } }).destructive).toBe(true);
    expect(inspectDestructiveOperation('accessibility', { action: 'click', parameters: { name: 'OK' } }).destructive).toBe(true);
    expect(inspectDestructiveOperation('input_event', { operation: 'type_text', parameters: { text: 'del x' } }).destructive).toBe(true);
    expect(inspectDestructiveOperation('codex_run', { instruction: 'edit files' }).destructive).toBe(true);
    expect(inspectDestructiveOperation('mcp_call', { server: 'child', tool: 'read_file' }).destructive).toBe(true);
  });

  it('guards persistent removals exposed by upgrade tools', () => {
    expect(inspectDestructiveOperation('plugin_remove', { name: 'x' }).destructive).toBe(true);
    expect(inspectDestructiveOperation('hook_remove', { name: 'x' }).destructive).toBe(true);
  });

  it('guards SSH file transfer and delete-like remote commands', () => {
    expect(inspectDestructiveOperation('remote_ssh', { operation: 'test' }).destructive).toBe(false);
    expect(inspectDestructiveOperation('remote_ssh', { operation: 'run', executable: 'ls', arguments: [] }).destructive).toBe(false);
    expect(inspectDestructiveOperation('remote_ssh', { operation: 'run', executable: 'rm', arguments: ['file'] }).destructive).toBe(true);
    expect(inspectDestructiveOperation('remote_ssh', { operation: 'upload' }).destructive).toBe(true);
    expect(inspectDestructiveOperation('remote_ssh', { operation: 'download' }).destructive).toBe(true);
  });
});
