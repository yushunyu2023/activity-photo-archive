import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!process.argv.includes("--yes")) {
  console.error("Refusing to delete local data without --yes.");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await rm(path.join(root, ".data"), { recursive: true, force: true });
console.log("Removed local-arweave/.data");
