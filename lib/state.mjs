// SPDX-License-Identifier: AGPL-3.0-or-later
import { uuid } from './platform.mjs';
export function initialState() {
  return { version: 1, deviceID: uuid(), fpRefreshDate: Date.now() / 1000,
    account: null, pending: null, profiles: {}, roles: [], roleErrors: {},
    settings: { selectedRoles: {}, intervalMinutes: 15 }, notes: {} };
}
