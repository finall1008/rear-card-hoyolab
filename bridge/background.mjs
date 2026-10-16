// SPDX-License-Identifier: AGPL-3.0-or-later
import { refreshBackground } from './runtime.mjs';
// API 2 creates a fresh WebView, invokes refresh(), awaits it, then destroys it.
// No timer or resident process; Android JobScheduler owns the schedule.
globalThis.refresh = async function refresh() {
  await refreshBackground(globalThis.bridge);
};
