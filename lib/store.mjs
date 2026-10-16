// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
export { initialState } from './state.mjs';

export class FileStore {
  constructor(file) { this.file = resolve(file); }
  load() {
    try { return JSON.parse(readFileSync(this.file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
  }
  save(state) {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const temp = this.file + '.tmp';
    writeFileSync(temp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
    chmodSync(temp, 0o600);
    // Destination is the explicit, resolved state file passed to FileStore.
    renameSync(temp, this.file);
  }
}
