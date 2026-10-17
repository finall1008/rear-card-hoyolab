// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKGROUND_DEFAULT_MODES, defaultBackgroundModes, validateBackgroundInput,
  MAX_CUSTOM_CHARS, MAX_BLUR_CHARS,
} from '../lib/backgrounds.mjs';

const jpeg = length => 'data:image/jpeg;base64,' + 'A'.repeat(length);
test('per-page background modes default to default and preserve valid values', () => {
  assert.deepEqual(defaultBackgroundModes(), BACKGROUND_DEFAULT_MODES);
  assert.deepEqual(defaultBackgroundModes({ home: 'custom', hsr: 'nope' }), { home: 'custom', genshin: 'default', hsr: 'default', zzz: 'default' });
});
test('default mode clears the image and custom mode requires bounded JPEG data URLs', () => {
  assert.deepEqual(validateBackgroundInput({ page: 'genshin', mode: 'default' }), { page: 'genshin', mode: 'default', value: null });
  const custom = jpeg(2048), customBlur = jpeg(512);
  const saved = validateBackgroundInput({ page: 'zzz', mode: 'custom', custom, customBlur, width: 912, height: 596 });
  assert.equal(saved.value.custom, custom);
  assert.equal(saved.value.customBlur, customBlur);
  assert.equal(saved.value.width, 912);
  for (const bad of [
    { page: 'other', mode: 'default' },
    { page: 'home', mode: 'auto' },
    { page: 'home', mode: 'custom', custom: 'https://evil.test/a.jpg', customBlur, width: 912, height: 596 },
    { page: 'home', mode: 'custom', custom: jpeg(MAX_CUSTOM_CHARS), customBlur, width: 912, height: 596 },
    { page: 'home', mode: 'custom', custom, customBlur: jpeg(MAX_BLUR_CHARS), width: 912, height: 596 },
    { page: 'home', mode: 'custom', custom, customBlur, width: 0, height: 596 },
  ]) {
    assert.throws(() => validateBackgroundInput(bad));
  }
});
