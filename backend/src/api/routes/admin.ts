import { Router } from "express";
import {
  getAdminStats,
  getAdminIndexer,
  getAdminEvents,
  getVaultAudit,
  backfillIndexer,
  deleteApiKey,
  getApiKeys,
  getWebhookDeliveries,
  getArchivedVaults,
  getTotalSupplyConsistency,
  getDbStats,
  getAdminFees,
  getAdminFeesDashboard,
  deleteUser,
  getAdminAuditLog,
  getJobStatus,
  getFailedJobs,
  flagUserAml,
  clearUserAml,
  getFlaggedUsers,
  getPositionsSnapshot,
  streamIndexerProgress,
} from "../controllers/admin.js";
import { requireApiKey } from "../middleware/auth.js";

export const adminRouter = Router();

adminRouter.use(requireApiKey({ minRole: "readonly" }));

adminRouter.get("/stats", getAdminStats);
adminRouter.get("/indexer", getAdminIndexer);
adminRouter.get("/indexer/stream", streamIndexerProgress);
adminRouter.post("/indexer/backfill", requireApiKey({ role: "admin" }), backfillIndexer);
adminRouter.get("/events", getAdminEvents);
adminRouter.get("/vaults/:contractId/audit", getVaultAudit);
adminRouter.get("/vaults/archived", getArchivedVaults);
adminRouter.get("/consistency/total-supply", getTotalSupplyConsistency);
adminRouter.get("/api-keys", getApiKeys);
adminRouter.delete("/api-keys/:id", requireApiKey({ role: "admin" }), deleteApiKey);
adminRouter.get("/webhooks/:id/deliveries", getWebhookDeliveries);
adminRouter.get("/db/stats", getDbStats);
adminRouter.get("/fees", getAdminFees);
adminRouter.get("/fees/dashboard", requireApiKey({ role: "admin" }), getAdminFeesDashboard);
adminRouter.delete("/users/:address", requireApiKey({ role: "admin" }), deleteUser);
adminRouter.get("/audit-log", requireApiKey({ role: "admin" }), getAdminAuditLog);

adminRouter.post("/users/:address/aml-flag", flagUserAml);
adminRouter.post("/users/:address/aml-clear", clearUserAml);
adminRouter.get("/compliance/flagged-users", getFlaggedUsers);
adminRouter.get("/compliance/positions-snapshot", getPositionsSnapshot);

adminRouter.get("/jobs/failed", getFailedJobs);
adminRouter.get("/jobs/:jobId", getJobStatus);
