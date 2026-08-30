import { describe, expect, it, vi } from 'vitest';
import { buildCapabilitySummary } from '../src/main/capability-runtime.js';

describe('dashboard capability fixture mode', () => {
  it('returns static capability metadata without probing external backends', async () => {
    const execute = vi.fn();
    const summary = await buildCapabilitySummary({ execute } as never, { probe: false });

    expect(execute).not.toHaveBeenCalled();
    expect(summary.length).toBeGreaterThan(0);
    expect(summary.every((capability) => capability.available === false && capability.ready === false)).toBe(true);
  });
});
