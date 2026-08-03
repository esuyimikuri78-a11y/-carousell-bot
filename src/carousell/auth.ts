import https from 'https';
import { REGIONS, BAN_KEYWORDS } from '../types';

function getBaseUrl(region: string): string {
  const r = REGIONS[region] || REGIONS.ph;
  return `https://www.${r.domain}`;
}

export interface ChatTokenResponse {
  chatToken?: string;
  channelId?: string;
  userId?: string;
  error?: string;
}

function parseCookies(cookieStr: string, domain: string): Array<{name: string; value: string; domain: string; path: string}> {
  return cookieStr.split(';').map(c => c.trim()).filter(Boolean).map(c => {
    const eqIdx = c.indexOf('=');
    if (eqIdx === -1) return null;
    return {
      name: c.slice(0, eqIdx).trim(),
      value: c.slice(eqIdx + 1).trim(),
      domain: domain,
      path: '/',
    };
  }).filter(Boolean) as Array<{name: string; value: string; domain: string; path: string}>;
}

// Force dynamic ESM import (TypeScript compile to CJS breaks normal import())
async function dynamicImport(specifier: string) {
  return new Function('specifier', 'return import(specifier)')(specifier) as Promise<any>;
}

async function launchBrowser() {
  const puppeteer = await dynamicImport('puppeteer-core');

  let executablePath: string;
  let args: string[];

  // Stealth args to bypass Cloudflare detection
  const stealthArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-infobars',
    '--window-size=1920,1080',
    '--start-maximized',
    '--disable-gpu',
    '--disable-web-security',
    '--allow-running-insecure-content',
  ];

  if (process.platform === 'darwin') {
    executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    args = stealthArgs;
  } else {
    const chromium = await dynamicImport('@sparticuz/chromium');
    executablePath = await chromium.default.executablePath();
    args = [...chromium.default.args, ...stealthArgs.filter(a => !chromium.default.args.includes(a))];
  }

  const browser = await puppeteer.default.launch({
    executablePath,
    args,
    defaultViewport: { width: 1920, height: 1080 },
    headless: 'new' as any,
  });

  return browser;
}

async function setupPage(browser: any, cookie: string, region: string = 'ph') {
  const page = await browser.newPage();

  // Set realistic user agent
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

  // Stealth evasion scripts
  await page.evaluateOnNewDocument(() => {
    // Override webdriver flag
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    // Override languages
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    // Override plugins
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    // Override platform
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    // Chrome runtime
    (window as any).chrome = { runtime: {} };
    // Permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters: any) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
        : originalQuery(parameters);
  });

  // Set extra headers
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  });

  const r = REGIONS[region] || REGIONS.ph;
  const cookies = parseCookies(cookie, `www.${r.domain}`);
  if (cookies.length > 0) await page.setCookie(...cookies);
  return page;
}

// Fetch SendBird chat token
export async function fetchChatToken(cookie: string, region: string = 'ph'): Promise<ChatTokenResponse> {
  let browser;
  try {
    browser = await launchBrowser();
    const page = await setupPage(browser, cookie, region);
    const baseUrl = getBaseUrl(region);

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await new Promise(r => setTimeout(r, 3000));

    // Check for ban
    const pageContent = await page.evaluate(() => document.body?.innerText || '');
    if (isBanned(pageContent)) {
      return { error: 'ACCOUNT_BANNED' };
    }

    const result: any = await page.evaluate(async (url: string) => {
      try {
        const resp = await fetch(`${url}/ds/api/1.0/chat/token/`, {
          credentials: 'include',
          headers: { 'Accept': 'application/json' },
        });
        const text = await resp.text();
        try {
          return { data: JSON.parse(text) };
        } catch {
          return { raw: text.slice(0, 500) };
        }
      } catch (e: any) {
        return { error: e.message };
      }
    }, baseUrl);

    if (result.error) return { error: result.error };

    const inner = result.data?.data || result.data || {};
    const chatToken = inner.token || inner.chat_token || inner.chatToken;
    return {
      chatToken,
      channelId: inner.channel_id || inner.channelId,
      userId: inner.user_id || inner.userId || inner.id,
      error: !chatToken ? 'No token found' : undefined,
    };
  } catch (e: any) {
    return { error: `Browser error: ${e.message}` };
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }
}

