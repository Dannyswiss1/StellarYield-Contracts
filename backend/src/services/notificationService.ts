import crypto from 'crypto';
import { pool } from '../database/pool';
import { config } from '../config';

interface WebhookPayload {
  event: string;
  contractId: string;
  timestamp: number;
  payload: any;
}

export class NotificationService {
  async notify(data: WebhookPayload): Promise<void> {
    const subscriptions = await this.getActiveSubscriptions(data.event);

    for (const subscription of subscriptions) {
      try {
        await this.sendWebhook(subscription.url, data, subscription.secret);
      } catch (error) {
        console.error(`Failed to send webhook to ${subscription.url}:`, error);
      }
    }
  }

  private async getActiveSubscriptions(eventName: string): Promise<any[]> {
    const result = await pool.query(
      `SELECT url, secret FROM webhook_subscriptions WHERE active = true AND $1 = ANY(events)`,
      [eventName]
    );
    return result.rows;
  }

  private async sendWebhook(url: string, payload: WebhookPayload, secret: string): Promise<void> {
    const payloadString = JSON.stringify(payload);
    const signature = this.generateSignature(payloadString, secret);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-StellarYield-Signature': signature
      },
      body: payloadString
    });

    if (!response.ok) {
      throw new Error(`Webhook request failed: ${response.statusText}`);
    }
  }

  private generateSignature(payload: string, secret: string): string {
    return crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
  }

  static verifySignature(payload: string, signature: string, secret: string): boolean {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
    
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }
}
