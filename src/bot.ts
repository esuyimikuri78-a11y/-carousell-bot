import TelegramBot from 'node-telegram-bot-api';
import * as storage from './storage';
import { startScheduler, stopScheduler, formatTimer } from './scheduler';
import { CarousellAccount, REGIONS } from './types';
import { validateCookie } from './carousell/auth';
import { addVariation } from './uniquifier';
import crypto from 'crypto';

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const bot = new TelegramBot(process.env.BOT_TOKEN!, { polling: true });
const menuMsgId = new Map<number, number>();
const waitingFor = new Map<number, string>();
const pendingRegion = new Map<number, string>();
const selectedRegion = new Map<number, string>(); // geo per user

export function initBot(): void {
  bot.onText(/\/start/, handleStart);
  bot.onText(/\/key/, handleKeyCommand);
  bot.on('callback_query', handleCallback);
  bot.on('message', handleMessage);
  bot.on('document', handleDocument);
  console.log('Bot started');
}

// ==================== HELPERS ====================

async function editOrSend(chatId: number, text: string, keyboard: TelegramBot.InlineKeyboardMarkup): Promise<void> {
  const msgId = menuMsgId.get(chatId);
  if (msgId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: keyboard });
      return;
    } catch {}
  }
  const sent = await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard });
  menuMsgId.set(chatId, sent.message_id);
}

// ==================== START ====================

async function handleStart(msg: TelegramBot.Message) {
  const chatId = msg.chat.id;
  await storage.addActiveChat(chatId);
  try { await bot.deleteMessage(chatId, msg.message_id); } catch {}

  // Clear errors on start
  await storage.setState(chatId, { lastError: '' });

  const hasAccess = await storage.hasAccess(chatId);
  if (!hasAccess) {
    waitingFor.set(chatId, 'activate_key');
    await bot.sendMessage(chatId, '🔐 <b>Доступ</b>\n\nВведите ключ активации:', { parse_mode: 'HTML' });
    return;
  }

  // If no region selected — show geo picker
  if (!selectedRegion.has(chatId)) {
    return showGeoPicker(chatId);
  }

  await showMainMenu(chatId);
}

// ==================== GEO PICKER ====================

async function showGeoPicker(chatId: number) {
  const buttons = Object.entries(REGIONS).map(([code, r]) =>
    [{ text: `${r.flag} ${r.name}`, callback_data: `select_geo_${code}` }]
  );

  await editOrSend(chatId, '🌍 <b>Выберите регион:</b>', { inline_keyboard: buttons });
}

// ==================== MAIN MENU ====================

async function showMainMenu(chatId: number) {
  const region = selectedRegion.get(chatId) || 'ph';
  const regionInfo = REGIONS[region];

  const state = await storage.getState(chatId);
  const allAccounts = await storage.getAccounts(chatId);
  const accounts = allAccounts.filter(a => a.region === region);
  const validAccs = accounts.filter(a => a.valid && !a.banned);
  const bannedAccs = accounts.filter(a => a.banned);
  const links = await storage.getLinks(chatId);
  const message = await storage.getMessage(chatId);

  let statusLine = '';
  if (state.running) {
    const timer = state.nextRunAt > Date.now() ? formatTimer(state.nextRunAt - Date.now()) : '...';
    statusLine = state.paused ? `⏸ Пауза ⏱ ${timer}` : `🟢 Работает ⏱ ${timer}`;
  } else {
    statusLine = state.sentTotal > 0 ? `⚪ Стоп | ${state.sentTotal} отправлено` : `⚪ Готов`;
  }

  const stats = [
    state.sentTotal > 0 ? `✅ ${state.sentTotal}` : null,
    state.failedTotal > 0 ? `❌ ${state.failedTotal}` : null,
    bannedAccs.length > 0 ? `🚫 ${bannedAccs.length}` : null,
  ].filter(Boolean);

  const text = [
    `${regionInfo.flag} <b>${regionInfo.name}</b>`,
    '━━━━━━━━━━━━━━━━━━',
    statusLine,
    '',
    `👤 Аккаунты: <b>${validAccs.length}</b>/${accounts.length}`,
    `🔗 Ссылок: <b>${links.length}</b>${state.currentIndex > 0 ? ` (${state.currentIndex})` : ''}`,
    `💬 Сообщение: ${message ? '✅' : '❌'}`,
    `⏱ ${state.interval} мин | 📊 ${state.dailyLimit || '∞'}/день | 🔄 ${state.uniquifier ? '✅' : '❌'}`,
    stats.length ? `\n${stats.join(' | ')}` : '',
    state.lastError ? `\n⚠️ ${esc(state.lastError)}` : '',
  ].filter(Boolean).join('\n');

  const startBtn = state.running
    ? (state.paused ? [{ text: '▶️ Продолжить', callback_data: 'action_resume' }] : [{ text: '⏸ Пауза', callback_data: 'action_pause' }])
    : [{ text: '▶️ Старт', callback_data: 'action_start' }];

  const warmerBtn = state.warming
    ? [{ text: '🔥 Прогрев: ВКЛ', callback_data: 'warmer_toggle' }]
    : [{ text: '❄️ Прогрев: ВЫКЛ', callback_data: 'warmer_toggle' }];

  const rows: TelegramBot.InlineKeyboardButton[][] = [
    startBtn,
    [{ text: '👤 Аккаунты', callback_data: 'menu_accounts' }, { text: '🔗 Ссылки', callback_data: 'menu_links' }],
    [{ text: '💬 Сообщение', callback_data: 'menu_message' }, { text: '⚙️ Настройки', callback_data: 'menu_settings' }],
    warmerBtn,
  ];
  if (state.running) rows.push([{ text: '⏹ Стоп', callback_data: 'action_stop' }]);
  rows.push([{ text: `🌍 Сменить регион`, callback_data: 'change_geo' }]);

  await editOrSend(chatId, text, { inline_keyboard: rows });
}

