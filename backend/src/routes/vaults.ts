import { Router } from 'express';
import { pool } from '../database/pool';
import { setPaginationHeaders } from '../middleware/pagination';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const state = req.query.state as string;

    let query = 'SELECT COUNT(*) FROM vaults';
    let dataQuery = `SELECT contract_id, asset_address, admin_address, state, expected_apy,
                     maturity_date, funding_deadline, min_deposit, max_deposit,
                     total_deposits, total_shares, created_at, updated_at
                     FROM vaults`;
    const params: any[] = [];

    if (state) {
      query += ' WHERE state = $1';
      dataQuery += ' WHERE state = $1';
      params.push(state);
    }

    const countResult = await pool.query(query, params);
    const total = parseInt(countResult.rows[0].count, 10);

    dataQuery += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
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
    console.error('Error fetching vaults:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:contractId', async (req, res) => {
  try {
    const { contractId } = req.params;

    const result = await pool.query(
      `SELECT contract_id, asset_address, admin_address, state, expected_apy,
       maturity_date, funding_deadline, min_deposit, max_deposit,
       total_deposits, total_shares, created_at, updated_at
       FROM vaults WHERE contract_id = $1`,
      [contractId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Vault not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching vault:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:contractId/operators', async (req, res) => {
  try {
    const { contractId } = req.params;
    const now = Math.floor(Date.now() / 1000);

    const result = await pool.query(
      `SELECT id, operator_address, role, expires_at, assigned_at
       FROM vault_operators
       WHERE vault_contract_id = $1
       AND active = true
       AND (expires_at IS NULL OR expires_at > $2)
       ORDER BY assigned_at DESC`,
      [contractId, now]
    );

    res.json({
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching operators:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
