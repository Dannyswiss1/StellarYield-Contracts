import "dotenv/config";
import { randomBytes, createHash } from "crypto";
import { query } from "../db/index.js";

const plaintext = randomBytes(32).toString("hex");
const keyHash = createHash("sha256").update(plaintext).digest("hex");

await query(
  "INSERT INTO api_keys (key_hash, role, label) VALUES ($1, $2, $3)",
  [keyHash, "admin", `generated-${Date.now()}`],
);

console.log(plaintext);
process.exit(0);
