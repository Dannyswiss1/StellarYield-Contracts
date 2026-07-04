# Deploying the Backend to Stellar Testnet

## Prerequisites

- Node.js 20+, PostgreSQL 14+
- Soroban contracts deployed on testnet (obtain their IDs after deployment)

## Environment Variables

Copy `.env.example` to `.env` and set the following:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | `postgresql://user:pass@host:5432/stellaryield` |
| `STELLAR_RPC_URL` | Yes | `https://soroban-testnet.stellar.org` |
| `STELLAR_NETWORK` | Yes | `testnet` |
| `STELLAR_NETWORK_PASSPHRASE` | Yes | `Test SDF Network ; September 2015` |
| `VAULT_FACTORY_CONTRACT_ID` | Yes | Contract ID from your testnet deployment |
| `ZKME_VERIFIER_CONTRACT_ID` | No | zkMe verifier contract ID if used |
| `INDEXER_START_LEDGER` | No | Ledger to start indexing from (0 = latest) |
| `INDEXER_POLL_INTERVAL_MS` | No | Default `5000` (5 s) |
| `PORT` | No | Default `3000` |

## Running Migrations

Build the project and run migrations before starting:

```bash
npm ci
npm run build
node dist/db/migrate.js
```

## Starting the Server

```bash
npm start
# or with Docker:
docker build -t stellaryield-backend .
docker run --env-file .env -p 3000:3000 stellaryield-backend
```

## Verifying the Indexer Picks Up Events

1. Check the health endpoint responds with `{"status":"ok"}`:
   ```bash
   curl http://localhost:3000/health
   ```

2. Watch server logs for indexer activity — each poll logs the latest ledger processed.

3. Trigger a contract event on testnet (e.g., deposit to a vault), then query the events API:
   ```bash
   curl -H "X-API-Key: <key>" http://localhost:3000/api/v1/events
   ```
   New events should appear within `INDEXER_POLL_INTERVAL_MS` milliseconds.
