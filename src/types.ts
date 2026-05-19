// ─── Types ─────────────────────────────────────────────────────────────────

export type MetricColor = "green" | "yellow" | "red" | "gray";
export type Page = "home" | "goals" | "tasks" | "integrations" | "team" | "settings" | "app-detail" | "equation-builder" | "playbooks";
export type GraphType = "bar-h" | "linear" | "pie" | "bar-v";
export type MetricType = "counter" | "percentage" | "financial";
export type RuleOp = ">=" | "<=" | ">" | "<" | "between" | "==" | "!=" ;
export type GoalTargetType = "number_reach" | "number_range" | "percentage" | "color_rule";
export type GoalType = "equation" | "metric";
export type GoalSubType = "counter" | "financial" | "percentage";
export type GoalStatus = "active" | "drafted" | "completed";
export type GoalTrackingMode = "average" | "off" | "direct" | "health_over_time";
export type FiveAccountMode = "one-business" | "business-and-personal" | "five-separate";
export type OrgPermissionLevel = "owner" | "admin" | "editor" | "viewer";

export interface Org {
  id: string;
  name: string;
  isPersonal: boolean;
  createdAt: string;
}
export interface OrgMember {
  id: string;
  email: string;
  name: string;
  avatarUrl: string;
  level: OrgPermissionLevel;
  status: "invited" | "active";
  teamId?: string;
}
export interface TeamRow {
  id: string;
  name: string;
  order: number;
}
export interface TeamPermissions {
  teamId: string;
  allowedSectionIds: string[] | null;
  metricOverrides: { sectionId: string; allowedMetricIds: string[] | null }[] | null;
  allowedPageIds?: string[] | null;
}

export interface GoalTarget {
  type: GoalTargetType;
  operator?: RuleOp;
  value?: number;
  value2?: number;
  percent?: number;
}
export interface GoalStep {
  sectionLabel: string;
  metricLabel: string;
  target: GoalTarget;
}
export interface GoalAttachedMetric {
  sectionLabel: string;
  metricLabel: string;
  trackingMode: GoalTrackingMode;
}
export interface GoalNote {
  text: string;
  timestamp: string;
}
export interface Goal {
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

export interface FiveAccountSettings {
  mode: FiveAccountMode;
  monthlyExpenses: number;
  ownerSalary: number;
  postTransactionEnabled: boolean;
}

export interface PostTransactionPrompt {
  metricId: string;
  oldValue: number;
  newValue: number;
}

export type ResetFrequency = "none" | "daily" | "weekly" | "monthly";
export interface ColorRule {
  id: string;
  color: "red" | "yellow" | "green";
  op: RuleOp;
  value: number;
  value2?: number;
}

export interface EquationStep {
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
export interface EquationConfig {
  steps: EquationStep[];
}
export interface DataPoint { timestamp: number; value: number; }
export interface Transaction { date: string; description: string; credit?: number; debit?: number; }
export interface StatRow { label: string; value: string; synced?: boolean; }
export interface ProjRow { label: string; sub: string; value: string; }
export interface NextAction { label?: string; avatar?: string; }
export interface Task {
  id: string;
  text: string;
  done: boolean;
  dueDate?: string;
  assignedTo: string;
  createdBy: string;
  linkedMetricId?: string;
  linkedGoalId?: string;
  linkedDecisionId?: string;
  createdAt: string;
  priority?: boolean;
}

export interface MetricModalData {
  type: "cashflow" | "leads" | "emails" | "invoices" | "website" | "generic";
  title: string; color: MetricColor; healthPct: number | null;
  mainValue: string; syncTime: string;
  stats: StatRow[]; transactions?: Transaction[];
  projections: ProjRow[]; suggestions: string[]; nextActions: NextAction[];
  fiveAccountEnabled?: boolean;
  accountType?: "overhead" | "profit" | "tax" | "investments" | "owner";
}

export interface Metric {
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
export interface Section { id: string; title: string; avatars: string[]; metrics: Metric[]; }

export interface HealthResult {
  score: number;
  barColor: "green" | "yellow" | "red";
  hasData: boolean;
  counts: { green: number; yellow: number; red: number; gray: number };
}
