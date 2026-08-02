import { fetchChatToken, validateCookie } from './auth';
import { SendbirdClient, SendbirdConfig, extractChatIdFromUrl } from './ws-client';
import { CarousellAccount, SendResult } from '../types';

// Token cache: accountId -> {token, channelId, userId, fetchedAt}
const tokenCache = new Map<string, { token: string; channelId: string; userId: string; fetchedAt: number }>();
const TOKEN_TTL = 50 * 60 * 1000; // 50 minutes

export class CarousellChat {
  private client: SendbirdClient | null = null;
  private account: CarousellAccount | null = null;

  async connect(account: CarousellAccount): Promise<{ success: boolean; error?: string }> {
    this.account = account;

    if (!account.cookie) {
      return { success: false, error: 'No cookie available' };
    }

    // Check token cache
    const cached = tokenCache.get(account.id);
    let chatToken: string;
    let channelId: string;
    let userId: string;

    if (cached && Date.now() - cached.fetchedAt < TOKEN_TTL) {
      chatToken = cached.token;
      channelId = cached.channelId;
      userId = cached.userId;
    } else {
      // Fetch fresh token (uses Puppeteer, bypasses Cloudflare)
      const tokenResult = await fetchChatToken(account.cookie);
      if (tokenResult.error || !tokenResult.chatToken) {
        return { success: false, error: tokenResult.error || 'Failed to get chat token' };
      }
      chatToken = tokenResult.chatToken;
      channelId = tokenResult.channelId || '';
      userId = tokenResult.userId || '';

      // Cache it
      tokenCache.set(account.id, {
        token: chatToken,
        channelId,
        userId,
        fetchedAt: Date.now(),
      });
    }

    // Connect to SendBird WebSocket
    try {
      this.client = new SendbirdClient({ chatToken, channelId, userId });
      await this.client.connect();
      return { success: true };
    } catch (e: any) {
      // Invalidate cache on connection failure
      tokenCache.delete(account.id);
      return { success: false, error: `WebSocket failed: ${e.message}` };
    }
  }

  async sendToListing(listingUrl: string, message: string): Promise<SendResult> {
    if (!this.client) {
      return { success: false, error: 'Not connected' };
    }

    const listingId = extractChatIdFromUrl(listingUrl);
    if (!listingId) {
      return { success: false, error: `Cannot extract listing ID: ${listingUrl}` };
    }

    const channelUrl = this.client.buildChannelUrl(listingId);
    return this.client.sendMessage(channelUrl, message);
  }

  async validate(): Promise<{ valid: boolean; username?: string; error?: string }> {
    if (!this.account?.cookie) return { valid: false, error: 'No cookie' };
    return validateCookie(this.account.cookie);
  }

  disconnect(): void {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
  }

  isConnected(): boolean {
    return this.client !== null;
  }
}
