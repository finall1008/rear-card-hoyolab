// SPDX-License-Identifier: AGPL-3.0-or-later
import { createBridgeRuntime } from './runtime.mjs';
// Lazy initialization waits for the host-injected bridge-shim.js.
// This facade is never installed in the desktop prototype.
let runtime;
globalThis.hoyoRuntime = {
  mode: 'bridge',
  async request(method, path, body) {
    runtime ??= createBridgeRuntime(globalThis.bridge);
    return (await runtime).request(method, path, body);
  },
};
