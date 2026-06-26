# StellarYield Backend

Backend API and indexer for the StellarYield RWA platform.

## Features

- REST API for vault and yield management
- Event indexer for Stellar blockchain
- Webhook notifications for real-time updates
- Admin endpoints for operational tasks
- Operator expiry tracking

## Setup

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Stellar testnet access

### Installation

```bash
npm install
```

### Database Setup

1. Create PostgreSQL database:
```bash
createdb stellaryield
```

2. Run migrations:
```bash
npm run migrate
```

### Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Required environment variables:
- `DATABASE_URL` - PostgreSQL connection string
- `STELLAR_RPC_URL` - Stellar RPC endpoint
- `WEBHOOK_SECRET` - Secret for webhook signatures
- `ADMIN_API_KEY` - Admin API authentication key

## Running

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

### Indexer

Run the indexer in a separate process:

```bash
npm run indexer
```

### Operator Expiry Task

Run manually or schedule via cron:

```bash
npm run operator-expiry-task
```

## API Endpoints

### Public Endpoints

- `GET /api/v1/vaults` - List all vaults
- `GET /api/v1/vaults/:contractId` - Get vault details
- `GET /api/v1/vaults/:contractId/operators` - List active operators
- `GET /api/v1/users/:address/yield-history` - User yield history
- `GET /api/v1/users/:address/deposits` - User deposits

### Admin Endpoints

Require `X-API-Key` header with admin key.

- `POST /api/v1/admin/indexer/replay` - Replay events for ledger range
- `GET /api/v1/admin/vaults/:contractId/audit` - Audit log
- `GET /api/v1/admin/events` - Indexed events

## Documentation

- [Webhook Documentation](docs/webhooks.md) - Webhook payload schemas and verification

## Architecture

```
backend/
├── src/
│   ├── config/           # Configuration
│   ├── database/         # Database pool and migrations
│   ├── indexer/          # Event indexer and RPC client
│   ├── middleware/       # Express middleware
│   ├── routes/           # API routes
│   ├── services/         # Business logic
│   ├── tasks/            # Background tasks
│   └── index.ts          # Main entry point
└── docs/                 # Documentation
```

## Database Schema

- `indexed_events` - Blockchain events
- `vaults` - Vault contracts and state
- `users` - User accounts
- `user_deposits` - Deposit records
- `yield_distributions` - Epoch yield data
- `yield_history` - Per-user yield records
- `vault_operators` - Operator assignments with expiry
- `audit_log` - Audit trail
- `webhook_subscriptions` - Webhook subscribers
- `indexer_state` - Indexer cursor

## License

See main repository license.
