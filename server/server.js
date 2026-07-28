import { app } from "./app.js";
import { env, requireLiveConfiguration } from "./config/env.js";
import { startAutomaticEvidenceScheduler } from "./services/automatic-evidence.service.js";
import { flushBandwidthObservability, startBandwidthReportingScheduler } from "./services/bandwidth-reporting.service.js";

const host = process.env.HOST || "0.0.0.0";

const server = app.listen(env.port, host, () => {
  const missing = requireLiveConfiguration();
  console.log(`Servidor listo en http://${host}:${env.port}`);
  console.log(`Modo de datos: ${env.dataMode}`);
  if (env.dataMode === "live" && missing.length) console.warn(`Configuración pendiente: ${missing.join(", ")}`);
});
const stopAutomaticEvidenceScheduler = startAutomaticEvidenceScheduler();
const stopBandwidthReportingScheduler = startBandwidthReportingScheduler();

let shuttingDown = false;
let beforeExitFlushed = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopAutomaticEvidenceScheduler();
  stopBandwidthReportingScheduler();
  await flushBandwidthObservability({ force: true }).catch((error) => console.warn("[bandwidth] shutdown flush failed", { message: error.message }));
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("beforeExit", () => {
  if (beforeExitFlushed) return;
  beforeExitFlushed = true;
  flushBandwidthObservability({ force: true }).catch(() => {});
});
