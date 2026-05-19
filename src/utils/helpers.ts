import {
  Metric, MetricColor, Section, Goal, GoalStep, GoalTarget, GoalAttachedMetric,
  ColorRule, HealthResult, MetricType,
} from "../types";

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function resolveColor(metric: Metric): MetricColor {
  if (!metric.colorRules || metric.colorRules.length === 0) return "gray";
  const num = parseFloat(metric.value.replace(/[^0-9.\-]/g, ""));
  if (isNaN(num)) return "gray";
  for (const rule of metric.colorRules) {
    let match = false;
    if (rule.op === ">=" && num >= rule.value) match = true;
    if (rule.op === "<=" && num <= rule.value) match = true;
    if (rule.op === ">" && num > rule.value) match = true;
    if (rule.op === "<" && num < rule.value) match = true;
    if (rule.op === "==" && num === rule.value) match = true;
    if (rule.op === "!=" && num !== rule.value) match = true;
    if (rule.op === "between" && rule.value2 != null && num >= rule.value && num <= rule.value2) match = true;
    if (match) return rule.color;
  }
  return "gray";
}

export function getColorForValue(val: number, rules: ColorRule[]): MetricColor {
  if (!rules || rules.length === 0) return "gray";
  for (const rule of rules) {
    let match = false;
    if (rule.op === ">=" && val >= rule.value) match = true;
    if (rule.op === "<=" && val <= rule.value) match = true;
    if (rule.op === ">" && val > rule.value) match = true;
    if (rule.op === "<" && val < rule.value) match = true;
    if (rule.op === "==" && val === rule.value) match = true;
    if (rule.op === "!=" && val !== rule.value) match = true;
    if (rule.op === "between" && rule.value2 != null && val >= rule.value && val <= rule.value2) match = true;
    if (match) return rule.color;
  }
  return "gray";
}

export function findMetricByLabel(sections: Section[], sectionLabel: string, metricLabel: string): Metric | null {
  for (const s of sections) {
    if (s.title === sectionLabel) {
      const m = s.metrics.find(m => m.label === metricLabel);
      if (m) return m;
    }
  }
  for (const s of sections) { const m = s.metrics.find(m => m.label === metricLabel); if (m) return m; }
  return null;
}

export function computeMetricHealth(metric: Metric): number {
  if (!metric.colorRules?.length) return 0;
  const num = parseFloat(metric.value.replace(/[^0-9.\-]/g, ""));
  if (isNaN(num)) return 0;
  let greenThreshold: number | null = null;
  let redThreshold: number | null = null;
  for (const rule of metric.colorRules) {
    if (rule.color === "green" && (rule.op === ">=" || rule.op === ">")) greenThreshold = greenThreshold === null ? rule.value : Math.min(greenThreshold, rule.value);
    if (rule.color === "red" && (rule.op === "<=" || rule.op === "<")) redThreshold = redThreshold === null ? rule.value : Math.max(redThreshold, rule.value);
    if (rule.color === "green" && rule.op === "between") greenThreshold = greenThreshold === null ? rule.value : Math.min(greenThreshold, rule.value);
    if (rule.color === "red" && rule.op === "between") redThreshold = redThreshold === null ? (rule.value2 ?? rule.value) : Math.max(redThreshold, rule.value2 ?? rule.value);
  }
  if (greenThreshold !== null && redThreshold !== null && greenThreshold > redThreshold) {
    if (num >= greenThreshold) return 100;
    if (num <= redThreshold) return 0;
    return Math.round(((num - redThreshold) / (greenThreshold - redThreshold)) * 100);
  }
  if (greenThreshold !== null) {
    if (num >= greenThreshold) return 100;
    return Math.min(99, Math.round((num / greenThreshold) * 100));
  }
  if (redThreshold !== null) {
    if (num <= redThreshold) return 0;
    return 100;
  }
  const color = getColorForValue(num, metric.colorRules);
  if (color === "green") return 100;
  if (color === "yellow") return 50;
  return 0;
}

export function goalBarColor(pct: number): MetricColor {
  if (pct >= 80) return "green";
  if (pct >= 50) return "yellow";
  return "red";
}

