import { pool } from '../database/pool';
import { StellarRpcClient } from './stellarRpc';
import { EventProcessor } from './eventProcessor';

export class Indexer {
  private rpcClient: StellarRpcClient;
  private eventProcessor: EventProcessor;
  private isRunning: boolean = false;
  private pollInterval: number = 5000;

  constructor() {
    this.rpcClient = new StellarRpcClient();
    this.eventProcessor = new EventProcessor();
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Indexer is already running');
      return;
    }

    this.isRunning = true;
    console.log('Starting indexer...');

    while (this.isRunning) {
      try {
        await this.processNewLedgers();
        await this.sleep(this.pollInterval);
      } catch (error) {
        console.error('Error in indexer loop:', error);
        await this.sleep(this.pollInterval);
      }
    }
  }

  stop(): void {
    this.isRunning = false;
    console.log('Stopping indexer...');
  }

  async processNewLedgers(): Promise<void> {
    const lastLedger = await this.getLastProcessedLedger();
    const latestLedger = await this.rpcClient.getLatestLedger();

    if (lastLedger >= latestLedger) {
      return;
    }

    const fromLedger = lastLedger + 1;
    const toLedger = Math.min(fromLedger + 100, latestLedger);

    console.log(`Processing ledgers ${fromLedger} to ${toLedger}`);

    const ledgerEvents = await this.rpcClient.getEvents(fromLedger, toLedger);

    for (const ledger of ledgerEvents) {
      for (const event of ledger.events) {
        await this.eventProcessor.processEvent({
          ledger: ledger.ledger,
          transactionHash: this.generateTxHash(ledger.ledger, event),
          contractId: event.contractId,
          eventType: this.extractEventType(event),
          topics: event.topics,
          data: this.extractEventData(event)
        });
      }
    }

    await this.updateLastProcessedLedger(toLedger);
    console.log(`Processed up to ledger ${toLedger}`);
  }

  async replayLedgerRange(fromLedger: number, toLedger: number): Promise<number> {
    console.log(`Replaying ledgers ${fromLedger} to ${toLedger}`);

    await pool.query(
      `DELETE FROM indexed_events WHERE ledger >= $1 AND ledger <= $2`,
      [fromLedger, toLedger]
    );

    const ledgerEvents = await this.rpcClient.getEvents(fromLedger, toLedger);
    let eventsProcessed = 0;

    for (const ledger of ledgerEvents) {
      for (const event of ledger.events) {
        await this.eventProcessor.processEvent({
          ledger: ledger.ledger,
          transactionHash: this.generateTxHash(ledger.ledger, event),
          contractId: event.contractId,
          eventType: this.extractEventType(event),
          topics: event.topics,
          data: this.extractEventData(event)
        });
        eventsProcessed++;
      }
    }

    console.log(`Replay complete: ${eventsProcessed} events processed`);
    return eventsProcessed;
  }

  private async getLastProcessedLedger(): Promise<number> {
    const result = await pool.query(
      `SELECT value FROM indexer_state WHERE key = 'last_ledger'`
    );
    return parseInt(result.rows[0]?.value || '0', 10);
  }

  private async updateLastProcessedLedger(ledger: number): Promise<void> {
    await pool.query(
      `UPDATE indexer_state SET value = $1, updated_at = CURRENT_TIMESTAMP WHERE key = 'last_ledger'`,
      [ledger.toString()]
    );
  }

  private extractEventType(event: any): string {
    if (event.topics && event.topics.length > 0) {
      const topic = event.topics[0];
      if (typeof topic === 'string') {
        return topic;
      }
      if (topic.sym) {
        return topic.sym;
      }
    }
    return 'unknown';
  }

  private extractEventData(event: any): any {
    return event.value || {};
  }

  private generateTxHash(ledger: number, event: any): string {
    return `${ledger}-${event.contractId}-${Date.now()}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

if (require.main === module) {
  const indexer = new Indexer();
  
  process.on('SIGINT', () => {
    indexer.stop();
    process.exit(0);
  });

  indexer.start().catch(err => {
    console.error('Indexer failed:', err);
    process.exit(1);
  });
}
