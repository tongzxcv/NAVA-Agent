import { describe, expect, it } from 'vitest';
import { resolveCommandRoomExtensionBridgePort } from '../src/main/desktop-services.js';

describe('Command Room Extension Bridge port configuration', () => {
  it('keeps the production default when no override is supplied', () => {
    expect(resolveCommandRoomExtensionBridgePort(undefined, undefined)).toBe(18_766);
    expect(resolveCommandRoomExtensionBridgePort(undefined, '   ')).toBe(18_766);
  });

  it('accepts an explicit runtime option before the environment override, including ephemeral port zero', () => {
    expect(resolveCommandRoomExtensionBridgePort(19_876, '21_000')).toBe(19_876);
    expect(resolveCommandRoomExtensionBridgePort(0, '21_000')).toBe(0);
  });

  it('accepts a bounded numeric environment override for isolated validation', () => {
    expect(resolveCommandRoomExtensionBridgePort(undefined, '19876')).toBe(19_876);
  });

  it('rejects malformed or out-of-range environment values', () => {
    expect(() => resolveCommandRoomExtensionBridgePort(undefined, 'abc')).toThrow(/integer between 1 and 65535/);
    expect(() => resolveCommandRoomExtensionBridgePort(undefined, '0')).toThrow(/integer between 1 and 65535/);
    expect(() => resolveCommandRoomExtensionBridgePort(undefined, '65536')).toThrow(/integer between 1 and 65535/);
  });
});