// ==================== CALLBACKS ====================

async function handleCallback(query: TelegramBot.CallbackQuery) {
  const chatId = query.message!.chat.id;
  const data = query.data!;
  try { await bot.answerCallbackQuery(query.id); } catch {}
  if (data === 'noop') return;

  // Navigation
  if (data === 'menu_main') return showMainMenu(chatId);
  if (data === 'menu_accounts') return showAccountsMenu(chatId);
  if (data === 'menu_links') return showLinksMenu(chatId);
  if (data === 'menu_message') return showMessageMenu(chatId);
  if (data === 'menu_settings') return showSettingsMenu(chatId);

  // Geo selection
  if (data.startsWith('select_geo_')) {
    const region = data.replace('select_geo_', '');
    selectedRegion.set(chatId, region);
    return showMainMenu(chatId);
  }
  if (data === 'change_geo') return showGeoPicker(chatId);

  // Warmer
  if (data === 'warmer_toggle') return handleWarmerToggle(chatId);

  // Actions
  if (data === 'action_start') return handleStartSending(chatId, query);
  if (data === 'action_stop') return handleStopSending(chatId);
  if (data === 'action_pause') return handlePauseSending(chatId);
  if (data === 'action_resume') return handleResumeSending(chatId);
  if (data === 'action_preview') return handlePreview(chatId);

  // Accounts
  if (data === 'add_cookie') return showRegionSelect(chatId, 'cookie');
  if (data === 'add_creds') return showRegionSelect(chatId, 'creds');
  if (data.startsWith('region_')) {
    const parts = data.split('_');
    const region = parts[1];
    const type = parts[2];
    pendingRegion.set(chatId, region);
    if (type === 'cookie') {
      waitingFor.set(chatId, 'cookie');
      await editOrSend(chatId, `🍪 <b>Добавление cookie</b> (${REGIONS[region].flag} ${REGIONS[region].name})\n\nОтправьте:\n• jwt значение текстом\n• JSON из Cookie Editor\n• .json файл`, {
        inline_keyboard: [[{ text: '◀️ Отмена', callback_data: 'menu_accounts' }]],
      });
    } else {
      waitingFor.set(chatId, 'login');
      await editOrSend(chatId, `🔑 <b>Логин</b> (${REGIONS[region].flag} ${REGIONS[region].name})\n\nВведите email или username:`, {
        inline_keyboard: [[{ text: '◀️ Отмена', callback_data: 'menu_accounts' }]],
      });
    }
    return;
  }
  if (data.startsWith('remove_acc_')) return handleRemoveAccount(chatId, parseInt(data.split('_')[2]));
  if (data === 'check_accounts') return handleCheckAccounts(chatId);

  // Links
  if (data === 'add_links_text') {
    waitingFor.set(chatId, 'links');
    await editOrSend(chatId, '🔗 <b>Добавление ссылок</b>\n\nОтправьте ссылки (по одной на строку):', {
      inline_keyboard: [[{ text: '◀️ Отмена', callback_data: 'menu_links' }]],
    });
    return;
  }
  if (data === 'add_links_file') {
    waitingFor.set(chatId, 'links_file');
    await editOrSend(chatId, '📄 <b>Загрузка файла</b>\n\nОтправьте .txt файл:', {
      inline_keyboard: [[{ text: '◀️ Отмена', callback_data: 'menu_links' }]],
    });
    return;
  }
  if (data === 'clear_links') {
    await storage.clearLinks(chatId);
    await storage.setState(chatId, { currentIndex: 0 });
    await showLinksMenu(chatId);
    return;
  }
  if (data === 'list_links') return handleListLinks(chatId);

  // Message
  if (data === 'set_message') {
    waitingFor.set(chatId, 'message');
    await editOrSend(chatId, '💬 <b>Новый шаблон</b>\n\nОтправьте текст:', {
      inline_keyboard: [[{ text: '◀️ Отмена', callback_data: 'menu_message' }]],
    });
    return;
  }

  // Settings
  if (data.startsWith('set_interval_')) {
    await storage.setState(chatId, { interval: parseInt(data.split('_')[2]) });
    await showSettingsMenu(chatId);
    return;
  }
  if (data.startsWith('set_limit_')) {
    await storage.setState(chatId, { dailyLimit: parseInt(data.split('_')[2]) });
    await showSettingsMenu(chatId);
    return;
  }
  if (data === 'toggle_uniquifier') {
    const state = await storage.getState(chatId);
    await storage.setState(chatId, { uniquifier: !state.uniquifier });
    await showSettingsMenu(chatId);
    return;
  }
}

