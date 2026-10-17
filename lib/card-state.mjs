// SPDX-License-Identifier: AGPL-3.0-or-later
// Display-only DTO. Never copy account, profiles, auth headers or raw API envelopes.
export const CARD_GAMES = ['genshin', 'hsr', 'zzz'];
const NAMES = { genshin: '原神', hsr: '星穹铁道', zzz: '绝区零' };
const has = value => value !== null && value !== undefined;
const number = value => has(value) && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
export function duration(seconds) {
  const n = number(seconds);
  if (n === null) return '尚未获取';
  if (n <= 0) return '已恢复';
  const minutes = Math.ceil(n / 60);
  return `${Math.floor(minutes / 60)}小时${minutes % 60}分`;
}
const metric = (label, current, max) => ({ label, current: number(current), max: number(max) });
const pair = (a, b) => has(a) || has(b) ? `${has(a) ? a : '—'}/${has(b) ? b : '—'}` : null;
const ENUM_TEXT = {
  SaleStateDone: '已结算', SaleStateNo: '未营业', SaleStateDoing: '经营中',
  CafeStateDone: '已供应', CafeStateNo: '未供应',
  CardSignDone: '已签到', CardSignNo: '未签到',
};
const enumText = value => typeof value === 'string' ? ENUM_TEXT[value] ?? value : value;

function transformerStatus(t) {
  if (!t || typeof t !== 'object') return null;
  if (t.obtained === false) return '未获得';
  const rt = t.recovery_time;
  if (rt && typeof rt === 'object') {
    if (rt.reached) return '已就绪';
    if (has(rt.Day) || has(rt.Hour)) return `冷却 ${rt.Day ?? 0}天${rt.Hour ?? 0}时`;
  }
  return t.obtained ? '已获得' : null;
}

