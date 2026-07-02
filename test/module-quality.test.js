import test from "node:test";
import assert from "node:assert/strict";
import { resolveModuleQuality } from "../server/services/module-quality.service.js";

test("normaliza calidad alta, media, baja, parcial y no disponible", () => {
  assert.equal(resolveModuleQuality({ score: 85, status: "available" }).label, "Alta");
  assert.equal(resolveModuleQuality({ score: 70, status: "available" }).label, "Media");
  assert.equal(resolveModuleQuality({ score: 35, status: "available" }).label, "Baja");
  assert.equal(resolveModuleQuality({ score: 55, status: "partial" }).label, "Parcial");
  assert.equal(resolveModuleQuality({ score: 0, status: "not_available" }).label, "No disponible");
});

test("limita el score y elimina notas duplicadas", () => {
  const quality = resolveModuleQuality({ score: 140, status: "available", notes: ["Muestra", "Muestra"] });
  assert.equal(quality.score, 100);
  assert.deepEqual(quality.notes, ["Muestra"]);
});