// ==================== ACCOUNTS MENU ====================

function showRegionSelect(chatId: number, type: string) {
  const buttons = Object.entries(REGIONS).map(([code, r]) =>
    [{ text: `${r.flag} ${r.name}`, callback_data: `region_${code}_${type}` }]
  );
  buttons.push([{ text: '◀️ Отмена', callback_data: 'menu_accounts' }]);
  editOrSend(chatId, '🌍 <b>Выберите регион:</b>', { inline_keyboard: buttons });
}

async function showAccountsMenu(chatId: number, region?: string) {
  const allAccounts = await storage.getAccounts(chatId);
  const accounts = region ? allAccounts.filter(a => a.region === region) : allAccounts;
  const regionInfo = region ? REGIONS[region] : null;

  let text = regionInfo
    ? `${regionInfo.flag} <b>${regionInfo.name}</b> (${accounts.length})\n━━━━━━━━━━━━━━━━━━\n\n`
    : `👤 <b>Все аккаунты</b> (${accounts.length})\n━━━━━━━━━━━━━━━━━━\n\n`;

  if (accounts.length === 0) {
    text += 'Нет аккаунтов для этого региона.';
  } else {
    accounts.forEach((acc, i) => {
      const icon = acc.banned ? '🚫' : acc.valid ? '✅' : '❌';
      const r = REGIONS[acc.region] || REGIONS.ph;
      const name = esc(acc.username || acc.login || `Аккаунт ${i + 1}`);
      const globalIdx = allAccounts.indexOf(acc);
      text += `${globalIdx + 1}. ${r.flag} ${name} ${icon}\n`;
    });
  }

  const addCb = region ? `region_${region}_cookie` : 'add_cookie';
  const addCredsCb = region ? `region_${region}_creds` : 'add_creds';

  const buttons: TelegramBot.InlineKeyboardButton[][] = [
    [{ text: '➕ Cookie', callback_data: addCb }],
    [{ text: '➕ Логин/пароль', callback_data: addCredsCb }],
  ];
  if (accounts.length > 0) {
    buttons.push([{ text: '🔍 Проверить', callback_data: 'check_accounts' }]);
    accounts.forEach((acc) => {
      const globalIdx = allAccounts.indexOf(acc);
      const name = acc.username || acc.login || `#${globalIdx + 1}`;
      buttons.push([{ text: `🗑 ${name}`, callback_data: `remove_acc_${globalIdx}` }]);
    });
  }
  buttons.push([{ text: '◀️ Назад', callback_data: 'menu_main' }]);
  await editOrSend(chatId, text, { inline_keyboard: buttons });
}