export function evaluateGoalStep(step: GoalStep, sections: Section[]): boolean {
  const m = findMetricByLabel(sections, step.sectionLabel, step.metricLabel);
  if (!m) return false;
  const num = parseFloat(m.value.replace(/[^0-9.\-]/g, ""));
  if (isNaN(num)) return false;
  const t = step.target;
  if (t.type === "number_reach") {
    if (t.operator === ">=") return num >= (t.value ?? 0);
    if (t.operator === "<=") return num <= (t.value ?? 0);
    if (t.operator === ">") return num > (t.value ?? 0);
    if (t.operator === "<") return num < (t.value ?? 0);
    if (t.operator === "==") return num === (t.value ?? 0);
    if (t.operator === "!=") return num !== (t.value ?? 0);
    return false;
  }
  if (t.type === "number_range") return num >= (t.value ?? 0) && num <= (t.value2 ?? Infinity);
  if (t.type === "percentage") return computeMetricHealth(m) >= (t.percent ?? 100);
  if (t.type === "color_rule") return computeMetricHealth(m) >= 80;
  return false;
}

export function computeGoalProgress(goal: Goal, sections: Section[]): { pct: number; barColor: MetricColor } {
  if (goal.isManual) return { pct: Math.max(0, Math.min(100, goal.manualProgress)), barColor: goalBarColor(goal.manualProgress) };
  if (goal.type === "equation") {
    if (!goal.steps?.length) return { pct: 0, barColor: "red" };
    let met = 0;
    for (const step of goal.steps) { if (evaluateGoalStep(step, sections)) met++; }
    const pct = Math.round((met / goal.steps.length) * 100);
    return { pct, barColor: goalBarColor(pct) };
  }
  if (!goal.attachedMetrics?.length) return { pct: 0, barColor: "red" };
  const directMetric = goal.attachedMetrics.find(a => a.trackingMode === "direct");
  if (directMetric) {
    const m = findMetricByLabel(sections, directMetric.sectionLabel, directMetric.metricLabel);
    if (m) { const pct = computeMetricHealth(m); return { pct, barColor: goalBarColor(pct) }; }
    return { pct: 0, barColor: "red" };
  }
  let total = 0, count = 0;
  for (const att of goal.attachedMetrics) {
    if (att.trackingMode === "off") continue;
    const m = findMetricByLabel(sections, att.sectionLabel, att.metricLabel);
    if (!m) continue;
    total += computeMetricHealth(m); count++;
  }
  const pct = count === 0 ? 0 : Math.round(total / count);
  return { pct, barColor: goalBarColor(pct) };
}

export function makeGoal(partial?: Partial<Goal>): Goal {
  return {
    id: crypto.randomUUID(), label: "", type: "equation", subType: "counter",
    status: "drafted", due: "", steps: [], attachedMetrics: [],
    isManual: false, manualProgress: 0, manualNotes: [],
    pct: 0, barColor: "green",
    ...partial
  };
}

export function formatTarget(t: GoalTarget): string {
  if (t.type === "number_reach") return `${t.operator ?? "≥"} ${t.value ?? 0}`;
  if (t.type === "number_range") return `${t.value ?? 0} – ${t.value2 ?? "∞"}`;
  if (t.type === "percentage") return `≥ ${t.percent ?? 100}% health`;
  return "Color Rule";
}

export function calculateHealth(
  sections: Section[],
  greenMult: number,
  yellowMult: number,
  redMult: number
): HealthResult {
  const rulesBoxes = sections
    .flatMap(s => s.metrics)
    .filter(m => Array.isArray(m.colorRules) && m.colorRules.length > 0);

  const N = rulesBoxes.length;
  const counts = { green: 0, yellow: 0, red: 0, gray: 0 };

  if (N === 0) {
    return { score: 0, barColor: "green", hasData: false, counts };
  }

  const baseWeight = 100 / N;
  let total = 0;

  for (const metric of rulesBoxes) {
    const color = resolveColor(metric);
    counts[color]++;
    if (color === "green") total += baseWeight * greenMult;
    else if (color === "yellow") total += baseWeight * yellowMult;
    else if (color === "red") total += baseWeight * redMult;
  }

  const score = Math.max(0, Math.min(100, Math.round(total)));

  let barColor: "green" | "yellow" | "red";
  if (counts.red > 0) barColor = "red";
  else if (counts.yellow > 0) barColor = "yellow";
  else barColor = "green";

  return { score, barColor, hasData: true, counts };
}

export function formatValue(raw: string, mt: MetricType, currency = "$"): string {
  const stripped = raw.replace(/[^0-9.]/g, "");
  const num = parseFloat(stripped);
  if (isNaN(num)) return raw;
  if (mt === "financial") {
    return `${currency}${num.toLocaleString("en-US", { minimumFractionDigits: stripped.includes(".") ? 2 : 0, maximumFractionDigits: 2 })}`;
  }
  if (mt === "percentage") {
    return `${stripped}%`;
  }
  return stripped;
}
