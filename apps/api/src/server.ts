import { buildApp } from "./app.js";
import { config } from "./config.js";

const app = await buildApp({ logger: { level: config.isProd ? "info" : "debug" } });
await app.listen({ port: config.port, host: config.host });
