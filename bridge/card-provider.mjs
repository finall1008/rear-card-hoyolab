// SPDX-License-Identifier: AGPL-3.0-or-later
import { createBridgeRuntime } from './runtime.mjs';
import { refreshTargets } from '../lib/card-state.mjs';

// Pass these callbacks to HoyoCard.mount. First frame uses readSnapshot synchronously;
// do not await the controller/network/storage before mounting the renderer.
export function bridgeCardProvider(bridge) {
  return {
    initialSnapshot: bridge.card.readSnapshot(),
    async refresh(scope) {
      const targets = refreshTargets(scope);
      const controller = await createBridgeRuntime(bridge);
      for (const game of targets) {
        // Re-read persisted notes; settings page owns login and role discovery.
        const state = await controller.request('GET', '/api/state');
        if (!state.account || !state.settings.selectedRoles[game]) continue;
        await controller.request('POST', '/api/notes/refresh', { game });
      }
      // runtime awaited raw bridge.storage and display bridge.card.saveSnapshot writes.
      return bridge.card.readSnapshot();
    },
  };
}
