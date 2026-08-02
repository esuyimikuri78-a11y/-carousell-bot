import { getState, setState, getLinks, getAccounts, getMessage } from './storage';
import { addVariation } from './uniquifier';
import { BotState } from './types';

type NotifyFn = (chatId: number, text: string) => Promise<void>;

const activeSchedulers = new Map<number, NodeJS.Timeout>();

export function startScheduler(chatId: number, notify: NotifyFn): void {
  stopScheduler(chatId);
  tick(chatId, notify);
  const intervalId = setInterval(() => tick(chatId, notify), 30000);
  activeSchedulers.set(chatId, intervalId);
}

export function stopScheduler(chatId: number): void {
  const id = activeSchedulers.get(chatId);
  if (id) {
    clearInterval(id);
    activeSchedulers.delete(chatId);
  }
}

export function isSchedulerRunning(chatId: number): boolean {
  return activeSchedulers.has(chatId);
}

async function tick(chatId: number, notify: NotifyFn): Promise<void> {
  const state = await getState(chatId);
  if (!state.running || state.paused) return;

  const now = Date.now();

  // Daily limit reset
  if (state.dayResetAt > 0 && now > state.dayResetAt) {
    state.sentToday = 0;
    state.dayResetAt = getNextDayStart();
    await setState(chatId, { sentToday: 0, dayResetAt: state.dayResetAt });
  }

  // Daily limit reached
  if (state.dailyLimit > 0 && state.sentToday >= state.dailyLimit) {
    await setState(chatId, { running: false, paused: false, nextRunAt: 0, lastError: '' });
    await notify(chatId, `Дневной лимит ${state.dailyLimit} сообщений достигнут.`);
    stopScheduler(chatId);
    return;
  }

  // Not time yet
  if (now < state.nextRunAt) return;

  // Check links
  const links = await getLinks(chatId);
  if (state.currentIndex >= links.length) {
    await setState(chatId, { running: false, paused: false, nextRunAt: 0 });
    await notify(chatId, `Рассылка завершена! Отправлено: ${state.sentTotal}, ошибок: ${state.failedTotal}`);
    stopScheduler(chatId);
    return;
  }

  // Check message
  const messageTemplate = await getMessage(chatId);
  if (!messageTemplate) {
    await setState(chatId, { running: false, lastError: 'No message template' });
    await notify(chatId, 'Ошибка: не задан шаблон сообщения.');
    stopScheduler(chatId);
    return;
  }

  // Check accounts
  const accounts = await getAccounts(chatId);
  const validAccounts = accounts.filter(a => a.valid);
  if (validAccounts.length === 0) {
    await setState(chatId, { running: false, lastError: 'No valid accounts' });
    await notify(chatId, 'Ошибка: нет валидных аккаунтов.');
    stopScheduler(chatId);
    return;
  }

  // Round-robin: each link → next account
  const currentLink = links[state.currentIndex];
  const account = validAccounts[state.currentIndex % validAccounts.length];

  // Uniquify message
  let finalMessage = messageTemplate;
  if (state.uniquifier) {
    finalMessage = addVariation(messageTemplate, state.sentTotal);
  }

  // Send
  let accountDead = false;
  let accountBanned = false;
  try {
    const { sendMessageViaPuppeteer } = await import('./carousell/auth');
    const sendResult = await sendMessageViaPuppeteer(account.cookie!, currentLink, finalMessage, account.region || 'ph');
    if (sendResult.success) {
      state.sentTotal++;
      state.sentToday++;
      state.lastError = '';
    } else {
      state.failedTotal++;
      state.lastError = sendResult.error || 'Send failed';
      if (sendResult.error === 'ACCOUNT_BANNED') {
        accountBanned = true;
      } else if (isAccountError(sendResult.error)) {
        accountDead = true;
      }
    }
  } catch (e: any) {
    state.failedTotal++;
    state.lastError = e.message;
    if (isAccountError(e.message)) {
      accountDead = true;
    }
  }

  // If account banned
  if (accountBanned) {
    const { updateAccount } = await import('./storage');
    const allAccounts = await getAccounts(chatId);
    const idx = allAccounts.findIndex(a => a.id === account.id);
    if (idx !== -1) {
      await updateAccount(chatId, idx, { valid: false, banned: true });
    }
    const accName = account.username || account.login || 'unknown';
    await notify(chatId, `🚫 Аккаунт ${accName} ЗАБАНЕН!\nАвтоматически переключаю на следующий.`);
  }

  // If account died (cookie expired etc)
  if (accountDead && !accountBanned) {
    const { updateAccount } = await import('./storage');
    const allAccounts = await getAccounts(chatId);
    const idx = allAccounts.findIndex(a => a.id === account.id);
    if (idx !== -1) {
      await updateAccount(chatId, idx, { valid: false });
    }
    const accName = account.username || account.login || 'unknown';
    await notify(chatId, `⚠️ Аккаунт ${accName} умер!\nПричина: ${state.lastError}`);
  }

  // Next
  state.currentIndex++;
  state.nextRunAt = Date.now() + state.interval * 60 * 1000;

  await setState(chatId, {
    currentIndex: state.currentIndex,
    sentTotal: state.sentTotal,
    sentToday: state.sentToday,
    failedTotal: state.failedTotal,
    nextRunAt: state.nextRunAt,
    lastError: state.lastError,
  });

  // Notify on success
  if (!accountDead) {
    const progress = `${state.currentIndex} / ${links.length}`;
    const timer = formatTimer(state.nextRunAt - Date.now());
    const accName = account.username || 'unknown';
    await notify(chatId, `✅ [${accName}] ${progress} | Следующая через ${timer}`);
  }
}

// Detect errors that mean the account is dead
function isAccountError(error: string | undefined): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return lower.includes('expired')
    || lower.includes('not logged in')
    || lower.includes('401')
    || lower.includes('403')
    || lower.includes('login')
    || lower.includes('sign in')
    || lower.includes('just a moment')  // Cloudflare challenge
    || lower.includes('challenge');
}

function getNextDayStart(): number {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow.getTime();
}

function formatTimer(ms: number): string {
  if (ms <= 0) return '0:00';
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export { formatTimer };
