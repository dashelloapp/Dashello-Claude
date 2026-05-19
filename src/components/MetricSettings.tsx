import { useState, useRef, useEffect, useLayoutEffect, Fragment } from "react";
import { Metric, MetricColor, MetricModalData, MetricType, ColorRule, RuleOp, PostTransactionPrompt, Section, Task, OrgMember, FiveAccountSettings, GraphType, ResetFrequency, OrgPermissionLevel } from "../types";
import { resolveColor, computeMetricHealth, formatValue } from "../utils/helpers";
import { IconGlyph, Av, Toggle, SectionCard, TxnTable, IconPicker } from "./shared";
import { MS, FIVE_EQUATION_POINTS, WORLD_CURRENCIES, FIVE_ACCOUNT_ICONS, FIVE_DESC, FIVE_ACCOUNT_LABELS, ICON_NONE } from "../utils/constants";
import { runFiveAccountEquation, makeModal } from "../utils/equations";
import { useTranslation } from "../i18n";

// ── Constants ──────────────────────────────────────────────────────────────

export const LEVEL_ORDER: OrgPermissionLevel[] = ["viewer", "editor", "admin", "owner"];
export const opLabels: RuleOp[] = [">=", "<=", ">", "<", "==", "!=", "between"];

// ═══════════════════════════════════════════════════════════════════════════
// POST TRANSACTION MODAL
// ═══════════════════════════════════════════════════════════════════════════

