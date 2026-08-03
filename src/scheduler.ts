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

  // Not time yet
  if (now < state.nextRunAt) return;

  // Check links
  const links = await getLinks(chatId);
  if (state.currentIndex >= links.length) {
    await setState(chatId, { running: false, paused: false, nextRunAt: 0 });
    await notify(chatId, `✅ Рассылка завершена! Отправлено: ${state.sentTotal}, ошибок: ${state.failedTotal}`);
    stopScheduler(chatId);
    return;
  }

  // Check message
  const messageTemplate = await getMessage(chatId);
  if (!messageTemplate) {
    await setState(chatId, { running: false, lastError: 'No message template' });
    await notify(chatId, '❌ Не задан шаблон сообщения.');
    stopScheduler(chatId);
    return;
  }

  // Check accounts
  const accounts = await getAccounts(chatId);
  const validAccounts = accounts.filter(a => a.valid && !a.banned);
  if (validAccounts.length === 0) {
    await setState(chatId, { running: false, lastError: 'No valid accounts' });
    await notify(chatId, '❌ Нет валидных аккаунтов.');
    stopScheduler(chatId);
    return;
  }

  // Daily limit check
  const batchSize = Math.min(validAccounts.length, links.length - state.currentIndex);
  if (state.dailyLimit > 0 && state.sentToday + batchSize > state.dailyLimit) {
    await setState(chatId, { running: false, paused: false, nextRunAt: 0 });
    await notify(chatId, `📊 Дневной лимит ${state.dailyLimit} достигнут.`);
    stopScheduler(chatId);
    return;
  }

  // === PARALLEL SEND: all accounts at once ===
  const { sendMessageViaPuppeteer } = await import('./carousell/auth');
  const tasks: Promise<{ accountIdx: number; linkIdx: number; success: boolean; error?: string }>[] = [];

  for (let i = 0; i < batchSize; i++) {
    const linkIdx = state.currentIndex + i;
    const account = validAccounts[i % validAccounts.length];
    const link = links[linkIdx];

    // Uniquify message per account
    let finalMessage = messageTemplate;
    if (state.uniquifier) {
      finalMessage = addVariation(messageTemplate, state.sentTotal + i);
    }

    const task = (async () => {
      try {
        const result = await sendMessageViaPuppeteer(account.cookie!, link, finalMessage, account.region || 'ph');
        return { accountIdx: i, linkIdx, success: result.success, error: result.error };
      } catch (e: any) {
        return { accountIdx: i, linkIdx, success: false, error: e.message };
      }
    })();

    tasks.push(task);
  }

  // Wait for all to complete
  const results = await Promise.all(tasks);

  // Process results
  const retries = state.retryCount || {};
  const deadAccounts: string[] = [];
  const bannedAccounts: string[][] = [];

  for (const r of results) {
    if (r.success) {
      state.sentTotal++;
      state.sentToday++;
      delete retries[r.linkIdx];
    } else {
      state.lastError = r.error || 'Send failed';
      if (r.error === 'ACCOUNT_BANNED') {
        state.failedTotal++;
        bannedAccounts.push([validAccounts[r.accountIdx].id, validAccounts[r.accountIdx].username || '']);
      } else if (isAccountError(r.error)) {
        state.failedTotal++;
        deadAccounts.push(validAccounts[r.accountIdx].username || 'unknown');
      } else {
        retries[r.linkIdx] = (retries[r.linkIdx] || 0) + 1;
        if (retries[r.linkIdx] >= 3) {
          state.failedTotal++;
          delete retries[r.linkIdx];
        }
      }
    }
  }

  state.retryCount = retries;
  state.currentIndex += batchSize;
  state.nextRunAt = Date.now() + state.interval * 60 * 1000;

  await setState(chatId, {
    currentIndex: state.currentIndex,
    sentTotal: state.sentTotal,
    sentToday: state.sentToday,
    failedTotal: state.failedTotal,
    nextRunAt: state.nextRunAt,
    lastError: state.lastError,
    retryCount: state.retryCount,
  });

  // Mark banned accounts
  for (const [id, name] of bannedAccounts) {
    const { updateAccount } = await import('./storage');
    const allAccounts = await getAccounts(chatId);
    const idx = allAccounts.findIndex(a => a.id === id);
    if (idx !== -1) await updateAccount(chatId, idx, { valid: false, banned: true });
    await notify(chatId, `🚫 ${name} ЗАБАНЕН!`);
  }

  // Mark dead accounts
  for (const name of deadAccounts) {
    await notify(chatId, `⚠️ ${name} умер!`);
  }

  // Notify progress
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  const progress = `${state.currentIndex} / ${links.length}`;
  const timer = formatTimer(state.nextRunAt - Date.now());
  await notify(chatId, `📨 Отправлено: ${successCount} | Ошибок: ${failCount}\n📊 Прогресс: ${progress} | Следующая через ${timer}`);
}

function isAccountError(error: string | undefined): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return lower.includes('expired')
    || lower.includes('not logged in')
    || lower.includes('401')
    || lower.includes('403')
    || lower.includes('login')
    || lower.includes('sign in')
    || lower.includes('just a moment')
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
