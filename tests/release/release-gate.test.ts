import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');

describe('MVP release verification gate', () => {
  it('runs the required Windows verification stages in order and fails fast', async () => {
    const script = await readFile(path.join(repositoryRoot, 'scripts', 'verify-release.ps1'), 'utf8');
    const stages = [
      'install --frozen-lockfile',
      'lint',
      'typecheck',
      'test',
      'test:acceptance',
      'test:integration',
      'test:e2e',
      'build',
      'test:packaging',
      'test:release-gate',
      'package:windows',
    ];
    let previousIndex = -1;
    for (const stage of stages) {
      const index = script.indexOf(stage);
      expect(index, `missing release stage: ${stage}`).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
    expect(script).toContain('if ($LASTEXITCODE -ne 0)');
    expect(script).toContain('git diff --check');
  });

  it('documents the acceptance evidence and clean-machine limitations', async () => {
    const checklist = await readFile(path.join(repositoryRoot, '.github', 'RELEASE_CHECKLIST.md'), 'utf8');
    for (const evidence of [
      'traversal',
      'junction',
      'secret',
      'MCP local HTTP',
      'process ownership',
      'output limit',
      'fake Codex',
      'packaged-app smoke',
      'real Codex',
      'git diff --check',
    ]) {
      expect(checklist.toLowerCase()).toContain(evidence.toLowerCase());
    }
  });
  it('installs the Electron runtime before clean-machine desktop execution', async () => {
    const rootPackage = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    const desktopPackage = JSON.parse(
      await readFile(path.join(repositoryRoot, 'apps', 'desktop', 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    expect(desktopPackage.scripts?.['electron:install']).toBe('node node_modules/electron/install.js');
    expect(desktopPackage.scripts?.['test:e2e']).toMatch(/^node node_modules\/electron\/install\.js && /);
    expect(rootPackage.scripts?.desktop).toContain('--filter @lnwjud/desktop electron:install');
  });

  it('provisions ripgrep on fresh Windows CI and release runners before E2E', async () => {
    for (const workflowName of ['ci.yml', 'release.yml']) {
      const workflow = await readFile(path.join(repositoryRoot, '.github', 'workflows', workflowName), 'utf8');
      expect(workflow).toContain('Install ripgrep for E2E search');
      expect(workflow).toContain('scripts/ensure-ripgrep.ps1');
      expect(workflow).not.toContain('choco install ripgrep');
      expect(workflow.indexOf('Install ripgrep for E2E search')).toBeLessThan(workflow.indexOf('Run authoritative verification gate'));
    }
  });

  it('allows unsigned Windows installer checks only for branch and PR CI, never public tag releases', async () => {
    const script = await readFile(path.join(repositoryRoot, 'scripts', 'verify-release.ps1'), 'utf8');
    const ciWorkflow = await readFile(path.join(repositoryRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
    const releaseWorkflow = await readFile(path.join(repositoryRoot, '.github', 'workflows', 'release.yml'), 'utf8');
    expect(ciWorkflow).toContain('verify-release.ps1 -SourceOnlyCI');
    expect(releaseWorkflow).toContain('scripts/verify-release.ps1');
    expect(releaseWorkflow).not.toContain('verify-release.ps1 -SourceOnlyCI');
    expect(script).toContain('if ($SourceOnlyCI)');
    expect(script).toContain("$env:GITHUB_ACTIONS -ne 'true'");
    expect(script).toContain("$env:GITHUB_EVENT_NAME -notin @('push', 'pull_request')");
    expect(script).toContain("$env:GITHUB_REF -notmatch '^refs/(heads|pull)/'");
    expect(script).toContain('Get-AuthenticodeSignature');
    expect(script).toContain('SignatureStatus]::Valid');
  });

  it('rejects release tags that do not match the packaged application version', async () => {
    const workflow = await readFile(path.join(repositoryRoot, '.github', 'workflows', 'release.yml'), 'utf8');
    expect(workflow).toContain('github.ref_name');
    expect(workflow).toContain('package.json');
    expect(workflow).toMatch(/tag.*match|match.*tag/i);
  });

});
