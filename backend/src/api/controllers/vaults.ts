import type { Request, Response, NextFunction } from "express";
import { VaultService } from "../../services/vault.js";
import { readTotalAssets, readVaultState } from "../../services/stellar.js";
import { AppError, ErrorCode } from "../middleware/errors.js";

const vaultService = new VaultService();

function setCacheHeaders(res: Response): void {
  res.set("Cache-Control", "max-age=10, stale-while-revalidate=60");
}

export async function listVaults(req: Request, res: Response, next: NextFunction) {
  try {
    const {
      page,
      pageSize,
      state,
      sort,
      order,
    } = req.query as unknown as {
      page: number;
      pageSize: number;
      state?: string;
      sort: "created_at" | "total_assets";
      order: "asc" | "desc";
    };
    const result = await vaultService.listVaults({ page, pageSize, state, sort, order });
    setCacheHeaders(res);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getVaultCount(_req: Request, res: Response, next: NextFunction) {
  try {
    const total = await vaultService.countVaults();
    setCacheHeaders(res);
    res.json({ total });
  } catch (err) {
    next(err);
  }
}

export async function listVaultsByFactory(req: Request, res: Response, next: NextFunction) {
  try {
    const vaults = await vaultService.listVaultsByFactory(String(req.params["factoryId"]));
    setCacheHeaders(res);
    res.json(vaults);
  } catch (err) {
    next(err);
  }
}

export async function getVault(req: Request, res: Response, next: NextFunction) {
  try {
    const vault = await vaultService.getVault(String(req.params["contractId"]));
    if (!vault) {
      throw new AppError(ErrorCode.VAULT_NOT_FOUND, "Vault not found", 404);
    }
    setCacheHeaders(res);
    res.json(vault);
  } catch (err) {
    next(err);
  }
}

export async function getVaultLiveState(req: Request, res: Response, next: NextFunction) {
  try {
    const state = await readVaultState(String(req.params["contractId"]));
    res.json({ state });
  } catch (err) {
    next(new AppError(ErrorCode.RPC_ERROR, "Failed to read live vault state from chain", 500));
  }
}

export async function getVaultLiveTotalAssets(req: Request, res: Response, next: NextFunction) {
  try {
    const totalAssets = await readTotalAssets(String(req.params["contractId"]));
    res.json({ totalAssets: totalAssets.toString() });
  } catch (err) {
    next(new AppError(ErrorCode.RPC_ERROR, "Failed to read live total assets from chain", 500));
  }
}

export async function getVaultPositions(req: Request, res: Response, next: NextFunction) {
  try {
    const positions = await vaultService.getVaultPositions(String(req.params["contractId"]));
    res.json(positions);
  } catch (err) {
    next(err);
  }
}

export async function streamVault(req: Request, res: Response, next: NextFunction) {
  try {
    const contractId = String(req.params["contractId"]);
    
    // Verify vault exists
    const vault = await vaultService.getVault(contractId);
    if (!vault) {
      throw new AppError(ErrorCode.VAULT_NOT_FOUND, "Vault not found", 404);
    }

    // Set SSE headers
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    // Send initial vault data
    res.write(`data: ${JSON.stringify(vault)}\n\n`);

    // Listen for updates
    const unsubscribe = vaultService.onVaultUpdate(contractId, (updatedVault) => {
      res.write(`data: ${JSON.stringify(updatedVault)}\n\n`);
    });

    // Clean up on client disconnect
    req.on("close", () => {
      unsubscribe();
      res.end();
    });
  } catch (err) {
    next(err);
  }
}
