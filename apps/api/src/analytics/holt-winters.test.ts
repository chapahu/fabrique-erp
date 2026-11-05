// TESTS AUTOMATIQUES de l'algorithme de prévision.
// Principe : on fabrique une série dont on CONNAÎT la réponse, et on vérifie que l'algorithme la retrouve.
// Commande : npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { holtWinters } from "./holt-winters";

const weekly = [0.75, 0.85, 0.95, 0.95, 1.1, 1.45, 1.15]; // lundi..dimanche
/** 20 semaines : niveau 1000 qui monte de 2/jour, avec le rythme de la semaine */
const series = Array.from({ length: 140 }, (_, t) => (1000 + 2 * t) * weekly[t % 7]);

test("retrouve une série parfaitement régulière (erreur < 2 %)", () => {
  const result = holtWinters(series, 7, 7);
  const expected = Array.from({ length: 7 }, (_, h) => (1000 + 2 * (140 + h)) * weekly[(140 + h) % 7]);
  result.forecast.forEach((f, h) => {
    const error = Math.abs(f.value - expected[h]) / expected[h];
    assert.ok(error < 0.02, `jour ${h + 1} : prévu ${f.value}, attendu ${expected[h].toFixed(1)}`);
  });
  assert.ok(result.mape !== null && result.mape < 2, `MAPE trop élevé : ${result.mape}`);
});

test("le samedi est prévu plus haut que le lundi", () => {
  const { forecast } = holtWinters(series, 7, 7);
  // 140 est un multiple de 7 : la prévision commence un "lundi" (index 0), le samedi est l'index 5
  assert.ok(forecast[5].value > forecast[0].value * 1.7);
});

test("la fourchette contient la prévision et s'élargit avec l'horizon", () => {
  const noisy = series.map((v, t) => v * (1 + 0.1 * Math.sin(t * 12.9898)));
  const { forecast } = holtWinters(noisy, 7, 14);
  for (const f of forecast) assert.ok(f.lower <= f.value && f.value <= f.upper);
  const width = (i: number) => forecast[i].upper - forecast[i].lower;
  assert.ok(width(13) > width(0));
});

test("refuse une série trop courte", () => {
  assert.throws(() => holtWinters([1, 2, 3], 7, 7), /2 saisons/);
});
