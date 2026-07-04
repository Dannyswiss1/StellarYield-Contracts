import { config } from '../config';

interface RpcEvent {
  type: string;
  contractId: string;
  topics: any[];
  value: any;
  inSuccessfulContractCall: boolean;
}

interface LedgerEvents {
  ledger: number;
  events: RpcEvent[];
}

export class StellarRpcClient {
  private rpcUrl: string;

  constructor() {
    this.rpcUrl = config.stellar.rpcUrl;
  }

  async getEvents(startLedger: number, endLedger?: number): Promise<LedgerEvents[]> {
    const filters = {
      type: 'contract',
      contractIds: [],
      topics: []
    };

    const params: any = {
      startLedger,
      filters,
      pagination: {
        limit: 1000
      }
    };

    if (endLedger) {
      params.endLedger = endLedger;
    }

    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getEvents',
          params: [params]
        })
      });

      if (!response.ok) {
        throw new Error(`RPC request failed: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.error) {
        throw new Error(`RPC error: ${data.error.message}`);
      }

      return this.parseEventsResponse(data.result);
    } catch (error) {
      console.error('Error fetching events from Stellar RPC:', error);
      throw error;
    }
  }

  async getLatestLedger(): Promise<number> {
    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getLatestLedger',
          params: []
        })
      });

      if (!response.ok) {
        throw new Error(`RPC request failed: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.error) {
        throw new Error(`RPC error: ${data.error.message}`);
      }

      return data.result.sequence;
    } catch (error) {
      console.error('Error fetching latest ledger:', error);
      throw error;
    }
  }

  private parseEventsResponse(result: any): LedgerEvents[] {
    if (!result || !result.events) {
      return [];
    }

    const ledgerEventsMap = new Map<number, RpcEvent[]>();

    for (const event of result.events) {
      if (!event.inSuccessfulContractCall) {
        continue;
      }

      const ledger = event.ledger;
      if (!ledgerEventsMap.has(ledger)) {
        ledgerEventsMap.set(ledger, []);
      }

      ledgerEventsMap.get(ledger)!.push({
        type: event.type,
        contractId: event.contractId,
        topics: event.topic || [],
        value: event.value,
        inSuccessfulContractCall: event.inSuccessfulContractCall
      });
    }

    return Array.from(ledgerEventsMap.entries()).map(([ledger, events]) => ({
      ledger,
      events
    }));
  }
}
