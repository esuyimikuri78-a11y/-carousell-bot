import { REGIONS, BAN_KEYWORDS } from '../types';
import { getBrowser, setupPage, getBaseUrl, closeBrowser } from '../browser';

export interface ChatTokenResponse {
  chatToken?: string;
  channelId?: string;
  userId?: string;
  error?: string;
}

// Fetch SendBird chat token via Puppeteer
export async function fetchChatToken(cookie: string, region: string = 'ph'): Promise<ChatTokenResponse> {
  let page: any;
  try {
    const browser = await getBrowser();
    page = await setupPage(browser, cookie, region);
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
    if (page) try { await page.close(); } catch {}
  }
}

// Send message via Puppeteer (optimized for speed)
export async function sendMessageViaPuppeteer(cookie: string, listingUrl: string, message: string, region: string = 'ph'): Promise<{ success: boolean; error?: string }> {
  let page: any;
  const timeout = setTimeout(() => {
    if (page) try { page.close(); } catch {}
  }, 90000);

  try {
    const browser = await getBrowser();
    page = await setupPage(browser, cookie, region);

    // Fast load - don't wait for all resources
    await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    const pageContent = await page.evaluate(() => document.body?.innerText || '');
    if (isBanned(pageContent)) return { success: false, error: 'ACCOUNT_BANNED' };

    // Like the listing (makes account look more natural)
    try {
      await page.evaluate(() => {
        const likeBtn = document.querySelector('button[class*="like"], button[class*="heart"], button[aria-label*="like" i], button[aria-label*="favourite" i], button[class*="D_aJl"]');
        if (likeBtn) (likeBtn as HTMLElement).click();
      });
      await new Promise(r => setTimeout(r, 500));
    } catch {}

    // Find and click Chat button
    const clicked = await page.evaluate(() => {
      const btn = document.querySelector('button.D_rW.D_sh.D_bHw.D_se.D_sb')
        || Array.from(document.querySelectorAll('button')).find(b => {
          const t = b.textContent?.trim();
          return t === 'Chat' || t === 'Chat with seller' || t === 'View Chat';
        });
      if (btn) { (btn as HTMLElement).click(); return true; }
      return false;
    });

    if (!clicked) return { success: false, error: 'Chat button not found' };

    // Wait for navigation
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
    ]);
    await new Promise(r => setTimeout(r, 3000));

    if (page.isClosed()) return { success: false, error: 'Page closed after Chat' };

    // Find textarea - fast polling
    let input: any = null;
    for (let i = 0; i < 5; i++) {
      try {
        input = await page.$('textarea') || await page.$('[contenteditable="true"]');
        if (input) break;
      } catch {}
      await new Promise(r => setTimeout(r, 1500));
    }

    if (!input) return { success: false, error: 'Chat input not found' };

    // Focus and type
    await input.click();
    await new Promise(r => setTimeout(r, 200));

    // Type message - fast, no per-char delay
    const lines = message.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) {
        await page.keyboard.down('Shift');
        await page.keyboard.press('Enter');
        await page.keyboard.up('Shift');
      }
      await page.keyboard.type(lines[i], { delay: 5 });
    }
    await new Promise(r => setTimeout(r, 500));

    // Click Send
    let sent = false;
    try {
      const btns = await page.$$('button');
      for (const btn of btns) {
        try {
          const text = await page.evaluate((el: any) => el.textContent?.trim().toLowerCase(), btn);
          if (text === 'send' || text === 'отправить') {
            await btn.click();
            sent = true;
            break;
          }
        } catch {}
      }
    } catch {}
    if (!sent) await page.keyboard.press('Enter');

    await new Promise(r => setTimeout(r, 2000));

    // Verify: textarea should be empty
    try {
      const val = await page.evaluate(() => {
        const ta = document.querySelector('textarea');
        return ta ? ta.value : null;
      });
      if (val && val.trim().length > 0) {
        return { success: false, error: 'Message not sent' };
      }
    } catch {}

    return { success: true };
  } catch (e: any) {
    return { success: false, error: `Browser error: ${e.message}` };
  } finally {
    clearTimeout(timeout);
    if (page) try { await page.close(); } catch {}
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
