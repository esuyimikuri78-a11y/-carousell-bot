// Account Warmer — simulates real user behavior
// Runs independently from the main messaging scheduler
// Actions: browse listings, like items, view profiles, search, scroll

import { getAccounts, getState, setState } from './storage';

type NotifyFn = (chatId: number, text: string) => Promise<void>;

const activeWarmers = new Map<number, NodeJS.Timeout>();

// Random delay between actions (seconds)
function randomDelay(min: number, max: number): number {
  return (Math.floor(Math.random() * (max - min + 1)) + min) * 1000;
}

// Random item from array
function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Shuffle array
function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

// Start warming for a user
export function startWarmer(chatId: number, notify: NotifyFn): void {
  stopWarmer(chatId);
  warmCycle(chatId, notify);
}

// Stop warming
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

// Main warming cycle
async function warmCycle(chatId: number, notify: NotifyFn) {
  const state = await getState(chatId);

  if (!state.warming) return;

  const accounts = await getAccounts(chatId);
  const validAccounts = accounts.filter(a => a.valid && !a.banned);

  if (validAccounts.length === 0) {
    await notify(chatId, '🌡️ Прогрев остановлен: нет валидных аккаунтов');
    stopWarmer(chatId);
    return;
  }

  // Pick random account for this cycle
  const account = randomItem(validAccounts);

  // Pick random action
  const actions = [
    { name: 'browse', weight: 40 },
    { name: 'like', weight: 25 },
    { name: 'profile', weight: 15 },
    { name: 'search', weight: 20 },
  ];

  const totalWeight = actions.reduce((s, a) => s + a.weight, 0);
  let roll = Math.random() * totalWeight;
  let action = actions[0].name;

  for (const a of actions) {
    roll -= a.weight;
    if (roll <= 0) { action = a.name; break; }
  }

  try {
    const result = await executeWarmAction(account.cookie!, account.region || 'ph', action);
    const accName = account.username || 'unknown';

    if (result.success) {
      const warmState = state.warmStats || { browsed: 0, liked: 0, profiles: 0, searched: 0 };
      if (action === 'browse') warmState.browsed++;
      if (action === 'like') warmState.liked++;
      if (action === 'profile') warmState.profiles++;
      if (action === 'search') warmState.searched++;

      await setState(chatId, { warmStats: warmState });
      await notify(chatId, `🌡️ [${accName}] ${result.action}`);
    } else {
      await notify(chatId, `⚠️ [${accName}] Прогрев ошибка: ${result.error}`);
    }
  } catch (e: any) {
    await notify(chatId, `⚠️ Прогрев ошибка: ${e.message}`);
  }

  // Schedule next cycle (15-45 min random)
  const delay = randomDelay(
    (state.warmInterval || 15),
    (state.warmInterval || 15) + 30
  );

  const nextTime = Date.now() + delay;
  await setState(chatId, { warmNextAt: nextTime });

  activeWarmers.set(chatId, setTimeout(() => warmCycle(chatId, notify), delay));
}

