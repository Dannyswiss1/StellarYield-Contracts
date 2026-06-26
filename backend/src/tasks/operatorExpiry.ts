import { pool } from '../database/pool';
import cron from 'node-cron';

export async function markExpiredOperators(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  try {
    const result = await pool.query(
      `UPDATE vault_operators
       SET active = false
       WHERE active = true
       AND expires_at IS NOT NULL
       AND expires_at < $1
       RETURNING id, vault_contract_id, operator_address, role, expires_at`,
      [now]
    );

    if (result.rows.length > 0) {
      console.log(`Marked ${result.rows.length} operators as inactive due to expiry`);
      
      for (const row of result.rows) {
        await pool.query(
          `INSERT INTO audit_log (vault_contract_id, action, actor_address, details)
           VALUES ($1, $2, $3, $4)`,
          [
            row.vault_contract_id,
            'operator_expired',
            'system',
            JSON.stringify({
              operator_address: row.operator_address,
              role: row.role,
              expires_at: row.expires_at
            })
          ]
        );
      }
    }
  } catch (error) {
    console.error('Error marking expired operators:', error);
  }
}

export function startOperatorExpiryTask(): void {
  cron.schedule('0 * * * *', async () => {
    console.log('Running operator expiry task...');
    await markExpiredOperators();
  });

  console.log('Operator expiry task scheduled (runs every hour)');
}

if (require.main === module) {
  markExpiredOperators()
    .then(() => {
      console.log('Operator expiry task completed');
      process.exit(0);
    })
    .catch(err => {
      console.error('Operator expiry task failed:', err);
      process.exit(1);
    });
}
