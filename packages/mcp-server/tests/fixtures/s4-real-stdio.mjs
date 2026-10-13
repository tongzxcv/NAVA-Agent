/* S4 integration only: does not mutate global Skill Roots or start any child MCP tool. */
import os from 'node:os';
import { startMcpStdio } from '../../dist/stdio.js';
import { LocalExtensionsService, DEFAULT_EXTENSIONS_SETTINGS } from '../../../extensions/dist/index.js';

startMcpStdio({
  services: { extensions: new LocalExtensionsService({ settings: DEFAULT_EXTENSIONS_SETTINGS, homeDir: os.homedir() }) },
  actor: { clientId: 's4-readonly-real', clientName: 'S4 Real Skills STDIO Lab' },
});
