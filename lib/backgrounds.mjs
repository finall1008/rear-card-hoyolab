// SPDX-License-Identifier: AGPL-3.0-or-later
// Per-page custom card backgrounds. Images are base64 JPEG data URLs, never
// package assets: changing a background only writes settings/storage.
import { HoyoError } from './hoyo.mjs';

export const BACKGROUND_PAGES = ['home', 'genshin', 'hsr', 'zzz'];
export const BACKGROUND_DEFAULT_MODES = Object.freeze({
  home: 'default', genshin: 'default', hsr: 'default', zzz: 'default',
});
export const MAX_CUSTOM_CHARS = 180 * 1024;
export const MAX_BLUR_CHARS = 30 * 1024;
export const MAX_BACKGROUND_BODY = 512 * 1024;

const JPEG_DATA_URL = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/;

export function isBackgroundPage(page) {
  return BACKGROUND_PAGES.includes(page);
}

export function backgroundStorageKey(page) {
  return `hoyolab.background.${page}`;
}

function invalid(code, message) {
  throw new HoyoError('background', code, message);
}

export function defaultBackgroundModes(value = {}) {
  const modes = { ...BACKGROUND_DEFAULT_MODES };
  for (const page of BACKGROUND_PAGES) {
    const mode = value && value[page];
    if (mode === 'default' || mode === 'custom') modes[page] = mode;
  }
  return modes;
}

export function validateBackgroundInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('INVALID_BODY', '背景请求应为对象。');
  const page = input.page;
  if (!isBackgroundPage(page)) invalid('INVALID_PAGE', '未知页面。');
  const mode = input.mode;
  if (mode !== 'default' && mode !== 'custom') invalid('INVALID_MODE', '背景模式只能是默认或自定义。');
  if (mode === 'default') return { page, mode, value: null };

  const custom = typeof input.custom === 'string' ? input.custom : '';
  const customBlur = typeof input.customBlur === 'string' ? input.customBlur : '';
  if (!JPEG_DATA_URL.test(custom)) invalid('INVALID_IMAGE', '自定义背景必须是 JPEG data URL。');
  if (!JPEG_DATA_URL.test(customBlur)) invalid('INVALID_BLUR', '模糊背板必须是 JPEG data URL。');
  if (custom.length > MAX_CUSTOM_CHARS) invalid('IMAGE_TOO_LARGE', '自定义背景过大。');
  if (customBlur.length > MAX_BLUR_CHARS) invalid('BLUR_TOO_LARGE', '模糊背板过大。');
  const width = Number(input.width);
  const height = Number(input.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) {
    invalid('INVALID_SIZE', '自定义背景尺寸无效。');
  }
  return {
    page, mode,
    value: { custom, customBlur, width, height, updatedAt: new Date().toISOString() },
  };
}

export class MemoryBackgroundStore {
  constructor(initial = {}) { this.map = { ...initial }; }
  get(page) { return this.map[page] ?? null; }
  set(page, value) { this.map[page] = value; }
  remove(page) { delete this.map[page]; }
  all() { return { ...this.map }; }
}
