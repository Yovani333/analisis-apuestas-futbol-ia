import { AppError } from "../errors.js";

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Ruta no encontrada." } });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const appError = error instanceof AppError ? error : new AppError("Error interno del servidor.");
  if (!(error instanceof AppError)) console.error(error);
  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {})
    }
  });
}
