import { REGIONS } from './types';
import { dynamicImport } from './browser-helpers';

// Shared browser instance with queue
let sharedBrowser: any = null;
let browserLaunchPromise: Promise<any> | null = null;
const STEALTH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--disable-infobars',
  '--window-size=1920,1080',
  '--start-maximized',
  '--disable-gpu',
];

export function parseCookies(cookieStr: string, domain: string): Array<{ name: string; value: string; domain: string; path: string }> {
  return cookieStr.split(';').map(c => c.trim()).filter(Boolean).map(c => {
    const eqIdx = c.indexOf('=');
    if (eqIdx === -1) return null;
    return {
      name: c.slice(0, eqIdx).trim(),
      value: c.slice(eqIdx + 1).trim(),
      domain,
      path: '/',
    };
  }).filter(Boolean) as Array<{ name: string; value: string; domain: string; path: string }>;
}

export function getDomain(region: string): string {
  return (REGIONS[region] || REGIONS.ph).domain;
}

export function getBaseUrl(region: string): string {
  return `https://www.${getDomain(region)}`;
}

// Get or launch a shared browser instance
export async function getBrowser(): Promise<any> {
  // If browser is alive, return it
  if (sharedBrowser) {
    try {
      await sharedBrowser.version();
      return sharedBrowser;
    } catch {
      sharedBrowser = null;
    }
  }

  // If someone else is launching, wait for them
  if (browserLaunchPromise) {
    return browserLaunchPromise;
  }

  // Launch new browser
  browserLaunchPromise = doLaunch();
  try {
    sharedBrowser = await browserLaunchPromise;
    return sharedBrowser;
  } finally {
    browserLaunchPromise = null;
  }
}

async function doLaunch(): Promise<any> {
  const puppeteer = await dynamicImport('puppeteer-core');

  let executablePath: string;
  let args: string[];

  if (process.platform === 'darwin') {
    executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    args = STEALTH_ARGS;
  } else {
    const chromium = await dynamicImport('@sparticuz/chromium');
    chromium.default.setGraphicsMode = false;
    executablePath = await chromium.default.executablePath();
    args = [...chromium.default.args, ...STEALTH_ARGS.filter(a => !chromium.default.args.includes(a))];
  }

  return puppeteer.default.launch({
    executablePath,
    args,
    defaultViewport: { width: 1920, height: 1080 },
    headless: 'new' as any,
  });
}

// Close shared browser
export async function closeBrowser(): Promise<void> {
  if (sharedBrowser) {
    try { await sharedBrowser.close(); } catch {}
    sharedBrowser = null;
  }
}

export async function setupPage(browser: any, cookie: string, region: string = 'ph') {
  const page = await browser.newPage();

  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    (window as any).chrome = { runtime: {} };
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters: any) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
        : originalQuery(parameters);
  });

  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  });

  const domain = getDomain(region);
  const cookies = parseCookies(cookie, `www.${domain}`);
  if (cookies.length > 0) await page.setCookie(...cookies);

  return page;
}