async function handleRemoveAccount(chatId: number, index: number) {
  await storage.removeAccount(chatId, index);
  await showAccountsMenu(chatId);
}

async function handleCheckAccounts(chatId: number) {
  const accounts = await storage.getAccounts(chatId);
  if (accounts.length === 0) return;

  await editOrSend(chatId, '🔍 Проверяю...', { inline_keyboard: [[{ text: '⏳ Подождите...', callback_data: 'noop' }]] });

  const results: string[] = [];
  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    const name = acc.username || acc.login || `Аккаунт ${i + 1}`;
    const r = REGIONS[acc.region] || REGIONS.ph;

    if (!acc.cookie) {
      results.push(`${r.flag} ❌ ${name} — нет cookie`);
      continue;
    }
    try {
      const { extractUserFromJwt, fetchChatToken } = await import('./carousell/auth');
      const jwt = extractUserFromJwt(acc.cookie);
      if (jwt.error) {
        results.push(`${r.flag} ❌ ${name} — ${jwt.error}`);
        await storage.updateAccount(chatId, i, { valid: false });
        continue;
      }
      const token = await fetchChatToken(acc.cookie, acc.region);
      if (token.error) {
        results.push(`${r.flag} ❌ ${name} — ${token.error === 'ACCOUNT_BANNED' ? 'ЗАБАНЕН' : token.error}`);
        await storage.updateAccount(chatId, i, { valid: false, banned: token.error === 'ACCOUNT_BANNED' });
      } else {
        results.push(`${r.flag} ✅ ${name}`);
        await storage.updateAccount(chatId, i, { valid: true, username: jwt.username });
      }
    } catch (e: any) {
      results.push(`${r.flag} ❌ ${name} — ${e.message}`);
      await storage.updateAccount(chatId, i, { valid: false });
    }
  }

  const valid = results.filter(r => r.includes('✅')).length;
  await editOrSend(chatId, `🔍 <b>Результат</b>\n\n${results.join('\n')}\n\nИтого: ${valid}/${accounts.length}`, {
    inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'menu_accounts' }]],
  });
}

// ==================== LINKS MENU ====================

async function showLinksMenu(chatId: number) {
  const links = await storage.getLinks(chatId);
  const state = await storage.getState(chatId);

  const text = [
    '🔗 <b>Ссылки</b>',
    '━━━━━━━━━━━━━━━━━━',
    `В очереди: <b>${links.length}</b>`,
    `Обработано: <b>${state.currentIndex}</b>`,
    `Осталось: <b>${links.length - state.currentIndex}</b>`,
  ].join('\n');

  await editOrSend(chatId, text, {
    inline_keyboard: [
      [{ text: '➕ Добавить текстом', callback_data: 'add_links_text' }],
      [{ text: '📄 Загрузить .txt', callback_data: 'add_links_file' }],
      links.length > 0 ? [{ text: '📋 Показать все', callback_data: 'list_links' }] : [],
      links.length > 0 ? [{ text: '🗑 Очистить', callback_data: 'clear_links' }] : [],
      [{ text: '◀️ Назад', callback_data: 'menu_main' }],
    ].filter(r => r.length > 0),
  });
}

async function handleListLinks(chatId: number) {
  const links = await storage.getLinks(chatId);
  const state = await storage.getState(chatId);
  if (links.length === 0) return;

  const list = links.slice(0, 30).map((l, i) => {
    const icon = i < state.currentIndex ? '✅' : '⬜';
    return `${icon} ${i + 1}. ${l}`;
  }).join('\n');

  await editOrSend(chatId, `📋 <b>Ссылки</b>\n\n${list}${links.length > 30 ? `\n\n...и ещё ${links.length - 30}` : ''}`, {
    inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'menu_links' }]],
  });
}

// ==================== MESSAGE MENU ====================

