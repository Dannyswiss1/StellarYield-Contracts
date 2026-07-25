import { Router } from 'express';
import { pool } from '../database/pool';
import { setPaginationHeaders } from '../middleware/pagination';

const router = Router();

router.get('/:address/yield-history', async (req, res) => {
  try {
    const { address } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const contractId = req.query.contractId as string;

    let query = 'SELECT COUNT(*) FROM yield_history WHERE user_address = $1';
    let dataQuery = `SELECT yh.id, yh.vault_contract_id, yh.epoch, yh.yield_amount,
                     yh.claimed, yh.claimed_at, yh.created_at, v.state as vault_state
                     FROM yield_history yh
                     JOIN vaults v ON v.contract_id = yh.vault_contract_id
                     WHERE yh.user_address = $1`;
    const params: any[] = [address];
    let paramIndex = 2;

    if (contractId) {
      query += ` AND vault_contract_id = $${paramIndex}`;
      dataQuery += ` AND yh.vault_contract_id = $${paramIndex}`;
      params.push(contractId);
      paramIndex++;
    }

    const countResult = await pool.query(query, params);
    const total = parseInt(countResult.rows[0].count, 10);

    dataQuery += ` ORDER BY yh.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    const dataParams = [...params, limit, offset];

    const result = await pool.query(dataQuery, dataParams);

    setPaginationHeaders(res, total, limit);

    res.json({
      data: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching yield history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:address/deposits', async (req, res) => {
  try {
    const { address } = req.params;

    const result = await pool.query(
      `SELECT ud.vault_contract_id, ud.amount, ud.shares, ud.deposited_at,
       v.state, v.expected_apy, v.maturity_date
       FROM user_deposits ud
       JOIN vaults v ON v.contract_id = ud.vault_contract_id
       WHERE ud.user_address = $1
       ORDER BY ud.deposited_at DESC`,
      [address]
    );

    res.json({
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching deposits:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
