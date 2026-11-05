// =====================================================================
// PRÉVISION HOLT-WINTERS (lissage exponentiel triple)
//
// Idée : une série de ventes = NIVEAU × SAISONNALITÉ, + une TENDANCE qui fait évoluer le niveau.
//   - niveau (level)      : "en ce moment, on vend environ X par période"
//   - tendance (trend)    : "et ça augmente/diminue de Y par période"
//   - saisonnalité        : "le samedi c'est ×1,45 ; en décembre ×1,45"
// À chaque nouvelle observation, on met à jour ces 3 composantes en mélangeant
// "ce qu'on vient de voir" et "ce qu'on pensait avant", avec 3 curseurs entre 0 et 1 :
//   alpha (niveau), beta (tendance), gamma (saisonnalité).
//   Proche de 1 = réagit vite aux données récentes ; proche de 0 = privilégie l'historique.
// Les curseurs sont choisis AUTOMATIQUEMENT : on essaie de nombreuses combinaisons et on garde
// celle qui aurait le mieux prédit le passé (plus petite erreur).
//
// Variante utilisée : tendance ADDITIVE + saisonnalité MULTIPLICATIVE
// (l'effet "Noël" grossit quand l'entreprise grandit : c'est un pourcentage, pas un nombre fixe).
// =====================================================================

export type HoltWintersParams = { alpha: number; beta: number; gamma: number };

export type HoltWintersResult = {
  params: HoltWintersParams;
  fitted: number[]; // ce que le modèle aurait prédit pour chaque période passée
  forecast: { value: number; lower: number; upper: number }[];
  /** Erreur moyenne en % sur une période mise de côté (backtest), ou null si pas assez de données */
  mape: number | null;
  seasonalFactors: number[]; // derniers coefficients saisonniers (ex. 7 valeurs pour lundi..dimanche)
};

type State = { level: number; trend: number; seasonal: number[] };

/** Initialisation classique : niveau = moyenne de la 1re saison, tendance = écart moyen entre les 2 premières saisons. */
function initialState(y: number[], m: number): State {
  const seasons = Math.floor(y.length / m);
  const seasonMeans = Array.from({ length: seasons }, (_, s) => mean(y.slice(s * m, (s + 1) * m)));
  const level = seasonMeans[0];
  const trend = (seasonMeans[1] - seasonMeans[0]) / m;
  const seasonal = Array.from({ length: m }, (_, i) => {
    let sum = 0;
    for (let s = 0; s < seasons; s++) sum += y[s * m + i] / (seasonMeans[s] || 1);
    return sum / seasons;
  });
  return { level, trend, seasonal };
}

/** Fait tourner le modèle sur toute la série ; renvoie les valeurs "prédites à l'avance" et l'état final. */
function run(y: number[], m: number, { alpha, beta, gamma }: HoltWintersParams) {
  let { level, trend, seasonal } = initialState(y, m);
  seasonal = [...seasonal];
  const fitted: number[] = [];
  for (let t = 0; t < y.length; t++) {
    const s = seasonal[t % m];
    fitted.push((level + trend) * s); // prévision faite AVANT de voir y[t]
    const prevLevel = level;
    level = alpha * (y[t] / (s || 1)) + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
    seasonal[t % m] = gamma * (y[t] / (level || 1)) + (1 - gamma) * s;
  }
  return { fitted, state: { level, trend, seasonal }, n: y.length };
}

function sse(y: number[], fitted: number[], skip: number) {
  let total = 0;
  for (let t = skip; t < y.length; t++) total += (y[t] - fitted[t]) ** 2;
  return total;
}

/** Cherche les meilleurs curseurs alpha/beta/gamma (recherche par grille). */
export function optimizeParams(y: number[], m: number): HoltWintersParams {
  let best: HoltWintersParams = { alpha: 0.3, beta: 0.05, gamma: 0.2 };
  let bestError = Infinity;
  const grid = (from: number, to: number, step: number) => {
    const out: number[] = [];
    for (let v = from; v <= to + 1e-9; v += step) out.push(Number(v.toFixed(3)));
    return out;
  };
  for (const alpha of grid(0.05, 0.95, 0.05))
    for (const beta of grid(0, 0.3, 0.05))
      for (const gamma of grid(0.05, 0.95, 0.1)) {
        const { fitted } = run(y, m, { alpha, beta, gamma });
        const error = sse(y, fitted, m); // on ignore la 1re saison (servie à l'initialisation)
        if (error < bestError) {
          bestError = error;
          best = { alpha, beta, gamma };
        }
      }
  return best;
}

function project(state: State, n: number, m: number, horizon: number) {
  return Array.from({ length: horizon }, (_, h) => Math.max(0, (state.level + (h + 1) * state.trend) * state.seasonal[(n + h) % m]));
}

/**
 * Prévoit les `horizon` prochaines périodes d'une série avec une saisonnalité de longueur `m`
 * (7 pour des jours avec un rythme hebdomadaire, 12 pour des mois avec un rythme annuel).
 */
export function holtWinters(y: number[], m: number, horizon: number): HoltWintersResult {
  if (y.length < 2 * m) throw new Error(`Il faut au moins 2 saisons complètes (${2 * m} points), reçu ${y.length}`);

  // 1. Backtest : on cache la fin de l'historique, on prévoit, et on compare à la réalité
  let mape: number | null = null;
  const holdout = Math.min(horizon, m);
  if (y.length - holdout >= 2 * m) {
    const train = y.slice(0, -holdout);
    const p = optimizeParams(train, m);
    const r = run(train, m, p);
    const predicted = project(r.state, r.n, m, holdout);
    const actual = y.slice(-holdout);
    const errors = actual.map((a, i) => (a === 0 ? 0 : Math.abs(a - predicted[i]) / a));
    mape = Number(((100 * errors.reduce((s, e) => s + e, 0)) / errors.length).toFixed(1));
  }

  // 2. Modèle final sur tout l'historique
  const params = optimizeParams(y, m);
  const { fitted, state, n } = run(y, m, params);

  // 3. Intervalle de confiance : basé sur l'erreur typique du modèle sur le passé,
  //    qui s'élargit plus on regarde loin (on est moins sûr dans 4 semaines que demain).
  const residuals = y.slice(m).map((v, i) => v - fitted[i + m]);
  const sigma = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / Math.max(1, residuals.length - 3));
  const forecast = project(state, n, m, horizon).map((value, h) => {
    const width = 1.28 * sigma * Math.sqrt(1 + h * 0.15); // ~80 % de chances d'être dans la fourchette
    return { value: round(value), lower: round(Math.max(0, value - width)), upper: round(value + width) };
  });

  return { params, fitted: fitted.map(round), forecast, mape, seasonalFactors: state.seasonal.map((s) => Number(s.toFixed(3))) };
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
const round = (x: number) => Math.round(x * 10) / 10;