// Execute a single warming action
async function executeWarmAction(cookie: string, region: string, action: string): Promise<{ success: boolean; action: string; error?: string }> {
  const puppeteer = await dynamicImport('puppeteer-core');

  let executablePath: string;
  let args: string[];

  if (process.platform === 'darwin') {
    executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'];
  } else {
    const chromium = await dynamicImport('@sparticuz/chromium');
    executablePath = await chromium.default.executablePath();
    args = [...chromium.default.args, '--disable-blink-features=AutomationControlled'];
  }

  const browser = await puppeteer.default.launch({
    executablePath,
    args,
    defaultViewport: { width: 1920, height: 1080 },
    headless: 'new' as any,
  });

  const timeout = setTimeout(() => {
    try { browser.close(); } catch {}
  }, 90000);

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

    // Stealth
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      (window as any).chrome = { runtime: {} };
    });

    // Set cookies
    const { REGIONS } = await import('./types');
    const domain = (REGIONS[region] || REGIONS.ph).domain;
    const cookies = cookie.split(';').map(c => c.trim()).filter(Boolean).map(c => {
      const eq = c.indexOf('=');
      return { name: c.slice(0, eq).trim(), value: c.slice(eq + 1).trim(), domain: `www.${domain}`, path: '/' };
    });
    if (cookies.length > 0) await page.setCookie(...cookies);

    // Random categories to browse
    const categories = [
      '/electronics/', '/fashion/', '/home-living/', '/beauty/',
      '/sports/', '/toys/', '/books/', '/automotive/',
      '/phones/', '/computers/', '/gaming/', '/collectibles/',
    ];

    const searchQueries = [
      'iphone', 'laptop', 'sneakers', 'bag', 'watch',
      'headphones', 'camera', 'clothes', 'shoes', 'furniture',
      'keyboard', 'monitor', 'tablet', 'speaker', 'jacket',
    ];

    let resultAction = '';

    switch (action) {
      case 'browse': {
        // Browse random category
        const category = randomItem(categories);
        await page.goto(`https://www.${domain}${category}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, randomDelay(3, 8)));

        // Scroll like a human
        for (let i = 0; i < 3 + Math.floor(Math.random() * 4); i++) {
          const scrollAmount = 200 + Math.floor(Math.random() * 400);
          await page.evaluate((y: number) => window.scrollBy(0, y), scrollAmount);
          await new Promise(r => setTimeout(r, randomDelay(1, 3)));
        }

        // Click on a random listing
        const listings = await page.$$('a[href*="/p/"]');
        if (listings.length > 0) {
          const listing: any = randomItem(listings);
          await listing.click();
          await new Promise(r => setTimeout(r, randomDelay(5, 15)));

          // Scroll the listing page
          await page.evaluate(() => window.scrollBy(0, 300 + Math.random() * 500));
          await new Promise(r => setTimeout(r, randomDelay(2, 5)));
        }

        resultAction = `Просмотрел ${category}`;
        break;
      }

      case 'like': {
        // Go to homepage and like items
        await page.goto(`https://www.${domain}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, randomDelay(3, 6)));

        // Find like buttons (heart icons)
        const likeButtons = await page.$$('button[class*="like"], button[class*="heart"], button[aria-label*="like" i], button[aria-label*="favourite" i]');
        if (likeButtons.length > 0) {
          const toLike: any[] = shuffle(likeButtons).slice(0, 1 + Math.floor(Math.random() * 3));
          for (const btn of toLike) {
            try {
              await btn.click();
              await new Promise(r => setTimeout(r, randomDelay(1, 3)));
            } catch {}
          }
          resultAction = `Лайкнул ${toLike.length} товаров`;
        } else {
          // Fallback: browse and scroll
          await page.evaluate(() => window.scrollBy(0, 500));
          await new Promise(r => setTimeout(r, randomDelay(2, 4)));
          resultAction = 'Просмотрел главную';
        }
        break;
      }

      case 'profile': {
        // Find a random listing and visit seller profile
        await page.goto(`https://www.${domain}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, randomDelay(3, 6)));

        // Find seller links
        const sellerLinks = await page.$$('a[href*="/user/"], a[href*="/seller/"]');
        if (sellerLinks.length > 0) {
          const seller: any = randomItem(sellerLinks);
          await seller.click();
          await new Promise(r => setTimeout(r, randomDelay(5, 12)));

          // Scroll profile
          await page.evaluate(() => window.scrollBy(0, 300 + Math.random() * 600));
          await new Promise(r => setTimeout(r, randomDelay(2, 5)));

          resultAction = 'Просмотрел профиль продавца';
        } else {
          resultAction = 'Просмотрел страницу';
        }
        break;
      }

      case 'search': {
        // Search for something
        const query = randomItem(searchQueries);
        await page.goto(`https://www.${domain}/search/?q=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, randomDelay(3, 8)));

        // Scroll results
        for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
          await page.evaluate(() => window.scrollBy(0, 200 + Math.random() * 400));
          await new Promise(r => setTimeout(r, randomDelay(1, 3)));
        }

        // Maybe click a result
        const results = await page.$$('a[href*="/p/"]');
        if (results.length > 0 && Math.random() > 0.5) {
          const result: any = randomItem(results);
          await result.click();
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
    try { await browser.close(); } catch {}
  }
}

async function dynamicImport(specifier: string) {
  return new Function('specifier', 'return import(specifier)')(specifier) as Promise<any>;
}
