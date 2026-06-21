import test from "node:test";
import assert from "node:assert/strict";
import { calculateParlayResult, createSavedParlay } from "../public/parlay-store.js";

test("mantiene el parlay pendiente mientras falte un resultado", () => {
  assert.equal(calculateParlayResult([{ result: "won" }, { result: "pending" }]), "pending");
});

test("marca perdido si cualquier selección pierde", () => {
  assert.equal(calculateParlayResult([{ result: "won" }, { result: "lost" }]), "lost");
  assert.equal(calculateParlayResult([{ result: "pending" }, { result: "lost" }]), "lost");
});

test("marca ganado cuando todas las selecciones activas ganan", () => {
  assert.equal(calculateParlayResult([{ result: "won" }, { result: "void" }]), "won");
});

test("crea un registro sin alterar el borrador original", () => {
  const draft = [{ id: "leg-1", selection: "Ejemplo" }];
  const saved = createSavedParlay("Prueba", draft, new Date("2026-06-20T12:00:00Z"));
  assert.equal(saved.name, "Prueba");
  assert.equal(saved.legs[0].result, "pending");
  assert.equal(draft[0].result, undefined);
});