async function showMessageMenu(chatId: number) {
  const message = await storage.getMessage(chatId);
  const text = ['💬 <b>Шаблон сообщения</b>', '━━━━━━━━━━━━━━━━━━', '', message ? `<i>${esc(message)}</i>` : 'Не задан.'].join('\n');

  await editOrSend(chatId, text, {
    inline_keyboard: [
      [{ text: '✏️ Изменить', callback_data: 'set_message' }],
      [{ text: '👁 Превью', callback_data: 'action_preview' }],
      [{ text: '◀️ Назад', callback_data: 'menu_main' }],
    ],
  });
}

async function handlePreview(chatId: number) {
  const message = await storage.getMessage(chatId);
  if (!message) return;
  const state = await storage.getState(chatId);
  const varied = state.uniquifier ? addVariation(message, state.sentTotal + 1) : message;

  await editOrSend(chatId, [
    '👁 <b>Превью</b>',
    '',
    'Оригинал:', `<i>${esc(message)}</i>`,
    '', state.uniquifier ? 'С уникализацией:' : '(выкл)',
    state.uniquifier ? `<i>${esc(varied)}</i>` : '',
  ].join('\n'), {
    inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'menu_message' }]],
  });
}

// ==================== SETTINGS MENU ====================

async function showSettingsMenu(chatId: number) {
  const state = await storage.getState(chatId);

  const text = [
    '⚙️ <b>Настройки</b>',
    '━━━━━━━━━━━━━━━━━━',
    `⏱ Интервал: <b>${state.interval} мин</b>`,
    `📊 Лимит: <b>${state.dailyLimit || '∞'}/день</b>`,
    `🔄 Уникализатор: ${state.uniquifier ? '✅ Вкл' : '❌ Выкл'}`,
  ].join('\n');

  await editOrSend(chatId, text, {
    inline_keyboard: [
      [{ text: '⏱ Интервал:', callback_data: 'noop' }],
      [
        { text: `${state.interval === 1 ? '▹' : ''}1`, callback_data: 'set_interval_1' },
        { text: `${state.interval === 3 ? '▹' : ''}3`, callback_data: 'set_interval_3' },
        { text: `${state.interval === 5 ? '▹' : ''}5`, callback_data: 'set_interval_5' },
        { text: `${state.interval === 10 ? '▹' : ''}10`, callback_data: 'set_interval_10' },
        { text: `${state.interval === 15 ? '▹' : ''}15`, callback_data: 'set_interval_15' },
        { text: `${state.interval === 30 ? '▹' : ''}30`, callback_data: 'set_interval_30' },
      ],
      [{ text: '📊 Лимит:', callback_data: 'noop' }],
      [
        { text: `${state.dailyLimit === 10 ? '▹' : ''}10`, callback_data: 'set_limit_10' },
        { text: `${state.dailyLimit === 25 ? '▹' : ''}25`, callback_data: 'set_limit_25' },
        { text: `${state.dailyLimit === 50 ? '▹' : ''}50`, callback_data: 'set_limit_50' },
        { text: `${state.dailyLimit === 100 ? '▹' : ''}100`, callback_data: 'set_limit_100' },
        { text: `${state.dailyLimit === 0 ? '▹' : ''}∞`, callback_data: 'set_limit_0' },
      ],
      [{ text: `🔄 Уникализатор: ${state.uniquifier ? '✅' : '❌'}`, callback_data: 'toggle_uniquifier' }],
      [{ text: '◀️ Назад', callback_data: 'menu_main' }],
    ],
  });
}

// ==================== ACTIONS ====================

async function handleStartSending(chatId: number, query?: TelegramBot.CallbackQuery) {
  const links = await storage.getLinks(chatId);
  const message = await storage.getMessage(chatId);
  const accounts = await storage.getAccounts(chatId);

  if (!message) { if (query) await bot.answerCallbackQuery(query.id, { text: '❌ Задайте сообщение', show_alert: true }); return; }
  if (links.length === 0) { if (query) await bot.answerCallbackQuery(query.id, { text: '❌ Добавьте ссылки', show_alert: true }); return; }
  if (accounts.filter(a => a.valid && !a.banned).length === 0) { if (query) await bot.answerCallbackQuery(query.id, { text: '❌ Нет валидных аккаунтов', show_alert: true }); return; }

  await storage.setState(chatId, { running: true, paused: false, nextRunAt: Date.now(), lastError: '' });
  startScheduler(chatId, notify);
  await showMainMenu(chatId);
}