// Send message via Puppeteer with 120s timeout
export async function sendMessageViaPuppeteer(cookie: string, listingUrl: string, message: string, region: string = 'ph'): Promise<{success: boolean; error?: string}> {
  let browser: any;
  const timeout = setTimeout(() => {
    if (browser) try { browser.close(); } catch {}
  }, 120000);

  try {
    browser = await launchBrowser();
    const page = await setupPage(browser, cookie, region);

    // Navigate to listing
    await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await new Promise(r => setTimeout(r, 5000));

    // Check for ban
    const pageContent = await page.evaluate(() => document.body?.innerText || '');
    if (isBanned(pageContent)) {
      return { success: false, error: 'ACCOUNT_BANNED' };
    }

    // Find Chat button
    const chatBtnTexts = ['Chat', 'Chat with seller', 'View Chat', '💬 Chat'];
    const chatBtn = await page.evaluate((texts: string[]) => {
      let btn = document.querySelector('button.D_rW.D_sh.D_bHw.D_se.D_sb');
      if (btn) return true;
      const btns = Array.from(document.querySelectorAll('button'));
      for (const b of btns) {
        const text = b.textContent?.trim();
        if (text && texts.includes(text)) return true;
      }
      return false;
    }, chatBtnTexts);

    if (!chatBtn) {
      return { success: false, error: 'Chat button not found' };
    }

    // Click Chat button and wait for navigation
    // Use Promise.all to handle navigation that starts from the click
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
      page.evaluate((texts: string[]) => {
        let btn = document.querySelector('button.D_rW.D_sh.D_bHw.D_se.D_sb');
        if (!btn) {
          const btns = Array.from(document.querySelectorAll('button'));
          for (const b of btns) {
            const text = b.textContent?.trim();
            if (text && texts.includes(text)) { btn = b; break; }
          }
        }
        if (btn) (btn as HTMLElement).click();
      }, chatBtnTexts),
    ]);

    // Wait for the new page to fully load
    await new Promise(r => setTimeout(r, 8000));

    // Now use page.mainFrame() to get the current frame context
    let input: any = null;
    for (let i = 0; i < 10; i++) {
      try {
        const frame = page.mainFrame();
        input = await frame.$('textarea') || await frame.$('[contenteditable="true"]');
        if (input) break;
      } catch {}
      await new Promise(r => setTimeout(r, 3000));
    }

    if (!input) return { success: false, error: 'Chat input not found' };

    // Focus and type using keyboard (avoids frame issues)
    await input.click();
    await new Promise(r => setTimeout(r, 500));

    // Type multiline message
    const lines = message.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) {
        await page.keyboard.down('Shift');
        await page.keyboard.press('Enter');
        await page.keyboard.up('Shift');
        await new Promise(r => setTimeout(r, 50));
      }
      await page.keyboard.type(lines[i], { delay: 15 });
    }
    await new Promise(r => setTimeout(r, 1000));

    // Click Send
    let sent = false;
    try {
      const frame = page.mainFrame();
      const btns = await frame.$$('button');
      for (const btn of btns) {
        try {
          const text = await frame.evaluate((el: any) => el.textContent?.trim().toLowerCase(), btn);
          if (text === 'send' || text === 'отправить') {
            await btn.click();
            sent = true;
            break;
          }
        } catch {}
      }
    } catch {}
    if (!sent) await page.keyboard.press('Enter');

    await new Promise(r => setTimeout(r, 3000));
    return { success: true };
  } catch (e: any) {
    return { success: false, error: `Browser error: ${e.message}` };
  } finally {
    clearTimeout(timeout);
    if (browser) {
      try {
        const pages = await browser.pages();
        for (const p of pages) try { await p.close(); } catch {}
        await browser.close();
      } catch {
        try { await browser.close(); } catch {}
      }
    }
  }
}

export function extractUserFromJwt(cookie: string): { userId?: string; username?: string; error?: string } {
  try {
    const jwtMatch = cookie.match(/jwt=([^;]+)/);
    if (!jwtMatch) return { error: 'No jwt cookie found' };
    const jwt = jwtMatch[1];
    const parts = jwt.split('.');
    if (parts.length < 2) return { error: 'Invalid JWT format' };
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(payload, 'base64').toString('utf-8');
    const json = JSON.parse(decoded);
    return {
      userId: json.id || json.user_id || json.sub,
      username: json.user || json.username || json.name || json.email,
    };
  } catch (e: any) {
    return { error: `JWT parse error: ${e.message}` };
  }
}

export async function validateCookie(cookie: string): Promise<{ valid: boolean; username?: string; error?: string }> {
  const jwtInfo = extractUserFromJwt(cookie);
  if (jwtInfo.error) return { valid: false, error: jwtInfo.error };
  return { valid: true, username: jwtInfo.username };
}

// Detect if account is banned
function isBanned(pageText: string): boolean {
  const lower = pageText.toLowerCase();
  return BAN_KEYWORDS.some(kw => lower.includes(kw));
}
