import { describe, expect, it } from 'vitest';
import { tunnelClientEnv } from '../src/main/tunnel-controller.js';

describe('tunnelClientEnv', () => {
  it('pins the stored unrestricted setting for the MCP child', () => {
    const env = tunnelClientEnv('key', 'C:/Users/me/AppData/Roaming/tunnel-client', 'C:/Users/me/AppData/Roaming/lnwjud', true);
    expect(env.LNWJUD_DATA_PATH).toBe('C:/Users/me/AppData/Roaming/lnwjud');
    expect(env.LNWJUD_UNRESTRICTED).toBe('1');
    expect(env.MCP_CONNECTION_MAX_TTL).toBe('168h0m0s');
  });

  it('fails closed when the setting is off or unknown', () => {
    expect(tunnelClientEnv('key', 'dir', 'C:/data', false).LNWJUD_UNRESTRICTED).toBe('0');
    expect(tunnelClientEnv('key', 'dir', 'C:/data', undefined).LNWJUD_UNRESTRICTED).toBe('0');
  });
});