async function handleStopSending(chatId: number) {
  stopScheduler(chatId);
  await storage.setState(chatId, { running: false, paused: false, nextRunAt: 0, lastError: '' });
  await showMainMenu(chatId);
}

async function handlePauseSending(chatId: number) {
  await storage.setState(chatId, { paused: true });
  await showMainMenu(chatId);
}

async function handleResumeSending(chatId: number) {
  await storage.setState(chatId, { paused: false, nextRunAt: Date.now() });
  await showMainMenu(chatId);
}

// Warmer toggle
async function handleWarmerToggle(chatId: number) {
  const state = await storage.getState(chatId);
  const { startWarmer, stopWarmer } = await import('./warmer');

  if (state.warming) {
    stopWarmer(chatId);
    await storage.setState(chatId, { warming: false });
  } else {
    await storage.setState(chatId, { warming: true });
    startWarmer(chatId, notify);
  }
  await showMainMenu(chatId);
}

// ==================== MESSAGE HANDLER ====================

async function handleMessage(msg: TelegramBot.Message) {
  if (!msg.text || msg.text.startsWith('/')) return;
  const chatId = msg.chat.id;
  const waiting = waitingFor.get(chatId);
  if (!waiting) return;

  try { await bot.deleteMessage(chatId, msg.message_id); } catch {}

  // Key activation
  if (waiting === 'activate_key') {
    waitingFor.delete(chatId);
    const result = await storage.useKey(msg.text.trim(), chatId);
    if (result.valid) {
      await bot.sendMessage(chatId, '✅ Доступ открыт!');
      await showMainMenu(chatId);
    } else {
      waitingFor.set(chatId, 'activate_key');
      await bot.sendMessage(chatId, `❌ ${result.error}\nПопробуйте ещё раз:`);
    }
    return;
  }

  waitingFor.delete(chatId);

  // Cookie
  if (waiting === 'cookie') {
    let cookie = msg.text.trim();
    try {
      const parsed = JSON.parse(cookie);
      if (Array.isArray(parsed)) {
        cookie = parsed.filter((c: any) => c.name && c.value).map((c: any) => `${c.name}=${c.value}`).join('; ');
      }
    } catch {}

    // If it looks like a bare JWT (starts with eyJ), add jwt= prefix
    if (cookie.startsWith('eyJ') && !cookie.includes('jwt=')) {
      cookie = 'jwt=' + cookie;
    }

    const region = pendingRegion.get(chatId) || 'ph';
    pendingRegion.delete(chatId);
    const validation = await validateCookie(cookie);

    await storage.addAccount(chatId, {
      id: crypto.randomUUID(), type: 'cookie', cookie,
      username: validation.username, valid: validation.valid,
      banned: false, region, addedAt: Date.now(),
    });
    await showAccountsMenu(chatId);
    return;
  }

  // Login
  if (waiting === 'login') {
    waitingFor.set(chatId, `password:${msg.text.trim()}`);
    await editOrSend(chatId, '🔑 Введите пароль:', { inline_keyboard: [[{ text: '◀️ Отмена', callback_data: 'menu_accounts' }]] });
    return;
  }

  // Password
  if (waiting.startsWith('password:')) {
    const login = waiting.split(':')[1];
    const region = pendingRegion.get(chatId) || 'ph';
    pendingRegion.delete(chatId);

    await storage.addAccount(chatId, {
      id: crypto.randomUUID(), type: 'credentials', login, password: msg.text.trim(),
      valid: false, banned: false, region, addedAt: Date.now(),
    });
    await bot.sendMessage(chatId, '⚠️ Добавлен. Для работы нужно cookie.');
    await showAccountsMenu(chatId);
    return;
  }

  // Links
  if (waiting === 'links') {
    const links = msg.text.split('\n').map(l => l.trim()).filter(l => l.startsWith('http'));
    if (links.length === 0) {
      await editOrSend(chatId, '❌ Ссылки не найдены.', { inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'menu_links' }]] });
      return;
    }
    await storage.addLinks(chatId, links);
    await showLinksMenu(chatId);
    return;
  }

  // Message template
  if (waiting === 'message') {
    await storage.setMessage(chatId, msg.text.trim());
    await showMessageMenu(chatId);
    return;
  }
}

