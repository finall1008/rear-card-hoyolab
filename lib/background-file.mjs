// SPDX-License-Identifier: AGPL-3.0-or-later
// Node-only file persistence for local prototype backgrounds.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Same shape as the bridge.storage per-page values, persisted locally. */
export class FileBackgroundStore {
  constructor(file) { this.file = resolve(file); }
  load() {
    try {
      const value = JSON.parse(readFileSync(this.file, 'utf8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
  }
  save(map) {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const temp = this.file + '.tmp';
    writeFileSync(temp, JSON.stringify(map, null, 2) + '\n', { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, this.file);
  }
  get(page) { return this.load()[page] ?? null; }
  set(page, value) { const map = this.load(); map[page] = value; this.save(map); }
  remove(page) { const map = this.load(); delete map[page]; this.save(map); }
  all() { return this.load(); }
}
