import { assertDatabaseTarget, assertEnvironmentIsolation } from "../lib/environment-isolation.mjs";

try {
  const scope = process.argv.includes("--database-only")
    ? assertDatabaseTarget() : assertEnvironmentIsolation();
  console.log(`[environment] OK: ${scope}`);
} catch (error) {
  console.error(`[environment] FAIL: ${error.message}`);
  process.exitCode = 1;
}
