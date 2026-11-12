import { openDatabase } from "../src/db/client";

const handle = await openDatabase();
await handle.migrate();
console.log(`Migrations applied (${handle.driver}).`);
await handle.close();
