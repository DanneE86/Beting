/** @deprecated Använd npm run sync eller npm run sync -- --only=opta */
import { main } from "./sync-all.js";

await main(["--only=opta"]);
