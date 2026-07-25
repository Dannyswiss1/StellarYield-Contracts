# Pull Request: Backend API Enhancements - CORS, SSE, and Error Codes

This PR implements several backend API improvements to enhance client experience, reduce unnecessary network calls, and provide better error handling.

## Issues Fixed

### #753: Add CORS_MAX_AGE env var for preflight caching ✅
- **Problem**: Browsers sent preflight OPTIONS requests before every cross-origin call without proper caching
- **Solution**: 
  - Added `CORS_MAX_AGE` environment variable (default: 600 seconds)
  - Updated CORS middleware to include `maxAge` option
  - Added configuration to `backend/src/config.ts` and `backend/.env.example`
- **Impact**: Reduces network overhead by allowing browsers to cache preflight responses

### #754: Add structured error codes to all API error responses ✅
- **Problem**: Clients couldn't programmatically distinguish between error types without parsing message strings
- **Solution**:
  - Created `ErrorCode` enum in `backend/src/api/middleware/errors.ts`
  - Added `AppError` class for structured error responses
  - Updated error handler to return `{ code, message, statusCode }` format
  - Updated vaults and users controllers to use new error codes
  - Created comprehensive error documentation in `backend/docs/errors.md`
- **Error Codes Implemented**:
  - `VAULT_NOT_FOUND` (404)
  - `USER_NOT_FOUND` (404)
  - `RPC_ERROR` (500)
  - `VALIDATION_ERROR` (400)
  - `UNAUTHORIZED` (401)
  - `RATE_LIMITED` (429)
  - `WEBHOOK_INVALID` (400)
  - `INTERNAL_SERVER_ERROR` (500)
- **Impact**: Enables robust client-side error handling and better UX

### #755: Add Server-Sent Events endpoint for live vault updates ✅
- **Problem**: Frontends polling for vault data created unnecessary load
- **Solution**:
  - Added EventEmitter to `VaultService` to emit vault update events
  - Implemented `GET /api/v1/vaults/:contractId/stream` endpoint
  - Returns `text/event-stream` with proper headers
  - Emits JSON vault data on every `upsertVault` call
  - Handles client disconnection cleanup
- **Impact**: Real-time vault updates with < 2 second latency, eliminates polling overhead

### #756: Add SSE endpoint for user position changes ✅
- **Problem**: Users needed real-time updates for their portfolio positions across vaults
- **Solution**:
  - Added EventEmitter to `UserService` for position updates
  - Created singleton `userServiceInstance` for shared event coordination
  - Updated indexer's `handleDeposit` and `handleWithdraw` to emit position events
  - Implemented `GET /api/v1/users/:address/stream` endpoint
  - Event payload: `{ type: "position_updated", vaultContractId, shares, deposited }`
- **Impact**: Real-time position updates within one indexer tick of blockchain events

## Technical Changes

### New Files
- `backend/docs/errors.md` - Error code documentation
- `backend/src/services/userSingleton.ts` - Shared UserService instance

### Modified Files
- `backend/src/api/middleware/errors.ts` - Added ErrorCode enum and AppError class
- `backend/src/api/controllers/vaults.ts` - Added streamVault handler, error codes
- `backend/src/api/controllers/users.ts` - Added streamUserPositions handler, error codes
- `backend/src/api/routes/vaults.ts` - Added /stream route
- `backend/src/api/routes/users.ts` - Added /stream route
- `backend/src/config.ts` - Added CORS_MAX_AGE configuration
- `backend/src/app.ts` - Updated CORS middleware with maxAge
- `backend/src/services/vault.ts` - Added EventEmitter support
- `backend/src/services/user.ts` - Added EventEmitter support
- `backend/src/services/indexer.ts` - Added position update event emission
- `backend/.env.example` - Added CORS_MAX_AGE example

## Verification

All TypeScript diagnostics pass:
```bash
# No compilation errors in modified files
✓ backend/src/api/middleware/errors.ts
✓ backend/src/api/controllers/vaults.ts
✓ backend/src/api/controllers/users.ts
✓ backend/src/config.ts
✓ backend/src/app.ts
✓ backend/src/services/vault.ts
✓ backend/src/services/user.ts
✓ backend/src/services/indexer.ts
```

## Testing Recommendations

### CORS_MAX_AGE
```bash
# Test with default value (600s)
curl -I -X OPTIONS http://localhost:3000/api/v1/vaults \
  -H "Origin: https://example.com"
# Should include: Access-Control-Max-Age: 600

# Test with custom value
CORS_MAX_AGE=3600 npm start
curl -I -X OPTIONS http://localhost:3000/api/v1/vaults \
  -H "Origin: https://example.com"
# Should include: Access-Control-Max-Age: 3600
```

### Structured Error Codes
```bash
# Test vault not found
curl http://localhost:3000/api/v1/vaults/CUNKNOWN_ID
# Should return: { "code": "VAULT_NOT_FOUND", "message": "Vault not found", "statusCode": 404 }
```

### SSE Endpoints
```bash
# Test vault stream
curl -N http://localhost:3000/api/v1/vaults/CAB.../stream

# Test user position stream
curl -N http://localhost:3000/api/v1/users/GABC.../stream
```

## Checklist
- [x] CORS preflight caching configured
- [x] Structured error codes implemented across all endpoints
- [x] SSE endpoint for vault updates with proper headers
- [x] SSE endpoint for user position changes
- [x] Error documentation created
- [x] Environment variable examples updated
- [x] All TypeScript diagnostics passing
- [x] Clean client disconnect handling for SSE connections