function gameCard(game, note, role) {
  const d = note.data ?? {};
  const updatedAt = note.updatedAt;
  const at = Date.parse(updatedAt);
  const list = [];
  const seen = new Set();
  const row = (label, value, highlight) => {
    if (!has(value) || seen.has(label)) return;
    seen.add(label);
    list.push({ label, value, highlight: !!highlight });
  };
  let primary, daily, seconds;
  if (game === 'genshin') {
    primary = metric('原粹树脂', d.current_resin, d.max_resin);
    const tasks = d.daily_task;
    const finished = d.finished_task_num, total = d.total_task_num;
    const received = has(d.is_extra_task_reward_received) ? d.is_extra_task_reward_received : tasks?.is_extra_task_reward_received;
    daily = metric('每日委托', has(finished) ? finished : tasks?.finished_num, has(total) ? total : tasks?.total_num);
    daily.reward = has(received) ? (received ? '奖励已领' : '奖励未领') : '奖励未知';
    seconds = d.resin_recovery_time;
    row('探索派遣', pair(d.current_expedition_num, d.max_expedition_num));
    row('洞天宝钱', pair(d.current_home_coin, d.max_home_coin));
    row('周本减半剩余', pair(d.remain_resin_discount_num, d.resin_discount_num_limit));
    row('参量质变仪', transformerStatus(d.transformer), transformerStatus(d.transformer) === '已就绪');
    if (tasks && typeof tasks === 'object' && has(tasks.stored_attendance)) row('长效历练点', tasks.stored_attendance);
    const wk = d.week_active_progress;
    if (wk && typeof wk === 'object' && wk.unlock !== false) {
      row('周活跃', pair(wk.progress_current, wk.progress_total), wk.is_finish_all_mainline === true);
    }
  } else if (game === 'hsr') {
    primary = metric('开拓力', d.current_stamina, d.max_stamina);
    daily = metric('每日实训', d.current_train_score, d.max_train_score);
    seconds = d.stamina_recover_time;
    const fullTs = number(d.stamina_full_ts);
    if (fullTs !== null && fullTs > 0) primary.recoveryAt = fullTs * 1000;
    row('委托派遣', pair(d.accepted_epedition_num, d.total_expedition_num));
    if (has(d.current_reserve_stamina)) {
      row('后备开拓力', d.is_reserve_stamina_full ? `${d.current_reserve_stamina} 已满` : d.current_reserve_stamina, d.is_reserve_stamina_full === true);
    }
    row('模拟宇宙', pair(d.current_rogue_score, d.max_rogue_score));
    if (d.rogue_tourn_weekly_unlocked === false) row('差分宇宙', '未解锁');
    else if (d.rogue_tourn_exp_is_full === true) row('拟合经验', '已满', true);
    else if (has(d.rogue_tourn_weekly_cur)) row('拟合经验', d.rogue_tourn_weekly_cur);
    row('历战余响已用', pair(d.weekly_cocoon_cnt, d.weekly_cocoon_limit));
    row('货币战争', pair(d.grid_fight_weekly_cur, d.grid_fight_weekly_max));
  } else {
    const energy = d.energy;
    primary = metric('电量', energy?.progress?.current, energy?.progress?.max);
    const vitality = d.vitality;
    daily = metric('每日活跃', vitality?.current, vitality?.max);
    seconds = energy?.restore;
    const noteList = Array.isArray(d.note_list) ? d.note_list : [];
    for (const item of noteList) {
      if (item && typeof item === 'object' && has(item.name)) row(String(item.name), item.value, item.value_highlight === true);
    }
    if (d.bounty_commission && typeof d.bounty_commission === 'object') {
      row('悬赏委托', pair(d.bounty_commission.num, d.bounty_commission.total));
    }
    if (d.weekly_task && typeof d.weekly_task === 'object') {
      row('丽都周纪积分', pair(d.weekly_task.cur_point, d.weekly_task.max_point));
    }
    const signed = typeof d.card_sign === 'string' ? /done/i.test(d.card_sign) : (has(d.has_signed) ? !!d.has_signed : null);
    if (signed !== null) row('今日签到', signed ? '已签到' : '未签到', signed === true);
    if (d.vhs_sale && typeof d.vhs_sale === 'object') row('录像店经营', enumText(d.vhs_sale.sale_state));
    if (has(d.cafe_state)) row('咖啡馆', enumText(d.cafe_state));
    const temple = d.temple_running;
    if (temple && typeof temple === 'object' && temple.auto_work && typeof temple.auto_work === 'object') {
      row('随便观经营', temple.auto_work.is_auto_work_running ? '经营中' : '未经营', temple.auto_work.is_auto_work_running === true);
    }
    if (d.member_card && typeof d.member_card === 'object' && has(d.member_card.is_open)) {
      row('绳网会员', d.member_card.is_open ? '已开通' : '未开通', d.member_card.is_open === true);
    }
    if (has(d.survey_points)) row('调查点数', d.survey_points);
    if (list.length > 10) list.length = 10;
  }
  if (!primary.recoveryAt && number(seconds) !== null && Number.isFinite(at)) primary.recoveryAt = at + Math.max(0, Number(seconds)) * 1000;
  return { game, name: NAMES[game], roleId: note.roleId,
    nickname: note.source === 'widget' ? '' : role?.nickname ?? '',
    uid: note.source === 'full' ? role?.uid ?? null : null, widgetDefaultRole: note.source === 'widget',
    source: note.source, updatedAt, status: 'ok', primary, daily, list };
}
export function buildCardSnapshot(state, previous = null, now = Date.now()) {
  const owner = state.account?.savedAt ?? null;
  const games = {};
  for (const game of CARD_GAMES) {
    const roleId = state.settings?.selectedRoles?.[game];
    const role = state.roles?.find(item => item.id === roleId);
    const note = state.notes?.[game];
    if (owner && roleId && note?.roleId === roleId && note.status === 'ok') games[game] = gameCard(game, note, role);
    else {
      const old = owner && previous?.owner === owner && previous?.games?.[game]?.roleId === roleId ? previous.games[game] : null;
      const failed = owner && roleId && note?.roleId === roleId && note.status === 'error';
      games[game] = { ...(old ?? { game, name: NAMES[game], roleId: roleId ?? null, nickname: role?.nickname ?? '', uid: null, primary: metric(game === 'genshin' ? '原粹树脂' : game === 'hsr' ? '开拓力' : '电量', null, null), daily: metric(game === 'genshin' ? '每日委托' : game === 'hsr' ? '每日实训' : '每日活跃', null, null), list: [] }),
        status: failed ? 'error' : 'empty', ...(failed ? { error: note.error?.message ?? '刷新失败', attemptedAt: note.updatedAt } : {}) };
    }
  }
  const snapshot = { type: 'hoyolab', schema: 1, owner, updatedAt: new Date(now).toISOString(), games };
  // Background images are cached by the card for AOD's synchronous first frame.
  // Keep that cache across note refreshes without re-reading storage here.
  if (previous && previous.backgrounds && typeof previous.backgrounds === 'object') {
    snapshot.backgrounds = previous.backgrounds;
  }
  return snapshot;
}
export function refreshTargets(scope) {
  if (scope === 'all') return [...CARD_GAMES];
  if (!CARD_GAMES.includes(scope)) throw new Error('未知刷新范围');
  return [scope];
}
