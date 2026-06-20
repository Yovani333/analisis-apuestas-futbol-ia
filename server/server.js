import { app } from "./app.js";
import { env, requireLiveConfiguration } from "./config/env.js";

const host = process.env.HOST || "0.0.0.0";

const server = app.listen(env.port, host, () => {
  const missing = requireLiveConfiguration();
  console.log(`Servidor listo en http://${host}:${env.port}`);
  console.log(`Modo de datos: ${env.dataMode}`);
  if (env.dataMode === "live" && missing.length) console.warn(`Configuración pendiente: ${missing.join(", ")}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