export function PostTransactionModal({ prompt, currency, onConfirm, onCancel }: {
  prompt: PostTransactionPrompt;
  currency: string;
  onConfirm: (description: string) => void;
  onCancel: () => void;
}) {
  const { t: __ } = useTranslation();
  const [desc, setDesc] = useState("");
  const delta = prompt.newValue - prompt.oldValue;
  const isCredit = delta > 0;
  const fmt = (n: number) => `${currency}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 5000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 24, width: "100%", maxWidth: 380, boxShadow: "0 24px 64px rgba(0,0,0,0.2)", overflowY: "auto", overflowX: "hidden", maxHeight: "92vh" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332", marginBottom: 4 }}>{__('settings.postTransaction', 'Post Transaction')}</div>
        <div style={{ fontSize: 15, color: "#64748b", marginBottom: 16 }}>
          Recording a <strong style={{ color: isCredit ? "#4CAF7D" : "#E85D75" }}>{isCredit ? `+${fmt(delta)} credit` : `${fmt(delta)} debit`}</strong> to this account.
        </div>
        <input
          value={desc} onChange={e => setDesc(e.target.value)} autoFocus
          onKeyDown={e => { if (e.key === "Enter" && desc.trim()) onConfirm(desc.trim()); }}
          placeholder="Transaction description (e.g. Q1 tax payment)"
          style={{ width: "100%", padding: "8px 11px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box", marginBottom: 14 }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>Cancel (discard change)</button>
          <button onClick={() => { if (desc.trim()) onConfirm(desc.trim()); }} style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{__('common.post', 'Post')}</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// FIVE-ACCOUNT SIMPLIFIED COLOR RULE
// ═══════════════════════════════════════════════════════════════════════════

export function FiveAccountColorRule({ rules, onChange }: {
  rules: ColorRule[];
  onChange: (rules: ColorRule[]) => void;
}) {
  const { t: __ } = useTranslation();
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
  const inputStyle: React.CSSProperties = { padding: "6px 9px", borderRadius: 7, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box", width: "100%", background: "#fff" };

  const Row = ({ label, color, children }: { label: string; color: string; children: React.ReactNode }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, flexShrink: 0, display: "inline-block" }} />
      <span style={{ fontSize: 15, color: "#64748b", width: 54, flexShrink: 0 }}>{label}</span>
      {children}
    </div>
  );

  return (
    <div style={{ background: "#F8FAFC", borderRadius: 10, padding: "10px 12px", border: "1px solid #e2e8f0" }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Color Thresholds</div>
      <Row label="Red — below" color="#E85D75">
        <input defaultValue={rv.current} onChange={e => { rv.current = e.target.value; }} onBlur={() => commit()} placeholder="Min threshold" style={inputStyle} />
      </Row>
      <Row label="Yellow — range" color="#F5A623">
        <input defaultValue={ymi.current} onChange={e => { ymi.current = e.target.value; }} onBlur={() => commit()} placeholder="From" style={{ ...inputStyle, width: "48%" }} />
        <span style={{ fontSize: 15, color: "#94a3b8" }}>–</span>
        <input defaultValue={yma.current} onChange={e => { yma.current = e.target.value; }} onBlur={() => commit()} placeholder="To" style={{ ...inputStyle, width: "48%" }} />
      </Row>
      <Row label="Green — target" color="#4CAF7D">
       <select value={greenOp} onChange={e => { const v = e.target.value as "<=" | "=="; setGreenOp(v); commit(v); }}
          style={{ padding: "6px 7px", borderRadius: 7, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", background: "#fff", flexShrink: 0 }}>
          <option value="==">{__('goal.equalsTarget', 'Equals target')}</option>
          <option value="<=">{__('common.atOrBelow', 'At or below target')}</option>
        </select>
        <input defaultValue={gv.current} onChange={e => { gv.current = e.target.value; }} onBlur={() => commit()} placeholder="Target" style={inputStyle} />
      </Row>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ADD COLOR RULE MODAL
// ═══════════════════════════════════════════════════════════════════════════

export function AddColorRuleModal({ onSave, onClose, existing }: {
  onSave: (rule: ColorRule) => void; onClose: () => void; existing?: ColorRule;
}) {
  const { t: __ } = useTranslation();
  const [color, setColor] = useState<"red" | "yellow" | "green">(existing?.color ?? "red");
  const [op, setOp] = useState<RuleOp>(existing?.op ?? ">=");
  const [val, setVal] = useState(existing?.value?.toString() ?? "");
  const [val2, setVal2] = useState(existing?.value2?.toString() ?? "");

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
          <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332", marginBottom: 10 }}>1. Select Condition</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 15, color: "#64748b", width: 80, flexShrink: 0 }}>{__('metric.ifMetric', 'If Metric is')}</span>
            <select value={op} onChange={e => setOp(e.target.value as RuleOp)}
              style={{ flex: 1, padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", background: "#fff" }}>
              {opLabels.map(o => <option key={o} value={o}>{opDisplay[o]}</option>)}
            </select>
          </div>
          {op !== "between"
            ? <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 15, color: "#64748b", width: 80, flexShrink: 0 }}>{__('common.value', 'Value')}</span>
              <input value={val} onChange={e => setVal(e.target.value)} placeholder="Enter number"
                style={{ flex: 1, padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }} />
            </div>
            : <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 15, color: "#64748b", width: 80, flexShrink: 0 }}>{__('common.minValue', 'Min Value')}</span>
                <input value={val} onChange={e => setVal(e.target.value)} placeholder="Min"
                  style={{ flex: 1, padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 15, color: "#64748b", width: 80, flexShrink: 0 }}>{__('common.maxValue', 'Max Value')}</span>
                <input value={val2} onChange={e => setVal2(e.target.value)} placeholder="Max"
                  style={{ flex: 1, padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }} />
              </div>
            </div>}
        </div>
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332", marginBottom: 10 }}>2. Select Color</div>
          <div style={{ display: "flex", gap: 10 }}>
            {(["red", "yellow", "green"] as const).map(c => (
              <div key={c} onClick={() => setColor(c)} style={{
                display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                padding: "8px 12px", borderRadius: 10, flex: 1, justifyContent: "center",
                border: `2px solid ${color === c ? MS[c].bg : "#e2e8f0"}`,
                background: color === c ? MS[c].bg + "18" : "#fff"
              }}>
                <span style={{ width: 12, height: 12, borderRadius: "50%", background: MS[c].bg, display: "inline-block" }} />
                <span style={{ fontSize: 15, fontWeight: 600, color: color === c ? MS[c].bg : "#64748b", textTransform: "capitalize" }}>{c}</span>
              </div>
            ))}
          </div>
        </div>
        <button onClick={save} style={{ width: "100%", padding: "11px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
          Save Rule
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// METRIC BOX SETTINGS MODAL
// ═══════════════════════════════════════════════════════════════════════════

export function MetricBoxSettingsModal({ initial, siblings, onSave, onDelete, onDuplicate, onRecreateMissing, onClose, onFiveAccountToggledOn, onFiveAccountToggledOff, onCreateEquation, inline: isInline }: {
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
  const { t: __ } = useTranslation();
  const [label, setLabel] = useState(initial?.label ?? "");
  const [rawValue, setRawValue] = useState(() => {
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

  const previewValue = formatValue(rawValue || "0", fiveOn ? "financial" : metricType, currency);

  const graphTypes: [GraphType, string][] = [["linear", "Line Chart"], ["bar-v", "Bar Vertical"], ["bar-h", "Bar Horizontal"], ["pie", "Pie Chart"]];
  const metricTypes: [MetricType, string][] = [["counter", "Counter"], ["percentage", "Percentage"], ["financial", "Financial"]];

  const SectionLabel = ({ children }: { children: string }) => (
    <div style={{ fontSize: 15, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{children}</div>
  );

  const Radio = ({ checked, onChange, label: rl, disabled }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean }) => (
    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: disabled ? "not-allowed" : "pointer", fontSize: 15, color: disabled ? "#cbd5e1" : "#1a2332", marginBottom: 5 }}>
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
            <div style={{ margin: "0 22px 6px", background: "#F0FDF4", border: "1px solid #c3e6d4", borderRadius: 8, padding: "6px 12px", fontSize: 15, color: "#0F6E56" }}>
              ✓ Synced from Five-Account System
            </div>
          )}

          <div style={{ padding: "6px clamp(16px,3vw,22px) clamp(16px,3vw,22px)" }}>
            <div className="stack-mobile" style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) minmax(280px, 1fr)", gap: 24 }}>

              {/* LEFT */}
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <SectionLabel>{__('common.metricType', 'Metric Type')}</SectionLabel>
                  {metricTypes.map(([t, l]) => (
                    <Radio key={t} checked={effectiveMetricType === t} onChange={() => setMetricType(t)} label={l} disabled={fiveOn} />
                  ))}
                  {effectiveMetricType === "financial" && (
                    <div style={{ marginTop: 6 }}>
                      <SectionLabel>{__('common.currency', 'Currency')}</SectionLabel>
                      <select value={currency} onChange={e => setCurrency(e.target.value)}
                        style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", background: "#fff" }}>
                        {WORLD_CURRENCIES.map(c => <option key={c.symbol} value={c.symbol}>{c.symbol} — {c.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>

                <div>
                  <SectionLabel>{__('common.currentValue', 'Current Value')}</SectionLabel>
                  <input value={rawValue} onChange={e => setRawValue(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Enter number"
                    style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
                  {rawValue && (
                    <div style={{ fontSize: 15, color: "#64748b", marginTop: 4 }}>
                      Preview: <strong style={{ color: "#3B82F6" }}>{previewValue}</strong>
                    </div>
                  )}
                </div>

                <div>
                  <SectionLabel>Connected Apps</SectionLabel>
                  {(initial?.connectedApps ?? []).length === 0
                    ? <div style={{ fontSize: 15, color: "#cbd5e1", fontStyle: "italic" }}>{__('common.noApps', 'No apps connected yet')}</div>
                    : (initial?.connectedApps ?? []).map((a, i) => (
                      <span key={i} style={{ display: "inline-block", background: "#EFF6FF", borderRadius: 8, padding: "3px 8px", fontSize: 15, color: "#3B82F6", marginRight: 4, marginBottom: 3 }}>{a}</span>
                    ))}
                </div>

                {/* Five-Account System */}
                {(() => {
                  let missingAccounts: string[] = [];
                  let groupAlreadyExists = false;
                  if (initial) {
                    const groupId = initial.fiveAccountParentId ?? initial.id;
                    const groupMembers = (siblings ?? []).filter(s =>
                      s.id === groupId || s.fiveAccountParentId === groupId
                    );
                    if (!groupMembers.find(m => m.id === initial.id)) groupMembers.push(initial);
                    const presentLabels = new Set(groupMembers.map(m => m.label));
                    missingAccounts = FIVE_ACCOUNT_LABELS.filter(l => !presentLabels.has(l));
                    groupAlreadyExists = groupMembers.length > 1;
                  }
                  return (
                    <div style={{ background: "#F0FDF4", border: "1px solid #c3e6d4", borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332" }}>{__('common.fiveAccount', 'Five-Account System')}</div>
                          <div style={{ fontSize: 15, color: "#64748b", marginTop: 1 }}>{__('settings.profitFirst', 'Profit First budgeting method')}</div>
                        </div>
                        <Toggle on={fiveOn} onChange={setFiveOn} />
                      </div>
                      {fiveOn && (
                        <>
                          <div style={{ fontSize: 15, color: "#0F6E56", background: "#dcfce7", borderRadius: 6, padding: "8px 10px", marginBottom: 6 }}>
                            <div style={{ fontWeight: 700, marginBottom: 4 }}>✓ Five-Account Math Active</div>
                            {FIVE_EQUATION_POINTS.map((pt, i) => (
                              <div key={i} style={{ marginBottom: 2, lineHeight: 1.4 }}>{pt}</div>
                            ))}
                          </div>

                          {!initial && (
                            <div style={{ fontSize: 15, color: "#92400e", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 6, padding: "5px 10px" }}>
                              ⚠ This will create 4 more metric boxes so all 5 checking accounts are separated out based on your bank balance.
                            </div>
                          )}

                          {initial && missingAccounts.length > 0 && groupAlreadyExists && (
                            <div style={{ fontSize: 15, color: "#92400e", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 6, padding: "8px 10px" }}>
                              <div style={{ marginBottom: 6 }}>
                                ⚠ You're missing the <strong>{missingAccounts.join(", ").replace(/, ([^,]*)$/, " and $1")}</strong> metric box{missingAccounts.length > 1 ? "es" : ""}. Would you like to recreate {missingAccounts.length > 1 ? "them" : "it"}?
                              </div>
                              {onRecreateMissing && (
                                <button
                                  onClick={() => { onRecreateMissing(missingAccounts); onClose(); }}
                                  style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#92400e", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
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
                      }} style={{ padding: "8px 0", borderRadius: 8, border: "1.5px solid", borderColor: initial?.draftEquation ? "#cbd5e1" : initial?.equation ? "#4CAF7D" : "transparent", background: initial?.draftEquation ? "#fff" : initial?.equation ? "#F0FDF4" : "#64748b", color: initial?.draftEquation ? "#94a3b8" : initial?.equation ? "#4CAF7D" : "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
                        {initial?.draftEquation ? "Edit draft equation" : initial?.equation ? "Edit Live Equation" : "Create Equation"}
                      </button>
                      <button onClick={openAddRule} style={{ padding: "8px 0", borderRadius: 8, border: "none", background: "#64748b", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{__('common.createColorRule', 'Create Color Rule')}</button>
                    </div>
                    {equationError && <div style={{ fontSize: 15, color: "#E85D75", marginTop: 4, textAlign: "center" }}>{equationError}</div>}
                    {rules.length > 0 && (
                      <div>
                        <SectionLabel>Active Color Rules</SectionLabel>
                        {rules.map(r => (
                          <div key={r.id} style={{ background: "#F8FAFC", borderRadius: 8, padding: "7px 10px", marginBottom: 6, border: "1px solid #e2e8f0" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                              <div>
                                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 1 }}>
                                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: MS[r.color].bg, display: "inline-block" }} />
                                  <span style={{ fontSize: 15, fontWeight: 600, color: "#1a2332", textTransform: "capitalize" }}>{r.color}</span>
                                </div>
                                <div style={{ fontSize: 15, color: "#64748b" }}>{__('metric.conditionLabel', 'If metric is')} {ruleDesc(r)}</div>
                              </div>
                              <div style={{ display: "flex", gap: 6 }}>
                                <button onClick={() => openEditRule(r)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, color: "#3B82F6", padding: 0 }}>{__('common.edit', 'Edit')}</button>
                                <button onClick={() => removeRule(r.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, color: "#E85D75", padding: 0 }}>✕</button>
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
                  <SectionLabel>{__('common.selectIcon', 'Select Icon')}</SectionLabel>
                  <IconPicker selected={icon} onSelect={setIcon} />
                </div>
                <div>
                  <SectionLabel>{__('metric.graphType', 'Graph Type')}</SectionLabel>
                  {graphTypes.map(([g, l]) => (
                    <label key={g} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 15, color: "#1a2332", marginBottom: 5 }}>
                      <input type="radio" checked={graphType === g} onChange={() => setGraphType(g)} style={{ accentColor: "#3B82F6", margin: 0 }} />{l}
                    </label>
                  ))}
                </div>

                {/* Auto-reset */}
                <div>
                  <SectionLabel>Auto-Reset Metric</SectionLabel>
                  <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 6 }}>Automatically reset this metric to zero on a schedule.</div>
                  {([
                    ["none", "Never (manual only)"],
                    ["daily", "Daily"],
                    ["weekly", "Weekly"],
                    ["monthly", "Monthly"],
                  ] as [ResetFrequency, string][]).map(([f, l]) => (
                    <label key={f} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 15, color: "#1a2332", marginBottom: 5 }}>
                      <input type="radio" checked={resetFreq === f} onChange={() => setResetFreq(f)} style={{ accentColor: "#3B82F6", margin: 0 }} />{l}
                    </label>
                  ))}
                  {resetFreq !== "none" && (
                    <div style={{ background: "#F8FAFC", borderRadius: 8, padding: "8px 10px", border: "1px solid #e2e8f0", marginTop: 6 }}>
                      <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", fontSize: 15, color: "#1a2332" }}>
                        <div>
                          <div style={{ fontWeight: 600 }}>{__('common.recordReset', 'Record reset in history')}</div>
                          <div style={{ fontSize: 15, color: "#64748b" }}>{__('settings.keepPreReset', 'Keep the pre-reset value in the chart history')}</div>
                        </div>
                        <Toggle on={resetKeepHistory} onChange={setResetKeepHistory} />
                      </label>
                      {initial?.lastResetAt && (
                        <div style={{ fontSize: 15, color: "#94a3b8", marginTop: 6, fontStyle: "italic" }}>
                          Last reset: {new Date(initial.lastResetAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          <button onClick={handleSave} style={{ width: "100%", padding: "12px 0", borderRadius: 8, border: "none", marginTop: 20, background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
              Save
            </button>
            {saveError && <div style={{ fontSize: 15, color: "#E85D75", marginTop: 5, textAlign: "center" }}>{saveError}</div>}

            {initial && onDuplicate && (
              <div style={{ textAlign: "center", marginTop: 10 }}>
                <button onClick={() => { onDuplicate(); onClose(); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#3B82F6", fontSize: 15, textDecoration: "underline" }}>
                  Duplicate Metric Box
                </button>
              </div>
            )}

            {(initial || onDelete) && !showDeleteConfirm && (
              <div style={{ textAlign: "center", marginTop: 8 }}>
                <button onClick={() => setShowDeleteConfirm(true)} style={{ background: "none", border: "none", cursor: "pointer", color: "#E85D75", fontSize: 15, textDecoration: "underline" }}>
                  Delete Metric Box
                </button>
              </div>
            )}
            {showDeleteConfirm && (
              <div style={{ marginTop: 10, background: "#FFF5F5", borderRadius: 10, padding: "12px 14px", border: "1px solid #fecaca", textAlign: "center" }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#E85D75", marginBottom: 8 }}>{__('metric.deleteConfirm', 'Are you sure you want to delete this metric box?')}</div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                  <button onClick={() => setShowDeleteConfirm(false)} style={{ padding: "6px 16px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>{__('common.cancel', 'Cancel')}</button>
                  <button onClick={() => { onDelete?.(); }} style={{ padding: "6px 16px", borderRadius: 8, border: "none", background: "#E85D75", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{__('common.yesDelete', 'Yes, Delete')}</button>
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
