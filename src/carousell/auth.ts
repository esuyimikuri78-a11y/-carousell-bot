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

async function launchBrowser() {
  const puppeteer = await import('puppeteer-core');

  let executablePath: string;
  let args: string[];

  if (process.platform === 'darwin') {
    executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'];
  } else {
    const chromium = await import('@sparticuz/chromium');
    executablePath = await chromium.default.executablePath();
    args = [...chromium.default.args, '--disable-blink-features=AutomationControlled'];
  }

  return puppeteer.default.launch({
    executablePath,
    args,
    defaultViewport: { width: 1280, height: 900 },
    headless: 'new' as any,
  });
}

async function setupPage(browser: any, cookie: string, region: string = 'ph') {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
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
    await page.goto(listingUrl, { waitUntil: 'networkidle0', timeout: 60000 });
    await new Promise(r => setTimeout(r, 5000));

    // Check for ban
    const pageContent = await page.evaluate(() => document.body?.innerText || '');
    if (isBanned(pageContent)) {
      return { success: false, error: 'ACCOUNT_BANNED' };
    }

    // Find Chat button
    const chatBtn = await page.evaluate(() => {
      let btn = document.querySelector('button.D_qP.D_qZ.D_buh.D_qW.D_qU');
      if (!btn) {
        const btns = Array.from(document.querySelectorAll('button'));
        for (const b of btns) {
          if (b.textContent?.trim() === 'Chat' || b.textContent?.trim() === 'Chat with seller') {
            btn = b; break;
          }
        }
      }
      return !!btn;
    });

    if (!chatBtn) {
      return { success: false, error: 'Chat button not found' };
    }

    // Click Chat and wait for navigation
    const navPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => null);
    await page.evaluate(() => {
      const btn = document.querySelector('button.D_qP.D_qZ.D_buh.D_qW.D_qU') ||
        Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Chat');
      if (btn) (btn as HTMLElement).click();
    });
    await navPromise;
    await new Promise(r => setTimeout(r, 8000));

    // Find textarea (try multiple times)
    let input: any = null;
    for (let i = 0; i < 10; i++) {
      input = await page.$('textarea') || await page.$('[contenteditable="true"]');
      if (input) break;
      await new Promise(r => setTimeout(r, 3000));
    }

    if (!input) return { success: false, error: 'Chat input not found' };

    // Focus and type
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
    const btns = await page.$$('button');
    for (const btn of btns) {
      const text = await page.evaluate((el: any) => el.textContent?.trim().toLowerCase(), btn);
      if (text === 'send' || text === 'отправить') {
        await btn.click();
        sent = true;
        break;
      }
    }
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