// Document handler
async function handleDocument(msg: TelegramBot.Message) {
  const chatId = msg.chat.id;
  const waiting = waitingFor.get(chatId);
  const doc = msg.document;
  if (!doc) return;

  try { await bot.deleteMessage(chatId, msg.message_id); } catch {}

  // Handle cookie JSON file
  if (waiting === 'cookie' && doc.file_name?.endsWith('.json')) {
    waitingFor.delete(chatId);
    try {
      const fileLink = await bot.getFileLink(doc.file_id);
      const resp = await fetch(fileLink);
      const text = await resp.text();

      let cookie = '';
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          cookie = parsed.filter((c: any) => c.name && c.value).map((c: any) => `${c.name}=${c.value}`).join('; ');
        }
      } catch {
        cookie = text.trim();
      }

      // If bare JWT, add prefix
      if (cookie.startsWith('eyJ') && !cookie.includes('jwt=')) {
        cookie = 'jwt=' + cookie;
      }

      const region = pendingRegion.get(chatId) || 'ph';
      pendingRegion.delete(chatId);
      const { validateCookie } = await import('./carousell/auth');
      const validation = await validateCookie(cookie);

      await storage.addAccount(chatId, {
        id: crypto.randomUUID(), type: 'cookie', cookie,
        username: validation.username, valid: validation.valid,
        banned: false, region, addedAt: Date.now(),
      });
      await showAccountsMenu(chatId);
    } catch (e: any) {
      await editOrSend(chatId, `❌ ${e.message}`, { inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'menu_accounts' }]] });
    }
    return;
  }

  // Handle links txt file
  if (waiting === 'links_file' && doc.file_name?.endsWith('.txt')) {
    waitingFor.delete(chatId);
    try {
      const fileLink = await bot.getFileLink(doc.file_id);
      const resp = await fetch(fileLink);
      const text = await resp.text();
      const links = text.split('\n').map(l => l.trim()).filter(l => l.startsWith('http'));
      if (links.length === 0) {
        await editOrSend(chatId, '❌ Файл пуст.', { inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'menu_links' }]] });
        return;
      }
      await storage.addLinks(chatId, links);
      await showLinksMenu(chatId);
    } catch (e: any) {
      await editOrSend(chatId, `❌ ${e.message}`, { inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'menu_links' }]] });
    }
    return;
  }
}

// Notify
async function notify(chatId: number, text: string) {
  try { await showMainMenu(chatId); } catch {}
}

// ==================== ADMIN: KEY MANAGEMENT ====================

async function handleKeyCommand(msg: TelegramBot.Message) {
  const chatId = msg.chat.id;
  const adminId = process.env.ADMIN_CHAT_ID;

  if (!adminId) {
    process.env.ADMIN_CHAT_ID = String(chatId);
    await bot.sendMessage(chatId, '👑 Вы админ.\n\n/key gen [uses] [days] — создать\n/key list — список\n/key del KEY — удалить');
    return;
  }
  if (String(chatId) !== adminId) return;

  const args = msg.text?.split(' ').slice(1) || [];
  const action = args[0];

  if (action === 'gen') {
    const maxUses = parseInt(args[1]) || 1;
    const days = parseInt(args[2]) || 30;
    const key = await storage.createKey(maxUses, days);
    await bot.sendMessage(chatId, `🔑 <code>${key}</code>\nИспользований: ${maxUses || '∞'} | Дней: ${days}`, { parse_mode: 'HTML' });
  } else if (action === 'list') {
    const keys = await storage.listKeys();
    if (keys.length === 0) { await bot.sendMessage(chatId, 'Нет ключей.'); return; }
    const list = keys.map(k => {
      const s = k.expiresAt > 0 && Date.now() > k.expiresAt ? '❌' : '✅';
      return `${s} <code>${k.key}</code> ${k.usedBy.length}/${k.maxUses || '∞'}`;
    }).join('\n');
    await bot.sendMessage(chatId, `🔑 Ключи:\n${list}`, { parse_mode: 'HTML' });
  } else if (action === 'del') {
    if (!args[1]) { await bot.sendMessage(chatId, '/key del KEY'); return; }
    await bot.sendMessage(chatId, (await storage.deleteKey(args[1])) ? '🗑 Удалён' : 'Не найден');
  } else {
    await bot.sendMessage(chatId, '/key gen [uses] [days]\n/key list\n/key del KEY');
  }
}
