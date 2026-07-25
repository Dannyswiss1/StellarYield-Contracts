import { pool } from '../database/pool';
import { NotificationService } from '../services/notificationService';

interface EventData {
  ledger: number;
  transactionHash: string;
  contractId: string;
  eventType: string;
  topics: any[];
  data: any;
}

export class EventProcessor {
  private notificationService: NotificationService;

  constructor() {
    this.notificationService = new NotificationService();
  }

  async processEvent(event: EventData): Promise<void> {
    const { ledger, transactionHash, contractId, eventType, data } = event;

    await pool.query(
      `INSERT INTO indexed_events (ledger, transaction_hash, event_type, contract_id, event_data)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (transaction_hash, contract_id, event_type) DO NOTHING`,
      [ledger, transactionHash, eventType, contractId, JSON.stringify(data)]
    );

    switch (eventType) {
      case 'vault_created':
        await this.handleVaultCreated(contractId, data);
        break;
      case 'deposit':
        await this.handleDeposit(contractId, data);
        break;
      case 'withdraw':
        await this.handleWithdraw(contractId, data);
        break;
      case 'yield_distributed':
        await this.handleYieldDistributed(contractId, data);
        break;
      case 'vault_state_changed':
        await this.handleVaultStateChanged(contractId, data);
        break;
      case 'vault.matured':
        await this.handleVaultMatured(contractId, data);
        break;
      case 'op_add':
        await this.handleOperatorAdded(contractId, data);
        break;
      case 'op_remove':
        await this.handleOperatorRemoved(contractId, data);
        break;
      default:
        console.log(`Unknown event type: ${eventType}`);
    }
  }

  private async handleVaultCreated(contractId: string, data: any): Promise<void> {
    await pool.query(
      `INSERT INTO vaults (contract_id, asset_address, admin_address, state, expected_apy, maturity_date, funding_deadline, min_deposit, max_deposit)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (contract_id) DO UPDATE SET
       asset_address = EXCLUDED.asset_address,
       admin_address = EXCLUDED.admin_address,
       updated_at = CURRENT_TIMESTAMP`,
      [
        contractId,
        data.asset_address,
        data.admin,
        'Funding',
        data.expected_apy,
        data.maturity_date,
        data.funding_deadline,
        data.min_deposit,
        data.max_deposit
      ]
    );

    await this.notificationService.notify({
      event: 'vault_created',
      contractId,
      timestamp: Date.now(),
      payload: data
    });
  }

  private async handleDeposit(contractId: string, data: any): Promise<void> {
    const { user, amount, shares } = data;

    await pool.query(
      `INSERT INTO users (address) VALUES ($1) ON CONFLICT (address) DO NOTHING`,
      [user]
    );

    await pool.query(
      `INSERT INTO user_deposits (vault_contract_id, user_address, amount, shares)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (vault_contract_id, user_address) DO UPDATE SET
       amount = user_deposits.amount + EXCLUDED.amount,
       shares = user_deposits.shares + EXCLUDED.shares`,
      [contractId, user, amount, shares]
    );

    await pool.query(
      `UPDATE vaults SET
       total_deposits = total_deposits + $1,
       total_shares = total_shares + $2,
       updated_at = CURRENT_TIMESTAMP
       WHERE contract_id = $3`,
      [amount, shares, contractId]
    );

    await this.notificationService.notify({
      event: 'deposit',
      contractId,
      timestamp: Date.now(),
      payload: { user, amount, shares }
    });
  }

  private async handleWithdraw(contractId: string, data: any): Promise<void> {
    const { user, amount, shares } = data;

    await pool.query(
      `UPDATE user_deposits SET
       amount = amount - $1,
       shares = shares - $2
       WHERE vault_contract_id = $3 AND user_address = $4`,
      [amount, shares, contractId, user]
    );

    await pool.query(
      `UPDATE vaults SET
       total_deposits = total_deposits - $1,
       total_shares = total_shares - $2,
       updated_at = CURRENT_TIMESTAMP
       WHERE contract_id = $3`,
      [amount, shares, contractId]
    );

    await this.notificationService.notify({
      event: 'withdraw',
      contractId,
      timestamp: Date.now(),
      payload: { user, amount, shares }
    });
  }

