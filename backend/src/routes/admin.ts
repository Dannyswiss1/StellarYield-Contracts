import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import { adminAuth } from '../middleware/auth';
import { Indexer } from '../indexer';
import { pool } from '../database/pool';
import { setPaginationHeaders } from '../middleware/pagination';

const router = Router();

router.use(adminAuth);

router.post(
  '/indexer/replay',
  [
    body('fromLedger').isInt({ min: 0 }).toInt(),
    body('toLedger').isInt({ min: 0 }).toInt()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { fromLedger, toLedger } = req.body;

    if (fromLedger > toLedger) {
      return res.status(400).json({ error: 'fromLedger must be less than or equal to toLedger' });
    }

    const replayId = `replay-${Date.now()}-${fromLedger}-${toLedger}`;

    setImmediate(async () => {
      try {
        const indexer = new Indexer();
        const eventsReplayed = await indexer.replayLedgerRange(fromLedger, toLedger);
        console.log(`Replay ${replayId} completed: ${eventsReplayed} events`);
      } catch (error) {
        console.error(`Replay ${replayId} failed:`, error);
      }
    });

    res.status(202).json({
      replayId,
      fromLedger,
      toLedger,
      status: 'accepted'
    });
  }
);

router.get('/vaults/:contractId/audit', async (req, res) => {
  try {
    const { contractId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM audit_log WHERE vault_contract_id = $1`,
      [contractId]
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const result = await pool.query(
      `SELECT id, action, actor_address, details, created_at
       FROM audit_log
       WHERE vault_contract_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [contractId, limit, offset]
    );

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
    console.error('Error fetching audit log:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/events', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const eventType = req.query.eventType as string;
    const contractId = req.query.contractId as string;

    let query = 'SELECT COUNT(*) FROM indexed_events WHERE 1=1';
    let dataQuery = `SELECT id, ledger, transaction_hash, event_type, contract_id, event_data, indexed_at
                     FROM indexed_events WHERE 1=1`;
    const params: any[] = [];
    let paramIndex = 1;

    if (eventType) {
      query += ` AND event_type = $${paramIndex}`;
      dataQuery += ` AND event_type = $${paramIndex}`;
      params.push(eventType);
      paramIndex++;
    }

    if (contractId) {
      query += ` AND contract_id = $${paramIndex}`;
      dataQuery += ` AND contract_id = $${paramIndex}`;
      params.push(contractId);
      paramIndex++;
    }

    const countResult = await pool.query(query, params);
    const total = parseInt(countResult.rows[0].count, 10);

    dataQuery += ` ORDER BY ledger DESC, indexed_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
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
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
