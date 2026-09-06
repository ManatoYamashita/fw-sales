import {
  buildAppEnv,
  getE2eDatabaseEnv,
  getE2eConfig,
  spawnPnpm,
} from "./e2e-local.mjs";

const e2eConfig = getE2eConfig();
const localEnv = getE2eDatabaseEnv();
const appEnv = buildAppEnv(localEnv, e2eConfig);
const child = spawnPnpm(
  ["exec", "next", "dev", "--hostname", "127.0.0.1", "--port", String(e2eConfig.port)],
  appEnv,
);

function forwardSignal(signal) {
  child.kill(signal);
}

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
