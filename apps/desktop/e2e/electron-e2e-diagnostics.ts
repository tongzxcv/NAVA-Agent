import type { ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';

const MAX_CAPTURED_OUTPUT = 64 * 1024;

export interface ElectronE2EDiagnostics {
  readonly phase: (name: string) => void;
  readonly stderr: () => string;
  readonly dump: () => void;
}

export function monitorElectronProcess(child: ChildProcess, label: string): ElectronE2EDiagnostics {
  const startedAt = Date.now();
  let stdout = '';
  let stderr = '';

  const phase = (name: string): void => {
    console.log(`[NAVA-E2E:${label}] +${Date.now() - startedAt}ms ${name}`);
  };
  const capture = (stream: Readable | null, target: 'stdout' | 'stderr'): void => {
    stream?.on('data', (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (target === 'stdout') stdout = `${stdout}${text}`.slice(-MAX_CAPTURED_OUTPUT);
      else stderr = `${stderr}${text}`.slice(-MAX_CAPTURED_OUTPUT);
    });
  };

  capture(child.stdout, 'stdout');
  capture(child.stderr, 'stderr');
  child.once('error', (error) => phase(`spawn-error:${error.message}`));
  child.once('exit', (code, signal) => phase(`exit:code=${code ?? 'null'}:signal=${signal ?? 'none'}`));

  return {
    phase,
    stderr: (): string => stderr,
    dump: (): void => {
      if (stdout.length > 0) console.log(`[NAVA-E2E:${label}:stdout]\n${stdout}`);
      if (stderr.length > 0) console.log(`[NAVA-E2E:${label}:stderr]\n${stderr}`);
    },
  };
}
