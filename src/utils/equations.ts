import { Metric, MetricColor, MetricModalData, Section, FiveAccountSettings, EquationStep, EquationConfig, MetricType, StatRow, Transaction, ColorRule } from "../types";
import { MS, FIVE_ACCOUNT_ICONS, FIVE_DESC } from "./constants";
import { findMetricByLabel } from "./helpers";

// ─── String helpers ────────────────────────────────────────────────────────
export function applyAccessibilitySettings(headerSize: number, minBody: number, subheadingSize?: number) {
  document.documentElement.style.setProperty("--acc-min-fs", minBody + "px");
  document.documentElement.style.setProperty("--acc-header-scale", String(headerSize / 15));
  if (subheadingSize) document.documentElement.style.setProperty("--acc-subheading-fs", subheadingSize + "px");
}

// ─── MODAL DATA ──────────────────────────────────────────────────────────

export function makeModal(label: string, value: string, color: MetricColor, extra?: Partial<MetricModalData>): MetricModalData {
  return {
   type: "generic", title: label, color, healthPct: null, mainValue: value, syncTime: "",
    stats: [{ label: "Value", value }],
    projections: [], suggestions: [], nextActions: [], ...extra
  };
}

export function makeFiveAccountMetric(accountType: "overhead" | "profit" | "tax" | "investments" | "owner", parentId: string, isParent = false): Omit<Metric, "id"> {
  const label = accountType.charAt(0).toUpperCase() + accountType.slice(1);
  const modal = makeModal(label, "$0.00", "gray", {
    type: "cashflow", fiveAccountEnabled: true, accountType,
    stats: [{ label: "Balance", value: "$0.00", synced: true }],
    transactions: [], projections: [], suggestions: [], nextActions: [],
  });
  return {
    label, value: "$0.00",
    icon: FIVE_ACCOUNT_ICONS[label] ?? "Wallet",
    color: "gray", modal, metricType: "financial", graphType: "linear",
    colorRules: [], connectedApps: [], history: [],
    // Parent box has fiveAccountParentId pointing to itself so equation can always find it
    fiveAccountParentId: isParent ? undefined : parentId,
  };
}

export const INIT_SECTIONS: Section[] = [];

