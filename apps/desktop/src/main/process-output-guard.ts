export interface OutputErrorSource {
  on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown;
}

export function installProcessOutputErrorGuards(...outputs: readonly OutputErrorSource[]): void {
  for (const output of outputs) {
    output.on('error', (error) => {
      if (error.code === 'EPIPE' || error.code === 'ECONNRESET') return;
      throw error;
    });
  }
}
