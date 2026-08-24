import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { installProcessOutputErrorGuards } from '../src/main/process-output-guard.js';

describe('packaged GUI output guards', () => {
  it.each(['EPIPE', 'ECONNRESET'])('absorbs expected disconnected-output error %s', (code) => {
    const output = new EventEmitter();
    installProcessOutputErrorGuards(output);

    expect(() => output.emit('error', Object.assign(new Error(code), { code }))).not.toThrow();
  });

  it('does not hide an unexpected output error', () => {
    const output = new EventEmitter();
    installProcessOutputErrorGuards(output);
    const error = Object.assign(new Error('access denied'), { code: 'EACCES' });

    expect(() => output.emit('error', error)).toThrow(error);
  });
});
