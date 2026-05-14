import { useState, useRef, useEffect, useCallback, Fragment } from "react";
import { supabase } from "./lib/supabase";
import * as PhosphorReact from "@phosphor-icons/react";

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
// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

type MetricColor = "green" | "yellow" | "red" | "gray";
type Page = "home" | "goals" | "tasks" | "integrations" | "team" | "settings" | "app-detail" | "equation-builder" | "playbooks";
type GraphType = "bar-h" | "linear" | "pie" | "bar-v";
type MetricType = "counter" | "percentage" | "financial";
type RuleOp = ">=" | "<=" | ">" | "<" | "between" | "==" | "!=" ;
type FiveAccountMode = "one-business" | "business-and-personal" | "five-separate";

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
  operator?: "+" | "-" | "*" | "/" | "total-multiply" | "total-divide" | "total-add" | "total-subtract" | "paren-start" | "paren-end";
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
          { type: "metric", metricId: "_paren", metricValue: String(innerResult), metricLabel: String(innerResult) },
          ...steps.slice(i + 1),
        ];
        return evaluateEquation(newSteps, allMetrics);
      }
    }
  }

  // Handle total operators: evaluate left and right recursively
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.type === "operator" && (s.operator === "total-multiply" || s.operator === "total-divide" || s.operator === "total-add" || s.operator === "total-subtract")) {
      const leftResult = evaluateEquation(steps.slice(0, i), allMetrics);
      const rightResult = evaluateEquation(steps.slice(i + 1), allMetrics);
      if (leftResult === null || rightResult === null) return null;
      if (s.operator === "total-multiply") return leftResult * rightResult;
      if (s.operator === "total-divide") return rightResult === 0 ? 0 : leftResult / rightResult;
      if (s.operator === "total-add") return leftResult + rightResult;
      return leftResult - rightResult;
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
  for (const step of steps) {
    if (step.type === "operator") {
      if (step.operator) {
        if (step.operator === "total-multiply" || step.operator === "total-divide" || step.operator === "total-add" || step.operator === "total-subtract" || step.operator === "paren-start" || step.operator === "paren-end") continue;
        resolved.push(step.operator as "+" | "-" | "*" | "/");
      }
    } else if (step.type === "number") {
      resolved.push(step.numberValue ?? 0);
    } else {
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
      else if (s.operator === "total-multiply") displayParts.push("TOTAL×");
      else if (s.operator === "total-divide") displayParts.push("TOTAL÷");
      else if (s.operator === "total-add") displayParts.push("TOTAL+");
      else if (s.operator === "total-subtract") displayParts.push("TOTAL−");
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
      else if (s.operator === "total-multiply") parts.push("TOTAL×");
      else if (s.operator === "total-divide") parts.push("TOTAL÷");
      else if (s.operator === "total-add") parts.push("TOTAL+");
      else if (s.operator === "total-subtract") parts.push("TOTAL−");
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
      "ArrowsClockwise","ArrowsCounterClockwise","ArrowsLeftRight","ArrowsDownUp","Pulse","Activity",
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
      "Bus","Train","TrainSimple","TrainRegional","Tram","Airplane","AirplaneTakeoff","AirplaneLanding","Helicopter","Boat","Sailboat","RocketLaunch",
      "MapPin","MapTrifold","Navigation","NavigationArrow","Compass","Path","Road","RoadHorizon","TrafficCone","TrafficSign","TrafficSignal",
    ]
  },
  {
    label: "Food",
    icons: [
      "ForkKnife","CookingPot","BowlFood","Bread","Coffee","Hamburger","Pizza","Popcorn",
      "BeerBottle","Wine","Knife","Cake","Cookie","OrangeSlice","Lemon","IceCream","AppleLogo",
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
    projections: [], suggestions: [], nextActions: [{ avatar: "AJ" }, { avatar: "BK" }], ...extra
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

function BottomThreeCards({ data }: { data: MetricModalData }) {
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
      <SectionCard>
        <div style={{ display: "inline-block", background: "#3B82F6", color: "#fff", borderRadius: 99, padding: "5px 14px", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Next Actions</div>
        {data.nextActions.map((a, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div style={{ width: 20, height: 20, borderRadius: "50%", border: "1.5px solid #4CAF7D", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#4CAF7D" }}>✓</div>
            {a.label ? <span style={{ fontSize: 13, color: "#1a2332", flex: 1 }}>{a.label}</span> : <div style={{ flex: 1, height: 7, borderRadius: 99, background: "#e2e8f0" }} />}
            <Av initials={a.avatar} />
          </div>
        ))}
        {data.nextActions.length === 0 && <div style={{ fontSize: 12, color: "#cbd5e1", fontStyle: "italic" }}>No actions yet</div>}
      </SectionCard>
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
  const colorOf = (v: number) => MS[getColorForValue(v, rules)].bg;

  if (graphType === "pie") {
    const counts: Record<MetricColor, number> = { red: 0, yellow: 0, green: 0, gray: 0 };
    points.forEach(p => counts[getColorForValue(p.value, rules)]++);
    const total = points.length;
    const slices = (["green", "yellow", "red", "gray"] as MetricColor[])
      .map(c => ({ color: c, pct: counts[c] / total })).filter(s => s.pct > 0);
    const cx = 70, cy = 70, r = 55;
    let angle = -Math.PI / 2;
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
  ) : (
    <span style={{ fontSize: 10, color: "#cbd5e1", fontStyle: "italic" }}>Never synced</span>
  )}
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

function TopBarRefreshButton({ onRefresh, lastSyncedAt }: {
  onRefresh: () => Promise<void>;
  lastSyncedAt?: number | null;
}) {
  const [state, setState] = useState<"idle" | "spinning" | "done">("idle");

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
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button onClick={handleClick} style={{
        display: "flex", alignItems: "center", gap: 5,
        padding: "4px 10px", borderRadius: 7, border: "1px solid #e2e8f0",
        background: state === "done" ? "#F0FDF4" : "#f8fafc",
        borderColor: state === "done" ? "#4CAF7D" : "#e2e8f0",
        cursor: "pointer", fontSize: 11, fontWeight: 500,
        color: state === "done" ? "#4CAF7D" : "#64748b",
        transition: "all 0.2s"
      }}>
        <span style={{ display: "inline-block", fontSize: 13, animation: state === "spinning" ? "spin 0.7s linear infinite" : "none" }}>
          {state === "done" ? "✓" : "↻"}
        </span>
        {state === "done" ? "Synced" : "Refresh Data"}
      </button>
<span style={{ fontSize: 10, color: lastSyncedAt ? "#94a3b8" : "#cbd5e1", fontStyle: "italic" }}>
        {lastSyncedAt ? fmtTime(lastSyncedAt) : "Never synced"}
      </span>
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
function MetricModal({ data, metric, onClose, onEdit, onValueChange, userId, onRefreshSections, siblings, onTransfer, inline }: {
  data: MetricModalData; metric?: Metric;
  onClose: () => void; onEdit?: () => void; onValueChange?: (v: string, description?: string) => void;
  userId?: string; onRefreshSections?: () => Promise<void>;
  siblings?: Metric[];
  onTransfer?: (toMetricId: string, amount: number, description: string) => void;
  inline?: boolean;
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
      style={inline ? { padding: "20px 28px" } : { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 20 }}>
      <div style={inline ? { width: "100%", maxWidth: 900 } : { 
  background: "#fff", 
  borderRadius: 24, 
  width: "100%", 
  maxWidth: 900, 
  maxHeight: "92vh", 
  overflowY: "auto", 
  overflowX: "hidden", 
  padding: "28px 32px 32px", 
  boxShadow: "0 32px 80px rgba(0,0,0,0.2)", 
  scrollbarGutter: "stable" 
} as React.CSSProperties}>       
        <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#1a2332", flex: 1 }}>{data.title}</h2>
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
          <MetricChart history={history} rules={colorRules} graphType={graphType} currentValue={metric?.value ?? data.mainValue} />
        </div>

        <BottomThreeCards data={data} />
      </div>
    </div>
  );

  // ── COUNTER ───────────────────────────────────────────────────────────────
 if (isCounter) return (
    <div ref={overlayRef} onClick={e => { if (!inline && e.target === overlayRef.current) onClose(); }}
      style={inline ? { padding: "20px 28px" } : { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 20 }}>
      <div style={inline ? { width: "100%", maxWidth: 780 } : { background: "#fff", borderRadius: 24, width: "100%", maxWidth: 780, maxHeight: "92vh", overflowY: "auto", overflowX: "hidden", padding: "28px 32px 32px", boxShadow: "0 32px 80px rgba(0,0,0,0.2)", scrollbarGutter: "stable" } as React.CSSProperties}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#1a2332", flex: 1 }}>{data.title}</h2>
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
            <MetricChart history={history} rules={colorRules} graphType={graphType} currentValue={localValue} />
          </SectionCard>
        </div>
        <BottomThreeCards data={data} />
      </div>
    </div>
  );

  // ── FINANCIAL / PERCENTAGE / GENERIC ──────────────────────────────────────
  return (
    <div ref={overlayRef} onClick={e => { if (!inline && e.target === overlayRef.current) onClose(); }}
      style={inline ? { padding: "20px 28px" } : { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 20 }}>
      <div style={inline ? { width: "100%", maxWidth: 900 } : { background: "#fff", borderRadius: 24, width: "100%", maxWidth: 900, maxHeight: "92vh", overflowY: "auto", padding: "28px 32px 32px", boxShadow: "0 32px 80px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#1a2332", flex: 1 }}>{data.title}</h2>
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 22, marginBottom: 26 }}>
          <div style={{ background: accent, borderRadius: 16, padding: "18px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: statTextColor }}>Amount</div>
                {metric?.lastSyncedAt && <div style={{ fontSize: 9, color: isColored ? "rgba(255,255,255,0.5)" : "#94a3b8" }}>Synced {new Date(metric.lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>}
              </div>
              <button style={{ background: "#fff", border: "none", borderRadius: 20, padding: "3px 12px", fontSize: 11, cursor: "pointer", fontWeight: 600, color: "#1a2332" }}>Filter</button>
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: statValColor, marginBottom: 12 }}>{data.mainValue}</div>
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
          <div>
            {metric?.equation && metric.equation.steps.length > 0 && metric?.metricType !== "percentage" && metric?.metricType !== "financial" ? (
              <div style={{ background: "#F0FDF4", border: "1px solid #c3e6d4", borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#0F6E56", marginBottom: 4 }}>= Equation Active</div>
                <div style={{ fontSize: 12, color: "#1a2332", marginBottom: 6 }}>
                  {buildEquationPreviewString(metric.equation.steps, [metric]) || "Equation set"}
                </div>
                <div style={{ fontSize: 11, color: "#64748b" }}>This value is automatically computed. Edit the equation in metric settings.</div>
              </div>
            ) : (
              <>
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
              </>
            )}
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "6px 8px" }}>
              <MetricChart history={history} rules={colorRules} graphType={graphType} currentValue={localValue} />
            </div>
          </div>
        </div>
        <BottomThreeCards data={data} />
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

function MetricBoxSettingsModal({ initial, siblings, onSave, onDelete, onDuplicate, onRecreateMissing, onClose, onFiveAccountToggledOn, onFiveAccountToggledOff, onCreateEquation }: {
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
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 16 }}>
        <div onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === "Enter") handleSave(); }}
          style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 820, maxHeight: "92vh", overflowY: "auto", overflowX: "hidden", boxShadow: "0 24px 64px rgba(0,0,0,0.2)", scrollbarGutter: "stable" } as React.CSSProperties}>

          {/* Header */}
          <div style={{ padding: "20px 22px 0", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <input value={label} onChange={e => { setLabel(e.target.value); setEquationError(""); }} placeholder="Metric Box Title"
              style={{ fontSize: 17, fontWeight: 700, border: "none", outline: "none", color: "#1a2332", background: "transparent", flex: 1, minWidth: 0 }} />
            <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: "50%", border: "1.5px solid #e2e8f0", background: "#f8fafc", fontSize: 18, cursor: "pointer", color: "#94a3b8", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginLeft: 10 }}>×</button>
          </div>

          {isSynced && (
            <div style={{ margin: "0 22px 6px", background: "#F0FDF4", border: "1px solid #c3e6d4", borderRadius: 8, padding: "6px 12px", fontSize: 11, color: "#0F6E56" }}>
              ✓ Synced from Five-Account System
            </div>
          )}

          <div style={{ padding: "6px 22px 22px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) minmax(280px, 1fr)", gap: 24 }}>

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
                  <button onClick={() => { onDelete?.(); onClose(); }} style={{ padding: "6px 16px", borderRadius: 8, border: "none", background: "#E85D75", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Yes, Delete</button>
                </div>
              </div>
            )}
          </div>
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

function AddTeamModal({ onClose }: { onClose: () => void }) {
  const [members, setMembers] = useState([{ email: "", access: "View" }]);
  const update = (i: number, f: "email" | "access", v: string) => setMembers(p => p.map((m, j) => j === i ? { ...m, [f]: v } : m));
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "28px", width: "100%", maxWidth: 460, boxShadow: "0 24px 64px rgba(0,0,0,0.18)" }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>×</button>
        </div>
        <h2 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 700, color: "#1a2332", textAlign: "center" }}>Add your team</h2>
        <p style={{ margin: "0 0 20px", fontSize: 12, color: "#94a3b8", textAlign: "center" }}>Set permission levels for each team member.</p>
        {members.map((m, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, marginBottom: 10, alignItems: "center" }}>
            <input value={m.email} onChange={e => update(i, "email", e.target.value)} placeholder="Email"
              style={{ padding: "8px 11px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none" }} />
            <select value={m.access} onChange={e => update(i, "access", e.target.value)}
              style={{ padding: "7px 9px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none", background: "#fff" }}>
              {["View", "Edit", "Admin"].map(a => <option key={a}>{a}</option>)}
            </select>
          </div>
        ))}
        <button onClick={() => setMembers(p => [...p, { email: "", access: "View" }])}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#3B82F6", padding: "3px 0", marginBottom: 16, display: "flex", alignItems: "center", gap: 4 }}>
          + Add more
        </button>
        <button onClick={onClose} style={{ width: "100%", padding: "11px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Add</button>
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

function RowMenu({ onRename, onDelete, onClose }: { onRename: () => void; onDelete: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  return (
    <div ref={ref} style={{ position: "absolute", top: 36, right: 0, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid #e2e8f0", zIndex: 100, minWidth: 170, overflow: "hidden" }}>
      <div onClick={() => { onRename(); onClose(); }}
        style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", color: "#1a2332" }}
        onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>Rename row</div>

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

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD SECTION — with robust drag-drop
// ═══════════════════════════════════════════════════════════════════════════

function DashSection({
  section, onAddMetric, onAddMetricById, onRemoveMetric, onUpdateMetric, onRenameSection, onRemoveSection,
  onClickMetric, dragState, onMetricDragStart, onMetricDragEnter, onMetricDrop,
  onSectionDragStart, onSectionDragEnter, onSectionDrop, isSectionDragOver,
  onFiveAccountEnabledFromBox, onFiveAccountDisabledFromBox, onOpenEquationBuilder
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
  onFiveAccountEnabledFromBox?: () => void;
  onFiveAccountDisabledFromBox?: (sectionId: string, disabledMetricId: string, disabledLabel: string) => void;
  onOpenEquationBuilder?: (sectionId: string, metricId: string, reopenAfterSave?: boolean) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingMetric, setEditingMetric] = useState<Metric | null>(null);
  const [showRowModal, setShowRowModal] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  // Drop zone for the section itself (when dragging a metric over empty space in section)
  const handleSectionDropZone = (e: React.DragEvent) => {
    e.preventDefault();
    if (dragState && section.metrics.length === 0) {
      onMetricDrop(section.id, "__end__");
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
       <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#1a2332" }}>{section.title}</h2>
        <div style={{ display: "flex", marginLeft: 2, paddingLeft: 4 }}>
          {section.avatars.map(a => (
            <div key={a} style={{ width: 28, height: 28, borderRadius: "50%", background: "#4C9FE8", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 600, border: "2px solid #fff", marginLeft: -5, flexShrink: 0 }}>{a}</div>
          ))}
        </div>
        <div style={{ position: "relative" }}>
          <div onClick={() => setShowMenu(v => !v)} style={{ width: 26, height: 26, borderRadius: "50%", background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 13, color: "#94a3b8" }}>···</div>
          {showMenu && <RowMenu onRename={() => { setShowMenu(false); setShowRowModal(true); }} onDelete={() => onRemoveSection(section.id)} onClose={() => setShowMenu(false)} />}
        </div>
        <div style={{ flex: 1 }} />
      </div>

      {/* Metrics row */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <div style={{ width: 28, height: 28, borderRadius: "50%", border: "1.5px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#94a3b8", flexShrink: 0, marginRight: 6 }}>›</div>
        <div
          style={{ display: "flex", gap: 10, flexWrap: "wrap", flex: 1, minHeight: 48 }}
          onDragOver={e => e.preventDefault()}
          onDrop={handleSectionDropZone}
        >
          {section.metrics.map(m => {
            const isDragOver = dragState?.sourceSid !== section.id || dragState?.sourceMid !== m.id
              ? false
              : false; // calculated below
            const isTarget = dragState && (dragState.sourceSid !== section.id || dragState.sourceMid !== m.id);
            return (
              <MetricBlock key={m.id} metric={m}
                onClick={() => onClickMetric(m.modal, m)}
                onDragStart={() => onMetricDragStart(section.id, m.id)}
                onDragEnter={e => { if (dragState && (dragState.sourceSid !== section.id || dragState.sourceMid !== m.id)) onMetricDragEnter(section.id, m.id); }}
                onDrop={() => onMetricDrop(section.id, m.id)}
                isDragOver={false}
              />
            );
          })}
          <div onClick={() => setShowAdd(true)} style={{ width: 44, height: 44, borderRadius: "50%", border: "1.5px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#94a3b8", fontSize: 20, alignSelf: "center" }}>+</div>
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

function GoalsPage({ goals, setGoals }: { goals: any[]; setGoals: (g: any[]) => void }) {
  const [view, setView] = useState<"list" | "expanded">("list");
  return (
    <div style={{ padding: "clamp(16px,4vw,32px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: "clamp(20px,4vw,26px)", fontWeight: 700, color: "#1a2332" }}>Company Goals</h1>
        <div style={{ display: "flex", gap: 6, marginLeft: 6 }}>
          {(["list", "expanded"] as const).map(v => (
            <button key={v} onClick={() => setView(v)} style={{ padding: "5px 14px", borderRadius: 20, border: "none", fontSize: 12, cursor: "pointer", fontWeight: 500, background: view === v ? "#3B82F6" : "#e2e8f0", color: view === v ? "#fff" : "#64748b", textTransform: "capitalize" }}>{v === "list" ? "List" : "Expanded"}</button>
          ))}
        </div>
        <button style={{ padding: "7px 18px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", marginLeft: "auto" }}>⊕ Add Goal</button>
      </div>
      {view === "list" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {goals.map((g, i) => (
            <div key={i} style={{ background: "#fff", borderRadius: 14, padding: "16px 18px", border: "1px solid #f1f5f9" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "#1a2332" }}>{g.label}</div>
                <span style={{ fontSize: 12, color: "#94a3b8" }}>Due: {g.due}</span>
                <button style={{ background: "none", border: "none", fontSize: 12, color: "#3B82F6", cursor: "pointer" }}>Edit</button>
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>Progress — {g.pct}%</div>
              <div style={{ height: 8, borderRadius: 99, background: "#e5e7eb", overflow: "hidden" }}>
                <div style={{ width: `${g.pct}%`, height: "100%", borderRadius: 99, background: "#4CAF7D" }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 18 }}>
          {goals.map((g, i) => (
            <div key={i} style={{ background: "#fff", borderRadius: 14, padding: 20, border: "1px solid #f1f5f9" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1a2332", marginBottom: 8 }}>{g.label}</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 3 }}>Progress — {g.pct}%</div>
              <div style={{ height: 8, borderRadius: 99, background: "#e5e7eb", overflow: "hidden", marginBottom: 14 }}>
                <div style={{ width: `${g.pct}%`, height: "100%", borderRadius: 99, background: "#4CAF7D" }} />
              </div>
              {g.metrics.map((m: any, mi: number) => (
                <div key={mi} style={{ display: "inline-block", background: MS[m.color as MetricColor].bg, borderRadius: 8, padding: "5px 10px", marginRight: 6, marginBottom: 4 }}>
                  <div style={{ fontSize: 10, color: MS[m.color as MetricColor].text, fontWeight: 600 }}>{m.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: MS[m.color as MetricColor].text }}>{m.value}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE: TASKS
// ═══════════════════════════════════════════════════════════════════════════

function TasksPage({ tasks, setTasks }: { tasks: any[]; setTasks: (t: any[]) => void }) {
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");
  const toggle = (id: string) => setTasks(tasks.map((x: any) => x.id === id ? { ...x, done: !x.done } : x));
  const filtered = tasks.filter(t => filter === "all" ? true : filter === "active" ? !t.done : t.done);
  return (
    <div style={{ padding: "clamp(16px,4vw,32px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: "clamp(20px,4vw,26px)", fontWeight: 700, color: "#1a2332" }}>Tasks</h1>
        <button style={{ padding: "7px 18px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", marginLeft: "auto" }}>+ Add Task</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(180px,1fr)", gap: 20 }}>
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            {(["all", "active", "completed"] as const).map(f => (
              <div key={f} onClick={() => setFilter(f)} style={{ padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 500, cursor: "pointer", background: filter === f ? "#3B82F6" : "#f1f5f9", color: filter === f ? "#fff" : "#64748b", textTransform: "capitalize" }}>
                {f}{f === "all" ? ` (${tasks.length})` : ""}
              </div>
            ))}
          </div>
          {filtered.map(t => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "#fff", borderRadius: 10, marginBottom: 6, border: "1px solid #f1f5f9", opacity: t.done ? 0.6 : 1 }}>
              <div onClick={() => toggle(t.id)} style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, cursor: "pointer", border: t.done ? "none" : "1.5px solid #d1d5db", background: t.done ? "#4CAF7D" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11 }}>{t.done ? "✓" : ""}</div>
              <div style={{ flex: 1, fontSize: 13, color: "#1a2332", textDecoration: t.done ? "line-through" : "none" }}>{t.text}</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>Due {t.due}</div>
              <Av initials={t.assignee} size={26} />
            </div>
          ))}
        </div>
        <div>
          <SectionCard title="Suggested Tasks ✦">
            <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 10 }}>Based on your dashboard metrics</div>
            {["Close 5 more calls", "Send 13 invoices", "Add $3,500 from Overhead"].map((t, i) => (
              <div key={i} style={{ display: "flex", gap: 8, padding: "8px 10px", background: "#fff", borderRadius: 8, marginBottom: 6, border: "1px solid #f1f5f9" }}>
                <span style={{ fontSize: 16, color: "#94a3b8", cursor: "pointer" }}>⊕</span>
                <span style={{ fontSize: 12, color: "#1a2332" }}>{t}</span>
              </div>
            ))}
          </SectionCard>
          <div style={{ marginTop: 12 }}>
            <SectionCard>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1a2332", marginBottom: 10 }}>Task Summary</div>
              {[["Total", tasks.length], ["Completed", tasks.filter(t => t.done).length], ["Pending", tasks.filter(t => !t.done).length]].map(([l, v]) => (
                <div key={l as string} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: "#64748b" }}>{l}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#1a2332" }}>{v}</span>
                </div>
              ))}
            </SectionCard>
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
        <h1 style={{ margin: 0, fontSize: "clamp(20px,4vw,26px)", fontWeight: 700, color: "#1a2332" }}>All Apps</h1>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search apps..."
            style={{ padding: "7px 13px", borderRadius: 20, border: "1px solid #e2e8f0", fontSize: 12, outline: "none", width: 160 }} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 14, marginBottom: 28 }}>
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

function TeamPage() {
  const [showInvite, setShowInvite] = useState(false);
  const members = [
    { name: "Alex Johnson", role: "Owner", initials: "AJ", email: "alex@company.com", tasks: 12, color: "#4C9FE8" },
    { name: "Beth Kim", role: "Marketing", initials: "BK", email: "beth@company.com", tasks: 8, color: "#7B68EE" },
    { name: "Chris Lee", role: "Sales", initials: "CL", email: "chris@company.com", tasks: 15, color: "#48C78E" },
    { name: "Dana Miller", role: "Finance", initials: "DM", email: "dana@company.com", tasks: 5, color: "#F5A623" },
    { name: "Emma Nash", role: "Operations", initials: "EN", email: "emma@company.com", tasks: 9, color: "#E85D75" },
    { name: "Frank Owen", role: "Dev", initials: "FO", email: "frank@company.com", tasks: 11, color: "#06B6D4" },
  ];
  return (
    <div style={{ padding: "clamp(16px,4vw,32px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: "clamp(20px,4vw,26px)", fontWeight: 700, color: "#1a2332" }}>Team</h1>
        <button onClick={() => setShowInvite(true)} style={{ padding: "7px 18px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", marginLeft: "auto" }}>+ Invite Member</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 14, marginBottom: 24 }}>
        {members.map((m, i) => (
          <div key={i} style={{ background: "#fff", borderRadius: 14, padding: 18, border: "1px solid #f1f5f9", textAlign: "center" }}>
            <div style={{ width: 52, height: 52, borderRadius: "50%", background: m.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: "#fff", margin: "0 auto 10px" }}>{m.initials}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1a2332" }}>{m.name}</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>{m.role}</div>
            <div style={{ fontSize: 11, color: "#3B82F6", marginBottom: 8 }}>{m.email}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1a2332" }}>{m.tasks}</div>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>Tasks</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12 }}>
        {[{ color: "green" as MetricColor, label: "Team", value: "6 members" }, { color: "yellow" as MetricColor, label: "Open Tasks", value: "60" }, { color: "gray" as MetricColor, label: "Completed", value: "2 this week" }].map((b, i) => (
          <div key={i} style={{ background: MS[b.color].bg, borderRadius: 14, padding: 18 }}>
            <div style={{ fontSize: 12, color: MS[b.color].text, opacity: 0.8 }}>{b.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: MS[b.color].text, marginTop: 3 }}>{b.value}</div>
          </div>
        ))}
      </div>
      {showInvite && <AddTeamModal onClose={() => setShowInvite(false)} />}
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

function SettingsPage({ userId, userEmail, profile: externalProfile, forceDisableFiveAccount, onForceDisableAcknowledged, onProfileSaved, onFiveAccountCreated, onFiveAccountDisabled, fiveAccountSettings, onFiveAccountSettingsChange }: {
  userId: string; userEmail: string; profile: any;
  forceDisableFiveAccount?: boolean;
  onForceDisableAcknowledged?: () => void;
  onProfileSaved: (p: any) => void;
  onFiveAccountCreated: () => void;
  onFiveAccountDisabled?: () => void;
  fiveAccountSettings: FiveAccountSettings;
  onFiveAccountSettingsChange: (s: FiveAccountSettings) => void;
}) {
  const [localProfile, setLocalProfile] = useState({
  full_name: "", company: "", street: "", city: "", state: "", zip: "", country: "",
  avatar_url: "", five_account_enabled: false,
  health_green_multiplier: 1.0,
  health_yellow_multiplier: 0.5,
  health_red_multiplier: -1.0,
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
          <ProfileField label="Company" value={localProfile.company} onChange={v => setLocalProfile(p => ({ ...p, company: v }))} />
          <h3 style={{ margin: "16px 0 12px", fontSize: 14, fontWeight: 600, color: "#1a2332" }}>Address</h3>
          <ProfileField label="Street" value={localProfile.street} onChange={v => setLocalProfile(p => ({ ...p, street: v }))} />
          <ProfileField label="City" value={localProfile.city} onChange={v => setLocalProfile(p => ({ ...p, city: v }))} />
          <ProfileField label="State" value={localProfile.state} onChange={v => setLocalProfile(p => ({ ...p, state: v }))} />
          <ProfileField label="ZIP" value={localProfile.zip} onChange={v => setLocalProfile(p => ({ ...p, zip: v }))} />
          <ProfileField label="Country" value={localProfile.country} onChange={v => setLocalProfile(p => ({ ...p, country: v }))} />
          <button onClick={handleSave} disabled={saving} style={{ width: "100%", padding: "9px", borderRadius: 8, border: "none", background: saved ? "#4CAF7D" : "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 6 }}>
            {saving ? "Saving..." : saved ? "✓ Saved!" : "Save Changes"}
          </button>
        </div>

        {/* Plan + Preferences */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Plans — grayed out */}
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

function EquationBuilderPage({ allMetrics, sections, initialEquation, targetMetricId, onSave, onSaveDraft, onCancel }: {
  allMetrics: Metric[];
  sections: Section[];
  initialEquation?: EquationConfig;
  targetMetricId?: string;
  onSave: (equation: EquationConfig) => void;
  onSaveDraft?: (equation: EquationConfig) => void;
  onCancel: () => void;
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

  useEffect(() => {
    const hasUnsaved = JSON.stringify(steps) !== JSON.stringify(initialEquation?.steps ?? []);
    if (hasUnsaved) {
      const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
      window.addEventListener("beforeunload", handler);
      return () => window.removeEventListener("beforeunload", handler);
    }
  }, [steps, initialEquation]);

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
      const insertAt = addAtIndex ?? steps.length;
      setSteps(prev => {
        const next = [...prev];
        next.splice(insertAt, 0, step);
        return next;
      });
      setAddAtIndex(null);
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
          const cur = next[editingStepIndex].operator;
          if (cur === "total-multiply" || cur === "total-divide" || cur === "total-add" || cur === "total-subtract") {
            const totalMap: Record<string, "total-multiply" | "total-divide" | "total-add" | "total-subtract"> = {
              "+": "total-add",
              "-": "total-subtract",
              "*": "total-multiply",
              "/": "total-divide",
            };
            next[editingStepIndex] = { ...next[editingStepIndex], operator: totalMap[op] ?? op as any };
          } else {
            next[editingStepIndex] = { ...next[editingStepIndex], operator: op };
          }
        }
        return next;
      });
      setEditingStepIndex(null);
      setTimeout(() => searchRef.current?.focus(), 100);
    } else {
      const insertAt = addAtIndex ?? steps.length;
      setSteps(prev => {
        const next = [...prev];
        next.splice(insertAt, 0, { type: "operator", operator: op });
        return next;
      });
      setAddAtIndex(null);
      // Focus search after picking math
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  };

  const handleAddTotalOperator = (op: "total-multiply" | "total-divide" | "total-add" | "total-subtract") => {
    setShowAddMenu(false);
    setForceSearch(false);
    setPendingOperator(false);
    setEditingStepIndex(null);
    setSearchQuery("");
    const insertAt = addAtIndex ?? steps.length;
    setSteps(prev => {
      const next = [...prev];
      next.splice(insertAt, 0, { type: "operator", operator: op });
      return next;
    });
    setAddAtIndex(null);
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const handleAddNumberStep = () => {
    setShowAddMenu(false);
    setForceSearch(false);
    setPendingOperator(false);
    setEditingStepIndex(null);
    setSearchQuery("");
    const insertAt = addAtIndex ?? steps.length;
    setSteps(prev => {
      const next = [...prev];
      next.splice(insertAt, 0, { type: "number", numberValue: 0 });
      return next;
    });
    setAddAtIndex(null);
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
      next.splice(adjustedTo, 0, ...items);
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

  const cardSize = Math.max(80, 140 - steps.length * 4);
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
    <div style={{ flex: 1, display: "flex", background: "#fff", height: "100%" }}>
      {/* Left panel ~75% */}
      <div style={{ flex: 3, display: "flex", flexDirection: "column", minWidth: 0, borderRight: targetMetric && steps.length > 0 ? "1px solid #e2e8f0" : "none" }}>
        {/* Header — fixed */}
        <div style={{ padding: "18px 24px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#1a2332" }}>Create Equation</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {checkedOrder.length >= 2 && (
              <button onClick={handleGroupSelected} style={{ padding: "6px 16px", borderRadius: 8, border: "none", background: "#3B82F6", fontSize: 12, cursor: "pointer", color: "#fff", fontWeight: 600 }}>
                Group Selected ({checkedOrder.length})
              </button>
            )}
            <button onClick={() => {
              if (confirmAction === "reset") { setConfirmAction(null); setSteps(initialEquation?.steps ?? []); setEditingStepIndex(null); }
              else { setConfirmAction("reset"); }
            }} style={{ padding: "6px 16px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 12, cursor: "pointer", color: confirmAction === "reset" ? "#E85D75" : "#64748b", fontWeight: confirmAction === "reset" ? 600 : 400 }}>{confirmAction === "reset" ? "Confirm Reset?" : "Reset"}</button>
            <button onClick={() => {
              if (confirmAction === "delete") { setConfirmAction(null); setSteps([]); setEditingStepIndex(null); }
              else { setConfirmAction("delete"); }
            }} style={{ padding: "6px 16px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 12, cursor: "pointer", color: confirmAction === "delete" ? "#E85D75" : "#64748b", fontWeight: confirmAction === "delete" ? 600 : 400 }}>{confirmAction === "delete" ? "Confirm Delete?" : "Delete Equation"}</button>
            <button onClick={onCancel} style={{ padding: "6px 16px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 12, cursor: "pointer", color: "#64748b" }}>Cancel</button>
          </div>
        </div>

        {/* Scrollable middle area */}
        <div style={{ flex: 1, padding: "24px 32px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 20 }}>
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
                } else if (i + 2 < steps.length && steps[i].type === "metric" && steps[i+1].type === "operator" && (steps[i+1].operator === "/" || steps[i+1].operator === "*") && steps[i+2].type === "metric") {
                  renderGroups.push({ type: "fraction", steps: [steps[i], steps[i+1], steps[i+2]], groupIdx: renderGroups.length, startIdx: i });
                  i += 3;
                } else if (steps[i].type === "number") {
                  renderGroups.push({ type: "number", step: steps[i], groupIdx: renderGroups.length, startIdx: i });
                  i++;
                } else {
                  renderGroups.push({ type: steps[i].type as "metric" | "operator", step: steps[i], groupIdx: renderGroups.length, startIdx: i });
                  i++;
                }
              }
              return (
              <div onClick={() => setSelectedGroupStartIdx(null)} style={{ display: "flex", alignItems: "flex-start", flexWrap: "wrap", gap: 6, padding: "14px 18px", background: "#F8FAFC", borderRadius: 12, border: "1px solid #e2e8f0", minHeight: 60, position: "relative" }}>
                {(() => {
                  const innerRenderGroup = (g: typeof renderGroups[0], gi: number, si: number, sc: number, shrinkScale: number) => {
                    const startIdx = g.startIdx;
                    const lineBefore = dropLineIndex === startIdx;
                    const cs = sc;
                    const csScale = Math.max(0.6, Math.min(1, cs / 140));
                    if (g.type === "fraction" && g.steps) {
                      const [topMetric, opStep, bottomMetric] = g.steps;
                      const actualIdx = steps.indexOf(topMetric);
                      const isEditing = actualIdx >= 0 && (editingStepIndex === actualIdx || editingStepIndex === actualIdx + 2);
                      const isTopEditing = actualIdx >= 0 && editingStepIndex === actualIdx;
                      const isBottomEditing = actualIdx >= 0 && editingStepIndex === actualIdx + 2;
                      const fc = cs * 0.8;
                      const topFullMetric = allMetrics.find(m => m.id === topMetric.metricId);
                      const bottomFullMetric = allMetrics.find(m => m.id === bottomMetric.metricId);
                      const topColor = topFullMetric ? resolveColor(topFullMetric) : "gray";
                      const bottomColor = bottomFullMetric ? resolveColor(bottomFullMetric) : "gray";
                      const topMS = MS[topColor];
                      const bottomMS = MS[bottomColor];
                      const topIsColored = topColor !== "gray";
                      const bottomIsColored = bottomColor !== "gray";
                      const renderMiniMetricCard = (eqStep: EquationStep, fullM: Metric | undefined, mColor: MetricColor, mMS: typeof MS.green, isColored: boolean, isPartEditing: boolean) => {
                        const hasIcon = !!(eqStep.metricIcon && eqStep.metricIcon !== ICON_NONE);
                        const txtColor = isColored ? "#fff" : "#4A5568";
                        return (
                          <div style={{
                            width: fc, minHeight: fc, borderRadius: 8,
                            background: mMS.bg,
                            padding: "8px 6px", display: "flex", flexDirection: "column",
                            alignItems: "center", justifyContent: hasIcon ? "space-between" : "center",
                            gap: 2,
                            outline: isPartEditing ? "2px solid #3B82F6" : "2px solid transparent",
                          }}>
                            <div style={{ fontSize: fc * 0.09, fontWeight: 600, color: txtColor, textAlign: "center", lineHeight: 1.1 }}>
                              {eqStep.metricLabel}
                            </div>
                            {hasIcon && (
                              <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                <IconGlyph name={eqStep.metricIcon!} size={13} color={isColored ? mMS.bg : "#3B82F6"} />
                              </div>
                            )}
                            <div style={{ fontSize: fc * 0.1, fontWeight: 700, color: txtColor, textAlign: "center" }}>
                              {eqStep.metricValue}
                            </div>
                          </div>
                        );
                      };
                      return [
                        lineBefore && (
                          <div key={`fl-${gi}-${si}`} style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />
                        ),
                        <div key={`f-${si}-${gi}`}
                          draggable
                          onDragStart={e => {
                            e.dataTransfer.setData("text/plain", "");
                            e.dataTransfer.effectAllowed = "move";
                            e.stopPropagation();
                            dragStepIdxRef.current = actualIdx;
                            dragCountRef.current = 3;
                            if (actualIdx >= 0) handleEditStep(actualIdx);
                            const el = e.currentTarget.cloneNode(true) as HTMLElement;
                            el.style.cssText = 'position:absolute;top:-999px;left:-999px;transform:scale(0.5);transform-origin:top left;border-radius:12px;overflow:hidden;outline:2px solid #3B82F6;background:#EFF6FF;';
                            el.style.pointerEvents = 'none';
                            document.body.appendChild(el);
                            const r = el.getBoundingClientRect();
                            e.dataTransfer.setDragImage(el, r.width / 2, r.height / 2);
                            setTimeout(() => document.body.removeChild(el), 0);
                          }}
                          onDragOver={e => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const m = rect.left + rect.width / 2; const idx = e.clientX < m ? actualIdx : actualIdx + 3; setDropLineIndex(idx); dropLineIndexRef.current = idx; }}
                          onDrop={e => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const m = rect.left + rect.width / 2; const idx = e.clientX < m ? actualIdx : actualIdx + 3; handleStepDrop(idx); }}
                          onDragEnd={() => { dragStepIdxRef.current = null; dragCountRef.current = 1; setDropLineIndex(null); dropLineIndexRef.current = null; }}
                          onClick={e => { e.stopPropagation(); if (actualIdx >= 0) handleEditStep(actualIdx); }}
                          style={{ position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "flex-start", borderRadius: 12, padding: 2, outline: isEditing ? "2px solid #3B82F6" : "2px solid transparent", background: isEditing ? "#EFF6FF" : "transparent" }}>
                          {isEditing && (
                            <div onClick={e => { e.stopPropagation(); if (actualIdx >= 0) { setSteps(prev => { const n = [...prev]; n.splice(actualIdx, 3); return n; }); setEditingStepIndex(null); } }} style={{ position: "absolute", top: 2, right: 2, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#3B82F6", fontSize: 22, fontWeight: 700, lineHeight: 1, zIndex: 10 }}>×</div>
                          )}
                          {renderCheckbox(actualIdx, isEditing)}
                          <div style={{ display: "flex", justifyContent: "center", width: "100%", marginBottom: 3 }}>
                            <div style={{
                              width: 44 * csScale, height: 44 * csScale, borderRadius: "50%",
                              background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 20 * csScale, fontWeight: 700,
                              display: "flex", alignItems: "center", justifyContent: "center"
                            }}>
                              {g.groupIdx! + 1}
                            </div>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                            <div onClick={e => { e.stopPropagation(); if (actualIdx >= 0) handleEditStep(actualIdx); }} style={{ cursor: "pointer" }}>
                              {renderMiniMetricCard(topMetric, topFullMetric, topColor, topMS, topIsColored, isTopEditing)}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "4px 0" }}>
                              <div onClick={e => { e.stopPropagation(); if (actualIdx >= 0) handleEditStep(actualIdx + 1); }} style={{ width: 28, height: 28, borderRadius: "50%", background: "#3B82F6", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                                {opStep?.operator === "*" ? "×" : "÷"}
                              </div>
                            </div>
                            <div onClick={e => { e.stopPropagation(); if (actualIdx >= 0) handleEditStep(actualIdx + 2); }} style={{ cursor: "pointer" }}>
                              {renderMiniMetricCard(bottomMetric, bottomFullMetric, bottomColor, bottomMS, bottomIsColored, isBottomEditing)}
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
                              {g.groupIdx! + 1}
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
                      const numVal = step.numberValue ?? 0;
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
                              {g.groupIdx! + 1}
                            </div>
                          </div>
                          <div style={{ width: 140, minHeight: 100, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 12, background: "#F8FAFC", border: "1.5px solid #e2e8f0", padding: "8px" }}>
                            {isEditing ? (
                              <input autoFocus type="number" value={numVal}
                                onChange={e => {
                                  const v = parseFloat(e.target.value);
                                  setSteps(prev => {
                                    const n = [...prev];
                                    if (n[idx]) n[idx] = { ...n[idx], numberValue: isNaN(v) ? 0 : v };
                                    return n;
                                  });
                                }}
                                onClick={e => e.stopPropagation()}
                                style={{ width: "100%", fontFamily: "inherit", fontSize: 20, fontWeight: 700, color: "#1a2332", textAlign: "center", border: "none", background: "transparent", outline: "none", padding: 0 }}
                              />
                            ) : (
                              <div style={{ fontSize: 22, fontWeight: 700, color: "#1a2332" }}>{numVal}</div>
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
                              {g.groupIdx! + 1}
                            </div>
                          </div>
                          <div style={{ width: 140, minHeight: 140, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <div style={{
                              width: 48 * csScale, height: 48 * csScale, borderRadius: "50%",
                              background: "#3B82F6", color: "#fff",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: 22 * csScale, fontWeight: 700,
                            }}>
                              {step.operator === "*" ? "×" : step.operator === "/" ? "÷" : step.operator === "total-multiply" ? "×" : step.operator === "total-divide" ? "÷" : step.operator === "total-add" ? "+" : step.operator === "total-subtract" ? "−" : step.operator}
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
                        <div onClick={e => { e.stopPropagation(); setShowAddMenu(false); setAddAtIndex(null); setForceSearch(true); setPendingOperator(false); setEditingStepIndex(null); setSearchQuery(""); setTimeout(() => searchRef.current?.focus(), 50); }} style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", color: "#1a2332" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>Add Metric</div>
                        <div onClick={e => { e.stopPropagation(); handleAddNumberStep(); }} style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", color: "#1a2332" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>Add Number</div>
                        <div onClick={e => { e.stopPropagation(); setShowAddMenu(false); setAddAtIndex(null); setForceSearch(false); setPendingOperator(true); setEditingStepIndex(null); setSearchQuery(""); }} style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", color: "#1a2332" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>Add Symbol</div>
                        <div style={{ borderTop: "1px solid #e2e8f0", margin: "4px 0" }} />
                        <div onClick={e => { e.stopPropagation(); handleAddTotalOperator("total-divide"); }} style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", color: "#1a2332" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>Divide Total</div>
                        <div onClick={e => { e.stopPropagation(); handleAddTotalOperator("total-multiply"); }} style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", color: "#1a2332" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>Multiply Total</div>
                        <div onClick={e => { e.stopPropagation(); handleAddTotalOperator("total-subtract"); }} style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", color: "#1a2332" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>Subtract Total</div>
                        <div onClick={e => { e.stopPropagation(); handleAddTotalOperator("total-add"); }} style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", color: "#1a2332" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>Add Total</div>
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
                      } else if (ri + 2 < rEnd && steps[ri].type === "metric" && steps[ri+1].type === "operator" && (steps[ri+1].operator === "/" || steps[ri+1].operator === "*") && steps[ri+2].type === "metric") {
                        subGroups.push({ type: "fraction", steps: [steps[ri], steps[ri+1], steps[ri+2]], groupIdx: ri, startIdx: ri });
                        ri += 3;
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

                    const subSections: typeof sections = [];
                    for (let sri = 0; sri < subGroups.length; sri++) {
                      const g = subGroups[sri];
                      const isTOp = g.type === "operator" && g.step && (g.step.operator === "total-multiply" || g.step.operator === "total-divide" || g.step.operator === "total-add" || g.step.operator === "total-subtract");
                      if (isTOp) {
                        subSections.push({ type: "total-op", group: g, endStepIdx: g.startIdx + 1 });
                      } else {
                        const last = subSections[subSections.length - 1];
                        const sCnt = g.type === "fraction" ? 3 : g.type === "paren-group" ? g.steps!.length : 1;
                        if (last && last.type === "seq") {
                          last.groups!.push(g);
                          last.endStepIdx = g.startIdx + sCnt;
                        } else {
                          subSections.push({ type: "seq", groups: [g], endStepIdx: g.startIdx + sCnt });
                        }
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
                                onDragOver={e => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const m = rect.left + rect.width / 2; const idx = e.clientX < m ? g.startIdx : g.startIdx + g.steps!.length; setDropLineIndex(idx); dropLineIndexRef.current = idx; }}
                                onDrop={e => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const m = rect.left + rect.width / 2; const idx = e.clientX < m ? g.startIdx : g.startIdx + g.steps!.length; handleStepDrop(idx); }}
                                onDragEnd={() => { dragStepIdxRef.current = null; dragCountRef.current = 1; setDropLineIndex(null); dropLineIndexRef.current = null; }}
                                style={{ position: "relative", display: "inline-flex", flexWrap: "wrap", gap: 6, padding: "8px 12px", border: `2px solid ${rpgIsSelected ? "#3B82F6" : "#e2e8f0"}`, borderRadius: 16, background: "#fff", alignItems: "flex-start" }}>
                                {rpgIsSelected && (
                                  <div onClick={e => { e.stopPropagation(); handleRemoveGroup(g.startIdx); }} style={{ position: "absolute", top: -6, right: -6, width: 24, height: 24, borderRadius: "50%", background: "#3B82F6", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 14, fontWeight: 700, zIndex: 20, boxShadow: "0 2px 6px rgba(0,0,0,0.15)" }}>×</div>
                                )}
                                {renderRange(g.startIdx + 1, g.startIdx + g.steps!.length - 1)}
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
                      } else if (sec.type === "total-op" && sec.group) {
                        const gg = sec.group; const st = gg.step!;
                        const idx = steps.indexOf(st);
                        const isEdit = editingStepIndex === idx;
                        const opC = st.operator === "total-multiply" ? "×" : st.operator === "total-divide" ? "÷" : st.operator === "total-add" ? "+" : "-";
                        const prevIsSeq2 = ssi > 0 && subSections[ssi - 1].type === "seq" && subSections[ssi - 1].endStepIdx === gg.startIdx;
                        const lIdx2 = !prevIsSeq2 && dropLineIndex === gg.startIdx;
                        if (lIdx2) subResult.push(<div key={`rtl-${rStart}-${ssi}`} style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />);
                        subResult.push(
                          <div key={`rto-${rStart}-${ssi}`}
                            onClick={e => { e.stopPropagation(); handleEditStep(idx); }}
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
                            style={{ position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "flex-start", borderRadius: 12, padding: 2, outline: isEdit ? "2px solid #3B82F6" : "2px solid transparent", background: isEdit ? "#EFF6FF" : "transparent" }}>
                            {isEdit && (
                              <div onClick={e => { e.stopPropagation(); handleRemoveStep(idx); }} style={{ position: "absolute", top: 2, right: 2, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#3B82F6", fontSize: 22, fontWeight: 700, lineHeight: 1, zIndex: 10 }}>×</div>
                            )}
                            {renderCheckbox(idx, isEdit)}
                            <div style={{ display: "flex", justifyContent: "center", width: "100%", marginBottom: 3 }}>
                              <div style={{ width: 44 * circleScale, height: 44 * circleScale, borderRadius: "50%", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 20 * circleScale, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                {gg.groupIdx! + 1}
                              </div>
                            </div>
                            <div style={{ width: cardSize, minHeight: cardSize, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                              <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#3B82F6", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 700 }}>
                                {opC}
                              </div>
                            </div>
                          </div>
                        );
                      }
                    });
                    return subResult;
                  };

                  // Build sections: split at total operators
                  const sections: { type: "seq" | "total-op"; groups?: typeof renderGroups; group?: typeof renderGroups[0]; endStepIdx: number }[] = [];
                  for (let ri = 0; ri < renderGroups.length; ri++) {
                    const g = renderGroups[ri];
                    const isTotalOp = g.type === "operator" && g.step && (g.step.operator === "total-multiply" || g.step.operator === "total-divide" || g.step.operator === "total-add" || g.step.operator === "total-subtract");
                    if (isTotalOp) {
                      sections.push({ type: "total-op", group: g, endStepIdx: g.startIdx + 1 });
                    } else {
                      const last = sections[sections.length - 1];
                      const stepCount = g.type === "fraction" ? 3 : g.type === "paren-group" ? g.steps!.length : 1;
                      if (last && last.type === "seq") {
                        last.groups!.push(g);
                        last.endStepIdx = g.startIdx + stepCount;
                      } else {
                        sections.push({ type: "seq", groups: [g], endStepIdx: g.startIdx + stepCount });
                      }
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
                              onDragOver={e => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const m = rect.left + rect.width / 2; const idx = e.clientX < m ? g.startIdx : g.startIdx + g.steps!.length; setDropLineIndex(idx); dropLineIndexRef.current = idx; }}
                              onDrop={e => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const m = rect.left + rect.width / 2; const idx = e.clientX < m ? g.startIdx : g.startIdx + g.steps!.length; handleStepDrop(idx); }}
                              onDragEnd={() => { dragStepIdxRef.current = null; dragCountRef.current = 1; setDropLineIndex(null); dropLineIndexRef.current = null; }}
                              style={{ position: "relative", display: "inline-flex", flexWrap: "wrap", gap: 6, padding: "8px 12px", border: `2px solid ${pgIsSelected ? "#3B82F6" : "#e2e8f0"}`, borderRadius: 16, background: "#fff", alignItems: "flex-start" }}>
                              {pgIsSelected && (
                                <div onClick={e => { e.stopPropagation(); handleRemoveGroup(g.startIdx); }} style={{ position: "absolute", top: -6, right: -6, width: 24, height: 24, borderRadius: "50%", background: "#3B82F6", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 14, fontWeight: 700, zIndex: 20, boxShadow: "0 2px 6px rgba(0,0,0,0.15)" }}>×</div>
                              )}
                              {renderRange(g.startIdx + 1, g.startIdx + g.steps!.length - 1)}
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
                    } else if (sec.type === "total-op" && sec.group) {
                      const g = sec.group;
                      const step = g.step!;
                      const idx = steps.indexOf(step);
                      const isEditing = editingStepIndex === idx;
                      const opChar = step.operator === "total-multiply" ? "×" : step.operator === "total-divide" ? "÷" : step.operator === "total-add" ? "+" : "-";
                      const prevIsSeq = si > 0 && sections[si - 1].type === "seq" && sections[si - 1].endStepIdx === g.startIdx;
                      const lineIdx = !prevIsSeq && dropLineIndex === g.startIdx;
                      if (lineIdx) {
                        result.push(<div key={`tl-${si}`} style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />);
                      }
                      result.push(
                        <div key={`to-${si}`}
                          onClick={e => { e.stopPropagation(); handleEditStep(idx); }}
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
                          style={{ position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "flex-start", borderRadius: 12, padding: 2, outline: isEditing ? "2px solid #3B82F6" : "2px solid transparent", background: isEditing ? "#EFF6FF" : "transparent" }}>
                              {isEditing && (
                                <div onClick={e => { e.stopPropagation(); handleRemoveStep(idx); }} style={{ position: "absolute", top: 2, right: 2, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#3B82F6", fontSize: 22, fontWeight: 700, lineHeight: 1, zIndex: 10 }}>×</div>
                              )}
                              {renderCheckbox(idx, isEditing)}
                              <div style={{ display: "flex", justifyContent: "center", width: "100%", marginBottom: 3 }}>
                                <div style={{
                                  width: 44 * circleScale, height: 44 * circleScale, borderRadius: "50%", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 20 * circleScale, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center"
                                }}>
                                  {g.groupIdx! + 1}
                                </div>
                              </div>
                              <div style={{ width: cardSize, minHeight: cardSize, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                                <div style={{
                                 width: 56, height: 56, borderRadius: "10px",
                                  background: "#3B82F6", color: "#fff",
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  fontSize: 26, fontWeight: 700,
                                }}>
                                  {opChar}
                                </div>
                              </div>
                            </div>
                          );
                        }
                      });
                      // Far-right plus button
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
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {(() => {
                    const isFractionOp = editingStepIndex !== null && steps[editingStepIndex]?.type === "operator" && (steps[editingStepIndex]?.operator === "*" || steps[editingStepIndex]?.operator === "/");
                    return (isFractionOp ? [["*", "Multiply"], ["/", "Divide"]] as const : [["+", "Add"], ["-", "Subtract"], ["*", "Multiply"], ["/", "Divide"]] as const).map(([op, label]) => (
                    <button
                      key={op}
                      onClick={() => handleSelectOperator(op)}
                      style={{
                        padding: "14px 0", borderRadius: 16,
                        border: "2px solid #e2e8f0", background: "#fff",
                        display: "flex", flexDirection: "column",
                        alignItems: "center", justifyContent: "center", gap: 4,
                        cursor: "pointer", fontSize: 24, fontWeight: 700,
                        color: "#3B82F6", transition: "all 0.15s",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = "#3B82F6"; e.currentTarget.style.background = "#EFF6FF"; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.background = "#fff"; }}
                    >
                      <span>{op === "*" ? "×" : op === "/" ? "÷" : op}</span>
                      <span style={{ fontSize: 10, fontWeight: 500, color: "#94a3b8" }}>{label}</span>
                    </button>
                  ));})()}
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
        <div style={{ borderTop: "1px solid #e2e8f0", padding: "16px 24px", flexShrink: 0, background: "#F8FAFC", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          {onSaveDraft && (
            <button onClick={handleSaveDraft}
              style={{
                padding: "12px 24px", borderRadius: 8, border: "1.5px solid #3B82F6",
                background: "#fff", color: "#3B82F6",
                fontSize: 14, fontWeight: 600, cursor: "pointer",
              }}>
              Save Draft
            </button>
          )}
          <button onClick={handleSave} disabled={!equationValid}
            style={{
              padding: "12px 32px", borderRadius: 8, border: "none",
              background: equationValid ? "linear-gradient(135deg,#3B82F6,#06B6D4)" : "#e2e8f0",
              color: equationValid ? "#fff" : "#94a3b8",
              fontSize: 14, fontWeight: 600, cursor: equationValid ? "pointer" : "not-allowed",
            }}>
            Save Equation
          </button>
        </div>
      </div>

      {/* Right panel ~25% — Final Output, always visible */}
      {targetMetric && steps.length > 0 && (
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
                id: targetMetric.id,
                label: targetMetric.label,
                icon: targetMetric.icon,
                color: targetMetric.color,
                value: liveFormatted ?? "...",
                metricType: targetMetric.metricType,
                currencySymbol: targetMetric.currencySymbol,
                modal: targetMetric.modal,
                history: targetMetric.history,
                equation: targetMetric.equation,
              }}
              onClick={() => {}}
              onDragStart={() => {}}
              onDragEnter={() => {}}
              onDrop={() => {}}
              isDragOver={false}
              disableDrag
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

function ChatPanel({ sections, onClose }: { sections: Section[]; onClose: () => void }) {
  const channels = ["General", ...sections.map(s => s.title)];
  const [active, setActive] = useState("General");
  const msgs: Record<string, { name: string; time: string; text: string }[]> = {
    General: [{ name: "Julia", time: "14:27", text: "Sounds good @Bryan." }, { name: "Bryan", time: "14:23", text: "Thanks @Julia. When can you have it transferred over by?" }],
  };
  const display = msgs[active] ?? msgs["General"];
  return (
    <div style={{ position: "fixed", right: 0, top: 0, bottom: 0, width: "clamp(260px,28vw,340px)", background: "#fff", boxShadow: "-4px 0 32px rgba(0,0,0,0.1)", zIndex: 1500, display: "flex", flexDirection: "column" }}>
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
// PLAYBOOKS
// ═══════════════════════════════════════════════════════════════════════════

const playbookStyles = {
  container: { display: "flex", flexDirection: "column" as const, height: "100%", background: "#f8fafc", fontSize: 13, lineHeight: 1.5, color: "#1a2332" },
  topbar: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", gap: "0.5rem", flexShrink: 0, borderBottom: "1px solid #f1f5f9" },
  topTitle: { fontWeight: 700, fontSize: 18, color: "#1a2332" },
  topSub: { fontSize: 12, color: "#64748b", marginTop: 2 },
  mainArea: { flex: 1, display: "flex", padding: "clamp(16px,4vw,32px)", gap: "1rem", overflow: "auto" },
  colLeft: { width: 230, maxWidth: "100%", display: "flex", flexDirection: "column" as const, gap: 16, flexShrink: 0 },
  colRight: { flex: 1, display: "flex", flexDirection: "column" as const, gap: 16, overflow: "auto" },
  card: { background: "#fff", borderRadius: 14, border: "1px solid #f1f5f9", padding: "16px 18px" },
  btnPrimary: { background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", border: "none", borderRadius: 8, padding: "7px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 },
  btnSecondary: { background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 8, padding: "7px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, color: "#475569" },
  fieldLabel: { fontSize: 12, fontWeight: 600, color: "#1a2332", marginBottom: 2 },
  fieldHint: { fontSize: 12, color: "#64748b", marginBottom: 4 },
  input: { width: "100%", fontFamily: "inherit", fontSize: 13, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", boxSizing: "border-box" as const },
  textarea: { width: "100%", fontFamily: "inherit", fontSize: 13, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", resize: "vertical" as const, minHeight: 60, boxSizing: "border-box" as const },
  previewCard: { borderRadius: 10, border: "1px dashed #e2e8f0", background: "#F8FAFC", padding: "10px 12px", minHeight: 60, marginBottom: 8 },
  previewLabel: { fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 4, textTransform: "uppercase" as const, letterSpacing: "0.05em" },
  previewOut: { fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" as const, color: "#1a2332" },
  stepChip: { borderRadius: 8, border: "1.5px solid #e2e8f0", padding: "8px 12px", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", background: "#fff", color: "#475569", gap: 6 },
  stepChipActive: { borderRadius: 8, border: "1.5px solid #3B82F6", padding: "8px 12px", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", background: "#EFF6FF", color: "#3B82F6", fontWeight: 600, gap: 6 },
  emailBlock: { marginBottom: 4, padding: "10px 12px", borderRadius: 14, background: "#F8FAFC", border: "1px solid #f1f5f9" },
  emailRow: { display: "grid", gridTemplateColumns: "minmax(0,1.35fr) 30px minmax(0,1.35fr)", gap: "0.6rem", alignItems: "stretch" },
  connector: { position: "relative" as const },
  connectorLine: { position: "absolute" as const, left: "50%", top: "12%", bottom: "12%", width: 2, background: "#e2e8f0" },
  sidebarCard: { background: "#fff", borderRadius: 14, padding: "16px 18px", border: "1px solid #f1f5f9" },
  stepNav: { display: "flex", flexDirection: "column" as const, gap: 6, marginTop: 12 },
};

function PlaybooksPage({ userId }: { userId: string | null }) {
  const [activeStep, setActiveStep] = useState("tagline-card");
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedLabel, setSavedLabel] = useState<string | null>(null);

  const playbookData = () => ({
    companyName, taglineInput,
    olProblem, olSolution, olResult,
    epProblem, epSolution, epResult, epCTA,
    bs, sm, em, lgTitle
  });

  const handleSave = async (label: string) => {
    if (!userId) return;
    setSaving(true);
    await saveUserData("playbooks", userId, playbookData());
    setSaving(false);
    setSavedLabel(label);
    setTimeout(() => setSavedLabel(null), 2000);
  };

  // Form state
  const [companyName, setCompanyName] = useState("ACME Plumbing");
  const [taglineInput, setTaglineInput] = useState("24-Hour Service – Always On Time");
  const [olProblem, setOlProblem] = useState("Homeowners are frustrated and stressed over clogged sinks, broken toilets, and unexpected plumbing issues.");
  const [olSolution, setOlSolution] = useState("ACME Plumbing provides fast, reliable service from a BBB-accredited team with hundreds of satisfied customers.");
  const [olResult, setOlResult] = useState("So you can enjoy peace of mind and a home with plumbing that just works.");
  const [epProblem, setEpProblem] = useState("A lot of homeowners feel overwhelmed and stressed when plumbing problems disrupt their day.");
  const [epSolution, setEpSolution] = useState("At ACME Plumbing, we provide fast, reliable service backed by hundreds of satisfied customers and BBB accreditation.");
  const [epResult, setEpResult] = useState("So you can protect your home from damage, stop worrying about leaks, and get back to normal quickly.");
  const [epCTA, setEpCTA] = useState("If that sounds familiar, call ACME Plumbing today and we'll take care of it.");
  const [bs, setBs] = useState({
    want: "reliable plumbing repairs and maintenance with as little disruption as possible.",
    villain: "unreliable plumbers who show up late, leave a mess, or don't fully fix the issue.",
    external: "clogged sinks, broken toilets, and hidden leaks that disrupt everyday life.",
    internal: "frustration, stress, and worry that the problem will come back.",
    philosophical: "homeowners shouldn't have to put their life on hold because of plumbing problems.",
    empathy: "We know how stressful it is when water is going where it shouldn't.",
    authority: "With hundreds of satisfied customers and BBB accreditation, ACME Plumbing has a proven track record.",
    process: "1) Call ACME, 2) We inspect and explain your options, 3) We fix the problem fast and clean up.",
    agreement: "We arrive on time, respect your home, communicate clearly, and stand behind our work.",
    directCTA: "Call ACME Plumbing today to schedule your service.",
    transitionalCTA: "Download our free guide to get ahead of future issues.",
    success: "a home with plumbing that just works, no surprises, and a plumber you can call with confidence.",
    failure: "ongoing leaks, costly damage, and the stress of never knowing when plumbing problems will strike.",
    identity: "a homeowner who feels in control, protected, and confident about their plumbing.",
  });
  const [sm, setSm] = useState({
    controlling: "You don't have to live with plumbing chaos at home.",
    question: "What if your plumbing just worked without surprise leaks or clogs?",
    problem: "Right now, small plumbing issues are turning into big disruptions.",
    stakes: "Left alone, those 'little' problems can become expensive water damage.",
    guide: "At ACME Plumbing, we've helped hundreds of homeowners get back to normal.",
    plan: "Call ACME, we inspect and explain your options, then fix the problem fast.",
    cta: "If you're dealing with a plumbing issue, send us a message today.",
    success: "Imagine going to bed tonight knowing your plumbing is handled.",
  });
  const [em, setEm] = useState({
    em1Sub: "Here's your plumbing quick-win checklist",
    em1Body: "Thanks for requesting our guide! Inside, you'll find five simple checks you can do this week to prevent emergency plumbing disasters.",
    em1PS: "If you'd rather have a pro look things over, reply to this email and we'll help you out.",
    em2Sub: "The real cost of ignoring small plumbing issues",
    em2Body: "Most plumbing emergencies start as small, easy-to-ignore problems. Don't wait.",
    em2PS: "Don't wait until a small leak becomes a big problem.",
    em3Sub: "How one homeowner avoided a $5,000 flood",
    em3Body: "A quick call saved them thousands and a lot of stress.",
    em3PS: "A quick call saved them thousands and a lot of stress.",
    em4Sub: "3 simple rules for stress-free plumbing",
    em4Body: "Check regularly, act early, and call a trusted pro.",
    em4PS: "Hit reply and tell us what plumbing issue you're worried about most.",
    em5Sub: "Our 3-step plan to protect your home",
    em5Body: "1) Call ACME, 2) We inspect and explain options, 3) We fix the issue and clean up.",
    em5PS: "It really is as simple as call, inspect, and fix.",
    em6Sub: "Ready to fix that plumbing problem for good?",
    em6Body: "Schedule a visit today and get it handled before it turns into something bigger.",
    em6PS: "This week is a great time to get it handled.",
    signature: "John Smith\nOwner, ACME Plumbing\n(555) 123-4567\njohn@acmeplumbing.com",
  });
  const [lgTitle, setLgTitle] = useState("5 Simple Checks to Prevent Emergency Plumbing Disasters");

  const updateBs = (key: string, val: string) => setBs(prev => ({ ...prev, [key]: val }));
  const updateSm = (key: string, val: string) => setSm(prev => ({ ...prev, [key]: val }));
  const updateEm = (key: string, val: string) => setEm(prev => ({ ...prev, [key]: val }));

  const taglinePreview = companyName.trim() ? `${companyName.trim()} — ${taglineInput.trim()}` : taglineInput.trim() || "(Your tagline will appear here…)";
  const olPreview = [olProblem, olSolution, olResult].filter(Boolean).join(" ") || "(Your one-liner will appear here…)";
  const epPreview = [epProblem, epSolution, epResult, epCTA].filter(Boolean).join(" ") || "(Your elevator pitch will appear here…)";

  const bsPoints = (() => {
    const pieces: string[] = [];
    if (bs.want) pieces.push(`Character – Wants: ${bs.want}`);
    if (bs.villain) pieces.push(`Villain: ${bs.villain}`);
    if (bs.external) pieces.push(`External Problem: ${bs.external}`);
    if (bs.internal) pieces.push(`Internal Problem: ${bs.internal}`);
    if (bs.philosophical) pieces.push(`Philosophical Problem: ${bs.philosophical}`);
    if (bs.empathy) pieces.push(`Guide – Empathy: ${bs.empathy}`);
    if (bs.authority) pieces.push(`Guide – Authority: ${bs.authority}`);
    if (bs.process) pieces.push(`Plan – Process: ${bs.process}`);
    if (bs.agreement) pieces.push(`Plan – Agreement: ${bs.agreement}`);
    if (bs.directCTA) pieces.push(`Direct CTA: ${bs.directCTA}`);
    if (bs.transitionalCTA) pieces.push(`Transitional CTA: ${bs.transitionalCTA}`);
    if (bs.success) pieces.push(`Success: ${bs.success}`);
    if (bs.failure) pieces.push(`Failure: ${bs.failure}`);
    if (bs.identity) pieces.push(`Identity: ${bs.identity}`);
    return pieces.length ? pieces.join("\n\n") : "(Short talking points based on your BrandScript will appear here…)";
  })();

  const buildEmailPreview = (sub: string, body: string, ps: string) => {
    let txt = "";
    if (sub) txt += `Subject: ${sub}\n\n`;
    if (body) txt += `${body}\n\n`;
    if (em.signature) txt += `${em.signature}\n\n`;
    if (ps) txt += `P.S. ${ps}`;
    return txt.trim() || "(Email will appear here…)";
  };

  const copyText = async (text: string, label: string) => {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedLabel(label);
      setTimeout(() => setCopiedLabel(null), 1600);
    } catch {}
  };

  const copyAllText = () => {
    const chunks: string[] = [];
    if (taglinePreview && !taglinePreview.includes("will appear here")) chunks.push(`TAGLINE:\n${taglinePreview}`);
    if (olPreview && !olPreview.includes("will appear here")) chunks.push(`ONE-LINER:\n${olPreview}`);
    if (epPreview && !epPreview.includes("will appear here")) chunks.push(`ELEVATOR PITCH:\n${epPreview}`);
    if (bsPoints && !bsPoints.includes("BrandScript")) chunks.push(`BRANDSCRIPT TALKING POINTS:\n${bsPoints}`);
    const caps = [
      ["SOCIAL CAPTION 1", sm.controlling],
      ["SOCIAL CAPTION 2", sm.question],
      ["SOCIAL CAPTION 3", sm.problem],
      ["SOCIAL CAPTION 4", sm.stakes],
      ["SOCIAL CAPTION 5", sm.guide],
      ["SOCIAL CAPTION 6", sm.plan],
      ["SOCIAL CAPTION 7", sm.cta],
      ["SOCIAL CAPTION 8", sm.success],
    ].filter(([, v]) => v).map(([l, v]) => `${l}:\n${v}`).join("\n\n");
    if (caps) chunks.push(caps);
    if (lgTitle.trim()) chunks.push(`LEAD MAGNET TITLE:\n${lgTitle.trim()}`);
    const joined = chunks.join("\n\n-------------------------\n\n");
    if (joined) copyText(joined, "all");
  };

  const clearAll = () => {
    setCompanyName(""); setTaglineInput("");
    setOlProblem(""); setOlSolution(""); setOlResult("");
    setEpProblem(""); setEpSolution(""); setEpResult(""); setEpCTA("");
    setBs({ want: "", villain: "", external: "", internal: "", philosophical: "", empathy: "", authority: "", process: "", agreement: "", directCTA: "", transitionalCTA: "", success: "", failure: "", identity: "" });
    setSm({ controlling: "", question: "", problem: "", stakes: "", guide: "", plan: "", cta: "", success: "" });
    setEm({ em1Sub: "", em1Body: "", em1PS: "", em2Sub: "", em2Body: "", em2PS: "", em3Sub: "", em3Body: "", em3PS: "", em4Sub: "", em4Body: "", em4PS: "", em5Sub: "", em5Body: "", em5PS: "", em6Sub: "", em6Body: "", em6PS: "", signature: "" });
    setLgTitle("");
  };

  const resetAll = () => {
    setCompanyName("ACME Plumbing");
    setTaglineInput("24-Hour Service – Always On Time");
    setOlProblem("Homeowners are frustrated and stressed over clogged sinks, broken toilets, and unexpected plumbing issues.");
    setOlSolution("ACME Plumbing provides fast, reliable service from a BBB-accredited team with hundreds of satisfied customers.");
    setOlResult("So you can enjoy peace of mind and a home with plumbing that just works.");
    setEpProblem("A lot of homeowners feel overwhelmed and stressed when plumbing problems disrupt their day.");
    setEpSolution("At ACME Plumbing, we provide fast, reliable service backed by hundreds of satisfied customers and BBB accreditation.");
    setEpResult("So you can protect your home from damage, stop worrying about leaks, and get back to normal quickly.");
    setEpCTA("If that sounds familiar, call ACME Plumbing today and we'll take care of it.");
    setBs({
      want: "reliable plumbing repairs and maintenance with as little disruption as possible.",
      villain: "unreliable plumbers who show up late, leave a mess, or don't fully fix the issue.",
      external: "clogged sinks, broken toilets, and hidden leaks that disrupt everyday life.",
      internal: "frustration, stress, and worry that the problem will come back.",
      philosophical: "homeowners shouldn't have to put their life on hold because of plumbing problems.",
      empathy: "We know how stressful it is when water is going where it shouldn't.",
      authority: "With hundreds of satisfied customers and BBB accreditation, ACME Plumbing has a proven track record.",
      process: "1) Call ACME, 2) We inspect and explain your options, 3) We fix the problem fast and clean up.",
      agreement: "We arrive on time, respect your home, communicate clearly, and stand behind our work.",
      directCTA: "Call ACME Plumbing today to schedule your service.",
      transitionalCTA: "Download our free guide to get ahead of future issues.",
      success: "a home with plumbing that just works, no surprises, and a plumber you can call with confidence.",
      failure: "ongoing leaks, costly damage, and the stress of never knowing when plumbing problems will strike.",
      identity: "a homeowner who feels in control, protected, and confident about their plumbing.",
    });
    setSm({
      controlling: "You don't have to live with plumbing chaos at home.",
      question: "What if your plumbing just worked without surprise leaks or clogs?",
      problem: "Right now, small plumbing issues are turning into big disruptions.",
      stakes: "Left alone, those 'little' problems can become expensive water damage.",
      guide: "At ACME Plumbing, we've helped hundreds of homeowners get back to normal.",
      plan: "Call ACME, we inspect and explain your options, then fix the problem fast.",
      cta: "If you're dealing with a plumbing issue, send us a message today.",
      success: "Imagine going to bed tonight knowing your plumbing is handled.",
    });
    setEm({
      em1Sub: "Here's your plumbing quick-win checklist",
      em1Body: "Thanks for requesting our guide! Inside, you'll find five simple checks you can do this week to prevent emergency plumbing disasters.",
      em1PS: "If you'd rather have a pro look things over, reply to this email and we'll help you out.",
      em2Sub: "The real cost of ignoring small plumbing issues",
      em2Body: "Most plumbing emergencies start as small, easy-to-ignore problems. Don't wait.",
      em2PS: "Don't wait until a small leak becomes a big problem.",
      em3Sub: "How one homeowner avoided a $5,000 flood",
      em3Body: "A quick call saved them thousands and a lot of stress.",
      em3PS: "A quick call saved them thousands and a lot of stress.",
      em4Sub: "3 simple rules for stress-free plumbing",
      em4Body: "Check regularly, act early, and call a trusted pro.",
      em4PS: "Hit reply and tell us what plumbing issue you're worried about most.",
      em5Sub: "Our 3-step plan to protect your home",
      em5Body: "1) Call ACME, 2) We inspect and explain options, 3) We fix the issue and clean up.",
      em5PS: "It really is as simple as call, inspect, and fix.",
      em6Sub: "Ready to fix that plumbing problem for good?",
      em6Body: "Schedule a visit today and get it handled before it turns into something bigger.",
      em6PS: "This week is a great time to get it handled.",
      signature: "John Smith\nOwner, ACME Plumbing\n(555) 123-4567\njohn@acmeplumbing.com",
    });
    setLgTitle("5 Simple Checks to Prevent Emergency Plumbing Disasters");
  };

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const saved = await loadUserData("playbooks", userId);
      if (!saved) return;
      if (saved.companyName !== undefined) setCompanyName(saved.companyName);
      if (saved.taglineInput !== undefined) setTaglineInput(saved.taglineInput);
      if (saved.olProblem !== undefined) setOlProblem(saved.olProblem);
      if (saved.olSolution !== undefined) setOlSolution(saved.olSolution);
      if (saved.olResult !== undefined) setOlResult(saved.olResult);
      if (saved.epProblem !== undefined) setEpProblem(saved.epProblem);
      if (saved.epSolution !== undefined) setEpSolution(saved.epSolution);
      if (saved.epResult !== undefined) setEpResult(saved.epResult);
      if (saved.epCTA !== undefined) setEpCTA(saved.epCTA);
      if (saved.bs) setBs(saved.bs);
      if (saved.sm) setSm(saved.sm);
      if (saved.em) setEm(saved.em);
      if (saved.lgTitle !== undefined) setLgTitle(saved.lgTitle);
    })();
  }, [userId]);

  const steps = [
    { id: "tagline-card", num: "01", label: "Tagline" },
    { id: "oneliner-card", num: "02", label: "One-Liner" },
    { id: "elevator-card", num: "03", label: "Elevator Pitch" },
    { id: "brandscript-card", num: "04", label: "BrandScript" },
    { id: "social-card", num: "06", label: "Social Posts" },
    { id: "emails-card", num: "07", label: "Emails" },
    { id: "lead-card", num: "08", label: "Lead Magnet" },
  ];

  const renderField = (label: string, hint: string, value: string, onChange: (v: string) => void, opts?: { textarea?: boolean; body?: boolean }) => (
    <div style={{ marginBottom: "0.7rem" }}>
      <div style={playbookStyles.fieldLabel}>{label}</div>
      <div style={playbookStyles.fieldHint}>{hint}</div>
      {opts?.textarea ? (
        <textarea style={{ ...playbookStyles.textarea, ...(opts.body ? { minHeight: 100 } : {}) }} value={value} onChange={e => onChange(e.target.value)} />
      ) : (
        <input style={playbookStyles.input} value={value} onChange={e => onChange(e.target.value)} />
      )}
    </div>
  );

  const saveBtn = (label: string) => (
    <button style={playbookStyles.btnPrimary} onClick={() => handleSave(label)} disabled={saving}>
      {saving ? "Saving…" : savedLabel === label ? "Saved" : "Save"}
    </button>
  );

  const copyBtn = (targetText: string, label: string, copyLabel: string) => (
    <button style={playbookStyles.btnSecondary} onClick={() => copyText(targetText, copyLabel)}>
      {copiedLabel === copyLabel ? "✔ Copied" : label}
    </button>
  );

  const previewBox = (label: string, text: string) => (
    <div style={playbookStyles.previewCard}>
      <div style={playbookStyles.previewLabel}>{label}</div>
      <div style={playbookStyles.previewOut}>{text}</div>
    </div>
  );

  return (
    <div style={playbookStyles.container}>
      <div style={playbookStyles.topbar}>
        <div>
          <div style={playbookStyles.topTitle}>MY MARKETING PLAYBOOK</div>
          <div style={playbookStyles.topSub}>Marketing Message Builder for Contractors</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button style={playbookStyles.btnSecondary} onClick={clearAll}>Clear All</button>
          <button style={playbookStyles.btnSecondary} onClick={resetAll}>Reset All</button>
          <button style={playbookStyles.btnSecondary} onClick={() => window.print()}>Print / Save PDF</button>
          <button style={playbookStyles.btnPrimary} onClick={copyAllText}>
            {copiedLabel === "all" ? "✔ Copied" : "Copy All Text"}
          </button>
        </div>
      </div>
      <div style={playbookStyles.mainArea}>
        <div style={playbookStyles.colLeft}>
          <div style={playbookStyles.sidebarCard}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>Workflow</div>
            <div style={{ fontWeight: 600, fontSize: 15, color: "#1a2332", marginBottom: 4, marginTop: 4 }}>Build your message in eight steps</div>
            <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.6 }}>
              Start with a clear tagline next to your logo, then build a one-liner, a short elevator pitch, your full BrandScript, social posts, emails, and a lead magnet title.
            </div>
            <div style={playbookStyles.stepNav}>
              {steps.map(s => (
                <div
                  key={s.id}
                  style={activeStep === s.id ? playbookStyles.stepChipActive : playbookStyles.stepChip}
                  onClick={() => setActiveStep(s.id)}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, color: activeStep === s.id ? "#3B82F6" : "#94a3b8" }}>{s.num}</span>
                  <span style={{ fontWeight: activeStep === s.id ? 600 : 400 }}>{s.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={playbookStyles.sidebarCard}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>How they fit</div>
            <div style={{ fontWeight: 600, fontSize: 15, color: "#1a2332", marginBottom: 4, marginTop: 4 }}>From logo to full story</div>
            <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.6 }}>
              <strong>Tagline</strong> lives with your logo everywhere.<br /><br />
              <strong>One-Liner</strong> is your quick answer when people ask what you do.<br /><br />
              <strong>Elevator Pitch</strong> is a slightly longer spoken version that invites a conversation.<br /><br />
              <strong>BrandScript</strong> is the master story that guides your website, emails, and sales.<br /><br />
              <strong>Social, Emails & Lead Magnet</strong> reuse the same message across all your marketing.
            </div>
          </div>
        </div>

        <div style={playbookStyles.colRight}>
          {/* TAGLINE */}
          {activeStep === "tagline-card" && (
            <div style={playbookStyles.card}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>Step 1</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2332", marginBottom: 4, marginTop: 2 }}>Tagline / Brand Descriptor</div>
              <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.6, maxWidth: 640, marginBottom: 12 }}>
                A short, clear phrase that sits under your company name and instantly tells people what you do or what you promise.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 16 }}>
                <div>
                  {renderField("Company name", "The name as it appears on your logo, trucks, and paperwork.", companyName, setCompanyName)}
                  {renderField("Tagline question", "If someone only saw your company name and five words, what must they instantly understand?", taglineInput, setTaglineInput, { textarea: true })}
                  <div style={{ marginTop: 12 }}>{saveBtn("tagline")}</div>
                </div>
                <div>
                  {previewBox("Tagline Preview", taglinePreview)}
                  {copyBtn(taglinePreview, "Copy Tagline", "tagline")}
                </div>
              </div>
            </div>
          )}

          {/* ONE-LINER */}
          {activeStep === "oneliner-card" && (
            <div style={playbookStyles.card}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>Step 2</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2332", marginBottom: 4, marginTop: 2 }}>One-Liner</div>
              <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.6, maxWidth: 640, marginBottom: 12 }}>
                A short sentence that describes the problem, the solution, and the result.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 16 }}>
                <div>
                  {renderField("1. Problem", "What problem are your customers dealing with right now?", olProblem, setOlProblem, { textarea: true })}
                  {renderField("2. Solution", "How do you solve that problem?", olSolution, setOlSolution, { textarea: true })}
                  {renderField("3. Result", "What positive outcome do they experience?", olResult, setOlResult, { textarea: true })}
                  <div style={{ marginTop: 12 }}>{saveBtn("oneliner")}</div>
                </div>
                <div>
                  {previewBox("One-Liner Preview", olPreview)}
                  {copyBtn(olPreview, "Copy One-Liner", "ol")}
                </div>
              </div>
            </div>
          )}

          {/* ELEVATOR PITCH */}
          {activeStep === "elevator-card" && (
            <div style={playbookStyles.card}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>Step 3</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2332", marginBottom: 4, marginTop: 2 }}>Elevator Pitch</div>
              <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.6, maxWidth: 640, marginBottom: 12 }}>
                A 20-30 second spoken summary that starts with the problem, explains your solution, shows the result, and offers a next step.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 16 }}>
                <div>
                  {renderField("1. Problem", "Briefly describe the main problem your customer is facing.", epProblem, setEpProblem, { textarea: true })}
                  {renderField("2. Your solution", "How do you guide them and what do you actually do?", epSolution, setEpSolution, { textarea: true })}
                  {renderField("3. Result", "What transformation or win do they experience?", epResult, setEpResult, { textarea: true })}
                  {renderField("4. Call to action", "What's the simple next step you want them to take?", epCTA, setEpCTA, { textarea: true })}
                  <div style={{ marginTop: 12 }}>{saveBtn("elevator")}</div>
                </div>
                <div>
                  {previewBox("Elevator Pitch Preview", epPreview)}
                  {copyBtn(epPreview, "Copy Elevator Pitch", "ep")}
                </div>
              </div>
            </div>
          )}

          {/* BRANDSCRIPT */}
          {activeStep === "brandscript-card" && (
            <div style={playbookStyles.card}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>Step 4</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2332", marginBottom: 4, marginTop: 2 }}>BrandScript – Story Framework</div>
              <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.6, maxWidth: 640, marginBottom: 12 }}>
                The full story you are inviting your customer into.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 16 }}>
                <div>
                  {renderField("1. Character – What do they want?", "What do your customers want?", bs.want, v => updateBs("want", v), { textarea: true })}
                  {renderField("2. Has a Problem – Villain", "Is there a root cause you can personify?", bs.villain, v => updateBs("villain", v), { textarea: true })}
                  {renderField("3. Has a Problem – External", "What is the external, practical problem?", bs.external, v => updateBs("external", v), { textarea: true })}
                  {renderField("4. Has a Problem – Internal", "How is this problem making them feel?", bs.internal, v => updateBs("internal", v), { textarea: true })}
                  {renderField("5. Has a Problem – Philosophical", "Why is it wrong for them to be burdened?", bs.philosophical, v => updateBs("philosophical", v), { textarea: true })}
                  {renderField("6. Meets a Guide – Empathy", "What expresses empathy and understanding?", bs.empathy, v => updateBs("empathy", v), { textarea: true })}
                  {renderField("7. Meets a Guide – Authority", "How do you demonstrate competency?", bs.authority, v => updateBs("authority", v), { textarea: true })}
                  {renderField("8. Gives Them a Plan – Process", "3-4 steps they can take?", bs.process, v => updateBs("process", v), { textarea: true })}
                  {renderField("9. Gives Them a Plan – Agreement", "What assurances can you make?", bs.agreement, v => updateBs("agreement", v), { textarea: true })}
                  {renderField("10. Call to Action – Direct", "What is your direct call to action?", bs.directCTA, v => updateBs("directCTA", v), { textarea: true })}
                  {renderField("11. Call to Action – Transitional", "What transitional CTAs will you use?", bs.transitionalCTA, v => updateBs("transitionalCTA", v), { textarea: true })}
                  {renderField("12. That Ends in Success", "What positive changes will they experience?", bs.success, v => updateBs("success", v), { textarea: true })}
                  {renderField("13. And Avoids Failure", "What negative consequences will they avoid?", bs.failure, v => updateBs("failure", v), { textarea: true })}
                  {renderField("14. Identity Transformation", "Who were they before and who are they becoming?", bs.identity, v => updateBs("identity", v), { textarea: true })}
                  <div style={{ marginTop: 12 }}>{saveBtn("brandscript")}</div>
                </div>
                <div>
                  {previewBox("BrandScript Talking Points", bsPoints)}
                  {copyBtn(bsPoints, "Copy Talking Points", "bs")}
                </div>
              </div>
            </div>
          )}

          {/* SOCIAL */}
          {activeStep === "social-card" && (
            <div style={playbookStyles.card}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>Step 6</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2332", marginBottom: 4, marginTop: 2 }}>Social Media Messaging Framework</div>
              <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.6, maxWidth: 640, marginBottom: 12 }}>
                Turn your BrandScript into repeatable social captions.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 16 }}>
                <div>
                  {renderField("1. Controlling idea", "The main truth your content repeats.", sm.controlling, v => updateSm("controlling", v), { textarea: true })}
                  {renderField("2. Story question", "The big question in your customer's mind.", sm.question, v => updateSm("question", v), { textarea: true })}
                  {renderField("3. Problem", "Summarize the problem.", sm.problem, v => updateSm("problem", v), { textarea: true })}
                  {renderField("4. Stakes", "What do they stand to win or lose?", sm.stakes, v => updateSm("stakes", v), { textarea: true })}
                  {renderField("5. Guide statement", "Empathy and authority in one or two lines.", sm.guide, v => updateSm("guide", v), { textarea: true })}
                  {renderField("6. Plan", "Your 3-4 step plan in sentence form.", sm.plan, v => updateSm("plan", v), { textarea: true })}
                  {renderField("7. Call to action", "What simple step do you want them to take?", sm.cta, v => updateSm("cta", v), { textarea: true })}
                  {renderField("8. Future success", "Life after working with you.", sm.success, v => updateSm("success", v), { textarea: true })}
                  <div style={{ marginTop: 12 }}>{saveBtn("social")}</div>
                </div>
                <div>
                  {previewBox("Caption 1 – Controlling Idea", sm.controlling || "(Caption 1 will appear here…)")}
                  {previewBox("Caption 2 – Story Question", sm.question || "(Caption 2 will appear here…)")}
                  {previewBox("Caption 3 – Problem", sm.problem || "(Caption 3 will appear here…)")}
                  {previewBox("Caption 4 – Stakes", sm.stakes || "(Caption 4 will appear here…)")}
                  {previewBox("Caption 5 – Guide", sm.guide || "(Caption 5 will appear here…)")}
                  {previewBox("Caption 6 – Plan", sm.plan || "(Caption 6 will appear here…)")}
                  {previewBox("Caption 7 – Call to Action", sm.cta || "(Caption 7 will appear here…)")}
                  {previewBox("Caption 8 – Future Success", sm.success || "(Caption 8 will appear here…)")}
                </div>
              </div>
            </div>
          )}

          {/* EMAILS */}
          {activeStep === "emails-card" && (
            <div style={playbookStyles.card}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>Step 7</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2332", marginBottom: 4, marginTop: 2 }}>6-Email Nurture Sequence</div>
              <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.6, maxWidth: 640, marginBottom: 12 }}>
                Build a simple six-email sequence that delivers value and makes a clear offer.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {[1,2,3,4,5,6].map(i => (
                  <div key={i} style={playbookStyles.emailRow}>
                    <div style={playbookStyles.emailBlock}>
                      <div style={playbookStyles.fieldLabel}>Email {i}</div>
                      {renderField("Subject", "", (em as any)[`em${i}Sub`] || "", v => updateEm(`em${i}Sub`, v))}
                      <div style={{ marginBottom: 8 }}>
                        <div style={playbookStyles.fieldLabel}>Body</div>
                        <textarea style={{ ...playbookStyles.textarea, minHeight: 80 }} value={(em as any)[`em${i}Body`] || ""} onChange={e => updateEm(`em${i}Body`, e.target.value)} />
                      </div>
                      <div style={{ marginBottom: 8 }}>
                        <div style={playbookStyles.fieldLabel}>P.S.</div>
                        <textarea style={playbookStyles.textarea} value={(em as any)[`em${i}PS`] || ""} onChange={e => updateEm(`em${i}PS`, e.target.value)} />
                      </div>
                    </div>
                    <div style={playbookStyles.connector}><div style={playbookStyles.connectorLine} /></div>
                    <div>
                      {previewBox(`Email ${i} Preview`, buildEmailPreview((em as any)[`em${i}Sub`] || "", (em as any)[`em${i}Body`] || "", (em as any)[`em${i}PS`] || ""))}
                      {copyBtn(buildEmailPreview((em as any)[`em${i}Sub`] || "", (em as any)[`em${i}Body`] || "", (em as any)[`em${i}PS`] || ""), `Copy Email ${i}`, `em${i}`)}
                    </div>
                  </div>
                ))}
                <div>
                  <div style={playbookStyles.fieldLabel}>Email signature</div>
                  <div style={playbookStyles.fieldHint}>Added at the end of every email.</div>
                  <textarea style={playbookStyles.textarea} value={em.signature} onChange={e => updateEm("signature", e.target.value)} rows={4} />
                </div>
                <div>{saveBtn("emails")}</div>
              </div>
            </div>
          )}

          {/* LEAD MAGNET */}
          {activeStep === "lead-card" && (
            <div style={playbookStyles.card}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>Step 8</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2332", marginBottom: 4, marginTop: 2 }}>Lead Magnet Title Creator</div>
              <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.6, maxWidth: 640, marginBottom: 12 }}>
                Create a clear, valuable title for your downloadable guide, checklist, or video.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 16 }}>
                <div>
                  {renderField("Lead magnet title", "The exact title your ideal customer would want to grab.", lgTitle, setLgTitle, { textarea: true })}
                  <div style={{ marginTop: 12 }}>{saveBtn("lead")}</div>
                </div>
                <div>
                  {previewBox("Lead Magnet Title Preview", lgTitle.trim() || "(Your lead magnet title will appear here…)")}
                  {copyBtn(lgTitle.trim(), "Copy Lead Magnet Title", "lg")}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SIDEBAR
// ═══════════════════════════════════════════════════════════════════════════

const NAV = [
  { icon: "House", label: "Home", page: "home" as Page },
  { icon: "Target", label: "Goals", page: "goals" as Page },
  { icon: "CheckSquare", label: "Tasks", page: "tasks" as Page },
  { icon: "Notebook", label: "Playbooks", page: "playbooks" as Page },
  { icon: "Plugs", label: "Integrations", page: "integrations" as Page },
  { icon: "Users", label: "Team", page: "team" as Page },
  { icon: "Gear", label: "Settings", page: "settings" as Page },
];

function Sidebar({ active, onNav, onClose, isMobile, avatarUrl, firstName, health }: {
  active: Page; onNav: (p: Page) => void; onClose: () => void;
  isMobile: boolean; avatarUrl?: string; firstName?: string;
  health: HealthResult;
}) {
  return (
    <aside style={{ width: 240, flexShrink: 0, background: "#fff", display: "flex", flexDirection: "column", boxShadow: "2px 0 12px rgba(0,0,0,0.06)", height: "100%", minHeight: "100vh", overflowY: "auto", scrollbarWidth: "none" } as React.CSSProperties}>
      <style>{`.nav-item:hover{background:#f1f5f9 !important}`}</style>
      <div style={{ padding: "24px 18px 18px", borderBottom: "1px solid #f1f5f9", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", position: "relative", marginBottom: 10 }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#e2e8f0", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
            {avatarUrl ? <img src={avatarUrl} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ color: "#94a3b8" }}>👤</span>}
          </div>
          {!isMobile && <div onClick={onClose} style={{ position: "absolute", right: 0, width: 26, height: 26, borderRadius: "50%", border: "1.5px solid #e2e8f0", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#94a3b8", fontSize: 14 }}>‹</div>}
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#1a2332" }}>{firstName ? `Welcome ${firstName}` : "Welcome"}</div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>to your dashboard</div>
        </div>
      </div>
      <nav style={{ flex: 1, padding: "10px 10px" }}>
        {NAV.map(item => (
          <div key={item.label} className="nav-item" onClick={() => onNav(item.page)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 11px", borderRadius: 9, marginBottom: 2, cursor: "pointer", background: active === item.page ? "#EFF6FF" : "transparent", color: active === item.page ? "#3B82F6" : "#475569", fontSize: 13, fontWeight: active === item.page ? 600 : 400, transition: "background 0.15s" }}>
            <IconGlyph name={item.icon} size={14} color={active === item.page ? "#3B82F6" : "#475569"} />
            <span style={{ whiteSpace: "nowrap" }}>{item.label}</span>
          </div>
        ))}
      </nav>
      {health.hasData && (() => {
  const barColors = { green: "#4CAF7D", yellow: "#F5A623", red: "#E85D75" };
  return (
    <div style={{ padding: "0 18px 14px" }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Health</span>
        <span style={{ color: "#1a2332", fontWeight: 700 }}>{health.score}%</span>
      </div>
      <div style={{ width: "100%", height: 16, background: "#f1f5f9", borderRadius: 99, overflow: "hidden" }}>
        <div style={{
          width: `${health.score}%`, height: "100%",
          background: barColors[health.barColor], borderRadius: 99,
          transition: "width 400ms ease, background 300ms ease"
        }} />
      </div>
      <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 4, textAlign: "center" }}>
        {health.counts.green}G · {health.counts.yellow}Y · {health.counts.red}R
        {health.counts.gray > 0 ? ` · ${health.counts.gray} unmatched` : ""}
      </div>
    </div>
  );
})()}
      <div style={{ padding: "14px 18px", borderTop: "1px solid #f1f5f9", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <img src="https://dashello.co/wp-content/uploads/2023/08/Logo.png" alt="Dashello" style={{ height: 26, objectFit: "contain", maxWidth: "80%" }} />
        <button onClick={() => supabase.auth.signOut()} style={{ width: "100%", padding: "7px 0", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "transparent", color: "#94a3b8", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Sign Out</button>
      </div>
    </aside>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// HOME PAGE — robust drag-drop
// ═══════════════════════════════════════════════════════════════════════════

function HomePage({ sections, setSections, onClickMetric, onSectionRemoved, onFiveAccountEnabledFromBox, onFiveAccountDisabledFromBox, onOpenEquationBuilder }: {
  sections: Section[];
  setSections: React.Dispatch<React.SetStateAction<Section[]>>;
  onClickMetric: (data: MetricModalData, metric: Metric) => void;
  onSectionRemoved?: (section: Section) => void;
  onFiveAccountEnabledFromBox?: () => void;
  onFiveAccountDisabledFromBox?: (sectionId: string, disabledMetricId: string, disabledLabel: string) => void;
  onOpenEquationBuilder?: (sectionId: string, metricId: string, reopenAfterSave?: boolean) => void;
}) {
  // Drag state stored in ref so it's always current in event handlers
  const dragMetricRef = useRef<{ sourceSid: string; sourceMid: string } | null>(null);
  const dragSectionRef = useRef<string | null>(null);
  const [dragMetricState, setDragMetricState] = useState<{ sourceSid: string; sourceMid: string } | null>(null);
  const [dragOverSid, setDragOverSid] = useState<string | null>(null);
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

  // Metric drag enter on a target metric
  const handleMetricDragEnter = useCallback((targetSid: string, targetMid: string) => {
    if (!dragMetricRef.current) return;
    const { sourceSid, sourceMid } = dragMetricRef.current;
    if (sourceSid === targetSid && sourceMid === targetMid) return;

    setSections(prev => {
      // Find the moving metric
      const sourceSec = prev.find(s => s.id === sourceSid);
      if (!sourceSec) return prev;
      const movingMetric = sourceSec.metrics.find(m => m.id === sourceMid);
      if (!movingMetric) return prev;

      // Remove from source
      const withoutSource = prev.map(s =>
        s.id === sourceSid ? { ...s, metrics: s.metrics.filter(m => m.id !== sourceMid) } : s
      );

      // Insert before target
      return withoutSource.map(s => {
        if (s.id !== targetSid) return s;
        const targetIdx = s.metrics.findIndex(m => m.id === targetMid);
        if (targetIdx === -1) return { ...s, metrics: [...s.metrics, movingMetric] };
        const newMetrics = [...s.metrics];
        newMetrics.splice(targetIdx, 0, movingMetric);
        return { ...s, metrics: newMetrics };
      });
    });

    // Update drag source to new position
    dragMetricRef.current = { sourceSid: targetSid, sourceMid };
    setDragMetricState({ sourceSid: targetSid, sourceMid });
  }, [setSections]);

  // Metric drop — just clear state (position already set by dragEnter)
  const handleMetricDrop = useCallback((targetSid: string, targetMid: string) => {
    dragMetricRef.current = null;
    setDragMetricState(null);
    setDragOverSid(null);
  }, []);

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
          onFiveAccountEnabledFromBox={onFiveAccountEnabledFromBox}
          onFiveAccountDisabledFromBox={onFiveAccountDisabledFromBox}
          onOpenEquationBuilder={onOpenEquationBuilder}
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
    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
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
  const [page, setPage] = useState<Page>("home");
  const [sections, setSections] = useState<Section[]>([]);
  const [activeModal, setActiveModal] = useState<{ data: MetricModalData; metric: Metric } | null>(null);
  const [editingMetricFromModal, setEditingMetricFromModal] = useState<Metric | null>(null);
  // Inline view system
  const [inlineView, setInlineView] = useState<"metric-detail" | "metric-settings" | "color-rule" | null>(null);
  const [inlineMetric, setInlineMetric] = useState<Metric | null>(null);
  const [inlineHasUnsaved, setInlineHasUnsaved] = useState(false);
  const [selectedApp, setSelectedApp] = useState<typeof APPS[0] | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showChat, setShowChat] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState("");
  const [dbReady, setDbReady] = useState(false);
  const [profile, setProfile] = useState({
    full_name: "", company: "", street: "", city: "", state: "", zip: "", country: "",
    avatar_url: "", five_account_enabled: false,
    health_green_multiplier: 1.0,
    health_yellow_multiplier: 0.5,
    health_red_multiplier: -1.0,
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
  const [lastDashboardSync, setLastDashboardSync] = useState<number | null>(null);
  const [fiveAccountForceOff, setFiveAccountForceOff] = useState(false);
  // Equation builder state
  const [equationBuilderTarget, setEquationBuilderTarget] = useState<{ metricId: string; sectionId: string } | null>(null);
  
  // Track where to return after equation builder closes
  const pageBeforeEquationRef = useRef<Page>("home");
  const reopenMetricAfterEquationRef = useRef<{ sectionId: string; metricId: string } | null>(null);

  const handleOpenEquationBuilder = useCallback((sectionId: string, metricId: string, reopenAfterSave?: boolean) => {
    pageBeforeEquationRef.current = page;
    if (reopenAfterSave) {
      reopenMetricAfterEquationRef.current = { sectionId, metricId };
    }
    setEquationBuilderTarget({ sectionId, metricId });
    setPage("equation-builder");
    setEditingMetricFromModal(null);
    setActiveModal(null);
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
    setEquationBuilderTarget(null);
    setPage(pageBeforeEquationRef.current);
    pageBeforeEquationRef.current = "home";
  }, [equationBuilderTarget]);

  const handleSaveDraftEquation = useCallback((equation: EquationConfig) => {
    if (!equationBuilderTarget) return;
    const { sectionId, metricId } = equationBuilderTarget;
    setSections(prev => prev.map(s => {
      if (s.id !== sectionId) return s;
      return {
        ...s,
        metrics: s.metrics.map(m => {
          if (m.id !== metricId) return m;
          return { ...m, draftEquation: equation };
        }),
      };
    }));
    reopenMetricAfterEquationRef.current = { sectionId, metricId };
    setEquationBuilderTarget(null);
    setPage(pageBeforeEquationRef.current);
    pageBeforeEquationRef.current = "home";
  }, [equationBuilderTarget]);

  const handleCancelEquation = useCallback(() => {
    setEquationBuilderTarget(null);
    setPage(pageBeforeEquationRef.current);
    pageBeforeEquationRef.current = "home";
  }, []);

  // Reopen MetricBoxSettingsModal after equation builder closes for newly created metrics
  useEffect(() => {
    if (!equationBuilderTarget && reopenMetricAfterEquationRef.current) {
      const { sectionId, metricId } = reopenMetricAfterEquationRef.current;
      reopenMetricAfterEquationRef.current = null;
      const section = sections.find(s => s.id === sectionId);
      const metric = section?.metrics.find(m => m.id === metricId);
      if (metric) {
        setEditingMetricFromModal(metric);
      }
    }
  }, [equationBuilderTarget, sections]);

  const [tasksData, setTasksData] = useState([
    { id: "1", text: "Review Q3 financials", done: false, assignee: "AJ", due: "Mar 15" },
    { id: "2", text: "Follow up with 5 leads", done: true, assignee: "BK", due: "Mar 12" },
    { id: "3", text: "Update marketing report", done: false, assignee: "CL", due: "Mar 18" },
    { id: "4", text: "Team standup notes", done: true, assignee: "AJ", due: "Mar 11" },
    { id: "5", text: "Invoice client #4821", done: false, assignee: "DM", due: "Mar 20" },
    { id: "6", text: "Send 34 quotes", done: false, assignee: "BK", due: "Mar 22" },
    { id: "7", text: "Add $9,756 to Tax account", done: false, assignee: "AJ", due: "Mar 14" },
  ]);

  const [goalsData, setGoalsData] = useState([
    { label: "Increase Sales by 25%", current: "$235,000", target: "$1,200,000", pct: 20, due: "May 26th", projections: [{ label: "Projected Sales", value: "<27" }], metrics: [{ label: "Leads", value: "12", color: "red" }, { label: "Emails", value: "789", color: "green" }] },
    { label: "Fully Fund Business Emergency - $200k", current: "$70,000", target: "$200,000", pct: 35, due: "Dec 17th", projections: [{ label: "Projected Date", value: "Mar. 17/25" }], metrics: [{ label: "Overhead", value: "$79,941", color: "green" }, { label: "Profit", value: "$235K", color: "yellow" }] },
    { label: "500 New Sign Ups Per Month", current: "125", target: "500", pct: 25, due: "30th", projections: [{ label: "Projected Sign Ups", value: "350" }], metrics: [{ label: "Website", value: "67%", color: "green" }] },
  ]);

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
      const [savedSections, savedTasks, savedGoals] = await Promise.all([
        loadUserData("sections", userId!),
        loadUserData("tasks", userId!),
        loadUserData("goals", userId!),
      ]);
      if (savedSections) setSections(savedSections);
      if (savedTasks) setTasksData(savedTasks);
      if (savedGoals) setGoalsData(savedGoals);
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
});
      setDbReady(true);
    }
    load();
  }, [userId]);

  // Auto-save
  useEffect(() => { if (userId && dbReady) saveUserData("sections", userId, sections); }, [sections, userId, dbReady]);
  useEffect(() => { if (userId && dbReady) saveUserData("tasks", userId, tasksData); }, [tasksData, userId, dbReady]);
  useEffect(() => { if (userId && dbReady) saveUserData("goals", userId, goalsData); }, [goalsData, userId, dbReady]);

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
          return {
            ...m, value: newValue, history: [...(m.history ?? []), newPoint].slice(-50),
            lastSyncedAt: now, outOfSync: false, modal: updatedModal,
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
    setLastDashboardSync(Date.now());
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
    setLastDashboardSync(Date.now());
  };
  
  const handleClickMetric = (data: MetricModalData, metric: Metric) => {
    setInlineMetric(metric);
    setInlineView("metric-detail");
    setInlineHasUnsaved(false);
  };
  const handleEditFromModal = () => {
    if (inlineMetric) {
      setInlineView("metric-settings");
      setInlineHasUnsaved(false);
    }
  };
  // Keep activeModal as null — no longer used for metric clicks
  const handleCloseInline = () => {
    if (inlineHasUnsaved) {
      if (!window.confirm("You have unsaved changes. Leave without saving?")) return;
    }
    setInlineView(null);
    setInlineMetric(null);
    setInlineHasUnsaved(false);
  };
  const handleBreadcrumbNavigate = (key: string) => {
    if (inlineHasUnsaved) {
      if (!window.confirm("You have unsaved changes. Leave without saving?")) return;
      setInlineHasUnsaved(false);
    }
    if (key === "home") { setInlineView(null); setInlineMetric(null); }
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
    setSections(prev => prev.map(s => ({
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
    })));
  }, []);

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

  // ── Section 7: Auto-reset scheduler ──────────────────────────────────────
  useEffect(() => {
    if (!dbReady) return;
    const check = () => {
      const now = Date.now();
      const DAY = 24 * 60 * 60 * 1000;
      const WEEK = 7 * DAY;
      // Approximate month as 30 days for scheduling
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
          // Time to reset
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
    check(); // Run once on mount
    const id = setInterval(check, 60 * 1000); // Check every minute
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

  const handleNav = (p: Page) => { setPage(p); setSelectedApp(null); if (isMobile) setSidebarOpen(false); };

 const health = calculateHealth(
  sections,
  profile.health_green_multiplier,
  profile.health_yellow_multiplier,
  profile.health_red_multiplier
);

const sidebarEl = (
  <Sidebar active={page} onNav={handleNav} onClose={() => setSidebarOpen(false)}
    isMobile={isMobile} avatarUrl={profile.avatar_url}
    firstName={profile.full_name?.split(" ")[0] ?? ""}
    health={health} />
);

  if (!dbReady) return (
    <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", background: "linear-gradient(160deg,#2196F3 0%,#00BCD4 100%)", fontSize: 18, color: "#fff", fontFamily: "Inter, sans-serif" }}>
      Loading your dashboard...
    </div>
  );

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "'Inter',system-ui,sans-serif", background: "#F8FAFC", position: "relative" }}>
      {isMobile && sidebarOpen && <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 900 }} />}
      {sidebarOpen && (
        isMobile
          ? <div style={{ position: "fixed", left: 0, top: 0, bottom: 0, width: 240, zIndex: 1000 }}>
            {sidebarEl}
            <div onClick={() => setSidebarOpen(false)} style={{ position: "absolute", top: 14, right: -44, width: 34, height: 34, borderRadius: "50%", background: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,0.15)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 18, color: "#475569", zIndex: 1001 }}>×</div>
          </div>
          : sidebarEl
      )}

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* Top bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px clamp(10px,3vw,26px)", borderBottom: "1px solid #E8EDF2", background: "#fff", flexShrink: 0, flexWrap: "wrap" }}>
          {!sidebarOpen && (
            <div onClick={() => setSidebarOpen(true)} style={{ width: 34, height: 34, borderRadius: "50%", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", marginRight: 4, flexShrink: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {[0, 1, 2].map(i => <div key={i} style={{ width: 14, height: 2, background: "#475569", borderRadius: 2 }} />)}
              </div>
            </div>
          )}
          {page === "home" && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
              {!inlineView && (
                <div style={{ display: "flex", borderRadius: 8, border: "1px solid #e2e8f0", overflow: "hidden" }}>
                  {["Row", "Column"].map((lbl, i) => (
                    <div key={lbl} style={{ padding: "5px 13px", fontSize: 12, fontWeight: 500, cursor: "pointer", background: i === 0 ? "#3B82F6" : "#fff", color: i === 0 ? "#fff" : "#94a3b8" }}>{lbl}</div>
                  ))}
                </div>
              )}
              <TopBarRefreshButton onRefresh={handleRefreshAll} lastSyncedAt={lastDashboardSync} />
              {inlineView && (
                <BreadcrumbNav items={getBreadcrumbItems()} onNavigate={handleBreadcrumbNavigate} />
              )}
            </div>
          )}
          <div style={{ flex: 1 }} />
          <div onClick={() => setShowChat(v => !v)} style={{ padding: "6px 16px", borderRadius: 20, border: "1px solid #e2e8f0", fontSize: 12, color: "#64748b", cursor: "pointer", background: showChat ? "#EFF6FF" : "#fff" }}>Chat</div>
          <div style={{ padding: "7px clamp(10px,2vw,20px)", borderRadius: 8, background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Customize</div>
        </div>

        {/* Pages */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {page === "home" && <HomePage sections={sections} setSections={setSections} onClickMetric={handleClickMetric} onSectionRemoved={handleRemoveSectionWithFiveAccountCheck}
            onFiveAccountEnabledFromBox={handleFiveAccountEnabledFromBox}
            onFiveAccountDisabledFromBox={handleFiveAccountDisabledFromBox}
            onOpenEquationBuilder={handleOpenEquationBuilder} />}
          {page === "goals" && <div style={{ flex: 1, overflowY: "auto" }}><GoalsPage goals={goalsData} setGoals={setGoalsData} /></div>}
          {page === "tasks" && <div style={{ flex: 1, overflowY: "auto" }}><TasksPage tasks={tasksData} setTasks={setTasksData} /></div>}
          {page === "integrations" && <div style={{ flex: 1, overflowY: "auto" }}><IntegrationsPage onSelectApp={a => { setSelectedApp(a); setPage("app-detail"); }} /></div>}
          {page === "app-detail" && selectedApp && <div style={{ flex: 1, overflowY: "auto" }}><AppDetailPage app={selectedApp} onBack={() => setPage("integrations")} /></div>}
          {page === "team" && <div style={{ flex: 1, overflowY: "auto" }}><TeamPage /></div>}
          {page === "settings" && <div style={{ flex: 1, overflowY: "auto" }}><SettingsPage userId={userId!} userEmail={userEmail} profile={profile} forceDisableFiveAccount={fiveAccountForceOff} onForceDisableAcknowledged={() => setFiveAccountForceOff(false)} onProfileSaved={p => setProfile(p)} onFiveAccountCreated={handleFiveAccountCreated} onFiveAccountDisabled={handleGlobalFiveAccountDisabled} fiveAccountSettings={fiveAccountSettings} onFiveAccountSettingsChange={handleUpdateSettings} /></div>}
          {page === "playbooks" && <PlaybooksPage userId={userId} />}
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
            />
          )}          </div>
      </div>

      {showChat && <ChatPanel sections={sections} onClose={() => setShowChat(false)} />}

      {/* Inline metric detail view */}
      {inlineView === "metric-detail" && inlineMetric && (() => {
        const sectionContaining = sections.find(s => s.metrics.some(m => m.id === inlineMetric.id));
        const liveMetric = sectionContaining?.metrics.find(m => m.id === inlineMetric.id) ?? inlineMetric;
        const siblings = sectionContaining?.metrics ?? [];
        return (
          <div style={{ position: "fixed", inset: 0, background: "#fff", zIndex: 2000, display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <div style={{ borderBottom: "1px solid #f1f5f9", padding: "14px 28px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0, background: "#fff" }}>
              <BreadcrumbNav items={getBreadcrumbItems()} onNavigate={handleBreadcrumbNavigate} />
              <div style={{ flex: 1 }} />
              <button onClick={handleCloseInline} style={{ width: 34, height: 34, borderRadius: "50%", border: "1.5px solid #e2e8f0", background: "#f8fafc", fontSize: 20, cursor: "pointer", color: "#475569", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>×</button>
            </div>
            <div style={{ flex: 1, padding: "0 0 32px" }}>
              <MetricModal
                data={liveMetric.modal}
                metric={liveMetric}
                onClose={handleCloseInline}
                onEdit={handleEditFromModal}
                onValueChange={(v, desc) => {
                  handleValueChange(v, desc);
                  // keep inlineMetric in sync
                  const updated = sections.flatMap(s => s.metrics).find(m => m.id === liveMetric.id);
                  if (updated) setInlineMetric(updated);
                }}
                userId={userId ?? undefined}
                onRefreshSections={handleRefreshMetric}
                siblings={siblings}
                onTransfer={handleTransfer}
                inline
              />
            </div>
          </div>
        );
      })()}

     {inlineView === "metric-settings" && inlineMetric && (() => {
        let foundSid: string | undefined;
        for (const s of sections) { if (s.metrics.find(m => m.id === inlineMetric.id)) { foundSid = s.id; break; } }
        const foundSection = sections.find(s => s.id === foundSid);
        return (
          <div style={{ position: "fixed", inset: 0, background: "#fff", zIndex: 2000, display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <div style={{ borderBottom: "1px solid #f1f5f9", padding: "14px 28px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0, background: "#fff" }}>
              <BreadcrumbNav items={getBreadcrumbItems()} onNavigate={handleBreadcrumbNavigate} />
              <div style={{ flex: 1 }} />
              <button onClick={handleCloseInline} style={{ width: 34, height: 34, borderRadius: "50%", border: "1.5px solid #e2e8f0", background: "#f8fafc", fontSize: 20, cursor: "pointer", color: "#475569", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>×</button>
            </div>
            <div style={{ flex: 1, padding: "24px 28px 48px", overflowY: "auto" }}>
              <MetricBoxSettingsModal
                initial={inlineMetric}
                siblings={foundSection?.metrics ?? []}
                onSave={updated => {
                  if (foundSid) setSections(prev => prev.map(s => s.id === foundSid ? { ...s, metrics: s.metrics.map(m => m.id === inlineMetric.id ? { ...updated, id: m.id, history: m.history ?? [] } : m) } : s));
                  setInlineHasUnsaved(false);
                  setInlineView("metric-detail");
                  const refreshed = sections.flatMap(s => s.metrics).find(m => m.id === inlineMetric.id);
                  if (refreshed) setInlineMetric({ ...refreshed, ...updated, id: refreshed.id });
                }}
                onDelete={() => {
                  if (foundSid) setSections(prev => prev.map(s => s.id === foundSid ? { ...s, metrics: s.metrics.filter(m => m.id !== inlineMetric.id) } : s));
                  handleCloseInline();
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
          </div>
        );
      })()}
    </div>
  );
}
