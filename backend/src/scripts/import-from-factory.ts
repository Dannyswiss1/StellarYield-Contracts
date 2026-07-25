import "dotenv/config";
import { pool } from "../db/index.js";
import { logger } from "../logger.js";
import { readFactoryVaults, readVaultFields } from "../services/stellar.js";
import { VaultService } from "../services/vault.js";

interface Args {
  factoryId?: string;
}

function parseArgs(argv: string[]): Args {
  let factoryId: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--factoryId") {
      factoryId = argv[++i];
    }
  }

  return { factoryId };
}

/**
 * Backfills the vaults table from a factory's on-chain vault registry.
 * Intended for a fresh backend deployment against an existing factory, so
 * historical vaults don't have to wait for the indexer to catch up (#813).
 */
async function importFromFactory(factoryId: string): Promise<void> {
  const vaultService = new VaultService();

  logger.info({ factoryId }, "Fetching vault list from factory");
  const vaultAddresses = await readFactoryVaults(factoryId);
  logger.info({ factoryId, count: vaultAddresses.length }, "Retrieved vault addresses from factory");

  let imported = 0;
  let failed = 0;

  for (const contractId of vaultAddresses) {
    try {
      const fields = await readVaultFields(contractId);
      await vaultService.upsertVault({ contractId, factoryId, ...fields });
      imported++;
      logger.info({ contractId }, "Imported vault");
    } catch (err) {
      failed++;
      logger.error({ err, contractId }, "Failed to import vault");
    }
  }

  logger.info(
    { factoryId, total: vaultAddresses.length, imported, failed },
    "Factory import complete",
  );
}

const args = parseArgs(process.argv.slice(2));

if (!args.factoryId) {
  console.error("Usage: import-from-factory --factoryId <contractId>");
  process.exit(1);
}

try {
  await importFromFactory(args.factoryId);
  await pool.end();
  process.exit(0);
} catch (err) {
  logger.error(err, "Factory import failed");
  await pool.end();
  process.exit(1);
}