  private async handleYieldDistributed(contractId: string, data: any): Promise<void> {
    const { epoch, total_yield, total_shares } = data;

    await pool.query(
      `INSERT INTO yield_distributions (vault_contract_id, epoch, total_yield, total_shares_snapshot)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (vault_contract_id, epoch) DO UPDATE SET
       total_yield = EXCLUDED.total_yield,
       total_shares_snapshot = EXCLUDED.total_shares_snapshot`,
      [contractId, epoch, total_yield, total_shares]
    );

    const depositsResult = await pool.query(
      `SELECT user_address, shares FROM user_deposits WHERE vault_contract_id = $1`,
      [contractId]
    );

    for (const row of depositsResult.rows) {
      const userYield = Math.floor((BigInt(row.shares) * BigInt(total_yield)) / BigInt(total_shares));
      
      await pool.query(
        `INSERT INTO yield_history (vault_contract_id, user_address, epoch, yield_amount)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (vault_contract_id, user_address, epoch) DO UPDATE SET
         yield_amount = EXCLUDED.yield_amount`,
        [contractId, row.user_address, epoch, userYield.toString()]
      );
    }

    await this.notificationService.notify({
      event: 'yield_distributed',
      contractId,
      timestamp: Date.now(),
      payload: { epoch, total_yield, total_shares }
    });
  }

  private async handleVaultStateChanged(contractId: string, data: any): Promise<void> {
    const { new_state } = data;

    await pool.query(
      `UPDATE vaults SET state = $1, updated_at = CURRENT_TIMESTAMP WHERE contract_id = $2`,
      [new_state, contractId]
    );

    await pool.query(
      `INSERT INTO audit_log (vault_contract_id, action, actor_address, details)
       VALUES ($1, $2, $3, $4)`,
      [contractId, 'state_changed', 'system', JSON.stringify({ new_state })]
    );

    await this.notificationService.notify({
      event: 'vault_state_changed',
      contractId,
      timestamp: Date.now(),
      payload: { new_state }
    });
  }

  private async handleVaultMatured(contractId: string, data: any): Promise<void> {
    await pool.query(
      `UPDATE vaults SET state = $1, updated_at = CURRENT_TIMESTAMP WHERE contract_id = $2`,
      ['Matured', contractId]
    );

    await this.notificationService.notify({
      event: 'vault.matured',
      contractId,
      timestamp: Date.now(),
      payload: data
    });
  }

  private async handleOperatorAdded(contractId: string, data: any): Promise<void> {
    const { operator, role, expires_at } = data;

    await pool.query(
      `INSERT INTO vault_operators (vault_contract_id, operator_address, role, active, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (vault_contract_id, operator_address, role) DO UPDATE SET
       active = true,
       expires_at = EXCLUDED.expires_at,
       assigned_at = CURRENT_TIMESTAMP`,
      [contractId, operator, role, true, expires_at || null]
    );

    await pool.query(
      `INSERT INTO audit_log (vault_contract_id, action, actor_address, details)
       VALUES ($1, $2, $3, $4)`,
      [contractId, 'operator_added', operator, JSON.stringify({ role, expires_at })]
    );
  }

  private async handleOperatorRemoved(contractId: string, data: any): Promise<void> {
    const { operator, role } = data;

    await pool.query(
      `UPDATE vault_operators SET active = false WHERE vault_contract_id = $1 AND operator_address = $2 AND role = $3`,
      [contractId, operator, role]
    );

    await pool.query(
      `INSERT INTO audit_log (vault_contract_id, action, actor_address, details)
       VALUES ($1, $2, $3, $4)`,
      [contractId, 'operator_removed', operator, JSON.stringify({ role })]
    );
  }
}
