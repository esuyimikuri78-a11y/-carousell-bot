import { getAccounts, getState, setState } from './storage';
import { launchBrowser, setupPage, getDomain } from './browser';

type NotifyFn = (chatId: number, text: string) => Promise<void>;

const activeWarmers = new Map<number, NodeJS.Timeout>();

const CATEGORIES = [
  '/electronics/', '/fashion/', '/home-living/', '/beauty/',
  '/sports/', '/toys/', '/books/', '/automotive/',
  '/phones/', '/computers/', '/gaming/', '/collectibles/',
];

const SEARCH_QUERIES = [
  'iphone', 'laptop', 'sneakers', 'bag', 'watch',
  'headphones', 'camera', 'clothes', 'shoes', 'furniture',
  'keyboard', 'monitor', 'tablet', 'speaker', 'jacket',
];

function randomDelay(min: number, max: number): number {
  return (Math.floor(Math.random() * (max - min + 1)) + min) * 1000;
}

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

export function startWarmer(chatId: number, notify: NotifyFn): void {
  stopWarmer(chatId);
  warmCycle(chatId, notify);
}

export function stopWarmer(chatId: number): void {
  const id = activeWarmers.get(chatId);
  if (id) {
    clearTimeout(id);
    activeWarmers.delete(chatId);
  }
}

export function isWarmerRunning(chatId: number): boolean {
  return activeWarmers.has(chatId);
}

async function warmCycle(chatId: number, notify: NotifyFn) {
  const state = await getState(chatId);
  if (!state.warming) return;

  if (state.warmDailyLimit > 0 && state.warmToday >= state.warmDailyLimit) {
    await notify(chatId, `🔥 Дневной лимит прогрева ${state.warmDailyLimit} достигнут.`);
    stopWarmer(chatId);
    await setState(chatId, { warming: false });
    return;
  }

  const accounts = await getAccounts(chatId);
  const validAccounts = accounts.filter(a => a.valid && !a.banned && (a.mode === 'warm' || a.mode === 'both'));

  if (validAccounts.length === 0) {
    await notify(chatId, '⚠️ Нет аккаунтов для прогрева.');
    stopWarmer(chatId);
    await setState(chatId, { warming: false });
    return;
  }

  const account = randomItem(validAccounts);
  const action = pickWeightedAction();

  try {
    const result = await executeWarmAction(account.cookie!, account.region || 'ph', action);
    const accName = account.username || 'unknown';

    if (result.success) {
      const ws = state.warmStats || { browsed: 0, liked: 0, profiles: 0, searched: 0, total: 0 };
      if (action === 'browse') ws.browsed++;
      if (action === 'like') ws.liked++;
      if (action === 'profile') ws.profiles++;
      if (action === 'search') ws.searched++;
      ws.total++;
      await setState(chatId, { warmStats: ws, warmToday: (state.warmToday || 0) + 1 });
      await notify(chatId, `🔥 [${accName}] ${result.action} (${ws.total})`);
    } else {
      await notify(chatId, `⚠️ [${accName}] Прогрев: ${result.error}`);
    }
  } catch (e: any) {
    await notify(chatId, `⚠️ Прогрев: ${e.message}`);
  }

  const delay = randomDelay(state.warmInterval || 15, (state.warmInterval || 15) + 30);
  await setState(chatId, { warmNextAt: Date.now() + delay });
  activeWarmers.set(chatId, setTimeout(() => warmCycle(chatId, notify), delay));
}

function pickWeightedAction(): string {
  const actions = [
    { name: 'browse', weight: 40 },
    { name: 'like', weight: 25 },
    { name: 'profile', weight: 15 },
    { name: 'search', weight: 20 },
  ];
  const total = actions.reduce((s, a) => s + a.weight, 0);
  let roll = Math.random() * total;
  for (const a of actions) {
    roll -= a.weight;
    if (roll <= 0) return a.name;
  }
  return actions[0].name;
}

async function executeWarmAction(cookie: string, region: string, action: string): Promise<{ success: boolean; action: string; error?: string }> {
  let browser: any;
  const timeout = setTimeout(() => {
    if (browser) try { browser.close(); } catch {}
  }, 90000);

  try {
    browser = await launchBrowser();
    const page = await setupPage(browser, cookie, region);
    const domain = getDomain(region);
    let resultAction = '';

    switch (action) {
      case 'browse': {
        const category = randomItem(CATEGORIES);
        await page.goto(`https://www.${domain}${category}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, randomDelay(3, 8)));

        for (let i = 0; i < 3 + Math.floor(Math.random() * 4); i++) {
          await page.evaluate((y: number) => window.scrollBy(0, y), 200 + Math.floor(Math.random() * 400));
          await new Promise(r => setTimeout(r, randomDelay(1, 3)));
        }

        const listings: any[] = await page.$$('a[href*="/p/"]');
        if (listings.length > 0) {
          await randomItem(listings).click();
          await new Promise(r => setTimeout(r, randomDelay(5, 15)));
          await page.evaluate(() => window.scrollBy(0, 300 + Math.random() * 500));
          await new Promise(r => setTimeout(r, randomDelay(2, 5)));
        }

        resultAction = `Просмотрел ${category}`;
        break;
      }

      case 'like': {
        await page.goto(`https://www.${domain}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, randomDelay(3, 6)));

        const likeButtons: any[] = await page.$$('button[class*="like"], button[class*="heart"], button[aria-label*="like" i], button[aria-label*="favourite" i]');
        if (likeButtons.length > 0) {
          const toLike = shuffle(likeButtons).slice(0, 1 + Math.floor(Math.random() * 3));
          for (const btn of toLike) {
            try { await btn.click(); await new Promise(r => setTimeout(r, randomDelay(1, 3))); } catch {}
          }
          resultAction = `Лайкнул ${toLike.length} товаров`;
        } else {
          await page.evaluate(() => window.scrollBy(0, 500));
          await new Promise(r => setTimeout(r, randomDelay(2, 4)));
          resultAction = 'Просмотрел главную';
        }
        break;
      }

      case 'profile': {
        await page.goto(`https://www.${domain}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, randomDelay(3, 6)));

        const sellerLinks: any[] = await page.$$('a[href*="/user/"], a[href*="/seller/"]');
        if (sellerLinks.length > 0) {
          await randomItem(sellerLinks).click();
          await new Promise(r => setTimeout(r, randomDelay(5, 12)));
          await page.evaluate(() => window.scrollBy(0, 300 + Math.random() * 600));
          await new Promise(r => setTimeout(r, randomDelay(2, 5)));
          resultAction = 'Просмотрел профиль продавца';
        } else {
          resultAction = 'Просмотрел страницу';
        }
        break;
      }

      case 'search': {
        const query = randomItem(SEARCH_QUERIES);
        await page.goto(`https://www.${domain}/search/?q=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, randomDelay(3, 8)));

        for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
          await page.evaluate(() => window.scrollBy(0, 200 + Math.random() * 400));
          await new Promise(r => setTimeout(r, randomDelay(1, 3)));
        }

        const results: any[] = await page.$$('a[href*="/p/"]');
        if (results.length > 0 && Math.random() > 0.5) {
          await randomItem(results).click();
          await new Promise(r => setTimeout(r, randomDelay(5, 12)));
        }

        resultAction = `Поиск: "${query}"`;
        break;
      }
    }

    return { success: true, action: resultAction };
  } catch (e: any) {
    return { success: false, action: '', error: e.message };
  } finally {
    clearTimeout(timeout);
    if (browser) try { await browser.close(); } catch {}
  }
}
