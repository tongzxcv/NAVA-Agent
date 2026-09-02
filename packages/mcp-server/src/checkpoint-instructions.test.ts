import { describe, expect, it } from 'vitest';
import { NAVA_SERVER_INSTRUCTIONS } from './server.js';

describe('NAVA end-of-round checkpoint instructions', () => {
  it('requires a durable resumable checkpoint at the end of every multi-step work round', () => {
    expect(NAVA_SERVER_INSTRUCTIONS).toContain('end of every work round');
    expect(NAVA_SERVER_INSTRUCTIONS).toContain('call session_checkpoint before the final reply');
    expect(NAVA_SERVER_INSTRUCTIONS).toContain('returned checkpoint ID');
    expect(NAVA_SERVER_INSTRUCTIONS).toContain('does not replace the durable checkpoint UUID');
    expect(NAVA_SERVER_INSTRUCTIONS).toContain('canonical accepted baseline');
    expect(NAVA_SERVER_INSTRUCTIONS).toContain('ACCEPT/REJECT/PENDING');
    expect(NAVA_SERVER_INSTRUCTIONS).toContain('exact resume point');
    expect(NAVA_SERVER_INSTRUCTIONS).toContain('last completed gate');
    expect(NAVA_SERVER_INSTRUCTIONS).toContain('next unfinished gate');
  });

  it('preserves explicit read-only boundaries instead of persisting continuity state', () => {
    expect(NAVA_SERVER_INSTRUCTIONS).toContain('read-only/no-write');
    expect(NAVA_SERVER_INSTRUCTIONS).toContain('no durable checkpoint was persisted');
    expect(NAVA_SERVER_INSTRUCTIONS).toContain('do not mutate files merely to save it');
  });
});
