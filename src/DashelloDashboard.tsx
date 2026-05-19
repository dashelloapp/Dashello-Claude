import { useState, useRef, useEffect, useLayoutEffect, useCallback, Fragment } from "react";
import { useSmartPosition } from "./hooks/useSmartPosition";
import { supabase } from "./lib/supabase";
import * as PhosphorReact from "@phosphor-icons/react";
import { PlaybooksPage } from "./PlaybooksPage";

// ── DB helpers ────────────────────────────────────────────────────────────
async function loadUserData(table: string, userId: string) {
  const { data } = await supabase.from(table).select("data").eq("user_id", userId).maybeSingle();
  return data?.data ?? null;
}
async function saveUserData(table: string, userId: string, payload: any) {
  const { data: existing } = await supabase.from(table).select("id").eq("user_id", userId).maybeSingle();
  if (existing) {
    await supabase.from(table).update({ data: payload, updated_at: new Date().toISOString() }).eq("user_id", userId);
  } else {
    await supabase.from(table).insert({ user_id: userId, data: payload });
  }
}
async function refreshMetricFromSupabase(userId: string, metricId: string, sections: Section[]): Promise<Section[]> {
  const { data } = await supabase.from("sections").select("data").eq("user_id", userId).maybeSingle();
  if (!data?.data) return sections;
  return data.data as Section[];
}

// ─── Org helpers ───────────────────────────────────────────────────────────
async function loadOrgData(userId: string) {
  const { data } = await supabase.from("organizations").select("data").eq("user_id", userId).maybeSingle();
  return data?.data ?? null;
}
async function saveOrgData(userId: string, payload: any) {
  const { data: existing } = await supabase.from("organizations").select("id").eq("user_id", userId).maybeSingle();
  if (existing) {
    await supabase.from("organizations").update({ data: payload, updated_at: new Date().toISOString() }).eq("user_id", userId);
  } else {
    await supabase.from("organizations").insert({ user_id: userId, data: payload });
  }
}
async function inviteTeamMember(email: string, orgId: string, level: OrgPermissionLevel, invitedByName: string, orgName?: string) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");
  try {
    const res = await supabase.functions.invoke("invite-member", {
      body: { email, orgId, level, invitedByName, orgName },
    });
    if (res.error) {
      let msg = res.error.message;
      try {
        const body = await res.error.context.json();
        if (body?.error) msg = body.error;
      } catch {}
      throw new Error(msg);
    }
    return res.data;
  } catch (err: any) {
    throw new Error(err.message || "Failed to reach the invite service. Make sure the edge function is deployed.");
  }
}

// ─── Permission helpers ──────────────────────────────────────────────────────
function filterSectionsByPermissions(sections: Section[], perms: TeamPermissions): Section[] {
  // Filter sections based on allowedSectionIds
  let filtered = perms.allowedSectionIds === null
    ? sections
    : sections.filter(s => perms.allowedSectionIds!.includes(s.id));
  // Filter metrics within each section based on metricOverrides
  if (perms.metricOverrides) {
    filtered = filtered.map(s => {
      const override = perms.metricOverrides!.find(m => m.sectionId === s.id);
      if (!override || override.allowedMetricIds === null) return s;
      return { ...s, metrics: s.metrics.filter(m => override!.allowedMetricIds!.includes(m.id)) };
    });
  }
  return filtered;
}

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

type MetricColor = "green" | "yellow" | "red" | "gray";
type Page = "home" | "goals" | "tasks" | "integrations" | "team" | "settings" | "app-detail" | "equation-builder" | "playbooks";
type GraphType = "bar-h" | "linear" | "pie" | "bar-v";
type MetricType = "counter" | "percentage" | "financial";
type RuleOp = ">=" | "<=" | ">" | "<" | "between" | "==" | "!=" ;
type GoalTargetType = "number_reach" | "number_range" | "percentage" | "color_rule";
type GoalType = "equation" | "metric";
type GoalSubType = "counter" | "financial" | "percentage";
type GoalStatus = "active" | "drafted" | "completed";
type GoalTrackingMode = "average" | "off" | "direct" | "health_over_time";
type FiveAccountMode = "one-business" | "business-and-personal" | "five-separate";
type OrgPermissionLevel = "owner" | "admin" | "editor" | "viewer";

interface Org {
  id: string;
  name: string;
  isPersonal: boolean;
  createdAt: string;
}
interface OrgMember {
  id: string;
  email: string;
  name: string;
  avatarUrl: string;
  level: OrgPermissionLevel;
  status: "invited" | "active";
  teamId?: string;
}
interface TeamRow {
  id: string;
  name: string;
  order: number;
}
interface TeamPermissions {
  teamId: string;
  allowedSectionIds: string[] | null;
  metricOverrides: { sectionId: string; allowedMetricIds: string[] | null }[] | null;
}

interface GoalTarget {
  type: GoalTargetType;
  operator?: RuleOp;
  value?: number;
  value2?: number;
  percent?: number;
}
interface GoalStep {
  sectionLabel: string;
  metricLabel: string;
  target: GoalTarget;
}
interface GoalAttachedMetric {
  sectionLabel: string;
  metricLabel: string;
  trackingMode: GoalTrackingMode;
}
interface GoalNote {
  text: string;
  timestamp: string;
}
interface Goal {
  id: string;
  label: string;
  type: GoalType;
  subType?: GoalSubType;
  status: GoalStatus;
  due: string;
  steps: GoalStep[];
  attachedMetrics: GoalAttachedMetric[];
  isManual: boolean;
  manualProgress: number;
  manualNotes: GoalNote[];
  pct: number;
  barColor: MetricColor;
  aiFilter?: string;
}

interface FiveAccountSettings {
  mode: FiveAccountMode;
  monthlyExpenses: number;
  ownerSalary: number;
  postTransactionEnabled: boolean;
}

interface PostTransactionPrompt {
  metricId: string;
  oldValue: number;
  newValue: number;
}

type ResetFrequency = "none" | "daily" | "weekly" | "monthly";
interface ColorRule {
  id: string;
  color: "red" | "yellow" | "green";
  op: RuleOp;
  value: number;
  value2?: number;
}

interface EquationStep {
  type: "metric" | "operator" | "number";
  metricId?: string;
  metricLabel?: string;
  metricIcon?: string;
  metricColor?: MetricColor;
  metricValue?: string;
  operator?: "+" | "-" | "*" | "/" | "paren-start" | "paren-end";
  metricType?: MetricType;
  currencySymbol?: string;
  healthPct?: number | null;
  stats?: StatRow[];
  connectedApps?: string[];
  numberValue?: number;
}
interface EquationConfig {
  steps: EquationStep[];
}
interface DataPoint { timestamp: number; value: number; }
interface Transaction { date: string; description: string; credit?: number; debit?: number; }
interface StatRow { label: string; value: string; synced?: boolean; }
interface ProjRow { label: string; sub: string; value: string; }
interface NextAction { label?: string; avatar?: string; }
interface Task {
  id: string;
  text: string;
  done: boolean;
  dueDate?: string;
  assignedTo: string;
  createdBy: string;
  linkedMetricId?: string;
  linkedGoalId?: string;
  createdAt: string;
  priority?: boolean;
}

interface MetricModalData {
  type: "cashflow" | "leads" | "emails" | "invoices" | "website" | "generic";
  title: string; color: MetricColor; healthPct: number | null;
  mainValue: string; syncTime: string;
  stats: StatRow[]; transactions?: Transaction[];
  projections: ProjRow[]; suggestions: string[]; nextActions: NextAction[];
  fiveAccountEnabled?: boolean;
  accountType?: "overhead" | "profit" | "tax" | "investments" | "owner";
}

interface Metric {
  id: string; label: string; value: string; icon: string; color: MetricColor;
  modal: MetricModalData;
  graphType?: GraphType; metricType?: MetricType;
  colorRules?: ColorRule[];
  connectedApps?: string[];
  history?: DataPoint[];
  fiveAccountParentId?: string;
  currencySymbol?: string;
  lastSyncedAt?: number;
  outOfSync?: boolean;
  outOfSyncReason?: string;
  resetFrequency?: ResetFrequency;
  resetKeepHistory?: boolean;
  lastResetAt?: number;
  equation?: EquationConfig;
  draftEquation?: EquationConfig;
}
interface Section { id: string; title: string; avatars: string[]; metrics: Metric[]; }

// ─── Traffic light ──────────────────────────────────────────────────────────
function resolveColor(metric: Metric): MetricColor {
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
function getColorForValue(val: number, rules: ColorRule[]): MetricColor {
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

// ─── Goal helpers ─────────────────────────────────────────────────────────
function findMetricByLabel(sections: Section[], sectionLabel: string, metricLabel: string): Metric | null {
  for (const s of sections) {
    if (s.title === sectionLabel) {
      const m = s.metrics.find(m => m.label === metricLabel);
      if (m) return m;
    }
  }
  for (const s of sections) { const m = s.metrics.find(m => m.label === metricLabel); if (m) return m; }
  return null;
}

function computeMetricHealth(metric: Metric): number {
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

function goalBarColor(pct: number): MetricColor {
  if (pct >= 80) return "green";
  if (pct >= 50) return "yellow";
  return "red";
}

function evaluateGoalStep(step: GoalStep, sections: Section[]): boolean {
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

function computeGoalProgress(goal: Goal, sections: Section[]): { pct: number; barColor: MetricColor } {
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

function makeGoal(partial?: Partial<Goal>): Goal {
  return {
    id: crypto.randomUUID(), label: "", type: "equation", subType: "counter",
    status: "drafted", due: "", steps: [], attachedMetrics: [],
    isManual: false, manualProgress: 0, manualNotes: [],
    pct: 0, barColor: "green",
    ...partial
  };
}

function formatTarget(t: GoalTarget): string {
  if (t.type === "number_reach") return `${t.operator ?? "≥"} ${t.value ?? 0}`;
  if (t.type === "number_range") return `${t.value ?? 0} – ${t.value2 ?? "∞"}`;
  if (t.type === "percentage") return `≥ ${t.percent ?? 100}% health`;
  return "Color Rule";
}

// ─── Five-Account equation ─────────────────────────────────────────────────
function runFiveAccountEquation(
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
function evaluateEquation(steps: EquationStep[], allMetrics: Metric[]): number | null {
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

function formatEquationResult(raw: number, steps: EquationStep[], allMetrics: Metric[]): string {
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

function autoParenthesizeSteps(steps: EquationStep[]): { display: string; grouped: number[][] } {
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

function buildEquationPreviewString(steps: EquationStep[], allMetrics: Metric[]): string {
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
function syncSettingsToMetrics(sections: Section[], settings: FiveAccountSettings): Section[] {
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
function assignStepNumbers(steps: EquationStep[]): Map<number, number> {
  const result = new Map<number, number>();
  let counter = 1;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.type === "operator" && (s.operator === "paren-start" || s.operator === "paren-end")) continue;
    result.set(i, counter++);
  }
  return result;
}
// ─── Health score calculation ──────────────────────────────────────────────
type HealthResult = {
  score: number;
  barColor: "green" | "yellow" | "red";
  hasData: boolean;
  counts: { green: number; yellow: number; red: number; gray: number };
};

function calculateHealth(
  sections: Section[],
  greenMult: number,
  yellowMult: number,
  redMult: number
): HealthResult {
  // Only boxes WITH color rules count toward health
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
    // gray (rule didn't match) contributes 0
  }

  const score = Math.max(0, Math.min(100, Math.round(total)));

  // Bar color: any red → red; else any yellow → yellow; else green
  let barColor: "green" | "yellow" | "red";
  if (counts.red > 0) barColor = "red";
  else if (counts.yellow > 0) barColor = "yellow";
  else barColor = "green";

  return { score, barColor, hasData: true, counts };
}

// ─── Value formatting ──────────────────────────────────────────────────────
function formatValue(raw: string, mt: MetricType, currency = "$"): string {
  const stripped = raw.replace(/[^0-9.]/g, "");
  const num = parseFloat(stripped);
  if (isNaN(num)) return raw;
  if (mt === "financial") {
    return `${currency}${num.toLocaleString("en-US", { minimumFractionDigits: stripped.includes(".") ? 2 : 0, maximumFractionDigits: 2 })}`;
  }
  if (mt === "percentage") {
    return `${stripped}%`;
  }
  return stripped; // counter — plain number
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const MS: Record<MetricColor, { bg: string; text: string }> = {
  green:  { bg: "#4CAF7D", text: "#fff" },
  yellow: { bg: "#F5A623", text: "#fff" },
  red:    { bg: "#E85D75", text: "#fff" },
  gray:   { bg: "#E8EDF2", text: "#4A5568" },
};

const FIVE_DESC: Record<string, string> = {
  overhead:    "2 months of operating expenses (incl. owner salary). Surplus flows downstream.",
  profit:      "Builds to a 6-month emergency fund. Once reached, surplus shifts to Investments.",
  tax:         "50% of every surplus inflow — always. Accumulates until a tax bill is paid.",
  investments: "Receives 50% of surplus once Profit emergency fund is fully funded.",
  owner:       "Monthly salary baked into Overhead target. Auto-set from Five-Account settings.",
};

const FIVE_EQUATION_POINTS = [
  "1. Overhead funded first (2 mo. expenses incl. owner salary). Surplus flows down.",
  "2. 50% of every surplus → Tax, always. Accumulates until paid.",
  "3. Pre-emergency fund: remaining 50% → Profit.",
  "4. Post-emergency fund (6 mo. reached): remaining 50% → Investments.",
  "5. Owner = monthly salary baked into Overhead. Auto-updated from settings.",
  "6. Any surplus after a tax bill is paid → Profit (if <6mo) or Investments.",
];

const FIVE_ACCOUNT_LABELS = ["Overhead", "Profit", "Tax", "Investments", "Owner"] as const;
const FIVE_ACCOUNT_ICONS: Record<string, string> = {
  Overhead: "CreditCard", Profit: "TrendUp", Tax: "Receipt",
  Investments: "Wallet", Owner: "UserCircle",
};
const DEFAULT_FIVE_ACCOUNT_SETTINGS: FiveAccountSettings = {
  mode: "business-and-personal",
  monthlyExpenses: 0,
  ownerSalary: 0,
  postTransactionEnabled: true,
};

const WORLD_CURRENCIES = [
  { symbol: "$", name: "US Dollar" }, { symbol: "€", name: "Euro" },
  { symbol: "£", name: "British Pound" }, { symbol: "¥", name: "Japanese Yen" },
  { symbol: "₹", name: "Indian Rupee" }, { symbol: "C$", name: "Canadian Dollar" },
  { symbol: "A$", name: "Australian Dollar" }, { symbol: "CHF", name: "Swiss Franc" },
  { symbol: "₩", name: "Korean Won" }, { symbol: "R$", name: "Brazilian Real" },
  { symbol: "MX$", name: "Mexican Peso" }, { symbol: "S$", name: "Singapore Dollar" },
  { symbol: "HK$", name: "Hong Kong Dollar" }, { symbol: "kr", name: "Swedish Krona" },
  { symbol: "NOK", name: "Norwegian Krone" }, { symbol: "DKK", name: "Danish Krone" },
  { symbol: "PLN", name: "Polish Zloty" }, { symbol: "CZK", name: "Czech Koruna" },
  { symbol: "₺", name: "Turkish Lira" }, { symbol: "₽", name: "Russian Ruble" },
  { symbol: "R", name: "South African Rand" }, { symbol: "AED", name: "UAE Dirham" },
  { symbol: "SAR", name: "Saudi Riyal" }, { symbol: "฿", name: "Thai Baht" },
  { symbol: "₫", name: "Vietnamese Dong" }, { symbol: "₦", name: "Nigerian Naira" },
  { symbol: "KES", name: "Kenyan Shilling" }, { symbol: "EGP", name: "Egyptian Pound" },
  { symbol: "ARS", name: "Argentine Peso" }, { symbol: "CLP", name: "Chilean Peso" },
];

// ═══════════════════════════════════════════════════════════════════════════
// PHOSPHOR ICONS
// ═══════════════════════════════════════════════════════════════════════════

const ICON_NONE = "";

const PHOSPHOR_CATEGORIES: { label: string; icons: string[] }[] = [
  {
    label: "Finance",
    icons: [
      "CreditCard","Wallet","Money","Coins","Bank","Receipt","Invoice","Cardholder",
      "CurrencyDollar","CurrencyEur","CurrencyGbp","CurrencyJpy","CurrencyKrw","CurrencyInr","CurrencyBtc",
      "PiggyBank","Vault","HandCoins","HandDeposit","HandWithdraw",
      "TrendUp","TrendDown","ChartLine","ChartBar","ChartPie","ChartDonut","Percent",
      "Calculator","Briefcase","Buildings","ShoppingCart","ShoppingBag","Storefront","Tag","Barcode",
    ]
  },
  {
    label: "Business",
    icons: [
      "Handshake","UsersThree","UserCircle","IdentificationCard","Suitcase","SuitcaseRolling",
      "Target","Trophy","Medal","MedalMilitary","Star","StarFour","Crown","CrownSimple","Rocket","Lightbulb",
      "Clipboard","ClipboardText","Files","FolderOpen","Folder","Archive","Bookmarks","BookmarkSimple",
      "Table","Rows","Columns","SquaresFour","GridFour","ListBullets","ListChecks","ListNumbers",
      "Notebook","Notepad","FileText","FilePdf","FileDoc","FileXls",
    ]
  },
  {
    label: "Communication",
    icons: [
      "Envelope","EnvelopeOpen","EnvelopeSimple","Phone","PhoneCall","PhoneIncoming","PhoneOutgoing",
      "ChatCircle","ChatCircleDots","ChatText","ChatTeardrop","Chats","ChatsCircle",
      "Megaphone","MegaphoneSimple","Bell","BellRinging","BellSimple","Broadcast","Rss","Share","ShareNetwork",
      "PaperPlaneTilt","At","Hash","Link","LinkSimple","Globe","GlobeHemisphereWest","GlobeHemisphereEast",
    ]
  },
  {
    label: "Analytics",
    icons: [
      "ChartLineUp","ChartLineDown","ChartDonut","ChartBarHorizontal","ChartScatter","ChartPolar",
      "ArrowUp","ArrowDown","ArrowRight","ArrowLeft","ArrowUUpRight","ArrowUUpLeft","ArrowsOut","ArrowsIn",
      "ArrowsClockwise","ArrowsCounterClockwise","ArrowsLeftRight","ArrowsDownUp","Pulse","Gauge",
      "Database","HardDrive","HardDrives","Cloud","CloudArrowUp","CloudArrowDown","CloudCheck","CloudX",
      "MagnifyingGlass","MagnifyingGlassPlus","MagnifyingGlassMinus","Funnel","FunnelSimple","SortAscending","SortDescending",
    ]
  },
  {
    label: "Status",
    icons: [
      "CheckCircle","XCircle","WarningCircle","Warning","Info","Question",
      "Check","CheckFat","CheckSquare","X","XSquare","Plus","PlusCircle","Minus","MinusCircle",
      "Lock","LockOpen","LockKey","Key","KeyReturn","Shield","ShieldCheck","ShieldWarning",
      "Fire","FireSimple","Snowflake","Lightning","LightningSlash","Timer","Clock","ClockCountdown","Calendar","CalendarBlank","CalendarCheck","Alarm",
    ]
  },
  {
    label: "People",
    icons: [
      "User","UserPlus","UserMinus","UserCheck","UserCircle","UserCirclePlus","UserCircleMinus","UserList","UserFocus",
      "Users","UsersFour","UsersThree","PersonSimple","PersonSimpleRun","PersonSimpleWalk","PersonArmsSpread",
      "Smiley","SmileyMeh","SmileySad","SmileyWink","SmileyAngry","SmileyNervous","SmileyXEyes",
      "Heart","HeartStraight","HandHeart","Heartbeat","FirstAid","FirstAidKit","Stethoscope","Pill",
      "Student","GraduationCap","Certificate","Scales","Gavel",
    ]
  },
  {
    label: "Tools",
    icons: [
      "Gear","GearSix","GearFine","Wrench","Hammer","Screwdriver","Nut","Toolbox",
      "Code","CodeSimple","CodeBlock","Terminal","TerminalWindow","Desktop","Laptop","DeviceMobile","DeviceTablet","Monitor","Printer",
      "Camera","CameraPlus","Image","ImageSquare","ImagesSquare","PencilSimple","PencilLine","Pen","PenNib","Eraser","Trash","TrashSimple","Copy","CopySimple",
      "MagicWand","PaintBrush","PaintBrushBroad","PaintBucket","Palette","Eyedropper",
    ]
  },
  {
    label: "Nature",
    icons: [
      "Sun","SunDim","SunHorizon","Moon","MoonStars","CloudSun","CloudMoon","CloudRain","CloudSnow","CloudLightning","CloudFog","Rainbow","RainbowCloud",
      "Tree","TreePalm","TreeEvergreen","Plant","Flower","FlowerLotus","FlowerTulip","Leaf","Cactus","Mountains","Waves","Drop","DropHalf","Fish","Bird","Butterfly","Dog","Cat","Cow","Horse","Rabbit",
    ]
  },
  {
    label: "Transit",
    icons: [
      "Car","CarSimple","CarProfile","Taxi","Truck","Van","Motorcycle","Bicycle","Scooter",
      "Bus","Train","TrainSimple","TrainRegional","Tram","Airplane","AirplaneTakeoff","AirplaneLanding","Rocket","Boat","Sailboat","RocketLaunch",
      "MapPin","MapTrifold","NavigationArrow","Compass","Path","MapTrifold","RoadHorizon","TrafficCone","TrafficSign","TrafficSignal",
    ]
  },
  {
    label: "Food",
    icons: [
      "ForkKnife","CookingPot","BowlFood","Bread","Coffee","Hamburger","Pizza","Popcorn","FishSimple",
      "BeerBottle","Wine","Knife","Cake","Cookie","OrangeSlice","Orange","IceCream","AppleLogo",
    ]
  },
  {
    label: "Health",
    icons: [
      "Hospital","Syringe","Thermometer","TestTube","Flask","Dna","MaskHappy","HandSoap",
      "HeartBreak","HeartHalf",
    ]
  },
];

const ALL_PHOSPHOR_ICONS = PHOSPHOR_CATEGORIES.flatMap(c => c.icons);
const DISPLAY_CATEGORIES = [{ label: "All", icons: ALL_PHOSPHOR_ICONS }, ...PHOSPHOR_CATEGORIES];

// Renders any Phosphor icon by name from the official @phosphor-icons/react package.
// Falls back to a circle if the name doesn't match a known icon.
function IconGlyph({ name, size = 20, color = "#3B82F6", weight = "regular" }: {
  name: string; size?: number; color?: string; weight?: "thin" | "light" | "regular" | "bold" | "fill" | "duotone";
}) {
  if (!name) return null;
  const IconComponent = (PhosphorReact as any)[name];
  if (!IconComponent) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block", flexShrink: 0 }}>
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" fill="none" />
      </svg>
    );
  }
  return <IconComponent size={size} color={color} weight={weight} style={{ display: "block", flexShrink: 0 }} />;
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL DATA
// ═══════════════════════════════════════════════════════════════════════════

function makeModal(label: string, value: string, color: MetricColor, extra?: Partial<MetricModalData>): MetricModalData {
  return {
   type: "generic", title: label, color, healthPct: null, mainValue: value, syncTime: "",
    stats: [{ label: "Value", value }],
    projections: [], suggestions: [], nextActions: [], ...extra
  };
}

function makeFiveAccountMetric(accountType: "overhead" | "profit" | "tax" | "investments" | "owner", parentId: string, isParent = false): Omit<Metric, "id"> {
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

const INIT_SECTIONS: Section[] = [];

// ═══════════════════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function Av({ initials, size = 30 }: { initials?: string; size?: number }) {
  const colors = ["#4C9FE8", "#7B68EE", "#48C78E", "#F5A623", "#E85D75"];
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: initials ? colors[initials.charCodeAt(0) % 5] : "#e2e8f0",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.36, fontWeight: 600, color: "#fff"
    }}>
      {initials ?? ""}
    </div>
  );
}

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div onClick={() => !disabled && onChange(!on)} style={{
      width: 44, height: 24, borderRadius: 99, cursor: disabled ? "not-allowed" : "pointer",
      background: on ? "#4CAF7D" : "#e2e8f0", position: "relative",
      transition: "background 0.2s", flexShrink: 0, opacity: disabled ? 0.5 : 1
    }}>
      <div style={{
        position: "absolute", top: 3, left: on ? 22 : 3,
        width: 18, height: 18, borderRadius: "50%",
        background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.2)", transition: "left 0.2s"
      }} />
    </div>
  );
}

function SectionCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#F8FAFC", borderRadius: 16, padding: 20, display: "flex", flexDirection: "column" }}>
      {title && <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2332", marginBottom: 16 }}>{title}</div>}
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ICON PICKER
// ═══════════════════════════════════════════════════════════════════════════

function IconPicker({ selected, onSelect }: { selected: string; onSelect: (icon: string) => void }) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState(0);

  const displayIcons = search.trim()
    ? ALL_PHOSPHOR_ICONS.filter(i => i.toLowerCase().includes(search.toLowerCase()))
    : DISPLAY_CATEGORIES[activeCategory]?.icons ?? [];

  return (
    <div>
      <div onClick={() => onSelect(ICON_NONE)} style={{
        display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px",
        borderRadius: 6, cursor: "pointer", marginBottom: 8,
        background: selected === ICON_NONE ? "#EFF6FF" : "#F8FAFC",
        border: selected === ICON_NONE ? "1.5px solid #3B82F6" : "1.5px solid #e2e8f0",
        fontSize: 12, color: "#64748b"
      }}>No icon</div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search icons..."
        style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none", marginBottom: 8, boxSizing: "border-box" }} />

      {!search && (
        <div style={{ display: "flex", gap: 4, overflowX: "auto", marginBottom: 8, paddingBottom: 2 }}>
          {DISPLAY_CATEGORIES.map((cat, i) => (
            <button key={i} onClick={() => setActiveCategory(i)} style={{
              padding: "3px 8px", borderRadius: 20, border: "none", cursor: "pointer", flexShrink: 0,
              background: activeCategory === i ? "#3B82F6" : "#f1f5f9",
              color: activeCategory === i ? "#fff" : "#64748b", fontSize: 10, fontWeight: 500
            }}>{cat.label}</button>
          ))}
        </div>
      )}

      <div style={{ height: 160, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 10, padding: 6 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 4 }}>
          {displayIcons.map(ic => (
            <div key={ic} onClick={() => onSelect(ic)} title={ic}
              style={{
                height: 36, borderRadius: 6, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", cursor: "pointer", gap: 2,
                background: selected === ic ? "#EFF6FF" : "#f8fafc",
                border: selected === ic ? "1.5px solid #3B82F6" : "1.5px solid #e2e8f0",
              }}>
              <IconGlyph name={ic} size={16} color={selected === ic ? "#3B82F6" : "#64748b"} />
            </div>
          ))}
        </div>
      </div>

      {selected && selected !== ICON_NONE && (
        <div style={{ marginTop: 6, fontSize: 12, color: "#64748b", display: "flex", alignItems: "center", gap: 6 }}>
          Selected: <IconGlyph name={selected} size={14} color="#3B82F6" />
          <span style={{ color: "#94a3b8" }}>{selected}</span>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSACTION TABLE
// ═══════════════════════════════════════════════════════════════════════════

function TxnTable({ transactions }: { transactions: Transaction[] }) {
  const fmt = (n?: number) => n != null ? n.toLocaleString("en-US", { minimumFractionDigits: 2 }) : "";
  const th: React.CSSProperties = { fontSize: 12, color: "#94a3b8", padding: "6px 8px", textAlign: "left", fontWeight: 500, borderBottom: "1px solid #f1f5f9" };
  const td: React.CSSProperties = { fontSize: 12, color: "#475569", padding: "6px 8px", borderBottom: "1px solid #f8fafc" };
  return (
    <div style={{ background: "#fff", borderRadius: "0 0 12px 12px", border: "1px solid #e2e8f0", borderTop: "none" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          <th style={{ ...th, width: "50%" }}>Transactions</th>
          <th style={{ ...th, textAlign: "right" }}>Credit</th>
          <th style={{ ...th, textAlign: "right" }}>Debit</th>
          <th style={{ ...th, textAlign: "right" }}>Balance</th>
        </tr></thead>
        <tbody>
          {transactions.length === 0
            ? <tr><td colSpan={4} style={{ ...td, color: "#cbd5e1", textAlign: "center", padding: 16 }}>No transactions yet</td></tr>
            : transactions.map((t, i) => <tr key={i}>
              <td style={td}>{t.date} – {t.description}</td>
              <td style={{ ...td, textAlign: "right" }}>{fmt(t.credit)}</td>
              <td style={{ ...td, textAlign: "right" }}>{fmt(t.debit)}</td>
              <td style={{ ...td, textAlign: "right", color: "#94a3b8" }}>—</td>
            </tr>)}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// BOTTOM THREE CARDS
// ═══════════════════════════════════════════════════════════════════════════

function BottomThreeCards({ data, metricId, tasks, setTasks, userEmail, orgMembers }: {
  data: MetricModalData; metricId?: string;
  tasks?: Task[]; setTasks?: React.Dispatch<React.SetStateAction<Task[]>>;
  userEmail?: string; orgMembers?: OrgMember[];
}) {
  const [showAddAction, setShowAddAction] = useState(false);
  const [actionText, setActionText] = useState("");
  const [actionAssignee, setActionAssignee] = useState(userEmail || "");
  const [actionDueDate, setActionDueDate] = useState("");
  const [menuTaskId, setMenuTaskId] = useState<string | null>(null);
  const [expandMetricActions, setExpandMetricActions] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerElRef = useRef<HTMLElement | null>(null);
  const [menuPos, setMenuPos] = useState<React.CSSProperties>({ position: "absolute", top: 24, right: 0, visibility: "hidden" });
  useLayoutEffect(() => {
    if (!menuTaskId || !menuRef.current || !menuTriggerElRef.current) return;
    const trigger = menuTriggerElRef.current;
    const triggerRect = trigger.getBoundingClientRect();
    const menuWidth = menuRef.current.offsetWidth || 150;
    const menuHeight = menuRef.current.offsetHeight || 200;
    let top = 24;
    let left: number | undefined;
    let rightVal: number | undefined;
    if (triggerRect.right - menuWidth < 8) { left = 0; } else { rightVal = 0; }
    if (triggerRect.top + 24 + menuHeight > window.innerHeight - 8) { top = -(menuHeight + 4); }
    setMenuPos({ position: "absolute", top, left, right: rightVal, visibility: "visible" });
  }, [menuTaskId]);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuTaskId(null); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  const linkedTasks = metricId && tasks ? tasks.filter(t => t.linkedMetricId === metricId && !t.done) : [];
  const handleAddAction = () => {
    if (!actionText.trim() || !setTasks || !userEmail) return;
    setTasks(prev => [...prev, {
      id: crypto.randomUUID(), text: actionText.trim(), done: false, assignedTo: actionAssignee || userEmail,
      createdBy: userEmail, linkedMetricId: metricId, createdAt: new Date().toISOString(),
      dueDate: actionDueDate || undefined,
    }]);
    setActionText("");
    setActionDueDate("");
  };
  const toggleLinked = (id: string) => {
    if (!setTasks) return;
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16 }}>
      <SectionCard>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#1a2332", marginBottom: 8 }}>Projections</div>
        <div style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic", marginBottom: 10 }}>Coming Soon</div>
        {[1, 2, 3].map(i => <div key={i} style={{ height: 8, borderRadius: 99, background: "#e2e8f0", marginBottom: 8, width: `${70 - i * 10}%`, opacity: 0.4 }} />)}
      </SectionCard>
      <SectionCard>
        <div style={{ display: "inline-block", background: "#3B82F6", color: "#fff", borderRadius: 99, padding: "5px 14px", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Suggestions</div>
        <div style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic", marginBottom: 10 }}>Coming Soon</div>
        {[1, 2, 3].map(i => <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, opacity: 0.4 }}>
          <div style={{ width: 20, height: 20, borderRadius: "50%", border: "1.5px solid #d1d5db", flexShrink: 0 }} />
          <div style={{ height: 7, borderRadius: 99, background: "#e2e8f0", flex: 1 }} />
        </div>)}
      </SectionCard>
      <div style={{ position: "relative" }}>
      <SectionCard>
        <div style={{ display: "inline-block", background: "#3B82F6", color: "#fff", borderRadius: 99, padding: "5px 14px", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Next Actions</div>
        {linkedTasks.length > 0 && <button onClick={() => setExpandMetricActions(true)}
          style={{ position: "absolute", bottom: 4, right: 4, width: 22, height: 22, borderRadius: 4, border: "none", background: "rgba(255,255,255,0.9)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#64748b", boxShadow: "0 1px 3px rgba(0,0,0,0.12)" }}
          title="View all next actions">⛶</button>}
        {linkedTasks.map(t => {
          const assigneeMember = (orgMembers || []).find(m => m.email === t.assignedTo);
          return (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, position: "relative" }}>
              <div onClick={() => toggleLinked(t.id)} style={{ width: 18, height: 18, borderRadius: "50%", flexShrink: 0, cursor: "pointer", border: t.done ? "none" : "1.5px solid #d1d5db", background: t.done ? "#4CAF7D" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 9 }}>{t.done ? "✓" : ""}</div>
              <span style={{ fontSize: 12, color: "#1a2332", flex: 1, textDecoration: t.done ? "line-through" : "none", minWidth: 0 }}>{t.text}</span>
              {assigneeMember ? (
                assigneeMember.avatarUrl
                  ? <img src={assigneeMember.avatarUrl} alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                  : <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#94a3b8", flexShrink: 0 }}>
                      {(assigneeMember.name?.[0] || assigneeMember.email[0] || "?").toUpperCase()}
                    </div>
              ) : null}
              <div onClick={(e) => { menuTriggerElRef.current = e.currentTarget as HTMLElement; setMenuTaskId(menuTaskId === t.id ? null : t.id); }} style={{ width: 22, height: 22, borderRadius: "50%", background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 9, color: "#94a3b8", flexShrink: 0 }}>···</div>
              {menuTaskId === t.id && (
                <div ref={menuRef} style={{ ...menuPos, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid #e2e8f0", zIndex: 100, minWidth: 150, overflow: "hidden" }}>
                  <div style={{ padding: "7px 12px", fontSize: 11, fontWeight: 600, color: "#64748b", borderBottom: "1px solid #f1f5f9" }}>Assign To</div>
                  {(orgMembers || []).filter(m => m.status === "active").map(m => (
                    <div key={m.id} onClick={() => { setTasks?.(prev => prev.map(x => x.id === t.id ? { ...x, assignedTo: m.email } : x)); setMenuTaskId(null); }}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", cursor: "pointer", background: t.assignedTo === m.email ? "#EFF6FF" : "transparent", fontSize: 11, color: "#1a2332" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                      onMouseLeave={e => e.currentTarget.style.background = t.assignedTo === m.email ? "#EFF6FF" : "transparent"}>
                      {m.avatarUrl ? <img src={m.avatarUrl} alt="" style={{ width: 18, height: 18, borderRadius: "50%", objectFit: "cover" }} />
                        : <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, fontWeight: 700, color: "#94a3b8" }}>{(m.name?.[0] || m.email[0] || "?").toUpperCase()}</div>}
                      <span style={{ flex: 1 }}>{m.name || m.email.split("@")[0]}</span>
                      {t.assignedTo === m.email && <span style={{ fontSize: 10, color: "#3B82F6" }}>✓</span>}
                    </div>
                  ))}
                  <div style={{ borderTop: "1px solid #f1f5f9" }}>
                    <div style={{ padding: "7px 12px", fontSize: 11, fontWeight: 600, color: "#64748b" }}>Due Date</div>
                    <div style={{ padding: "0 12px 7px" }}>
                      <input type="date" value={t.dueDate || ""} onChange={e => { setTasks?.(prev => prev.map(x => x.id === t.id ? { ...x, dueDate: e.target.value || undefined } : x)); setMenuTaskId(null); }}
                        style={{ width: "100%", padding: "4px 6px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 11, outline: "none", boxSizing: "border-box" }} />
                    </div>
                  </div>
                  <div onClick={() => { setTasks?.(prev => prev.filter(x => x.id !== t.id)); setMenuTaskId(null); }}
                    style={{ padding: "8px 12px", fontSize: 11, cursor: "pointer", color: "#E85D75", borderTop: "1px solid #f1f5f9" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#fff5f5"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>Delete</div>
                </div>
              )}
            </div>
          );
        })}
        {showAddAction ? (
          <div style={{ marginTop: 8 }}>
            <input value={actionText} onChange={e => setActionText(e.target.value)} placeholder="New action..."
              onKeyDown={e => { if (e.key === "Enter") handleAddAction(); }}
              style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none", boxSizing: "border-box", marginBottom: 6 }} />
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <select value={actionAssignee} onChange={e => setActionAssignee(e.target.value)}
                style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 11, outline: "none", background: "#fff" }}>
                <option value={userEmail}>Me</option>
                {(orgMembers || []).filter(m => m.status === "active" && m.email !== userEmail).map(m => (
                  <option key={m.id} value={m.email}>{m.name || m.email.split("@")[0]}</option>
                ))}
              </select>
              <input type="date" value={actionDueDate} onChange={e => setActionDueDate(e.target.value)}
                style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 11, outline: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={handleAddAction} disabled={!actionText.trim()}
                style={{ flex: 1, padding: "5px 14px", borderRadius: 6, border: "none", background: actionText.trim() ? "#3B82F6" : "#e2e8f0", color: "#fff", fontSize: 11, fontWeight: 600, cursor: actionText.trim() ? "pointer" : "not-allowed" }}>Add</button>
              <button onClick={() => setShowAddAction(false)} style={{ flex: 1, padding: "5px 14px", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 11, cursor: "pointer", color: "#64748b" }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div onClick={() => setShowAddAction(true)} style={{ fontSize: 12, color: "#3B82F6", cursor: "pointer", fontWeight: 600, marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 14 }}>+</span> Add Task
          </div>
        )}
        {linkedTasks.length === 0 && !showAddAction && <div style={{ fontSize: 12, color: "#cbd5e1", fontStyle: "italic" }}>No actions yet</div>}
      </SectionCard>
      </div>
      {expandMetricActions && (
        <div onClick={() => setExpandMetricActions(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: "90vw", maxWidth: 600, maxHeight: "90vh", overflow: "auto", position: "relative" }}>
            <button onClick={() => setExpandMetricActions(false)}
              style={{ position: "absolute", top: 12, right: 16, width: 28, height: 28, borderRadius: "50%", border: "none", background: "#f1f5f9", cursor: "pointer", fontSize: 16, color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332", marginBottom: 20 }}>Next Actions</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {linkedTasks.map(t => {
                const assigneeMember = (orgMembers || []).find(m => m.email === t.assignedTo);
                return (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: "#fff", border: "1px solid #f1f5f9", position: "relative" }}>
                    <div onClick={() => { if (setTasks) setTasks(prev => prev.map(x => x.id === t.id ? { ...x, done: !x.done } : x)); }} style={{ width: 18, height: 18, borderRadius: "50%", flexShrink: 0, cursor: "pointer", border: t.done ? "none" : "1.5px solid #d1d5db", background: t.done ? "#4CAF7D" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 9 }}>{t.done ? "✓" : ""}</div>
                    <span style={{ fontSize: 13, color: "#1a2332", flex: 1, minWidth: 0 }}>{t.text}</span>
                    {assigneeMember && (
                      assigneeMember.avatarUrl
                        ? <img src={assigneeMember.avatarUrl} alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                        : <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#94a3b8", flexShrink: 0 }}>
                            {(assigneeMember.name?.[0] || assigneeMember.email[0] || "?").toUpperCase()}
                          </div>
                    )}
                    <div onClick={(e) => { menuTriggerElRef.current = e.currentTarget as HTMLElement; setMenuTaskId(menuTaskId === t.id ? null : t.id); }} style={{ width: 22, height: 22, borderRadius: "50%", background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 9, color: "#94a3b8", flexShrink: 0 }}>···</div>
                    {menuTaskId === t.id && (
                      <div ref={menuRef} style={{ ...menuPos, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid #e2e8f0", zIndex: 100, minWidth: 150, overflow: "hidden" }}>
                        <div style={{ padding: "7px 12px", fontSize: 11, fontWeight: 600, color: "#64748b", borderBottom: "1px solid #f1f5f9" }}>Assign To</div>
                        {(orgMembers || []).filter(m => m.status === "active").map(m => (
                          <div key={m.id} onClick={() => { setTasks?.(prev => prev.map(x => x.id === t.id ? { ...x, assignedTo: m.email } : x)); setMenuTaskId(null); }}
                            style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", cursor: "pointer", background: t.assignedTo === m.email ? "#EFF6FF" : "transparent", fontSize: 11, color: "#1a2332" }}
                            onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                            onMouseLeave={e => e.currentTarget.style.background = t.assignedTo === m.email ? "#EFF6FF" : "transparent"}>
                            {m.avatarUrl ? <img src={m.avatarUrl} alt="" style={{ width: 18, height: 18, borderRadius: "50%", objectFit: "cover" }} />
                              : <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, fontWeight: 700, color: "#94a3b8" }}>{(m.name?.[0] || m.email[0] || "?").toUpperCase()}</div>}
                            <span style={{ flex: 1 }}>{m.name || m.email.split("@")[0]}</span>
                            {t.assignedTo === m.email && <span style={{ fontSize: 10, color: "#3B82F6" }}>✓</span>}
                          </div>
                        ))}
                        <div style={{ borderTop: "1px solid #f1f5f9" }}>
                          <div style={{ padding: "7px 12px", fontSize: 11, fontWeight: 600, color: "#64748b" }}>Due Date</div>
                          <div style={{ padding: "0 12px 7px" }}>
                            <input type="date" value={t.dueDate || ""} onChange={e => { setTasks?.(prev => prev.map(x => x.id === t.id ? { ...x, dueDate: e.target.value || undefined } : x)); setMenuTaskId(null); }}
                              style={{ width: "100%", padding: "4px 6px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 11, outline: "none", boxSizing: "border-box" }} />
                          </div>
                        </div>
                        <div onClick={() => { setTasks?.(prev => prev.filter(x => x.id !== t.id)); setMenuTaskId(null); }}
                          style={{ padding: "8px 12px", fontSize: 11, cursor: "pointer", color: "#E85D75", borderTop: "1px solid #f1f5f9" }}
                          onMouseEnter={e => e.currentTarget.style.background = "#fff5f5"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>Delete</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {showAddAction ? (
              <div style={{ marginTop: 12 }}>
                <input value={actionText} onChange={e => setActionText(e.target.value)} placeholder="New action..."
                  onKeyDown={e => { if (e.key === "Enter") handleAddAction(); }}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none", boxSizing: "border-box", marginBottom: 6 }} />
                <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  <select value={actionAssignee} onChange={e => setActionAssignee(e.target.value)}
                    style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 11, outline: "none", background: "#fff" }}>
                    <option value={userEmail}>Me</option>
                    {(orgMembers || []).filter(m => m.status === "active" && m.email !== userEmail).map(m => (
                      <option key={m.id} value={m.email}>{m.name || m.email.split("@")[0]}</option>
                    ))}
                  </select>
                  <input type="date" value={actionDueDate} onChange={e => setActionDueDate(e.target.value)}
                    style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 11, outline: "none", boxSizing: "border-box" }} />
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={handleAddAction} disabled={!actionText.trim()}
                    style={{ flex: 1, padding: "5px 14px", borderRadius: 6, border: "none", background: actionText.trim() ? "#3B82F6" : "#e2e8f0", color: "#fff", fontSize: 11, fontWeight: 600, cursor: actionText.trim() ? "pointer" : "not-allowed" }}>Add</button>
                  <button onClick={() => setShowAddAction(false)} style={{ flex: 1, padding: "5px 14px", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 11, cursor: "pointer", color: "#64748b" }}>Cancel</button>
                </div>
              </div>
            ) : (
              <div onClick={() => setShowAddAction(true)} style={{ fontSize: 12, color: "#3B82F6", cursor: "pointer", fontWeight: 600, marginTop: 12, display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 14 }}>+</span> Add Task
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CHART
// ═══════════════════════════════════════════════════════════════════════════

function MetricChart({ history, rules, graphType, currentValue }: {
  history: DataPoint[]; rules: ColorRule[]; graphType: GraphType; currentValue: string;
}) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; val: number; color: MetricColor } | null>(null);

  // Insufficient data state — need at least 5 historic data points
  if (!history || history.length < 5) {
    const needed = 5 - (history?.length ?? 0);
    return (
      <div style={{
        height: 150, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        background: "#F8FAFC", border: "1.5px dashed #e2e8f0", borderRadius: 10, padding: 12, gap: 6
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>Insufficient Data</div>
        <div style={{ fontSize: 11, color: "#cbd5e1", textAlign: "center", lineHeight: 1.4 }}>
          {needed} more data point{needed === 1 ? "" : "s"} needed<br/>
          <span style={{ fontSize: 10 }}>({history?.length ?? 0} of 5 recorded)</span>
        </div>
      </div>
    );
  }

  const points: DataPoint[] = history;
  const vals = points.map(p => p.value);
  const allRuleVals = rules.flatMap(r => r.op === "between" && r.value2 != null ? [r.value, r.value2] : [r.value]);
  const yMin = Math.min(...vals, ...allRuleVals) * 0.85;
  const yMax = Math.max(...vals, ...allRuleVals) * 1.15 || 100;
  const W = 300, H = 150, padL = 36, padR = 8, padT = 8, padB = 24;
  const cw = W - padL - padR, ch = H - padT - padB;
  const xS = (i: number) => padL + (i / Math.max(points.length - 1, 1)) * cw;
  const yS = (v: number) => padT + ch - ((v - yMin) / (yMax - yMin || 1)) * ch;
  const noRules = !rules || rules.length === 0;
  const colorOf = (v: number) => noRules ? "#3B82F6" : MS[getColorForValue(v, rules)].bg;

  if (graphType === "pie") {
    const defaultPieColors = ["#3B82F6", "#60A5FA", "#93C5FD", "#BFDBFE", "#DBEAFE", "#1E40AF", "#2563EB", "#94A3B8"];
    const cx = 70, cy = 70, r = 55;
    let angle = -Math.PI / 2;
    if (noRules) {
      const sliceCount = Math.min(points.length, defaultPieColors.length);
      const pct = 1 / sliceCount;
      const slices = Array.from({ length: sliceCount }, (_, i) => ({
        color: defaultPieColors[i], pct, label: `#${i + 1}`
      }));
      return (
        <svg viewBox="0 0 200 140" style={{ width: "100%", height: 140 }}>
          {slices.map((s, i) => {
            const a = s.pct * 2 * Math.PI;
            const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
            const x2 = cx + r * Math.cos(angle + a), y2 = cy + r * Math.sin(angle + a);
            const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${a > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`;
            angle += a;
            return <path key={i} d={d} fill={s.color} stroke="#fff" strokeWidth={1.5} />;
          })}
          {slices.map((s, i) => (
            <g key={i}>
              <rect x={135} y={18 + i * 22} width={10} height={10} rx={2} fill={s.color} />
              <text x={149} y={28 + i * 22} fontSize={9} fill="#64748b">Point {Math.round(s.pct * 100)}%</text>
            </g>
          ))}
        </svg>
      );
    }
    const counts: Record<MetricColor, number> = { red: 0, yellow: 0, green: 0, gray: 0 };
    points.forEach(p => counts[getColorForValue(p.value, rules)]++);
    const total = points.length;
    const slices = (["green", "yellow", "red", "gray"] as MetricColor[])
      .map(c => ({ color: c, pct: counts[c] / total })).filter(s => s.pct > 0);
    return (
      <svg viewBox="0 0 200 140" style={{ width: "100%", height: 140 }}>
        {slices.map((s, i) => {
          const a = s.pct * 2 * Math.PI;
          const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
          const x2 = cx + r * Math.cos(angle + a), y2 = cy + r * Math.sin(angle + a);
          const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${a > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`;
          angle += a;
          const sliceFill = s.color === "gray" ? "#64748B" : MS[s.color].bg;
          return <path key={i} d={d} fill={sliceFill} stroke="#fff" strokeWidth={1.5} />;
        })}
        {slices.map((s, i) => {
          const legendFill = s.color === "gray" ? "#64748B" : MS[s.color].bg;
          return (
            <g key={i}>
              <rect x={135} y={18 + i * 22} width={10} height={10} rx={2} fill={legendFill} />
              <text x={149} y={28 + i * 22} fontSize={9} fill="#64748b">{s.color} {Math.round(s.pct * 100)}%</text>
            </g>
          );
        })}
      </svg>
    );
  }

  if (graphType === "bar-v") {
    const bw = Math.max(4, cw / points.length - 4);
    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }}>
        {[0, .25, .5, .75, 1].map(t => <line key={t} x1={padL} x2={W - padR} y1={padT + ch * (1 - t)} y2={padT + ch * (1 - t)} stroke="#f1f5f9" strokeWidth={1} />)}
        {points.map((p, i) => {
          const x = padL + (i / points.length) * cw + 2;
          const top = yS(p.value), ht = yS(yMin) - top;
          return <rect key={i} x={x} y={top} width={bw} height={ht} fill={colorOf(p.value)} rx={3}
            onMouseEnter={() => setTooltip({ x: x + bw / 2, y: top - 6, val: p.value, color: getColorForValue(p.value, rules) })}
            onMouseLeave={() => setTooltip(null)} style={{ cursor: "pointer" }} />;
        })}
        {tooltip && <><rect x={tooltip.x - 22} y={tooltip.y - 16} width={44} height={16} rx={4} fill={MS[tooltip.color].bg} />
          <text x={tooltip.x} y={tooltip.y - 4} textAnchor="middle" fontSize={9} fill="#fff" fontWeight="600">{tooltip.val.toFixed(1)}</text></>}
      </svg>
    );
  }

  if (graphType === "bar-h") {
    const bh = Math.max(6, ch / points.length - 4);
    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }}>
        {points.map((p, i) => {
          const y = padT + (i / points.length) * ch + 2;
          const bw2 = ((p.value - yMin) / (yMax - yMin || 1)) * cw;
          return <rect key={i} x={padL} y={y} width={bw2} height={bh} fill={colorOf(p.value)} rx={3}
            onMouseEnter={() => setTooltip({ x: padL + bw2 + 4, y: y + bh / 2, val: p.value, color: getColorForValue(p.value, rules) })}
            onMouseLeave={() => setTooltip(null)} style={{ cursor: "pointer" }} />;
        })}
        {tooltip && <><rect x={tooltip.x} y={tooltip.y - 8} width={44} height={16} rx={4} fill={MS[tooltip.color].bg} />
          <text x={tooltip.x + 22} y={tooltip.y + 4} textAnchor="middle" fontSize={9} fill="#fff" fontWeight="600">{tooltip.val.toFixed(1)}</text></>}
      </svg>
    );
  }

  // Linear
  const pathD = points.map((p, i) => {
    const x = xS(i), y = yS(p.value);
    if (i === 0) return `M ${x} ${y}`;
    const px = xS(i - 1), py = yS(points[i - 1].value), cx2 = (px + x) / 2;
    return ` C ${cx2} ${py} ${cx2} ${y} ${x} ${y}`;
  }).join("");
  const areaD = pathD + ` L ${xS(points.length - 1)} ${yS(yMin)} L ${xS(0)} ${yS(yMin)} Z`;

  const sortedRules = [...rules].sort((a, b) => a.value - b.value);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, overflow: "visible" }}>
      <defs>
        <linearGradient id="ag" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.5} />
          <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
        </linearGradient>
      </defs>
      {[0, .25, .5, .75, 1].map(t => <line key={t} x1={padL} x2={W - padR} y1={padT + ch * (1 - t)} y2={padT + ch * (1 - t)} stroke="#f1f5f9" strokeWidth={1} />)}
      {[0, .5, 1].map(t => {
        const v = yMin + t * (yMax - yMin);
        return <text key={t} x={padL - 3} y={yS(v) + 3} textAnchor="end" fontSize={8} fill="#94a3b8">{v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}</text>;
      })}
      {sortedRules.map(r => {
        const zMin = sortedRules.indexOf(r) === 0 ? yMin : sortedRules[sortedRules.indexOf(r) - 1].value;
        const zMax = r.op === "between" && r.value2 != null ? r.value2 : r.value;
        const top = yS(Math.min(yMax, zMax)), bot = yS(Math.max(yMin, zMin));
        if (bot <= top) return null;
        return <rect key={r.id} x={padL} y={top} width={cw} height={bot - top} fill={MS[r.color].bg} opacity={0.1} />;
      })}
      {rules.map(r => <line key={r.id} x1={padL} x2={W - padR} y1={yS(r.value)} y2={yS(r.value)} stroke={MS[r.color].bg} strokeWidth={1.5} strokeDasharray="4 3" opacity={0.6} />)}
      <path d={areaD} fill="url(#ag)" opacity={0.3} />
      <path d={pathD} fill="none" stroke="#3B82F6" strokeWidth={2} strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={xS(i)} cy={yS(p.value)} r={4} fill={colorOf(p.value)} stroke="#fff" strokeWidth={1.5}
          onMouseEnter={() => setTooltip({ x: xS(i), y: yS(p.value) - 10, val: p.value, color: getColorForValue(p.value, rules) })}
          onMouseLeave={() => setTooltip(null)} style={{ cursor: "pointer" }} />
      ))}
      {tooltip && <><rect x={tooltip.x - 22} y={tooltip.y - 16} width={44} height={16} rx={4} fill={MS[tooltip.color].bg} />
        <text x={tooltip.x} y={tooltip.y - 4} textAnchor="middle" fontSize={9} fill="#fff" fontWeight="600">{tooltip.val.toFixed(1)}</text></>}
      {points.map((p, i) => {
        if (i % Math.ceil(points.length / 4) !== 0 && i !== points.length - 1) return null;
        const d = new Date(p.timestamp);
        return <text key={i} x={xS(i)} y={H - 4} textAnchor="middle" fontSize={8} fill="#94a3b8">{`${d.getMonth() + 1}/${d.getDate()}`}</text>;
      })}
    </svg>
  );
}

function ExpandableChart({ history, rules, graphType, currentValue }: {
  history: DataPoint[]; rules: ColorRule[]; graphType: GraphType; currentValue: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <div style={{ position: "relative" }}>
        <MetricChart history={history} rules={rules} graphType={graphType} currentValue={currentValue} />
        <button onClick={() => setExpanded(true)}
          style={{ position: "absolute", bottom: 4, right: 4, width: 22, height: 22, borderRadius: 4, border: "none", background: "rgba(255,255,255,0.9)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#64748b", boxShadow: "0 1px 3px rgba(0,0,0,0.12)" }}
          title="Expand graph">⛶</button>
      </div>
      {expanded && <GraphExpandPopUp {...{ history, rules, graphType, currentValue, onClose: () => setExpanded(false) }} />}
    </>
  );
}

function GraphExpandPopUp({ history, rules, graphType, currentValue, onClose }: {
  history: DataPoint[]; rules: ColorRule[]; graphType: GraphType; currentValue: string; onClose: () => void;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: "90vw", maxWidth: 720, maxHeight: "90vh", overflow: "auto", position: "relative" }}>
        <button onClick={onClose}
          style={{ position: "absolute", top: 12, right: 16, width: 28, height: 28, borderRadius: "50%", border: "none", background: "#f1f5f9", cursor: "pointer", fontSize: 16, color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332", marginBottom: 20 }}>Graph Detail</div>
        <div style={{ width: "100%" }}>
          <MetricChart history={history} rules={rules} graphType={graphType} currentValue={currentValue} />
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// METRIC DETAIL MODAL
// ═══════════════════════════════════════════════════════════════════════════

function FiveAccountOverflowBanner({ overflowAmount, currencySymbol, metric, siblings, onMove }: {
  overflowAmount: number; currencySymbol: string; metric?: Metric;
  siblings?: Metric[]; onMove: (destId: string, destName: string) => void;
}) {
  // Determine default destination
  const isProfit = metric?.label?.toLowerCase() === "profit" || metric?.modal?.accountType === "profit";
  const invAccount = siblings?.find(s => s.label.toLowerCase() === "investments" || s.modal?.accountType === "investments");
  
  const [selectedDestId, setSelectedDestId] = useState(isProfit && invAccount ? invAccount.id : "");
  const fmtVal = (n: number) => `${currencySymbol}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div style={{ background: "#F0FDF4", border: "1.5px solid #4CAF7D", borderRadius: 10, padding: "12px 14px", marginBottom: 15 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span style={{ fontSize: 18 }}>🌊</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0F6E56", marginBottom: 3 }}>
            Five-Account Overflow
          </div>
          <div style={{ fontSize: 12, color: "#0F6E56", lineHeight: 1.5, marginBottom: 10 }}>
            This account is <strong>{fmtVal(overflowAmount)}</strong> over your target. Move the excess to stay balanced?
          </div>
          
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {!isProfit && (
              <select 
                value={selectedDestId} 
                onChange={(e) => setSelectedDestId(e.target.value)}
                style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #4CAF7D", fontSize: 12 }}
              >
                <option value="">Select Account...</option>
                {siblings?.filter(s => metric && s.id !== metric.id).map(s => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            )}
            
            <button 
              onClick={() => {
                const dest = siblings?.find(s => s.id === selectedDestId);
                if (dest) onMove(selectedDestId, dest.label);
              }} 
              disabled={!selectedDestId}
              style={{
                padding: "8px 12px", borderRadius: 8, border: "none",
                background: selectedDestId ? "linear-gradient(135deg,#3B82F6,#06B6D4)" : "#cbd5e1", 
                fontSize: 11, fontWeight: 700, cursor: selectedDestId ? "pointer" : "not-allowed", color: "#fff"
              }}
            >
              Move {fmtVal(overflowAmount)} {isProfit ? "to Investments" : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OutOfSyncBanner({ metric, onResyncCurrent, onResyncPrevious }: {
  metric?: Metric;
  onResyncCurrent: () => void;
  onResyncPrevious: () => void;
}) {
  return (
    <div style={{ background: "#FFF5F5", border: "1.5px solid #E85D75", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#E85D75", marginBottom: 4 }}>⚠ Out of Sync</div>
      <div style={{ fontSize: 11, color: "#475569", marginBottom: 8, lineHeight: 1.4 }}>{metric?.outOfSyncReason ?? "This metric may not reflect the current bank balance."}</div>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={onResyncCurrent} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#E85D75", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Accept current</button>
        <button onClick={onResyncPrevious} style={{ padding: "5px 12px", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 11, fontWeight: 500, cursor: "pointer" }}>Revert to last synced</button>
      </div>
    </div>
  );
}

function RefreshButton({ onRefresh, lastSyncedAt, metricId }: {
  onRefresh: () => Promise<void>;
  lastSyncedAt?: number;
  metricId?: string;
}) {
  const [state, setState] = useState<"idle" | "spinning" | "done">("idle");
  const [timestamp, setTimestamp] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (metricId) {
      const stored = localStorage.getItem(`metric-${metricId}-lastSyncedAt`);
      if (stored) setTimestamp(parseInt(stored, 10));
    }
  }, [metricId]);

  useEffect(() => {
    if (lastSyncedAt && metricId) {
      localStorage.setItem(`metric-${metricId}-lastSyncedAt`, lastSyncedAt.toString());
      setTimestamp(lastSyncedAt);
    }
  }, [lastSyncedAt, metricId]);
  const handleClick = async () => {
    if (state === "spinning") return;
    setState("spinning");
    await onRefresh();
    setState("done");
    setTimeout(() => setState("idle"), 2500);
  };

  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {(timestamp ?? lastSyncedAt) ? (
        <span style={{ fontSize: 10, color: "#94a3b8", fontStyle: "italic" }}>
          Synced {fmtTime((timestamp ?? lastSyncedAt)!)}
        </span>
      ) : null}
      <button onClick={handleClick} title="Refresh data" style={{
        width: 32, height: 32, borderRadius: "50%", border: "1.5px solid #e2e8f0",
        background: state === "done" ? "#F0FDF4" : "#f8fafc",
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", flexShrink: 0, padding: 0,
        borderColor: state === "done" ? "#4CAF7D" : "#e2e8f0",
        transition: "all 0.2s"
      }}>
        {state === "done" ? (
          <span style={{ color: "#4CAF7D", fontSize: 14, fontWeight: 700 }}>✓</span>
        ) : (
          <span style={{ display: "inline-block", fontSize: 14, color: "#94a3b8", animation: state === "spinning" ? "spin 0.7s linear infinite" : "none" }}>↻</span>
        )}
      </button>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function TopBarRefreshButton({ onRefresh, lastSyncedAt, isMobile }: {
  onRefresh: () => Promise<void>;
  lastSyncedAt?: number | null;
  isMobile?: boolean;
}) {
  const [state, setState] = useState<"idle" | "spinning" | "done">("idle");
  const [displaySynced, setDisplaySynced] = useState<number | null>(() => {
    const stored = localStorage.getItem("lastDashboardSync");
    return stored ? parseInt(stored, 10) : null;
  });

  const handleClick = async () => {
    if (state === "spinning") return;
    setState("spinning");
    await onRefresh();
    setState("done");
    setTimeout(() => setState("idle"), 2500);
  };

  useEffect(() => {
    if (lastSyncedAt) setDisplaySynced(lastSyncedAt);
  }, [lastSyncedAt]);

  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button onClick={handleClick} style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: isMobile ? 0 : 5,
        width: isMobile ? 36 : undefined, height: isMobile ? 36 : undefined,
        padding: isMobile ? 0 : "4px 10px", borderRadius: isMobile ? "50%" : 7, border: "1px solid #e2e8f0",
        background: state === "done" ? "#F0FDF4" : "#f8fafc",
        borderColor: state === "done" ? "#4CAF7D" : "#e2e8f0",
        cursor: "pointer", fontSize: 11, fontWeight: 500,
        color: state === "done" ? "#4CAF7D" : "#64748b",
        transition: "all 0.2s"
      }}>
        <span style={{ display: "inline-block", fontSize: isMobile ? 16 : 13, animation: state === "spinning" ? "spin 0.7s linear infinite" : "none" }}>
          {state === "done" ? "✓" : "↻"}
        </span>
        {!isMobile && (state === "done" ? "Synced" : "Refresh Data")}
      </button>
      {!isMobile && displaySynced && (
        <span style={{ fontSize: 10, color: "#94a3b8", fontStyle: "italic" }}>
          Synced {fmtTime(displaySynced)}
        </span>
      )}
    </div>
  );
}

function CashBalanceInput({ value, currencySymbol, statValColor, statTextColor, isColored, onValueChange, siblings, currentMetricId, onTransfer }: {
  value: string; currencySymbol: string; statValColor: string; statTextColor: string;
  isColored: boolean; onValueChange?: (v: string, description?: string) => void;
  siblings?: Metric[]; currentMetricId?: string;
  onTransfer?: (toMetricId: string, amount: number, description: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [txnAmount, setTxnAmount] = useState("");
  const [txnType, setTxnType] = useState<"credit" | "debit">("credit");
  const [txnDesc, setTxnDesc] = useState("");
  const [transferToId, setTransferToId] = useState<string>("");

  // Other Five-Account boxes available as transfer destinations
  const transferTargets = (siblings ?? []).filter(s =>
    s.id !== currentMetricId &&
    (s.modal?.fiveAccountEnabled || s.fiveAccountParentId)
  );

  const handleCancel = () => {
    setOpen(false);
    setTxnAmount("");
    setTxnDesc("");
    setTxnType("credit");
    setTransferToId("");
  };

  const handlePost = () => {
    if (!txnDesc.trim() || !txnAmount) return;
    const amount = parseFloat(txnAmount);
    if (isNaN(amount) || amount <= 0) return;
    const currentNum = parseFloat(value.replace(/[^0-9.]/g, "")) || 0;
    const newNum = txnType === "credit" ? currentNum + amount : Math.max(0, currentNum - amount);
    const formatted = `${currencySymbol}${newNum.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    // If user selected a transfer destination, label the description and trigger the counter-post
    const finalDesc = transferToId
      ? `${txnDesc.trim()} — Transfer ${txnType === "credit" ? "from" : "to"} ${transferTargets.find(t => t.id === transferToId)?.label ?? "account"}`
      : txnDesc.trim();
    onValueChange?.(formatted, finalDesc);
    if (transferToId && onTransfer) {
      // Mirror the transaction on the destination: a debit here = credit there, and vice versa
      onTransfer(transferToId, txnType === "credit" ? -amount : amount, `Transfer from ${transferTargets.find(t => t.id === currentMetricId)?.label ?? "account"}: ${txnDesc.trim()}`);
    }
    handleCancel();
  };

  return (
    <div>
      {/* Balance display + Post Transaction button */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 2, marginBottom: open ? 12 : 0 }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: statValColor }}>{value}</span>
        {!open && (
          <button onClick={() => setOpen(true)} style={{
            padding: "4px 10px", borderRadius: 20, border: "1.5px solid",
            borderColor: isColored ? "rgba(255,255,255,0.4)" : "#e2e8f0",
            background: isColored ? "rgba(255,255,255,0.15)" : "#fff",
            fontSize: 11, fontWeight: 600, cursor: "pointer",
            color: isColored ? "#fff" : "#3B82F6", flexShrink: 0
          }}>
            Post Transaction
          </button>
        )}
      </div>

      {/* Inline form */}
      {open && (
        <div style={{ background: "#fff", borderRadius: 10, padding: "12px 14px", border: "1.5px solid #e2e8f0", marginBottom: 4 }}>
          {/* Credit / Debit toggle */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {(["credit", "debit"] as const).map(t => (
              <button key={t} onClick={() => setTxnType(t)} style={{
                flex: 1, padding: "5px 0", borderRadius: 7, border: "1.5px solid",
                borderColor: txnType === t ? (t === "credit" ? "#4CAF7D" : "#E85D75") : "#e2e8f0",
                background: txnType === t ? (t === "credit" ? "#F0FDF4" : "#FFF5F5") : "#fff",
                color: txnType === t ? (t === "credit" ? "#4CAF7D" : "#E85D75") : "#94a3b8",
                fontSize: 12, fontWeight: 600, cursor: "pointer", textTransform: "capitalize"
              }}>{t === "credit" ? "＋ Credit" : "－ Debit"}</button>
            ))}
          </div>
          {/* Amount */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: "#64748b", flexShrink: 0 }}>{currencySymbol}</span>
            <input
              value={txnAmount}
              onChange={e => setTxnAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              onKeyDown={e => { if (e.key === "Enter") handlePost(); }}
              placeholder="Amount"
              autoFocus
              style={{ flex: 1, padding: "7px 10px", borderRadius: 7, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none", boxSizing: "border-box" as const, color: "#1a2332", background: "#f8fafc" }}
            />
          </div>
          {/* Description */}
          <input
            value={txnDesc}
            onChange={e => setTxnDesc(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handlePost(); }}
            placeholder="Description (e.g. monthly deposit)"
            style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none", boxSizing: "border-box" as const, marginBottom: 8, color: "#1a2332", background: "#f8fafc" }}
          />
          {/* Transfer-to option (optional) — only shown if there are other Five-Account boxes */}
          {transferTargets.length > 0 && (
            <div style={{ marginBottom: 8, padding: "8px 10px", background: "#F0FDF4", border: "1px solid #c3e6d4", borderRadius: 7 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#0F6E56", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                Transfer to (optional)
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 11, color: "#64748b" }}>
                  <input type="checkbox" checked={transferToId === ""} onChange={() => setTransferToId("")}
                    style={{ accentColor: "#0F6E56", margin: 0 }} />
                  None
                </label>
                {transferTargets.map(t => (
                  <label key={t.id} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 11, color: "#1a2332" }}>
                    <input type="checkbox" checked={transferToId === t.id}
                      onChange={() => setTransferToId(transferToId === t.id ? "" : t.id)}
                      style={{ accentColor: "#0F6E56", margin: 0 }} />
                    {t.label}
                  </label>
                ))}
              </div>
              {transferToId && (
                <div style={{ fontSize: 10, color: "#0F6E56", marginTop: 6, fontStyle: "italic" }}>
                  ✓ Will post a matching {txnType === "credit" ? "debit" : "credit"} on {transferTargets.find(t => t.id === transferToId)?.label}
                </div>
              )}
            </div>
          )}
          {/* Preview */}
          {txnAmount && parseFloat(txnAmount) > 0 && (() => {
            const cur = parseFloat(value.replace(/[^0-9.]/g, "")) || 0;
            const amt = parseFloat(txnAmount) || 0;
            const next = txnType === "credit" ? cur + amt : Math.max(0, cur - amt);
            const fmt = (n: number) => `${currencySymbol}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            return (
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8, padding: "5px 8px", background: "#f1f5f9", borderRadius: 6 }}>
                {fmt(cur)} → <strong style={{ color: txnType === "credit" ? "#4CAF7D" : "#E85D75" }}>{fmt(next)}</strong>
              </div>
            );
          })()}
          {/* Buttons */}
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={handleCancel} style={{ flex: 1, padding: "7px 0", borderRadius: 7, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 12, cursor: "pointer", color: "#64748b" }}>
              Cancel
            </button>
            <button onClick={handlePost} disabled={!txnDesc.trim() || !txnAmount || parseFloat(txnAmount) <= 0}
              style={{ flex: 2, padding: "7px 0", borderRadius: 7, border: "none", fontSize: 12, fontWeight: 600, cursor: txnDesc.trim() && txnAmount ? "pointer" : "not-allowed", background: txnDesc.trim() && txnAmount && parseFloat(txnAmount) > 0 ? "linear-gradient(135deg,#3B82F6,#06B6D4)" : "#e2e8f0", color: txnDesc.trim() && txnAmount && parseFloat(txnAmount) > 0 ? "#fff" : "#94a3b8" }}>
              Post Transaction
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
function MetricModal({ data, metric, onClose, onEdit, onValueChange, userId, onRefreshSections, siblings, onTransfer, onResyncEquation, inline, tasks, setTasks, userEmail, orgMembers }: {
  data: MetricModalData; metric?: Metric;
  onClose: () => void; onEdit?: () => void; onValueChange?: (v: string, description?: string) => void;
  userId?: string; onRefreshSections?: () => Promise<void>;
  siblings?: Metric[];
  onTransfer?: (toMetricId: string, amount: number, description: string) => void;
  onResyncEquation?: () => void;
  inline?: boolean;
  tasks?: Task[]; setTasks?: React.Dispatch<React.SetStateAction<Task[]>>;
  userEmail?: string; orgMembers?: OrgMember[];
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [localValue, setLocalValue] = useState(data.mainValue);
  const [isEditingValue, setIsEditingValue] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const activeColor: MetricColor = metric ? resolveColor(metric) : data.color;
  const accent = MS[activeColor].bg;
  const isColored = activeColor !== "gray";
 const isCash = !!(
    (data.fiveAccountEnabled && data.accountType) ||
    (metric?.modal?.fiveAccountEnabled && metric?.modal?.accountType) ||
    metric?.fiveAccountParentId !== undefined ||
    (metric?.modal?.fiveAccountEnabled && !metric?.fiveAccountParentId)
  );
  const isCounter = !isCash && metric?.metricType === "counter";
  const metricType = metric?.metricType ?? "financial";
  const graphType = metric?.graphType ?? "linear";
  const colorRules = metric?.colorRules ?? [];
  const history = metric?.history ?? [];
  const currency = metric?.currencySymbol ?? "$";

  const parseVal = (v: string) => parseFloat(v.replace(/[^0-9.\-]/g, "")) || 0;
  const handleIncrement = (dir: 1 | -1) => {
    const n = parseVal(localValue);
    const step = metricType === "financial" ? 100 : 1;
    const next = n + dir * step;
    const formatted = formatValue(String(next), metricType, currency);
    setLocalValue(formatted); onValueChange?.(formatted);
  };
  const handleValueSave = () => { onValueChange?.(localValue); setIsEditingValue(false); };

  const CloseBtn = () => (
    <button onClick={onClose} style={{
      width: 34, height: 34, borderRadius: "50%", border: "1.5px solid #e2e8f0",
      background: "#f8fafc", fontSize: 20, cursor: "pointer", color: "#475569",
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 0
    }}>×</button>
  );
  const EditBtn = () => (
    <button onClick={onEdit} style={{
      background: "#9CA3AF", color: "#fff", border: "none", borderRadius: 8,
      padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer"
    }}>Edit Settings</button>
  );

  const statTextColor = isColored ? "rgba(255,255,255,0.82)" : "#64748b";
  const statValColor = isColored ? "#fff" : "#1a2332";

 // ── CASHFLOW ─────────────────────────────────────────────────────────────
  const liveTxns = metric?.modal?.transactions ?? data.transactions ?? [];

  // System-specific Overflow Check
  let overflowAmount = 0;
  const isSystemAccount = !!(metric?.fiveAccountParentId || metric?.modal?.fiveAccountEnabled);
  
  // Only proceed if Five Account system is active for this metric
  if (isSystemAccount) {
    const currentVal = parseFloat((metric?.value ?? "0").replace(/[^0-9.-]+/g, "")) || 0;
    const greenTarget = metric?.colorRules?.find(r => r.color === "green")?.value || 0;
    
    if (greenTarget > 0 && currentVal > greenTarget) {
      overflowAmount = currentVal - greenTarget;
    }
  }

  if (isCash) return (
    <div ref={overlayRef} onClick={e => { if (!inline && e.target === overlayRef.current) onClose(); }}
      style={inline ? { padding: "20px 28px" } : { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: "clamp(8px,2vw,20px)" }}>
      <div style={inline ? { width: "100%", maxWidth: 900 } : { 
  background: "#fff", 
  borderRadius: "clamp(12px,2vw,24px)", 
  width: "100%", 
  maxWidth: 900, 
  maxHeight: "92vh", 
  overflowY: "auto", 
  overflowX: "hidden", 
  padding: "clamp(16px,3vw,32px)", 
  boxShadow: "0 32px 80px rgba(0,0,0,0.2)", 
  scrollbarGutter: "stable" 
} as React.CSSProperties}>       
        <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: "clamp(20px,4vw,28px)", fontWeight: 700, color: "#1a2332", flex: 1 }}>{data.title}</h2>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {onRefreshSections && <RefreshButton onRefresh={onRefreshSections} lastSyncedAt={metric?.lastSyncedAt} metricId={metric?.id} />}
              {!inline && <><EditBtn /><CloseBtn /></>}
              {inline && <EditBtn />}
            </div>
          </div>
        {data.accountType && (
  <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
    {/* Header Banner */}
    <div style={{ background: "linear-gradient(135deg,#EEF9F4,#E8F4FD)", border: "1px solid #c3e6d4", borderRadius: 12, padding: "10px 14px" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#0F6E56", marginBottom: 2 }}>Five-Account System — {data.accountType.toUpperCase()}</div>
      <div style={{ fontSize: 11, color: "#475569", lineHeight: 1.4 }}>{FIVE_DESC[data.accountType]}</div>
    </div>

    {/* Dynamic Overflow Banner (Shows only if a color threshold is set) */}
    {(() => {
      const greenRule = metric?.colorRules?.find(r => r.color === "green");
      if (!greenRule) return null;
      
      const currentVal = parseVal(localValue);
      const isFull = currentVal >= greenRule.value;
      
      return (
        <div style={{
          background: isFull ? "#ECFDF5" : "#F8FAFC",
          border: `1px solid ${isFull ? "#10B981" : "#E2E8F0"}`,
          borderRadius: 12,
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: isFull ? "#065F46" : "#64748B" }}>
              {isFull ? "THRESHOLD REACHED" : "THRESHOLD ACTIVE"}
            </div>
            <div style={{ fontSize: 10, color: isFull ? "#047857" : "#94A3B8" }}>
              {isFull 
                ? `Limit of ${currency}${greenRule.value.toLocaleString()} reached. Funds are now diverting.` 
                : `Fills to ${currency}${greenRule.value.toLocaleString()} before diverting surplus.`}
            </div>
          </div>
          {isFull && <span style={{ fontSize: 16 }}>🌊</span>}
        </div>
      );
    })()}
  </div>
        )}
        {data.healthPct != null
          ? <><div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332", marginBottom: 6 }}>Health — <strong>{data.healthPct}%</strong></div>
            <div style={{ height: 28, borderRadius: 99, background: "#e5e7eb", maxWidth: 260, overflow: "hidden", marginBottom: 20 }}>
              <div style={{ width: `${data.healthPct}%`, height: "100%", borderRadius: 99, background: accent }} /></div></>
          : <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332", marginBottom: 6 }}>Health — N/A</div>
            <button style={{ padding: "6px 18px", borderRadius: 99, border: "1.5px solid #d1d5db", background: "#fff", fontSize: 12, cursor: "pointer" }}>Set A Goal</button>
          </div>}

        {/* Balance + transactions */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ background: accent, borderRadius: "12px 12px 0 0", padding: "18px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: statTextColor, marginBottom: 4 }}>Balance</div>
                {metric?.outOfSync && (
                  <OutOfSyncBanner
                    metric={metric}
                    onResyncCurrent={() => {
                      // Accept current value as correct, post all unposted history as "Owner adjustment"
                      const currentNum = parseFloat((metric.value ?? "0").replace(/[^0-9.]/g, "")) || 0;
                      const formatted = `${currency}${currentNum.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                      onValueChange?.(formatted, "Owner adjustment — balance reconciled");
                    }}
                    onResyncPrevious={() => {
                      // Revert to last synced value from history
                      const lastSynced = metric.history && metric.history.length > 0
                        ? metric.history[metric.history.length - 2]
                        : null;
                      if (lastSynced) {
                        const formatted = `${currency}${lastSynced.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                        onValueChange?.(formatted, "Resynced to previous balance");
                      }
                    }}
                  />
                )}
               {overflowAmount > 0 && (
                  <FiveAccountOverflowBanner
                    overflowAmount={overflowAmount}
                    currencySymbol={currency}
                    metric={metric}
                    siblings={siblings}
                    onMove={(destId, destName) => {
                      const currentVal = parseFloat((metric?.value ?? "0").replace(/[^0-9.-]+/g, "")) || 0;
                      const newBal = currentVal - overflowAmount;
                      const fmtNewBal = `${currency}${newBal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                      
                      // 1. Deduct from current
                      onValueChange?.(fmtNewBal, `Overflow transfer to ${destName}`);
                      // 2. Add to destination
                      if (onTransfer) {
                        onTransfer(destId, overflowAmount, `Overflow received from ${metric?.label ?? ""}`);
                      }
                    }}
                  />
                )}
                <CashBalanceInput
                  value={metric?.value ?? data.mainValue}
                  currencySymbol={currency}
                  statValColor={statValColor}
                  statTextColor={statTextColor}
                  isColored={isColored}
                  onValueChange={(v, desc) => onValueChange?.(v, desc)}
                  siblings={siblings}
                  currentMetricId={metric?.id}
                  onTransfer={onTransfer}
                />
                {/* Actual bank account balance — sum of all Five-Account boxes when displayed on overhead/parent */}
                {data.accountType === "overhead" && siblings && siblings.length > 0 && (() => {
                  const total = siblings.reduce((sum, s) => {
                    if (s.id === metric?.id || s.fiveAccountParentId === metric?.id || s.modal?.fiveAccountEnabled) {
                      return sum + (parseFloat(s.value.replace(/[^0-9.\-]/g, "")) || 0);
                    }
                    return sum;
                  }, 0);
                  const formatted = `${currency}${total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                  return (
                    <div style={{ fontSize: 11, color: isColored ? "rgba(255,255,255,0.85)" : "#475569", marginTop: 6, fontWeight: 500 }}>
                      Actual bank account balance: <strong>{formatted}</strong>
                    </div>
                  );
                })()}
                <div style={{ fontSize: 9, color: isColored ? "#fff" : "#94a3b8", marginTop: 4, fontWeight: isColored ? 500 : 400 }}>
                  {metric?.lastSyncedAt ? `Synced ${new Date(metric.lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
                </div>
              </div>
              <button style={{ background: "#fff", border: "none", borderRadius: 20, padding: "5px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600, flexShrink: 0, marginLeft: 14, color: "#1a2332" }}>Filter</button>
            </div>
          </div>
          <TxnTable transactions={liveTxns} />
        </div>

        {/* Chart */}
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 14px", marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332", marginBottom: 8 }}>History</div>
          <ExpandableChart history={history} rules={colorRules} graphType={graphType} currentValue={metric?.value ?? data.mainValue} />
        </div>

        <BottomThreeCards data={data} metricId={metric?.id} tasks={tasks} setTasks={setTasks} userEmail={userEmail} orgMembers={orgMembers} />
      </div>
    </div>
  );

  // ── COUNTER ───────────────────────────────────────────────────────────────
 if (isCounter) return (
    <div ref={overlayRef} onClick={e => { if (!inline && e.target === overlayRef.current) onClose(); }}
      style={inline ? { padding: "20px 28px" } : { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: "clamp(8px,2vw,20px)" }}>
      <div style={inline ? { width: "100%", maxWidth: 780 } : { background: "#fff", borderRadius: "clamp(12px,2vw,24px)", width: "100%", maxWidth: 780, maxHeight: "92vh", overflowY: "auto", overflowX: "hidden", padding: "clamp(16px,3vw,32px)", boxShadow: "0 32px 80px rgba(0,0,0,0.2)", scrollbarGutter: "stable" } as React.CSSProperties}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: "clamp(20px,4vw,28px)", fontWeight: 700, color: "#1a2332", flex: 1 }}>{data.title}</h2>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {onRefreshSections && <RefreshButton onRefresh={onRefreshSections} lastSyncedAt={metric?.lastSyncedAt} metricId={metric?.id} />}
            {!inline && <><EditBtn /><CloseBtn /></>}
            {inline && <EditBtn />}
          </div>
        </div>
        {metric?.icon && metric.icon !== ICON_NONE && (
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <div style={{ width: 68, height: 68, borderRadius: "50%", border: "2px solid #e2e8f0", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <IconGlyph name={metric.icon} size={28} color="#1a2332" />
            </div>
          </div>
        )}
        <div style={{ maxWidth: 360, margin: "0 auto 8px" }}>
          <div style={{ height: 32, borderRadius: 99, background: "#e5e7eb", overflow: "hidden" }}>
            <div style={{ width: `${data.healthPct ?? 0}%`, height: "100%", borderRadius: 99, background: activeColor !== "gray" ? accent : "#e5e7eb", transition: "width 0.4s" }} />
          </div>
        </div>
        <p style={{ textAlign: "center", fontSize: 13, marginBottom: 24, color: "#64748b" }}>Health Goal — <strong style={{ color: "#1a2332" }}>{data.healthPct ?? "N/A"}{data.healthPct != null ? "%" : ""}</strong></p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 28, marginBottom: 8 }}>
          <button onClick={() => handleIncrement(-1)} style={{ width: 40, height: 40, borderRadius: "50%", border: "1.5px solid #d1d5db", background: "none", fontSize: 22, cursor: "pointer", color: "#6b7280" }}>−</button>
          {isEditingValue
            ? <input value={localValue} onChange={e => setLocalValue(e.target.value)} onBlur={handleValueSave} onKeyDown={e => { if (e.key === "Enter") handleValueSave(); }} autoFocus
              style={{ fontSize: 64, fontWeight: 700, color: "#1a2332", border: "none", borderBottom: "2px solid #3B82F6", outline: "none", width: 200, textAlign: "center", background: "transparent" }} />
            : <span onClick={() => setIsEditingValue(true)} style={{ fontSize: 64, fontWeight: 700, color: "#1a2332", cursor: "text" }} title="Click to edit">{localValue}</span>}
          <button onClick={() => handleIncrement(1)} style={{ width: 40, height: 40, borderRadius: "50%", border: "1.5px solid #d1d5db", background: "none", fontSize: 22, cursor: "pointer", color: "#6b7280" }}>+</button>
        </div>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ height: 2, background: "#1a2332", width: 220, margin: "0 auto 5px" }} />
          <span style={{ fontSize: 12, fontStyle: "italic", color: "#94a3b8" }}>
            {metric?.lastSyncedAt ? `Synced ${new Date(metric.lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
          <SectionCard>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332", marginBottom: 10 }}>Details</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px" }}>
              {data.stats.map((s, i) => <div key={i}>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>{s.label}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#1a2332" }}>{s.value}</div>
              </div>)}
            </div>
          </SectionCard>
          <SectionCard>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332", marginBottom: 6 }}>History</div>
            <ExpandableChart history={history} rules={colorRules} graphType={graphType} currentValue={localValue} />
          </SectionCard>
        </div>
        <BottomThreeCards data={data} metricId={metric?.id} tasks={tasks} setTasks={setTasks} userEmail={userEmail} orgMembers={orgMembers} />
      </div>
    </div>
  );

  // ── FINANCIAL / PERCENTAGE / GENERIC ──────────────────────────────────────
  const txns = data.transactions ?? [];

  return (
    <div ref={overlayRef} onClick={e => { if (!inline && e.target === overlayRef.current) onClose(); }}
      style={inline ? { padding: "20px 28px" } : { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: "clamp(8px,2vw,20px)" }}>
      <div style={inline ? { width: "100%", maxWidth: 900 } : { background: "#fff", borderRadius: "clamp(12px,2vw,24px)", width: "100%", maxWidth: 900, maxHeight: "92vh", overflowY: "auto", padding: "clamp(16px,3vw,32px)", boxShadow: "0 32px 80px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: "clamp(20px,4vw,28px)", fontWeight: 700, color: "#1a2332", flex: 1 }}>{data.title}</h2>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {onRefreshSections && <RefreshButton onRefresh={onRefreshSections} lastSyncedAt={metric?.lastSyncedAt} metricId={metric?.id} />}
              {!inline && <><EditBtn /><CloseBtn /></>}
              {inline && <EditBtn />}
            </div>
          </div>
        {data.healthPct != null
          ? <><div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332", marginBottom: 6 }}>Health — <strong>{data.healthPct}%</strong></div>
            <div style={{ height: 28, borderRadius: 99, background: "#e5e7eb", maxWidth: 260, overflow: "hidden", marginBottom: 20 }}>
              <div style={{ width: `${data.healthPct}%`, height: "100%", borderRadius: 99, background: accent }} /></div></>
          : <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332", marginBottom: 6 }}>Health — N/A</div>
            <button style={{ padding: "6px 18px", borderRadius: 99, border: "1.5px solid #d1d5db", background: "#fff", fontSize: 12, cursor: "pointer" }}>Set A Goal</button>
          </div>}
        <div style={{ background: accent, borderRadius: 16, padding: "18px 20px", marginBottom: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: statTextColor }}>Amount</div>
              {metric?.lastSyncedAt && <div style={{ fontSize: 9, color: isColored ? "rgba(255,255,255,0.5)" : "#94a3b8" }}>Synced {new Date(metric.lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>}
            </div>
            <button style={{ background: "#fff", border: "none", borderRadius: 20, padding: "3px 12px", fontSize: 11, cursor: "pointer", fontWeight: 600, color: "#1a2332" }}>Filter</button>
          </div>
          <CashBalanceInput value={data.mainValue} currencySymbol={metric?.currencySymbol ?? "$"}
            statValColor={statValColor} statTextColor={statTextColor} isColored={isColored}
            onValueChange={onValueChange} siblings={siblings} currentMetricId={metric?.id}
            onTransfer={onTransfer} />
          {data.stats.map((s, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: statTextColor }}>{s.label}</span>
                {s.synced && metric?.lastSyncedAt && <span style={{ fontSize: 9, color: isColored ? "rgba(255,255,255,0.5)" : "#94a3b8" }}>Synced {new Date(metric.lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: statValColor }}>{s.value}</div>
            </div>
          ))}
        </div>
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332", marginBottom: 6 }}>Transaction History</div>
          <TxnTable transactions={txns} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 22, marginBottom: 26 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332", marginBottom: 8 }}>Manually Adjust Metric</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <button onClick={() => handleIncrement(-1)} style={{ width: 30, height: 30, borderRadius: "50%", border: "1.5px solid #d1d5db", background: "none", fontSize: 18, cursor: "pointer", color: "#9CA3AF" }}>−</button>
              <div>
                {isEditingValue
                  ? <input value={localValue} onChange={e => setLocalValue(e.target.value)} onBlur={handleValueSave} onKeyDown={e => { if (e.key === "Enter") handleValueSave(); }} autoFocus
                    style={{ fontSize: 26, fontWeight: 700, color: "#1a2332", border: "none", borderBottom: "2px solid #3B82F6", outline: "none", width: 130, background: "transparent" }} />
                  : <div onClick={() => setIsEditingValue(true)} style={{ fontSize: 26, fontWeight: 700, color: "#1a2332", cursor: "text" }} title="Click to edit">{localValue}</div>}
                {metric?.lastSyncedAt
                  ? <div style={{ fontSize: 10, color: "#94a3b8", fontStyle: "italic" }}>{`Synced ${new Date(metric.lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}</div>
                  : null
                }
              </div>
              <button onClick={() => handleIncrement(1)} style={{ width: 30, height: 30, borderRadius: "50%", border: "1.5px solid #d1d5db", background: "none", fontSize: 18, cursor: "pointer", color: "#9CA3AF" }}>+</button>
            </div>
            {metric?.equation && metric.equation.steps.length > 0 && (
              metric?.outOfSync ? (
                <div style={{ background: "#FFF5F5", border: "1.5px solid #E85D75", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#E85D75", marginBottom: 4 }}>⚠ Out of Sync</div>
                  <div style={{ fontSize: 11, color: "#475569", marginBottom: 8, lineHeight: 1.4 }}>Value was manually edited and may not match equation output.</div>
                  <button onClick={onResyncEquation} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#E85D75", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Re-sync with equation</button>
                </div>
              ) : (
                <div style={{ background: "#F0FDF4", border: "1px solid #c3e6d4", borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#0F6E56", marginBottom: 4 }}>= Equation Active</div>
                  <div style={{ fontSize: 12, color: "#1a2332", marginBottom: 6 }}>
                    {buildEquationPreviewString(metric.equation.steps, [metric]) || "Equation set"}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>This value is automatically computed. Edit the equation in metric settings.</div>
                </div>
              )
            )}
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "6px 8px" }}>
              <ExpandableChart history={history} rules={colorRules} graphType={graphType} currentValue={localValue} />
            </div>
          </div>
        </div>
        <BottomThreeCards data={data} metricId={metric?.id} tasks={tasks} setTasks={setTasks} userEmail={userEmail} orgMembers={orgMembers} />
      </div>
    </div>
  );
}
// ═══════════════════════════════════════════════════════════════════════════
// POST TRANSACTION MODAL
// ═══════════════════════════════════════════════════════════════════════════

function PostTransactionModal({ prompt, currency, onConfirm, onCancel }: {
  prompt: PostTransactionPrompt;
  currency: string;
  onConfirm: (description: string) => void;
  onCancel: () => void;
}) {
  const [desc, setDesc] = useState("");
  const delta = prompt.newValue - prompt.oldValue;
  const isCredit = delta > 0;
  const fmt = (n: number) => `${currency}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 5000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 24, width: "100%", maxWidth: 380, boxShadow: "0 24px 64px rgba(0,0,0,0.2)", overflowY: "auto", overflowX: "hidden", maxHeight: "92vh" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332", marginBottom: 4 }}>Post Transaction</div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>
          Recording a <strong style={{ color: isCredit ? "#4CAF7D" : "#E85D75" }}>{isCredit ? `+${fmt(delta)} credit` : `${fmt(delta)} debit`}</strong> to this account.
        </div>
        <input
          value={desc} onChange={e => setDesc(e.target.value)} autoFocus
          onKeyDown={e => { if (e.key === "Enter" && desc.trim()) onConfirm(desc.trim()); }}
          placeholder="Transaction description (e.g. Q1 tax payment)"
          style={{ width: "100%", padding: "8px 11px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none", boxSizing: "border-box", marginBottom: 14 }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 12, cursor: "pointer", color: "#64748b" }}>Cancel (discard change)</button>
          <button onClick={() => { if (desc.trim()) onConfirm(desc.trim()); }} style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Post</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// FIVE-ACCOUNT SIMPLIFIED COLOR RULE
// ═══════════════════════════════════════════════════════════════════════════

function FiveAccountColorRule({ rules, onChange }: {
  rules: ColorRule[];
  onChange: (rules: ColorRule[]) => void;
}) {
  const redRule = rules.find(r => r.color === "red");
  const yellowRule = rules.find(r => r.color === "yellow");
  const greenRule = rules.find(r => r.color === "green");

  const rv = useRef(redRule?.value?.toString() ?? "");
  const ymi = useRef(yellowRule?.value?.toString() ?? "");
  const yma = useRef(yellowRule?.value2?.toString() ?? "");
  const gv = useRef(greenRule?.value?.toString() ?? "");
  const [greenOp, setGreenOp] = useState<"<=" | "==">(greenRule?.op === "<=" ? "<=" : "==");

  const commit = (gop: "<=" | "==" = greenOp) => {
    const built: ColorRule[] = [];
    const rn = parseFloat(rv.current), ymn = parseFloat(ymi.current), ymax = parseFloat(yma.current), gn = parseFloat(gv.current);
    if (!isNaN(rn)) built.push({ id: "5a-red", color: "red", op: "<", value: rn });
    if (!isNaN(ymn) && !isNaN(ymax)) built.push({ id: "5a-yellow", color: "yellow", op: "between", value: ymn, value2: ymax });
    if (!isNaN(gn)) built.push({ id: "5a-green", color: "green", op: gop, value: gn });
    onChange(built);
  };
  const inputStyle: React.CSSProperties = { padding: "6px 9px", borderRadius: 7, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none", boxSizing: "border-box", width: "100%", background: "#fff" };

  const Row = ({ label, color, children }: { label: string; color: string; children: React.ReactNode }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, flexShrink: 0, display: "inline-block" }} />
      <span style={{ fontSize: 11, color: "#64748b", width: 54, flexShrink: 0 }}>{label}</span>
      {children}
    </div>
  );

  return (
    <div style={{ background: "#F8FAFC", borderRadius: 10, padding: "10px 12px", border: "1px solid #e2e8f0" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Color Thresholds</div>
      <Row label="Red — below" color="#E85D75">
        <input defaultValue={rv.current} onChange={e => { rv.current = e.target.value; }} onBlur={() => commit()} placeholder="Min threshold" style={inputStyle} />
      </Row>
      <Row label="Yellow — range" color="#F5A623">
        <input defaultValue={ymi.current} onChange={e => { ymi.current = e.target.value; }} onBlur={() => commit()} placeholder="From" style={{ ...inputStyle, width: "48%" }} />
        <span style={{ fontSize: 11, color: "#94a3b8" }}>–</span>
        <input defaultValue={yma.current} onChange={e => { yma.current = e.target.value; }} onBlur={() => commit()} placeholder="To" style={{ ...inputStyle, width: "48%" }} />
      </Row>
      <Row label="Green — target" color="#4CAF7D">
       <select value={greenOp} onChange={e => { const v = e.target.value as "<=" | "=="; setGreenOp(v); commit(v); }}
          style={{ padding: "6px 7px", borderRadius: 7, border: "1.5px solid #e2e8f0", fontSize: 11, outline: "none", background: "#fff", flexShrink: 0 }}>
          <option value="==">Equals target</option>
          <option value="<=">At or below target</option>
        </select>
        <input defaultValue={gv.current} onChange={e => { gv.current = e.target.value; }} onBlur={() => commit()} placeholder="Target" style={inputStyle} />
      </Row>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ADD COLOR RULE MODAL
// ═══════════════════════════════════════════════════════════════════════════

function AddColorRuleModal({ onSave, onClose, existing }: {
  onSave: (rule: ColorRule) => void; onClose: () => void; existing?: ColorRule;
}) {
  const [color, setColor] = useState<"red" | "yellow" | "green">(existing?.color ?? "red");
  const [op, setOp] = useState<RuleOp>(existing?.op ?? ">=");
  const [val, setVal] = useState(existing?.value?.toString() ?? "");
  const [val2, setVal2] = useState(existing?.value2?.toString() ?? "");

const opLabels: RuleOp[] = [">=", "<=", ">", "<", "==", "!=", "between"];
  const opDisplay: Record<RuleOp, string> = {
    ">=": "≥ (greater than or equal)", "<=": "≤ (less than or equal)",
    ">": "> (greater than)", "<": "< (less than)",
    "==": "= (equals)", "!=": "≠ (does not equal)",
    "between": "between (range)"
  };

  const save = () => {
    const n = parseFloat(val); if (isNaN(n)) return;
    onSave({ id: existing?.id ?? crypto.randomUUID(), color, op, value: n, value2: op === "between" ? parseFloat(val2) : undefined });
    onClose();
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 4000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "24px", width: "100%", maxWidth: 480, boxShadow: "0 24px 64px rgba(0,0,0,0.2)", overflowY: "auto", overflowX: "hidden", maxHeight: "92vh" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1a2332" }}>Add Color Rule</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8" }}>×</button>
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#1a2332", marginBottom: 10 }}>1. Select Condition</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: "#64748b", width: 80, flexShrink: 0 }}>If Metric is</span>
            <select value={op} onChange={e => setOp(e.target.value as RuleOp)}
              style={{ flex: 1, padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none", background: "#fff" }}>
              {opLabels.map(o => <option key={o} value={o}>{opDisplay[o]}</option>)}
            </select>
          </div>
          {op !== "between"
            ? <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "#64748b", width: 80, flexShrink: 0 }}>Value</span>
              <input value={val} onChange={e => setVal(e.target.value)} placeholder="Enter number"
                style={{ flex: 1, padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none" }} />
            </div>
            : <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "#64748b", width: 80, flexShrink: 0 }}>Min Value</span>
                <input value={val} onChange={e => setVal(e.target.value)} placeholder="Min"
                  style={{ flex: 1, padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none" }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "#64748b", width: 80, flexShrink: 0 }}>Max Value</span>
                <input value={val2} onChange={e => setVal2(e.target.value)} placeholder="Max"
                  style={{ flex: 1, padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none" }} />
              </div>
            </div>}
        </div>
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#1a2332", marginBottom: 10 }}>2. Select Color</div>
          <div style={{ display: "flex", gap: 10 }}>
            {(["red", "yellow", "green"] as const).map(c => (
              <div key={c} onClick={() => setColor(c)} style={{
                display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                padding: "8px 12px", borderRadius: 10, flex: 1, justifyContent: "center",
                border: `2px solid ${color === c ? MS[c].bg : "#e2e8f0"}`,
                background: color === c ? MS[c].bg + "18" : "#fff"
              }}>
                <span style={{ width: 12, height: 12, borderRadius: "50%", background: MS[c].bg, display: "inline-block" }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: color === c ? MS[c].bg : "#64748b", textTransform: "capitalize" }}>{c}</span>
              </div>
            ))}
          </div>
        </div>
        <button onClick={save} style={{ width: "100%", padding: "11px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          Save Rule
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// METRIC BOX SETTINGS MODAL
// ═══════════════════════════════════════════════════════════════════════════

function MetricBoxSettingsModal({ initial, siblings, onSave, onDelete, onDuplicate, onRecreateMissing, onClose, onFiveAccountToggledOn, onFiveAccountToggledOff, onCreateEquation, inline: isInline }: {
  initial?: Metric;
  siblings?: Metric[];
  onSave: (m: Omit<Metric, "id">) => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onRecreateMissing?: (missingAccounts: string[]) => void;
  onClose: () => void;
  onFiveAccountToggledOn?: () => void;
  onFiveAccountToggledOff?: (disabledMetricLabel: string) => void;
  onCreateEquation?: (formData?: { label: string; icon: string; metricType: MetricType; currencySymbol: string }) => void;
  inline?: boolean;
}) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [rawValue, setRawValue] = useState(() => {
    // strip formatting to get raw number for editing
    return (initial?.value ?? "").replace(/[^0-9.]/g, "");
  });
  const [icon, setIcon] = useState(initial?.icon ?? ICON_NONE);
  const [graphType, setGraphType] = useState<GraphType>(initial?.graphType ?? "linear");
  const [metricType, setMetricType] = useState<MetricType>(initial?.metricType ?? "counter");
  const [currency, setCurrency] = useState(initial?.currencySymbol ?? "$");
  const [fiveOn, setFiveOn] = useState(initial?.modal?.fiveAccountEnabled ?? false);
  const [rules, setRules] = useState<ColorRule[]>(initial?.colorRules ?? []);
  const [resetFreq, setResetFreq] = useState<ResetFrequency>(initial?.resetFrequency ?? "none");
  const [resetKeepHistory, setResetKeepHistory] = useState<boolean>(initial?.resetKeepHistory ?? true);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRule, setEditingRule] = useState<ColorRule | undefined>();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [equationError, setEquationError] = useState("");

  // Live formatted preview of the value based on metric type
  const previewValue = formatValue(rawValue || "0", fiveOn ? "financial" : metricType, currency);

  const graphTypes: [GraphType, string][] = [["linear", "Line Chart"], ["bar-v", "Bar Vertical"], ["bar-h", "Bar Horizontal"], ["pie", "Pie Chart"]];
  const metricTypes: [MetricType, string][] = [["counter", "Counter"], ["percentage", "Percentage"], ["financial", "Financial"]];

  const SectionLabel = ({ children }: { children: string }) => (
    <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{children}</div>
  );

  const Radio = ({ checked, onChange, label: rl, disabled }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean }) => (
    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: disabled ? "not-allowed" : "pointer", fontSize: 12, color: disabled ? "#cbd5e1" : "#1a2332", marginBottom: 5 }}>
      <input type="radio" checked={checked} onChange={onChange} disabled={disabled} style={{ accentColor: "#3B82F6", margin: 0 }} />{rl}
    </label>
  );

  const openAddRule = () => { setEditingRule(undefined); setShowRuleModal(true); };
  const openEditRule = (r: ColorRule) => { setEditingRule(r); setShowRuleModal(true); };
  const saveRule = (r: ColorRule) => setRules(prev => { const i = prev.findIndex(x => x.id === r.id); if (i >= 0) { const a = [...prev]; a[i] = r; return a; } return [...prev, r]; });
  const removeRule = (id: string) => setRules(prev => prev.filter(r => r.id !== id));
  const ruleDesc = (r: ColorRule) => {
    if (r.op === "between") return `between ${r.value}–${r.value2}`;
    if (r.op === "==") return `equals ${r.value}`;
    if (r.op === "!=") return `does not equal ${r.value}`;
    return `${r.op} ${r.value}`;
  };

  const effectiveMetricType: MetricType = fiveOn ? "financial" : metricType;

  const handleSave = () => {
    if (!label.trim()) { setSaveError("Please enter a title for this metric box."); return; }
    if (!rawValue.trim()) { setSaveError("Please enter a current value."); return; }
    setSaveError("");
    const finalValue = previewValue;
    const accountType = initial?.modal?.accountType ?? (fiveOn ? "overhead" : undefined);
    const m = makeModal(label, finalValue, "gray", {
      fiveAccountEnabled: fiveOn,
      type: fiveOn ? "cashflow" : initial?.modal?.type ?? (effectiveMetricType === "counter" ? "leads" : effectiveMetricType === "percentage" ? "website" : "invoices"),
      mainValue: finalValue,
      accountType,
      transactions: initial?.modal?.transactions ?? [],
    });
   const valueChanged = initial && initial.value !== finalValue;
    const isFiveAccountBox = fiveOn || !!initial?.fiveAccountParentId;

    // Detect Five-Account toggle changes and notify parent
    const wasFiveOn = initial?.modal?.fiveAccountEnabled ?? false;
    if (!wasFiveOn && fiveOn) onFiveAccountToggledOn?.();
    if (wasFiveOn && !fiveOn && initial) onFiveAccountToggledOff?.(initial.label);

    onSave({
      label, value: finalValue, icon, color: "gray", modal: m,
      graphType, metricType: effectiveMetricType, colorRules: rules,
      connectedApps: initial?.connectedApps ?? [],
      history: initial?.history ?? [],
      fiveAccountParentId: initial?.fiveAccountParentId,
      currencySymbol: currency,
      lastSyncedAt: initial?.lastSyncedAt,
      outOfSync: isFiveAccountBox && valueChanged ? true : (initial?.outOfSync ?? false),
      outOfSyncReason: initial?.outOfSyncReason,
      resetFrequency: resetFreq,
      resetKeepHistory,
      lastResetAt: initial?.lastResetAt,
      equation: initial?.equation,
      draftEquation: initial?.draftEquation,
    });
    onClose();
  };

  const isSynced = !!initial?.fiveAccountParentId;

  return (
    <>
      <div onClick={isInline ? undefined : onClose} style={isInline ? { position: "relative" } : { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: "clamp(8px,2vw,16px)" }}>
        <div onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === "Enter") handleSave(); }}
          style={isInline ? { background: "#fff", width: "100%", overflowY: "auto", overflowX: "hidden", scrollbarGutter: "stable" } as React.CSSProperties : { background: "#fff", borderRadius: "clamp(12px,2vw,20px)", width: "100%", maxWidth: 820, maxHeight: "min(92vh,100dvh)", overflowY: "auto", overflowX: "hidden", boxShadow: "0 24px 64px rgba(0,0,0,0.2)", scrollbarGutter: "stable" } as React.CSSProperties}>

          {/* Header */}
          <div style={{ padding: "clamp(14px,3vw,20px) clamp(16px,3vw,22px) 0", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <input value={label} onChange={e => { setLabel(e.target.value); setEquationError(""); }} placeholder="Metric Box Title"
              style={{ fontSize: 17, fontWeight: 700, border: "none", outline: "none", color: "#1a2332", background: "transparent", flex: 1, minWidth: 0 }} />
            {!isInline && <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: "50%", border: "1.5px solid #e2e8f0", background: "#f8fafc", fontSize: 18, cursor: "pointer", color: "#94a3b8", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginLeft: 10 }}>×</button>}
          </div>

          {isSynced && (
            <div style={{ margin: "0 22px 6px", background: "#F0FDF4", border: "1px solid #c3e6d4", borderRadius: 8, padding: "6px 12px", fontSize: 11, color: "#0F6E56" }}>
              ✓ Synced from Five-Account System
            </div>
          )}

          <div style={{ padding: "6px clamp(16px,3vw,22px) clamp(16px,3vw,22px)" }}>
            <div className="stack-mobile" style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) minmax(280px, 1fr)", gap: 24 }}>

              {/* LEFT */}
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <SectionLabel>Metric Type</SectionLabel>
                  {metricTypes.map(([t, l]) => (
                    <Radio key={t} checked={effectiveMetricType === t} onChange={() => setMetricType(t)} label={l} disabled={fiveOn} />
                  ))}
                  {/* Currency dropdown appears when Financial is selected */}
                  {effectiveMetricType === "financial" && (
                    <div style={{ marginTop: 6 }}>
                      <SectionLabel>Currency</SectionLabel>
                      <select value={currency} onChange={e => setCurrency(e.target.value)}
                        style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none", background: "#fff" }}>
                        {WORLD_CURRENCIES.map(c => <option key={c.symbol} value={c.symbol}>{c.symbol} — {c.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>

                <div>
                  <SectionLabel>Current Value</SectionLabel>
                  <input value={rawValue} onChange={e => setRawValue(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Enter number"
                    style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                  {rawValue && (
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                      Preview: <strong style={{ color: "#3B82F6" }}>{previewValue}</strong>
                    </div>
                  )}
                </div>

                <div>
                  <SectionLabel>Connected Apps</SectionLabel>
                  {(initial?.connectedApps ?? []).length === 0
                    ? <div style={{ fontSize: 11, color: "#cbd5e1", fontStyle: "italic" }}>No apps connected yet</div>
                    : (initial?.connectedApps ?? []).map((a, i) => (
                      <span key={i} style={{ display: "inline-block", background: "#EFF6FF", borderRadius: 8, padding: "3px 8px", fontSize: 11, color: "#3B82F6", marginRight: 4, marginBottom: 3 }}>{a}</span>
                    ))}
                </div>

                {/* Five-Account System */}
                {(() => {
                  // Compute which siblings are missing from the Five-Account group, if any.
                  // Uses strict fiveAccountParentId matching.
                  let missingAccounts: string[] = [];
                  let groupAlreadyExists = false;
                  if (initial) {
                    // Determine the group's parent ID — either the parent's own id, or the child's parent reference.
                    const groupId = initial.fiveAccountParentId ?? initial.id;
                    // Collect all metrics in this group: the parent itself, plus any boxes whose parentId matches.
                    const groupMembers = (siblings ?? []).filter(s =>
                      s.id === groupId || s.fiveAccountParentId === groupId
                    );
                    // Always include the current metric being edited (it may not be in siblings).
                    if (!groupMembers.find(m => m.id === initial.id)) groupMembers.push(initial);
                    const presentLabels = new Set(groupMembers.map(m => m.label));
                    missingAccounts = FIVE_ACCOUNT_LABELS.filter(l => !presentLabels.has(l));
                    groupAlreadyExists = groupMembers.length > 1; // more than just the current box
                  }
                  return (
                    <div style={{ background: "#F0FDF4", border: "1px solid #c3e6d4", borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#1a2332" }}>Five-Account System</div>
                          <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>Profit First budgeting method</div>
                        </div>
                        <Toggle on={fiveOn} onChange={setFiveOn} />
                      </div>
                      {fiveOn && (
                        <>
                          <div style={{ fontSize: 11, color: "#0F6E56", background: "#dcfce7", borderRadius: 6, padding: "8px 10px", marginBottom: 6 }}>
                            <div style={{ fontWeight: 700, marginBottom: 4 }}>✓ Five-Account Math Active</div>
                            {FIVE_EQUATION_POINTS.map((pt, i) => (
                              <div key={i} style={{ marginBottom: 2, lineHeight: 1.4 }}>{pt}</div>
                            ))}
                          </div>

                          {/* Case 1: brand-new (no group exists yet) → show "this will create 4 more" warning */}
                          {!initial && (
                            <div style={{ fontSize: 11, color: "#92400e", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 6, padding: "5px 10px" }}>
                              ⚠ This will create 4 more metric boxes so all 5 checking accounts are separated out based on your bank balance.
                            </div>
                          )}

                          {/* Case 2: editing existing, group is complete → no warning */}

                          {/* Case 3: editing existing, group has missing siblings → show recreate warning */}
                          {initial && missingAccounts.length > 0 && groupAlreadyExists && (
                            <div style={{ fontSize: 11, color: "#92400e", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 6, padding: "8px 10px" }}>
                              <div style={{ marginBottom: 6 }}>
                                ⚠ You're missing the <strong>{missingAccounts.join(", ").replace(/, ([^,]*)$/, " and $1")}</strong> metric box{missingAccounts.length > 1 ? "es" : ""}. Would you like to recreate {missingAccounts.length > 1 ? "them" : "it"}?
                              </div>
                              {onRecreateMissing && (
                                <button
                                  onClick={() => { onRecreateMissing(missingAccounts); onClose(); }}
                                  style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#92400e", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                                  Recreate {missingAccounts.length > 1 ? "Them" : "It"}
                                </button>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })()}

                {/* Color Rules */}
                {fiveOn ? (
                  <FiveAccountColorRule rules={rules} onChange={setRules} />
                ) : (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <button onClick={() => {
                        if (!label.trim()) { setEquationError("Please name this metric box before creating an equation"); return; }
                        setEquationError("");
                        onCreateEquation?.({ label, icon, metricType: effectiveMetricType, currencySymbol: currency });
                      }} style={{ padding: "8px 0", borderRadius: 8, border: "1.5px solid", borderColor: initial?.draftEquation ? "#cbd5e1" : initial?.equation ? "#4CAF7D" : "transparent", background: initial?.draftEquation ? "#fff" : initial?.equation ? "#F0FDF4" : "#64748b", color: initial?.draftEquation ? "#94a3b8" : initial?.equation ? "#4CAF7D" : "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                        {initial?.draftEquation ? "Edit draft equation" : initial?.equation ? "Edit Live Equation" : "Create Equation"}
                      </button>
                      <button onClick={openAddRule} style={{ padding: "8px 0", borderRadius: 8, border: "none", background: "#64748b", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Create Color Rule</button>
                    </div>
                    {equationError && <div style={{ fontSize: 11, color: "#E85D75", marginTop: 4, textAlign: "center" }}>{equationError}</div>}
                    {rules.length > 0 && (
                      <div>
                        <SectionLabel>Active Color Rules</SectionLabel>
                        {rules.map(r => (
                          <div key={r.id} style={{ background: "#F8FAFC", borderRadius: 8, padding: "7px 10px", marginBottom: 6, border: "1px solid #e2e8f0" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                              <div>
                                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 1 }}>
                                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: MS[r.color].bg, display: "inline-block" }} />
                                  <span style={{ fontSize: 11, fontWeight: 600, color: "#1a2332", textTransform: "capitalize" }}>{r.color}</span>
                                </div>
                                <div style={{ fontSize: 10, color: "#64748b" }}>If metric is {ruleDesc(r)}</div>
                              </div>
                              <div style={{ display: "flex", gap: 6 }}>
                                <button onClick={() => openEditRule(r)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#3B82F6", padding: 0 }}>Edit</button>
                                <button onClick={() => removeRule(r.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#E85D75", padding: 0 }}>✕</button>
          </div>
            </div>
          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
               </div>

              {/* RIGHT */}
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <SectionLabel>Select Icon</SectionLabel>
                  <IconPicker selected={icon} onSelect={setIcon} />
                </div>
                <div>
                  <SectionLabel>Graph Type</SectionLabel>
                  {graphTypes.map(([g, l]) => (
                    <label key={g} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "#1a2332", marginBottom: 5 }}>
                      <input type="radio" checked={graphType === g} onChange={() => setGraphType(g)} style={{ accentColor: "#3B82F6", margin: 0 }} />{l}
                    </label>
                  ))}
                </div>

                {/* Auto-reset (Section 7) */}
                <div>
                  <SectionLabel>Auto-Reset Metric</SectionLabel>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 6 }}>Automatically reset this metric to zero on a schedule.</div>
                  {([
                    ["none", "Never (manual only)"],
                    ["daily", "Daily"],
                    ["weekly", "Weekly"],
                    ["monthly", "Monthly"],
                  ] as [ResetFrequency, string][]).map(([f, l]) => (
                    <label key={f} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "#1a2332", marginBottom: 5 }}>
                      <input type="radio" checked={resetFreq === f} onChange={() => setResetFreq(f)} style={{ accentColor: "#3B82F6", margin: 0 }} />{l}
                    </label>
                  ))}
                  {resetFreq !== "none" && (
                    <div style={{ background: "#F8FAFC", borderRadius: 8, padding: "8px 10px", border: "1px solid #e2e8f0", marginTop: 6 }}>
                      <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", fontSize: 11, color: "#1a2332" }}>
                        <div>
                          <div style={{ fontWeight: 600 }}>Record reset in history</div>
                          <div style={{ fontSize: 10, color: "#64748b" }}>Keep the pre-reset value in the chart history</div>
                        </div>
                        <Toggle on={resetKeepHistory} onChange={setResetKeepHistory} />
                      </label>
                      {initial?.lastResetAt && (
                        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 6, fontStyle: "italic" }}>
                          Last reset: {new Date(initial.lastResetAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          <button onClick={handleSave} style={{ width: "100%", padding: "12px 0", borderRadius: 8, border: "none", marginTop: 20, background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Save
            </button>
            {saveError && <div style={{ fontSize: 11, color: "#E85D75", marginTop: 5, textAlign: "center" }}>{saveError}</div>}

            {initial && onDuplicate && (
              <div style={{ textAlign: "center", marginTop: 10 }}>
                <button onClick={() => { onDuplicate(); onClose(); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#3B82F6", fontSize: 12, textDecoration: "underline" }}>
                  Duplicate Metric Box
                </button>
              </div>
            )}

            {(initial || onDelete) && !showDeleteConfirm && (
              <div style={{ textAlign: "center", marginTop: 8 }}>
                <button onClick={() => setShowDeleteConfirm(true)} style={{ background: "none", border: "none", cursor: "pointer", color: "#E85D75", fontSize: 12, textDecoration: "underline" }}>
                  Delete Metric Box
                </button>
              </div>
            )}
            {showDeleteConfirm && (
              <div style={{ marginTop: 10, background: "#FFF5F5", borderRadius: 10, padding: "12px 14px", border: "1px solid #fecaca", textAlign: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#E85D75", marginBottom: 8 }}>Are you sure you want to delete this metric box?</div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                  <button onClick={() => setShowDeleteConfirm(false)} style={{ padding: "6px 16px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 12, cursor: "pointer", color: "#64748b" }}>Cancel</button>
                  <button onClick={() => { onDelete?.(); }} style={{ padding: "6px 16px", borderRadius: 8, border: "none", background: "#E85D75", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Yes, Delete</button>
                </div>
              </div>
            )}
          </div>
          <div style={{ height: 8 }} />
        </div>
      </div>
      {showRuleModal && <AddColorRuleModal existing={editingRule} onSave={saveRule} onClose={() => setShowRuleModal(false)} />}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// EDIT/ADD ROW MODAL
// ═══════════════════════════════════════════════════════════════════════════

function EditAddRowModal({ initial, onSave, onClose }: { initial?: string; onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(initial ?? "");
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "24px", width: "90%", maxWidth: 360, boxShadow: "0 20px 60px rgba(0,0,0,0.18)", overflowY: "auto", overflowX: "hidden", maxHeight: "92vh" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#1a2332" }}>{initial ? "Rename Row" : "Add Row"}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>×</button>
        </div>
        <input value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && name.trim()) { onSave(name.trim()); onClose(); } }}
          placeholder="Row name" autoFocus
          style={{ width: "100%", padding: "8px 11px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 18 }} />
        <button onClick={() => { if (name.trim()) { onSave(name.trim()); onClose(); } }}
          style={{ width: "100%", padding: "10px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
          Save
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ADD TEAM MODAL
// ═══════════════════════════════════════════════════════════════════════════

const LEVEL_ORDER: OrgPermissionLevel[] = ["viewer", "editor", "admin", "owner"];

function AddTeamModal({ orgId, orgs, setOrgs, orgMembers, setOrgMembers, teamRows, setTeamRows, invitedByName, onClose, currentUserLevel }: {
  orgId: string; orgs: Org[]; setOrgs: React.Dispatch<React.SetStateAction<Org[]>>;
  orgMembers: OrgMember[]; setOrgMembers: React.Dispatch<React.SetStateAction<OrgMember[]>>;
  teamRows: TeamRow[]; setTeamRows: React.Dispatch<React.SetStateAction<TeamRow[]>>;
  invitedByName?: string; onClose: () => void; currentUserLevel: OrgPermissionLevel;
}) {
  const allowedLevels = LEVEL_ORDER.slice(0, LEVEL_ORDER.indexOf(currentUserLevel) + 1);
  const sortedTeams = [...teamRows].sort((a, b) => a.order - b.order);
  const topTeamId = sortedTeams[0]?.id ?? "";
  const showTeamDropdown = sortedTeams.length > 1;
  const activeOrgName = orgs.find(o => o.id === orgId)?.name;
  const [rows, setRows] = useState([{ email: "", level: allowedLevels[0] as OrgPermissionLevel, teamId: topTeamId }]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<string[]>([]);

  const update = (i: number, f: "email" | "level" | "teamId", v: string) => setRows(p => p.map((r, j) => j === i ? { ...r, [f]: v } : r));

  const addRow = () => setRows(p => [...p, { email: "", level: allowedLevels[0] as OrgPermissionLevel, teamId: topTeamId }]);

  const handleKeyDown = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "Enter" && rows[i].email.trim()) {
      e.preventDefault();
      if (i === rows.length - 1 && rows[i].email.trim()) {
        addRow();
        setTimeout(() => {
          const inputs = document.querySelectorAll<HTMLInputElement>('[data-team-email-input]');
          const last = inputs[inputs.length - 1];
          last?.focus();
        }, 0);
      }
    }
  };

  const handleSubmit = async () => {
    const valid = rows.filter(r => r.email.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email.trim()));
    if (valid.length === 0) { setError("Enter at least one valid email address"); return; }
    setError("");
    setSending(true);

    const newMembers: OrgMember[] = [];
    for (const row of valid) {
      try {
        await inviteTeamMember(row.email.trim(), orgId, row.level, invitedByName ?? "A team member", activeOrgName);
        newMembers.push({
          id: crypto.randomUUID(),
          email: row.email.trim(),
          name: "",
          avatarUrl: "",
          level: row.level,
          status: "invited" as const,
          teamId: row.teamId || topTeamId,
        });
        setSuccess(prev => [...prev, row.email.trim()]);
      } catch (err: any) {
        setError(err.message || `Failed to invite ${row.email}`);
      }
    }

    if (newMembers.length > 0) {
      setOrgMembers(prev => [...prev, ...newMembers]);
    }

    setSending(false);
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "28px", width: "100%", maxWidth: 520, boxShadow: "0 24px 64px rgba(0,0,0,0.18)", overflowY: "auto", maxHeight: "90vh" }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>×</button>
        </div>
        <h2 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 700, color: "#1a2332", textAlign: "center" }}>Add your team</h2>
        <p style={{ margin: "0 0 20px", fontSize: 12, color: "#94a3b8", textAlign: "center" }}>Invite team members and assign them to a team.</p>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: showTeamDropdown ? "1fr auto auto" : "1fr auto", gap: 8, marginBottom: 10, alignItems: "center" }}>
            <input data-team-email-input value={r.email} onChange={e => update(i, "email", e.target.value)} onKeyDown={e => handleKeyDown(e, i)} placeholder="Email"
              style={{ padding: "8px 11px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none" }} />
             <select value={r.level} onChange={e => update(i, "level", e.target.value)}
              style={{ padding: "7px 9px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none", background: "#fff" }}>
              {allowedLevels.map(l => (
                <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>
              ))}
            </select>
            {showTeamDropdown && (
              <select value={r.teamId} onChange={e => update(i, "teamId", e.target.value)}
                style={{ padding: "7px 9px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none", background: "#fff" }}>
                {sortedTeams.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
          </div>
        ))}
        <button onClick={addRow}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#3B82F6", padding: "3px 0", marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
          + Add more
        </button>

        {error && <div style={{ marginBottom: 10, padding: "8px 12px", background: "#fef2f2", borderRadius: 8, fontSize: 12, color: "#dc2626" }}>{error}</div>}

        {success.length > 0 && (
          <div style={{ marginBottom: 10, padding: "8px 12px", background: "#f0fdf4", borderRadius: 8, fontSize: 12, color: "#15803d" }}>
            Invited: {success.join(", ")}
          </div>
        )}

        <button onClick={handleSubmit} disabled={sending}
          style={{ width: "100%", padding: "11px 0", borderRadius: 8, border: "none", background: sending ? "#94a3b8" : "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: sending ? "default" : "pointer" }}>
          {sending ? "Sending..." : "Add"}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// METRIC BLOCK
// ═══════════════════════════════════════════════════════════════════════════

function MetricBlock({ metric, onClick, onDragStart, onDragEnter, onDrop, isDragOver, disableDrag }: {
  metric: Metric; onClick: () => void;
  onDragStart: () => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDrop: () => void;
  isDragOver: boolean;
  disableDrag?: boolean;
}) {
  const activeColor = resolveColor(metric);
  const s = MS[activeColor];
  const [hov, setHov] = useState(false);
  const hasIcon = !!(metric.icon && metric.icon !== ICON_NONE);
  const isColored = activeColor !== "gray";
  const textColor = isColored ? "#fff" : "#4A5568";

  return (
    <div
      {...(disableDrag ? {} : { draggable: true as any, onDragStart: (e: React.DragEvent) => { e.stopPropagation(); onDragStart(); }, onDragEnter: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); onDragEnter(e); }, onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); }, onDrop: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); onDrop(); } })}
      onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        width: 140, minHeight: 140, borderRadius: 16, background: s.bg,
        padding: "14px 12px", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: hasIcon ? "space-between" : "center",
        cursor: "pointer", position: "relative", flexShrink: 0,
        transform: hov ? "translateY(-3px)" : "none",
        transition: "transform 0.15s, box-shadow 0.15s, outline 0.1s",
        boxShadow: hov ? "0 10px 28px rgba(0,0,0,0.15)" : "0 2px 8px rgba(0,0,0,0.06)",
        outline: isDragOver ? "3px dashed #3B82F6" : "3px solid transparent",
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: textColor, lineHeight: 1.3, textAlign: "center", width: "100%" }}>
        {metric.label}
      </div>
      {hasIcon && (
        <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <IconGlyph name={metric.icon} size={22} color={isColored ? s.bg : "#3B82F6"} />
        </div>
      )}
      <div style={{ fontSize: 15, fontWeight: 700, color: textColor, textAlign: "center", width: "100%" }}>
        {metric.value}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ROW CONTEXT MENU
// ═══════════════════════════════════════════════════════════════════════════

function RowMenu({ onRename, onDelete, onClose, triggerRef }: { onRename?: () => void; onDelete: () => void; onClose: () => void; triggerRef: React.RefObject<HTMLDivElement | null> }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { style: menuPos } = useSmartPosition(triggerRef, menuRef, true, { top: 36 });

  useEffect(() => {
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  return (
    <div ref={menuRef} style={{ ...menuPos, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid #e2e8f0", zIndex: 100, minWidth: 170, overflow: "hidden" }}>
      {onRename && (
        <div onClick={() => { onRename(); onClose(); }}
          style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", color: "#1a2332" }}
          onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>Rename row</div>
      )}

      {!confirmDelete
        ? <div onClick={() => setConfirmDelete(true)}
            style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", color: "#E85D75" }}
            onMouseEnter={e => (e.currentTarget.style.background = "#fff5f5")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>Delete row</div>
        : <div style={{ padding: "10px 14px", borderTop: "1px solid #f1f5f9" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#E85D75", marginBottom: 8 }}>Delete this row?</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setConfirmDelete(false)}
                style={{ flex: 1, padding: "5px 0", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 11, cursor: "pointer", color: "#64748b" }}>Cancel</button>
              <button onClick={() => { onDelete(); onClose(); }}
                style={{ flex: 1, padding: "5px 0", borderRadius: 6, border: "none", background: "#E85D75", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Delete</button>
            </div>
          </div>}
    </div>
  );
}

// ── MOBILE MENU (smart-positioned) ─────────────────────────────────────────
function MobileMenu({ triggerRef, onClose, onChat, onCustomize }: { triggerRef: React.RefObject<HTMLDivElement | null>; onClose: () => void; onChat: () => void; onCustomize: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const { style: menuPos } = useSmartPosition(triggerRef, menuRef, true, { top: 40 });

  useEffect(() => {
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  return (
    <div ref={menuRef} style={{ ...menuPos, background: "#fff", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid #e2e8f0", zIndex: 100, minWidth: 140, overflow: "hidden" }}>
      <div onClick={() => { onChat(); onClose(); }} style={{ padding: "10px 16px", fontSize: 13, color: "#64748b", cursor: "pointer", borderBottom: "1px solid #f1f5f9" }}>Chat</div>
      <div onClick={() => { onCustomize(); onClose(); }} style={{ padding: "10px 16px", fontSize: 13, color: "#64748b", cursor: "pointer" }}>Customize</div>
    </div>
  );
}

// ── HOVER AVATAR ──────────────────────────────────────────────────────────────
function HoverAvatar({ name, level, size = 28 }: { name: string; level: OrgPermissionLevel; size?: number }) {
  const [hover, setHover] = useState(false);
  const colors = ["#4C9FE8", "#7B68EE", "#48C78E", "#F5A623", "#E85D75"];
  const initial = (name?.[0] || "?").toUpperCase();
  const colorIdx = name ? name.charCodeAt(0) % 5 : 0;
  return (
    <div style={{ position: "relative", display: "inline-flex", marginLeft: -5 }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div style={{ width: size, height: size, borderRadius: "50%", background: colors[colorIdx], color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.38, fontWeight: 600, border: `2px solid #fff`, flexShrink: 0, cursor: "pointer" }}>
        {initial}
      </div>
      {hover && (
        <div style={{ position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%)", marginBottom: 6, zIndex: 500, background: "#fff", borderRadius: 10, boxShadow: "0 4px 16px rgba(0,0,0,0.15)", padding: "8px 12px", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: colors[colorIdx], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{initial}</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332" }}>{name}</div>
            <div style={{ fontSize: 11, color: "#64748b", textTransform: "capitalize" }}>{level}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD SECTION — with robust drag-drop
// ═══════════════════════════════════════════════════════════════════════════

function DashSection({
  section, onAddMetric, onAddMetricById, onRemoveMetric, onUpdateMetric, onRenameSection, onRemoveSection,
  onClickMetric, dragState, onMetricDragStart, onMetricDragEnter, onMetricDrop,
  onSectionDragStart, onSectionDragEnter, onSectionDrop, isSectionDragOver,
  dragOverTarget,
  onFiveAccountEnabledFromBox, onFiveAccountDisabledFromBox, onOpenEquationBuilder,
  orgMembers,
}: {
  section: Section;
  onAddMetric: (sid: string, m: Omit<Metric, "id">) => void;
  onAddMetricById?: (sid: string, m: Metric) => void;
  onRemoveMetric: (sid: string, mid: string) => void;
  onUpdateMetric: (sid: string, mid: string, m: Omit<Metric, "id">) => void;
  onRenameSection: (sid: string, name: string) => void;
  onRemoveSection: (sid: string) => void;
  onClickMetric: (data: MetricModalData, metric: Metric) => void;
  dragState: { sourceSid: string; sourceMid: string } | null;
  onMetricDragStart: (sid: string, mid: string) => void;
  onMetricDragEnter: (sid: string, mid: string) => void;
  onMetricDrop: (targetSid: string, targetMid: string) => void;
  onSectionDragStart: () => void;
  onSectionDragEnter: (e: React.DragEvent) => void;
  onSectionDrop: () => void;
  isSectionDragOver: boolean;
  dragOverTarget: { targetSid: string; targetMid: string } | null;
  onFiveAccountEnabledFromBox?: () => void;
  onFiveAccountDisabledFromBox?: (sectionId: string, disabledMetricId: string, disabledLabel: string) => void;
  onOpenEquationBuilder?: (sectionId: string, metricId: string, reopenAfterSave?: boolean) => void;
  orgMembers?: OrgMember[];
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingMetric, setEditingMetric] = useState<Metric | null>(null);
  const [showRowModal, setShowRowModal] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const rowMenuTriggerRef = useRef<HTMLDivElement>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingTitleValue, setEditingTitleValue] = useState("");
  const lastContainerTargetRef = useRef<string | null>(null);

  // Drop zone for the section itself (when dragging a metric over empty space in section)
  const handleSectionDropZone = (e: React.DragEvent) => {
    e.preventDefault();
    if (dragState) {
      onMetricDrop(section.id, "__end__");
    }
  };

  // Track drag-over for empty space (end-of-section indicator)
  const handleContainerDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragState) { lastContainerTargetRef.current = null; return; }
    if (lastContainerTargetRef.current !== "__end__") {
      lastContainerTargetRef.current = "__end__";
      onMetricDragEnter(section.id, "__end__");
    }
  };

 const handleAddMetricWithFiveAccount = (m: Omit<Metric, "id">) => {
    const newId = crypto.randomUUID();
    // Ensure the parent box is marked correctly
    const parentMetric = m.modal?.fiveAccountEnabled
      ? { ...m, fiveAccountParentId: undefined, modal: { ...m.modal, fiveAccountEnabled: true } }
      : m;
    onAddMetric(section.id, { ...parentMetric, id: newId } as any);

    if (m.modal?.fiveAccountEnabled && !m.fiveAccountParentId) {
      const parentLabel = m.label;
      const existingLabels = section.metrics.map(x => x.label);
      FIVE_ACCOUNT_LABELS.forEach(acctLabel => {
        if (acctLabel !== parentLabel && !existingLabels.includes(acctLabel)) {
          const accountType = acctLabel.toLowerCase() as any;
          const child = makeFiveAccountMetric(accountType, newId);
          onAddMetric(section.id, child);
        }
      });
    }
  };
  return (
    <div
      onDragEnter={onSectionDragEnter}
      onDragOver={e => e.preventDefault()}
      onDrop={onSectionDrop}
      style={{ marginBottom: 28, position: "relative", borderRadius: 8, outline: isSectionDragOver ? "2px dashed #3B82F6" : "none", padding: isSectionDragOver ? "4px" : "0" }}
    >
      {/* Section header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div draggable onDragStart={e => { e.stopPropagation(); onSectionDragStart(); }}
          style={{ cursor: "grab", color: "#cbd5e1", fontSize: 15, padding: "0 2px", flexShrink: 0 }} title="Drag to reorder">⠿</div>
        {editingTitle ? (
          <input autoFocus value={editingTitleValue} onChange={e => setEditingTitleValue(e.target.value)}
            onBlur={() => { if (editingTitleValue.trim() && editingTitleValue.trim() !== section.title) onRenameSection(section.id, editingTitleValue.trim()); setEditingTitle(false); }}
            onKeyDown={e => { if (e.key === "Enter") { if (editingTitleValue.trim() && editingTitleValue.trim() !== section.title) onRenameSection(section.id, editingTitleValue.trim()); setEditingTitle(false); } if (e.key === "Escape") setEditingTitle(false); }}
            style={{ margin: 0, fontSize: "clamp(16px,3vw,20px)", fontWeight: 700, color: "#1a2332", padding: "2px 6px", border: "1.5px solid #3B82F6", borderRadius: 4, outline: "none", background: "#fff", fontFamily: "inherit", maxWidth: 300 }} />
        ) : (
          <h2 onClick={() => { setEditingTitle(true); setEditingTitleValue(section.title); setShowMenu(false); }}
            style={{ margin: 0, fontSize: "clamp(16px,3vw,20px)", fontWeight: 700, color: "#1a2332", cursor: "text" }}>{section.title}</h2>
        )}
        <div style={{ display: "flex", marginLeft: 2, paddingLeft: 4 }}>
          {(orgMembers && orgMembers.length > 0 ? orgMembers.filter(m => m.status === "active") : section.avatars.map(a => ({ id: a, name: a, level: "viewer" as OrgPermissionLevel, email: "", avatarUrl: "" }))).map(member => (
            <HoverAvatar key={member.id || member.name} name={member.name || member.email} level={member.level} size={28} />
          ))}
        </div>
        <div style={{ position: "relative" }}>
          <div ref={rowMenuTriggerRef} onClick={() => setShowMenu(v => !v)} style={{ width: 26, height: 26, borderRadius: "50%", background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 13, color: "#94a3b8" }}>···</div>
          {showMenu && <RowMenu triggerRef={rowMenuTriggerRef} onDelete={() => onRemoveSection(section.id)} onClose={() => setShowMenu(false)} />}
        </div>
        <div style={{ flex: 1 }} />
      </div>

      {/* Metrics row */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <div style={{ width: 28, height: 28, borderRadius: "50%", border: "1.5px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#94a3b8", flexShrink: 0, marginRight: 6 }}>›</div>
        <div
          style={{ display: "flex", gap: 10, flexWrap: "wrap", flex: 1, minHeight: 48 }}
          onDragOver={handleContainerDragOver}
          onDrop={handleSectionDropZone}
        >
          {(() => {
            const children: React.ReactNode[] = [];

            // If empty section — show blue line at start
            if (dragOverTarget?.targetSid === section.id && dragOverTarget.targetMid === "__end__" && section.metrics.length === 0) {
              children.push(<div key="bl-end" style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />);
            }

            section.metrics.forEach((m, i) => {
              // Show blue line before this metric if it's the drag target
              if (dragOverTarget?.targetSid === section.id && dragOverTarget.targetMid === m.id) {
                children.push(<div key={`bl-${m.id}`} style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />);
              }
              children.push(
                <MetricBlock key={m.id} metric={m}
                  onClick={() => onClickMetric(m.modal, m)}
                  onDragStart={() => onMetricDragStart(section.id, m.id)}
                  onDragEnter={e => { lastContainerTargetRef.current = null; if (dragState && (dragState.sourceSid !== section.id || dragState.sourceMid !== m.id)) onMetricDragEnter(section.id, m.id); }}
                  onDrop={() => onMetricDrop(section.id, m.id)}
                  isDragOver={false}
                />
              );
            });

            // Show blue line at end for non-empty sections
            if (dragOverTarget?.targetSid === section.id && dragOverTarget.targetMid === "__end__" && section.metrics.length > 0) {
              children.push(<div key="bl-end" style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />);
            }

            children.push(
              <div key="add-btn" onClick={() => setShowAdd(true)} style={{ width: 44, height: 44, borderRadius: "50%", border: "1.5px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#94a3b8", fontSize: 20, alignSelf: "center" }}>+</div>
            );
            return children;
          })()}
        </div>
      </div>
      <div style={{ height: 1, background: "#f1f5f9", marginTop: 20 }} />

      {showAdd && <MetricBoxSettingsModal
        onSave={m => { handleAddMetricWithFiveAccount(m); setShowAdd(false); }}
        onFiveAccountToggledOn={() => { /* propagated by parent via onAddMetric → cascade handler */ }}
        onCreateEquation={(formData) => {
          if (!formData) return;
          const newId = crypto.randomUUID();
          const modalType = formData.metricType === "counter" ? "leads" : formData.metricType === "percentage" ? "website" : "invoices";
          const newMetric: Metric = {
            id: newId,
            label: formData.label,
            value: "0",
            icon: formData.icon,
            color: "gray",
            modal: makeModal(formData.label, "0", "gray", { type: modalType, mainValue: "0" }),
            metricType: formData.metricType,
            currencySymbol: formData.currencySymbol,
            graphType: "linear",
            connectedApps: [],
            history: [],
            colorRules: [],
          };
          onAddMetricById?.(section.id, newMetric);
          setShowAdd(false);
          onOpenEquationBuilder?.(section.id, newId, true);
        }}
        onClose={() => setShowAdd(false)} />}

      {editingMetric && <MetricBoxSettingsModal
        initial={editingMetric}
        siblings={section.metrics}
        onSave={m => { onUpdateMetric(section.id, editingMetric.id, m); setEditingMetric(null); }}
        onDelete={() => onRemoveMetric(section.id, editingMetric.id)}
        onDuplicate={() => {
          const { id, fiveAccountParentId, ...rest } = editingMetric;
          onAddMetric(section.id, { ...rest, label: `${editingMetric.label} (copy)`, history: [] });
        }}
        onRecreateMissing={(missing) => {
          const groupId = editingMetric.fiveAccountParentId ?? editingMetric.id;
          missing.forEach(label => {
            const accountType = label.toLowerCase() as any;
            onAddMetric(section.id, makeFiveAccountMetric(accountType, groupId));
          });
        }}
        onFiveAccountToggledOn={() => onFiveAccountEnabledFromBox?.()}
        onFiveAccountToggledOff={(label) => onFiveAccountDisabledFromBox?.(section.id, editingMetric.id, label)}
        onCreateEquation={() => onOpenEquationBuilder?.(section.id, editingMetric.id)}
        onClose={() => setEditingMetric(null)} />}

      {showRowModal && <EditAddRowModal initial={section.title} onSave={name => onRenameSection(section.id, name)} onClose={() => setShowRowModal(false)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE: GOALS
// ═══════════════════════════════════════════════════════════════════════════

function GoalsPage({ goals, setGoals, sections, viewMode, onOpenOnboarding, onEditGoal, onDuplicateGoal, tasks, setTasks, userEmail, orgMembers }: {
  goals: Goal[]; setGoals: (g: Goal[]) => void; sections: Section[];
  viewMode: "row" | "expanded";
  onOpenOnboarding: () => void; onEditGoal: (g: Goal) => void; onDuplicateGoal: (g: Goal) => void;
  tasks?: Task[]; setTasks?: React.Dispatch<React.SetStateAction<Task[]>>;
  userEmail?: string; orgMembers?: OrgMember[];
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ active: false, drafted: false, completed: false });
  const [confirmComplete, setConfirmComplete] = useState<Goal | null>(null);
  const [goalAddTask, setGoalAddTask] = useState<{ goalId: string; text: string; assignee: string; dueDate: string } | null>(null);
  const [goalExpandActions, setGoalExpandActions] = useState<string | null>(null);
  const [goalMenuTaskId, setGoalMenuTaskId] = useState<string | null>(null);
  const goalMenuRef = useRef<HTMLDivElement>(null);
  const goalMenuTriggerElRef = useRef<HTMLElement | null>(null);
  const [goalMenuPos, setGoalMenuPos] = useState<React.CSSProperties>({ position: "absolute", top: 24, right: 0, visibility: "hidden" });
  useLayoutEffect(() => {
    if (!goalMenuTaskId || !goalMenuRef.current || !goalMenuTriggerElRef.current) return;
    const trigger = goalMenuTriggerElRef.current;
    const triggerRect = trigger.getBoundingClientRect();
    const menuWidth = goalMenuRef.current.offsetWidth || 150;
    const menuHeight = goalMenuRef.current.offsetHeight || 200;
    let top = 24;
    let left: number | undefined;
    let rightVal: number | undefined;
    if (triggerRect.right - menuWidth < 8) { left = 0; } else { rightVal = 0; }
    if (triggerRect.top + 24 + menuHeight > window.innerHeight - 8) { top = -(menuHeight + 4); }
    setGoalMenuPos({ position: "absolute", top, left, right: rightVal, visibility: "visible" });
  }, [goalMenuTaskId]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (goalMenuRef.current && !goalMenuRef.current.contains(e.target as Node)) setGoalMenuTaskId(null); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [editingGoalValue, setEditingGoalValue] = useState("");
  const toggleSection = (k: string) => setCollapsed(p => ({ ...p, [k]: !p[k] }));

  const goalsWithProgress = goals.map(g => {
    const { pct, barColor } = computeGoalProgress(g, sections);
    return { ...g, pct, barColor };
  });

  const active = goalsWithProgress.filter(g => g.status === "active");
  const drafted = goalsWithProgress.filter(g => g.status === "drafted");
  const completed = goalsWithProgress.filter(g => g.status === "completed");

  const handleCompleteGoal = (g: Goal) => {
    setGoals(goals.map(x => x.id === g.id ? { ...x, status: "completed" as GoalStatus, pct: 100, barColor: "green" as MetricColor } : x));
    setConfirmComplete(null);
  };

  const renderGoalCard = (g: Goal) => {
    const barBg = g.barColor === "green" ? "#4CAF7D" : g.barColor === "yellow" ? "#F5A623" : "#E85D75";
    const isCompact = viewMode === "row";
    return (
      <div key={g.id} style={{ background: "#fff", borderRadius: 14, border: "1px solid #f1f5f9", overflow: "hidden", opacity: g.status === "completed" ? 0.5 : 1 }}>
        <div style={{ padding: isCompact ? "14px 18px" : "18px" }}>
          {/* Top row: checkbox + name + due + edit */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: isCompact ? 10 : 12 }}>
            <div onClick={e => { e.stopPropagation(); if (g.status !== "completed") setConfirmComplete(g); }}
              style={{ width: 22, height: 22, borderRadius: "50%", border: g.status === "completed" ? "none" : "2px solid #cbd5e1", background: g.status === "completed" ? "#4CAF7D" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: g.status === "completed" ? "default" : "pointer", flexShrink: 0, transition: "all 0.2s" }}>
              {g.status === "completed" && <IconGlyph name="Check" size={14} color="#fff" weight="bold" />}
            </div>
            {editingGoalId === g.id ? (
              <input autoFocus value={editingGoalValue} onChange={e => setEditingGoalValue(e.target.value)}
                onBlur={() => { if (editingGoalValue.trim() && editingGoalValue.trim() !== g.label) setGoals(goals.map(x => x.id === g.id ? { ...x, label: editingGoalValue.trim() } : x)); setEditingGoalId(null); }}
                onKeyDown={e => { if (e.key === "Enter") { if (editingGoalValue.trim() && editingGoalValue.trim() !== g.label) setGoals(goals.map(x => x.id === g.id ? { ...x, label: editingGoalValue.trim() } : x)); setEditingGoalId(null); } if (e.key === "Escape") setEditingGoalId(null); }}
                style={{ flex: 1, fontSize: 15, fontWeight: 600, color: "#1a2332", padding: "1px 4px", border: "1.5px solid #3B82F6", borderRadius: 4, outline: "none", background: "#fff", fontFamily: "inherit", minWidth: 0 }} />
            ) : (
              <span onClick={() => { setEditingGoalId(g.id); setEditingGoalValue(g.label); }}
                style={{ flex: 1, fontSize: 15, fontWeight: 600, color: "#1a2332", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "text" }}>{g.label}</span>
            )}
            {g.due && <span style={{ fontSize: 12, color: "#94a3b8", whiteSpace: "nowrap" }}>{g.due}</span>}
            <div onClick={() => onEditGoal(g)} style={{ width: 32, height: 32, borderRadius: 8, background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }} title="Edit goal settings">
              <IconGlyph name="PencilSimple" size={16} color="#64748b" />
            </div>
          </div>

          {/* Progress bar - always shown */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, height: 24, borderRadius: 99, background: "#e5e7eb", overflow: "hidden" }}>
              <div style={{ width: `${g.pct}%`, height: "100%", borderRadius: 99, background: barBg, transition: "width 0.3s" }} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: barBg, minWidth: 40, textAlign: "right" }}>{g.pct}%</span>
          </div>

          {/* Expanded mode details */}
          {!isCompact && (
            <div style={{ display: "contents" }}>
              {g.type === "equation" && g.steps?.length > 0 && (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12, marginBottom: 8 }}>
                  {g.steps.map((s, si) => {
                    const m = findMetricByLabel(sections, s.sectionLabel, s.metricLabel);
                    const met = evaluateGoalStep(s, sections);
                    if (!m) return null;
                    return (
                      <div key={si} style={{ position: "relative" }}>
                        <MetricBlock metric={m} onClick={() => {}} onDragStart={() => {}} onDragEnter={() => {}} onDrop={() => {}} isDragOver={false} />
                        <div style={{ position: "absolute", top: 4, left: 4, width: 22, height: 22, borderRadius: "50%", background: "#3B82F6", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, zIndex: 2 }}>{si + 1}</div>
                        <div style={{ position: "absolute", bottom: 4, right: 4, display: "flex", alignItems: "center", gap: 2, padding: "2px 6px", borderRadius: 99, background: met ? "rgba(76,175,125,0.85)" : "rgba(220,38,38,0.85)", color: "#fff", fontSize: 10, fontWeight: 600 }}>
                          <span>{formatTarget(s.target)}</span>
                          {met ? <IconGlyph name="CheckCircle" size={10} color="#fff" weight="fill" /> : <IconGlyph name="XCircle" size={10} color="#fff" weight="fill" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Attached metric boxes - full-size */}
              {g.attachedMetrics?.length > 0 && (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12, marginBottom: 8 }}>
                  {g.attachedMetrics.map((a, ai) => {
                    const m = findMetricByLabel(sections, a.sectionLabel, a.metricLabel);
                    if (!m) return null;
                    const sectionOf = sections.find(s => s.metrics.some(mm => mm.id === m.id));
                    return (
                      <MetricBlock key={ai} metric={m!} onClick={() => {}} onDragStart={() => {}} onDragEnter={() => {}} onDrop={() => {}} isDragOver={false} />
                    );
                  })}
                </div>
              )}

              {/* Goal-level projections, suggestions, next actions */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16, marginTop: 16 }}>
                <SectionCard>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#1a2332", marginBottom: 8 }}>Projections</div>
                  <div style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic", marginBottom: 10 }}>Coming Soon</div>
                  {[1, 2, 3].map(i => <div key={i} style={{ height: 8, borderRadius: 99, background: "#e2e8f0", marginBottom: 8, width: `${70 - i * 10}%`, opacity: 0.4 }} />)}
                </SectionCard>
                <SectionCard>
                  <div style={{ display: "inline-block", background: "#3B82F6", color: "#fff", borderRadius: 99, padding: "5px 14px", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Suggestions</div>
                  <div style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic", marginBottom: 10 }}>Coming Soon</div>
                  {[1, 2, 3].map(i => <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, opacity: 0.4 }}>
                    <div style={{ width: 20, height: 20, borderRadius: "50%", border: "1.5px solid #d1d5db", flexShrink: 0 }} />
                    <div style={{ height: 7, borderRadius: 99, background: "#e2e8f0", flex: 1 }} />
                  </div>)}
                </SectionCard>
                <div style={{ position: "relative" }}>
                <SectionCard>
                  <div style={{ display: "inline-block", background: "#3B82F6", color: "#fff", borderRadius: 99, padding: "5px 14px", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Next Actions</div>
                  {(() => {
                    const linked = (tasks || []).filter(t => t.linkedGoalId === g.id && !t.done);
                    return (
                      <div style={{ display: "contents" }}>
                        {linked.length > 0 && <button onClick={(e) => { e.stopPropagation(); setGoalExpandActions(g.id); }}
                          style={{ position: "absolute", bottom: 4, right: 4, width: 22, height: 22, borderRadius: 4, border: "none", background: "rgba(255,255,255,0.9)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#64748b", boxShadow: "0 1px 3px rgba(0,0,0,0.12)" }}
                          title="View all next actions">⛶</button>}
                        {linked.map(t => {
                          const assigneeMember = (orgMembers || []).find(m => m.email === t.assignedTo);
                          return (
                            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, position: "relative" }}>
                              <div onClick={(e) => { e.stopPropagation(); if (setTasks) setTasks(prev => prev.map(x => x.id === t.id ? { ...x, done: !x.done } : x)); }}
                                style={{ width: 18, height: 18, borderRadius: "50%", flexShrink: 0, cursor: "pointer", border: t.done ? "none" : "1.5px solid #d1d5db", background: t.done ? "#4CAF7D" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 9 }}>{t.done ? "✓" : ""}</div>
                              <span style={{ fontSize: 12, color: "#1a2332", flex: 1, textDecoration: t.done ? "line-through" : "none", minWidth: 0 }}>{t.text}</span>
                              {assigneeMember ? (
                                assigneeMember.avatarUrl
                                  ? <img src={assigneeMember.avatarUrl} alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                                  : <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#94a3b8", flexShrink: 0 }}>
                                      {(assigneeMember.name?.[0] || assigneeMember.email[0] || "?").toUpperCase()}
                                    </div>
                              ) : null}
                              <div onClick={(e) => { e.stopPropagation(); goalMenuTriggerElRef.current = e.currentTarget as HTMLElement; setGoalMenuTaskId(goalMenuTaskId === t.id ? null : t.id); }} style={{ width: 22, height: 22, borderRadius: "50%", background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 9, color: "#94a3b8", flexShrink: 0 }}>···</div>
                              {goalMenuTaskId === t.id && (
                                <div ref={goalMenuRef} style={{ ...goalMenuPos, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid #e2e8f0", zIndex: 100, minWidth: 150, overflow: "hidden" }}>
                                  <div style={{ padding: "7px 12px", fontSize: 11, fontWeight: 600, color: "#64748b", borderBottom: "1px solid #f1f5f9" }}>Assign To</div>
                                  {(orgMembers || []).filter(m => m.status === "active").map(m => (
                                    <div key={m.id} onClick={() => { setTasks?.(prev => prev.map(x => x.id === t.id ? { ...x, assignedTo: m.email } : x)); setGoalMenuTaskId(null); }}
                                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", cursor: "pointer", background: t.assignedTo === m.email ? "#EFF6FF" : "transparent", fontSize: 11, color: "#1a2332" }}
                                      onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                                      onMouseLeave={e => e.currentTarget.style.background = t.assignedTo === m.email ? "#EFF6FF" : "transparent"}>
                                      {m.avatarUrl ? <img src={m.avatarUrl} alt="" style={{ width: 18, height: 18, borderRadius: "50%", objectFit: "cover" }} />
                                        : <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, fontWeight: 700, color: "#94a3b8" }}>{(m.name?.[0] || m.email[0] || "?").toUpperCase()}</div>}
                                      <span style={{ flex: 1 }}>{m.name || m.email.split("@")[0]}</span>
                                      {t.assignedTo === m.email && <span style={{ fontSize: 10, color: "#3B82F6" }}>✓</span>}
                                    </div>
                                  ))}
                                  <div style={{ borderTop: "1px solid #f1f5f9" }}>
                                    <div style={{ padding: "7px 12px", fontSize: 11, fontWeight: 600, color: "#64748b" }}>Due Date</div>
                                    <div style={{ padding: "0 12px 7px" }}>
                                      <input type="date" value={t.dueDate || ""} onChange={e => { setTasks?.(prev => prev.map(x => x.id === t.id ? { ...x, dueDate: e.target.value || undefined } : x)); setGoalMenuTaskId(null); }}
                                        style={{ width: "100%", padding: "4px 6px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 11, outline: "none", boxSizing: "border-box" }} />
                                    </div>
                                  </div>
                                  <div onClick={() => { setTasks?.(prev => prev.filter(x => x.id !== t.id)); setGoalMenuTaskId(null); }}
                                    style={{ padding: "8px 12px", fontSize: 11, cursor: "pointer", color: "#E85D75", borderTop: "1px solid #f1f5f9" }}
                                    onMouseEnter={e => e.currentTarget.style.background = "#fff5f5"}
                                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>Delete</div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {linked.length === 0 && !goalAddTask && <div style={{ fontSize: 12, color: "#cbd5e1", fontStyle: "italic" }}>No actions yet</div>}
                        {goalAddTask?.goalId === g.id ? (
                          <div style={{ marginTop: 6 }}>
                            <input value={goalAddTask.text} onChange={e => setGoalAddTask({ ...goalAddTask, text: e.target.value })} placeholder="New action..."
                              onKeyDown={e => { if (e.key === "Enter" && goalAddTask.text.trim() && setTasks && userEmail) { setTasks(prev => [...prev, { id: crypto.randomUUID(), text: goalAddTask.text.trim(), done: false, assignedTo: goalAddTask.assignee || userEmail, createdBy: userEmail, linkedGoalId: g.id, createdAt: new Date().toISOString(), dueDate: goalAddTask.dueDate || undefined }]); setGoalAddTask(null); } }}
                              autoFocus style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1.5px solid #3B82F6", fontSize: 12, outline: "none", boxSizing: "border-box", marginBottom: 6 }} />
                            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                              <select value={goalAddTask.assignee} onChange={e => setGoalAddTask({ ...goalAddTask, assignee: e.target.value })}
                                style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 11, outline: "none", background: "#fff" }}>
                                <option value={userEmail}>Me</option>
                                {(orgMembers || []).filter(m => m.status === "active" && m.email !== userEmail).map(m => (
                                  <option key={m.id} value={m.email}>{m.name || m.email.split("@")[0]}</option>
                                ))}
                              </select>
                              <input type="date" value={goalAddTask.dueDate} onChange={e => setGoalAddTask({ ...goalAddTask, dueDate: e.target.value })}
                                style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 11, outline: "none", boxSizing: "border-box" }} />
                            </div>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button onClick={() => { if (goalAddTask.text.trim() && setTasks && userEmail) { setTasks(prev => [...prev, { id: crypto.randomUUID(), text: goalAddTask.text.trim(), done: false, assignedTo: goalAddTask.assignee || userEmail, createdBy: userEmail, linkedGoalId: g.id, createdAt: new Date().toISOString(), dueDate: goalAddTask.dueDate || undefined }]); setGoalAddTask(null); } }}
                                disabled={!goalAddTask.text.trim()}
                                style={{ flex: 1, padding: "5px 14px", borderRadius: 6, border: "none", background: goalAddTask.text.trim() ? "#3B82F6" : "#e2e8f0", color: "#fff", fontSize: 11, fontWeight: 600, cursor: goalAddTask.text.trim() ? "pointer" : "not-allowed" }}>Add</button>
                              <button onClick={() => setGoalAddTask(null)} style={{ flex: 1, padding: "5px 14px", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 11, cursor: "pointer", color: "#64748b" }}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div onClick={() => setGoalAddTask({ goalId: g.id, text: "", assignee: userEmail || "", dueDate: "" })} style={{ fontSize: 12, color: "#3B82F6", cursor: "pointer", fontWeight: 600, marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
                            <span style={{ fontSize: 14 }}>+</span> Add Task
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </SectionCard>
                </div>
              </div>
            </div>
          )}
        </div>
        {goalExpandActions === g.id && (
          <div onClick={() => setGoalExpandActions(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: "90vw", maxWidth: 600, maxHeight: "90vh", overflow: "auto", position: "relative" }}>
              <button onClick={() => setGoalExpandActions(null)}
                style={{ position: "absolute", top: 12, right: 16, width: 28, height: 28, borderRadius: "50%", border: "none", background: "#f1f5f9", cursor: "pointer", fontSize: 16, color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332", marginBottom: 20 }}>Next Actions — {g.label}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {(tasks || []).filter(t => t.linkedGoalId === g.id && !t.done).map(t => {
                  const assigneeMember = (orgMembers || []).find(m => m.email === t.assignedTo);
                  return (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: "#fff", border: "1px solid #f1f5f9", position: "relative" }}>
                      <div onClick={(e) => { e.stopPropagation(); if (setTasks) setTasks(prev => prev.map(x => x.id === t.id ? { ...x, done: !x.done } : x)); }} style={{ width: 18, height: 18, borderRadius: "50%", flexShrink: 0, cursor: "pointer", border: t.done ? "none" : "1.5px solid #d1d5db", background: t.done ? "#4CAF7D" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 9 }}>{t.done ? "✓" : ""}</div>
                      <span style={{ fontSize: 13, color: "#1a2332", flex: 1, minWidth: 0 }}>{t.text}</span>
                      {assigneeMember ? (
                        assigneeMember.avatarUrl
                          ? <img src={assigneeMember.avatarUrl} alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                          : <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#94a3b8", flexShrink: 0 }}>
                              {(assigneeMember.name?.[0] || assigneeMember.email[0] || "?").toUpperCase()}
                            </div>
                      ) : null}
                      <div onClick={(e) => { e.stopPropagation(); goalMenuTriggerElRef.current = e.currentTarget as HTMLElement; setGoalMenuTaskId(goalMenuTaskId === t.id ? null : t.id); }} style={{ width: 22, height: 22, borderRadius: "50%", background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 9, color: "#94a3b8", flexShrink: 0 }}>···</div>
                      {goalMenuTaskId === t.id && (
                        <div ref={goalMenuRef} style={{ ...goalMenuPos, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid #e2e8f0", zIndex: 100, minWidth: 150, overflow: "hidden" }}>
                          <div style={{ padding: "7px 12px", fontSize: 11, fontWeight: 600, color: "#64748b", borderBottom: "1px solid #f1f5f9" }}>Assign To</div>
                          {(orgMembers || []).filter(m => m.status === "active").map(m => (
                            <div key={m.id} onClick={() => { setTasks?.(prev => prev.map(x => x.id === t.id ? { ...x, assignedTo: m.email } : x)); setGoalMenuTaskId(null); }}
                              style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", cursor: "pointer", background: t.assignedTo === m.email ? "#EFF6FF" : "transparent", fontSize: 11, color: "#1a2332" }}
                              onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                              onMouseLeave={e => e.currentTarget.style.background = t.assignedTo === m.email ? "#EFF6FF" : "transparent"}>
                              {m.avatarUrl ? <img src={m.avatarUrl} alt="" style={{ width: 18, height: 18, borderRadius: "50%", objectFit: "cover" }} />
                                : <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, fontWeight: 700, color: "#94a3b8" }}>{(m.name?.[0] || m.email[0] || "?").toUpperCase()}</div>}
                              <span style={{ flex: 1 }}>{m.name || m.email.split("@")[0]}</span>
                              {t.assignedTo === m.email && <span style={{ fontSize: 10, color: "#3B82F6" }}>✓</span>}
                            </div>
                          ))}
                          <div style={{ borderTop: "1px solid #f1f5f9" }}>
                            <div style={{ padding: "7px 12px", fontSize: 11, fontWeight: 600, color: "#64748b" }}>Due Date</div>
                            <div style={{ padding: "0 12px 7px" }}>
                              <input type="date" value={t.dueDate || ""} onChange={e => { setTasks?.(prev => prev.map(x => x.id === t.id ? { ...x, dueDate: e.target.value || undefined } : x)); setGoalMenuTaskId(null); }}
                                style={{ width: "100%", padding: "4px 6px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 11, outline: "none", boxSizing: "border-box" }} />
                            </div>
                          </div>
                          <div onClick={() => { setTasks?.(prev => prev.filter(x => x.id !== t.id)); setGoalMenuTaskId(null); }}
                            style={{ padding: "8px 12px", fontSize: 11, cursor: "pointer", color: "#E85D75", borderTop: "1px solid #f1f5f9" }}
                            onMouseEnter={e => e.currentTarget.style.background = "#fff5f5"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>Delete</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {goalAddTask?.goalId === g.id ? (
                <div style={{ marginTop: 12 }}>
                  <input value={goalAddTask.text} onChange={e => setGoalAddTask({ ...goalAddTask, text: e.target.value })} placeholder="New action..."
                    onKeyDown={e => { if (e.key === "Enter" && goalAddTask.text.trim() && setTasks && userEmail) { setTasks(prev => [...prev, { id: crypto.randomUUID(), text: goalAddTask.text.trim(), done: false, assignedTo: goalAddTask.assignee || userEmail, createdBy: userEmail, linkedGoalId: g.id, createdAt: new Date().toISOString(), dueDate: goalAddTask.dueDate || undefined }]); setGoalAddTask(null); } }}
                    style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none", boxSizing: "border-box", marginBottom: 6 }} />
                  <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                    <select value={goalAddTask.assignee} onChange={e => setGoalAddTask({ ...goalAddTask, assignee: e.target.value })}
                      style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 11, outline: "none", background: "#fff" }}>
                      <option value={userEmail}>Me</option>
                      {(orgMembers || []).filter(m => m.status === "active" && m.email !== userEmail).map(m => (
                        <option key={m.id} value={m.email}>{m.name || m.email.split("@")[0]}</option>
                      ))}
                    </select>
                    <input type="date" value={goalAddTask.dueDate} onChange={e => setGoalAddTask({ ...goalAddTask, dueDate: e.target.value })}
                      style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 11, outline: "none", boxSizing: "border-box" }} />
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => { if (goalAddTask.text.trim() && setTasks && userEmail) { setTasks(prev => [...prev, { id: crypto.randomUUID(), text: goalAddTask.text.trim(), done: false, assignedTo: goalAddTask.assignee || userEmail, createdBy: userEmail, linkedGoalId: g.id, createdAt: new Date().toISOString(), dueDate: goalAddTask.dueDate || undefined }]); setGoalAddTask(null); } }}
                      disabled={!goalAddTask.text.trim()}
                      style={{ flex: 1, padding: "5px 14px", borderRadius: 6, border: "none", background: goalAddTask.text.trim() ? "#3B82F6" : "#e2e8f0", color: "#fff", fontSize: 11, fontWeight: 600, cursor: goalAddTask.text.trim() ? "pointer" : "not-allowed" }}>Add</button>
                    <button onClick={() => setGoalAddTask(null)} style={{ flex: 1, padding: "5px 14px", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 11, cursor: "pointer", color: "#64748b" }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div onClick={() => setGoalAddTask({ goalId: g.id, text: "", assignee: userEmail || "", dueDate: "" })} style={{ fontSize: 12, color: "#3B82F6", cursor: "pointer", fontWeight: 600, marginTop: 12, display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 14 }}>+</span> Add Task
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderSection = (key: string, label: string, items: Goal[]) => (
    <div style={{ marginBottom: 16 }}>
      <div onClick={() => toggleSection(key)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "8px 0", userSelect: "none" }}>
        <span style={{ fontSize: 11, color: collapsed[key] ? "#3B82F6" : "#64748b", transition: "transform 0.2s", transform: collapsed[key] ? "rotate(-90deg)" : "rotate(0deg)" }}>▼</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#1a2332" }}>{label}</span>
        <span style={{ fontSize: 11, color: "#94a3b8", background: "#f1f5f9", padding: "1px 8px", borderRadius: 99 }}>{items.length}</span>
      </div>
      {!collapsed[key] && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.length === 0 ? (
            <div style={{ padding: "20px 0", textAlign: "center", fontSize: 12, color: "#94a3b8" }}>
              {key === "active" ? "No active goals. Create one!" : key === "drafted" ? "No drafted goals." : "No completed goals."}
            </div>
          ) : items.map(renderGoalCard)}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ padding: "clamp(16px,4vw,32px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: "clamp(20px,4vw,26px)", fontWeight: 700, color: "#1a2332" }}>Goals</h1>
        <button onClick={onOpenOnboarding} style={{ padding: "7px 18px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", marginLeft: "auto" }}>⊕ Add Goal</button>
      </div>
      {renderSection("active", "Active", active)}
      {renderSection("drafted", "Drafted", drafted)}
      {renderSection("completed", "Completed", completed)}

      {/* Completion confirmation dialog */}
      {confirmComplete && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: "28px 32px", maxWidth: 380, textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1a2332", marginBottom: 12 }}>Mark goal as complete?</div>
            <div style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>Are you sure "<strong>{confirmComplete.label}</strong>" is finished?</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button onClick={() => setConfirmComplete(null)} style={{ padding: "10px 24px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 13, cursor: "pointer", color: "#64748b" }}>Cancel</button>
              <button onClick={() => handleCompleteGoal(confirmComplete)} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "#4CAF7D", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Yes, Complete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ONBOARDING: GOAL CREATION
// ═══════════════════════════════════════════════════════════════════════════

function GoalOnboarding({ sections, isMobile, onClose, onCreate }: { sections: Section[]; isMobile?: boolean; onClose: () => void; onCreate: (g: Goal) => void }) {
  const [page, setPage] = useState(0);
  const [goalName, setGoalName] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [goalType, setGoalType] = useState<GoalType | null>(null);
  const [steps, setSteps] = useState<GoalStep[]>([]);
  const [attachedMetrics, setAttachedMetrics] = useState<GoalAttachedMetric[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [aiFilter, setAiFilter] = useState("alltime");

  // target configuration
  const [configMetric, setConfigMetric] = useState<{ sectionLabel: string; metricLabel: string } | null>(null);
  const [configTargetType, setConfigTargetType] = useState<GoalTargetType>("color_rule");
  const [configOp, setConfigOp] = useState<RuleOp>(">=");
  const [configVal, setConfigVal] = useState("");
  const [configVal2, setConfigVal2] = useState("");
  const [configPct, setConfigPct] = useState("");

  const allMetrics = sections.flatMap(s => s.metrics.map(m => ({ sectionLabel: s.title, metricLabel: m.label, value: m.value, color: resolveColor(m) })));
  const filteredMetrics = searchQuery.trim() ? allMetrics.filter(m => m.metricLabel.toLowerCase().includes(searchQuery.toLowerCase())) : [];

  const resetConfig = () => { setConfigMetric(null); setConfigTargetType("color_rule"); setConfigOp(">="); setConfigVal(""); setConfigVal2(""); setConfigPct(""); };

  const confirmStep = () => {
    if (!configMetric) return;
    let target: GoalTarget;
    if (configTargetType === "number_reach") target = { type: "number_reach", operator: configOp, value: parseFloat(configVal) || 0 };
    else if (configTargetType === "number_range") target = { type: "number_range", value: parseFloat(configVal) || 0, value2: parseFloat(configVal2) || 0 };
    else if (configTargetType === "percentage") target = { type: "percentage", percent: Math.min(100, Math.max(0, parseInt(configPct) || 100)) };
    else target = { type: "color_rule" };
    setSteps(p => [...p, { sectionLabel: configMetric.sectionLabel, metricLabel: configMetric.metricLabel, target }]);
    resetConfig();
    setSearchQuery("");
  };

  const step1Complete = !!goalName.trim() && !!goalType;
  const step2Complete = goalType === "metric" ? attachedMetrics.length > 0 : steps.length > 0;
  const step3Complete = true; // filter always selected (has default)

  const canGoNext = () => {
    if (page === 0) return step1Complete;
    if (page === 1) return step2Complete;
    if (page === 2) return step3Complete;
    return true;
  };

  const handleFinish = () => {
    const newGoal = makeGoal({
      label: goalName || "Untitled Goal",
      type: goalType ?? "metric",
      due: dueDate,
      steps: steps,
      attachedMetrics: attachedMetrics,
      aiFilter,
      status: step1Complete && step2Complete && step3Complete ? "active" : "drafted",
    });
    const { pct, barColor } = computeGoalProgress(newGoal, sections);
    newGoal.pct = pct; newGoal.barColor = barColor;
    onCreate(newGoal);
    onClose();
  };

  const handlePage0Next = () => { if (goalType) setPage(1); };

  const stepIndicator = () => (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 0, justifyContent: "center", marginBottom: 16 }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{ display: "flex", alignItems: "center" }}>
            <div onClick={() => { if (i < page || (i === 0 && step1Complete) || (i === 1 && step2Complete)) setPage(i); }}
              style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", cursor: i <= page ? "pointer" : "default",
                background: (i === 0 && step1Complete) || (i === 1 && step2Complete) || i < page ? "#4CAF7D" : i === page ? "#3B82F6" : "#e2e8f0",
                color: i <= page ? "#fff" : "#94a3b8", fontSize: 12, fontWeight: 700, transition: "all 0.2s" }}>
              {(i === 0 && step1Complete) || (i === 1 && step2Complete) || i < page ? <IconGlyph name="Check" size={16} color="#fff" weight="bold" /> : i + 1}
            </div>
            {i < 2 && <div style={{ width: 40, height: 2, background: ((i === 0 && step1Complete) || i < page) ? "#4CAF7D" : "#e2e8f0", transition: "background 0.3s" }} />}
          </div>
        ))}
      </div>
      {/* Current step summary */}
      <div style={{ textAlign: "center" }}>
        {page === 0 && <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332" }}>Step 1: Name, Deadline & Type</div>}
        {page === 1 && <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332" }}>Step 2: {goalType === "metric" ? "Attach Metrics & Set Targets" : "Build Your Goal"}</div>}
        {page === 2 && <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332" }}>Step 3: AI Projections</div>}
        {page === 3 && <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332" }}>Review & Save</div>}
      </div>
    </div>
  );

  const renderPage0 = () => (
    <div style={{ maxWidth: 420, margin: "0 auto", textAlign: "center" }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#1a2332", marginBottom: 4 }}>Create Goal</div>
      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 24 }}>Name your goal and choose a type</div>

      <input autoFocus value={goalName} onChange={e => setGoalName(e.target.value)} placeholder="Goal name..." style={{ width: "100%", padding: "12px 16px", borderRadius: 10, border: "1.5px solid #e2e8f0", fontSize: 14, outline: "none", marginBottom: 14, boxSizing: "border-box" }} />

      <div style={{ textAlign: "left", marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>DEADLINE (optional)</div>
        <input value={dueDate} onChange={e => setDueDate(e.target.value)} type="date" style={{ width: "100%", padding: "12px 16px", borderRadius: 10, border: "1.5px solid #e2e8f0", fontSize: 14, outline: "none", marginBottom: 6, boxSizing: "border-box" }} />
        <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.4, marginBottom: 16 }}>
          Set a deadline to track progress against time. Without a deadline, this becomes an evergreen goal that shows your average health score.
        </div>
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 8, textAlign: "left" }}>GOAL TYPE</div>
      <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 20 }}>
        {(["equation", "metric"] as GoalType[]).map(t => (
          <div key={t} onClick={() => setGoalType(t)} style={{ flex: 1, maxWidth: 200, padding: "20px 16px", borderRadius: 12, border: `2px solid ${goalType === t ? "#3B82F6" : "#e2e8f0"}`, background: goalType === t ? "#EFF6FF" : "#fff", cursor: "pointer", textAlign: "center", transition: "all 0.15s" }}>
            <div style={{ fontSize: 28, marginBottom: 8, display: "flex", justifyContent: "center" }}>
              {t === "equation" ? <IconGlyph name="ChartBar" size={32} color={goalType === t ? "#3B82F6" : "#64748b"} /> : <IconGlyph name="Gauge" size={32} color={goalType === t ? "#3B82F6" : "#64748b"} />}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#1a2332", marginBottom: 4 }}>{t === "equation" ? "Equation Goal" : "Metric Goal"}</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>{t === "equation" ? "Set targets on specific metrics" : "Track average health of metric boxes"}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
        <button onClick={onClose} style={{ padding: "10px 24px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 13, cursor: "pointer", color: "#64748b" }}>Cancel</button>
        <button onClick={handlePage0Next} disabled={!step1Complete} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: step1Complete ? "linear-gradient(135deg,#3B82F6,#06B6D4)" : "#e2e8f0", color: "#fff", fontSize: 13, fontWeight: 600, cursor: step1Complete ? "pointer" : "default" }}>Next →</button>
      </div>
    </div>
  );

  const renderPage1 = () => {
    const isEquationMode = goalType === "equation";

    return (
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#1a2332", marginBottom: 4, textAlign: "center" }}>
          {isEquationMode ? "Set Step Targets" : "Attach Metric Boxes"}
        </div>
        <div style={{ fontSize: 13, color: "#64748b", marginBottom: 24, textAlign: "center" }}>
          {isEquationMode ? "Add steps with targets to track" : "Search and attach metric boxes to track"}
        </div>

        {/* Selected steps / attached metrics */}
        {(isEquationMode ? steps : attachedMetrics).length > 0 && (
          <div style={{ marginBottom: 16 }}>
            {(isEquationMode ? steps : attachedMetrics).map((item: any, i: number) => {
              const m = findMetricByLabel(sections, item.sectionLabel, item.metricLabel);
              const isStep = isEquationMode;
              const met = isStep ? evaluateGoalStep(item as GoalStep, sections) : false;
              const health = !isStep && m ? computeMetricHealth(m) : 0;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "#F8FAFC", borderRadius: 10, marginBottom: 6, fontSize: 13, border: "1px solid #f1f5f9" }}>
                  <span style={{ width: 24, height: 24, borderRadius: "50%", background: "#3B82F6", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
                  <span style={{ flex: 1, color: "#1a2332", fontWeight: 500 }}>{m?.label ?? item.metricLabel}</span>
                  {isStep && <span style={{ color: "#64748b", fontSize: 12 }}>{formatTarget((item as GoalStep).target)}</span>}
                  {!isStep && <span style={{ color: "#64748b", fontSize: 12 }}>{health}%</span>}
                  <span onClick={() => {
                    if (isStep) setSteps(p => p.filter((_, j) => j !== i));
                    else setAttachedMetrics(p => p.filter((_, j) => j !== i));
                  }} style={{ cursor: "pointer", color: "#E85D75", fontSize: 16, flexShrink: 0, marginLeft: 4 }}>×</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Target configuration panel (for equation mode) */}
        {configMetric ? (
          <div style={{ background: "#fff", borderRadius: 12, border: "1.5px solid #3B82F6", padding: 18, marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#1a2332", marginBottom: 12 }}>
              Target for: <span style={{ color: "#3B82F6" }}>{configMetric.metricLabel}</span>
            </div>
            <select value={configTargetType} onChange={e => setConfigTargetType(e.target.value as GoalTargetType)} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none", marginBottom: 10 }}>
              <option value="color_rule">Color Rule</option>
              <option value="number_reach">Number Reached</option>
              <option value="number_range">Number Range Reached</option>
              <option value="percentage">Percentage Reached</option>
            </select>
            {configTargetType === "number_reach" && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                <select value={configOp} onChange={e => setConfigOp(e.target.value as RuleOp)} style={{ padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none" }}>
                  {[">=", "<=", ">", "<", "==", "!="].map(op => <option key={op} value={op}>{op}</option>)}
                </select>
                <input value={configVal} onChange={e => setConfigVal(e.target.value)} type="number" placeholder="Value" style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none" }} />
              </div>
            )}
            {configTargetType === "number_range" && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                <input value={configVal} onChange={e => setConfigVal(e.target.value)} type="number" placeholder="Min" style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none" }} />
                <span style={{ color: "#94a3b8" }}>to</span>
                <input value={configVal2} onChange={e => setConfigVal2(e.target.value)} type="number" placeholder="Max" style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none" }} />
              </div>
            )}
            {configTargetType === "percentage" && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 13, color: "#64748b" }}>≥</span>
                <input value={configPct} onChange={e => setConfigPct(e.target.value)} type="number" placeholder="80" style={{ width: 100, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none" }} />
                <span style={{ fontSize: 13, color: "#64748b" }}>% health</span>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={resetConfig} style={{ padding: "8px 16px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 12, cursor: "pointer", color: "#64748b" }}>Cancel</button>
              <button onClick={confirmStep} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Add Step</button>
            </div>
          </div>
        ) : (
          /* Search */
          <div>
            <input autoFocus value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Start typing the name of a metric box..." style={{ width: "100%", padding: "12px 16px", borderRadius: 10, border: "1.5px solid #e2e8f0", fontSize: 14, outline: "none", marginBottom: 12, boxSizing: "border-box" }} />
            {searchQuery.trim() && (
              <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid #f1f5f9", borderRadius: 10, marginBottom: 12 }}>
                {filteredMetrics.length === 0 ? (
                  <div style={{ padding: 20, textAlign: "center", fontSize: 12, color: "#94a3b8" }}>No metrics found</div>
                ) : filteredMetrics
                  .filter(m => isEquationMode ? !steps.some(s => s.metricLabel === m.metricLabel) : !attachedMetrics.some(a => a.metricLabel === m.metricLabel))
                  .slice(0, 8)
                  .map((m, i) => (
                    <div key={i} onClick={() => {
                      if (isEquationMode) { setConfigMetric({ sectionLabel: m.sectionLabel, metricLabel: m.metricLabel }); setSearchQuery(""); }
                      else { setAttachedMetrics(p => [...p, { sectionLabel: m.sectionLabel, metricLabel: m.metricLabel, trackingMode: "average" }]); setSearchQuery(""); }
                    }} style={{ padding: "12px 14px", borderBottom: i < Math.min(filteredMetrics.length, 8) - 1 ? "1px solid #f1f5f9" : "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, fontSize: 13, color: "#1a2332" }}>
                      <span style={{ width: 10, height: 10, borderRadius: "50%", background: MS[m.color].bg, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontWeight: 500 }}>{m.metricLabel}</span>
                      <span style={{ color: "#94a3b8", fontSize: 12 }}>{m.value}</span>
                      <span style={{ fontSize: 11, color: "#3B82F6", fontWeight: 600, flexShrink: 0 }}>{isEquationMode ? "Select →" : "+ Attach"}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 8 }}>
          <button onClick={() => setPage(0)} style={{ padding: "10px 24px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 13, cursor: "pointer", color: "#64748b" }}>← Back</button>
          <button onClick={() => setPage(2)} disabled={!step2Complete} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: step2Complete ? "linear-gradient(135deg,#3B82F6,#06B6D4)" : "#e2e8f0", color: "#fff", fontSize: 13, fontWeight: 600, cursor: step2Complete ? "pointer" : "default" }}>
            {step2Complete ? "Next →" : isEquationMode ? "Add at least one step" : "Attach at least one metric"}
          </button>
        </div>
      </div>
    );
  };

  const renderPage2 = () => (
    <div style={{ maxWidth: 480, margin: "0 auto" }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#1a2332", marginBottom: 4, textAlign: "center" }}>AI Projections</div>
      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 24, textAlign: "center" }}>Choose how far back to analyze</div>

      <div style={{ background: "#F8FAFC", borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <IconGlyph name="Star" size={20} color="#F5A623" weight="fill" />
          <div style={{ fontSize: 14, fontWeight: 600, color: "#1a2332" }}>Projections Filter</div>
        </div>
        <select value={aiFilter} onChange={e => setAiFilter(e.target.value)} style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none", marginBottom: 12 }}>
          <option value="3months">Past 3 Months</option>
          <option value="7days">Past 7 Days</option>
          <option value="1year">Past Year</option>
          <option value="alltime">All Time</option>
        </select>
        <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5, fontStyle: "italic" }}>
          AI projections will analyze your past data and tasks to predict future trends and keep your business on track.
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
        <button onClick={() => setPage(1)} style={{ padding: "10px 24px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 13, cursor: "pointer", color: "#64748b" }}>← Back</button>
        <button onClick={() => setPage(3)} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Next →</button>
      </div>
    </div>
  );

  const renderPage3 = () => (
    <div style={{ maxWidth: 520, margin: "0 auto" }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#1a2332", marginBottom: 4, textAlign: "center" }}>Review Your Goal</div>
      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 24, textAlign: "center" }}>Check everything looks right before saving</div>

      {/* Goal header */}
      <div style={{ background: "#fff", borderRadius: 12, border: "1.5px solid #e2e8f0", padding: 18, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ flex: 1, fontSize: 16, fontWeight: 700, color: "#1a2332" }}>{goalName || "Untitled Goal"}</span>
          <div onClick={() => setPage(0)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 2, color: "#94a3b8", fontSize: 11 }}><IconGlyph name="PencilSimple" size={12} color="#94a3b8" /> Edit</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ height: 24, flex: 1, borderRadius: 99, background: "#e5e7eb", overflow: "hidden" }}>
            <div style={{ width: `${0}%`, height: "100%", borderRadius: 99, background: "#94a3b8" }} />
          </div>
          {dueDate && <span style={{ fontSize: 12, color: "#94a3b8" }}>Due: {dueDate}</span>}
          <div onClick={() => setPage(0)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 2, color: "#94a3b8", fontSize: 11 }}><IconGlyph name="PencilSimple" size={12} color="#94a3b8" /></div>
        </div>
      </div>

      {/* Metrics tracking */}
      <div style={{ background: "#fff", borderRadius: 12, border: "1.5px solid #e2e8f0", padding: 18, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "#1a2332" }}>Metrics Tracking This Goal</span>
          <div onClick={() => setPage(1)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 2, color: "#94a3b8", fontSize: 11 }}><IconGlyph name="PencilSimple" size={12} color="#94a3b8" /> Edit</div>
        </div>
        {(goalType === "equation" ? steps : attachedMetrics).length === 0 ? (
          <div style={{ fontSize: 12, color: "#94a3b8", padding: "8px 0" }}>No metrics attached yet</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(goalType === "equation" ? steps : attachedMetrics).map((item: any, i: number) => {
              const m = findMetricByLabel(sections, item.sectionLabel, item.metricLabel);
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#F8FAFC", borderRadius: 8, fontSize: 13 }}>
                  <span style={{ width: 24, height: 24, borderRadius: "50%", background: "#3B82F6", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
                  <span style={{ flex: 1, color: "#1a2332" }}>{m?.label ?? item.metricLabel}</span>
                  {goalType === "equation" && <span style={{ color: "#64748b", fontSize: 12 }}>{formatTarget((item as GoalStep).target)}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Projections */}
      <div style={{ background: "#fff", borderRadius: 12, border: "1.5px solid #e2e8f0", padding: 18, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <IconGlyph name="Star" size={16} color="#F5A623" weight="fill" />
          <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "#1a2332" }}>Projections</span>
          <span style={{ fontSize: 12, color: "#64748b" }}>{aiFilter === "3months" ? "Past 3 Months" : aiFilter === "7days" ? "Past 7 Days" : aiFilter === "1year" ? "Past Year" : "All Time"}</span>
          <div onClick={() => setPage(2)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 2, color: "#94a3b8", fontSize: 11 }}><IconGlyph name="PencilSimple" size={12} color="#94a3b8" /> Edit</div>
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
        <button onClick={() => setPage(2)} style={{ padding: "10px 24px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 13, cursor: "pointer", color: "#64748b" }}>← Back</button>
        <button onClick={handleFinish} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Save Goal</button>
      </div>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: isMobile ? "#fff" : "rgba(0,0,0,0.15)", display: "flex", flexDirection: "column" }}>
      <div style={{ background: "#fff", flex: 1, overflowY: "auto", width: "100%", padding: isMobile ? "20px 16px" : "clamp(24px,4vw,40px)", borderRadius: isMobile ? 0 : 20, maxWidth: isMobile ? "100%" : 640, margin: isMobile ? 0 : "auto", maxHeight: isMobile ? "100dvh" : "90vh", boxShadow: isMobile ? "none" : "0 25px 50px rgba(0,0,0,0.15)" }}>
        {stepIndicator()}
        {page === 0 && renderPage0()}
        {page === 1 && renderPage1()}
        {page === 2 && renderPage2()}
        {page === 3 && renderPage3()}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS MODAL: GOAL
// ═══════════════════════════════════════════════════════════════════════════

function GoalSettingsModal({ goal, sections, isMobile, onSave, onDuplicate, onDelete, onClose }: { goal: Goal; sections: Section[]; isMobile?: boolean; onSave: (g: Goal) => void; onDuplicate: (g: Goal) => void; onDelete: (id: string) => void; onClose: () => void }) {
  const [edited, setEdited] = useState<Goal>({ ...goal, steps: [...goal.steps], attachedMetrics: [...goal.attachedMetrics], manualNotes: [...(goal.manualNotes ?? [])] });
  const [searchQuery, setSearchQuery] = useState("");
  const [configMetric, setConfigMetric] = useState<{ sectionLabel: string; metricLabel: string } | null>(null);
  const [configTargetType, setConfigTargetType] = useState<GoalTargetType>("number_reach");
  const [configOp, setConfigOp] = useState<RuleOp>(">=");
  const [configVal, setConfigVal] = useState("");
  const [configVal2, setConfigVal2] = useState("");
  const [configPct, setConfigPct] = useState("");

  const goalRef = useRef(goal);
  const hasUnsaved = JSON.stringify(edited) !== JSON.stringify(goalRef.current);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsaved) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsaved]);

  const handleClose = () => {
    if (hasUnsaved && !window.confirm("You have unsaved changes. Leave without saving?")) return;
    onClose();
  };

  const allMetrics = sections.flatMap(s => s.metrics.map(m => ({ sectionLabel: s.title, metricLabel: m.label, value: m.value, color: resolveColor(m) })));
  const filteredMetrics = searchQuery.trim() ? allMetrics.filter(m => m.metricLabel.toLowerCase().includes(searchQuery.toLowerCase())) : [];

  const resetConfig = () => { setConfigMetric(null); setConfigTargetType("number_reach"); setConfigOp(">="); setConfigVal(""); setConfigVal2(""); setConfigPct(""); };
  const confirmStep = () => {
    if (!configMetric) return;
    let target: GoalTarget;
    if (configTargetType === "number_reach") target = { type: "number_reach", operator: configOp, value: parseFloat(configVal) || 0 };
    else if (configTargetType === "number_range") target = { type: "number_range", value: parseFloat(configVal) || 0, value2: parseFloat(configVal2) || 0 };
    else if (configTargetType === "percentage") target = { type: "percentage", percent: Math.min(100, Math.max(0, parseInt(configPct) || 100)) };
    else target = { type: "color_rule" };
    setEdited(p => ({ ...p, steps: [...p.steps, { sectionLabel: configMetric.sectionLabel, metricLabel: configMetric.metricLabel, target }] }));
    resetConfig(); setSearchQuery("");
  };

  const { pct: livePct, barColor: liveBarColor } = computeGoalProgress(edited, sections);
  const saveGoal = () => { onSave({ ...edited, pct: livePct, barColor: liveBarColor }); onClose(); };

  const renderTargetConfig = (onConfirm: (target: GoalTarget) => void, onCancel: () => void) => (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332", marginBottom: 10 }}>Target for: <span style={{ color: "#3B82F6" }}>{configMetric?.metricLabel}</span></div>
      <select value={configTargetType} onChange={e => setConfigTargetType(e.target.value as GoalTargetType)} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none", marginBottom: 10 }}>
        <option value="color_rule">Color Rule</option>
        <option value="number_reach">Number Reached</option>
        <option value="number_range">Number Range Reached</option>
        <option value="percentage">Percentage Reached</option>
      </select>
      {configTargetType === "number_reach" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <select value={configOp} onChange={e => setConfigOp(e.target.value as RuleOp)} style={{ padding: "6px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none" }}>
            {[">=", "<=", ">", "<", "==", "!="].map(op => <option key={op} value={op}>{op}</option>)}
          </select>
          <input value={configVal} onChange={e => setConfigVal(e.target.value)} type="number" placeholder="Value" style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none" }} />
        </div>
      )}
      {configTargetType === "number_range" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <input value={configVal} onChange={e => setConfigVal(e.target.value)} type="number" placeholder="Min" style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none" }} />
          <span style={{ color: "#94a3b8" }}>to</span>
          <input value={configVal2} onChange={e => setConfigVal2(e.target.value)} type="number" placeholder="Max" style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none" }} />
        </div>
      )}
      {configTargetType === "percentage" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 13, color: "#64748b" }}>≥</span>
          <input value={configPct} onChange={e => setConfigPct(e.target.value)} type="number" placeholder="80" style={{ width: 100, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none" }} />
          <span style={{ fontSize: 13, color: "#64748b" }}>% health</span>
        </div>
      )}
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{ padding: "6px 14px", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 11, cursor: "pointer", color: "#64748b" }}>Cancel</button>
        <button onClick={() => {
          let target: GoalTarget;
          if (configTargetType === "number_reach") target = { type: "number_reach", operator: configOp, value: parseFloat(configVal) || 0 };
          else if (configTargetType === "number_range") target = { type: "number_range", value: parseFloat(configVal) || 0, value2: parseFloat(configVal2) || 0 };
          else if (configTargetType === "percentage") target = { type: "percentage", percent: Math.min(100, Math.max(0, parseInt(configPct) || 100)) };
          else target = { type: "color_rule" };
          onConfirm(target);
        }} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Add Step</button>
      </div>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: isMobile ? "#fff" : "rgba(0,0,0,0.15)", display: "flex", flexDirection: "column" }}>
      <div style={{ background: "#fff", flex: 1, overflowY: "auto", width: "100%", padding: isMobile ? "20px 16px" : "clamp(24px,4vw,40px)", borderRadius: isMobile ? 0 : 20, maxWidth: isMobile ? "100%" : 640, margin: isMobile ? 0 : "auto", maxHeight: isMobile ? "100dvh" : "90vh", boxShadow: isMobile ? "none" : "0 25px 50px rgba(0,0,0,0.15)" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <button onClick={handleClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#64748b", padding: 0 }}>×</button>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2332", flex: 1 }}>Goal Settings</div>
        </div>

        {/* Name & Due Date */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>LABEL</div>
            <input value={edited.label} onChange={e => setEdited(p => ({ ...p, label: e.target.value }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>DUE DATE</div>
            <input value={edited.due} onChange={e => setEdited(p => ({ ...p, due: e.target.value }))} type="date" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
          </div>
        </div>

        {/* Type & Status */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>TYPE</div>
            <select value={edited.type} onChange={e => setEdited(p => ({ ...p, type: e.target.value as GoalType }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none" }}>
              <option value="equation">Equation Goal</option>
              <option value="metric">Metric Goal</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>STATUS</div>
            <select value={edited.status} onChange={e => setEdited(p => ({ ...p, status: e.target.value as GoalStatus }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none" }}>
              <option value="active">Active</option>
              <option value="drafted">Drafted</option>
              <option value="completed">Completed</option>
            </select>
          </div>
        </div>

        {/* Steps section (for equation type) */}
        {edited.type === "equation" && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 6 }}>STEPS ({edited.steps.length})</div>
            {edited.steps.map((s, i) => {
              const m = findMetricByLabel(sections, s.sectionLabel, s.metricLabel);
              const met = evaluateGoalStep(s, sections);
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: met ? "#ECFDF5" : "#FEF2F2", borderRadius: 8, marginBottom: 4, fontSize: 13 }}>
                  <span style={{ fontWeight: 600, color: "#3B82F6", minWidth: 20 }}>{i + 1}.</span>
                  <span style={{ flex: 1, color: "#1a2332" }}>{m?.label ?? s.metricLabel}</span>
                  <span style={{ color: "#64748b", fontSize: 12 }}>{formatTarget(s.target)}</span>
                  <span style={{ display: "flex", alignItems: "center" }}>{met ? <IconGlyph name="CheckCircle" size={14} color="#059669" weight="fill" /> : <IconGlyph name="XCircle" size={14} color="#DC2626" weight="fill" />}</span>
                  <span onClick={() => setEdited(p => ({ ...p, steps: p.steps.filter((_, j) => j !== i) }))} style={{ cursor: "pointer", color: "#E85D75", fontSize: 16 }}>×</span>
                </div>
              );
            })}
            {configMetric ? renderTargetConfig(
              (target) => { setEdited(p => ({ ...p, steps: [...p.steps, { sectionLabel: configMetric.sectionLabel, metricLabel: configMetric.metricLabel, target }] })); resetConfig(); setSearchQuery(""); },
              resetConfig
            ) : (
              <div style={{ marginTop: 8 }}>
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search to add a metric step..." style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                {searchQuery.trim() && (
                  <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid #f1f5f9", borderRadius: 8, marginTop: 4 }}>
                    {filteredMetrics.length === 0 ? (
                      <div style={{ padding: 14, textAlign: "center", fontSize: 12, color: "#94a3b8" }}>No metrics found</div>
                    ) : filteredMetrics.map((m, i) => (
                      <div key={i} onClick={() => { setConfigMetric({ sectionLabel: m.sectionLabel, metricLabel: m.metricLabel }); setSearchQuery(""); }} style={{ padding: "8px 12px", borderBottom: i < filteredMetrics.length - 1 ? "1px solid #f1f5f9" : "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "#1a2332" }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: MS[m.color].bg, flexShrink: 0 }} />
                        <span style={{ flex: 1 }}>{m.metricLabel}</span>
                        <span style={{ color: "#94a3b8" }}>{m.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Attached metrics (for metric type) */}
        {edited.type === "metric" && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 6 }}>ATTACHED METRICS</div>
            {edited.attachedMetrics.map((a, i) => {
              const m = findMetricByLabel(sections, a.sectionLabel, a.metricLabel);
              const health = m ? computeMetricHealth(m) : 0;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#F8FAFC", borderRadius: 8, marginBottom: 4, fontSize: 13 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: health >= 80 ? "#4CAF7D" : health >= 50 ? "#F5A623" : "#E85D75", flexShrink: 0 }} />
                  <span style={{ flex: 1, color: "#1a2332" }}>{m?.label ?? a.metricLabel}</span>
                  <span style={{ color: "#64748b", fontSize: 12 }}>{health}%</span>
                  <select value={a.trackingMode} onChange={e => { const v = e.target.value as GoalTrackingMode; setEdited(p => ({ ...p, attachedMetrics: p.attachedMetrics.map((x, j) => j === i ? { ...x, trackingMode: v } : x) })); }} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 11, outline: "none" }}>
                    <option value="average">Average</option>
                    <option value="off">Off</option>
                    <option value="direct">Direct</option>
                    <option value="health_over_time">Health Over Time</option>
                  </select>
                  <span onClick={() => setEdited(p => ({ ...p, attachedMetrics: p.attachedMetrics.filter((_, j) => j !== i) }))} style={{ cursor: "pointer", color: "#E85D75", fontSize: 16 }}>×</span>
                </div>
              );
            })}
            <div style={{ marginTop: 8 }}>
              <input value={searchQuery} onChange={e => { setSearchQuery(e.target.value); }} placeholder="Start typing the name of a metric box..." style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
              {searchQuery.trim() && (
                <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid #f1f5f9", borderRadius: 8, marginTop: 4 }}>
                  {filteredMetrics.filter(m => !edited.attachedMetrics.some(a => a.metricLabel === m.metricLabel)).length === 0 ? (
                    <div style={{ padding: 14, textAlign: "center", fontSize: 12, color: "#94a3b8" }}>No metrics found</div>
                  ) : filteredMetrics.filter(m => !edited.attachedMetrics.some(a => a.metricLabel === m.metricLabel)).map((mmm, i) => (
                    <div key={i} onClick={() => { setEdited(p => ({ ...p, attachedMetrics: [...p.attachedMetrics, { sectionLabel: mmm.sectionLabel, metricLabel: mmm.metricLabel, trackingMode: "average" }] })); setSearchQuery(""); }} style={{ padding: "8px 12px", borderBottom: i < filteredMetrics.length - 1 ? "1px solid #f1f5f9" : "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "#1a2332" }}>
                      <span style={{ width: 10, height: 10, borderRadius: "50%", background: MS[mmm.color].bg, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontWeight: 500 }}>{mmm.metricLabel}</span>
                      <span style={{ color: "#94a3b8", fontSize: 12 }}>{mmm.value}</span>
                      <span style={{ fontSize: 11, color: "#3B82F6", fontWeight: 600, flexShrink: 0 }}>+ Attach</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Progress preview */}
        <div style={{ marginTop: 20, padding: "14px 16px", background: "#F8FAFC", borderRadius: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>Progress Preview</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: liveBarColor === "green" ? "#4CAF7D" : liveBarColor === "yellow" ? "#F5A623" : "#E85D75" }}>{livePct}%</span>
          </div>
          <div style={{ height: 24, borderRadius: 99, background: "#e5e7eb", overflow: "hidden" }}>
            <div style={{ width: `${livePct}%`, height: "100%", borderRadius: 99, background: liveBarColor === "green" ? "#4CAF7D" : liveBarColor === "yellow" ? "#F5A623" : "#E85D75", transition: "width 0.3s" }} />
          </div>
        </div>

        {/* Save */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
          <button onClick={handleClose} style={{ padding: "10px 24px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 13, cursor: "pointer", color: "#64748b" }}>Cancel</button>
          <button onClick={saveGoal} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Save</button>
        </div>

        {/* Duplicate & Delete as links (like MetricBoxSettingsModal) */}
        <div style={{ display: "flex", justifyContent: "center", gap: 20, marginTop: 18, paddingTop: 18, borderTop: "1px solid #f1f5f9" }}>
          <div onClick={() => { onDuplicate(makeGoal({ ...edited, label: edited.label + " (copy)", status: "drafted" })); }} style={{ fontSize: 12, color: "#3B82F6", cursor: "pointer", fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>
            <IconGlyph name="Copy" size={14} color="#3B82F6" /> Duplicate Goal
          </div>
          <div onClick={() => { if (confirm("Delete this goal?")) { onDelete(edited.id); onClose(); } }} style={{ fontSize: 12, color: "#E85D75", cursor: "pointer", fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>
            <IconGlyph name="Trash" size={14} color="#E85D75" /> Delete Goal
          </div>
        </div>
      </div>
    </div>
  );
}

const _months = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "Jun.", "Jul.", "Aug.", "Sep.", "Oct.", "Nov.", "Dec."];
function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return `${_months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE: TASKS
// ═══════════════════════════════════════════════════════════════════════════

function TasksPage({ tasks, setTasks, userEmail, orgMembers, teamRows, sections, goals, onViewMetric, onViewGoal, onViewTeamMember }: {
  tasks: Task[]; setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  userEmail: string; orgMembers: OrgMember[]; teamRows: TeamRow[];
  sections: Section[]; goals: Goal[];
  onViewMetric: (id: string) => void; onViewGoal: (id: string) => void;
  onViewTeamMember: (m: OrgMember) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [taskFilter, setTaskFilter] = useState<"current" | "completed">("current");
  const [menuTaskId, setMenuTaskId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [inlineAddText, setInlineAddText] = useState("");
  const [showAddPriority, setShowAddPriority] = useState(false);
  const [priorityAddText, setPriorityAddText] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerElRef = useRef<HTMLElement | null>(null);
  const [menuPos, setMenuPos] = useState<React.CSSProperties>({ position: "absolute", top: 28, right: 0, visibility: "hidden" });
  useLayoutEffect(() => {
    if (!menuTaskId || !menuRef.current || !menuTriggerElRef.current) return;
    const trigger = menuTriggerElRef.current;
    const triggerRect = trigger.getBoundingClientRect();
    const menuWidth = menuRef.current.offsetWidth || 160;
    const menuHeight = menuRef.current.offsetHeight || 200;
    let top = 28;
    let left: number | undefined;
    let rightVal: number | undefined;
    if (triggerRect.right - menuWidth < 8) { left = 0; } else { rightVal = 0; }
    if (triggerRect.top + 28 + menuHeight > window.innerHeight - 8) { top = -(menuHeight + 4); }
    setMenuPos({ position: "absolute", top, left, right: rightVal, visibility: "visible" });
  }, [menuTaskId]);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuTaskId(null); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);

  const toggle = (id: string) => {
    setTasks(tasks.map(t => t.id === id ? { ...t, done: !t.done } : t));
    setMenuTaskId(null);
  };
  const myTasks = tasks.filter(t => t.assignedTo === userEmail);
  const priorityTasks = myTasks.filter(t => t.priority && !t.done);
  const nonPriority = myTasks.filter(t => !t.priority);
  const currentTasks = nonPriority.filter(t => !t.done);
  const completedTasks = nonPriority.filter(t => t.done);
  const doneCount = completedTasks.length;
  const totalCount = myTasks.length;
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  const displayedTasks = taskFilter === "current" ? currentTasks : completedTasks;

  const handleInlineAdd = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || !inlineAddText.trim()) return;
    setTasks(prev => [...prev, {
      id: crypto.randomUUID(), text: inlineAddText.trim(), done: false,
      assignedTo: userEmail, createdBy: userEmail, createdAt: new Date().toISOString(),
    }]);
    setInlineAddText("");
  };

  const getMemberByEmail = (email: string) => orgMembers.find(m => m.email === email);
  const todayStr = new Date().toISOString().split("T")[0];

  const teamMembersWithTasks = orgMembers
    .filter(m => m.status === "active")
    .map(m => ({ member: m, memberTasks: tasks.filter(t => t.assignedTo === m.email && !t.done) }))
    .filter(x => x.memberTasks.length > 0);

  const suggestedTasks = sections.flatMap(s =>
    s.metrics
      .filter(m => m.modal?.suggestions?.length)
      .flatMap(m => m.modal!.suggestions.map((sg: string) => ({ text: sg, metricId: m.id, sectionId: s.id })))
  );

  const addSuggestedTask = (text: string) => {
    setTasks(prev => [...prev, {
      id: crypto.randomUUID(), text, done: false, assignedTo: userEmail,
      createdBy: userEmail, createdAt: new Date().toISOString(),
    }]);
  };

  return (
    <div style={{ padding: "clamp(16px,4vw,32px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: "clamp(20px,4vw,26px)", fontWeight: 700, color: "#1a2332" }}>Tasks</h1>
        <div style={{ marginLeft: "auto" }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
        {/* ── Left Column ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Your Tasks */}
          <div style={{ background: "#fff", borderRadius: 16, padding: "20px", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#1a2332", flex: 1 }}>Your Tasks</h2>
              <div style={{ fontSize: 12, color: "#94a3b8" }}>Overall Progress</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#4CAF7D" }}>{doneCount}/{totalCount}</div>
            </div>
            {/* Progress bar */}
            <div style={{ height: 8, borderRadius: 99, background: "#e2e8f0", marginBottom: 16, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", borderRadius: 99, background: "#4CAF7D", transition: "width 0.3s" }} />
            </div>
            {/* Priorities */}
            {priorityTasks.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#F5A623", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  <span>★ Priorities</span>
                  <span style={{ fontSize: 11, fontWeight: 500, color: "#94a3b8", background: "#f1f5f9", padding: "1px 8px", borderRadius: 99 }}>{priorityTasks.length}</span>
                </div>
                {priorityTasks.map(t => {
                  const assigneeMember = getMemberByEmail(t.assignedTo);
                  const isEditing = editingTaskId === t.id;
                  const isDueToday = t.dueDate === todayStr;
                  return (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 8, background: "#FFF8ED", border: "1px solid #FDE68A", marginBottom: 6, fontSize: 15 }}>
                      <div onClick={() => toggle(t.id)} style={{ width: 24, height: 24, borderRadius: "50%", flexShrink: 0, cursor: "pointer", border: t.done ? "none" : "2px solid #F5A623", background: t.done ? "#4CAF7D" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13 }}>{t.done ? "✓" : ""}</div>
                      {isEditing ? (
                        <input value={editText} onChange={e => setEditText(e.target.value)}
                          onBlur={() => { if (editText.trim()) setTasks(prev => prev.map(x => x.id === t.id ? { ...x, text: editText.trim() } : x)); setEditingTaskId(null); }}
                          onKeyDown={e => { if (e.key === "Enter") { if (editText.trim()) setTasks(prev => prev.map(x => x.id === t.id ? { ...x, text: editText.trim() } : x)); setEditingTaskId(null); } }}
                          autoFocus style={{ flex: 1, padding: "4px 8px", borderRadius: 6, border: "1.5px solid #F5A623", fontSize: 15, outline: "none" }} />
                      ) : (
                        <div onClick={() => { setEditingTaskId(t.id); setEditText(t.text); setMenuTaskId(null); }} style={{ flex: 1, fontSize: 15, color: "#1a2332", fontWeight: 600, textDecoration: t.done ? "line-through" : "none", minWidth: 0, cursor: "text" }}>{t.text}</div>
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, position: "relative" }}>
                        {t.dueDate && <div style={{ fontSize: 12, color: isDueToday ? "#F5A623" : "#94a3b8", fontWeight: isDueToday ? 600 : 400, whiteSpace: "nowrap" }}>{isDueToday ? "Due Today" : formatDate(t.dueDate)}</div>}
                        {(t.linkedMetricId || t.linkedGoalId) && (
                          <div style={{ display: "flex", gap: 4 }}>
                            {t.linkedMetricId && <div onClick={() => onViewMetric(t.linkedMetricId!)} style={{ width: 22, height: 22, borderRadius: "50%", background: "#EFF6FF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                              <IconGlyph name="Eye" size={12} color="#3B82F6" />
                            </div>}
                            {t.linkedGoalId && <div onClick={() => onViewGoal(t.linkedGoalId!)} style={{ width: 22, height: 22, borderRadius: "50%", background: "#F3F0FF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                              <IconGlyph name="Target" size={12} color="#7B68EE" />
                            </div>}
                          </div>
                        )}
                        <div onClick={(e) => { menuTriggerElRef.current = e.currentTarget as HTMLElement; setMenuTaskId(menuTaskId === t.id ? null : t.id); }} style={{ width: 24, height: 24, borderRadius: "50%", background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 11, color: "#94a3b8", flexShrink: 0 }}>···</div>
                        {menuTaskId === t.id && (
                          <div ref={menuRef} style={{ ...menuPos, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid #e2e8f0", zIndex: 100, minWidth: 160, overflow: "hidden" }}>
                            <div style={{ padding: "8px 12px", fontSize: 11, fontWeight: 600, color: "#64748b", borderBottom: "1px solid #f1f5f9" }}>Assign To</div>
                            {orgMembers.filter(m => m.status === "active").map(m => (
                              <div key={m.id} onClick={() => { setTasks(prev => prev.map(x => x.id === t.id ? { ...x, assignedTo: m.email } : x)); setMenuTaskId(null); }}
                                style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", cursor: "pointer", background: t.assignedTo === m.email ? "#EFF6FF" : "transparent" }}
                                onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                                onMouseLeave={e => e.currentTarget.style.background = t.assignedTo === m.email ? "#EFF6FF" : "transparent"}>
                                {m.avatarUrl ? <img src={m.avatarUrl} alt="" style={{ width: 18, height: 18, borderRadius: "50%", objectFit: "cover" }} />
                                  : <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, fontWeight: 700, color: "#94a3b8" }}>{(m.name?.[0] || m.email[0] || "?").toUpperCase()}</div>}
                                <span style={{ fontSize: 12, color: "#1a2332", flex: 1 }}>{m.name || m.email.split("@")[0]}</span>
                                {t.assignedTo === m.email && <span style={{ fontSize: 10, color: "#3B82F6" }}>✓</span>}
                              </div>
                            ))}
                            <div style={{ borderTop: "1px solid #f1f5f9" }}>
                              <div style={{ padding: "7px 12px", fontSize: 11, fontWeight: 600, color: "#64748b" }}>Due Date</div>
                              <div style={{ padding: "0 12px 7px" }}>
                                <input type="date" value={t.dueDate || ""} onChange={e => { setTasks(prev => prev.map(x => x.id === t.id ? { ...x, dueDate: e.target.value || undefined } : x)); setMenuTaskId(null); }}
                                  style={{ width: "100%", padding: "4px 6px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 11, outline: "none", boxSizing: "border-box" }} />
                              </div>
                            </div>
                            <div onClick={() => { setTasks(prev => prev.filter(x => x.id !== t.id)); setMenuTaskId(null); }}
                              style={{ padding: "8px 12px", fontSize: 11, cursor: "pointer", color: "#E85D75", borderTop: "1px solid #f1f5f9" }}
                              onMouseEnter={e => e.currentTarget.style.background = "#fff5f5"}
                              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>Delete</div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {/* Add Priority */}
            {showAddPriority ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", marginBottom: 12, background: "#FFF8ED", borderRadius: 8, border: "1px solid #FDE68A" }}>
                <div style={{ width: 24, height: 24, borderRadius: "50%", border: "2px solid #F5A623", flexShrink: 0 }} />
                <input value={priorityAddText} onChange={e => setPriorityAddText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && priorityAddText.trim()) { setTasks(prev => [...prev, { id: crypto.randomUUID(), text: priorityAddText.trim(), done: false, assignedTo: userEmail, createdBy: userEmail, createdAt: new Date().toISOString(), priority: true }]); setPriorityAddText(""); setShowAddPriority(false); } }}
                  placeholder="Type priority and press Enter..."
                  autoFocus
                  style={{ flex: 1, padding: "6px 8px", borderRadius: 6, border: "1.5px solid #F5A623", fontSize: 15, outline: "none" }} />
                <div onClick={() => { if (priorityAddText.trim()) { setTasks(prev => [...prev, { id: crypto.randomUUID(), text: priorityAddText.trim(), done: false, assignedTo: userEmail, createdBy: userEmail, createdAt: new Date().toISOString(), priority: true }]); setPriorityAddText(""); setShowAddPriority(false); } else { setShowAddPriority(false); } }}
                  style={{ fontSize: 11, color: "#F5A623", cursor: "pointer", fontWeight: 600 }}>Done</div>
              </div>
            ) : (
              <div onClick={() => setShowAddPriority(true)} style={{ display: "flex", alignItems: "center", gap: 8, color: "#F5A623", fontSize: 13, cursor: "pointer", padding: "4px 0", marginBottom: 12, fontWeight: 500 }}>
                <span style={{ fontSize: 16 }}>+</span> Add Priority
              </div>
            )}
            {/* Filter tabs */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <div onClick={() => setTaskFilter("current")} style={{ padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 500, cursor: "pointer", background: taskFilter === "current" ? "#3B82F6" : "#f1f5f9", color: taskFilter === "current" ? "#fff" : "#64748b" }}>
                Current ({currentTasks.length})
              </div>
              <div onClick={() => setTaskFilter("completed")} style={{ padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 500, cursor: "pointer", background: taskFilter === "completed" ? "#3B82F6" : "#f1f5f9", color: taskFilter === "completed" ? "#fff" : "#64748b" }}>
                Completed ({completedTasks.length})
              </div>
            </div>
            {/* Task list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {displayedTasks.length === 0 && (
                <div style={{ fontSize: 12, color: "#cbd5e1", fontStyle: "italic", padding: "12px 0", textAlign: "center" }}>
                  {taskFilter === "current" ? "No current tasks. Add one below!" : "No completed tasks yet."}
                </div>
              )}
              {displayedTasks.map(t => {
                const assigneeMember = getMemberByEmail(t.assignedTo);
                const isEditing = editingTaskId === t.id;
                const isDueToday = t.dueDate === todayStr;
                return (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: t.done ? "#f8fafc" : isDueToday ? "#EFF6FF" : "#fff", border: isDueToday && !t.done ? "1px solid #93C5FD" : "none", opacity: t.done ? 0.6 : 1 }}>
                    <div onClick={() => toggle(t.id)} style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, cursor: "pointer", border: t.done ? "none" : "1.5px solid #d1d5db", background: t.done ? "#4CAF7D" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11 }}>{t.done ? "✓" : ""}</div>
                    {isEditing ? (
                      <input value={editText} onChange={e => setEditText(e.target.value)}
                        onBlur={() => { if (editText.trim()) setTasks(prev => prev.map(x => x.id === t.id ? { ...x, text: editText.trim() } : x)); setEditingTaskId(null); }}
                        onKeyDown={e => { if (e.key === "Enter") { if (editText.trim()) setTasks(prev => prev.map(x => x.id === t.id ? { ...x, text: editText.trim() } : x)); setEditingTaskId(null); } }}
                        autoFocus style={{ flex: 1, padding: "4px 8px", borderRadius: 6, border: "1.5px solid #3B82F6", fontSize: 13, outline: "none" }} />
                    ) : (
                      <div onClick={() => { setEditingTaskId(t.id); setEditText(t.text); setMenuTaskId(null); }} style={{ flex: 1, fontSize: 13, color: "#1a2332", textDecoration: t.done ? "line-through" : "none", minWidth: 0, cursor: "text" }}>{t.text}</div>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, position: "relative" }}>
                      {t.dueDate && <div style={{ fontSize: 11, color: isDueToday ? "#3B82F6" : "#94a3b8", fontWeight: isDueToday ? 600 : 400, whiteSpace: "nowrap" }}>{isDueToday ? "Due Today" : formatDate(t.dueDate)}</div>}
                      {(t.linkedMetricId || t.linkedGoalId) && (
                        <div style={{ display: "flex", gap: 4 }}>
                          {t.linkedMetricId && (
                            <div onClick={() => onViewMetric(t.linkedMetricId!)} style={{ width: 22, height: 22, borderRadius: "50%", background: "#EFF6FF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                              <IconGlyph name="Eye" size={12} color="#3B82F6" />
                            </div>
                          )}
                          {t.linkedGoalId && (
                            <div onClick={() => onViewGoal(t.linkedGoalId!)} style={{ width: 22, height: 22, borderRadius: "50%", background: "#F3F0FF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                              <IconGlyph name="Target" size={12} color="#7B68EE" />
                            </div>
                          )}
                        </div>
                      )}
                      {/* Three-dot menu */}
                      <div onClick={(e) => { menuTriggerElRef.current = e.currentTarget as HTMLElement; setMenuTaskId(menuTaskId === t.id ? null : t.id); }} style={{ width: 24, height: 24, borderRadius: "50%", background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 11, color: "#94a3b8", flexShrink: 0 }}>···</div>
                      {menuTaskId === t.id && (
                        <div ref={menuRef} style={{ ...menuPos, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid #e2e8f0", zIndex: 100, minWidth: 160, overflow: "hidden" }}>
                          <div style={{ padding: "8px 12px", fontSize: 11, fontWeight: 600, color: "#64748b", borderBottom: "1px solid #f1f5f9" }}>Assign To</div>
                          {orgMembers.filter(m => m.status === "active").map(m => (
                            <div key={m.id} onClick={() => { setTasks(prev => prev.map(x => x.id === t.id ? { ...x, assignedTo: m.email } : x)); setMenuTaskId(null); }}
                              style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", cursor: "pointer", background: t.assignedTo === m.email ? "#EFF6FF" : "transparent" }}
                              onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                              onMouseLeave={e => e.currentTarget.style.background = t.assignedTo === m.email ? "#EFF6FF" : "transparent"}>
                              {m.avatarUrl ? <img src={m.avatarUrl} alt="" style={{ width: 20, height: 20, borderRadius: "50%", objectFit: "cover" }} />
                                : <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 700, color: "#94a3b8" }}>{(m.name?.[0] || m.email[0] || "?").toUpperCase()}</div>}
                              <span style={{ fontSize: 12, color: "#1a2332", flex: 1 }}>{m.name || m.email.split("@")[0]}</span>
                              {t.assignedTo === m.email && <span style={{ fontSize: 11, color: "#3B82F6" }}>✓</span>}
                            </div>
                          ))}
                          <div style={{ borderTop: "1px solid #f1f5f9" }}>
                            <div style={{ padding: "8px 12px", fontSize: 11, fontWeight: 600, color: "#64748b" }}>Due Date</div>
                            <div style={{ padding: "0 12px 8px" }}>
                              <input type="date" value={t.dueDate || ""} onChange={e => { setTasks(prev => prev.map(x => x.id === t.id ? { ...x, dueDate: e.target.value || undefined } : x)); setMenuTaskId(null); }}
                                style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 11, outline: "none", boxSizing: "border-box" }} />
                            </div>
                          </div>
                          <div onClick={() => { setTasks(prev => prev.filter(x => x.id !== t.id)); setMenuTaskId(null); }}
                            style={{ padding: "9px 12px", fontSize: 12, cursor: "pointer", color: "#E85D75", borderTop: "1px solid #f1f5f9" }}
                            onMouseEnter={e => e.currentTarget.style.background = "#fff5f5"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>Delete</div>
                        </div>
                      )}
                      {/* Profile photo */}
                      {assigneeMember && (
                        assigneeMember.avatarUrl
                          ? <img src={assigneeMember.avatarUrl} alt="" style={{ width: 24, height: 24, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                          : <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#94a3b8", flexShrink: 0 }}>
                              {(assigneeMember.name?.[0] || assigneeMember.email[0] || "?").toUpperCase()}
                            </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {/* Inline add */}
              {showAdd && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px" }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", border: "1.5px solid #d1d5db", flexShrink: 0 }} />
                  <input value={inlineAddText} onChange={e => setInlineAddText(e.target.value)} onKeyDown={handleInlineAdd}
                    placeholder="Type task and press Enter..."
                    autoFocus
                    onBlur={() => { if (!inlineAddText.trim()) setShowAdd(false); }}
                    style={{ flex: 1, padding: "6px 8px", borderRadius: 6, border: "1.5px solid #3B82F6", fontSize: 13, outline: "none" }} />
                  <div onClick={() => { if (inlineAddText.trim()) { handleInlineAdd({ key: "Enter" } as any); } else { setShowAdd(false); } }}
                    style={{ fontSize: 11, color: "#3B82F6", cursor: "pointer", fontWeight: 600 }}>Done</div>
                </div>
              )}
            </div>
            {taskFilter === "completed" && completedTasks.length > 0 && (
              <div onClick={() => { if (confirm("Delete all completed tasks?")) setTasks(prev => prev.filter(t => !(t.assignedTo === userEmail && t.done))); }}
                style={{ display: "flex", alignItems: "center", gap: 6, color: "#E85D75", fontSize: 12, cursor: "pointer", padding: "8px 0 0", marginTop: 10 }}>
                <IconGlyph name="Archive" size={14} color="#E85D75" /> Archive & Delete
              </div>
            )}
            <div onClick={() => { setShowAdd(true); setTaskFilter("current"); }} style={{ display: "flex", alignItems: "center", gap: 8, color: "#94a3b8", fontSize: 13, cursor: "pointer", padding: "8px 0 0", marginTop: 10 }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", border: "1.5px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: "#94a3b8" }}>+</div>
              Add New Task
            </div>
          </div>

          {/* Suggested Tasks */}
          <div style={{ background: "linear-gradient(135deg,#EFF6FF,#F0FDF4)", borderRadius: 16, border: "1px solid #e2e8f0", padding: "20px", display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#1a2332", marginBottom: 4 }}>Suggested Tasks ✦</div>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12, lineHeight: 1.5 }}>
              These AI tasks are from the metric boxes you have access to. They recommend next steps for your business based on your data to increase the health score of your business.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {suggestedTasks.length === 0 && (
                <div style={{ fontSize: 12, color: "#cbd5e1", fontStyle: "italic", padding: "12px 0", textAlign: "center" }}>No AI suggestions yet. Use metric boxes to generate them.</div>
              )}
              {suggestedTasks.slice(0, 10).map((st, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                  <div onClick={() => addSuggestedTask(st.text)} style={{ width: 24, height: 24, borderRadius: "50%", border: "1.5px solid #3B82F6", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#3B82F6", fontSize: 14, flexShrink: 0, background: "#EFF6FF" }}>+</div>
                  <div style={{ flex: 1, fontSize: 12, color: "#1a2332", minWidth: 0 }}>{st.text}</div>
                  <span onClick={() => onViewMetric(st.metricId)} style={{ fontSize: 10, color: "#3B82F6", cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>
                    View Metrics →
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right Column: Team Tasks ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, color: "#1a2332" }}>Team Tasks</h2>
          {teamMembersWithTasks.length === 0 && (
            <div style={{ fontSize: 12, color: "#cbd5e1", fontStyle: "italic", padding: 20, textAlign: "center" }}>No team tasks yet.</div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignContent: "start" }}>
            {teamMembersWithTasks.map(({ member, memberTasks }) => (
              <div key={member.id} style={{ background: "#fff", borderRadius: 14, padding: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  {member.avatarUrl ? (
                    <img src={member.avatarUrl} alt="" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#94a3b8", flexShrink: 0 }}>
                      {(member.name?.[0] || member.email[0] || "?").toUpperCase()}
                    </div>
                  )}
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#1a2332" }}>{member.name || member.email.split("@")[0]}</div>
                </div>
                <div style={{ padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 500, background: "#3B82F6", color: "#fff", display: "inline-block", marginBottom: 8 }}>Next Actions</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {memberTasks.slice(0, 3).map(t => {
                    const isDueToday = t.dueDate === todayStr;
                    return (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, background: t.done ? "#f8fafc" : isDueToday ? "#EFF6FF" : "#fff", border: isDueToday && !t.done ? "1px solid #93C5FD" : "none", opacity: t.done ? 0.6 : 1 }}>
                      <div onClick={() => toggle(t.id)} style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0, cursor: "pointer", border: t.done ? "none" : "1.5px solid #d1d5db", background: t.done ? "#4CAF7D" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 8 }}>{t.done ? "✓" : ""}</div>
                      <div style={{ flex: 1, fontSize: 12, color: "#1a2332", textDecoration: t.done ? "line-through" : "none", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.text}</div>
                      {t.dueDate && <div style={{ fontSize: 10, color: isDueToday ? "#3B82F6" : "#94a3b8", fontWeight: isDueToday ? 600 : 400, whiteSpace: "nowrap", flexShrink: 0 }}>{isDueToday ? "Due Today" : formatDate(t.dueDate)}</div>}
                    </div>
                    );
                  })}
                  {memberTasks.length > 3 && (
                    <div onClick={() => onViewTeamMember(member)} style={{ fontSize: 11, color: "#3B82F6", cursor: "pointer", fontWeight: 600, padding: "6px 0 0", textAlign: "center", marginTop: 4 }}>
                      View All ({memberTasks.length} tasks) →
                    </div>
                  )}
                  {memberTasks.length <= 3 && memberTasks.length > 0 && (
                    <div onClick={() => onViewTeamMember(member)} style={{ fontSize: 11, color: "#3B82F6", cursor: "pointer", fontWeight: 600, padding: "4px 0 0", textAlign: "center" }}>
                      View All →
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════
// PAGE: INTEGRATIONS
// ═══════════════════════════════════════════════════════════════════════════

const APPS = [
  { id: "asana", name: "Asana", logo: "🟧", color: "#F06A35", connected: true, desc: "Task & project management" },
  { id: "trello", name: "Trello", logo: "🟦", color: "#0052CC", connected: true, desc: "Visual project boards" },
  { id: "analytics", name: "Google Analytics", logo: "📊", color: "#E37400", connected: false, desc: "Website traffic & engagement" },
  { id: "quickbooks", name: "QuickBooks", logo: "🟩", color: "#2CA01C", connected: true, desc: "Accounting & invoicing" },
  { id: "hubspot", name: "HubSpot", logo: "🟠", color: "#FF7A59", connected: false, desc: "CRM & marketing hub" },
  { id: "plaid", name: "Plaid", logo: "🔗", color: "#111827", connected: false, desc: "Bank account linking" },
];

function IntegrationsPage({ onSelectApp }: { onSelectApp: (app: typeof APPS[0]) => void }) {
  const [search, setSearch] = useState("");
  const filtered = APPS.filter(a => a.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <div style={{ padding: "clamp(16px,4vw,32px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: "clamp(20px,4vw,26px)", fontWeight: 700, color: "#1a2332" }}>All Apps <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 400 }}>(Coming Soon)</span></h1>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search apps..."
            style={{ padding: "7px 13px", borderRadius: 20, border: "1px solid #e2e8f0", fontSize: 12, outline: "none", width: 160 }} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 14, marginBottom: 28, opacity: 0.35, pointerEvents: "none", filter: "grayscale(0.7)", userSelect: "none" }}>
        {filtered.map(app => (
          <div key={app.id} onClick={() => onSelectApp(app)} style={{ background: "#fff", borderRadius: 14, padding: 18, border: "1px solid #f1f5f9", cursor: "pointer", transition: "box-shadow 0.15s" }}
            onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.08)")}
            onMouseLeave={e => (e.currentTarget.style.boxShadow = "none")}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 24 }}>{app.logo}</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#1a2332" }}>{app.name}</div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>{app.desc}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 99, fontWeight: 600, background: app.connected ? "#DCFCE7" : "#F1F5F9", color: app.connected ? "#15803D" : "#94a3b8" }}>
                {app.connected ? "Connected" : "Not Connected"}
              </span>
              <span style={{ fontSize: 11, color: "#3B82F6", cursor: "pointer" }}>{app.connected ? "Manage →" : "Connect →"}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ background: "#EEF9F4", border: "1px solid #c3e6d4", borderRadius: 14, padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#0F6E56", marginBottom: 6 }}>🏦 Phase 3: Live Bank Integration via Plaid</div>
        <p style={{ margin: "0 0 10px", fontSize: 12, color: "#1e6b4e", lineHeight: 1.6 }}>Connect your real bank account through Plaid and Dashello will automatically calculate your Five-Account balances.</p>
        <button style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: "#0F6E56", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Connect Bank Account →</button>
      </div>
    </div>
  );
}

function AppDetailPage({ app, onBack }: { app: typeof APPS[0]; onBack: () => void }) {
  return (
    <div style={{ padding: "clamp(16px,4vw,32px)" }}>
      <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: "#3B82F6", fontSize: 13, marginBottom: 16, display: "flex", alignItems: "center", gap: 4 }}>← Back to All Apps</button>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ fontSize: 32 }}>{app.logo}</div>
        <div>
          <h1 style={{ margin: 0, fontSize: "clamp(18px,4vw,24px)", fontWeight: 700, color: "#1a2332" }}>{app.name}</h1>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>{app.desc}</div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          {app.connected
            ? <button style={{ padding: "7px 18px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", fontSize: 12, cursor: "pointer", color: "#E85D75" }}>Disconnect</button>
            : <button style={{ padding: "7px 18px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Connect {app.name}</button>}
        </div>
      </div>
      <SectionCard title="Workflows">
        {["Auto-create tasks from overdue invoices", "Notify team on lead stage change", "Weekly summary to Slack"].map((w, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: i < 2 ? "1px solid #f1f5f9" : "none" }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#4CAF7D", flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: "#1a2332", flex: 1 }}>{w}</span>
            <Toggle on={i < 2} onChange={() => { }} />
          </div>
        ))}
      </SectionCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE: TEAM
// ═══════════════════════════════════════════════════════════════════════════

function TeamPage({ sections, orgMembers, setOrgMembers, teamRows, setTeamRows, teamPermissions, setTeamPermissions, currentUserLevel, userEmail, onOpenInvite, onPreviewMember, onExitPreviewSave, previewFromSave, pendingMemberDetail, onClearPendingMember, tasks, setTasks }: {
  sections: Section[]; orgMembers: OrgMember[]; setOrgMembers: React.Dispatch<React.SetStateAction<OrgMember[]>>;
  teamRows: TeamRow[]; setTeamRows: React.Dispatch<React.SetStateAction<TeamRow[]>>;
  teamPermissions: TeamPermissions[]; setTeamPermissions: React.Dispatch<React.SetStateAction<TeamPermissions[]>>;
  currentUserLevel: OrgPermissionLevel; userEmail: string; onOpenInvite: () => void;
  onPreviewMember?: (member: OrgMember, perms: TeamPermissions) => void;
  onExitPreviewSave?: () => void;
  previewFromSave?: boolean;
  pendingMemberDetail?: OrgMember | null;
  onClearPendingMember?: () => void;
  tasks?: Task[]; setTasks?: React.Dispatch<React.SetStateAction<Task[]>>;
}) {
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [editingTeam, setEditingTeam] = useState<TeamRow | null>(null);
  const [permModalTeam, setPermModalTeam] = useState<TeamRow | null>(null);
  const [permModalMember, setPermModalMember] = useState<OrgMember | null>(null);
  const [transferringFrom, setTransferringFrom] = useState<OrgMember | null>(null);
  const [memberDetail, setMemberDetail] = useState<OrgMember | null>(null);
  const [editingTeamRowId, setEditingTeamRowId] = useState<string | null>(null);
  const [editingTeamRowValue, setEditingTeamRowValue] = useState("");
  useEffect(() => {
    if (pendingMemberDetail) {
      setMemberDetail(pendingMemberDetail);
      onClearPendingMember?.();
    }
  }, [pendingMemberDetail]);
  const isManager = currentUserLevel === "owner" || currentUserLevel === "admin";

  const dragTeamRef = useRef<string | null>(null);
  const [dragOverTeamId, setDragOverTeamId] = useState<string | null>(null);

  const handleTeamDragStart = (id: string) => { dragTeamRef.current = id; };
  const handleTeamDragEnter = (e: React.DragEvent, id: string) => { e.preventDefault(); if (dragTeamRef.current && dragTeamRef.current !== id) setDragOverTeamId(id); };
  const handleTeamDrop = (id: string) => {
    if (!dragTeamRef.current || dragTeamRef.current === id) { dragTeamRef.current = null; setDragOverTeamId(null); return; }
    setTeamRows(prev => {
      const arr = [...prev];
      const fi = arr.findIndex(t => t.id === dragTeamRef.current);
      const ti = arr.findIndex(t => t.id === id);
      if (fi === -1 || ti === -1) return prev;
      const [moved] = arr.splice(fi, 1);
      arr.splice(ti, 0, moved);
      return arr.map((t, i) => ({ ...t, order: i }));
    });
    dragTeamRef.current = null; setDragOverTeamId(null);
  };

  const addTeam = (name: string) => {
    const newId = crypto.randomUUID();
    setTeamRows(prev => [...prev, { id: newId, name, order: prev.length }]);
    setTeamPermissions(prev => [...prev, { teamId: newId, allowedSectionIds: null, metricOverrides: null }]);
  };
  const renameTeam = (id: string, name: string) => {
    setTeamRows(prev => prev.map(t => t.id === id ? { ...t, name } : t));
  };
  const deleteTeam = (id: string) => {
    setTeamRows(prev => prev.filter(t => t.id !== id));
  };
  const handleTransferOwnership = (toMemberId: string) => {
    if (!transferringFrom) return;
    setOrgMembers(prev => prev.map(m => {
      if (m.id === transferringFrom.id) return { ...m, level: "admin" as OrgPermissionLevel };
      if (m.id === toMemberId) return { ...m, level: "owner" as OrgPermissionLevel };
      return m;
    }));
    setTransferringFrom(null);
  };

  const [addMemberTeamId, setAddMemberTeamId] = useState<string | null>(null);
  const [addMemberEmail, setAddMemberEmail] = useState("");
  const [addMemberLevel, setAddMemberLevel] = useState<OrgPermissionLevel>("viewer");

  const handleAddExistingMember = (memberId: string) => {
    if (!addMemberTeamId) return;
    setOrgMembers(prev => prev.map(m => m.id === memberId ? { ...m, teamId: addMemberTeamId! } : m));
    setAddMemberTeamId(null);
  };

  const handleInviteNewMemberToTeam = async () => {
    if (!addMemberTeamId || !addMemberEmail.trim()) return;
    try {
      await inviteTeamMember(addMemberEmail.trim(), "", addMemberLevel, "A team member");
      setOrgMembers(prev => [...prev, {
        id: crypto.randomUUID(), email: addMemberEmail.trim(), name: "", avatarUrl: "",
        level: addMemberLevel, status: "invited" as const, teamId: addMemberTeamId,
      }]);
      setAddMemberTeamId(null); setAddMemberEmail(""); setAddMemberLevel("viewer");
    } catch (err: any) {
      alert(err.message);
    }
  };

  const sortedTeams = [...teamRows].sort((a, b) => a.order - b.order);

  const MEMBER_COLORS: Record<string, string> = { owner: "#F5A623", admin: "#7B68EE", editor: "#48C78E", viewer: "#4C9FE8" };

  // Compute section/metric access for a member based on their team's permissions
  const computeMemberAccess = (member: OrgMember) => {
    const perms = teamPermissions.find(p => p.teamId === member.teamId);
    if (!perms) return { allowedSections: sections, metricCount: sections.reduce((sum, s) => sum + s.metrics.length, 0) };
    const allowedSections = perms.allowedSectionIds === null
      ? sections
      : sections.filter(s => perms.allowedSectionIds!.includes(s.id));
    let metricCount = 0;
    for (const s of allowedSections) {
      const override = perms.metricOverrides?.find(m => m.sectionId === s.id);
      if (!override || override.allowedMetricIds === null) {
        metricCount += s.metrics.length;
      } else {
        metricCount += override.allowedMetricIds.length;
      }
    }
    return { allowedSections, metricCount };
  };

  const handleResendInvite = async (member: OrgMember) => {
    try {
      await inviteTeamMember(member.email, "", member.level, "A team member");
    } catch (err: any) {
      console.error("Resend invite failed:", err.message);
    }
  };

  return (
    <div style={{ padding: "clamp(16px,4vw,32px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: "clamp(20px,4vw,26px)", fontWeight: 700, color: "#1a2332" }}>Team</h1>
        {isManager && (
          <button onClick={onOpenInvite} style={{ padding: "7px 18px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", marginLeft: "auto" }}>+ Add Team Member</button>
        )}
      </div>

      {sortedTeams.length === 0 && isManager && (
        <div style={{ textAlign: "center", padding: 40, color: "#94a3b8", fontSize: 14 }}>
          No teams yet. Create one below.
        </div>
      )}

      {/* Team rows - dashboard-style */}
      {sortedTeams.map(team => {
        const membersInTeam = orgMembers.filter(m => m.teamId === team.id && m.status === "active");
        const pendingInTeam = orgMembers.filter(m => m.teamId === team.id && m.status === "invited");
        return (
          <div key={team.id}
            onDragEnter={isManager ? (e) => handleTeamDragEnter(e, team.id) : undefined}
            onDragOver={isManager ? (e) => e.preventDefault() : undefined}
            onDrop={isManager ? () => handleTeamDrop(team.id) : undefined}
            style={{
              marginBottom: 28,
              position: "relative",
              borderRadius: 8,
              outline: dragOverTeamId === team.id ? "2px dashed #3B82F6" : "none",
              padding: dragOverTeamId === team.id ? "4px" : "0",
            }}
          >
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
              {isManager && (
                <div draggable onDragStart={() => handleTeamDragStart(team.id)}
                  style={{ cursor: "grab", color: "#cbd5e1", fontSize: 15, padding: "0 2px", flexShrink: 0 }}>⠿</div>
              )}
              {editingTeamRowId === team.id ? (
                <input value={editingTeamRowValue} onChange={e => setEditingTeamRowValue(e.target.value)}
                  onBlur={() => { if (editingTeamRowValue.trim() && editingTeamRowValue.trim() !== team.name) renameTeam(team.id, editingTeamRowValue.trim()); setEditingTeamRowId(null); }}
                  onKeyDown={e => { if (e.key === "Enter") { if (editingTeamRowValue.trim() && editingTeamRowValue.trim() !== team.name) renameTeam(team.id, editingTeamRowValue.trim()); setEditingTeamRowId(null); } if (e.key === "Escape") setEditingTeamRowId(null); }}
                  autoFocus style={{ fontSize: "clamp(16px,3vw,20px)", fontWeight: 700, color: "#1a2332", border: "1.5px solid #3B82F6", borderRadius: 6, padding: "2px 6px", outline: "none", width: 200 }} />
              ) : (
                <h2 onClick={() => { setEditingTeamRowId(team.id); setEditingTeamRowValue(team.name); }}
                  style={{ margin: 0, fontSize: "clamp(16px,3vw,20px)", fontWeight: 700, color: "#1a2332", cursor: "text" }}>
                  {team.name}{team.order === 0 ? <span style={{ fontSize: "clamp(11px,2vw,13px)", fontWeight: 400, color: "#94a3b8" }}> (Default)</span> : ""}
                </h2>
              )}
              <div style={{ flex: 1 }} />
              {isManager && (
                <TeamRowMenu
                  isDefault={team.order === 0}
                  onEditPermissions={() => setPermModalTeam(team)}
                  onRename={() => setEditingTeam(team)}
                  onDelete={() => deleteTeam(team.id)}
                />
              )}
            </div>

            {/* Member cards row with plus button */}
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", flex: 1, minHeight: 48 }}>
                {membersInTeam.map(member => {
                  const levelColor = MEMBER_COLORS[member.level] || "#4C9FE8";
                  const isOwner = member.level === "owner";
                  const isSelf = member.email === userEmail;
                  return (
                    <div key={member.id}
                      onClick={() => setMemberDetail(member)}
                      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.boxShadow = "0 10px 28px rgba(0,0,0,0.15)"; }}
                      onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.06)"; }}
                      style={{
                        width: 140, minHeight: 140, borderRadius: 16, background: "#f1f5f9",
                        padding: "14px 10px", display: "flex", flexDirection: "column",
                        alignItems: "center", justifyContent: "flex-start", gap: 10,
                        cursor: "pointer", flexShrink: 0,
                        transition: "transform 0.15s, box-shadow 0.15s",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                        position: "relative",
                      }}
                    >
                      <div style={{ fontSize: 10, fontWeight: 700, color: levelColor, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "center", width: "100%" }}>
                        {isOwner ? "Owner" : member.level}
                      </div>
                      {member.avatarUrl ? (
                        <img src={member.avatarUrl} alt="" style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                      ) : (
                        <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: "#94a3b8", flexShrink: 0 }}>
                          {(member.name?.[0] || member.email[0] || "?").toUpperCase()}
                        </div>
                      )}
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#1a2332", textAlign: "center", width: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {member.name || member.email.split("@")[0]}
                      </div>
                      {isSelf && (
                        <div style={{ background: levelColor, borderRadius: 99, padding: "2px 8px", fontSize: 9, fontWeight: 700, color: "#fff", marginTop: -4 }}>
                          YOU
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Pending members */}
                {pendingInTeam.map(member => (
                  <div key={member.id}
                    style={{
                      width: 140, minHeight: 140, borderRadius: 16,
                      padding: "14px 10px", display: "flex", flexDirection: "column",
                      alignItems: "center", justifyContent: "center", gap: 8,
                      flexShrink: 0, background: "#f8fafc", border: "2px dashed #e2e8f0",
                    }}
                  >
                    <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: "#94a3b8" }}>
                      {(member.email[0] || "?").toUpperCase()}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", textAlign: "center", width: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {member.email.split("@")[0]}
                    </div>
                    <div style={{ fontSize: 9, color: "#94a3b8" }}>Pending</div>
                    {isManager && (
                      <div onClick={(e) => { e.stopPropagation(); handleResendInvite(member); }}
                        style={{ fontSize: 10, color: "#3B82F6", cursor: "pointer", fontWeight: 600 }}>
                        Resend Invite
                      </div>
                    )}
                  </div>
                ))}

                {/* Plus button to add member */}
                {isManager && (
                  <div key="add-member-btn" onClick={() => setAddMemberTeamId(team.id)}
                    style={{
                      width: 44, height: 44, borderRadius: "50%",
                      border: "1.5px solid #e2e8f0",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", color: "#94a3b8", fontSize: 20,
                      alignSelf: "center",
                    }}>+
                  </div>
                )}
              </div>
            </div>

            {/* Separator */}
            <div style={{ height: 1, background: "#f1f5f9", marginTop: 20 }} />
          </div>
        );
      })}

      {/* Add team button */}
      {isManager && (
        <div onClick={() => setShowAddTeam(true)} style={{ display: "flex", alignItems: "center", gap: 8, color: "#94a3b8", fontSize: 13, cursor: "pointer", padding: "6px 0" }}>
          <div style={{ width: 26, height: 26, borderRadius: "50%", border: "1.5px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, color: "#94a3b8" }}>+</div>
          Add Team
        </div>
      )}

      {/* Member detail popup */}
      {memberDetail && (() => {
        const bgColor = MEMBER_COLORS[memberDetail.level] || "#4C9FE8";
        const { allowedSections, metricCount } = computeMemberAccess(memberDetail);
        const isSelf = memberDetail.email === userEmail;
        const otherActiveMembers = orgMembers.filter(m => m.id !== memberDetail.id && m.status === "active");
        const sortedTeamsList = [...teamRows].sort((a, b) => a.order - b.order);
        return (
          <div onClick={() => setMemberDetail(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 16 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "32px", width: "100%", maxWidth: 380, boxShadow: "0 24px 64px rgba(0,0,0,0.18)", textAlign: "center", maxHeight: "90vh", overflowY: "auto" }}>
              <button onClick={() => setMemberDetail(null)} style={{ float: "right", background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8", padding: 0, lineHeight: 1 }}>×</button>
              <div style={{ width: 64, height: 64, borderRadius: "50%", background: bgColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 700, color: "#fff", margin: "0 auto 12px" }}>
                {(memberDetail.name?.[0] || memberDetail.email[0] || "?").toUpperCase()}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2332", marginBottom: 2 }}>{memberDetail.name || memberDetail.email}</div>
              <div style={{ fontSize: 14, color: bgColor, fontWeight: 600, textTransform: "capitalize", marginBottom: 16 }}>{memberDetail.level}</div>
              <div style={{ textAlign: "left", background: "#f8fafc", borderRadius: 12, padding: "14px 16px", marginBottom: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Access</div>
                <div style={{ fontSize: 13, color: "#1a2332", marginBottom: 4 }}>
                  <strong>Rows:</strong> {allowedSections.length > 0 ? allowedSections.map(s => s.title).join(", ") : "None"}
                </div>
                <div style={{ fontSize: 13, color: "#1a2332" }}>
                  <strong>Metrics:</strong> {metricCount}
                </div>
              </div>
              {/* Tasks section */}
              {(tasks || []).filter(t => t.assignedTo === memberDetail.email && !t.done).length > 0 && (
                <div style={{ textAlign: "left", background: "#f8fafc", borderRadius: 12, padding: "14px 16px", marginBottom: 18 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Tasks</div>
                  {(tasks || []).filter(t => t.assignedTo === memberDetail.email && !t.done).map(t => (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <div onClick={(e) => { e.stopPropagation(); if (setTasks) setTasks(prev => prev.map(x => x.id === t.id ? { ...x, done: !x.done } : x)); }}
                        style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0, cursor: "pointer", border: t.done ? "none" : "1.5px solid #d1d5db", background: t.done ? "#4CAF7D" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 8 }}>{t.done ? "✓" : ""}</div>
                      <span style={{ fontSize: 12, color: "#1a2332", flex: 1, textDecoration: t.done ? "line-through" : "none", minWidth: 0 }}>{t.text}</span>
                      {t.dueDate && <span style={{ fontSize: 10, color: "#94a3b8", whiteSpace: "nowrap" }}>{formatDate(t.dueDate)}</span>}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {/* Owner self-view: Transfer Ownership */}
                {isSelf && memberDetail.level === "owner" && currentUserLevel === "owner" && (
                  <button onClick={() => { setTransferringFrom(memberDetail); setMemberDetail(null); }}
                    disabled={otherActiveMembers.length === 0}
                    style={{
                      width: "100%", padding: "10px 0", borderRadius: 8,
                      border: "1.5px solid #E8A317", background: "#fff",
                      color: otherActiveMembers.length === 0 ? "#cbd5e1" : "#E8A317",
                      fontSize: 13, fontWeight: 600, cursor: otherActiveMembers.length === 0 ? "not-allowed" : "pointer",
                    }}>
                    Transfer Ownership{otherActiveMembers.length === 0 ? " (no other members)" : ""}
                  </button>
                )}

                {/* Admin/Owner viewing non-self, non-owner: Edit Permissions */}
                {isManager && !isSelf && memberDetail.level !== "owner" && (
                  <button onClick={() => { setPermModalMember(memberDetail); setMemberDetail(null); }}
                    style={{ width: "100%", padding: "10px 0", borderRadius: 8, border: "1.5px solid #3B82F6", background: "#fff", color: "#3B82F6", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                    Edit Permissions
                  </button>
                )}

                {/* Admin/Owner viewing non-self, non-owner: Change Team */}
                {isManager && !isSelf && memberDetail.level !== "owner" && sortedTeamsList.length > 1 && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <select value={memberDetail.teamId} onChange={e => {
                      setOrgMembers(prev => prev.map(m => m.id === memberDetail.id ? { ...m, teamId: e.target.value } : m));
                      setMemberDetail(null);
                    }}
                      style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none", background: "#fff" }}>
                      {sortedTeamsList.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <span style={{ fontSize: 11, color: "#94a3b8", whiteSpace: "nowrap" }}>Change Team</span>
                  </div>
                )}

                {/* Admin/Owner viewing non-self, non-owner: Delete */}
                {isManager && !isSelf && memberDetail.level !== "owner" && (
                  <button onClick={() => { setOrgMembers(prev => prev.filter(m => m.id !== memberDetail.id)); setMemberDetail(null); }}
                    style={{ width: "100%", padding: "10px 0", borderRadius: 8, border: "1.5px solid #E85D75", background: "#fff", color: "#E85D75", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                    Delete Member
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Transfer Ownership Modal */}
      {transferringFrom && (
        <div onClick={() => setTransferringFrom(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "28px", width: "100%", maxWidth: 400, boxShadow: "0 24px 64px rgba(0,0,0,0.18)" }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 700, color: "#1a2332" }}>Transfer Ownership</h3>
            <p style={{ fontSize: 13, color: "#64748b", marginBottom: 16 }}>Select a team member to become the new owner. You will become an admin.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {orgMembers.filter(m => m.id !== transferringFrom.id && m.status === "active").map(m => (
                <div key={m.id} onClick={() => handleTransferOwnership(m.id)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, border: "1px solid #e2e8f0", cursor: "pointer", background: "#fff" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                  onMouseLeave={e => (e.currentTarget.style.background = "#fff")}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: MEMBER_COLORS[m.level] || "#4C9FE8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
                    {(m.name?.[0] || m.email[0] || "?").toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332" }}>{m.name || m.email}</div>
                    <div style={{ fontSize: 11, color: "#64748b", textTransform: "capitalize" }}>{m.level}</div>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setTransferringFrom(null)} style={{ marginTop: 16, width: "100%", padding: "10px 0", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", color: "#64748b", fontSize: 13, cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Add member to team modal */}
      {addMemberTeamId && (() => {
        const team = teamRows.find(t => t.id === addMemberTeamId);
        const membersNotInTeam = orgMembers.filter(m => m.teamId !== addMemberTeamId && m.status === "active");
        return (
          <div onClick={() => setAddMemberTeamId(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 16 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "28px", width: "100%", maxWidth: 400, boxShadow: "0 24px 64px rgba(0,0,0,0.18)", maxHeight: "90vh", overflowY: "auto" }}>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
                <button onClick={() => setAddMemberTeamId(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8", padding: 0, lineHeight: 1 }}>×</button>
              </div>
              <h3 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#1a2332" }}>Add to {team?.name || "Team"}</h3>
              <p style={{ margin: "0 0 18px", fontSize: 12, color: "#94a3b8" }}>Select an existing member or invite a new one.</p>

              {membersNotInTeam.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Existing Members</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
                    {membersNotInTeam.map(m => (
                      <div key={m.id} onClick={() => handleAddExistingMember(m.id)}
                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10, border: "1px solid #e2e8f0", cursor: "pointer", background: "#fff" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                        onMouseLeave={e => (e.currentTarget.style.background = "#fff")}>
                        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#94a3b8", flexShrink: 0 }}>
                          {(m.name?.[0] || m.email[0] || "?").toUpperCase()}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332" }}>{m.name || m.email.split("@")[0]}</div>
                          <div style={{ fontSize: 11, color: "#64748b", textTransform: "capitalize" }}>{m.level}</div>
                        </div>
                        <div style={{ fontSize: 11, color: "#3B82F6", fontWeight: 600 }}>Add</div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>Invite New Member</div>
                <input value={addMemberEmail} onChange={e => setAddMemberEmail(e.target.value)} placeholder="Email"
                  style={{ width: "100%", padding: "8px 11px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none", boxSizing: "border-box", marginBottom: 8 }} />
                <select value={addMemberLevel} onChange={e => setAddMemberLevel(e.target.value as OrgPermissionLevel)}
                  style={{ width: "100%", padding: "7px 9px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none", background: "#fff", marginBottom: 10 }}>
                  {LEVEL_ORDER.slice(0, LEVEL_ORDER.indexOf(currentUserLevel) + 1).map(l => (
                    <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>
                  ))}
                </select>
                <button onClick={handleInviteNewMemberToTeam}
                  style={{ width: "100%", padding: "9px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  Send Invite
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Add team modal */}
      {showAddTeam && <EditAddRowModal onSave={(name) => { addTeam(name); setShowAddTeam(false); }} onClose={() => setShowAddTeam(false)} />}

      {/* Edit team name modal */}
      {editingTeam && (
        <EditAddRowModal initial={editingTeam.name} onSave={(name) => { renameTeam(editingTeam.id, name); setEditingTeam(null); }} onClose={() => setEditingTeam(null)} />
      )}

      {/* Permissions modal */}
      {permModalTeam && (
        <TeamPermissionsModal
          teamName={permModalTeam.name}
          sections={sections}
          initialPermissions={teamPermissions.find(p => p.teamId === permModalTeam.id) ?? { teamId: permModalTeam.id, allowedSectionIds: null, metricOverrides: null }}
          onSave={(perms) => {
            setTeamPermissions(prev => {
              const existing = prev.findIndex(p => p.teamId === perms.teamId);
              if (existing >= 0) { const next = [...prev]; next[existing] = perms; return next; }
              return [...prev, perms];
            });
            setPermModalTeam(null);
          }}
          onClose={() => setPermModalTeam(null)}
        />
      )}

      {/* Member permissions modal */}
      {permModalMember && (
        <MemberPermissionsModal
          member={permModalMember}
          sections={sections}
          initialPerms={teamPermissions.find(p => p.teamId === permModalMember.teamId) ?? null}
          onSave={(perms) => {
            setTeamPermissions(prev => {
              const existing = prev.findIndex(p => p.teamId === perms.teamId);
              if (existing >= 0) { const next = [...prev]; next[existing] = perms; return next; }
              return [...prev, perms];
            });
            setPermModalMember(null);
          }}
          onViewAs={(perms) => {
            setTeamPermissions(prev => {
              const existing = prev.findIndex(p => p.teamId === perms.teamId);
              if (existing >= 0) { const next = [...prev]; next[existing] = perms; return next; }
              return [...prev, perms];
            });
            setPermModalMember(null);
            onPreviewMember?.(permModalMember, perms);
          }}
          onClose={() => setPermModalMember(null)}
        />
      )}
    </div>
  );
}

// ── TEAM ROW MENU (mini version of RowMenu) ──────────────────────────────────
function TeamRowMenu({ isDefault, onEditPermissions, onRename, onDelete }: { isDefault?: boolean; onEditPermissions: () => void; onRename: () => void; onDelete: () => void; }) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { style: menuPos } = useSmartPosition(triggerRef, menuRef, open, { top: 30 });
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div style={{ position: "relative" }}>
      <div ref={triggerRef} onClick={() => setOpen(v => !v)} style={{ width: 26, height: 26, borderRadius: "50%", background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 13, color: "#94a3b8", flexShrink: 0 }}>···</div>
      {open && (
        <div ref={menuRef} style={{ ...menuPos, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid #e2e8f0", zIndex: 100, minWidth: 170, overflow: "hidden" }}>
          <div onClick={() => { if (!isDefault) { setOpen(false); onEditPermissions(); } }}
            style={{ padding: "9px 14px", fontSize: 13, cursor: isDefault ? "not-allowed" : "pointer", color: isDefault ? "#94a3b8" : "#1a2332" }}
            onMouseEnter={e => { if (!isDefault) e.currentTarget.style.background = "#f8fafc"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>Edit Permissions{isDefault ? " (locked)" : ""}</div>
          <div onClick={() => { setOpen(false); onRename(); }}
            style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", color: "#1a2332" }}
            onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>Edit Name</div>
          {!confirmDelete
            ? <div onClick={() => setConfirmDelete(true)}
                style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", color: "#E85D75" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#fff5f5")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>Delete Team</div>
            : <div style={{ padding: "10px 14px", borderTop: "1px solid #f1f5f9" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#E85D75", marginBottom: 8 }}>Delete this team?</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => setConfirmDelete(false)}
                    style={{ flex: 1, padding: "5px 0", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 11, cursor: "pointer", color: "#64748b" }}>Cancel</button>
                  <button onClick={() => { onDelete(); setOpen(false); }}
                    style={{ flex: 1, padding: "5px 0", borderRadius: 6, border: "none", background: "#E85D75", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Delete</button>
                </div>
              </div>}
        </div>
      )}
    </div>
  );
}

// ── TEAM PERMISSIONS MODAL ────────────────────────────────────────────────────
function TeamPermissionsModal({ teamName, sections, initialPermissions, onSave, onClose }: {
  teamName: string; sections: Section[];
  initialPermissions: TeamPermissions;
  onSave: (perms: TeamPermissions) => void; onClose: () => void;
}) {
  const [allowedSectionIds, setAllowedSectionIds] = useState<string[] | null>(initialPermissions.allowedSectionIds);
  const [metricOverrides, setMetricOverrides] = useState<{ sectionId: string; allowedMetricIds: string[] | null }[] | null>(initialPermissions.metricOverrides);

  const toggleSection = (sid: string, on: boolean) => {
    setAllowedSectionIds(prev => {
      if (prev === null) {
        // Currently all allowed — switch to only this one
        return on ? null : sections.filter(s => s.id === sid).map(s => s.id);
      }
      if (on) return [...prev, sid];
      return prev.filter(id => id !== sid);
    });
  };

  const isSectionAllowed = (sid: string) => allowedSectionIds === null || allowedSectionIds.includes(sid);

  const toggleMetric = (sid: string, mid: string, on: boolean) => {
    setMetricOverrides(prev => {
      const current = prev ?? [];
      const existing = current.find(m => m.sectionId === sid);
      if (on) {
        // Remove metric from exclusion list
        if (!existing) return current;
        const updatedMetrics = existing.allowedMetricIds === null ? null : (existing.allowedMetricIds.includes(mid) ? existing.allowedMetricIds : [...existing.allowedMetricIds, mid]);
        if (updatedMetrics === null) {
          return current.filter(m => m.sectionId !== sid);
        }
        return current.map(m => m.sectionId === sid ? { ...m, allowedMetricIds: updatedMetrics } : m);
      }
      // Disallow specific metric
      if (existing?.allowedMetricIds === null) {
        // Currently all allowed — switch to exclude this one
        const allOtherIds = sections.find(s => s.id === sid)?.metrics.filter(m => m.id !== mid).map(m => m.id) ?? [];
        return [...current.filter(m => m.sectionId !== sid), { sectionId: sid, allowedMetricIds: allOtherIds }];
      }
      const currentAllowed = existing?.allowedMetricIds ?? sections.find(s => s.id === sid)?.metrics.map(m => m.id) ?? [];
      const filtered = currentAllowed.filter(id => id !== mid);
      if (filtered.length === (sections.find(s => s.id === sid)?.metrics.length ?? 0)) {
        return current.filter(m => m.sectionId !== sid);
      }
      return current.map(m => m.sectionId === sid ? { ...m, allowedMetricIds: filtered } : m);
    });
  };

  const isMetricAllowed = (sid: string, mid: string) => {
    if (!isSectionAllowed(sid)) return false;
    if (metricOverrides === null) return true;
    const override = metricOverrides.find(m => m.sectionId === sid);
    if (!override) return true;
    if (override.allowedMetricIds === null) return true;
    return override.allowedMetricIds.includes(mid);
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "24px", width: "100%", maxWidth: 520, boxShadow: "0 20px 60px rgba(0,0,0,0.18)", overflowY: "auto", maxHeight: "90vh" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#1a2332" }}>Permissions for {teamName}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>×</button>
        </div>
        <p style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>Select which rows and metric boxes this team can access.</p>

        {sections.map(section => (
          <div key={section.id} style={{ marginBottom: 14, border: "1px solid #f1f5f9", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "#f8fafc", borderBottom: isSectionAllowed(section.id) ? "1px solid #f1f5f9" : "none" }}>
              <input type="checkbox" checked={isSectionAllowed(section.id)} onChange={e => toggleSection(section.id, e.target.checked)}
                style={{ accentColor: "#3B82F6", width: 16, height: 16, cursor: "pointer", flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "#1a2332", flex: 1 }}>{section.title}</span>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>{section.metrics.length} box{section.metrics.length !== 1 ? "es" : ""}</span>
            </div>
            {isSectionAllowed(section.id) && section.metrics.length > 0 && (
              <div style={{ padding: "6px 14px 10px 38px" }}>
                {section.metrics.map(m => (
                  <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer" }}>
                    <input type="checkbox" checked={isMetricAllowed(section.id, m.id)}
                      onChange={e => toggleMetric(section.id, m.id, e.target.checked)}
                      style={{ accentColor: "#3B82F6", width: 14, height: 14, cursor: "pointer", flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: "#475569" }}>{m.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}

        <button onClick={() => { onSave({ teamId: initialPermissions.teamId, allowedSectionIds, metricOverrides }); }}
          style={{ width: "100%", padding: "10px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", marginTop: 8 }}>
          Save Permissions
        </button>
      </div>
    </div>
  );
}

// ── MEMBER PERMISSIONS MODAL (with "View as" preview) ─────────────────────────
function MemberPermissionsModal({ member, sections, initialPerms, onSave, onViewAs, onClose }: {
  member: OrgMember; sections: Section[];
  initialPerms: TeamPermissions | null;
  onSave: (perms: TeamPermissions) => void;
  onViewAs: (perms: TeamPermissions) => void;
  onClose: () => void;
}) {
  const [allowedSectionIds, setAllowedSectionIds] = useState<string[] | null>(initialPerms?.allowedSectionIds ?? null);
  const [metricOverrides, setMetricOverrides] = useState<{ sectionId: string; allowedMetricIds: string[] | null }[] | null>(initialPerms?.metricOverrides ?? null);

  const toggleSection = (sid: string, on: boolean) => {
    setAllowedSectionIds(prev => {
      if (prev === null) return on ? null : [sid];
      if (on) return [...prev, sid];
      return prev.filter(id => id !== sid);
    });
  };
  const isSectionAllowed = (sid: string) => allowedSectionIds === null || allowedSectionIds.includes(sid);

  const toggleMetric = (sid: string, mid: string, on: boolean) => {
    setMetricOverrides(prev => {
      const current = prev ?? [];
      const existing = current.find(m => m.sectionId === sid);
      if (on) {
        if (!existing) return current;
        const updated = existing.allowedMetricIds === null ? null : (existing.allowedMetricIds.includes(mid) ? existing.allowedMetricIds : [...existing.allowedMetricIds, mid]);
        if (updated === null) return current.filter(m => m.sectionId !== sid);
        return current.map(m => m.sectionId === sid ? { ...m, allowedMetricIds: updated } : m);
      }
      const allIds = sections.find(s => s.id === sid)?.metrics.map(m => m.id) ?? [];
      if (existing?.allowedMetricIds === null) {
        return [...current.filter(m => m.sectionId !== sid), { sectionId: sid, allowedMetricIds: allIds.filter(id => id !== mid) }];
      }
      const currentAllowed = existing?.allowedMetricIds ?? allIds;
      const filtered = currentAllowed.filter(id => id !== mid);
      if (filtered.length === allIds.length) return current.filter(m => m.sectionId !== sid);
      return current.map(m => m.sectionId === sid ? { ...m, allowedMetricIds: filtered } : m);
    });
  };
  const isMetricAllowed = (sid: string, mid: string) => {
    if (!isSectionAllowed(sid)) return false;
    if (!metricOverrides) return true;
    const override = metricOverrides.find(m => m.sectionId === sid);
    if (!override || override.allowedMetricIds === null) return true;
    return override.allowedMetricIds.includes(mid);
  };

  const currentPerms: TeamPermissions = { teamId: initialPerms?.teamId ?? "", allowedSectionIds, metricOverrides };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "24px", width: "100%", maxWidth: 520, boxShadow: "0 20px 60px rgba(0,0,0,0.18)", overflowY: "auto", maxHeight: "90vh" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#4C9FE8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#fff" }}>
              {(member.name?.[0] || member.email[0] || "?").toUpperCase()}
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#1a2332" }}>{member.name || member.email}</h3>
              <div style={{ fontSize: 11, color: "#64748b", textTransform: "capitalize" }}>{member.level}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>×</button>
        </div>
        <p style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>Select which rows and metric boxes this member can access.</p>

        {sections.map(section => (
          <div key={section.id} style={{ marginBottom: 12, border: "1px solid #f1f5f9", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "#f8fafc", borderBottom: isSectionAllowed(section.id) ? "1px solid #f1f5f9" : "none" }}>
              <input type="checkbox" checked={isSectionAllowed(section.id)} onChange={e => toggleSection(section.id, e.target.checked)}
                style={{ accentColor: "#3B82F6", width: 16, height: 16, cursor: "pointer", flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "#1a2332", flex: 1 }}>{section.title}</span>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>{section.metrics.length} box{section.metrics.length !== 1 ? "es" : ""}</span>
            </div>
            {isSectionAllowed(section.id) && section.metrics.length > 0 && (
              <div style={{ padding: "6px 14px 10px 38px" }}>
                {section.metrics.map(m => (
                  <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer" }}>
                    <input type="checkbox" checked={isMetricAllowed(section.id, m.id)}
                      onChange={e => toggleMetric(section.id, m.id, e.target.checked)}
                      style={{ accentColor: "#3B82F6", width: 14, height: 14, cursor: "pointer", flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: "#475569" }}>{m.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}

        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button onClick={() => { onViewAs(currentPerms); }}
            style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1.5px solid #3B82F6", background: "#fff", color: "#3B82F6", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            View as {member.name || member.email}
          </button>
          <button onClick={() => { onSave(currentPerms); }}
            style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            Save Permissions
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE: SETTINGS
// ═══════════════════════════════════════════════════════════════════════════

function ProfileField({ label, value, onChange, disabled }: { label: string; value: string; onChange?: (v: string) => void; disabled?: boolean }) {
  return (
    <div style={{ marginBottom: 13 }}>
      <label style={{ fontSize: 12, color: "#64748b", display: "block", marginBottom: 3 }}>{label}</label>
      <input value={value} onChange={e => onChange?.(e.target.value)} disabled={disabled}
        style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none", boxSizing: "border-box" as const, background: disabled ? "#f8fafc" : "#fff", color: disabled ? "#94a3b8" : "#1a2332" }} />
    </div>
  );
}

function SettingsPage({ userId, userEmail, profile: externalProfile, forceDisableFiveAccount, onForceDisableAcknowledged, onProfileSaved, onFiveAccountCreated, onFiveAccountDisabled, fiveAccountSettings, onFiveAccountSettingsChange, currentUserLevel }: {
  userId: string; userEmail: string; profile: any;
  forceDisableFiveAccount?: boolean;
  onForceDisableAcknowledged?: () => void;
  onProfileSaved: (p: any) => void;
  onFiveAccountCreated: () => void;
  onFiveAccountDisabled?: () => void;
  fiveAccountSettings: FiveAccountSettings;
  onFiveAccountSettingsChange: (s: FiveAccountSettings) => void;
  currentUserLevel?: OrgPermissionLevel;
}) {
  const [localProfile, setLocalProfile] = useState({
  full_name: "", company: "", street: "", city: "", state: "", zip: "", country: "",
  avatar_url: "", five_account_enabled: false,
  health_green_multiplier: 1.0,
  health_yellow_multiplier: 0.5,
  health_red_multiplier: -1.0,
  menu_permissions: {} as Record<string, string[]>,
});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fiveAccountConfirm, setFiveAccountConfirm] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
  if (!userId) return;
  supabase.from("profiles").select("*").eq("id", userId).maybeSingle().then(({ data }) => {
    if (data) setLocalProfile({
      full_name: data.full_name ?? "", company: data.company ?? "",
      street: data.street ?? "", city: data.city ?? "", state: data.state ?? "",
      zip: data.zip ?? "", country: data.country ?? "", avatar_url: data.avatar_url ?? "",
      five_account_enabled: data.five_account_enabled ?? false,
      health_green_multiplier: data.health_green_multiplier ?? 1.0,
      health_yellow_multiplier: data.health_yellow_multiplier ?? 0.5,
      health_red_multiplier: data.health_red_multiplier ?? -1.0,
      menu_permissions: data.menu_permissions ?? {},
    });
  });
}, [userId]);

  useEffect(() => {
    setLocalProfile(prev => ({ ...prev, five_account_enabled: externalProfile.five_account_enabled }));
  }, [externalProfile.five_account_enabled]);

  useEffect(() => {
    if (!forceDisableFiveAccount) return;
    setLocalProfile(prev => ({ ...prev, five_account_enabled: false }));
    onForceDisableAcknowledged?.();
  }, [forceDisableFiveAccount]);

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase.from("profiles").upsert({ id: userId, ...localProfile, updated_at: new Date().toISOString() });
    if (!error) { onProfileSaved({ ...localProfile }); setSaved(true); setTimeout(() => setSaved(false), 3000); }
    setSaving(false);
  };
  
  const handleFiveAccountToggle = async (v: boolean) => {
    const updated = { ...localProfile, five_account_enabled: v };
    setLocalProfile(updated);
    // Auto-save immediately
    await supabase.from("profiles").upsert({ id: userId, ...updated, updated_at: new Date().toISOString() });
    onProfileSaved(updated);
    if (v) {
      onFiveAccountCreated();
      setFiveAccountConfirm(true);
      setTimeout(() => setFiveAccountConfirm(false), 4000);
    } else {
      // Cascade: disable Five-Account flag on every metric box
      onFiveAccountDisabled?.();
    }
  };
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file || !userId) return;
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `${userId}/avatar.${ext}`;
    const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (!error) {
      const newUrl = `https://rhkrkdwqrzzmakxxsozg.supabase.co/storage/v1/object/public/avatars/${path}?t=${Date.now()}`;
      const updated = { ...localProfile, avatar_url: newUrl };
      setLocalProfile(updated);
      await supabase.from("profiles").upsert({ id: userId, avatar_url: newUrl, updated_at: new Date().toISOString() });
      onProfileSaved(updated);
    }
    setUploading(false);
  };

  const GrayPref = ({ label, sub }: { label: string; sub: string }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid #f1f5f9", opacity: 0.45 }}>
      <div>
        <div style={{ fontSize: 13, color: "#1a2332" }}>{label} <span style={{ fontSize: 10, color: "#94a3b8", fontStyle: "italic" }}>(coming soon)</span></div>
        <div style={{ fontSize: 11, color: "#94a3b8" }}>{sub}</div>
      </div>
      <Toggle on={false} onChange={() => { }} disabled />
    </div>
  );

  return (
    <div style={{ padding: "clamp(16px,4vw,32px)", maxWidth: 860 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: "clamp(20px,4vw,26px)", fontWeight: 700, color: "#1a2332" }}>Profile</h1>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 20 }}>
        {/* Profile card */}
        <div style={{ background: "#fff", borderRadius: 14, padding: 22, border: "1px solid #f1f5f9" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
            <div onClick={() => fileRef.current?.click()} style={{ width: 58, height: 58, borderRadius: "50%", background: "#4C9FE8", cursor: "pointer", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
              {localProfile.avatar_url ? <img src={localProfile.avatar_url} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (localProfile.full_name?.[0]?.toUpperCase() ?? "👤")}
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={handlePhotoUpload} style={{ display: "none" }} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332" }}>{localProfile.full_name || "Your Name"}</div>
              <button onClick={() => fileRef.current?.click()} style={{ fontSize: 11, color: "#3B82F6", background: "none", border: "none", cursor: "pointer", padding: 0 }}>{uploading ? "Uploading..." : "Change photo"}</button>
            </div>
          </div>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600, color: "#1a2332" }}>Account</h3>
          <ProfileField label="Full Name" value={localProfile.full_name} onChange={v => setLocalProfile(p => ({ ...p, full_name: v }))} />
          <ProfileField label="Email" value={userEmail} disabled />
          <ProfileField label="Company" value={localProfile.company} onChange={currentUserLevel === "owner" || !currentUserLevel ? v => setLocalProfile(p => ({ ...p, company: v })) : undefined} disabled={currentUserLevel !== "owner" && currentUserLevel !== undefined} />
          <button onClick={handleSave} disabled={saving} style={{ width: "100%", padding: "9px", borderRadius: 8, border: "none", background: saved ? "#4CAF7D" : "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 6 }}>
            {saving ? "Saving..." : saved ? "✓ Saved!" : "Save Changes"}
          </button>
        </div>

        {/* Plan + Preferences */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Plan — owner only */}
          {(currentUserLevel === "owner" || !currentUserLevel) && (
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, border: "1px solid #f1f5f9", opacity: 0.55, pointerEvents: "none" as const }}>
            <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 600, color: "#94a3b8" }}>Plan</h3>
            {[{ name: "Free", features: "3 rows, 10 metrics" }, { name: "Pro", features: "Unlimited rows, integrations" }, { name: "Business", features: "Team access, all apps" }].map(p => (
              <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, marginBottom: 6, background: p.name === "Pro" ? "#EFF6FF" : "#F8FAFC", border: p.name === "Pro" ? "1.5px solid #3B82F6" : "1.5px solid transparent" }}>
                <div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid", borderColor: p.name === "Pro" ? "#3B82F6" : "#d1d5db", background: p.name === "Pro" ? "#3B82F6" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {p.name === "Pro" && <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#fff" }} />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332" }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>{p.features}</div>
                </div>
              </div>
            ))}
          </div>
          )}

          {/* Menu Visibility — owner only */}
          {(currentUserLevel === "owner" || !currentUserLevel) && (
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, border: "1px solid #f1f5f9" }}>
            <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 600, color: "#1a2332" }}>Menu Visibility</h3>
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 14 }}>Customize which menu items each role can access. Home is always visible.</div>
            {(["viewer","editor","admin"] as const).map(level => {
              const hidden = localProfile.menu_permissions?.[level] || [];
              return (
                <div key={level} style={{ marginBottom: 12, background: "#F8FAFC", borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#1a2332", marginBottom: 8, textTransform: "capitalize" }}>{level}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {(["goals","tasks","playbooks","integrations","team","settings"] as const).map(item => {
                      const isHidden = hidden.includes(item);
                      const forcedOff = level === "viewer" && (item === "integrations" || item === "team");
                      return (
                        <label key={item} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, background: forcedOff ? "#f1f5f9" : isHidden ? "#fff5f5" : "#F0FDF4", border: forcedOff ? "1px solid #e2e8f0" : isHidden ? "1px solid #fecaca" : "1px solid #c3e6d4", fontSize: 11, color: forcedOff ? "#94a3b8" : isHidden ? "#E85D75" : "#0F6E56", cursor: forcedOff ? "not-allowed" : "pointer", userSelect: "none", opacity: forcedOff ? 0.5 : 1 }}>
                          <input type="checkbox" checked={!isHidden} disabled={forcedOff}
                            onChange={() => {
                              const next = isHidden ? hidden.filter(h => h !== item) : [...hidden, item];
                              setLocalProfile(p => ({ ...p, menu_permissions: { ...p.menu_permissions, [level]: next } }));
                            }}
                            style={{ accentColor: "#3B82F6", pointerEvents: forcedOff ? "none" : "auto" }} />
                          {item === "goals" ? "Goals" : item === "tasks" ? "Tasks" : item === "playbooks" ? "Playbooks" : item === "integrations" ? "Integrations" : item === "team" ? "Team" : "Settings"}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          )}

          {/* Preferences */}
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, border: "1px solid #f1f5f9" }}>
            <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 600, color: "#1a2332" }}>Preferences</h3>
            <GrayPref label="Email notifications" sub="Daily digest of key metrics" />
            <GrayPref label="Dark mode" sub="Switch to dark theme" />
            <GrayPref label="Two-factor auth" sub="Require 2FA on login" />
            {/* Five-Account System — functional */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0" }}>
              <div>
                <div style={{ fontSize: 13, color: "#1a2332" }}>Five-Account System</div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>Enable Profit First method globally</div>
              </div>
              <Toggle on={localProfile.five_account_enabled} onChange={handleFiveAccountToggle} />
            </div>
            {fiveAccountConfirm && (
              <div style={{ marginTop: 8, background: "#F0FDF4", border: "1px solid #c3e6d4", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#0F6E56", display: "flex", alignItems: "center", gap: 6 }}>
                ✓ Five-Account System created — Finances row added to your dashboard.
              </div>
            )}

            {/* Five-Account Configuration — shown when enabled */}
            {localProfile.five_account_enabled && (
              <div style={{ background: "#F0FDF4", border: "1px solid #c3e6d4", borderRadius: 10, padding: "12px 14px", marginTop: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#0F6E56", marginBottom: 10 }}>Five-Account Configuration</div>

                {/* Bank account mode */}
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#1a2332", marginBottom: 6 }}>Bank Account Mode</div>
                  {([
                    ["one-business", "One business checking account", "Equation runs automatically across all 5 boxes."],
                    ["business-and-personal", "Business + personal checking (default)", "Equation runs for Overhead, Profit, Tax, Investments. Owner is manual."],
                    ["five-separate", "Five separate bank accounts", "Equation disabled. Each box updated manually or via integration."],
                  ] as [FiveAccountMode, string, string][]).map(([val, label, sub]) => (
                    <label key={val} style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", marginBottom: 6 }}>
                      <input type="radio" checked={fiveAccountSettings.mode === val}
                        onChange={() => onFiveAccountSettingsChange({ ...fiveAccountSettings, mode: val })}
                        style={{ accentColor: "#0F6E56", marginTop: 2, flexShrink: 0 }} />
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#1a2332" }}>{label}</div>
                        <div style={{ fontSize: 10, color: "#64748b" }}>{sub}</div>
                      </div>
                    </label>
                  ))}
                </div>

                {/* Monthly expenses */}
                <div style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#1a2332", display: "block", marginBottom: 3 }}>Monthly Operating Expenses (incl. owner salary)</label>
                  <input type="number" value={fiveAccountSettings.monthlyExpenses || ""}
                    onChange={e => onFiveAccountSettingsChange({ ...fiveAccountSettings, monthlyExpenses: parseFloat(e.target.value) || 0 })}
                    placeholder="e.g. 25000"
                    style={{ width: "100%", padding: "6px 10px", borderRadius: 7, border: "1.5px solid #c3e6d4", fontSize: 12, outline: "none", boxSizing: "border-box" }} />
                  {fiveAccountSettings.monthlyExpenses > 0 && (
                    <div style={{ fontSize: 10, color: "#64748b", marginTop: 3 }}>
                      Overhead target: <strong>${(fiveAccountSettings.monthlyExpenses * 2).toLocaleString()}</strong> &nbsp;·&nbsp;
                      Profit target: <strong>${(fiveAccountSettings.monthlyExpenses * 6).toLocaleString()}</strong>
                    </div>
                  )}
                </div>

                {/* Owner salary */}
                <div style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#1a2332", display: "block", marginBottom: 3 }}>Total Owner's Salary (monthly)</label>
                 <input type="number" value={fiveAccountSettings.ownerSalary ?? ""}
                    onChange={e => onFiveAccountSettingsChange({ ...fiveAccountSettings, ownerSalary: parseFloat(e.target.value) || 0 })}
                    placeholder="e.g. 8000"
                    style={{ width: "100%", padding: "6px 10px", borderRadius: 7, border: "1.5px solid #c3e6d4", fontSize: 12, outline: "none", boxSizing: "border-box" }} />
                  {fiveAccountSettings.ownerSalary > 0 && (
                    <div style={{ fontSize: 10, color: "#64748b", marginTop: 3 }}>
                      Annual: <strong>${(fiveAccountSettings.ownerSalary * 12).toLocaleString()}</strong>
                    </div>
                  )}
                </div>

                {/* Post transaction toggle */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderTop: "1px solid #c3e6d4", marginTop: 6 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#1a2332" }}>Post Transaction on Edit</div>
                    <div style={{ fontSize: 10, color: "#64748b" }}>Prompt to log a transaction when a Five-Account value changes</div>
                  </div>
                  <Toggle on={fiveAccountSettings.postTransactionEnabled}
                    onChange={v => onFiveAccountSettingsChange({ ...fiveAccountSettings, postTransactionEnabled: v })} />
                </div>

                {/* Reset button */}
                <button onClick={() => onFiveAccountSettingsChange(DEFAULT_FIVE_ACCOUNT_SETTINGS)}
                  style={{ marginTop: 10, width: "100%", padding: "6px 0", borderRadius: 7, border: "1px solid #c3e6d4", background: "transparent", fontSize: 11, color: "#0F6E56", cursor: "pointer", fontWeight: 600 }}>
                  Reset to Profit First Defaults
                </button>
              </div>
            )}
          </div>

          {/* Health Score multipliers */}
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, border: "1px solid #f1f5f9" }}>
            <h3 style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 600, color: "#1a2332" }}>Health Score</h3>
            <p style={{ margin: "0 0 14px", fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
              Adjust how each metric color contributes to your overall dashboard health score. Only boxes with color rules count.
            </p>
            {[
              { key: "health_green_multiplier" as const, label: "Green multiplier", color: "#4CAF7D" },
              { key: "health_yellow_multiplier" as const, label: "Yellow multiplier", color: "#F5A623" },
              { key: "health_red_multiplier" as const, label: "Red multiplier", color: "#E85D75" },
            ].map(({ key, label, color }) => (
              <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f1f5f9" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, display: "inline-block" }} />
                  <span style={{ fontSize: 13, color: "#1a2332" }}>{label}</span>
                </div>
                <input
                  type="number"
                  step={0.1}
                  value={localProfile[key]}
                  onChange={async e => {
                    const v = parseFloat(e.target.value);
                    if (isNaN(v)) return;
                    const updated = { ...localProfile, [key]: v };
                    setLocalProfile(updated);
                    await supabase.from("profiles").upsert({ id: userId, ...updated, updated_at: new Date().toISOString() });
                    onProfileSaved(updated);
                  }}
                  style={{ width: 72, padding: "5px 9px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none", textAlign: "right" }}
                />
              </div>
            ))}
            <div style={{ marginTop: 10, fontSize: 10, color: "#94a3b8", lineHeight: 1.5 }}>
              Defaults: Green +1.0, Yellow +0.5, Red −1.0. A green box adds its full weight, yellow adds half, red subtracts a full weight.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// EQUATION BUILDER PAGE
// ═══════════════════════════════════════════════════════════════════════════

function EquationBuilderPage({ allMetrics, sections, initialEquation, targetMetricId, onSave, onSaveDraft, onCancel, onDirty, isMobile }: {
  allMetrics: Metric[];
  sections: Section[];
  initialEquation?: EquationConfig;
  targetMetricId?: string;
  onSave: (equation: EquationConfig) => void;
  onSaveDraft?: (equation: EquationConfig) => void;
  onCancel: () => void;
  onDirty?: () => void;
  isMobile?: boolean;
}) {
  const [steps, setSteps] = useState<EquationStep[]>(initialEquation?.steps ?? []);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);
  const [dropLineIndex, setDropLineIndex] = useState<number | null>(null);
  const dropLineIndexRef = useRef<number | null>(null);
  const dragStepIdxRef = useRef<number | null>(null);
  const dragCountRef = useRef<number>(1);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [addAtIndex, setAddAtIndex] = useState<number | null>(null);
  const [pendingOperator, setPendingOperator] = useState(false);
  const [forceSearch, setForceSearch] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [checkedOrder, setCheckedOrder] = useState<number[]>([]);
  const checkedSteps = new Set(checkedOrder);
  const [selectedGroupStartIdx, setSelectedGroupStartIdx] = useState<number | null>(null);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<EquationStep[][]>([]);
  const [redoStack, setRedoStack] = useState<EquationStep[][]>([]);
  const stepsChangedRef = useRef(false);

  // Track dirty state
  useEffect(() => {
    if (stepsChangedRef.current && onDirty) onDirty();
    stepsChangedRef.current = true;
  }, [steps]);
  const stepsRef = useRef(steps);
  const ignoreHistory = useRef(false);

  useEffect(() => {
    if (ignoreHistory.current) {
      ignoreHistory.current = false;
      stepsRef.current = steps;
      return;
    }
    if (steps !== stepsRef.current) {
      setUndoStack(u => {
        if (u.length > 0 && JSON.stringify(u[0]) === JSON.stringify(stepsRef.current)) return u;
        return [stepsRef.current, ...u].slice(0, 50);
      });
      setRedoStack([]);
      stepsRef.current = steps;
    }
  }, [steps]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prev = undoStack[0];
    setRedoStack(r => [steps, ...r].slice(0, 50));
    setUndoStack(u => u.slice(1));
    ignoreHistory.current = true;
    setEditingStepIndex(null);
    setSteps(prev);
  }, [undoStack, steps]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[0];
    setUndoStack(u => [steps, ...u].slice(0, 50));
    setRedoStack(r => r.slice(1));
    ignoreHistory.current = true;
    setEditingStepIndex(null);
    setSteps(next);
  }, [redoStack, steps]);

  useEffect(() => {
    const hasUnsaved = JSON.stringify(steps) !== JSON.stringify(initialEquation?.steps ?? []);
    if (hasUnsaved) {
      const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
      window.addEventListener("beforeunload", handler);
      return () => window.removeEventListener("beforeunload", handler);
    }
  }, [steps, initialEquation]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        if (checkedOrder.length >= 2) {
          handleGroupSelected();
        } else if (editingStepIndex !== null) {
          handleAddParentheses();
        } else {
          handleAddParentheses();
        }
      }
      if (e.metaKey && e.shiftKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        if (checkedOrder.length >= 2) {
          handleFractionSelected();
        } else if (editingStepIndex !== null) {
          handleAddFraction();
        } else {
          handleAddFraction();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [checkedOrder, editingStepIndex, steps]);

  const toggleChecked = (idx: number) => {
    setCheckedOrder(prev => {
      if (prev.includes(idx)) return prev.filter(i => i !== idx);
      return [...prev, idx];
    });
  };

  const renderCheckbox = (idx: number, isEditing: boolean) => (
    (isEditing || checkedOrder.length > 0) ? (
      <div onClick={e => { e.stopPropagation(); toggleChecked(idx); }} style={{ position: "absolute", top: 4, left: 4, width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 10, borderRadius: 4, border: "1.5px solid #94a3b8", background: checkedOrder.includes(idx) ? "#3B82F6" : "#fff", color: "#fff", fontSize: 11, fontWeight: 700, lineHeight: 1 }}>
        {checkedOrder.includes(idx) ? "✓" : ""}
      </div>
    ) : null
  );

  const handleGroupSelected = () => {
    const validOrder = checkedOrder.filter(i => i >= 0 && i < steps.length);
    if (validOrder.length < 2) return;
    const checkedSet = new Set(validOrder);
    const firstPos = validOrder[0];
    setSteps(prev => {
      const next: EquationStep[] = [];
      for (let i = 0; i < firstPos; i++) {
        if (!checkedSet.has(i)) next.push(prev[i]);
      }
      next.push({ type: "operator", operator: "paren-start" });
      for (const idx of validOrder) {
        next.push(prev[idx]);
      }
      next.push({ type: "operator", operator: "paren-end" });
      for (let i = firstPos; i < prev.length; i++) {
        if (!checkedSet.has(i)) next.push(prev[i]);
      }
      return next;
    });
    setCheckedOrder([]);
  };

  const handleFractionSelected = () => {
    const validOrder = checkedOrder.filter(i => i >= 0 && i < steps.length);
    if (validOrder.length < 2) return;
    const checkedSet = new Set(validOrder);
    const firstPos = validOrder[0];
    setSteps(prev => {
      const next: EquationStep[] = [];
      for (let i = 0; i < firstPos; i++) {
        if (!checkedSet.has(i)) next.push(prev[i]);
      }
      next.push({ type: "operator", operator: "paren-start" });
      for (const idx of validOrder) {
        next.push(prev[idx]);
      }
      next.push({ type: "operator", operator: "paren-end" });
      next.push({ type: "operator", operator: "/" });
      next.push({ type: "operator", operator: "paren-start" });
      next.push({ type: "operator", operator: "paren-end" });
      for (let i = firstPos; i < prev.length; i++) {
        if (!checkedSet.has(i)) next.push(prev[i]);
      }
      return next;
    });
    setCheckedOrder([]);
  };

  const handleRemoveGroup = (startIdx: number) => {
    setSteps(prev => {
      const next = [...prev];
      if (next[startIdx]?.type === "operator" && next[startIdx]?.operator === "paren-start") {
        let depth = 1;
        let endIdx = startIdx + 1;
        while (endIdx < next.length && depth > 0) {
          if (next[endIdx].type === "operator" && next[endIdx].operator === "paren-start") depth++;
          else if (next[endIdx].type === "operator" && next[endIdx].operator === "paren-end") depth--;
          if (depth > 0) endIdx++;
        }
        next.splice(startIdx, endIdx - startIdx + 1);
      }
      let changed = true;
      while (changed) {
        changed = false;
        for (let i = 0; i < next.length - 1; i++) {
          if (next[i].type === "operator" && next[i].operator === "paren-start" &&
              next[i + 1].type === "operator" && next[i + 1].operator === "paren-end") {
            next.splice(i, 2);
            changed = true;
            break;
          }
        }
      }
      return next;
    });
    setSelectedGroupStartIdx(null);
    setEditingStepIndex(null);
  };

  // Derived: whether to show math picker or search based on current state
  const showMathPicker = forceSearch
    ? false
    : editingStepIndex !== null
      ? steps[editingStepIndex]?.type === "operator"
      : pendingOperator || (steps.length > 0 && (steps[steps.length - 1].type === "metric" || steps[steps.length - 1].type === "number"));

  // Available metrics excluding the target metric being edited
  const availableMetrics = allMetrics.filter(m => m.id !== targetMetricId);

  const filteredMetrics = searchQuery.trim()
    ? availableMetrics.filter(m => m.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : availableMetrics;

  // Target metric for preview
  const targetMetric = allMetrics.find(m => m.id === targetMetricId);

  // Compute live result
  const liveResult = steps.length > 0 ? evaluateEquation(steps, allMetrics) : null;
  const liveFormatted = liveResult !== null && targetMetric
    ? formatEquationResult(liveResult, steps, allMetrics)
    : null;

  // Focus search input on mount
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Close add menu on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const stepsWithParents: { steps: EquationStep[]; parens: number[][] } = { steps, parens: [] };

  // ── Group-scoped insertion helper ─────────────────────────────────────────
  // Given a proposed insertion index and the current steps array, returns the
  // tightest (innermost) valid insertion index — clamped to stay inside the
  // innermost paren group that contains that position.
  // If the index is not inside any group it is returned unchanged.
  const clampToInnermostGroup = (rawIndex: number, stepsArr: EquationStep[]): number => {
    // Walk through every paren-start and find the innermost one that wraps rawIndex
    let innermostStart = -1;
    let innermostEnd = -1;
    let depth = 0;
    const stack: number[] = [];
    for (let i = 0; i < stepsArr.length; i++) {
      const s = stepsArr[i];
      if (s.type === "operator" && s.operator === "paren-start") {
        stack.push(i);
      } else if (s.type === "operator" && s.operator === "paren-end") {
        const openIdx = stack.pop();
        if (openIdx !== undefined) {
          // This group spans (openIdx, i) exclusive — valid insertion is openIdx+1 .. i
          if (rawIndex > openIdx && rawIndex <= i) {
            // rawIndex is inside this group; check if it's tighter than current best
            if (innermostStart === -1 || openIdx > innermostStart) {
              innermostStart = openIdx;
              innermostEnd = i;
            }
          }
        }
      }
    }
    if (innermostStart === -1) return rawIndex; // not inside any group
    // Clamp: insertion must be strictly inside paren-start+1 .. paren-end
    return Math.max(innermostStart + 1, Math.min(rawIndex, innermostEnd));
  };

  const handleSelectMetric = (m: Metric) => {
    setPendingOperator(false);
    setForceSearch(false);
    const step: EquationStep = {
      type: "metric",
      metricId: m.id,
      metricLabel: m.label,
      metricIcon: m.icon,
      metricColor: m.color,
      metricValue: m.value,
      metricType: m.metricType,
      currencySymbol: m.currencySymbol,
    };
    if (editingStepIndex !== null) {
      setSteps(prev => {
        const next = [...prev];
        next[editingStepIndex] = step;
        return next;
      });
      setEditingStepIndex(null);
    } else {
      const rawInsert = addAtIndex ?? steps.length;
      const clampedInsert = clampToInnermostGroup(rawInsert, steps);
      setSteps(prev => {
        const next = [...prev];
        next.splice(clampedInsert, 0, step);
        return next;
      });
      setAddAtIndex(clampedInsert + 1);
    }
    setSearchQuery("");
  };

  const handleSelectOperator = (op: "+" | "-" | "*" | "/") => {
    setPendingOperator(false);
    setForceSearch(false);
    if (editingStepIndex !== null) {
      setSteps(prev => {
        const next = [...prev];
        if (next[editingStepIndex].type === "operator") {
          next[editingStepIndex] = { ...next[editingStepIndex], operator: op };
        }
        return next;
      });
      setEditingStepIndex(null);
      setTimeout(() => searchRef.current?.focus(), 100);
    } else {
      const rawInsert = addAtIndex ?? steps.length;
      const clampedInsert = clampToInnermostGroup(rawInsert, steps);
      setSteps(prev => {
        const next = [...prev];
        next.splice(clampedInsert, 0, { type: "operator", operator: op });
        return next;
      });
      setAddAtIndex(clampedInsert + 1);
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  };

  const handleAddParentheses = () => {
    setShowAddMenu(false);
    setForceSearch(false);
    setPendingOperator(false);
    if (editingStepIndex !== null) {
      setSteps(prev => {
        const next = [...prev];
        const existing = next[editingStepIndex];
        if (existing) {
          next.splice(editingStepIndex, 1, { type: "operator", operator: "paren-start" }, existing, { type: "operator", operator: "paren-end" });
        } else {
          next.splice(editingStepIndex, 0, { type: "operator", operator: "paren-start" }, { type: "operator", operator: "paren-end" });
        }
        return next;
      });
      setEditingStepIndex(null);
    } else {
      const rawInsert = addAtIndex ?? steps.length;
      setSteps(prev => {
        const insertAt = clampToInnermostGroup(rawInsert, prev);
        const next = [...prev];
        next.splice(insertAt, 0, { type: "operator", operator: "paren-start" }, { type: "operator", operator: "paren-end" });
        return next;
      });
      setAddAtIndex(null);
    }
    setSearchQuery("");
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const handleAddFraction = () => {
    setShowAddMenu(false);
    setForceSearch(false);
    setPendingOperator(false);
    const fractionSteps: EquationStep[] = [
      { type: "operator", operator: "paren-start" },
      { type: "operator", operator: "paren-end" },
      { type: "operator", operator: "/" },
      { type: "operator", operator: "paren-start" },
      { type: "operator", operator: "paren-end" },
    ];
    if (editingStepIndex !== null) {
      setSteps(prev => {
        const next = [...prev];
        next.splice(editingStepIndex, 1, ...fractionSteps);
        return next;
      });
      setEditingStepIndex(null);
      setAddAtIndex(editingStepIndex + 1); // auto-focus numerator end
    } else {
      const rawInsert = addAtIndex ?? steps.length;
      const clampedInsert = clampToInnermostGroup(rawInsert, steps);
      setSteps(prev => {
        const next = [...prev];
        next.splice(clampedInsert, 0, ...fractionSteps);
        return next;
      });
      setAddAtIndex(clampedInsert + 1); // auto-focus numerator end
    }
    setSearchQuery("");
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const handleAddNumberStep = () => {
    setShowAddMenu(false);
    setForceSearch(false);
    setPendingOperator(false);
    const rawInsert = addAtIndex ?? steps.length;
    const clampedInsert = clampToInnermostGroup(rawInsert, steps);
    setSteps(prev => {
      const next = [...prev];
      next.splice(clampedInsert, 0, { type: "number", numberValue: 0 });
      return next;
    });
    setEditingStepIndex(clampedInsert);
    setAddAtIndex(clampedInsert + 1);
    setSearchQuery("");
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const handleEditStep = (idx: number) => {
    setEditingStepIndex(idx);
    const step = steps[idx];
    if (step.type === "metric") {
      setSearchQuery(step.metricLabel ?? "");
    }
  };

  const handleRemoveStep = (idx: number) => {
    setSteps(prev => {
      const next = [...prev];
      next.splice(idx, 1);
      let changed = true;
      while (changed) {
        changed = false;
        for (let i = 0; i < next.length - 1; i++) {
          if (next[i].type === "operator" && next[i].operator === "paren-start" &&
              next[i + 1].type === "operator" && next[i + 1].operator === "paren-end") {
            next.splice(i, 2);
            changed = true;
            break;
          }
        }
      }
      return next;
    });
    setEditingStepIndex(null);
  };

  const handleStepDrop = (toStepIdx: number) => {
    const fromIdx = dragStepIdxRef.current;
    const count = dragCountRef.current;
    if (fromIdx === null) {
      dragStepIdxRef.current = null;
      dragCountRef.current = 1;
      setDropLineIndex(null);
      dropLineIndexRef.current = null;
      return;
    }
    if (toStepIdx >= fromIdx && toStepIdx < fromIdx + count) {
      dragStepIdxRef.current = null;
      dragCountRef.current = 1;
      setDropLineIndex(null);
      dropLineIndexRef.current = null;
      return;
    }
    setSteps(prev => {
      const next = [...prev];
      const items = next.splice(fromIdx, count);
      let adjustedTo = fromIdx < toStepIdx ? toStepIdx - count : toStepIdx;
      if (count === 1 && toStepIdx === fromIdx + 1) adjustedTo++;
      const clampedTo = clampToInnermostGroup(adjustedTo, next);
      next.splice(clampedTo, 0, ...items);
      return next;
    });
    dragStepIdxRef.current = null;
    dragCountRef.current = 1;
    setDropLineIndex(null);
    dropLineIndexRef.current = null;
  };

  const handleSave = () => {
    if (!equationValid) return;
    onSave({ steps });
  };

  const handleSaveDraft = () => {
    onSaveDraft?.({ steps });
  };

  const cardSize = Math.max(60, 140 - steps.length * 3);
  const circleScale = Math.max(0.6, Math.min(1, cardSize / 140));

  // Whether the equation is valid enough to save
  const equationValid = (() => {
    const filteredSteps = steps.filter(s => !(s.type === "operator" && (s.operator === "paren-start" || s.operator === "paren-end")));
    if (filteredSteps.length < 3) return false;
    const isValueType = (t: string) => t === "metric" || t === "number";
    if (!isValueType(filteredSteps[0].type) || !isValueType(filteredSteps[filteredSteps.length - 1].type)) return false;
    for (let i = 0; i < filteredSteps.length - 1; i++) {
      const aIsValue = isValueType(filteredSteps[i].type);
      const bIsValue = isValueType(filteredSteps[i + 1].type);
      if (aIsValue === bIsValue) return false;
    }
    return true;
  })();

  return (
    <div style={{ flex: 1, display: isMobile ? "flex" : "flex", flexDirection: isMobile ? "column" : "row", background: "#fff", height: "100%" }}>
      {/* Left panel ~75% (full width on mobile) */}
      <div style={{ flex: isMobile ? "none" : 3, display: "flex", flexDirection: "column", minWidth: 0, borderRight: !isMobile && targetMetric && steps.length > 0 ? "1px solid #e2e8f0" : "none", maxHeight: isMobile ? "none" : undefined }}>
        {/* Header — fixed */}
        <div style={{ padding: isMobile ? "12px 16px" : "18px 24px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, flexWrap: "wrap", gap: 6 }}>
          <h2 style={{ margin: 0, fontSize: isMobile ? 16 : 20, fontWeight: 700, color: "#1a2332" }}>Create Equation</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 8, overflowX: "auto", whiteSpace: "nowrap", flexShrink: 0, scrollbarWidth: "none", msOverflowStyle: "none" }}>
            {checkedOrder.length >= 2 && (
              <button onClick={handleGroupSelected} style={{ padding: "6px 16px", borderRadius: 8, border: "none", background: "#3B82F6", fontSize: 12, cursor: "pointer", color: "#fff", fontWeight: 600, flexShrink: 0 }}>
                Group Selected ({checkedOrder.length})
              </button>
            )}
            <button onClick={handleUndo} disabled={undoStack.length === 0} style={{ width: 32, height: 32, borderRadius: "50%", border: "1.5px solid #e2e8f0", background: undoStack.length === 0 ? "#f8fafc" : "#fff", fontSize: 14, cursor: undoStack.length === 0 ? "not-allowed" : "pointer", color: undoStack.length === 0 ? "#cbd5e1" : "#64748b", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>↺</button>
            <button onClick={handleRedo} disabled={redoStack.length === 0} style={{ width: 32, height: 32, borderRadius: "50%", border: "1.5px solid #e2e8f0", background: redoStack.length === 0 ? "#f8fafc" : "#fff", fontSize: 14, cursor: redoStack.length === 0 ? "not-allowed" : "pointer", color: redoStack.length === 0 ? "#cbd5e1" : "#64748b", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>↻</button>
            <button onClick={() => {
              if (confirmAction === "reset") { setConfirmAction(null); setSteps(initialEquation?.steps ?? []); setEditingStepIndex(null); }
              else { setConfirmAction("reset"); }
            }} style={{ padding: "6px 16px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 12, cursor: "pointer", color: confirmAction === "reset" ? "#E85D75" : "#64748b", fontWeight: confirmAction === "reset" ? 600 : 400, flexShrink: 0 }}>{confirmAction === "reset" ? "Confirm Reset?" : "Reset"}</button>
            <button onClick={() => {
              if (confirmAction === "delete") { setConfirmAction(null); setSteps([]); setEditingStepIndex(null); onSave({ steps: [] }); }
              else { setConfirmAction("delete"); }
            }} style={{ padding: "6px 16px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 12, cursor: "pointer", color: confirmAction === "delete" ? "#E85D75" : "#64748b", fontWeight: confirmAction === "delete" ? 600 : 400, flexShrink: 0 }}>{confirmAction === "delete" ? "Confirm Delete?" : "Delete Equation"}</button>
            <button onClick={onCancel} style={{ padding: "6px 16px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 12, cursor: "pointer", color: "#64748b", flexShrink: 0 }}>Cancel</button>
          </div>
        </div>

        {/* Scrollable middle area */}
        <div style={{ flex: 1, padding: isMobile ? "16px" : "24px 32px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Steps preview */}
          <div>
            {steps.length > 0 && (() => {
              const renderGroups: { type: "metric" | "operator" | "fraction" | "paren-group" | "number"; step?: EquationStep; steps?: EquationStep[]; groupIdx?: number; startIdx: number }[] = [];
              let i = 0;
              while (i < steps.length) {
                if (steps[i].type === "operator" && steps[i].operator === "paren-start") {
                  let depth = 1;
                  let j = i + 1;
                  while (j < steps.length && depth > 0) {
                    if (steps[j].type === "operator" && steps[j].operator === "paren-start") depth++;
                    else if (steps[j].type === "operator" && steps[j].operator === "paren-end") depth--;
                    if (depth > 0) j++;
                  }
                  renderGroups.push({ type: "paren-group", steps: steps.slice(i, j + 1), groupIdx: renderGroups.length, startIdx: i });
                  i = j + 1;
                } else if (steps[i].type === "number") {
                  renderGroups.push({ type: "number", step: steps[i], groupIdx: renderGroups.length, startIdx: i });
                  i++;
                } else {
                  renderGroups.push({ type: steps[i].type as "metric" | "operator", step: steps[i], groupIdx: renderGroups.length, startIdx: i });
                  i++;
                }
              }
              // Merge paren-group + "/" operator + paren-group into fraction
              for (let ri = 0; ri < renderGroups.length - 2; ri++) {
                const a = renderGroups[ri];
                const b = renderGroups[ri + 1];
                const c = renderGroups[ri + 2];
                if (a.type === "paren-group" && b.type === "operator" && b.step?.operator === "/" && c.type === "paren-group") {
                  renderGroups.splice(ri, 3, { type: "fraction", steps: [...a.steps!, b.step, ...c.steps!], groupIdx: ri, startIdx: a.startIdx });
                }
              }
              const stepNumbers = assignStepNumbers(steps);
              return (
              <div onClick={() => { setSelectedGroupStartIdx(null); setEditingStepIndex(null); }} style={{ display: "flex", alignItems: "flex-start", flexWrap: "wrap", gap: 6, padding: "14px 18px", background: "#F8FAFC", borderRadius: 12, border: "1px solid #e2e8f0", minHeight: 60, position: "relative" }}>
                {(() => {
                  const innerRenderGroup = (g: typeof renderGroups[0], gi: number, si: number, sc: number, shrinkScale: number) => {
                    const startIdx = g.startIdx;
                    const lineBefore = dropLineIndex === startIdx;
                    const cs = sc;
                    const csScale = Math.max(0.6, Math.min(1, cs / 140));
                    if (g.type === "fraction" && g.steps) {
                      const slashIdxInSteps = g.steps.findIndex(s => s.type === "operator" && s.operator === "/");
                      const numStart = g.startIdx + 1;
                      const numEnd = g.startIdx + slashIdxInSteps;
                      const denStart = g.startIdx + slashIdxInSteps + 2;
                      const denEnd = g.startIdx + g.steps.length - 1;
                      const actualSlashIdx = g.startIdx + slashIdxInSteps;
                      const isNumEditing = editingStepIndex !== null && editingStepIndex >= numStart && editingStepIndex < numEnd;
                      const isDenEditing = editingStepIndex !== null && editingStepIndex >= denStart && editingStepIndex < denEnd;
                      const isEditing = isNumEditing || isDenEditing || editingStepIndex === actualSlashIdx;
                      const z1 = g.startIdx;
                      const z2 = numStart;
                      const z4 = denStart;
                      const z5 = g.startIdx + g.steps!.length;
                      const dropZone = (e: React.DragEvent) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const y = e.clientY - rect.top;
                        const w = rect.width;
                        const h = rect.height;
                        if (x < w * 0.15) return z1;
                        if (x > w * 0.85) return z5;
                        if (y < h * 0.5) return z2;
                        return z4;
                      };
                      return [
                        dropLineIndex === z1 && (
                          <div key={`fz1-${gi}-${si}`} style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />
                        ),
                        <div key={`f-${si}-${gi}`}
                          draggable
                          onDragStart={e => {
                            e.dataTransfer.setData("text/plain", "");
                            e.dataTransfer.effectAllowed = "move";
                            e.stopPropagation();
                            dragStepIdxRef.current = g.startIdx;
                            dragCountRef.current = g.steps!.length;
                            const el = e.currentTarget.cloneNode(true) as HTMLElement;
                            el.style.cssText = 'position:absolute;top:-999px;left:-999px;transform:scale(0.5);transform-origin:top left;border-radius:12px;overflow:hidden;outline:2px solid #3B82F6;background:#EFF6FF;';
                            el.style.pointerEvents = 'none';
                            document.body.appendChild(el);
                            const r = el.getBoundingClientRect();
                            e.dataTransfer.setDragImage(el, r.width / 2, r.height / 2);
                            setTimeout(() => document.body.removeChild(el), 0);
                          }}
                          onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDropLineIndex(dropZone(e)); dropLineIndexRef.current = dropZone(e); }}
                          onDrop={e => { e.preventDefault(); e.stopPropagation(); handleStepDrop(dropZone(e)); }}
                          onDragEnd={() => { dragStepIdxRef.current = null; dragCountRef.current = 1; setDropLineIndex(null); dropLineIndexRef.current = null; }}
                          onClick={e => { e.stopPropagation(); handleEditStep(actualSlashIdx); }}
                          style={{ position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "flex-start", borderRadius: 12, padding: 2, minWidth: `${Math.max(180, 140 * csScale)}px`, outline: isEditing ? "2px solid #3B82F6" : "2px solid transparent", background: isEditing ? "#EFF6FF" : "transparent" }}>
                          {isEditing && (
                            <div onClick={e => { e.stopPropagation(); setSteps(prev => { const n = [...prev]; n.splice(g.startIdx, g.steps!.length); return n; }); setEditingStepIndex(null); }} style={{ position: "absolute", top: 2, right: 2, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#3B82F6", fontSize: 22, fontWeight: 700, lineHeight: 1, zIndex: 10 }}>×</div>
                          )}
                          {renderCheckbox(actualSlashIdx, isEditing)}
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                            <div style={{ display: "inline-flex", flexWrap: "wrap", gap: 6, padding: "8px 12px", border: "2px solid #e2e8f0", borderRadius: 16, background: "#fff", alignItems: "flex-start", minWidth: `${140 * csScale}px` }}
                              onClick={e => e.stopPropagation()}>
                              {dropLineIndex === z2 && numEnd === numStart && (
                                <div style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />
                              )}
                              {renderRange(numStart, numEnd)}
                              {renderPlusButton(numEnd - 1, `fn-${si}-${gi}`)}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <div onClick={e => { e.stopPropagation(); handleEditStep(actualSlashIdx); }} style={{ width: 48 * csScale, height: 48 * csScale, borderRadius: "50%", background: "#3B82F6", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 * csScale, fontWeight: 700, cursor: "pointer" }}>÷</div>
                            </div>
                            <div style={{ display: "inline-flex", flexWrap: "wrap", gap: 6, padding: "8px 12px", border: "2px solid #e2e8f0", borderRadius: 16, background: "#fff", alignItems: "flex-start", minWidth: `${140 * csScale}px` }}
                              onClick={e => e.stopPropagation()}>
                              {dropLineIndex === z4 && denEnd === denStart && (
                                <div style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />
                              )}
                              {renderRange(denStart, denEnd)}
                              {renderPlusButton(denEnd, `fd-${si}-${gi}`)}
                            </div>
                          </div>
                        </div>
                      ];
                    }
                    if (g.type === "metric" && g.step) {
                      const step = g.step;
                      const idx = steps.indexOf(step);
                      const isEditing = editingStepIndex === idx;
                      const fullMetric = allMetrics.find(m => m.id === step.metricId);
                      return [
                        lineBefore && (
                          <div key={`ml-${gi}-${si}`} style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />
                        ),
                        <div key={`m-${si}-${gi}`}
                          draggable
                          onDragStart={e => {
                            e.dataTransfer.setData("text/plain", "");
                            e.dataTransfer.effectAllowed = "move";
                            e.stopPropagation();
                            dragStepIdxRef.current = idx;
                            dragCountRef.current = 1;
                            handleEditStep(idx);
                            const el = e.currentTarget.cloneNode(true) as HTMLElement;
                            el.style.cssText = 'position:absolute;top:-999px;left:-999px;transform:scale(0.5);transform-origin:top left;border-radius:12px;overflow:hidden;outline:2px solid #3B82F6;background:#EFF6FF;';
                            el.style.pointerEvents = 'none';
                            document.body.appendChild(el);
                            const r = el.getBoundingClientRect();
                            e.dataTransfer.setDragImage(el, r.width / 2, r.height / 2);
                            setTimeout(() => document.body.removeChild(el), 0);
                          }}
                          onDragOver={e => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const m = rect.left + rect.width / 2; const idx2 = e.clientX < m ? idx : idx + 1; setDropLineIndex(idx2); dropLineIndexRef.current = idx2; }}
                          onDrop={e => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const m = rect.left + rect.width / 2; const idx2 = e.clientX < m ? idx : idx + 1; handleStepDrop(idx2); }}
                          onDragEnd={() => { dragStepIdxRef.current = null; dragCountRef.current = 1; setDropLineIndex(null); dropLineIndexRef.current = null; }}
                          onClick={e => { e.stopPropagation(); handleEditStep(idx); }}
                          style={{ position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "flex-start", borderRadius: 12, padding: 2, outline: isEditing ? "2px solid #3B82F6" : "2px solid transparent", background: isEditing ? "#EFF6FF" : "transparent" }}>
                          {isEditing && (
                            <div onClick={e => { e.stopPropagation(); handleRemoveStep(idx); }} style={{ position: "absolute", top: 2, right: 2, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#3B82F6", fontSize: 22, fontWeight: 700, lineHeight: 1, zIndex: 10 }}>×</div>
                          )}
                          {renderCheckbox(idx, isEditing)}
                          <div style={{ display: "flex", justifyContent: "center", width: "100%", marginBottom: 3 }}>
                            <div style={{
                              width: 44 * csScale, height: 44 * csScale, borderRadius: "50%",
                              background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 20 * csScale, fontWeight: 700,
                              display: "flex", alignItems: "center", justifyContent: "center"
                            }}>
                              {stepNumbers.get(g.startIdx) ?? ""}
                            </div>
                          </div>
                          {fullMetric ? (
                            <MetricBlock
                              metric={fullMetric}
                              onClick={() => handleEditStep(idx)}
                              onDragStart={() => {}}
                              onDragEnter={() => {}}
                              onDrop={() => {}}
                              isDragOver={false}
                              disableDrag
                            />
                          ) : (
                            <div style={{ width: 140, minHeight: 140, borderRadius: 12, background: "#F8FAFC", border: "1.5px solid #e2e8f0", padding: "8px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: "#1a2332", textAlign: "center" }}>{step.metricLabel ?? "?"}</div>
                              <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332", textAlign: "center" }}>{step.metricValue ?? ""}</div>
                            </div>
                          )}
                        </div>
                      ];
                    }
                    if (g.type === "number" && g.step) {
                      const step = g.step;
                      const idx = steps.indexOf(step);
                      const isEditing = editingStepIndex === idx;
                      const numVal = step.numberValue !== undefined ? step.numberValue : "";
                      return [
                        lineBefore && (
                          <div key={`nl-${gi}-${si}`} style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />
                        ),
                        <div key={`n-${si}-${gi}`}
                          draggable
                          onDragStart={e => {
                            e.dataTransfer.setData("text/plain", "");
                            e.dataTransfer.effectAllowed = "move";
                            e.stopPropagation();
                            dragStepIdxRef.current = idx;
                            dragCountRef.current = 1;
                            handleEditStep(idx);
                            const el = e.currentTarget.cloneNode(true) as HTMLElement;
                            el.style.cssText = 'position:absolute;top:-999px;left:-999px;transform:scale(0.5);transform-origin:top left;border-radius:12px;overflow:hidden;outline:2px solid #3B82F6;background:#EFF6FF;';
                            el.style.pointerEvents = 'none';
                            document.body.appendChild(el);
                            const r = el.getBoundingClientRect();
                            e.dataTransfer.setDragImage(el, r.width / 2, r.height / 2);
                            setTimeout(() => document.body.removeChild(el), 0);
                          }}
                          onDragOver={e => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const m = rect.left + rect.width / 2; const idx2 = e.clientX < m ? idx : idx + 1; setDropLineIndex(idx2); dropLineIndexRef.current = idx2; }}
                          onDrop={e => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const m = rect.left + rect.width / 2; const idx2 = e.clientX < m ? idx : idx + 1; handleStepDrop(idx2); }}
                          onDragEnd={() => { dragStepIdxRef.current = null; dragCountRef.current = 1; setDropLineIndex(null); dropLineIndexRef.current = null; }}
                          onClick={e => { e.stopPropagation(); handleEditStep(idx); }}
                          style={{ position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "flex-start", borderRadius: 12, padding: 2, outline: isEditing ? "2px solid #3B82F6" : "2px solid transparent", background: isEditing ? "#EFF6FF" : "transparent" }}>
                          {isEditing && (
                            <div onClick={e => { e.stopPropagation(); handleRemoveStep(idx); }} style={{ position: "absolute", top: 2, right: 2, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#3B82F6", fontSize: 22, fontWeight: 700, lineHeight: 1, zIndex: 10 }}>×</div>
                          )}
                          {renderCheckbox(idx, isEditing)}
                          <div style={{ display: "flex", justifyContent: "center", width: "100%", marginBottom: 3 }}>
                            <div style={{
                              width: 44 * csScale, height: 44 * csScale, borderRadius: "50%",
                              background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 20 * csScale, fontWeight: 700,
                              display: "flex", alignItems: "center", justifyContent: "center"
                            }}>
                              {stepNumbers.get(g.startIdx) ?? ""}
                            </div>
                          </div>
                          <div style={{ width: 140, minHeight: 100, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 12, background: "#F8FAFC", border: "1.5px solid #e2e8f0", padding: "8px" }}>
                            {isEditing ? (
                              <input autoFocus type="number" value={numVal}
                                placeholder="0"
                                onChange={e => {
                                  const raw = e.target.value;
                                  setSteps(prev => {
                                    const n = [...prev];
                                    if (n[idx]) n[idx] = { ...n[idx], numberValue: raw === "" ? undefined : parseFloat(raw) };
                                    return n;
                                  });
                                }}
                                onClick={e => e.stopPropagation()}
                                style={{ width: "100%", fontFamily: "inherit", fontSize: 20, fontWeight: 700, color: step.numberValue !== undefined ? "#1a2332" : "#94a3b8", textAlign: "center", border: "none", background: "transparent", outline: "none", padding: 0 }}
                              />
                            ) : (
                              <div style={{ fontSize: 22, fontWeight: 700, color: "#1a2332" }}>{numVal || "0"}</div>
                            )}
                          </div>
                        </div>
                      ];
                    }
                    if (g.type === "operator" && g.step) {
                      const step = g.step;
                      const idx = steps.indexOf(step);
                      const isEditing = editingStepIndex === idx;
                      return [
                        lineBefore && (
                          <div key={`ol-${gi}-${si}`} style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />
                        ),
                        <div key={`o-${si}-${gi}`}
                          draggable
                          onDragStart={e => {
                            e.dataTransfer.setData("text/plain", "");
                            e.dataTransfer.effectAllowed = "move";
                            e.stopPropagation();
                            dragStepIdxRef.current = idx;
                            dragCountRef.current = 1;
                            handleEditStep(idx);
                            const el = e.currentTarget.cloneNode(true) as HTMLElement;
                            el.style.cssText = 'position:absolute;top:-999px;left:-999px;transform:scale(0.5);transform-origin:top left;border-radius:12px;overflow:hidden;outline:2px solid #3B82F6;background:#EFF6FF;';
                            el.style.pointerEvents = 'none';
                            document.body.appendChild(el);
                            const r = el.getBoundingClientRect();
                            e.dataTransfer.setDragImage(el, r.width / 2, r.height / 2);
                            setTimeout(() => document.body.removeChild(el), 0);
                          }}
                          onDragOver={e => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const m = rect.left + rect.width / 2; const idx2 = e.clientX < m ? idx : idx + 1; setDropLineIndex(idx2); dropLineIndexRef.current = idx2; }}
                          onDrop={e => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const m = rect.left + rect.width / 2; const idx2 = e.clientX < m ? idx : idx + 1; handleStepDrop(idx2); }}
                          onDragEnd={() => { dragStepIdxRef.current = null; dragCountRef.current = 1; setDropLineIndex(null); dropLineIndexRef.current = null; }}
                          onClick={e => { e.stopPropagation(); handleEditStep(idx); }}
                          style={{ position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "flex-start", borderRadius: 12, padding: 2, outline: isEditing ? "2px solid #3B82F6" : "2px solid transparent", background: isEditing ? "#EFF6FF" : "transparent" }}>
                          {isEditing && (
                            <div onClick={e => { e.stopPropagation(); handleRemoveStep(idx); }} style={{ position: "absolute", top: 2, right: 2, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#3B82F6", fontSize: 22, fontWeight: 700, lineHeight: 1, zIndex: 10 }}>×</div>
                          )}
                          {renderCheckbox(idx, isEditing)}
                          <div style={{ display: "flex", justifyContent: "center", width: "100%", marginBottom: 3 }}>
                            <div style={{
                              width: 44 * csScale, height: 44 * csScale, borderRadius: "50%",
                              background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 20 * csScale, fontWeight: 700,
                              display: "flex", alignItems: "center", justifyContent: "center"
                            }}>
                              {stepNumbers.get(g.startIdx) ?? ""}
                            </div>
                          </div>
                          <div style={{ width: 140, minHeight: 140, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <div style={{
                              width: 48 * csScale, height: 48 * csScale, borderRadius: "50%",
                              background: "#3B82F6", color: "#fff",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: 22 * csScale, fontWeight: 700,
                            }}>
                              {step.operator === "*" ? "×" : step.operator === "/" ? "÷" : step.operator}
                            </div>
                          </div>
                        </div>
                      ];
                    }
                    return null;
                  };

                  const renderAddMenu = (insertAt: number, menuKey: string) => (
                    showAddMenu && addAtIndex === insertAt ? (
                      <div key={menuKey} ref={addMenuRef} style={{ position: "absolute", left: 0, top: "100%", marginTop: 4, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid #e2e8f0", zIndex: 50, minWidth: 170, overflow: "hidden" }}>
                        <div onClick={e => { e.stopPropagation(); setShowAddMenu(false); setForceSearch(true); setPendingOperator(false); setEditingStepIndex(null); setSearchQuery(""); setTimeout(() => searchRef.current?.focus(), 50); }} style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", color: "#1a2332" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>Metric</div>
                        <div onClick={e => { e.stopPropagation(); handleAddNumberStep(); }} style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", color: "#1a2332" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>Number</div>
                        <div onClick={e => { e.stopPropagation(); setShowAddMenu(false); setForceSearch(false); setPendingOperator(true); setEditingStepIndex(null); setSearchQuery(""); }} style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", color: "#1a2332" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>Math</div>
                      </div>
                    ) : null
                  );

                  const renderPlusButton = (insertAt: number, key: string) => (
                    <div key={key} style={{ alignSelf: "center", position: "relative" }}
                      onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDropLineIndex(insertAt); dropLineIndexRef.current = insertAt; }}
                      onDrop={e => { e.preventDefault(); e.stopPropagation(); handleStepDrop(insertAt); }}>
                      <div onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setAddAtIndex(insertAt); setShowAddMenu(v => !v); }}
                        style={{ width: 36, height: 36, borderRadius: "50%", border: "1.5px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#94a3b8", fontSize: 18, background: "#fff", flexShrink: 0 }}>+</div>
                      {renderAddMenu(insertAt, `menu-${key}`)}
                    </div>
                  );

                  // Recursive renderer for nested paren groups
                  const renderRange = (rStart: number, rEnd: number): React.ReactNode[] => {
                    const rangeLen = rEnd - rStart;
                    if (rangeLen <= 0) return [];
                    const subGroups: typeof renderGroups = [];
                    let ri = rStart;
                    while (ri < rEnd) {
                      if (steps[ri].type === "operator" && steps[ri].operator === "paren-start") {
                        let depth = 1; let rj = ri + 1;
                        while (rj < rEnd && depth > 0) {
                          if (steps[rj].type === "operator" && steps[rj].operator === "paren-start") depth++;
                          else if (steps[rj].type === "operator" && steps[rj].operator === "paren-end") depth--;
                          if (depth > 0) rj++;
                        }
                        subGroups.push({ type: "paren-group", steps: steps.slice(ri, rj + 1), groupIdx: ri, startIdx: ri });
                        ri = rj + 1;
                      } else if (steps[ri].type === "operator" && steps[ri].operator === "paren-end") {
                        ri++;
                      } else if (steps[ri].type === "number") {
                        subGroups.push({ type: "number", step: steps[ri], groupIdx: ri, startIdx: ri });
                        ri++;
                      } else {
                        subGroups.push({ type: steps[ri].type as "metric" | "operator", step: steps[ri], groupIdx: ri, startIdx: ri });
                        ri++;
                      }
                    }
                    if (subGroups.length === 0) return [];
                    // Merge paren-group + "/" + paren-group into fraction
                    for (let ri = 0; ri < subGroups.length - 2; ri++) {
                      const a = subGroups[ri];
                      const b = subGroups[ri + 1];
                      const c = subGroups[ri + 2];
                      if (a.type === "paren-group" && b.type === "operator" && b.step?.operator === "/" && c.type === "paren-group") {
                        subGroups.splice(ri, 3, { type: "fraction", steps: [...a.steps!, b.step, ...c.steps!], groupIdx: ri, startIdx: a.startIdx });
                      }
                    }

                    const subSections: typeof sections = [];
                    for (let sri = 0; sri < subGroups.length; sri++) {
                      const g = subGroups[sri];
                      const last = subSections[subSections.length - 1];
                      const sCnt = g.type === "fraction" || g.type === "paren-group" ? g.steps!.length : 1;
                      if (last && last.type === "seq") {
                        last.groups!.push(g);
                        last.endStepIdx = g.startIdx + sCnt;
                      } else {
                        subSections.push({ type: "seq", groups: [g], endStepIdx: g.startIdx + sCnt });
                      }
                    }

                    const subResult: React.ReactNode[] = [];
                    subSections.forEach((sec, ssi) => {
                      if (sec.type === "seq") {
                        const secRendered: React.ReactNode[] = [];
                        sec.groups!.forEach((g, ggi) => {
                          if (g.type === "paren-group") {
                            const pgLineBefore = dropLineIndex === g.startIdx;
                            const rpgIsSelected = selectedGroupStartIdx === g.startIdx;
                            if (pgLineBefore) secRendered.push(<div key={`rpgline-${rStart}-${ssi}-${ggi}`} style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />);
                            secRendered.push(
                              <div key={`rpg-${rStart}-${ssi}-${ggi}`}
                                onClick={e => { e.stopPropagation(); setSelectedGroupStartIdx(rpgIsSelected ? null : g.startIdx); }}
                                draggable
                                onDragStart={e => {
                                  e.dataTransfer.setData("text/plain", "");
                                  e.dataTransfer.effectAllowed = "move";
                                  e.stopPropagation();
                                  dragStepIdxRef.current = g.startIdx;
                                  dragCountRef.current = g.steps!.length;
                                  const el = e.currentTarget.cloneNode(true) as HTMLElement;
                                  el.style.cssText = 'position:absolute;top:-999px;left:-999px;transform:scale(0.5);transform-origin:top left;border-radius:12px;overflow:hidden;outline:2px solid #3B82F6;background:#EFF6FF;';
                                  el.style.pointerEvents = 'none';
                                  document.body.appendChild(el);
                                  const r = el.getBoundingClientRect();
                                  e.dataTransfer.setDragImage(el, r.width / 2, r.height / 2);
                                  setTimeout(() => document.body.removeChild(el), 0);
                                }}
                                onDragOver={e => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const x = e.clientX - rect.left; const w = rect.width; const idx = x < w * 0.15 ? g.startIdx : x > w * 0.85 ? g.startIdx + g.steps!.length : g.startIdx + g.steps!.length - 1; setDropLineIndex(idx); dropLineIndexRef.current = idx; }}
                                onDrop={e => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const x = e.clientX - rect.left; const w = rect.width; const idx = x < w * 0.15 ? g.startIdx : x > w * 0.85 ? g.startIdx + g.steps!.length : g.startIdx + g.steps!.length - 1; handleStepDrop(idx); }}
                                onDragEnd={() => { dragStepIdxRef.current = null; dragCountRef.current = 1; setDropLineIndex(null); dropLineIndexRef.current = null; }}
                                style={{ position: "relative", display: "inline-flex", flexWrap: "wrap", gap: 6, padding: "8px 12px", border: `2px solid ${rpgIsSelected ? "#3B82F6" : "#e2e8f0"}`, borderRadius: 16, background: "#fff", alignItems: "flex-start", minWidth: `${140 * Math.max(0.6, Math.min(1, cardSize / 140))}px`, minHeight: `${140 * Math.max(0.6, Math.min(1, cardSize / 140))}px` }}>
                                {rpgIsSelected && (
                                  <div onClick={e => { e.stopPropagation(); handleRemoveGroup(g.startIdx); }} style={{ position: "absolute", top: -6, right: -6, width: 24, height: 24, borderRadius: "50%", background: "#3B82F6", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 14, fontWeight: 700, zIndex: 20, boxShadow: "0 2px 6px rgba(0,0,0,0.15)" }}>×</div>
                                )}
                                {renderRange(g.startIdx + 1, g.startIdx + g.steps!.length - 1)}
                                {dropLineIndex === g.startIdx + g.steps!.length - 1 && dropLineIndex > g.startIdx && dropLineIndex < g.startIdx + g.steps!.length && (
                                  <div style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />
                                )}
                                {renderPlusButton(g.startIdx + g.steps!.length - 1, `rpgp-${rStart}-${ssi}-${ggi}`)}
                              </div>
                            );
                          } else {
                            const r = innerRenderGroup(g, ggi, ssi, cardSize, 1);
                            if (r) secRendered.push(...r);
                          }
                        });
                        const isLast = ssi === subSections.length - 1;
                        if (isLast) {
                          subResult.push(...secRendered);
                        } else {
                          subResult.push(
                            <div key={`rw-${rStart}-${ssi}`} style={{ display: "inline-flex", flexWrap: "wrap", gap: 6, padding: "8px 12px", border: "2px solid #e2e8f0", borderRadius: 16, background: "#fff", alignItems: "flex-start" }}
                              onClick={e => e.stopPropagation()}
                              onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDropLineIndex(sec.endStepIdx); dropLineIndexRef.current = sec.endStepIdx; }}
                              onDrop={e => { e.preventDefault(); e.stopPropagation(); handleStepDrop(sec.endStepIdx); }}>
                              {secRendered}
                              {dropLineIndex === sec.endStepIdx && <div style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />}
                              {renderPlusButton(sec.endStepIdx, `rp-${rStart}-${ssi}`)}
                            </div>
                          );
                        }
                      }
                    });
                    return subResult;
                  };

                  const sections: { type: "seq"; groups: typeof renderGroups; endStepIdx: number }[] = [];
                  for (let ri = 0; ri < renderGroups.length; ri++) {
                    const g = renderGroups[ri];
                    const last = sections[sections.length - 1];
                    const stepCount = g.type === "fraction" || g.type === "paren-group" ? g.steps!.length : 1;
                    if (last && last.type === "seq") {
                      last.groups!.push(g);
                      last.endStepIdx = g.startIdx + stepCount;
                    } else {
                      sections.push({ type: "seq", groups: [g], endStepIdx: g.startIdx + stepCount });
                    }
                  }

                  // Render sections
                  const result: React.ReactNode[] = [];
                  sections.forEach((sec, si) => {
                    if (sec.type === "seq") {
                      const groupsRendered: React.ReactNode[] = [];
                      sec.groups!.forEach((g, gi) => {
                          if (g.type === "paren-group") {
                          const lineBefore = dropLineIndex === g.startIdx;
                          const pgIsSelected = selectedGroupStartIdx === g.startIdx;
                          if (lineBefore) groupsRendered.push(<div key={`pgline-${si}-${gi}`} style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />);
                          groupsRendered.push(
                            <div key={`pg-${si}-${gi}`}
                              onClick={e => { e.stopPropagation(); setSelectedGroupStartIdx(pgIsSelected ? null : g.startIdx); }}
                              draggable
                              onDragStart={e => {
                                e.dataTransfer.setData("text/plain", "");
                                e.dataTransfer.effectAllowed = "move";
                                e.stopPropagation();
                                dragStepIdxRef.current = g.startIdx;
                                dragCountRef.current = g.steps!.length;
                                const el = e.currentTarget.cloneNode(true) as HTMLElement;
                                el.style.cssText = 'position:absolute;top:-999px;left:-999px;transform:scale(0.5);transform-origin:top left;border-radius:12px;overflow:hidden;outline:2px solid #3B82F6;background:#EFF6FF;';
                                el.style.pointerEvents = 'none';
                                document.body.appendChild(el);
                                const r = el.getBoundingClientRect();
                                e.dataTransfer.setDragImage(el, r.width / 2, r.height / 2);
                                setTimeout(() => document.body.removeChild(el), 0);
                              }}
                              onDragOver={e => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const x = e.clientX - rect.left; const w = rect.width; const idx = x < w * 0.15 ? g.startIdx : x > w * 0.85 ? g.startIdx + g.steps!.length : g.startIdx + g.steps!.length - 1; setDropLineIndex(idx); dropLineIndexRef.current = idx; }}
                              onDrop={e => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const x = e.clientX - rect.left; const w = rect.width; const idx = x < w * 0.15 ? g.startIdx : x > w * 0.85 ? g.startIdx + g.steps!.length : g.startIdx + g.steps!.length - 1; handleStepDrop(idx); }}
                              onDragEnd={() => { dragStepIdxRef.current = null; dragCountRef.current = 1; setDropLineIndex(null); dropLineIndexRef.current = null; }}
                              style={{ position: "relative", display: "inline-flex", flexWrap: "wrap", gap: 6, padding: "8px 12px", border: `2px solid ${pgIsSelected ? "#3B82F6" : "#e2e8f0"}`, borderRadius: 16, background: "#fff", alignItems: "flex-start", minWidth: `${140 * Math.max(0.6, Math.min(1, cardSize / 140))}px`, minHeight: `${140 * Math.max(0.6, Math.min(1, cardSize / 140))}px` }}>
                              {pgIsSelected && (
                                <div onClick={e => { e.stopPropagation(); handleRemoveGroup(g.startIdx); }} style={{ position: "absolute", top: -6, right: -6, width: 24, height: 24, borderRadius: "50%", background: "#3B82F6", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 14, fontWeight: 700, zIndex: 20, boxShadow: "0 2px 6px rgba(0,0,0,0.15)" }}>×</div>
                              )}
                              {renderRange(g.startIdx + 1, g.startIdx + g.steps!.length - 1)}
                              {dropLineIndex === g.startIdx + g.steps!.length - 1 && dropLineIndex > g.startIdx && dropLineIndex < g.startIdx + g.steps!.length && (
                                <div style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />
                              )}
                              {renderPlusButton(g.startIdx + g.steps!.length - 1, `pgp-${si}-${gi}`)}
                            </div>
                          );
                        } else {
                          const rendered = innerRenderGroup(g, gi, si, cardSize, 1);
                          if (rendered) groupsRendered.push(...rendered);
                        }
                      });
                      const isLast = si === sections.length - 1;
                      const lineAtEnd = dropLineIndex === sec.endStepIdx;
                      if (isLast) {
                        result.push(...groupsRendered);
                      } else {
                        result.push(
                          <div key={`wrap-${si}`} style={{ display: "inline-flex", flexWrap: "wrap", gap: 6, padding: "8px 12px", border: "2px solid #e2e8f0", borderRadius: 16, background: "#fff", alignItems: "flex-start" }}
                            onClick={e => e.stopPropagation()}
                            onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDropLineIndex(sec.endStepIdx); dropLineIndexRef.current = sec.endStepIdx; }}
                            onDrop={e => { e.preventDefault(); e.stopPropagation(); handleStepDrop(sec.endStepIdx); }}>
                            {groupsRendered}
                            {lineAtEnd && <div style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />}
                            {renderPlusButton(sec.endStepIdx, `sp-${si}`)}
                          </div>
                        );
                      }
                    }
                      });
                  // Far-right plus button
                  result.push(renderPlusButton(steps.length, "end"));
                  return result;
                })()}
                {dropLineIndex === steps.length && (
                  <div key="end-line" style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />
                )}
              </div>
              );
            })()}
          </div>

          {/* Contextual Picker */}
          <div>
            {showMathPicker && (
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#64748b", marginBottom: 10 }}>Select the math:</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <button onClick={() => handleSelectOperator("+")} style={{ padding: "14px 0", borderRadius: 16, border: "2px solid #e2e8f0", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer", fontSize: 24, fontWeight: 700, color: "#3B82F6" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#3B82F6"; e.currentTarget.style.background = "#EFF6FF"; }} onMouseLeave={e => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.background = "#fff"; }}>
                    <span>+</span>
                    <span style={{ fontSize: 10, fontWeight: 500, color: "#94a3b8" }}>Add</span>
                  </button>
                  <button onClick={() => handleSelectOperator("-")} style={{ padding: "14px 0", borderRadius: 16, border: "2px solid #e2e8f0", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer", fontSize: 24, fontWeight: 700, color: "#3B82F6" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#3B82F6"; e.currentTarget.style.background = "#EFF6FF"; }} onMouseLeave={e => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.background = "#fff"; }}>
                    <span>−</span>
                    <span style={{ fontSize: 10, fontWeight: 500, color: "#94a3b8" }}>Subtract</span>
                  </button>
                  <button onClick={() => handleSelectOperator("*")} style={{ padding: "14px 0", borderRadius: 16, border: "2px solid #e2e8f0", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer", fontSize: 24, fontWeight: 700, color: "#3B82F6" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#3B82F6"; e.currentTarget.style.background = "#EFF6FF"; }} onMouseLeave={e => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.background = "#fff"; }}>
                    <span>×</span>
                    <span style={{ fontSize: 10, fontWeight: 500, color: "#94a3b8" }}>Multiply</span>
                  </button>
                  <button onClick={() => handleSelectOperator("/")} style={{ padding: "14px 0", borderRadius: 16, border: "2px solid #e2e8f0", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer", fontSize: 24, fontWeight: 700, color: "#3B82F6" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#3B82F6"; e.currentTarget.style.background = "#EFF6FF"; }} onMouseLeave={e => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.background = "#fff"; }}>
                    <span>÷</span>
                    <span style={{ fontSize: 10, fontWeight: 500, color: "#94a3b8" }}>Divide</span>
                  </button>
                  <button onClick={() => handleAddParentheses()} style={{ padding: "14px 0", borderRadius: 16, border: "2px solid #e2e8f0", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer", fontSize: 24, fontWeight: 700, color: "#3B82F6" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#3B82F6"; e.currentTarget.style.background = "#EFF6FF"; }} onMouseLeave={e => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.background = "#fff"; }}>
                    <span style={{ fontSize: 20 }}>( )</span>
                    <span style={{ fontSize: 10, fontWeight: 500, color: "#94a3b8" }}>Group</span>
                  </button>
                  <button onClick={() => handleAddFraction()} style={{ padding: "14px 0", borderRadius: 16, border: "2px solid #e2e8f0", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer", fontSize: 24, fontWeight: 700, color: "#3B82F6" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#3B82F6"; e.currentTarget.style.background = "#EFF6FF"; }} onMouseLeave={e => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.background = "#fff"; }}>
                    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", lineHeight: 1 }}>
                      <span style={{ padding: "0 4px 2px", borderBottom: "2px solid currentColor", fontSize: 14 }}>□</span>
                      <span style={{ padding: "2px 4px 0", fontSize: 14 }}>□</span>
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 500, color: "#94a3b8" }}>Fraction</span>
                  </button>
                </div>
              </div>
            )}
            {!showMathPicker && (
              <>
                <div style={{ marginBottom: 16 }}>
                  <input
                    ref={searchRef}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && steps.length > 0) {
                        e.preventDefault();
                        if (e.shiftKey) {
                          setSteps(prev => [{ type: "operator", operator: "paren-start" }, ...prev, { type: "operator", operator: "paren-end" }, { type: "operator", operator: "/" }, { type: "operator", operator: "paren-start" }, { type: "operator", operator: "paren-end" }]);
                        } else {
                          setSteps(prev => [{ type: "operator", operator: "paren-start" }, ...prev, { type: "operator", operator: "paren-end" }]);
                        }
                      }
                    }}
                    placeholder={steps.length === 0 ? "Start typing the name of a metric box..." : "Start typing the next metric box..."}
                    style={{
                      width: "100%", border: "none", outline: "none",
                      fontSize: steps.length === 0 ? 48 : 18,
                      fontWeight: steps.length === 0 ? 700 : 300,
                      color: "#1a2332", background: "transparent",
                      fontFamily: "inherit",
                      borderBottom: "2px solid #e2e8f0",
                      padding: steps.length === 0 ? "24px 0" : "8px 0",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                {filteredMetrics.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "row", gap: 10, overflowX: "auto", flexWrap: "nowrap", padding: "14px 0" }}>
                    {filteredMetrics.slice(0, 12).map(m => (
                      <div key={m.id} style={{ cursor: "pointer", flexShrink: 0 }}>
                        <MetricBlock metric={m} onClick={() => handleSelectMetric(m)} onDragStart={() => {}} onDragEnter={() => {}} onDrop={() => {}} isDragOver={false} disableDrag />
                      </div>
                    ))}
                  </div>
                )}
                {steps.length === 0 && (
                  <button onClick={handleAddNumberStep} style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#334155", fontSize: 13, fontWeight: 500, cursor: "pointer", marginTop: 12, display: "block" }}>
                    Start with a Number
                  </button>
                )}
                {searchQuery.trim() && filteredMetrics.length === 0 && (
                  <div style={{ padding: "20px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
                    No metric boxes found matching "{searchQuery}"
                  </div>
                )}
                {steps.length === 0 && !searchQuery.trim() && filteredMetrics.length === 0 && (
                  <div style={{ padding: "40px 20px", textAlign: "center" }}>
                    <div style={{ fontSize: 14, color: "#94a3b8", marginBottom: 6 }}>No metric boxes available</div>
                    <div style={{ fontSize: 12, color: "#cbd5e1" }}>Create some metric boxes on your dashboard first</div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Save — fixed */}
        {isMobile && targetMetric && steps.length > 0 && (
          <div style={{ borderTop: "1px solid #e2e8f0", padding: "12px 16px", background: "#F8FAFC" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
              Final Output
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 20, fontWeight: 300, color: "#1a2332", fontFamily: "serif", lineHeight: 1 }}>=</span>
              <MetricBlock
                metric={{
                  id: targetMetric.id, label: targetMetric.label, icon: targetMetric.icon,
                  color: targetMetric.color, value: liveFormatted ?? "...",
                  metricType: targetMetric.metricType, currencySymbol: targetMetric.currencySymbol,
                  modal: targetMetric.modal, history: targetMetric.history, equation: targetMetric.equation,
                }}
                onClick={() => {}} onDragStart={() => {}} onDragEnter={() => {}} onDrop={() => {}} isDragOver={false} disableDrag
              />
            </div>
          </div>
        )}
        <div style={{ borderTop: "1px solid #e2e8f0", padding: isMobile ? "12px 16px" : "16px 24px", flexShrink: 0, background: "#F8FAFC", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          {onSaveDraft && (
            <button onClick={handleSaveDraft}
              style={{
                padding: isMobile ? "10px 18px" : "12px 24px", borderRadius: 8, border: "1.5px solid #3B82F6",
                background: "#fff", color: "#3B82F6",
                fontSize: isMobile ? 13 : 14, fontWeight: 600, cursor: "pointer",
              }}>
              Save Draft
            </button>
          )}
          <button onClick={handleSave} disabled={!equationValid}
            style={{
              padding: isMobile ? "10px 24px" : "12px 32px", borderRadius: 8, border: "none",
              background: equationValid ? "linear-gradient(135deg,#3B82F6,#06B6D4)" : "#e2e8f0",
              color: equationValid ? "#fff" : "#94a3b8",
              fontSize: isMobile ? 13 : 14, fontWeight: 600, cursor: equationValid ? "pointer" : "not-allowed",
            }}>
            Save Equation
          </button>
        </div>
      </div>

      {/* Right panel ~25% — Final Output, only on desktop */}
      {!isMobile && targetMetric && steps.length > 0 && (
        <div style={{ flex: 1, maxWidth: "25%", minWidth: 220, background: "#F8FAFC", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "20px 20px", borderBottom: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Final Output
            </div>
          </div>
          <div style={{ flex: 1, padding: "24px 20px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
            <span style={{ fontSize: 32, fontWeight: 300, color: "#1a2332", fontFamily: "serif", lineHeight: 1 }}>=</span>
            <MetricBlock
              metric={{
                id: targetMetric.id, label: targetMetric.label, icon: targetMetric.icon,
                color: targetMetric.color, value: liveFormatted ?? "...",
                metricType: targetMetric.metricType, currencySymbol: targetMetric.currencySymbol,
                modal: targetMetric.modal, history: targetMetric.history, equation: targetMetric.equation,
              }}
              onClick={() => {}} onDragStart={() => {}} onDragEnter={() => {}} onDrop={() => {}} isDragOver={false} disableDrag
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CHAT PANEL
// ═══════════════════════════════════════════════════════════════════════════

function ChatPanel({ sections, onClose, isMobile }: { sections: Section[]; onClose: () => void; isMobile?: boolean }) {
  const channels = ["General", ...sections.map(s => s.title)];
  const [active, setActive] = useState("General");
  const msgs: Record<string, { name: string; time: string; text: string }[]> = {
    General: [{ name: "Julia", time: "14:27", text: "Sounds good @Bryan." }, { name: "Bryan", time: "14:23", text: "Thanks @Julia. When can you have it transferred over by?" }],
  };
  const display = msgs[active] ?? msgs["General"];
  return (
    <div style={{ position: "fixed", right: 0, top: 0, bottom: 0, width: isMobile ? "100vw" : "clamp(260px,28vw,340px)", background: "#fff", boxShadow: "-4px 0 32px rgba(0,0,0,0.1)", zIndex: 1500, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332" }}>Chat</div>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>×</button>
      </div>
      <div style={{ display: "flex", gap: 4, padding: "6px 10px", borderBottom: "1px solid #f1f5f9", overflowX: "auto" }}>
        {channels.map(ch => (
          <button key={ch} onClick={() => setActive(ch)} style={{ padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 500, border: "none", cursor: "pointer", flexShrink: 0, background: active === ch ? "#3B82F6" : "#f1f5f9", color: active === ch ? "#fff" : "#64748b" }}>{ch}</button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "14px" }}>
        {display.map((m, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "flex-start" }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#4C9FE8", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, color: "#fff" }}>{m.name[0]}</div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#1a2332", marginBottom: 1 }}>{m.name} <span style={{ color: "#94a3b8", fontWeight: 400 }}>{m.time}</span></div>
              <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.5 }}>{m.text}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ padding: "10px 14px", borderTop: "1px solid #f1f5f9" }}>
        <input placeholder="Type Response..." style={{ width: "100%", padding: "8px 14px", borderRadius: 99, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none", boxSizing: "border-box", background: "#f8fafc" }} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SIDEBAR
// ═══════════════════════════════════════════════════════════════════════════

const NAV: { icon: string; label: string; page: Page; comingSoon?: boolean }[] = [
  { icon: "House", label: "Home", page: "home" },
  { icon: "Target", label: "Goals", page: "goals" },
  { icon: "CheckSquare", label: "Tasks", page: "tasks" },
  { icon: "Notebook", label: "Playbooks", page: "playbooks" },
  { icon: "Plugs", label: "Integrations", page: "integrations", comingSoon: true },
  { icon: "Users", label: "Team", page: "team" },
  { icon: "Gear", label: "Settings", page: "settings" },
];

function Sidebar({ active, onNav, onClose, isMobile, avatarUrl, firstName, health, activeOrg, orgs, showOrgDropdown, onToggleOrgDropdown, onSwitchOrg, currentUserLevel, onOpenInviteModal, menuPermissions, tasks, setTasks, orgMembers, userEmail }: {
  active: Page; onNav: (p: Page) => void; onClose: () => void;
  isMobile: boolean; avatarUrl?: string; firstName?: string;
  health: HealthResult;
  activeOrg: Org | null; orgs: Org[]; showOrgDropdown: boolean;
  onToggleOrgDropdown: () => void; onSwitchOrg: (org: Org) => void;
  currentUserLevel: OrgPermissionLevel; onOpenInviteModal: () => void;
  menuPermissions: Record<string, string[]>;
  tasks: Task[]; setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  orgMembers: OrgMember[]; userEmail: string;
}) {
  const orgDropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (orgDropdownRef.current && !orgDropdownRef.current.contains(e.target as Node)) { if (showOrgDropdown) onToggleOrgDropdown(); } };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, [showOrgDropdown, onToggleOrgDropdown]);

  const hiddenItems = currentUserLevel === "owner" ? [] : (menuPermissions[currentUserLevel] || []);
  const filteredNav = NAV.filter(item => {
    if (item.page === "home") return true;
    const key = item.label.toLowerCase();
    if (currentUserLevel === "viewer" && (key === "integrations" || key === "team")) return false;
    return !hiddenItems.includes(key);
  });

  const [sidebarShowAdd, setSidebarShowAdd] = useState(false);
  const [sidebarAddText, setSidebarAddText] = useState("");
  const [sidebarAddAssignee, setSidebarAddAssignee] = useState(userEmail || "");
  const [sidebarAddDueDate, setSidebarAddDueDate] = useState("");
  const [sidebarAddPriority, setSidebarAddPriority] = useState(false);
  const mySidebarTasks = tasks.filter(t => t.assignedTo === userEmail);
  const sidebarDoneCount = mySidebarTasks.filter(t => t.done).length;
  const sidebarTotalCount = mySidebarTasks.length;
  const sidebarPct = sidebarTotalCount > 0 ? Math.round((sidebarDoneCount / sidebarTotalCount) * 100) : 0;
  const sidebarTaskList = mySidebarTasks.filter(t => !t.done).slice(0, 5);
  const sidebarToggle = (id: string) => setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
  const sidebarAddTask = () => {
    if (!sidebarAddText.trim()) return;
    setTasks(prev => [{
      id: crypto.randomUUID(), text: sidebarAddText.trim(), done: false,
      assignedTo: sidebarAddAssignee || userEmail, createdBy: userEmail,
      createdAt: new Date().toISOString(), dueDate: sidebarAddDueDate || undefined,
      priority: sidebarAddPriority || undefined,
    }, ...prev]);
    setSidebarAddText("");
    setSidebarAddDueDate("");
    setSidebarAddPriority(false);
  };

  return (
    <aside style={{ width: 240, flexShrink: 0, background: "linear-gradient(135deg,#3B82F6,#06B6D4)", display: "flex", flexDirection: "column", boxShadow: "2px 0 12px rgba(0,0,0,0.06)", height: "100dvh" } as React.CSSProperties}>
      <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "28px 18px 20px", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", position: "relative", marginBottom: 12 }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(255,255,255,0.2)", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
            {avatarUrl ? <img src={avatarUrl} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ color: "#fff" }}>👤</span>}
          </div>
          {!isMobile && <div onClick={onClose} style={{ position: "absolute", right: 0, width: 26, height: 26, borderRadius: "50%", border: "1.5px solid rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", fontSize: 14 }}>‹</div>}
        </div>
        <div style={{ textAlign: "center", width: "100%" }}>
          <div style={{ fontSize: 14, fontWeight: 400, color: "#fff" }}>{firstName ? `Welcome ${firstName}` : "Welcome"}</div>
          {/* Org switcher */}
          <div ref={orgDropdownRef} style={{ position: "relative", display: "inline-block", marginTop: 2 }}>
            <div onClick={onToggleOrgDropdown} style={{ fontSize: 14, fontWeight: 400, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4, opacity: 0.85 }}>
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 }}>to {activeOrg?.isPersonal ? "your dashboard" : activeOrg?.name}</span>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, transform: showOrgDropdown ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
                <path d="M2 4L5 7L8 4" stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            {showOrgDropdown && (
              <div style={{ position: "absolute", top: 28, left: "50%", transform: "translateX(-50%)", zIndex: 110, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.15)", border: "1px solid #e2e8f0", minWidth: 180, overflow: "hidden" }}>
                {orgs.map(org => (
                  <div key={org.id} onClick={() => onSwitchOrg(org)}
                    style={{ padding: "10px 14px", fontSize: 13, cursor: "pointer", color: activeOrg?.id === org.id ? "#3B82F6" : "#1a2332", fontWeight: activeOrg?.id === org.id ? 600 : 400, background: activeOrg?.id === org.id ? "#EFF6FF" : "transparent", borderBottom: "1px solid #f1f5f9", textAlign: "left" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                    onMouseLeave={e => (e.currentTarget.style.background = activeOrg?.id === org.id ? "#EFF6FF" : "transparent")}>
                    {org.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <nav style={{ flex: 1, padding: "6px 12px" }}>
        {filteredNav.map(item => {
          const isActive = active === item.page;
          return (
            <div key={item.label} onClick={() => { if (!item.comingSoon) onNav(item.page); }}
              style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 12px", borderRadius: 99, marginBottom: 3,
                cursor: item.comingSoon ? "default" : "pointer",
                background: isActive ? "rgba(255,255,255,0.15)" : "transparent",
                border: isActive ? "1.5px solid rgba(255,255,255,0.8)" : "1.5px solid transparent",
                color: "#fff", fontSize: 12, fontWeight: isActive ? 600 : 400,
                transition: "all 0.15s", opacity: item.comingSoon ? 0.55 : 1 }}>
              <IconGlyph name={item.icon} size={21} color="#fff" />
              <span style={{ whiteSpace: "nowrap" }}>{item.label}</span>
              {item.comingSoon && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 99, background: "rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.7)", marginLeft: "auto", whiteSpace: "nowrap" }}>Soon</span>}
            </div>
          );
        })}
      </nav>
      {/* ── Health Progress ── */}
      {health.hasData && (() => {
  const barColors = { green: "#4CAF7D", yellow: "#F5A623", red: "#E85D75" };
  return (
    <div style={{ padding: "0 18px 8px" }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.7)", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Health</span>
        <span style={{ color: "#fff", fontWeight: 700 }}>{health.score}%</span>
      </div>
      <div style={{ width: "100%", height: 24, background: "rgba(255,255,255,0.2)", borderRadius: 99, overflow: "hidden" }}>
        <div style={{
          width: `${health.score}%`, height: "100%",
          background: barColors[health.barColor], borderRadius: 99,
          transition: "width 400ms ease, background 300ms ease"
        }} />
      </div>
      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.6)", marginTop: 4, textAlign: "center" }}>
        {health.counts.green}G · {health.counts.yellow}Y · {health.counts.red}R
        {health.counts.gray > 0 ? ` · ${health.counts.gray} unmatched` : ""}
      </div>
    </div>
  );
})()}
      {/* ── Sidebar Tasks Widget ── */}
      <div style={{ background: "#fff", borderRadius: 12, margin: "8px 12px 4px", padding: "12px 14px" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#1a2332", marginBottom: 8 }}>Your Tasks</div>
        <div style={{ height: 6, borderRadius: 99, background: "#e2e8f0", marginBottom: 10, overflow: "hidden" }}>
          <div style={{ width: `${sidebarPct}%`, height: "100%", borderRadius: 99, background: "#4CAF7D", transition: "width 0.3s" }} />
        </div>
        {sidebarTaskList.map(t => (
          <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0", cursor: "pointer" }}
            onClick={() => sidebarToggle(t.id)}>
            <div style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0, border: t.done ? "none" : "1.5px solid #d1d5db", background: t.done ? "#4CAF7D" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 8 }}>{t.done ? "✓" : ""}</div>
            <span style={{ fontSize: 11, color: "#1a2332", flex: 1, textDecoration: t.done ? "line-through" : "none", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.text}</span>
          </div>
        ))}
        <div onClick={() => onNav("tasks")} style={{ fontSize: 11, color: "#3B82F6", cursor: "pointer", fontWeight: 600, marginTop: 6, marginBottom: 8 }}>View all →</div>

        {sidebarShowAdd ? (
          <div>
            <input value={sidebarAddText} onChange={e => setSidebarAddText(e.target.value)}
              placeholder="New task..." autoFocus
              onKeyDown={e => { if (e.key === "Enter") sidebarAddTask(); }}
              style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 11, outline: "none", boxSizing: "border-box", marginBottom: 4 }} />
            <label style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9, color: sidebarAddPriority ? "#F5A623" : "#94a3b8", cursor: "pointer", marginBottom: 4, alignSelf: "flex-start" }}>
              <input type="checkbox" checked={sidebarAddPriority} onChange={e => setSidebarAddPriority(e.target.checked)} style={{ accentColor: "#F5A623", margin: 0, width: 12, height: 12 }} />
              {sidebarAddPriority ? "" : "Make priority?"}
            </label>
            <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
              <select value={sidebarAddAssignee} onChange={e => setSidebarAddAssignee(e.target.value)}
                style={{ flex: 1, padding: "4px 6px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 10, outline: "none", background: "#fff" }}>
                <option value={userEmail}>Me</option>
                {orgMembers.filter(m => m.status === "active" && m.email !== userEmail).map(m => (
                  <option key={m.id} value={m.email}>{m.name || m.email.split("@")[0]}</option>
                ))}
              </select>
              <input type="date" value={sidebarAddDueDate} onChange={e => setSidebarAddDueDate(e.target.value)}
                style={{ flex: 1, padding: "4px 6px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 10, outline: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={sidebarAddTask} disabled={!sidebarAddText.trim()}
                style={{ flex: 1, padding: "4px 0", borderRadius: 6, border: "none", background: sidebarAddText.trim() ? "#3B82F6" : "#e2e8f0", color: "#fff", fontSize: 10, fontWeight: 600, cursor: sidebarAddText.trim() ? "pointer" : "not-allowed" }}>Add</button>
              <button onClick={() => setSidebarShowAdd(false)} style={{ flex: 1, padding: "4px 0", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 10, cursor: "pointer", color: "#64748b" }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div onClick={() => setSidebarShowAdd(true)} style={{ fontSize: 11, color: "#3B82F6", cursor: "pointer", fontWeight: 600, display: "flex", alignItems: "center", gap: 3 }}>
            <span style={{ fontSize: 13 }}>+</span> Add New Task
          </div>
        )}
      </div>
      </div>
      <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <img src="https://dashello.co/wp-content/uploads/2023/08/White-Logo-Full.png" alt="Dashello" style={{ height: 26, objectFit: "contain", maxWidth: "80%" }} />
        {(currentUserLevel === "owner" || currentUserLevel === "admin") && (
          <button onClick={onOpenInviteModal} style={{ width: "100%", padding: "10px 0", borderRadius: 12, border: "none", background: "#fff", color: "#3B82F6", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Invite Team Members</button>
        )}
        <button onClick={() => supabase.auth.signOut()} style={{ width: "100%", padding: "10px 0", borderRadius: 12, border: "2px solid rgba(255,255,255,0.6)", background: "transparent", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Sign Out</button>
      </div>
    </aside>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// HOME PAGE — robust drag-drop
// ═══════════════════════════════════════════════════════════════════════════

function HomePage({ sections, setSections, onClickMetric, onSectionRemoved, onFiveAccountEnabledFromBox, onFiveAccountDisabledFromBox, onOpenEquationBuilder, orgMembers }: {
  sections: Section[];
  setSections: React.Dispatch<React.SetStateAction<Section[]>>;
  onClickMetric: (data: MetricModalData, metric: Metric) => void;
  onSectionRemoved?: (section: Section) => void;
  onFiveAccountEnabledFromBox?: () => void;
  onFiveAccountDisabledFromBox?: (sectionId: string, disabledMetricId: string, disabledLabel: string) => void;
  onOpenEquationBuilder?: (sectionId: string, metricId: string, reopenAfterSave?: boolean) => void;
  orgMembers?: OrgMember[];
}) {
  // Drag state stored in ref so it's always current in event handlers
  const dragMetricRef = useRef<{ sourceSid: string; sourceMid: string } | null>(null);
  const dragSectionRef = useRef<string | null>(null);
  const [dragMetricState, setDragMetricState] = useState<{ sourceSid: string; sourceMid: string } | null>(null);
  const [dragOverSid, setDragOverSid] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<{ targetSid: string; targetMid: string } | null>(null);
  const [showAddRow, setShowAddRow] = useState(false);

  const addSection = (name: string) => setSections(p => [...p, { id: crypto.randomUUID(), title: name, avatars: [], metrics: [] }]);
  const renameSection = (sid: string, name: string) => setSections(p => p.map(s => s.id === sid ? { ...s, title: name } : s));
  const removeSection = (sid: string) => {
    const removed = sections.find(s => s.id === sid);
    if (removed) onSectionRemoved?.(removed);
    setSections(p => p.filter(s => s.id !== sid));
  };
  const addMetric = (sid: string, m: Omit<Metric, "id">) => setSections(p => p.map(s => s.id === sid ? { ...s, metrics: [...s.metrics, { ...m, id: crypto.randomUUID() }] } : s));
  const addMetricById = useCallback((sid: string, m: Metric) => {
    setSections(prev => prev.map(s => s.id === sid ? { ...s, metrics: [...s.metrics, m] } : s));
  }, [setSections]);
  const removeMetric = (sid: string, mid: string) => setSections(p => p.map(s => s.id === sid ? { ...s, metrics: s.metrics.filter(m => m.id !== mid) } : s));
  const updateMetric = (sid: string, mid: string, updated: Omit<Metric, "id">) => setSections(p => p.map(s => s.id === sid ? { ...s, metrics: s.metrics.map(m => m.id === mid ? { ...updated, id: mid } : m) } : s));

  // Metric drag start
  const handleMetricDragStart = useCallback((sid: string, mid: string) => {
    dragMetricRef.current = { sourceSid: sid, sourceMid: mid };
    dragSectionRef.current = null;
    setDragMetricState({ sourceSid: sid, sourceMid: mid });
  }, []);

  // Metric drag enter on a target metric — set visual target only, don't reorder
  const handleMetricDragEnter = useCallback((targetSid: string, targetMid: string) => {
    if (!dragMetricRef.current) return;
    const { sourceSid, sourceMid } = dragMetricRef.current;
    if (sourceSid === targetSid && sourceMid === targetMid) {
      setDragOverTarget(null);
      return;
    }
    setDragOverTarget({ targetSid, targetMid });
  }, []);

  // Metric drop — reorder using the visual target, then clear state
  const handleMetricDrop = useCallback((targetSid: string, targetMid: string) => {
    if (!dragMetricRef.current) {
      setDragMetricState(null);
      setDragOverTarget(null);
      setDragOverSid(null);
      return;
    }
    const { sourceSid, sourceMid } = dragMetricRef.current;

    // If dragging to same position, just clear
    if (sourceSid === targetSid && sourceMid === targetMid) {
      dragMetricRef.current = null;
      setDragMetricState(null);
      setDragOverTarget(null);
      setDragOverSid(null);
      return;
    }

    setSections(prev => {
      const sourceSec = prev.find(s => s.id === sourceSid);
      if (!sourceSec) return prev;
      const movingMetric = sourceSec.metrics.find(m => m.id === sourceMid);
      if (!movingMetric) return prev;

      // Remove from source
      const withoutSource = prev.map(s =>
        s.id === sourceSid ? { ...s, metrics: s.metrics.filter(m => m.id !== sourceMid) } : s
      );

      // Insert in target section
      return withoutSource.map(s => {
        if (s.id !== targetSid) return s;
        if (targetMid === "__end__") {
          return { ...s, metrics: [...s.metrics, movingMetric] };
        }
        const targetIdx = s.metrics.findIndex(m => m.id === targetMid);
        if (targetIdx === -1) return { ...s, metrics: [...s.metrics, movingMetric] };
        const newMetrics = [...s.metrics];
        newMetrics.splice(targetIdx, 0, movingMetric);
        return { ...s, metrics: newMetrics };
      });
    });

    dragMetricRef.current = null;
    setDragMetricState(null);
    setDragOverTarget(null);
    setDragOverSid(null);
  }, [setSections]);

  // Section drag
  const handleSectionDragStart = useCallback((sid: string) => {
    dragSectionRef.current = sid;
    dragMetricRef.current = null;
    setDragMetricState(null);
  }, []);

  const handleSectionDragEnter = useCallback((e: React.DragEvent, targetSid: string) => {
    e.preventDefault();
    if (!dragSectionRef.current || dragSectionRef.current === targetSid) return;
    setDragOverSid(targetSid);
  }, []);

  const handleSectionDrop = useCallback((targetSid: string) => {
    if (!dragSectionRef.current || dragSectionRef.current === targetSid) { dragSectionRef.current = null; setDragOverSid(null); return; }
    const fromSid = dragSectionRef.current;
    setSections(prev => {
      const arr = [...prev];
      const fi = arr.findIndex(s => s.id === fromSid);
      const ti = arr.findIndex(s => s.id === targetSid);
      const [moved] = arr.splice(fi, 1);
      arr.splice(ti, 0, moved);
      return arr;
    });
    dragSectionRef.current = null; setDragOverSid(null);
  }, [setSections]);

  const handleDragEnd = useCallback(() => {
    dragMetricRef.current = null; dragSectionRef.current = null;
    setDragMetricState(null); setDragOverSid(null);
  }, []);

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "clamp(16px,4vw,28px) clamp(16px,4vw,32px)" }}
      onDragEnd={handleDragEnd}>
      {sections.map(s => (
        <DashSection key={s.id} section={s}
          onAddMetric={addMetric} onAddMetricById={addMetricById} onRemoveMetric={removeMetric} onUpdateMetric={updateMetric}
          onRenameSection={renameSection} onRemoveSection={removeSection}
          onClickMetric={onClickMetric}
          dragState={dragMetricState}
          onMetricDragStart={handleMetricDragStart}
          onMetricDragEnter={handleMetricDragEnter}
          onMetricDrop={handleMetricDrop}
          onSectionDragStart={() => handleSectionDragStart(s.id)}
          onSectionDragEnter={e => handleSectionDragEnter(e, s.id)}
          onSectionDrop={() => handleSectionDrop(s.id)}
          isSectionDragOver={dragOverSid === s.id}
          dragOverTarget={dragOverTarget}
          onFiveAccountEnabledFromBox={onFiveAccountEnabledFromBox}
          onFiveAccountDisabledFromBox={onFiveAccountDisabledFromBox}
          onOpenEquationBuilder={onOpenEquationBuilder}
          orgMembers={orgMembers}
        />
      ))}
      <div onClick={() => setShowAddRow(true)} style={{ display: "flex", alignItems: "center", gap: 8, color: "#94a3b8", fontSize: 13, cursor: "pointer", padding: "6px 0" }}>
        <div style={{ width: 26, height: 26, borderRadius: "50%", border: "1.5px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, color: "#94a3b8" }}>+</div>
        New Row
      </div>
      {showAddRow && <EditAddRowModal onSave={addSection} onClose={() => setShowAddRow(false)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// APP ROOT
// ═══════════════════════════════════════════════════════════════════════════

function BreadcrumbNav({ items, onNavigate }: {
  items: { label: string; key: string }[];
  onNavigate: (key: string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, overflowX: "auto", whiteSpace: "nowrap", flexShrink: 0, scrollbarWidth: "none", msOverflowStyle: "none" }}>
      {items.map((item, i) => (
        <Fragment key={item.key}>
          {i > 0 && <span style={{ color: "#cbd5e1", fontWeight: 400, fontSize: 12 }}>/</span>}
          <span
            onClick={() => onNavigate(item.key)}
            style={{
              color: i === items.length - 1 ? "#1a2332" : "#3B82F6",
              fontWeight: i === items.length - 1 ? 600 : 400,
              cursor: i === items.length - 1 ? "default" : "pointer",
              padding: "2px 4px",
              borderRadius: 4,
              transition: "background 0.15s",
            }}
            onMouseEnter={e => { if (i < items.length - 1) e.currentTarget.style.background = "#EFF6FF"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
          >
            {item.label}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

export default function DashelloDashboard() {
  const [page, setPage] = useState<Page>(() => (localStorage.getItem("dashello_page") as Page) || "home");
  const [sections, setSections] = useState<Section[]>([]);
  const [activeModal, setActiveModal] = useState<{ data: MetricModalData; metric: Metric } | null>(null);
  useEffect(() => { localStorage.setItem("dashello_page", page); }, [page]);
  const [editingMetricFromModal, setEditingMetricFromModal] = useState<Metric | null>(null);
  // Inline view system
  const [inlineView, setInlineView] = useState<"metric-detail" | "metric-settings" | "color-rule" | null>(null);
  const [inlineMetric, setInlineMetric] = useState<Metric | null>(null);
  const [inlineHasUnsaved, setInlineHasUnsaved] = useState(false);
  // "popup" = default modal behaviour; "inline" = expanded in-page view
  const [viewMode, setViewMode] = useState<"popup" | "inline">("popup");
  const viewModeRef = useRef<"popup" | "inline">("popup");
  const [selectedApp, setSelectedApp] = useState<typeof APPS[0] | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showChat, setShowChat] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const mobileMenuTriggerRef = useRef<HTMLDivElement>(null);

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState("");
  const [dbReady, setDbReady] = useState(false);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [activeOrg, setActiveOrg] = useState<Org | null>(null);
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [teamRows, setTeamRows] = useState<TeamRow[]>([]);
  const [teamPermissions, setTeamPermissions] = useState<TeamPermissions[]>([]);
  const [showOrgDropdown, setShowOrgDropdown] = useState(false);
  const [previewMember, setPreviewMember] = useState<OrgMember | null>(null);
  const [previewPerms, setPreviewPerms] = useState<TeamPermissions | null>(null);
  const [previewFromSave, setPreviewFromSave] = useState(false);
  const [profile, setProfile] = useState({
    full_name: "", company: "", street: "", city: "", state: "", zip: "", country: "",
    avatar_url: "", five_account_enabled: false,
    health_green_multiplier: 1.0,
    health_yellow_multiplier: 0.5,
    health_red_multiplier: -1.0,
    menu_permissions: {} as Record<string, string[]>,
  });
  const [fiveAccountSettings, setFiveAccountSettings] = useState<FiveAccountSettings>(DEFAULT_FIVE_ACCOUNT_SETTINGS);
  // --- SETTINGS UPDATE LOGIC ---
 const handleUpdateSettings = (newSettings: FiveAccountSettings) => {
    setFiveAccountSettings(newSettings);
    const updatedSections = syncSettingsToMetrics(sections, newSettings);
    setSections(updatedSections);
    
    if (userId) {
      saveUserData("sections", userId, updatedSections);
      saveUserData("settings", userId, newSettings);
    }
  };
   
  const [postTransactionPrompt, setPostTransactionPrompt] = useState<PostTransactionPrompt | null>(null);
  const pendingValueChangeRef = useRef<((description?: string) => void) | null>(null);
  const [lastDashboardSync, setLastDashboardSync] = useState<number | null>(() => {
    const stored = localStorage.getItem("lastDashboardSync");
    return stored ? parseInt(stored, 10) : null;
  });
  const [fiveAccountForceOff, setFiveAccountForceOff] = useState(false);
  // Equation builder state
  const [equationBuilderTarget, setEquationBuilderTarget] = useState<{ metricId: string; sectionId: string } | null>(null);
  const [viewMetricId, setViewMetricId] = useState<string | null>(null);
  const [viewGoalId, setViewGoalId] = useState<string | null>(null);
  const [pendingMemberDetail, setPendingMemberDetail] = useState<OrgMember | null>(null);
  
  // Track where to return after equation builder closes
  const pageBeforeEquationRef = useRef<Page>("home");
  const reopenMetricAfterEquationRef = useRef<{ sectionId: string; metricId: string } | null>(null);

  const handleOpenEquationBuilder = useCallback((sectionId: string, metricId: string, reopenAfterSave?: boolean) => {
    pageBeforeEquationRef.current = page;
    // Always store so we can return to metric-settings after equation save/cancel
    reopenMetricAfterEquationRef.current = { sectionId, metricId };
    setEquationBuilderTarget({ sectionId, metricId });
    setPage("equation-builder");
    setEditingMetricFromModal(null);
    setActiveModal(null);
    // Collapse sidebar on equation builder for full width
    setSidebarOpen(false);
  }, [page]);

  const handleSaveEquation = useCallback((equation: EquationConfig) => {
    if (!equationBuilderTarget) return;
    setSections(prev => {
      const allMetrics = prev.flatMap(s => s.metrics);
      const raw = evaluateEquation(equation.steps, allMetrics);
      const targetMetric = allMetrics.find(m => m.id === equationBuilderTarget.metricId);
      const computedValue = raw !== null && targetMetric
        ? formatEquationResult(raw, equation.steps, allMetrics)
        : targetMetric?.value ?? "0";
      return prev.map(s => {
        if (s.id !== equationBuilderTarget.sectionId) return s;
        return {
          ...s,
          metrics: s.metrics.map(m => {
            if (m.id !== equationBuilderTarget.metricId) return m;
            return { ...m, equation, draftEquation: undefined, value: computedValue };
          }),
        };
      });
    });
    const { sectionId, metricId } = equationBuilderTarget;
    setEquationBuilderTarget(null);
    reopenMetricAfterEquationRef.current = null;
    // Return to metric-settings inline view
    setPage("home");
    pageBeforeEquationRef.current = "home";
    setInlineHasUnsaved(false);
    // Find the metric and restore inline settings view
    setSections(prev => {
      const metric = prev.flatMap(s => s.metrics).find(m => m.id === metricId);
      if (metric) {
        setInlineMetric(metric);
        setInlineView("metric-settings");
      } else {
        setInlineView(null);
        setInlineMetric(null);
      }
      return prev;
    });
  }, [equationBuilderTarget]);

  const handleSaveDraftEquation = useCallback((equation: EquationConfig) => {
    if (!equationBuilderTarget) return;
    const { sectionId, metricId } = equationBuilderTarget;
    setSections(prev => {
      const updated = prev.map(s => {
        if (s.id !== sectionId) return s;
        return {
          ...s,
          metrics: s.metrics.map(m => {
            if (m.id !== metricId) return m;
            return { ...m, draftEquation: equation };
          }),
        };
      });
      const metric = updated.flatMap(s => s.metrics).find(m => m.id === metricId);
      if (metric) {
        setInlineMetric(metric);
        setInlineView("metric-settings");
      } else {
        setInlineView(null);
        setInlineMetric(null);
      }
      return updated;
    });
    reopenMetricAfterEquationRef.current = null;
    setEquationBuilderTarget(null);
    setPage("home");
    pageBeforeEquationRef.current = "home";
    setInlineHasUnsaved(false);
  }, [equationBuilderTarget]);

  const handleCancelEquation = useCallback(() => {
    const target = equationBuilderTarget;
    setEquationBuilderTarget(null);
    reopenMetricAfterEquationRef.current = null;
    setPage("home");
    pageBeforeEquationRef.current = "home";
    setInlineHasUnsaved(false);
    // Return to metric-settings inline view
    if (target) {
      setSections(prev => {
        const metric = prev.flatMap(s => s.metrics).find(m => m.id === target.metricId);
        if (metric) {
          setInlineMetric(metric);
          setInlineView("metric-settings");
        } else {
          setInlineView(null);
          setInlineMetric(null);
        }
        return prev;
      });
    }
  }, [equationBuilderTarget]);

  // (reopen effect removed - equation builder returns directly to metric-settings inline view)

  const [tasksData, setTasksData] = useState<Task[]>([]);

  const [goalsData, setGoalsData] = useState<Goal[]>([]);
  const [goalsViewMode, setGoalsViewMode] = useState<"row" | "expanded">("row");
  const [showGoalOnboarding, setShowGoalOnboarding] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);

  const handleCreateGoal = (g: Goal) => setGoalsData(p => [...p, g]);
  const handleEditGoal = (g: Goal) => setEditingGoal(g);
  const handleSaveGoal = (g: Goal) => setGoalsData(p => p.map(x => x.id === g.id ? g : x));
  const handleDuplicateGoal = (g: Goal) => setGoalsData(p => [...p, { ...g, id: crypto.randomUUID(), label: g.label + " (copy)", status: "drafted" as GoalStatus }]);
  const handleDeleteGoal = (id: string) => setGoalsData(p => p.filter(x => x.id !== id));

  // Auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) { setUserId(session.user.id); setUserEmail(session.user.email ?? ""); }
    });
  }, []);

  // Load
  useEffect(() => {
    if (!userId) return;
    async function load() {
      const [savedSections, savedTasks, savedGoals, savedOrgs] = await Promise.all([
        loadUserData("sections", userId!),
        loadUserData("tasks", userId!),
        loadUserData("goals", userId!),
        loadOrgData(userId!),
      ]);
      if (savedSections) setSections(savedSections);
      if (savedTasks) setTasksData(savedTasks);
      if (savedGoals) setGoalsData(savedGoals);

      // Load org data
      if (savedOrgs?.orgs?.length) {
        setOrgs(savedOrgs.orgs);
        setOrgMembers(savedOrgs.members ?? []);
        setTeamRows(savedOrgs.teams ?? []);
        setTeamPermissions(savedOrgs.permissions ?? []);
        // Restore or default to personal org
        const saved = localStorage.getItem("activeOrgId");
        const target = savedOrgs.orgs.find((o: Org) => o.id === saved) ?? savedOrgs.orgs.find((o: Org) => o.isPersonal);
        if (target) setActiveOrg(target);
      } else {
        // Auto-create personal org
        const personalOrg: Org = {
          id: crypto.randomUUID(),
          name: `Your Dashboard`,
          isPersonal: true,
          createdAt: new Date().toISOString(),
        };
        const defaultTeamId = crypto.randomUUID();
        const defaultTeam: TeamRow = { id: defaultTeamId, name: "Your Team", order: 0 };
        const ownerName = userEmail.split("@")[0] || "Me";
        const ownerMember: OrgMember = {
          id: crypto.randomUUID(),
          email: userEmail,
          name: ownerName,
          avatarUrl: profile.avatar_url || "",
          level: "owner",
          status: "active",
          teamId: defaultTeamId,
        };
        setOrgs([personalOrg]);
        setActiveOrg(personalOrg);
        setTeamRows([defaultTeam]);
        setOrgMembers([ownerMember]);
        setTeamPermissions([{ teamId: defaultTeamId, allowedSectionIds: null, metricOverrides: null }]);
        saveOrgData(userId!, { orgs: [personalOrg], members: [ownerMember], teams: [defaultTeam], permissions: [{ teamId: defaultTeamId, allowedSectionIds: null, metricOverrides: null }] });
      }

      const { data: prof } = await supabase.from("profiles").select("*").eq("id", userId!).maybeSingle();
      if (prof) setProfile({
  full_name: prof.full_name ?? "", company: prof.company ?? "",
  street: prof.street ?? "", city: prof.city ?? "", state: prof.state ?? "",
  zip: prof.zip ?? "", country: prof.country ?? "",
  avatar_url: prof.avatar_url ?? "",
  five_account_enabled: prof.five_account_enabled ?? false,
  health_green_multiplier: prof.health_green_multiplier ?? 1.0,
  health_yellow_multiplier: prof.health_yellow_multiplier ?? 0.5,
  health_red_multiplier: prof.health_red_multiplier ?? -1.0,
  menu_permissions: prof.menu_permissions ?? {},
});
      setDbReady(true);
    }
    load();
  }, [userId]);

  // Sync profile avatar_url to orgMembers
  useEffect(() => {
    if (!userEmail || !orgMembers.length) return;
    const userMember = orgMembers.find(m => m.email === userEmail);
    if (userMember && userMember.avatarUrl !== profile.avatar_url) {
      setOrgMembers(prev => prev.map(m => m.email === userEmail ? { ...m, avatarUrl: profile.avatar_url } : m));
    }
  }, [profile.avatar_url, userEmail]);

  // Auto-save
  useEffect(() => { if (userId && dbReady) saveUserData("sections", userId, sections); }, [sections, userId, dbReady]);
  useEffect(() => { if (userId && dbReady) saveUserData("tasks", userId, tasksData); }, [tasksData, userId, dbReady]);
  useEffect(() => { if (userId && dbReady) saveUserData("goals", userId, goalsData); }, [goalsData, userId, dbReady]);
  useEffect(() => {
    if (userId && dbReady && orgs.length) {
      saveOrgData(userId!, { orgs, members: orgMembers, teams: teamRows, permissions: teamPermissions });
    }
  }, [orgs, orgMembers, teamRows, teamPermissions, userId, dbReady]);

  // Auto-create tasks when goals hit 100%
  useEffect(() => {
    setTasksData(prev => {
      let changed = false;
      const next = [...prev];
      for (const g of goalsData) {
        if (g.status !== "active") continue;
        const { pct } = computeGoalProgress(g, sections);
        if (pct >= 100) {
          const taskText = `Complete your goal: ${g.label}`;
          if (!next.some(t => t.text === taskText)) {
            next.push({ id: crypto.randomUUID(), text: taskText, done: false, assignedTo: "AJ", dueDate: g.due || "", createdBy: "", linkedGoalId: g.id, createdAt: new Date().toISOString() });
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [goalsData, sections]);

  // Navigate to metric detail when requested from tasks page
  useEffect(() => {
    if (!viewMetricId) return;
    for (const section of sections) {
      const metric = section.metrics.find(m => m.id === viewMetricId);
      if (metric) {
        setPage("home");
        setInlineMetric(metric);
        setInlineView("metric-detail");
        setViewMode("inline");
        viewModeRef.current = "inline";
        break;
      }
    }
    setViewMetricId(null);
  }, [viewMetricId, sections]);

  useEffect(() => {
    if (!viewGoalId) return;
    setPage("goals");
    setGoalsViewMode("expanded");
    setViewGoalId(null);
  }, [viewGoalId]);

  // Mobile
  useEffect(() => {
    const check = () => { const m = window.innerWidth < 768; setIsMobile(m); if (!m) setSidebarOpen(true); };
    check(); window.addEventListener("resize", check); return () => window.removeEventListener("resize", check);
  }, []);

  // When value changed in modal, update sections + history
  const handleValueChange = (newValue: string, description?: string) => {
    const activeMetric = activeModal?.metric ?? inlineMetric;
    if (!activeMetric) return;
    const metricId = activeMetric.id;
    const numericVal = parseFloat(newValue.replace(/[^0-9.\-]/g, ""));
    const oldVal = parseFloat(activeMetric.value.replace(/[^0-9.\-]/g, "")) || 0;
    const isFiveAccount = !!(activeMetric.modal?.fiveAccountEnabled || activeMetric.fiveAccountParentId);
    const now = Date.now();

    const applyChange = (description?: string) => {
      setSections(prev => prev.map(s => {
        const updatedMetrics = s.metrics.map(m => {
          if (m.id !== metricId) return m;
          const newPoint: DataPoint = { timestamp: now, value: isNaN(numericVal) ? 0 : numericVal };
          const newTxn: Transaction | null = description ? {
            date: new Date(now).toLocaleDateString(),
            description,
            ...(numericVal > oldVal ? { credit: numericVal - oldVal } : { debit: oldVal - numericVal }),
          } : null;
          const updatedModal = newTxn ? {
            ...m.modal,
            transactions: [...(m.modal.transactions ?? []), newTxn],
          } : m.modal;
          const hasEq = !!(activeMetric.equation && activeMetric.equation.steps.length > 0);
          return {
                ...m, value: newValue, history: [...(m.history ?? []), newPoint].slice(-50),
            lastSyncedAt: now, outOfSync: hasEq, modal: updatedModal,
          };
        });

        if (fiveAccountSettings.mode !== "five-separate") {
          const changedMetric = updatedMetrics.find(m => m.id === metricId);
          // Find the equation parent: box with fiveAccountEnabled=true and no fiveAccountParentId
          const equationParent = updatedMetrics.find(m =>
            m.modal?.fiveAccountEnabled === true && !m.fiveAccountParentId
          );
          // Only cascade if the changed metric belongs to this Five-Account group
          const belongsToGroup = changedMetric && equationParent && (
            changedMetric.id === equationParent.id ||
            changedMetric.fiveAccountParentId === equationParent.id
          );
          if (equationParent && belongsToGroup) {
            return { ...s, metrics: runFiveAccountEquation(updatedMetrics, equationParent.id, fiveAccountSettings) };
          }
        }
        // Re-evaluate any metrics that have equations referencing the changed metric
        const metricsWithEquations = updatedMetrics.filter(m => m.equation && m.equation.steps.length > 0);
        let reevaluatedMetrics = [...updatedMetrics];
        for (const em of metricsWithEquations) {
          const refsMetric = em.equation!.steps.some(st => st.type === "metric" && st.metricId === metricId);
          if (refsMetric) {
            const result = evaluateEquation(em.equation!.steps, reevaluatedMetrics);
            if (result !== null) {
              const formatted = formatEquationResult(result, em.equation!.steps, reevaluatedMetrics);
              const nowEq = Date.now();
              reevaluatedMetrics = reevaluatedMetrics.map(mm =>
                mm.id === em.id
                  ? { ...mm, value: formatted, lastSyncedAt: nowEq, modal: { ...mm.modal, mainValue: formatted } }
                  : mm
              );
            }
          }
        }
        return { ...s, metrics: reevaluatedMetrics };
      }));

     setSections(prev2 => {
        // After sections update, sync activeModal metric to the freshly updated metric
        const updatedMetric = prev2.flatMap(s => s.metrics).find(m => m.id === metricId);
        if (updatedMetric) {
        }
        return prev2;
      });
    };

  applyChange(description);
    // Refresh from Supabase after any value change to keep all clients in sync
    setTimeout(() => handleRefreshMetric(), 300);
  };

  const handleRefreshAll = async () => {
    if (!userId) return;
    const [savedSections, savedTasks, savedGoals] = await Promise.all([
      loadUserData("sections", userId),
      loadUserData("tasks", userId),
      loadUserData("goals", userId),
    ]);
    if (savedSections) setSections(savedSections);
    if (savedTasks) setTasksData(savedTasks);
    if (savedGoals) setGoalsData(savedGoals);
    const now = Date.now();
    setLastDashboardSync(now);
    localStorage.setItem("lastDashboardSync", now.toString());
    setTimeout(() => checkAndResetMetricsRef.current?.(), 100);
  };

  const handleRefreshMetric = async () => {
    if (!userId) return;
    const saved = await loadUserData("sections", userId);
    if (saved) {
      // Rerun Five-Account equation on all sections after refresh
      const refreshed = profile.five_account_enabled && fiveAccountSettings.mode !== "five-separate"
        ? (saved as Section[]).map(s => {
            const parentMetric = s.metrics.find(m => m.modal?.fiveAccountEnabled && !m.fiveAccountParentId);
            if (!parentMetric) return s;
            return { ...s, metrics: runFiveAccountEquation(s.metrics, parentMetric.id, fiveAccountSettings) };
          })
        : saved as Section[];
      // Re-evaluate all custom equations
      const allMetrics = refreshed.flatMap(s => s.metrics);
      const eqRefreshed = refreshed.map(s => ({
        ...s,
        metrics: s.metrics.map(m => {
          if (!m.equation || m.equation.steps.length === 0) return m;
          const result = evaluateEquation(m.equation.steps, allMetrics);
          if (result === null) return m;
          const formatted = formatEquationResult(result, m.equation.steps, allMetrics);
          return { ...m, value: formatted, modal: { ...m.modal, mainValue: formatted } };
        }),
      }));
      setSections(eqRefreshed);
      if (activeModal) {
        const updated = eqRefreshed.flatMap((s: Section) => s.metrics).find((m: Metric) => m.id === activeModal.metric.id);
        if (updated) setActiveModal(prev => prev ? { ...prev, metric: updated, data: { ...prev.data, mainValue: updated.value, transactions: updated.modal.transactions } } : null);
      }
    }
    const now = Date.now();
    setLastDashboardSync(now);
    localStorage.setItem("lastDashboardSync", now.toString());
    setTimeout(() => checkAndResetMetricsRef.current?.(), 100);
  };
  
  const handleClickMetric = (data: MetricModalData, metric: Metric) => {
    setInlineMetric(metric);
    setInlineHasUnsaved(false);
    if (viewModeRef.current === "inline") {
      setInlineView("metric-detail");
      setActiveModal(null);
    } else {
      // popup mode: open as modal, keep inlineView null
      setInlineView(null);
      setActiveModal({ data, metric });
    }
  };
  const handleEditFromModal = () => {
    if (!inlineMetric) return;
    setInlineHasUnsaved(false);
    if (viewModeRef.current === "inline") {
      setInlineView("metric-settings");
      setActiveModal(null);
    } else {
      // popup mode: close metric modal, open settings modal
      setActiveModal(null);
      setEditingMetricFromModal(inlineMetric);
    }
  };
  const handleCloseInline = () => {
    if (inlineHasUnsaved) {
      if (!window.confirm("You have unsaved changes. Leave without saving?")) return;
    }
    setInlineView(null);
    setInlineMetric(null);
    setInlineHasUnsaved(false);
    setActiveModal(null);
    setEditingMetricFromModal(null);
  };
  const handleBreadcrumbNavigate = (key: string) => {
    if (inlineHasUnsaved) {
      if (!window.confirm("You have unsaved changes. Leave without saving?")) return;
      setInlineHasUnsaved(false);
    }
    if (key === "home") { setViewMode("popup"); viewModeRef.current = "popup"; setInlineView(null); setInlineMetric(null); }
    else if (key === "metric-detail") setInlineView("metric-detail");
    else if (key === "metric-settings") setInlineView("metric-settings");
  };
  const getBreadcrumbItems = () => {
    const items: { label: string; key: string }[] = [{ label: "Home", key: "home" }];
    if (inlineMetric) {
      items.push({ label: inlineMetric.label, key: "metric-detail" });
      if (inlineView === "metric-settings") items.push({ label: "Settings", key: "metric-settings" });
      if (inlineView === "color-rule") { items.push({ label: "Settings", key: "metric-settings" }); items.push({ label: "Color Rule", key: "color-rule" }); }
    }
    return items;
  };

  // Section 1: Mirror a transaction onto another Five-Account box when "Transfer to" is checked
  const handleTransfer = useCallback((toMetricId: string, amount: number, description: string) => {
    setSections(prev => {
      let updated = prev.map(s => ({
        ...s,
        metrics: s.metrics.map(m => {
          if (m.id !== toMetricId) return m;
          const cur = parseFloat(m.value.replace(/[^0-9.\-]/g, "")) || 0;
          const next = Math.max(0, cur + amount);
          const currency = m.currencySymbol ?? "$";
          const formatted = `${currency}${next.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
          const now = Date.now();
          const txn: Transaction = {
            date: new Date(now).toLocaleDateString(),
            description,
            ...(amount > 0 ? { credit: amount } : { debit: -amount }),
          };
          return {
            ...m,
            value: formatted,
            history: [...(m.history ?? []), { timestamp: now, value: next }].slice(-50),
            lastSyncedAt: now,
            modal: {
              ...m.modal,
              mainValue: formatted,
              transactions: [...(m.modal.transactions ?? []), txn],
            },
          };
        }),
      }));
      // Cascade Five-Account equation after transfer to keep all boxes in sync
      if (fiveAccountSettings.mode !== "five-separate") {
        updated = updated.map(s => {
          const equationParent = s.metrics.find(m => m.modal?.fiveAccountEnabled === true && !m.fiveAccountParentId);
          if (equationParent) {
            return { ...s, metrics: runFiveAccountEquation(s.metrics, equationParent.id, fiveAccountSettings) };
          }
          return s;
        });
      }
      return updated;
    });
  }, [fiveAccountSettings]);

  // Compute siblings for whichever metric is currently in the modal
  const activeModalSiblings: Metric[] = activeModal
    ? (sections.find(s => s.metrics.some(m => m.id === activeModal.metric.id))?.metrics ?? [])
    : [];

  // Five-Account created from Settings — adds "Finances" row with all 5 boxes
  const handleFiveAccountCreated = useCallback(() => {
    setSections(prev => {
      if (prev.find(s => s.title === "Finances")) return prev;
      const parentId = crypto.randomUUID();
      const childMetrics = FIVE_ACCOUNT_LABELS.map(label => {
        const accountType = label.toLowerCase() as "overhead" | "profit" | "tax" | "investments" | "owner";
        const isParent = accountType === "overhead";
        const metric = makeFiveAccountMetric(accountType, parentId, isParent);
        // Parent gets fiveAccountEnabled:true and no fiveAccountParentId
        if (isParent) {
          return {
            ...metric,
            id: parentId,
            modal: { ...metric.modal, fiveAccountEnabled: true, accountType },
          };
        }
        return { ...metric, id: crypto.randomUUID() };
      });
      const newSection: Section = { id: crypto.randomUUID(), title: "Finances", avatars: [], metrics: childMetrics };
      return [...prev, newSection];
    });
  }, [setSections]);

// ── Section 2: Box-level toggle ON → flip global profile flag ON ─────────
  const handleFiveAccountEnabledFromBox = useCallback(() => {
    if (!userId) return;
    setProfile(prev => {
      if (prev.five_account_enabled) return prev;
      const updated = { ...prev, five_account_enabled: true };
      supabase.from("profiles").upsert({ id: userId, five_account_enabled: true, updated_at: new Date().toISOString() });
      return updated;
    });
  }, [userId]);

  // ── Section 3: Global toggle OFF → cascade to every metric box ───────────
  const handleGlobalFiveAccountDisabled = useCallback(() => {
    setSections(prev => prev.map(s => ({
      ...s,
      metrics: s.metrics.map(m => {
        if (!m.modal?.fiveAccountEnabled && !m.fiveAccountParentId) return m;
        return {
          ...m,
          fiveAccountParentId: undefined,
          modal: { ...m.modal, fiveAccountEnabled: false, accountType: undefined },
        };
      }),
    })));
  }, []);

  // ── Section 4: Box-level toggle OFF → mark Five-Account siblings out-of-sync ─
  const handleFiveAccountDisabledFromBox = useCallback((sectionId: string, disabledMetricId: string, disabledLabel: string) => {
    setSections(prev => prev.map(s => {
      if (s.id !== sectionId) return s;
      return {
        ...s,
        metrics: s.metrics.map(m => {
          // Skip the box being disabled itself
          if (m.id === disabledMetricId) return m;
          // Only mark OTHER Five-Account boxes in this group
          if (m.modal?.fiveAccountEnabled || m.fiveAccountParentId) {
            return {
              ...m,
              outOfSync: true,
              outOfSyncReason: `Your ${disabledLabel} balance is turned off and out of sync. The Five-Account equation can no longer cascade through ${disabledLabel}.`,
            };
          }
          return m;
        }),
      };
    }));
  }, []);

  // ── Auto-disable global Five-Account flag when all 5 boxes are toggled off ─
  useEffect(() => {
    if (!profile.five_account_enabled) return;
    const section = sections.find(s => s.metrics.some(m => m.modal?.fiveAccountEnabled || m.fiveAccountParentId));
    if (section) {
      const anyEnabled = section.metrics.some(m => m.modal?.fiveAccountEnabled || m.fiveAccountParentId);
      if (!anyEnabled) {
        setProfile(prev => {
          if (!prev.five_account_enabled) return prev;
          const updated = { ...prev, five_account_enabled: false };
          supabase.from("profiles").upsert({ id: userId!, five_account_enabled: false, updated_at: new Date().toISOString() });
          return updated;
        });
        setFiveAccountForceOff(true);
      }
    }
  }, [sections, profile.five_account_enabled, userId]);

  // ── Section 7: Auto-reset scheduler ──────────────────────────────────────
  const checkAndResetMetricsRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!dbReady) return;
    const check = () => {
      const now = Date.now();
      const DAY = 24 * 60 * 60 * 1000;
      const WEEK = 7 * DAY;
      const MONTH = 30 * DAY;
      let changed = false;
      const next = sections.map(s => ({
        ...s,
        metrics: s.metrics.map(m => {
          if (!m.resetFrequency || m.resetFrequency === "none") return m;
          const last = m.lastResetAt ?? 0;
          let interval = 0;
          if (m.resetFrequency === "daily") interval = DAY;
          else if (m.resetFrequency === "weekly") interval = WEEK;
          else if (m.resetFrequency === "monthly") interval = MONTH;
          if (interval === 0 || now - last < interval) return m;
          changed = true;
          const isFinancial = m.metricType === "financial";
          const currency = m.currencySymbol ?? "$";
          const newValue = isFinancial
            ? `${currency}0.00`
            : (m.metricType === "percentage" ? "0%" : "0");
          const newHistory = m.resetKeepHistory
            ? [...(m.history ?? []), { timestamp: now, value: 0 }].slice(-50)
            : [];
          return {
            ...m,
            value: newValue,
            history: newHistory,
            lastResetAt: now,
            modal: { ...m.modal, mainValue: newValue },
          };
        }),
      }));
      if (changed) setSections(next);
    };
    checkAndResetMetricsRef.current = check;
    check(); // Run once on mount
    const id = setInterval(check, 60 * 1000);
    return () => clearInterval(id);
  }, [dbReady, sections]);
  
  // Auto-disable five-account if the section containing the group is fully deleted
  const handleRemoveSectionWithFiveAccountCheck = useCallback((removedSection: Section) => {
    const hasFiveAccountBoxes = removedSection.metrics.some(
      m => m.modal?.fiveAccountEnabled || m.fiveAccountParentId || m.modal?.type === "cashflow"
    );
    if (hasFiveAccountBoxes) {
      setProfile(prev => {
        if (!prev.five_account_enabled) return prev;
        const updated = { ...prev, five_account_enabled: false };
        supabase.from("profiles").upsert({ id: userId!, five_account_enabled: false, updated_at: new Date().toISOString() });
        return updated;
      });
      setFiveAccountForceOff(true);
    }
  }, [userId]);

  const handleNav = (p: Page) => {
    setPage(p);
    setSelectedApp(null);
    if (isMobile) setSidebarOpen(false);
    if (p === "home") {
      // Reset to popup mode whenever user navigates back to home
      setViewMode("popup"); viewModeRef.current = "popup";
      setInlineView(null);
      setInlineMetric(null);
      setInlineHasUnsaved(false);
      setActiveModal(null);
    }
  };

  const handleSwitchOrg = useCallback(async (org: Org) => {
    setShowOrgDropdown(false);
    if (org.id === activeOrg?.id) return;
    localStorage.setItem("activeOrgId", org.id);
    setActiveOrg(org);
    setDbReady(false);
    // Reload data from correct source
    if (org.isPersonal) {
      const [savedSections, savedTasks, savedGoals] = await Promise.all([
        loadUserData("sections", userId!),
        loadUserData("tasks", userId!),
        loadUserData("goals", userId!),
      ]);
      if (savedSections) setSections(savedSections); else setSections([]);
      if (savedTasks) setTasksData(savedTasks); else setTasksData([]);
      if (savedGoals) setGoalsData(savedGoals); else setGoalsData([]);
    } else {
      // Company org — starts with empty dashboard
      setSections([]);
      setTasksData([]);
      setGoalsData([]);
    }
    setDbReady(true);
    setPage("home");
  }, [userId, activeOrg]);

  const health = calculateHealth(
   sections,
   profile.health_green_multiplier,
   profile.health_yellow_multiplier,
   profile.health_red_multiplier
);

// Determine current user's permission level
const currentUserLevel: OrgPermissionLevel = (() => {
  if (!activeOrg?.isPersonal) {
    // In a company org, find this user's membership
    const me = orgMembers.find(m => m.email === userEmail);
    if (me) return me.level;
  }
  return "owner";
})();

const menuPermissions = profile.menu_permissions ?? {};
const isPageAccessible = (pageName: string) => {
  if (currentUserLevel === "owner") return true;
  const hidden = menuPermissions[currentUserLevel] || [];
  if (currentUserLevel === "viewer" && (pageName === "integrations" || pageName === "team")) return false;
  return !hidden.includes(pageName);
};

// Preview mode
const previewLevel = previewMember?.level ?? null;
const previewSections = previewMember && previewPerms
  ? filterSectionsByPermissions(sections, previewPerms)
  : null;
const isPreviewMode = previewMember !== null;

const sidebarEl = (
  <Sidebar active={page} onNav={handleNav} onClose={() => setSidebarOpen(false)}
    isMobile={isMobile} avatarUrl={profile.avatar_url}
    firstName={profile.full_name?.split(" ")[0] ?? ""}
    health={health}
    activeOrg={activeOrg}
    orgs={orgs}
    showOrgDropdown={showOrgDropdown}
    onToggleOrgDropdown={() => setShowOrgDropdown(v => !v)}
    onSwitchOrg={handleSwitchOrg}
    currentUserLevel={currentUserLevel}
    onOpenInviteModal={() => setShowInviteModal(true)}
    menuPermissions={profile.menu_permissions ?? {}}
    tasks={tasksData} setTasks={setTasksData}
    orgMembers={orgMembers} userEmail={userEmail}
  />);

  if (!dbReady) return (
    <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", background: "linear-gradient(160deg,#2196F3 0%,#00BCD4 100%)", fontSize: 18, color: "#fff", fontFamily: "Inter, sans-serif" }}>
      Loading your dashboard...
    </div>
  );

  return (
    <>
    <style>{`@media (max-width:767px){.touch-btn{min-height:44px!important;min-width:44px!important}.touch-btn-sm{min-height:36px!important;min-width:36px!important}.stack-mobile{grid-template-columns:1fr!important}.hide-mobile{display:none!important}}`}</style>
    <div style={{ display: "flex", height: "100dvh", fontFamily: "'Inter',system-ui,sans-serif", background: "#F8FAFC", position: "relative" }}>
      {isMobile && sidebarOpen && <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 900 }} />}
      {sidebarOpen && (
        isMobile
          ? <div style={{ position: "fixed", left: 0, top: 0, bottom: 0, width: 240, zIndex: 1000 }}>
            {sidebarEl}
            <div onClick={() => setSidebarOpen(false)} style={{ position: "absolute", top: 14, right: -44, width: 44, height: 44, borderRadius: "50%", background: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,0.15)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 18, color: "#475569", zIndex: 1001 }}>×</div>
          </div>
          : sidebarEl
      )}

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* Top bar */}
        {isPreviewMode ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px clamp(10px,3vw,26px)", borderBottom: "1px solid #E8EDF2", background: "#FFFBEB", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
              <div style={{ padding: "3px 10px", borderRadius: 6, background: "#F59E0B", color: "#fff", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.04 }}>Preview Mode</div>
              <span style={{ fontSize: 13, color: "#92400E" }}>Viewing as <strong>{previewMember?.name || previewMember?.email}</strong></span>
              {previewLevel && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 99, background: "#FDE68A", color: "#92400E", textTransform: "capitalize" }}>{previewLevel}</span>}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={() => { setPreviewMember(null); setPreviewPerms(null); }}
                style={{ padding: "6px 14px", borderRadius: 8, border: "1.5px solid #D97706", background: "#fff", color: "#92400E", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                Exit Preview
              </button>
              <button onClick={() => { setPreviewFromSave(true); setPreviewMember(null); setPreviewPerms(null); setPage("team"); }}
                style={{ padding: "6px 16px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                Save & Exit
              </button>
            </div>
          </div>
        ) : (
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 6 : 8, padding: isMobile ? "10px 12px" : "11px clamp(10px,3vw,26px)", borderBottom: "1px solid #E8EDF2", background: "#fff", flexShrink: 0, flexWrap: "wrap" }}>
          {!sidebarOpen && (
            <div onClick={() => setSidebarOpen(true)} style={{ width: isMobile ? 44 : 34, height: isMobile ? 44 : 34, borderRadius: "50%", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", marginRight: 4, flexShrink: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {[0, 1, 2].map(i => <div key={i} style={{ width: 14, height: 2, background: "#475569", borderRadius: 2 }} />)}
              </div>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
            {(page === "home" && !inlineView) || page === "goals" ? (
              <div style={{ display: "flex", borderRadius: 8, border: "1px solid #e2e8f0", overflow: "hidden" }}>
                {["Row", page === "goals" ? "Expanded" : "Column"].map((lbl, i) => (
                  <div key={lbl} onClick={() => { if (page === "goals") setGoalsViewMode(i === 0 ? "row" : "expanded"); }}
                    style={{ padding: isMobile ? "8px 12px" : "5px 13px", fontSize: 12, fontWeight: 500, cursor: "pointer", userSelect: "none",
                      background: (page === "home" && i === 0) || (page === "goals" && ((i === 0 && goalsViewMode === "row") || (i === 1 && goalsViewMode === "expanded"))) ? "#3B82F6" : "#fff",
                      color: (page === "home" && i === 0) || (page === "goals" && ((i === 0 && goalsViewMode === "row") || (i === 1 && goalsViewMode === "expanded"))) ? "#fff" : "#94a3b8" }}>{lbl}</div>
                ))}
              </div>
            ) : null}
            {!isMobile && (page === "home" || page === "goals" || page === "integrations" || page === "tasks") && <TopBarRefreshButton isMobile={isMobile} onRefresh={handleRefreshAll} lastSyncedAt={lastDashboardSync} />}
            {(page === "home" && inlineView) && (
              <BreadcrumbNav items={getBreadcrumbItems()} onNavigate={handleBreadcrumbNavigate} />
            )}
            {page === "equation-builder" && inlineMetric && (
              <BreadcrumbNav
                items={[
                  { label: "Home", key: "home" },
                  { label: inlineMetric.label, key: "metric-detail" },
                  { label: "Settings", key: "metric-settings" },
                  { label: "Equation", key: "equation" },
                ]}
                onNavigate={(key) => {
                  if (inlineHasUnsaved) {
                    if (!window.confirm("You have unsaved changes. Leave without saving?")) return;
                  }
                  if (key === "home") {
                    handleCancelEquation();
                  } else if (key === "metric-detail") {
                    handleCancelEquation();
                    setViewMode("inline");
                    viewModeRef.current = "inline";
                    setInlineView("metric-detail");
                  } else if (key === "metric-settings") {
                    handleCancelEquation();
                  }
                }}
              />
            )}
          </div>
          <div style={{ flex: 1 }} />
          {isMobile ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {(page === "home" || page === "goals" || page === "integrations" || page === "tasks") && <TopBarRefreshButton isMobile={isMobile} onRefresh={handleRefreshAll} lastSyncedAt={lastDashboardSync} />}
              <div style={{ position: "relative" }}>
                <div ref={mobileMenuTriggerRef} onClick={() => setShowMobileMenu(v => !v)} style={{ width: 34, height: 34, borderRadius: "50%", border: "1.5px solid #e2e8f0", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 14, color: "#64748b" }}>‹</div>
                {showMobileMenu && <MobileMenu triggerRef={mobileMenuTriggerRef} onClose={() => setShowMobileMenu(false)} onChat={() => setShowChat(v => !v)} onCustomize={() => setPage("integrations")} />}
              </div>
            </div>
          ) : (
            <>
              <div onClick={() => setShowChat(v => !v)} style={{ padding: "6px 16px", borderRadius: 20, border: "1px solid #e2e8f0", fontSize: 12, color: "#64748b", cursor: "pointer", background: showChat ? "#EFF6FF" : "#fff", whiteSpace: "nowrap" }}>Chat</div>
              <div onClick={() => setPage("integrations")} style={{ padding: "7px clamp(10px,2vw,20px)", borderRadius: 8, background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>Customize</div>
            </>
          )}
        </div>
        )}

        {/* Pages */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {page === "home" && !inlineView && <HomePage sections={isPreviewMode && previewSections ? previewSections : sections} setSections={setSections} onClickMetric={handleClickMetric} onSectionRemoved={handleRemoveSectionWithFiveAccountCheck}
            onFiveAccountEnabledFromBox={handleFiveAccountEnabledFromBox}
            onFiveAccountDisabledFromBox={handleFiveAccountDisabledFromBox}
            onOpenEquationBuilder={handleOpenEquationBuilder}
            orgMembers={orgMembers} />}
          {page === "goals" && isPageAccessible("goals") && <div style={{ flex: 1, overflowY: "auto" }}><GoalsPage goals={goalsData} setGoals={setGoalsData} sections={isPreviewMode && previewSections ? previewSections : sections} viewMode={goalsViewMode} onOpenOnboarding={() => setShowGoalOnboarding(true)} onEditGoal={handleEditGoal} onDuplicateGoal={handleDuplicateGoal} tasks={tasksData} setTasks={setTasksData} userEmail={userEmail} orgMembers={orgMembers} /></div>}
          {page === "tasks" && isPageAccessible("tasks") && <div style={{ flex: 1, overflowY: "auto" }}><TasksPage tasks={tasksData} setTasks={setTasksData} userEmail={userEmail} orgMembers={orgMembers} teamRows={teamRows} sections={sections} goals={goalsData} onViewMetric={id => setViewMetricId(id)} onViewGoal={id => setViewGoalId(id)} onViewTeamMember={m => { setPendingMemberDetail(m); setPage("team"); }} /></div>}
          {page === "integrations" && isPageAccessible("integrations") && <div style={{ flex: 1, overflowY: "auto" }}><IntegrationsPage onSelectApp={a => { setSelectedApp(a); setPage("app-detail"); }} /></div>}
          {page === "app-detail" && selectedApp && <div style={{ flex: 1, overflowY: "auto" }}><AppDetailPage app={selectedApp} onBack={() => setPage("integrations")} /></div>}
          {page === "team" && isPageAccessible("team") && <div style={{ flex: 1, overflowY: "auto" }}><TeamPage sections={isPreviewMode && previewSections ? previewSections : sections} orgMembers={orgMembers} setOrgMembers={setOrgMembers} teamRows={teamRows} setTeamRows={setTeamRows} teamPermissions={teamPermissions} setTeamPermissions={setTeamPermissions} currentUserLevel={currentUserLevel} userEmail={userEmail} onOpenInvite={() => setShowInviteModal(true)} onPreviewMember={(member, perms) => { setPreviewMember(member); setPreviewPerms(perms); setPage("home"); }} onExitPreviewSave={() => { setPreviewFromSave(false); }} previewFromSave={previewFromSave} pendingMemberDetail={pendingMemberDetail} onClearPendingMember={() => setPendingMemberDetail(null)} tasks={tasksData} setTasks={setTasksData} /></div>}
          {page === "settings" && isPageAccessible("settings") && <div style={{ flex: 1, overflowY: "auto" }}><SettingsPage userId={userId!} userEmail={userEmail} profile={profile} forceDisableFiveAccount={fiveAccountForceOff} onForceDisableAcknowledged={() => setFiveAccountForceOff(false)} onProfileSaved={p => setProfile(p)} onFiveAccountCreated={handleFiveAccountCreated} onFiveAccountDisabled={handleGlobalFiveAccountDisabled} fiveAccountSettings={fiveAccountSettings} onFiveAccountSettingsChange={handleUpdateSettings} currentUserLevel={currentUserLevel} /></div>}
          {page === "playbooks" && isPageAccessible("playbooks") && <PlaybooksPage userId={userId} />}
          {page === "equation-builder" && equationBuilderTarget && (
            <EquationBuilderPage
              allMetrics={sections.flatMap(s => s.metrics)}
              sections={sections}
              initialEquation={(() => {
                const m = sections.flatMap(s => s.metrics).find(m => m.id === equationBuilderTarget.metricId);
                return m?.draftEquation ?? m?.equation;
              })()}
              targetMetricId={equationBuilderTarget.metricId}
              onSave={handleSaveEquation}
              onSaveDraft={handleSaveDraftEquation}
              onCancel={handleCancelEquation}
              onDirty={() => setInlineHasUnsaved(true)}
              isMobile={isMobile}
            />
          )}
          {/* Inline metric detail view — renders in page flow, no overlay */}
          {page === "home" && inlineView === "metric-detail" && inlineMetric && (() => {
            const sectionContaining = sections.find(s => s.metrics.some(m => m.id === inlineMetric.id));
            const liveMetric = sectionContaining?.metrics.find(m => m.id === inlineMetric.id) ?? inlineMetric;
            const siblings = sectionContaining?.metrics ?? [];
            return (
              <div style={{ flex: 1, overflowY: "auto", background: "#fff" }}>
                <MetricModal key={liveMetric.id + '-' + (liveMetric.graphType ?? 'linear') + '-' + (liveMetric.colorRules?.length ?? 0) + '-' + (liveMetric.lastSyncedAt ?? 0)}
                  data={liveMetric.modal}
                  metric={liveMetric}
                  onClose={handleCloseInline}
                  onEdit={handleEditFromModal}
                  onValueChange={(v, desc) => {
                    handleValueChange(v, desc);
                    const updated = sections.flatMap(s => s.metrics).find(m => m.id === liveMetric.id);
                    if (updated) setInlineMetric(updated);
                  }}
                  userId={userId ?? undefined}
                  onRefreshSections={handleRefreshMetric}
                  siblings={siblings}
                  onTransfer={handleTransfer}
                  onResyncEquation={() => {
                    setSections(prev => {
                      const allMetrics = prev.flatMap(s => s.metrics);
                      const tm = allMetrics.find(m => m.id === liveMetric.id);
                      if (!tm?.equation || tm.equation.steps.length === 0) return prev;
                      const result = evaluateEquation(tm.equation.steps, allMetrics);
                      if (result === null) return prev;
                      const formatted = formatEquationResult(result, tm.equation.steps, allMetrics);
                      const resynced = prev.map(s => ({
                        ...s,
                        metrics: s.metrics.map(m =>
                          m.id === liveMetric.id ? { ...m, value: formatted, outOfSync: false, lastSyncedAt: Date.now(), modal: { ...m.modal, mainValue: formatted } } : m
                        ),
                      }));
                      const updated = resynced.flatMap(s => s.metrics).find(m => m.id === liveMetric.id);
                      if (updated) setInlineMetric(updated);
                      return resynced;
                    });
                  }}
                  tasks={tasksData}
                  setTasks={setTasksData}
                  userEmail={userEmail}
                  orgMembers={orgMembers}
                  inline
                />
              </div>
            );
          })()}
          {/* Inline metric settings view — renders in page flow, no overlay */}
          {page === "home" && inlineView === "metric-settings" && inlineMetric && (() => {
            let foundSid: string | undefined;
            for (const s of sections) { if (s.metrics.find(m => m.id === inlineMetric.id)) { foundSid = s.id; break; } }
            const foundSection = sections.find(s => s.id === foundSid);
            return (
              <div style={{ flex: 1, overflowY: "auto", background: "#fff", padding: "24px 28px 48px" }}>
                <MetricBoxSettingsModal
                  inline
                  initial={inlineMetric}
                  siblings={foundSection?.metrics ?? []}
                  onSave={updated => {
                    if (foundSid) setSections(prev => prev.map(s => s.id === foundSid ? { ...s, metrics: s.metrics.map(m => m.id === inlineMetric.id ? { ...updated, id: m.id, history: m.history ?? [] } : m) } : s));
                    setInlineHasUnsaved(false);
                    // Return to metric detail after save
                    setSections(prev => {
                      const refreshed = prev.flatMap(s => s.metrics).find(m => m.id === inlineMetric.id);
                      if (refreshed) setInlineMetric({ ...refreshed, ...updated, id: refreshed.id });
                      return prev;
                    });
                    setInlineView("metric-detail");
                  }}
                  onDelete={() => {
                    if (foundSid && inlineMetric) setSections(prev => prev.map(s => s.id === foundSid ? { ...s, metrics: s.metrics.filter(m => m.id !== inlineMetric!.id) } : s));
                    setInlineView(null); setInlineMetric(null); setInlineHasUnsaved(false);
                    setActiveModal(null); setEditingMetricFromModal(null);
                    setViewMode("popup"); viewModeRef.current = "popup";
                  }}
                  onDuplicate={() => {
                    if (foundSid) {
                      const { id, fiveAccountParentId, ...rest } = inlineMetric;
                      setSections(prev => prev.map(s => s.id === foundSid ? { ...s, metrics: [...s.metrics, { ...rest, label: `${inlineMetric.label} (copy)`, history: [], id: crypto.randomUUID() }] } : s));
                    }
                    handleCloseInline();
                  }}
                  onRecreateMissing={(missing) => {
                    if (foundSid) {
                      const groupId = inlineMetric.fiveAccountParentId ?? inlineMetric.id;
                      setSections(prev => prev.map(s => {
                        if (s.id !== foundSid) return s;
                        const newMetrics = missing.map(label => ({ ...makeFiveAccountMetric(label.toLowerCase() as any, groupId), id: crypto.randomUUID() }));
                        return { ...s, metrics: [...s.metrics, ...newMetrics] };
                      }));
                    }
                    handleCloseInline();
                  }}
                  onFiveAccountToggledOn={handleFiveAccountEnabledFromBox}
                  onFiveAccountToggledOff={(label) => { if (foundSid) handleFiveAccountDisabledFromBox(foundSid, inlineMetric.id, label); }}
                  onCreateEquation={() => { if (foundSid) handleOpenEquationBuilder(foundSid, inlineMetric.id); }}
                  onClose={() => { setInlineView("metric-detail"); setInlineHasUnsaved(false); }}
                />
              </div>
            );
          })()}
          {!["home","goals","tasks","integrations","app-detail","team","settings","playbooks","equation-builder"].includes(page) && (
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 48 }}>
              <div style={{ fontSize: 72, fontWeight: 800, color: "#e2e8f0", marginBottom: 8 }}>404</div>
              <div style={{ fontSize: 18, color: "#64748b", marginBottom: 24 }}>Something isn't quite right.</div>
              <button onClick={() => window.history.back()} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: "#3B82F6", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                Go to previous page
              </button>
            </div>
          )}
        </div>
      </div>

      {showChat && <ChatPanel sections={sections} isMobile={isMobile} onClose={() => setShowChat(false)} />}

      {showGoalOnboarding && <GoalOnboarding sections={sections} isMobile={isMobile} onClose={() => setShowGoalOnboarding(false)} onCreate={handleCreateGoal} />}

      {editingGoal && <GoalSettingsModal goal={editingGoal} sections={sections} isMobile={isMobile} onSave={handleSaveGoal} onDuplicate={handleDuplicateGoal} onDelete={handleDeleteGoal} onClose={() => setEditingGoal(null)} />}

      {showInviteModal && <AddTeamModal orgId={activeOrg?.id ?? ""} orgs={orgs} setOrgs={setOrgs} orgMembers={orgMembers} setOrgMembers={setOrgMembers} teamRows={teamRows} setTeamRows={setTeamRows} invitedByName={profile.full_name} onClose={() => setShowInviteModal(false)} currentUserLevel={currentUserLevel} />}

      {/* ── POPUP mode: metric detail modal ── */}
      {viewMode === "popup" && activeModal && (() => (
        <div style={{ position: "relative" }}>
          <MetricModal key={activeModal.metric.id + '-' + (activeModal.metric.graphType ?? 'linear') + '-' + (activeModal.metric.colorRules?.length ?? 0) + '-' + (activeModal.metric.lastSyncedAt ?? 0)}
            data={activeModal.data}
            metric={activeModal.metric}
            onClose={() => { setActiveModal(null); setInlineMetric(null); }}
            onEdit={handleEditFromModal}
            onValueChange={(v, desc) => {
              handleValueChange(v, desc);
              const updated = sections.flatMap(s => s.metrics).find(m => m.id === activeModal.metric.id);
              if (updated) setActiveModal(prev => prev ? { ...prev, metric: updated, data: { ...prev.data, mainValue: updated.value, transactions: updated.modal.transactions } } : null);
            }}
            userId={userId ?? undefined}
            onRefreshSections={handleRefreshMetric}
            siblings={sections.find(s => s.metrics.some(m => m.id === activeModal.metric.id))?.metrics ?? []}
            onTransfer={handleTransfer}
            onResyncEquation={() => {
              setSections(prev => {
                const allMetrics = prev.flatMap(s => s.metrics);
                const tm = allMetrics.find(m => m.id === activeModal.metric.id);
                if (!tm?.equation || tm.equation.steps.length === 0) return prev;
                const result = evaluateEquation(tm.equation.steps, allMetrics);
                if (result === null) return prev;
                const formatted = formatEquationResult(result, tm.equation.steps, allMetrics);
                const resynced = prev.map(s => ({
                  ...s,
                  metrics: s.metrics.map(m =>
                    m.id === activeModal.metric.id ? { ...m, value: formatted, outOfSync: false, lastSyncedAt: Date.now(), modal: { ...m.modal, mainValue: formatted } } : m
                  ),
                }));
                const updated = resynced.flatMap(s => s.metrics).find(m => m.id === activeModal.metric.id);
                if (updated) setActiveModal(prev => prev ? { ...prev, metric: updated, data: { ...prev.data, mainValue: updated.value, transactions: updated.modal.transactions } } : null);
                return resynced;
              });
            }}
            tasks={tasksData}
            setTasks={setTasksData}
            userEmail={userEmail}
            orgMembers={orgMembers}
          />
          {!isMobile && (
            <div onClick={() => { setViewMode("inline"); viewModeRef.current = "inline"; setInlineView("metric-detail"); setActiveModal(null); }}
              title="Expand to full view"
              style={{ position: "absolute", top: 96, right: 28, zIndex: 10, width: 30, height: 30, borderRadius: 8,
                background: "linear-gradient(135deg,#3B82F6,#06B6D4)", boxShadow: "0 2px 8px rgba(59,130,246,0.35)",
                display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
                <path d="M3 11.5V15H6.5M15 6.5V3H11.5M3 6.5V3H6.5M15 11.5V15H11.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          )}
        </div>
      ))()}

      {/* ── POPUP mode: metric settings modal ── */}
      {viewMode === "popup" && editingMetricFromModal && (() => {
        let foundSid: string | undefined;
        for (const s of sections) { if (s.metrics.find(m => m.id === editingMetricFromModal.id)) { foundSid = s.id; break; } }
        const foundSection = sections.find(s => s.id === foundSid);
        return (
          <div style={{ position: "relative" }}>
            <MetricBoxSettingsModal
              initial={editingMetricFromModal}
              siblings={foundSection?.metrics ?? []}
              onSave={updated => {
                if (foundSid) setSections(prev => prev.map(s => s.id === foundSid ? { ...s, metrics: s.metrics.map(m => m.id === editingMetricFromModal.id ? { ...updated, id: m.id, history: m.history ?? [] } : m) } : s));
                const refreshedMetric = { ...editingMetricFromModal, ...updated, id: editingMetricFromModal.id };
                setInlineMetric(refreshedMetric);
                setActiveModal({ data: refreshedMetric.modal, metric: refreshedMetric });
                setEditingMetricFromModal(null);
              }}
              onDelete={() => {
                if (foundSid && editingMetricFromModal) setSections(prev => prev.map(s => s.id === foundSid ? { ...s, metrics: s.metrics.filter(m => m.id !== editingMetricFromModal!.id) } : s));
                setEditingMetricFromModal(null); setActiveModal(null); setInlineMetric(null);
                setInlineView(null); setInlineHasUnsaved(false);
                setViewMode("popup"); viewModeRef.current = "popup";
              }}
              onDuplicate={() => {
                if (foundSid) {
                  const { id, fiveAccountParentId, ...rest } = editingMetricFromModal;
                  setSections(prev => prev.map(s => s.id === foundSid ? { ...s, metrics: [...s.metrics, { ...rest, label: `${editingMetricFromModal.label} (copy)`, history: [], id: crypto.randomUUID() }] } : s));
                }
                setEditingMetricFromModal(null); setActiveModal(null); setInlineMetric(null);
              }}
              onRecreateMissing={(missing) => {
                if (foundSid) {
                  const groupId = editingMetricFromModal.fiveAccountParentId ?? editingMetricFromModal.id;
                  setSections(prev => prev.map(s => {
                    if (s.id !== foundSid) return s;
                    const newMetrics = missing.map(label => ({ ...makeFiveAccountMetric(label.toLowerCase() as any, groupId), id: crypto.randomUUID() }));
                    return { ...s, metrics: [...s.metrics, ...newMetrics] };
                  }));
                }
                setEditingMetricFromModal(null);
              }}
              onFiveAccountToggledOn={handleFiveAccountEnabledFromBox}
              onFiveAccountToggledOff={(label) => { if (foundSid) handleFiveAccountDisabledFromBox(foundSid, editingMetricFromModal.id, label); }}
              onCreateEquation={() => { if (foundSid) handleOpenEquationBuilder(foundSid, editingMetricFromModal.id); setEditingMetricFromModal(null); }}
              onClose={() => {
                const m = sections.flatMap(s => s.metrics).find(m => m.id === editingMetricFromModal.id);
                if (m) setActiveModal({ data: m.modal, metric: m });
                setEditingMetricFromModal(null);
              }}
            />
            {!isMobile && (
              <div onClick={() => { setViewMode("inline"); viewModeRef.current = "inline"; setInlineView("metric-settings"); setEditingMetricFromModal(null); setActiveModal(null); }}
                title="Expand to full view"
                style={{ position: "absolute", top: 96, right: 28, zIndex: 10, width: 30, height: 30, borderRadius: 8,
                  background: "linear-gradient(135deg,#3B82F6,#06B6D4)", boxShadow: "0 2px 8px rgba(59,130,246,0.35)",
                  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
                  <path d="M3 11.5V15H6.5M15 6.5V3H11.5M3 6.5V3H6.5M15 11.5V15H11.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            )}
          </div>
        );
      })()}

    </div>
    </>
  );
}
