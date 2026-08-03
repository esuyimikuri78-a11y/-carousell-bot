import { REGIONS, BAN_KEYWORDS } from '../types';
import { launchBrowser, setupPage, getBaseUrl } from '../browser';

export interface ChatTokenResponse {
  chatToken?: string;
  channelId?: string;
  userId?: string;
  error?: string;
}

// Fetch SendBird chat token via Puppeteer
export async function fetchChatToken(cookie: string, region: string = 'ph'): Promise<ChatTokenResponse> {
  let browser;
  try {
    browser = await launchBrowser();
    const page = await setupPage(browser, cookie, region);
    const baseUrl = getBaseUrl(region);

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await new Promise(r => setTimeout(r, 3000));

    const pageContent = await page.evaluate(() => document.body?.innerText || '');
    if (isBanned(pageContent)) return { error: 'ACCOUNT_BANNED' };

    const result: any = await page.evaluate(async (url: string) => {
      try {
        const resp = await fetch(`${url}/ds/api/1.0/chat/token/`, {
          credentials: 'include',
          headers: { 'Accept': 'application/json' },
        });
        const text = await resp.text();
        try { return { data: JSON.parse(text) }; }
        catch { return { raw: text.slice(0, 500) }; }
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

// Send message via Puppeteer
export async function sendMessageViaPuppeteer(cookie: string, listingUrl: string, message: string, region: string = 'ph'): Promise<{ success: boolean; error?: string }> {
  let browser: any;
  const timeout = setTimeout(() => {
    if (browser) try { browser.close(); } catch {}
  }, 120000);

  try {
    browser = await launchBrowser();
    const page = await setupPage(browser, cookie, region);

    await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await new Promise(r => setTimeout(r, 5000));

    const pageContent = await page.evaluate(() => document.body?.innerText || '');
    if (isBanned(pageContent)) return { success: false, error: 'ACCOUNT_BANNED' };

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

    if (!chatBtn) return { success: false, error: 'Chat button not found' };

    // Click Chat and wait for navigation
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

    await new Promise(r => setTimeout(r, 8000));

    // Find textarea
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

// Extract user info from JWT
export function extractUserFromJwt(cookie: string): { userId?: string; username?: string; error?: string } {
  try {
    const jwtMatch = cookie.match(/jwt=([^;]+)/);
    if (!jwtMatch) return { error: 'No jwt cookie found' };
    const parts = jwtMatch[1].split('.');
    if (parts.length < 2) return { error: 'Invalid JWT format' };
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(Buffer.from(payload, 'base64').toString('utf-8'));
    return {
      userId: json.id || json.user_id || json.sub,
      username: json.user || json.username || json.name || json.email,
    };
  } catch (e: any) {
    return { error: `JWT parse error: ${e.message}` };
  }
}

// Validate cookie
export async function validateCookie(cookie: string): Promise<{ valid: boolean; username?: string; error?: string }> {
  const jwtInfo = extractUserFromJwt(cookie);
  if (jwtInfo.error) return { valid: false, error: jwtInfo.error };
  return { valid: true, username: jwtInfo.username };
}

function isBanned(pageText: string): boolean {
  const lower = pageText.toLowerCase();
  return BAN_KEYWORDS.some(kw => lower.includes(kw));
}