// ─── Five-Account equation ─────────────────────────────────────────────────
export function runFiveAccountEquation(
  metrics: Metric[],
  parentId: string,
  settings: FiveAccountSettings
): Metric[] {
  const parentMetric = metrics.find(m => m.id === parentId);
  if (!parentMetric) return metrics;

  const bankBalance = parseFloat(parentMetric.value.replace(/[^0-9.\-]/g, "")) || 0;
  const overheadRule = parentMetric.colorRules?.find(r => r.color === "green");
  const fallbackTarget = settings.monthlyExpenses > 0 ? settings.monthlyExpenses * 2 : 0;
  const overheadTarget = overheadRule && overheadRule.value > 0 ? overheadRule.value : fallbackTarget;

  if (overheadTarget <= 0) return metrics;

  const surplus = Math.max(0, bankBalance - overheadTarget);
  const overheadNewValue = surplus > 0 ? overheadTarget : bankBalance;
  const currency = parentMetric.currencySymbol ?? "$";
  const fmt = (n: number) => `${currency}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const now = Date.now();

  if (surplus <= 0) return metrics; 

  const taxInflow = surplus * 0.5;
  const remaining = surplus * 0.5;

  // Find the Profit and Investment boxes within this group
  const profitBox = metrics.find(m => m.fiveAccountParentId === parentId && m.label.toLowerCase() === "profit");
  const investmentBox = metrics.find(m => m.fiveAccountParentId === parentId && m.label.toLowerCase() === "investments");

  const currentProfitVal = parseFloat(profitBox?.value.replace(/[^0-9.\-]/g, "") || "0");
  const profitGreenRule = profitBox?.colorRules?.find(r => r.color === "green");
  
  // Logic: Use Green Rule threshold if it exists, otherwise fall back to 6 months expenses
  const profitGoal = profitGreenRule ? profitGreenRule.value : (settings.monthlyExpenses * 6);
  const isProfitFull = currentProfitVal >= profitGoal && profitGoal > 0;

  const profitInflow = isProfitFull ? 0 : remaining;
  const investmentsInflow = isProfitFull ? remaining : 0;

  const makeTxn = (inflow: number, fromLabel: string, isOverflow: boolean): Transaction => ({
    date: new Date(now).toLocaleDateString(),
    description: isOverflow ? `Overflow from Profit` : `Transfer from ${fromLabel}`,
    credit: inflow,
  });

  return metrics.map(m => {
    if (m.id === parentId) {
      return {
        ...m, value: fmt(overheadNewValue), lastSyncedAt: now,
        modal: { ...m.modal, mainValue: fmt(overheadNewValue) },
      };
    }

    if (m.fiveAccountParentId === parentId) {
      const lbl = m.label.toLowerCase();
      let inflow = 0;
      let overflowFlag = false;

      if (lbl === "tax") {
        inflow = taxInflow;
      } else if (lbl === "profit") {
        inflow = profitInflow;
      } else if (lbl === "investments") {
        inflow = investmentsInflow;
        overflowFlag = isProfitFull;
      }

      if (inflow > 0) {
        const currentVal = parseFloat(m.value.replace(/[^0-9.\-]/g, "")) || 0;
        const newVal = currentVal + inflow;
        return {
          ...m, value: fmt(newVal), lastSyncedAt: now,
          modal: {
            ...m.modal, mainValue: fmt(newVal),
            transactions: [...(m.modal.transactions ?? []), makeTxn(inflow, parentMetric.label, overflowFlag)],
          },
        };
      }
    }
    return m;
  });
}

// ─── Equation solver ───────────────────────────────────────────────────────
export function evaluateEquation(steps: EquationStep[], allMetrics: Metric[]): number | null {
  if (steps.length === 0) return null;

  // Handle parentheses: evaluate innermost groups first
  let depth = 0;
  let parenStart = -1;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.type === "operator" && s.operator === "paren-start") {
      if (depth === 0) parenStart = i;
      depth++;
    } else if (s.type === "operator" && s.operator === "paren-end") {
      depth--;
      if (depth === 0 && parenStart >= 0) {
        const innerSteps = steps.slice(parenStart + 1, i);
        const innerResult = evaluateEquation(innerSteps, allMetrics);
        if (innerResult === null) return null;
        const newSteps: EquationStep[] = [
          ...steps.slice(0, parenStart),
          { type: "number", numberValue: innerResult },
          ...steps.slice(i + 1),
        ];
        return evaluateEquation(newSteps, allMetrics);
      }
    }
  }

  if (steps.length === 1 && steps[0].type === "metric") {
    const m = allMetrics.find(mm => mm.id === steps[0].metricId);
    if (!m) return null;
    return parseFloat(m.value.replace(/[^0-9.\-]/g, "")) || 0;
  }
  if (steps.length === 1 && steps[0].type === "number") {
    return steps[0].numberValue ?? 0;
  }

  const resolved: (number | "+" | "-" | "*" | "/")[] = [];
  const lastIsValue = () => resolved.length > 0 && typeof resolved[resolved.length - 1] === "number";
  for (const step of steps) {
    if (step.type === "operator") {
      if (step.operator) {
        if (step.operator === "paren-start" || step.operator === "paren-end") continue;
        resolved.push(step.operator as "+" | "-" | "*" | "/");
      }
    } else if (step.type === "number") {
      if (lastIsValue()) resolved.push("*");
      resolved.push(step.numberValue ?? 0);
    } else {
      if (lastIsValue()) resolved.push("*");
      const m = allMetrics.find(mm => mm.id === step.metricId);
      const val = m ? parseFloat(m.value.replace(/[^0-9.\-]/g, "")) || 0 : 0;
      resolved.push(val);
    }
  }
  if (resolved.length === 0) return null;

  const evalSimple = (tokens: (number | "+" | "-" | "*" | "/")[]): number | null => {
    let arr = [...tokens];
    for (let pass = 0; pass < 2; pass++) {
      const ops = pass === 0 ? ["*", "/"] : ["+", "-"];
      let i = 1;
      while (i < arr.length - 1) {
        const op = arr[i];
        if (typeof op === "string" && ops.includes(op)) {
          const left = arr[i - 1];
          const right = arr[i + 1];
          if (typeof left !== "number" || typeof right !== "number") { i += 2; continue; }
          let result: number;
          if (op === "*") result = left * right;
          else if (op === "/") result = right === 0 ? 0 : left / right;
          else if (op === "+") result = left + right;
          else result = left - right;
          arr = [...arr.slice(0, i - 1), result, ...arr.slice(i + 2)] as any;
          i = 1;
        } else {
          i += 2;
        }
      }
    }
    return arr.length === 1 && typeof arr[0] === "number" ? arr[0] : null;
  };

  return evalSimple(resolved);
}

export function formatEquationResult(raw: number, steps: EquationStep[], allMetrics: Metric[]): string {
  // Find the first metric step to inherit its formatting
  const firstMetricStep = steps.find(s => s.type === "metric");
  if (!firstMetricStep) return String(Math.round(raw * 100) / 100);
  const srcMetric = allMetrics.find(m => m.id === firstMetricStep.metricId);
  if (!srcMetric) return String(Math.round(raw * 100) / 100);
  const mt = srcMetric.metricType ?? "counter";
  const currency = srcMetric.currencySymbol ?? "$";
  if (mt === "financial") {
    return `${currency}${raw.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (mt === "percentage") {
    return `${Math.round(raw)}%`;
  }
  return String(Math.round(raw * 100) / 100);
}

export function autoParenthesizeSteps(steps: EquationStep[]): { display: string; grouped: number[][] } {
  const displayParts: string[] = [];
  const grouped: number[][] = [];
  let currentGroup: number[] = [];
  let i = 1;
  for (let idx = 0; idx < steps.length; idx++) {
    const s = steps[idx];
    if (s.type === "operator") {
      if (s.operator === "paren-start") { displayParts.push("("); i++; continue; }
      if (s.operator === "paren-end") { displayParts.push(")"); i++; continue; }
      const needsParens = s.operator === "+" || s.operator === "-";
      if (needsParens && currentGroup.length > 0) {
        grouped.push(currentGroup);
        currentGroup = [];
      }
      if (s.operator === "*") displayParts.push("×");
      else if (s.operator === "/") displayParts.push("÷");
      else displayParts.push(s.operator ?? "+");
      i++;
    } else if (s.type === "number") {
      currentGroup.push(idx);
      displayParts.push(String(s.numberValue ?? 0));
      i++;
    } else {
      currentGroup.push(idx);
      displayParts.push(s.metricLabel ?? `?${i}`);
      i++;
    }
  }
  if (currentGroup.length > 0) grouped.push(currentGroup);
  return { display: displayParts.join(" "), grouped };
}

export function buildEquationPreviewString(steps: EquationStep[], allMetrics: Metric[]): string {
  const parts: string[] = [];
  for (const s of steps) {
    if (s.type === "operator") {
      if (s.operator === "*") parts.push("×");
      else if (s.operator === "/") parts.push("÷");
      else if (s.operator === "paren-start") parts.push("(");
      else if (s.operator === "paren-end") parts.push(")");
      else parts.push(s.operator ?? "+");
    } else if (s.type === "number") {
      parts.push(String(s.numberValue ?? 0));
    } else {
      const m = allMetrics.find(mm => mm.id === s.metricId);
      parts.push(m?.label ?? s.metricLabel ?? "?");
    }
  }
  return parts.join(" ");
}

// This forces the Green Rules to match your Settings menu automatically
export function syncSettingsToMetrics(sections: Section[], settings: FiveAccountSettings): Section[] {
  const overheadTarget = settings.monthlyExpenses * 2;
  const profitTarget = settings.monthlyExpenses * 6;

  return sections.map(section => ({
    ...section,
    metrics: section.metrics.map(metric => {
      let target = 0;
      if (metric.modal.accountType === "overhead") target = overheadTarget;
      else if (metric.modal.accountType === "profit") target = profitTarget;
      else return metric;

      const rules = metric.colorRules ?? [];
      const hasGreen = rules.some(r => r.color === "green");
      
      const updatedRules = hasGreen 
        ? rules.map(r => r.color === "green" ? { ...r, value: target, op: ">=" as const } : r)
        : [...rules, { id: Math.random().toString(), color: "green" as const, op: ">=" as const, value: target }];

      return { ...metric, colorRules: updatedRules };
    })
  }));
}
// ─── Sequential step numbering ─────────────────────────────────────────────
export function assignStepNumbers(steps: EquationStep[]): Map<number, number> {
  const result = new Map<number, number>();
  let counter = 1;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.type === "operator" && (s.operator === "paren-start" || s.operator === "paren-end")) continue;
    result.set(i, counter++);
  }
  return result;
}
