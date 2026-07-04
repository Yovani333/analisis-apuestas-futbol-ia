import test from "node:test";
import assert from "node:assert/strict";
import { findLowestOdds } from "../public/odds-monitor.js";

const rows = [{ bookmakers: [{ name: "Casa A", bets: [
  { name: "Ganador", values: [{ value: "Local", odd: "1.35" }, { value: "Visitante", odd: "6.5" }] },
  { name: "Doble oportunidad", values: [{ value: "1X", odd: "1.12" }, { value: "X2", odd: "2.9" }] }
] }] }];

test("identifica exactamente las dos cuotas válidas más bajas", () => {
  assert.deepEqual(findLowestOdds(rows), [
    { market: "Doble oportunidad", selection: "1X", bookmaker: "Casa A", odd: 1.12 },
    { market: "Ganador", selection: "Local", bookmaker: "Casa A", odd: 1.35 }
  ]);
});

test("ignora cuotas inválidas y no inventa resultados", () => {
  assert.deepEqual(findLowestOdds([{ bookmakers: [{ bets: [{ values: [{ odd: null }, { odd: 1 }] }] }] }]), []);
});
