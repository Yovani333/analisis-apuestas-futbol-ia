import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { apiRouter } from "./routes/api.routes.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(rootDir, "public");
export const app = express();

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: { directives: { "script-src": ["'self'"], "style-src": ["'self'"], "img-src": ["'self'", "data:", "https://media.api-sports.io"] } } }));
app.use(express.json({ limit: "256kb" }));
app.use("/api", rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false }), apiRouter);
app.use(express.static(publicDir, {
  extensions: ["html"],
  maxAge: "1h",
  index: "index.html",
  setHeaders(response, filePath) {
    if (filePath.endsWith(".html")) response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  }
}));
app.use(notFoundHandler);
app.use(errorHandler);
