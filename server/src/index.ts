import { buildApp } from "./app";
import { openDatabase } from "./db/client";
import { env } from "./env";
import { startJobs } from "./jobs";

const handle = await openDatabase();
await handle.migrate();
const app = await buildApp(handle);

let stopJobs = () => {};
const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  stopJobs();
  await app.close();
  await handle.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: env.HOST, port: env.PORT });
stopJobs = startJobs(handle.db, app.log);
app.log.info(`API ready (${handle.driver}) on http://${env.HOST}:${env.PORT}/api/v1`);
