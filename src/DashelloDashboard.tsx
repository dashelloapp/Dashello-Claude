import { useState, useRef, useEffect, useLayoutEffect, useCallback, Fragment, lazy, Suspense } from "react";
import { useSmartPosition } from "./hooks/useSmartPosition";
import { supabase } from "./lib/supabase";
import { IntegrationsPage, AppDetailPage, APPS } from "./pages/IntegrationsPage";
const PlaybooksPage = lazy(() => import("./PlaybooksPage").then(m => ({ default: m.PlaybooksPage })));
import { TeamPage } from "./pages/TeamPage";
import { SettingsPage } from "./pages/SettingsPage";
import { EquationBuilderPage } from "./pages/EquationBuilderPage";
import { useTranslation } from "./i18n";
import {
  Section, Goal, Task, Metric, MetricColor, MetricModalData, ColorRule, RuleOp,
  DataPoint, MetricType, GraphType, Page, GoalStep, GoalTarget, GoalStatus, GoalType,
  GoalSubType, GoalAttachedMetric, GoalTrackingMode, GoalNote, GoalTargetType,
  FiveAccountSettings, FiveAccountMode, Org, OrgMember, TeamRow, TeamPermissions,
  OrgPermissionLevel, EquationStep, EquationConfig, Transaction, StatRow, ProjRow,
  NextAction, PostTransactionPrompt, ResetFrequency, HealthResult,
} from "./types";
import { capitalize, resolveColor, getColorForValue, findMetricByLabel, computeMetricHealth, goalBarColor, evaluateGoalStep, computeGoalProgress, makeGoal, formatTarget, calculateHealth, formatValue } from "./utils/helpers";
import { MS, FIVE_DESC, FIVE_EQUATION_POINTS, FIVE_ACCOUNT_LABELS, FIVE_ACCOUNT_ICONS, DEFAULT_FIVE_ACCOUNT_SETTINGS, WORLD_CURRENCIES, ICON_NONE } from "./utils/constants";
import { runFiveAccountEquation, evaluateEquation, formatEquationResult, autoParenthesizeSteps, buildEquationPreviewString, syncSettingsToMetrics, assignStepNumbers, makeModal, makeFiveAccountMetric, applyAccessibilitySettings, INIT_SECTIONS } from "./utils/equations";
import { IconGlyph, Av, Toggle, SectionCard, IconPicker, TxnTable, MetricBlock, EditAddRowModal } from "./components/shared";
import { MetricBoxSettingsModal, AddColorRuleModal } from "./components/MetricSettings";
import { GoalsPage, GoalOnboarding, GoalSettingsModal } from "./pages/GoalsPage";
import { TasksPage } from "./pages/TasksPage";
import { HomePage, DashSection, RowMenu, MobileMenu, HoverAvatar, BreadcrumbNav, AddTeamModal } from "./pages/HomePage";
import DecisionsPage from "./pages/DecisionsPage";

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
  
  // Try the edge function first (if deployed)
  let edgeFunctionFailed = false;
  try {
    const res = await supabase.functions.invoke("invite-member", {
      body: { email, orgId, level, invitedByName, orgName },
    });
    if (res.error) {
      edgeFunctionFailed = true;
    } else {
      return res.data;
    }
  } catch (e) {
    // Edge function not deployed or unavailable — silently continue to signUp
    edgeFunctionFailed = true;
  }
  
  // Edge function not available — use signUp to create user and send confirmation email
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password: crypto.randomUUID() + "Aa1!",
      options: {
        emailRedirectTo: "https://app.dashello.co",
        data: { org_name: orgName || "Dashello", invited_by: invitedByName },
      },
    });
    
    if (error) {
      // If user already exists, send magic link
      if (error.message?.includes("already") || error.message?.includes("registered")) {
        const { error: otpErr } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: "https://app.dashello.co", data: { org_name: orgName || "Dashello", invited_by: invitedByName } },
        });
        if (otpErr) throw new Error(otpErr.message || "Failed to send invite email");
        return { sent: true, method: "magic-link" };
      }
      throw new Error(error.message || "Failed to create user");
    }
    return { sent: true, userId: data.user?.id };
  } catch (signUpErr: any) {
    // If signUp times out or fails, try magic link as final fallback
    if (signUpErr.message?.includes("timeout") || signUpErr.message?.includes("abort") || !signUpErr.message) {
      try {
        const { error: otpErr2 } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: "https://app.dashello.co", data: { org_name: orgName || "Dashello", invited_by: invitedByName } },
        });
        if (!otpErr2) return { sent: true, method: "magic-link" };
      } catch (_) {}
    }
    // Ensure we always throw a meaningful error, never an empty object
    if (typeof signUpErr === "object" && !signUpErr?.message) {
      throw new Error("Failed to invite user. Please check your email configuration in Supabase Auth settings.");
    }
    throw signUpErr;
  }
}

function DashelloLoader({ color = '#fafafa', size = 80 }: { color?: string; size?: number }) {
  const s = size / 321;
  const dots = [
    { w: 16.2*s, h: 15.2*s, ml: 0 },
    { w: 22.9*s, h: 25.2*s, ml: 1*s },
    { w: 28.4*s, h: 34.1*s, ml: 2*s },
  ];
  return (
    <div style={{ display:'flex', alignItems:'flex-end', background:'transparent' }}>
      {dots.map((d, i) => (
        <div key={i} style={{
          width: d.w, height: d.h,
          marginLeft: d.ml,
          borderRadius: '50%',
          background: color,
          transformOrigin: 'bottom center',
          animation: `dashPop${i+1} 2.4s cubic-bezier(0.34,1.56,0.64,1) infinite`,
        }} />
      ))}
    </div>
  );
}

// ─── Permission helpers ──────────────────────────────────────────────────────
function filterSectionsByPermissions(sections: Section[], perms: TeamPermissions): Section[] {
  let filtered = perms.allowedSectionIds === null
    ? sections
    : sections.filter(s => perms.allowedSectionIds!.includes(s.id));
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
// BOTTOM THREE CARDS
// ═══════════════════════════════════════════════════════════════════════════

function BottomThreeCards({ data, metricId, tasks, setTasks, userEmail, orgMembers }: {
  data: MetricModalData; metricId?: string;
  tasks?: Task[]; setTasks?: React.Dispatch<React.SetStateAction<Task[]>>;
  userEmail?: string; orgMembers?: OrgMember[];
}) {
  const { t: __ } = useTranslation();
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
        <div style={{ fontSize: 16, fontWeight: 700, color: "#1a2332", marginBottom: 8 }}>{__('common.projections', 'Projections')}</div>
        <div style={{ fontSize: 15, color: "#94a3b8", fontStyle: "italic", marginBottom: 10 }}>{__('common.comingSoon', 'Coming Soon')}</div>
        {[1, 2, 3].map(i => <div key={i} style={{ height: 8, borderRadius: 99, background: "#e2e8f0", marginBottom: 8, width: `${70 - i * 10}%`, opacity: 0.4 }} />)}
      </SectionCard>
      <SectionCard>
        <div style={{ display: "inline-block", background: "#3B82F6", color: "#fff", borderRadius: 99, padding: "5px 14px", fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{__('common.suggestions', 'Suggestions')}</div>
        <div style={{ fontSize: 15, color: "#94a3b8", fontStyle: "italic", marginBottom: 10 }}>{__('common.comingSoon', 'Coming Soon')}</div>
        {[1, 2, 3].map(i => <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, opacity: 0.4 }}>
          <div style={{ width: 20, height: 20, borderRadius: "50%", border: "1.5px solid #d1d5db", flexShrink: 0 }} />
          <div style={{ height: 7, borderRadius: 99, background: "#e2e8f0", flex: 1 }} />
        </div>)}
      </SectionCard>
      <div style={{ position: "relative" }}>
      <SectionCard>
        <div style={{ display: "inline-block", background: "#3B82F6", color: "#fff", borderRadius: 99, padding: "5px 14px", fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{__('common.nextActions', 'Next Actions')}</div>
        {linkedTasks.length > 0 && <button onClick={() => setExpandMetricActions(true)}
          style={{ position: "absolute", bottom: 4, right: 4, width: 22, height: 22, borderRadius: 4, border: "none", background: "rgba(255,255,255,0.9)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: "#64748b", boxShadow: "0 1px 3px rgba(0,0,0,0.12)" }}
          title="View all next actions">⛶</button>}
        {linkedTasks.map(t => {
          const assigneeMember = (orgMembers || []).find(m => m.email === t.assignedTo);
          return (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, position: "relative" }}>
              <div onClick={() => toggleLinked(t.id)} style={{ width: 18, height: 18, borderRadius: "50%", flexShrink: 0, cursor: "pointer", border: t.done ? "none" : "1.5px solid #d1d5db", background: t.done ? "#4CAF7D" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 15 }}>{t.done ? "✓" : ""}</div>
              <span style={{ fontSize: 15, color: "#1a2332", flex: 1, textDecoration: t.done ? "line-through" : "none", minWidth: 0 }}>{t.text}</span>
              {assigneeMember ? (
                assigneeMember.avatarUrl
                  ? <img src={assigneeMember.avatarUrl} alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                  : <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: "#94a3b8", flexShrink: 0 }}>
                      {(assigneeMember.name?.[0] || assigneeMember.email[0] || "?").toUpperCase()}
                    </div>
              ) : null}
              <div onClick={(e) => { menuTriggerElRef.current = e.currentTarget as HTMLElement; setMenuTaskId(menuTaskId === t.id ? null : t.id); }} style={{ width: 22, height: 22, borderRadius: "50%", background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 15, color: "#94a3b8", flexShrink: 0 }}>···</div>
              {menuTaskId === t.id && (
                <div ref={menuRef} style={{ ...menuPos, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid #e2e8f0", zIndex: 100, minWidth: 150, overflow: "hidden" }}>
                  <div style={{ padding: "7px 12px", fontSize: 15, fontWeight: 600, color: "#64748b", borderBottom: "1px solid #f1f5f9" }}>{__('common.assignTo', 'Assign To')}</div>
                  {(orgMembers || []).filter(m => m.status === "active").map(m => (
                    <div key={m.id} onClick={() => { setTasks?.(prev => prev.map(x => x.id === t.id ? { ...x, assignedTo: m.email } : x)); setMenuTaskId(null); }}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", cursor: "pointer", background: t.assignedTo === m.email ? "#EFF6FF" : "transparent", fontSize: 15, color: "#1a2332" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                      onMouseLeave={e => e.currentTarget.style.background = t.assignedTo === m.email ? "#EFF6FF" : "transparent"}>
                      {m.avatarUrl ? <img src={m.avatarUrl} alt="" style={{ width: 18, height: 18, borderRadius: "50%", objectFit: "cover" }} />
                        : <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: "#94a3b8" }}>{(m.name?.[0] || m.email[0] || "?").toUpperCase()}</div>}
                      <span style={{ flex: 1 }}>{m.name || m.email.split("@")[0]}</span>
                      {t.assignedTo === m.email && <span style={{ fontSize: 15, color: "#3B82F6" }}>✓</span>}
                    </div>
                  ))}
                  <div style={{ borderTop: "1px solid #f1f5f9" }}>
                    <div style={{ padding: "7px 12px", fontSize: 15, fontWeight: 600, color: "#64748b" }}>{__('common.dueDate', 'Due Date')}</div>
                    <div style={{ padding: "0 12px 7px" }}>
                      <input type="date" value={t.dueDate || ""} onChange={e => { setTasks?.(prev => prev.map(x => x.id === t.id ? { ...x, dueDate: e.target.value || undefined } : x)); setMenuTaskId(null); }}
                        style={{ width: "100%", padding: "4px 6px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
                    </div>
                  </div>
                  <div onClick={() => { setTasks?.(prev => prev.filter(x => x.id !== t.id)); setMenuTaskId(null); }}
                    style={{ padding: "8px 12px", fontSize: 15, cursor: "pointer", color: "#E85D75", borderTop: "1px solid #f1f5f9" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#fff5f5"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>{__('common.delete', 'Delete')}</div>
                </div>
              )}
            </div>
          );
        })}
        {showAddAction ? (
          <div style={{ marginTop: 8 }}>
            <input value={actionText} onChange={e => setActionText(e.target.value)} placeholder="New action..."
              onKeyDown={e => { if (e.key === "Enter") handleAddAction(); }}
              style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box", marginBottom: 6 }} />
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <select value={actionAssignee} onChange={e => setActionAssignee(e.target.value)}
                style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", background: "#fff" }}>
                <option value={userEmail}>Me</option>
                {(orgMembers || []).filter(m => m.status === "active" && m.email !== userEmail).map(m => (
                  <option key={m.id} value={m.email}>{m.name || m.email.split("@")[0]}</option>
                ))}
              </select>
              <input type="date" value={actionDueDate} onChange={e => setActionDueDate(e.target.value)}
                style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={handleAddAction} disabled={!actionText.trim()}
                style={{ flex: 1, padding: "5px 14px", borderRadius: 6, border: "none", background: actionText.trim() ? "#3B82F6" : "#e2e8f0", color: "#fff", fontSize: 15, fontWeight: 600, cursor: actionText.trim() ? "pointer" : "not-allowed" }}>{__('common.add', 'Add')}</button>
              <button onClick={() => setShowAddAction(false)} style={{ flex: 1, padding: "5px 14px", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>{__('common.cancel', 'Cancel')}</button>
            </div>
          </div>
        ) : (
          <div onClick={() => setShowAddAction(true)} style={{ fontSize: 15, color: "#3B82F6", cursor: "pointer", fontWeight: 600, marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 15 }}>+</span> Add Task
          </div>
        )}
        {linkedTasks.length === 0 && !showAddAction && <div style={{ fontSize: 15, color: "#cbd5e1", fontStyle: "italic" }}>{__('common.noActions', 'No actions yet')}</div>}
      </SectionCard>
      </div>
      {expandMetricActions && (
        <div onClick={() => setExpandMetricActions(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: "90vw", maxWidth: 600, maxHeight: "90vh", overflow: "auto", position: "relative" }}>
            <button onClick={() => setExpandMetricActions(false)}
              style={{ position: "absolute", top: 12, right: 16, width: 28, height: 28, borderRadius: "50%", border: "none", background: "#f1f5f9", cursor: "pointer", fontSize: 16, color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332", marginBottom: 20 }}>{__('common.nextActions', 'Next Actions')}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {linkedTasks.map(t => {
                const assigneeMember = (orgMembers || []).find(m => m.email === t.assignedTo);
                return (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: "#fff", border: "1px solid #f1f5f9", position: "relative" }}>
                    <div onClick={() => { if (setTasks) setTasks(prev => prev.map(x => x.id === t.id ? { ...x, done: !x.done } : x)); }} style={{ width: 18, height: 18, borderRadius: "50%", flexShrink: 0, cursor: "pointer", border: t.done ? "none" : "1.5px solid #d1d5db", background: t.done ? "#4CAF7D" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 15 }}>{t.done ? "✓" : ""}</div>
                    <span style={{ fontSize: 15, color: "#1a2332", flex: 1, minWidth: 0 }}>{t.text}</span>
                    {assigneeMember && (
                      assigneeMember.avatarUrl
                        ? <img src={assigneeMember.avatarUrl} alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                        : <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: "#94a3b8", flexShrink: 0 }}>
                            {(assigneeMember.name?.[0] || assigneeMember.email[0] || "?").toUpperCase()}
                          </div>
                    )}
                    <div onClick={(e) => { menuTriggerElRef.current = e.currentTarget as HTMLElement; setMenuTaskId(menuTaskId === t.id ? null : t.id); }} style={{ width: 22, height: 22, borderRadius: "50%", background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 15, color: "#94a3b8", flexShrink: 0 }}>···</div>
                    {menuTaskId === t.id && (
                      <div ref={menuRef} style={{ ...menuPos, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid #e2e8f0", zIndex: 100, minWidth: 150, overflow: "hidden" }}>
                        <div style={{ padding: "7px 12px", fontSize: 15, fontWeight: 600, color: "#64748b", borderBottom: "1px solid #f1f5f9" }}>{__('common.assignTo', 'Assign To')}</div>
                        {(orgMembers || []).filter(m => m.status === "active").map(m => (
                          <div key={m.id} onClick={() => { setTasks?.(prev => prev.map(x => x.id === t.id ? { ...x, assignedTo: m.email } : x)); setMenuTaskId(null); }}
                            style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", cursor: "pointer", background: t.assignedTo === m.email ? "#EFF6FF" : "transparent", fontSize: 15, color: "#1a2332" }}
                            onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                            onMouseLeave={e => e.currentTarget.style.background = t.assignedTo === m.email ? "#EFF6FF" : "transparent"}>
                            {m.avatarUrl ? <img src={m.avatarUrl} alt="" style={{ width: 18, height: 18, borderRadius: "50%", objectFit: "cover" }} />
                              : <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: "#94a3b8" }}>{(m.name?.[0] || m.email[0] || "?").toUpperCase()}</div>}
                            <span style={{ flex: 1 }}>{m.name || m.email.split("@")[0]}</span>
                            {t.assignedTo === m.email && <span style={{ fontSize: 15, color: "#3B82F6" }}>✓</span>}
                          </div>
                        ))}
                        <div style={{ borderTop: "1px solid #f1f5f9" }}>
                          <div style={{ padding: "7px 12px", fontSize: 15, fontWeight: 600, color: "#64748b" }}>{__('common.dueDate', 'Due Date')}</div>
                          <div style={{ padding: "0 12px 7px" }}>
                            <input type="date" value={t.dueDate || ""} onChange={e => { setTasks?.(prev => prev.map(x => x.id === t.id ? { ...x, dueDate: e.target.value || undefined } : x)); setMenuTaskId(null); }}
                              style={{ width: "100%", padding: "4px 6px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
                          </div>
                        </div>
                        <div onClick={() => { setTasks?.(prev => prev.filter(x => x.id !== t.id)); setMenuTaskId(null); }}
                          style={{ padding: "8px 12px", fontSize: 15, cursor: "pointer", color: "#E85D75", borderTop: "1px solid #f1f5f9" }}
                          onMouseEnter={e => e.currentTarget.style.background = "#fff5f5"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>{__('common.delete', 'Delete')}</div>
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
                  style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box", marginBottom: 6 }} />
                <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  <select value={actionAssignee} onChange={e => setActionAssignee(e.target.value)}
                    style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", background: "#fff" }}>
                    <option value={userEmail}>Me</option>
                    {(orgMembers || []).filter(m => m.status === "active" && m.email !== userEmail).map(m => (
                      <option key={m.id} value={m.email}>{m.name || m.email.split("@")[0]}</option>
                    ))}
                  </select>
                  <input type="date" value={actionDueDate} onChange={e => setActionDueDate(e.target.value)}
                    style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={handleAddAction} disabled={!actionText.trim()}
                    style={{ flex: 1, padding: "5px 14px", borderRadius: 6, border: "none", background: actionText.trim() ? "#3B82F6" : "#e2e8f0", color: "#fff", fontSize: 15, fontWeight: 600, cursor: actionText.trim() ? "pointer" : "not-allowed" }}>{__('common.add', 'Add')}</button>
                  <button onClick={() => setShowAddAction(false)} style={{ flex: 1, padding: "5px 14px", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>{__('common.cancel', 'Cancel')}</button>
                </div>
              </div>
            ) : (
              <div onClick={() => setShowAddAction(true)} style={{ fontSize: 15, color: "#3B82F6", cursor: "pointer", fontWeight: 600, marginTop: 12, display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 15 }}>+</span> Add Task
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
  const { t: __ } = useTranslation();
  const [tooltip, setTooltip] = useState<{ x: number; y: number; val: number; color: MetricColor } | null>(null);

  // Insufficient data state — need at least 5 historic data points
  if (!history || history.length < 5) {
    const needed = 5 - (history?.length ?? 0);
    return (
      <div style={{
        height: 150, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        background: "#F8FAFC", border: "1.5px dashed #e2e8f0", borderRadius: 10, padding: 12, gap: 6
      }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#94a3b8" }}>{__('common.insufficientData', 'Insufficient Data')}</div>
        <div style={{ fontSize: 15, color: "#cbd5e1", textAlign: "center", lineHeight: 1.4 }}>
          {needed} more data point{needed === 1 ? "" : "s"} needed<br/>
          <span style={{ fontSize: 15 }}>({history?.length ?? 0} of 5 recorded)</span>
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
              <text x={149} y={28 + i * 22} fontSize={9} fill="#64748b">{__('common.point', 'Point')} {Math.round(s.pct * 100)}%</text>
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
  const { t: __ } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <div style={{ position: "relative" }}>
        <MetricChart history={history} rules={rules} graphType={graphType} currentValue={currentValue} />
        <button onClick={() => setExpanded(true)}
          style={{ position: "absolute", bottom: 4, right: 4, width: 22, height: 22, borderRadius: 4, border: "none", background: "rgba(255,255,255,0.9)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: "#64748b", boxShadow: "0 1px 3px rgba(0,0,0,0.12)" }}
          title="Expand graph">⛶</button>
      </div>
      {expanded && <GraphExpandPopUp {...{ history, rules, graphType, currentValue, onClose: () => setExpanded(false) }} />}
    </>
  );
}

function GraphExpandPopUp({ history, rules, graphType, currentValue, onClose }: {
  history: DataPoint[]; rules: ColorRule[]; graphType: GraphType; currentValue: string; onClose: () => void;
}) {
  const { t: __ } = useTranslation();
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: "90vw", maxWidth: 720, maxHeight: "90vh", overflow: "auto", position: "relative" }}>
        <button onClick={onClose}
          style={{ position: "absolute", top: 12, right: 16, width: 28, height: 28, borderRadius: "50%", border: "none", background: "#f1f5f9", cursor: "pointer", fontSize: 16, color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332", marginBottom: 20 }}>{__('metric.graphDetail', 'Graph Detail')}</div>
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
  const { t: __ } = useTranslation();
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
          <div style={{ fontSize: 15, fontWeight: 700, color: "#0F6E56", marginBottom: 3 }}>
            Five-Account Overflow
          </div>
          <div style={{ fontSize: 15, color: "#0F6E56", lineHeight: 1.5, marginBottom: 10 }}>
            This account is <strong>{fmtVal(overflowAmount)}</strong> over your target. Move the excess to stay balanced?
          </div>
          
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {!isProfit && (
              <select 
                value={selectedDestId} 
                onChange={(e) => setSelectedDestId(e.target.value)}
                style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #4CAF7D", fontSize: 15 }}
              >
                <option value="">{__('common.selectAccount', 'Select Account...')}</option>
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
                fontSize: 15, fontWeight: 700, cursor: selectedDestId ? "pointer" : "not-allowed", color: "#fff"
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
  const { t: __ } = useTranslation();
  return (
    <div style={{ background: "#FFF5F5", border: "1.5px solid #E85D75", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#E85D75", marginBottom: 4 }}>⚠ Out of Sync</div>
      <div style={{ fontSize: 15, color: "#475569", marginBottom: 8, lineHeight: 1.4 }}>{metric?.outOfSyncReason ?? "This metric may not reflect the current bank balance."}</div>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={onResyncCurrent} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#E85D75", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{__('common.acceptCurrent', 'Accept current')}</button>
        <button onClick={onResyncPrevious} style={{ padding: "5px 12px", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 15, fontWeight: 500, cursor: "pointer" }}>{__('common.revertSynced', 'Revert to last synced')}</button>
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
        <span style={{ fontSize: 15, color: "#94a3b8", fontStyle: "italic" }}>
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
          <span style={{ color: "#4CAF7D", fontSize: 15, fontWeight: 700 }}>✓</span>
        ) : (
          <span style={{ display: "inline-block", fontSize: 15, color: "#94a3b8", animation: state === "spinning" ? "spin 0.7s linear infinite" : "none" }}>↻</span>
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
        cursor: "pointer", fontSize: 15, fontWeight: 500,
        color: state === "done" ? "#4CAF7D" : "#64748b",
        transition: "all 0.2s"
      }}>
        <span style={{ display: "inline-block", fontSize: isMobile ? 16 : 13, animation: state === "spinning" ? "spin 0.7s linear infinite" : "none" }}>
          {state === "done" ? "✓" : "↻"}
        </span>
        {!isMobile && (state === "done" ? "Synced" : "Refresh Data")}
      </button>
      {!isMobile && displaySynced && (
        <span style={{ fontSize: 15, color: "#94a3b8", fontStyle: "italic" }}>
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
            fontSize: 15, fontWeight: 600, cursor: "pointer",
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
                fontSize: 15, fontWeight: 600, cursor: "pointer", textTransform: "capitalize"
              }}>{t === "credit" ? "＋ Credit" : "－ Debit"}</button>
            ))}
          </div>
          {/* Amount */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 15, color: "#64748b", flexShrink: 0 }}>{currencySymbol}</span>
            <input
              value={txnAmount}
              onChange={e => setTxnAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              onKeyDown={e => { if (e.key === "Enter") handlePost(); }}
              placeholder="Amount"
              autoFocus
              style={{ flex: 1, padding: "7px 10px", borderRadius: 7, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" as const, color: "#1a2332", background: "#f8fafc" }}
            />
          </div>
          {/* Description */}
          <input
            value={txnDesc}
            onChange={e => setTxnDesc(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handlePost(); }}
            placeholder="Description (e.g. monthly deposit)"
            style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" as const, marginBottom: 8, color: "#1a2332", background: "#f8fafc" }}
          />
          {/* Transfer-to option (optional) — only shown if there are other Five-Account boxes */}
          {transferTargets.length > 0 && (
            <div style={{ marginBottom: 8, padding: "8px 10px", background: "#F0FDF4", border: "1px solid #c3e6d4", borderRadius: 7 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0F6E56", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                Transfer to (optional)
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 15, color: "#64748b" }}>
                  <input type="checkbox" checked={transferToId === ""} onChange={() => setTransferToId("")}
                    style={{ accentColor: "#0F6E56", margin: 0 }} />
                  None
                </label>
                {transferTargets.map(t => (
                  <label key={t.id} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 15, color: "#1a2332" }}>
                    <input type="checkbox" checked={transferToId === t.id}
                      onChange={() => setTransferToId(transferToId === t.id ? "" : t.id)}
                      style={{ accentColor: "#0F6E56", margin: 0 }} />
                    {t.label}
                  </label>
                ))}
              </div>
              {transferToId && (
                <div style={{ fontSize: 15, color: "#0F6E56", marginTop: 6, fontStyle: "italic" }}>
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
              <div style={{ fontSize: 15, color: "#64748b", marginBottom: 8, padding: "5px 8px", background: "#f1f5f9", borderRadius: 6 }}>
                {fmt(cur)} → <strong style={{ color: txnType === "credit" ? "#4CAF7D" : "#E85D75" }}>{fmt(next)}</strong>
              </div>
            );
          })()}
          {/* Buttons */}
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={handleCancel} style={{ flex: 1, padding: "7px 0", borderRadius: 7, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>
              Cancel
            </button>
            <button onClick={handlePost} disabled={!txnDesc.trim() || !txnAmount || parseFloat(txnAmount) <= 0}
              style={{ flex: 2, padding: "7px 0", borderRadius: 7, border: "none", fontSize: 15, fontWeight: 600, cursor: txnDesc.trim() && txnAmount ? "pointer" : "not-allowed", background: txnDesc.trim() && txnAmount && parseFloat(txnAmount) > 0 ? "linear-gradient(135deg,#3B82F6,#06B6D4)" : "#e2e8f0", color: txnDesc.trim() && txnAmount && parseFloat(txnAmount) > 0 ? "#fff" : "#94a3b8" }}>
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
  const { t: __ } = useTranslation();
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
      padding: "8px 20px", fontSize: 15, fontWeight: 600, cursor: "pointer"
    }}>{__('common.editSettings', 'Edit Settings')}</button>
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
      <div style={{ fontSize: 15, fontWeight: 700, color: "#0F6E56", marginBottom: 2 }}>{__('common.fiveAccount', 'Five-Account System')} — {data.accountType.toUpperCase()}</div>
      <div style={{ fontSize: 15, color: "#475569", lineHeight: 1.4 }}>{FIVE_DESC[data.accountType]}</div>
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
            <div style={{ fontSize: 15, fontWeight: 700, color: isFull ? "#065F46" : "#64748B" }}>
              {isFull ? "THRESHOLD REACHED" : "THRESHOLD ACTIVE"}
            </div>
            <div style={{ fontSize: 15, color: isFull ? "#047857" : "#94A3B8" }}>
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
          ? <><div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332", marginBottom: 6 }}>{__('common.health', 'Health')} — <strong>{data.healthPct}%</strong></div>
            <div style={{ height: 28, borderRadius: 99, background: "#e5e7eb", maxWidth: 260, overflow: "hidden", marginBottom: 20 }}>
              <div style={{ width: `${data.healthPct}%`, height: "100%", borderRadius: 99, background: accent }} /></div></>
          : <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332", marginBottom: 6 }}>{__('common.healthNA', 'Health — N/A')}</div>
            <button style={{ padding: "6px 18px", borderRadius: 99, border: "1.5px solid #d1d5db", background: "#fff", fontSize: 15, cursor: "pointer" }}>{__('common.setAGoal', 'Set A Goal')}</button>
          </div>}

        {/* Balance + transactions */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ background: accent, borderRadius: "12px 12px 0 0", padding: "18px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, color: statTextColor, marginBottom: 4 }}>{__('common.balance', 'Balance')}</div>
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
                    <div style={{ fontSize: 15, color: isColored ? "rgba(255,255,255,0.85)" : "#475569", marginTop: 6, fontWeight: 500 }}>
                      Actual bank account balance: <strong>{formatted}</strong>
                    </div>
                  );
                })()}
                <div style={{ fontSize: 15, color: isColored ? "#fff" : "#94a3b8", marginTop: 4, fontWeight: isColored ? 500 : 400 }}>
                  {metric?.lastSyncedAt ? `Synced ${new Date(metric.lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
                </div>
              </div>
              <button style={{ background: "#fff", border: "none", borderRadius: 20, padding: "5px 14px", fontSize: 15, cursor: "pointer", fontWeight: 600, flexShrink: 0, marginLeft: 14, color: "#1a2332" }}>{__('common.filter', 'Filter')}</button>
            </div>
          </div>
          <TxnTable transactions={liveTxns} />
        </div>

        {/* Chart */}
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 14px", marginBottom: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332", marginBottom: 8 }}>{__('common.history', 'History')}</div>
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
        <p style={{ textAlign: "center", fontSize: 15, marginBottom: 24, color: "#64748b" }}>{__('goal.healthGoal', 'Health Goal')} — <strong style={{ color: "#1a2332" }}>{data.healthPct ?? "N/A"}{data.healthPct != null ? "%" : ""}</strong></p>
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
          <span style={{ fontSize: 15, fontStyle: "italic", color: "#94a3b8" }}>
            {metric?.lastSyncedAt ? `Synced ${new Date(metric.lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
          <SectionCard>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332", marginBottom: 10 }}>{__('common.details', 'Details')}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px" }}>
              {data.stats.map((s, i) => <div key={i}>
                <div style={{ fontSize: 15, color: "#94a3b8" }}>{s.label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332" }}>{s.value}</div>
              </div>)}
            </div>
          </SectionCard>
          <SectionCard>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332", marginBottom: 6 }}>{__('common.history', 'History')}</div>
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
          ? <><div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332", marginBottom: 6 }}>{__('common.health', 'Health')} — <strong>{data.healthPct}%</strong></div>
            <div style={{ height: 28, borderRadius: 99, background: "#e5e7eb", maxWidth: 260, overflow: "hidden", marginBottom: 20 }}>
              <div style={{ width: `${data.healthPct}%`, height: "100%", borderRadius: 99, background: accent }} /></div></>
          : <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332", marginBottom: 6 }}>{__('common.healthNA', 'Health — N/A')}</div>
            <button style={{ padding: "6px 18px", borderRadius: 99, border: "1.5px solid #d1d5db", background: "#fff", fontSize: 15, cursor: "pointer" }}>{__('common.setAGoal', 'Set A Goal')}</button>
          </div>}
        <div style={{ background: accent, borderRadius: 16, padding: "18px 20px", marginBottom: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 15, color: statTextColor }}>Amount</div>
              {metric?.lastSyncedAt && <div style={{ fontSize: 15, color: isColored ? "rgba(255,255,255,0.5)" : "#94a3b8" }}>Synced {new Date(metric.lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>}
            </div>
            <button style={{ background: "#fff", border: "none", borderRadius: 20, padding: "3px 12px", fontSize: 15, cursor: "pointer", fontWeight: 600, color: "#1a2332" }}>{__('common.filter', 'Filter')}</button>
          </div>
          <CashBalanceInput value={data.mainValue} currencySymbol={metric?.currencySymbol ?? "$"}
            statValColor={statValColor} statTextColor={statTextColor} isColored={isColored}
            onValueChange={onValueChange} siblings={siblings} currentMetricId={metric?.id}
            onTransfer={onTransfer} />
          {data.stats.map((s, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 15, color: statTextColor }}>{s.label}</span>
                {s.synced && metric?.lastSyncedAt && <span style={{ fontSize: 15, color: isColored ? "rgba(255,255,255,0.5)" : "#94a3b8" }}>Synced {new Date(metric.lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: statValColor }}>{s.value}</div>
            </div>
          ))}
        </div>
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332", marginBottom: 6 }}>{__('common.transactionHistory', 'Transaction History')}</div>
          <TxnTable transactions={txns} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 22, marginBottom: 26 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332", marginBottom: 8 }}>{__('common.manualAdjust', 'Manually Adjust Metric')}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <button onClick={() => handleIncrement(-1)} style={{ width: 30, height: 30, borderRadius: "50%", border: "1.5px solid #d1d5db", background: "none", fontSize: 18, cursor: "pointer", color: "#9CA3AF" }}>−</button>
              <div>
                {isEditingValue
                  ? <input value={localValue} onChange={e => setLocalValue(e.target.value)} onBlur={handleValueSave} onKeyDown={e => { if (e.key === "Enter") handleValueSave(); }} autoFocus
                    style={{ fontSize: 26, fontWeight: 700, color: "#1a2332", border: "none", borderBottom: "2px solid #3B82F6", outline: "none", width: 130, background: "transparent" }} />
                  : <div onClick={() => setIsEditingValue(true)} style={{ fontSize: 26, fontWeight: 700, color: "#1a2332", cursor: "text" }} title="Click to edit">{localValue}</div>}
                {metric?.lastSyncedAt
                  ? <div style={{ fontSize: 15, color: "#94a3b8", fontStyle: "italic" }}>{`Synced ${new Date(metric.lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}</div>
                  : null
                }
              </div>
              <button onClick={() => handleIncrement(1)} style={{ width: 30, height: 30, borderRadius: "50%", border: "1.5px solid #d1d5db", background: "none", fontSize: 18, cursor: "pointer", color: "#9CA3AF" }}>+</button>
            </div>
            {metric?.equation && metric.equation.steps.length > 0 && (
              metric?.outOfSync ? (
                <div style={{ background: "#FFF5F5", border: "1.5px solid #E85D75", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#E85D75", marginBottom: 4 }}>⚠ Out of Sync</div>
                  <div style={{ fontSize: 15, color: "#475569", marginBottom: 8, lineHeight: 1.4 }}>{__('equation.valueManual', 'Value was manually edited and may not match equation output.')}</div>
                  <button onClick={onResyncEquation} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#E85D75", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{__('common.resyncEquation', 'Re-sync with equation')}</button>
                </div>
              ) : (
                <div style={{ background: "#F0FDF4", border: "1px solid #c3e6d4", borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#0F6E56", marginBottom: 4 }}>= Equation Active</div>
                  <div style={{ fontSize: 15, color: "#1a2332", marginBottom: 6 }}>
                    {buildEquationPreviewString(metric.equation.steps, [metric]) || "Equation set"}
                  </div>
                  <div style={{ fontSize: 15, color: "#64748b" }}>This value is automatically computed. Edit the equation in metric settings.</div>
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
// CHAT PANEL
// ═══════════════════════════════════════════════════════════════════════════

function ChatPanel({ sections, onClose, isMobile }: { sections: Section[]; onClose: () => void; isMobile?: boolean }) {
  const { t: __ } = useTranslation();
  const channels = ["General", ...sections.map(s => s.title)];
  const [active, setActive] = useState("General");
  const msgs: Record<string, { name: string; time: string; text: string }[]> = {
    General: [{ name: "Julia", time: "14:27", text: "Sounds good @Bryan." }, { name: "Bryan", time: "14:23", text: "Thanks @Julia. When can you have it transferred over by?" }],
  };
  const display = msgs[active] ?? msgs["General"];
  return (
    <div style={{ position: "fixed", right: 0, top: 0, bottom: 0, width: isMobile ? "100vw" : "clamp(260px,28vw,340px)", background: "#fff", boxShadow: "-4px 0 32px rgba(0,0,0,0.1)", zIndex: 1500, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332" }}>{__('common.chat', 'Chat')}</div>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>×</button>
      </div>
      <div style={{ display: "flex", gap: 4, padding: "6px 10px", borderBottom: "1px solid #f1f5f9", overflowX: "auto" }}>
        {channels.map(ch => (
          <button key={ch} onClick={() => setActive(ch)} style={{ padding: "3px 9px", borderRadius: 20, fontSize: 15, fontWeight: 500, border: "none", cursor: "pointer", flexShrink: 0, background: active === ch ? "#3B82F6" : "#f1f5f9", color: active === ch ? "#fff" : "#64748b" }}>{ch}</button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "14px" }}>
        {display.map((m, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "flex-start" }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#4C9FE8", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 600, color: "#fff" }}>{m.name[0]}</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332", marginBottom: 1 }}>{m.name} <span style={{ color: "#94a3b8", fontWeight: 400 }}>{m.time}</span></div>
              <div style={{ fontSize: 15, color: "#475569", lineHeight: 1.5 }}>{m.text}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ padding: "10px 14px", borderTop: "1px solid #f1f5f9" }}>
        <input placeholder="Type Response..." style={{ width: "100%", padding: "8px 14px", borderRadius: 99, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box", background: "#f8fafc" }} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SIDEBAR
// ═══════════════════════════════════════════════════════════════════════════

function Sidebar({ active, onNav, onClose, isMobile, avatarUrl, firstName, health, activeOrg, orgs, showOrgDropdown, onToggleOrgDropdown, onSwitchOrg, onAddNewOrg, onRenameOrg, onDeleteOrg, currentUserLevel, onOpenInviteModal, menuPermissions, tasks, setTasks, orgMembers, userEmail }: {
  active: Page; onNav: (p: Page) => void; onClose: () => void;
  isMobile: boolean; avatarUrl?: string; firstName?: string;
  health: HealthResult;
  activeOrg: Org | null; orgs: Org[]; showOrgDropdown: boolean;
  onToggleOrgDropdown: () => void; onSwitchOrg: (org: Org) => void; onAddNewOrg: () => void;
  onRenameOrg: (org: Org) => void; onDeleteOrg: (org: Org) => void;
  currentUserLevel: OrgPermissionLevel; onOpenInviteModal: () => void;
  menuPermissions: Record<string, string[]>;
  tasks: Task[]; setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  orgMembers: OrgMember[]; userEmail: string;
}) {
  const { t: __ } = useTranslation();
  const orgDropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (orgDropdownRef.current && !orgDropdownRef.current.contains(e.target as Node)) { if (showOrgDropdown) onToggleOrgDropdown(); } };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, [showOrgDropdown, onToggleOrgDropdown]);

  const pc = ({ green: { bg: "#F0FDF4", border: "#4CAF7D", accent: "#4CAF7D" }, yellow: { bg: "#FFF8ED", border: "#F5A623", accent: "#F5A623" }, red: { bg: "#FEF2F2", border: "#E85D75", accent: "#E85D75" }, gray: { bg: "#FFF8ED", border: "#F5A623", accent: "#F5A623" } } as Record<string, { bg: string; border: string; accent: string }>)[health?.barColor || "yellow"]!;
  const hiddenItems = currentUserLevel === "owner" ? [] : (menuPermissions[currentUserLevel] || []);
  const NAV = [
    { icon: "House", label: "Home", page: "home" as Page },
    { icon: "Target", label: "Goals", page: "goals" as Page },
    { icon: "Funnel", label: "Decisions", page: "decisions" as Page },
    { icon: "CheckSquare", label: "Tasks", page: "tasks" as Page },
    { icon: "Notebook", label: "Playbooks", page: "playbooks" as Page },
    { icon: "Plugs", label: "Integrations", page: "integrations" as Page, comingSoon: true },
    { icon: "Users", label: "Team", page: "team" as Page },
    { icon: "Gear", label: "Settings", page: "settings" as Page },
  ];
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
  const sidebarPriorityList = mySidebarTasks.filter(t => t.priority && !t.done);
  const sidebarRegularList = mySidebarTasks.filter(t => !t.priority && !t.done).slice(0, 5);
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
          {!isMobile && <div onClick={onClose} style={{ position: "absolute", right: 0, width: 26, height: 26, borderRadius: "50%", border: "1.5px solid rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", fontSize: 15 }}>‹</div>}
        </div>
        <div style={{ textAlign: "center", width: "100%" }}>
          <div style={{ fontSize: 15, fontWeight: 400, color: "#fff" }}>{firstName ? `${__('common.welcome', 'Welcome')} ${firstName}` : __('common.welcome', 'Welcome')}</div>
          <div ref={orgDropdownRef} style={{ position: "relative", display: "inline-block", marginTop: 2 }}>
            <div onClick={onToggleOrgDropdown} style={{ fontSize: 15, fontWeight: 400, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4, opacity: 0.85 }}>
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 }}>{__('nav.to', 'to')} {activeOrg?.isPersonal ? __('nav.yourDashboard', 'your dashboard') : activeOrg?.name}</span>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, transform: showOrgDropdown ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
                <path d="M2 4L5 7L8 4" stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            {showOrgDropdown && (
                <div style={{ position: "absolute", top: 28, left: "50%", transform: "translateX(-50%)", zIndex: 110, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.15)", border: "1px solid #e2e8f0", minWidth: 180, overflow: "hidden" }}>
                  {orgs.map(org => (
                    <div key={org.id} style={{ display: "flex", alignItems: "center", padding: "8px 14px", borderBottom: "1px solid #f1f5f9" }}>
                      <div onClick={() => onSwitchOrg(org)}
                        style={{ flex: 1, fontSize: 15, cursor: "pointer", color: activeOrg?.id === org.id ? "#3B82F6" : "#1a2332", fontWeight: activeOrg?.id === org.id ? 600 : 400, textAlign: "left" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                        {org.name}
                      </div>
                      {!org.isPersonal && (
                        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                          <div onClick={(e) => { e.stopPropagation(); onRenameOrg(org); }}
                            style={{ width: 24, height: 24, borderRadius: 4, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#94a3b8" }} title="Rename">✎</div>
                          <div onClick={(e) => { e.stopPropagation(); onDeleteOrg(org); }}
                            style={{ width: 24, height: 24, borderRadius: 4, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#E85D75" }} title="Delete">✕</div>
                        </div>
                      )}
                    </div>
                  ))}
                  <div onClick={onAddNewOrg}
                    style={{ padding: "10px 14px", fontSize: 15, cursor: "pointer", color: "#3B82F6", fontWeight: 500, borderTop: "1px solid #f1f5f9", textAlign: "left" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                    + Add New
                  </div>
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
                color: "#fff", fontSize: 15, fontWeight: isActive ? 600 : 400,
                transition: "all 0.15s", opacity: item.comingSoon ? 0.55 : 1 }}>
              <IconGlyph name={item.icon} size={21} color="#fff" />
              <span style={{ whiteSpace: "nowrap" }}>{__('nav.' + item.page, item.label)}</span>
              {item.comingSoon && <span style={{ fontSize: 15, padding: "1px 6px", borderRadius: 99, background: "rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.7)", marginLeft: "auto", whiteSpace: "nowrap" }}>{__('common.soon', 'Soon')}</span>}
            </div>
          );
        })}
      </nav>
      {/* ── Health Progress ── */}
      {health.hasData && (() => {
        const barColors = { green: "#4CAF7D", yellow: "#F5A623", red: "#E85D75" };
        return (
          <div style={{ padding: "0 18px 8px" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.7)", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{__('common.health', 'Health')}</span>
              <span style={{ color: "#fff", fontWeight: 700 }}>{health.score}%</span>
            </div>
            <div style={{ width: "100%", height: 24, background: "#fff", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ width: `${health.score}%`, height: "100%", background: barColors[health.barColor], borderRadius: 99, transition: "width 400ms ease, background 300ms ease" }} />
            </div>
            <div style={{ fontSize: 15, color: "rgba(255,255,255,0.6)", marginTop: 4, textAlign: "center" }}>
              {health.counts.green}G · {health.counts.yellow}Y · {health.counts.red}R
              {health.counts.gray > 0 ? ` · ${health.counts.gray} unmatched` : ""}
            </div>
          </div>
        );
      })()}
      {/* ── Sidebar Tasks Widget ── */}
      <div style={{ background: "#fff", borderRadius: 12, margin: "8px 12px 4px", padding: "12px 14px" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332", marginBottom: 8 }}>{__('common.yourTasks', 'Your Tasks')}</div>
        <div style={{ height: 6, borderRadius: 99, background: "#e2e8f0", marginBottom: 10, overflow: "hidden" }}>
          <div style={{ width: `${sidebarPct}%`, height: "100%", borderRadius: 99, background: "#4CAF7D", transition: "width 0.3s" }} />
        </div>
        {sidebarPriorityList.map(t => (
          <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px", cursor: "pointer", background: pc.bg, borderRadius: 6, marginBottom: 2 }}
            onClick={() => sidebarToggle(t.id)}>
            <div style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0, border: t.done ? "none" : `1.5px solid ${pc.accent}`, background: t.done ? "#4CAF7D" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 15 }}>{t.done ? "✓" : ""}</div>
            <span style={{ fontSize: 15, color: "#1a2332", flex: 1, fontWeight: 600, textDecoration: t.done ? "line-through" : "none", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.text}</span>
          </div>
        ))}
        {sidebarRegularList.map(t => (
          <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0", cursor: "pointer" }}
            onClick={() => sidebarToggle(t.id)}>
            <div style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0, border: t.done ? "none" : "1.5px solid #d1d5db", background: t.done ? "#4CAF7D" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 15 }}>{t.done ? "✓" : ""}</div>
            <span style={{ fontSize: 15, color: "#1a2332", flex: 1, textDecoration: t.done ? "line-through" : "none", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.text}</span>
          </div>
        ))}
        <div onClick={() => onNav("tasks")} style={{ fontSize: 15, color: "#3B82F6", cursor: "pointer", fontWeight: 600, marginTop: 6, marginBottom: 8 }}>{__('common.viewAll', 'View all →')}</div>

        {sidebarShowAdd ? (
          <div>
            <input value={sidebarAddText} onChange={e => setSidebarAddText(e.target.value)}
              placeholder="New task..." autoFocus
              onKeyDown={e => { if (e.key === "Enter") sidebarAddTask(); }}
              style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box", marginBottom: 4 }} />
            <label style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 15, color: sidebarAddPriority ? "#F5A623" : "#94a3b8", cursor: "pointer", marginBottom: 4, alignSelf: "flex-start" }}>
              <input type="checkbox" checked={sidebarAddPriority} onChange={e => setSidebarAddPriority(e.target.checked)} style={{ accentColor: "#F5A623", margin: 0, width: 12, height: 12 }} />
              {sidebarAddPriority ? "" : __('sidebar.makePriority', 'Make priority?')}
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 4 }}>
              <select value={sidebarAddAssignee} onChange={e => setSidebarAddAssignee(e.target.value)}
                style={{ width: "100%", padding: "4px 6px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", background: "#fff", boxSizing: "border-box" }}>
                <option value={userEmail}>Me</option>
                {orgMembers.filter(m => m.status === "active" && m.email !== userEmail).map(m => (
                  <option key={m.id} value={m.email}>{m.name || m.email.split("@")[0]}</option>
                ))}
              </select>
              <input type="date" value={sidebarAddDueDate} onChange={e => setSidebarAddDueDate(e.target.value)}
                style={{ width: "100%", padding: "4px 6px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={sidebarAddTask} disabled={!sidebarAddText.trim()}
                style={{ flex: 1, padding: "4px 0", borderRadius: 6, border: "none", background: sidebarAddText.trim() ? "#3B82F6" : "#e2e8f0", color: "#fff", fontSize: 15, fontWeight: 600, cursor: sidebarAddText.trim() ? "pointer" : "not-allowed" }}>{__('common.add', 'Add')}</button>
              <button onClick={() => setSidebarShowAdd(false)} style={{ flex: 1, padding: "4px 0", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>{__('common.cancel', 'Cancel')}</button>
            </div>
          </div>
        ) : (
          <div onClick={() => setSidebarShowAdd(true)} style={{ fontSize: 15, color: "#3B82F6", cursor: "pointer", fontWeight: 600, display: "flex", alignItems: "center", gap: 3 }}>
            <span style={{ fontSize: 15 }}>+</span> {__('sidebar.addNewTask', 'Add New Task')}
          </div>
        )}
      </div>
      <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <img src="https://dashello.co/wp-content/uploads/2023/08/White-Logo-Full.png" alt="Dashello" style={{ height: 26, objectFit: "contain", maxWidth: "80%" }} />
        {(currentUserLevel === "owner" || currentUserLevel === "admin") && (
          <button onClick={onOpenInviteModal} style={{ width: "100%", padding: "10px 0", borderRadius: 12, border: "none", background: "#fff", color: "#3B82F6", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Invite +</button>
        )}
        <button onClick={() => supabase.auth.signOut()} style={{ width: "100%", padding: "10px 0", borderRadius: 12, border: "2px solid rgba(255,255,255,0.6)", background: "transparent", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{__('sidebar.signOut', 'Sign Out')}</button>
      </div>
      </div>
    </aside>
  );
}

export default function DashelloDashboard() {
  const { t: __ } = useTranslation();
  const [page, setPage] = useState<Page>(() => (localStorage.getItem("dashello_page") as Page) || "home");
  const [sections, setSections] = useState<Section[]>([]);
  const [activeModal, setActiveModal] = useState<{ data: MetricModalData; metric: Metric } | null>(null);
  useEffect(() => { localStorage.setItem("dashello_page", page); }, [page]);
  useEffect(() => {
    const hdr = parseInt(localStorage.getItem("acc_header_size") || "30") || 30;
    const body = parseInt(localStorage.getItem("acc_min_body") || "15") || 15;
    const sub = parseInt(localStorage.getItem("acc_subheading_size") || "20") || 20;
    applyAccessibilitySettings(hdr, body, sub);
  }, []);
  const [editingMetricFromModal, setEditingMetricFromModal] = useState<Metric | null>(null);
  // Inline view system
  const [inlineView, setInlineView] = useState<"metric-detail" | "metric-settings" | "color-rule" | null>(null);
  const [inlineMetric, setInlineMetric] = useState<Metric | null>(null);
  const [inlineHasUnsaved, setInlineHasUnsaved] = useState(false);
  // "popup" = default modal behaviour; "inline" = expanded in-page view
  const [viewMode, setViewMode] = useState<"popup" | "inline">("popup");
  const viewModeRef = useRef<"popup" | "inline">("popup");
  const [selectedApp, setSelectedApp] = useState<typeof APPS[0] | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try { const s = localStorage.getItem("dashello_sidebar"); if (s === "closed") return false; } catch {}
    return true;
  });
  useEffect(() => {
    localStorage.setItem("dashello_sidebar", sidebarOpen ? "open" : "closed");
  }, [sidebarOpen]);
  const [showChat, setShowChat] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const mobileMenuTriggerRef = useRef<HTMLDivElement>(null);

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState("");
  const [dbReady, setDbReady] = useState(false);
  const loadStartRef = useRef(Date.now());
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [activeOrg, setActiveOrg] = useState<Org | null>(null);
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [teamRows, setTeamRows] = useState<TeamRow[]>([]);
  const [teamPermissions, setTeamPermissions] = useState<TeamPermissions[]>([]);
  const [showOrgDropdown, setShowOrgDropdown] = useState(false);
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [renamingOrg, setRenamingOrg] = useState<Org | null>(null);
  const [deleteOrgTarget, setDeleteOrgTarget] = useState<Org | null>(null);
  const [deleteOrgConfirmText, setDeleteOrgConfirmText] = useState("");
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
    timezone: "",
    acc_header_size: 30,
    acc_subheading_size: 20,
    acc_min_body: 15,
  });
  useEffect(() => { applyAccessibilitySettings(profile.acc_header_size ?? 30, profile.acc_min_body ?? 15, profile.acc_subheading_size ?? 20); }, [profile.acc_header_size, profile.acc_min_body, profile.acc_subheading_size]);
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
  const [teamViewMode, setTeamViewMode] = useState<"row" | "expanded">("row");
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
  timezone: prof.timezone ?? "",
  acc_header_size: prof.acc_header_size ?? 30,
  acc_subheading_size: prof.acc_subheading_size ?? 20,
  acc_min_body: prof.acc_min_body ?? 15,
});
      const elapsed = Date.now() - loadStartRef.current;
      const remaining = Math.max(0, 2400 - elapsed);
      if (remaining > 0) {
        setTimeout(() => setDbReady(true), remaining);
      } else {
        setDbReady(true);
      }
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
    const check = () => { const m = window.innerWidth < 768; setIsMobile(m); if (!m) { const saved = localStorage.getItem("dashello_sidebar"); if (saved !== "closed") setSidebarOpen(true); } };
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
    const elapsed2 = Date.now() - loadStartRef.current;
    const remaining2 = Math.max(0, 2400 - elapsed2);
    const finish = () => { setDbReady(true); setPage("home"); };
    if (remaining2 > 0) setTimeout(finish, remaining2); else finish();
  }, [userId, activeOrg]);

  const handleCreateOrg = useCallback(async (name: string) => {
    if (!userId || !name.trim()) return;
    const newOrg: Org = { id: crypto.randomUUID(), name: name.trim(), isPersonal: false, createdAt: new Date().toISOString() };
    const defaultTeamId = crypto.randomUUID();
    const defaultTeam: TeamRow = { id: defaultTeamId, name: "My Team", order: 0 };
    const ownerMember: OrgMember = {
      id: crypto.randomUUID(), email: userEmail!, name: userEmail!.split("@")[0] || "Me",
      avatarUrl: profile.avatar_url || "", level: "owner", status: "active", teamId: defaultTeamId,
    };
    const newOrgs = [...orgs, newOrg];
    const newMembers = [...orgMembers, ownerMember];
    const newTeams = [...teamRows, defaultTeam];
    const newPerms = [...teamPermissions, { teamId: defaultTeamId, allowedSectionIds: null, metricOverrides: null }];
    setOrgs(newOrgs);
    setActiveOrg(newOrg);
    setTeamRows(newTeams);
    setOrgMembers(newMembers);
    setTeamPermissions(newPerms);
    await saveOrgData(userId, { orgs: newOrgs, members: newMembers, teams: newTeams, permissions: newPerms });
    localStorage.setItem("activeOrgId", newOrg.id);
    setShowCreateOrg(false);
    setDbReady(true);
    setPage("home");
  }, [userId, userEmail, orgs, orgMembers, teamRows, teamPermissions, profile.avatar_url]);

  const handleRenameOrg = async (orgId: string, newName: string) => {
    if (!userId || !newName.trim()) return;
    const updated = orgs.map(o => o.id === orgId ? { ...o, name: newName.trim() } : o);
    setOrgs(updated);
    setRenamingOrg(null);
    await saveOrgData(userId, { orgs: updated, members: orgMembers, teams: teamRows, permissions: teamPermissions });
  };

  const handleDeleteOrg = async () => {
    if (!userId || !deleteOrgTarget) return;
    const updated = orgs.filter(o => o.id !== deleteOrgTarget.id);
    const membersUpdated = orgMembers.filter(m => {
      // Keep members not tied to this org, or that belong to other orgs
      return true; // members are per-user, keep them all
    });
    setOrgs(updated);
    if (activeOrg?.id === deleteOrgTarget.id) {
      const personal = updated.find(o => o.isPersonal);
      if (personal) setActiveOrg(personal);
      else if (updated.length > 0) setActiveOrg(updated[0]);
    }
    setDeleteOrgTarget(null);
    setDeleteOrgConfirmText("");
    await saveOrgData(userId, { orgs: updated, members: orgMembers, teams: teamRows, permissions: teamPermissions });
    // For now, just remove from the list. A full 7-day soft delete would need server-side logic.
  };

  // Seed demo data when URL has #seed
  useEffect(() => {
    if (!dbReady || typeof window === "undefined" || window.location.hash !== "#seed") return;
    window.location.hash = "";
    const uid = () => crypto.randomUUID();
    const now = Date.now();
    const email = userEmail || "";
    // @ts-ignore - Demo seeding data may not match exact types
    const parentId = uid();
    const demoMetrics: any[] = [
      { id: uid(), label: "Client Sessions", value: "$5,400", color: "#3B82F6", graphType: "bar", icon: "TrendUp", colorRules: [{ id: uid(), color: "green", value: 5000, op: ">=" }, { id: uid(), color: "yellow", value: 3000, op: ">=", value2: 4999 }, { id: uid(), color: "red", value: 2999, op: "<=" }], modal: { type: "cashflow", title: "Client Sessions", mainValue: "$5,400", color: "#3B82F6", transactions: [] }, history: [{ timestamp: now - 86400000 * 3, value: 4000 }] },
      { id: uid(), label: "New Clients", value: "8", color: "#4C9FE8", graphType: "bar", icon: "UserPlus", colorRules: [{ id: uid(), color: "green", value: 10, op: ">=" }, { id: uid(), color: "yellow", value: 5, op: ">=", value2: 9 }, { id: uid(), color: "red", value: 4, op: "<=" }], modal: { type: "leads", title: "New Clients", mainValue: "8", color: "#4C9FE8", transactions: [] }, history: [] },
      { id: uid(), label: "Revenue", value: "$12,500", color: "#4CAF7D", graphType: "bar", icon: "TrendUp", colorRules: [{ id: uid(), color: "green", value: 10000, op: ">=" }, { id: uid(), color: "yellow", value: 5000, op: ">=", value2: 9999 }, { id: uid(), color: "red", value: 4999, op: "<=" }], modal: { type: "cashflow", title: "Revenue", mainValue: "$12,500", color: "#4CAF7D", transactions: [] }, history: [] },
      { id: uid(), label: "Client Retention", value: "85%", color: "#7B68EE", graphType: "bar", icon: "UsersThree", colorRules: [{ id: uid(), color: "green", value: 80, op: ">=" }, { id: uid(), color: "yellow", value: 60, op: ">=", value2: 79 }, { id: uid(), color: "red", value: 59, op: "<=" }], modal: { type: "generic", title: "Client Retention", mainValue: "85%", color: "#7B68EE", transactions: [] }, history: [] },
      { id: uid(), label: "Session Rating", value: "4.8 ★", color: "#F5A623", graphType: "bar", icon: "Star", colorRules: [{ id: uid(), color: "green", value: 4.5, op: ">=" }, { id: uid(), color: "yellow", value: 3.5, op: ">=", value2: 4.4 }, { id: uid(), color: "red", value: 3.4, op: "<=" }], modal: { type: "generic", title: "Session Rating", mainValue: "4.8 ★", color: "#F5A623", transactions: [] }, history: [] },
      { id: uid(), label: "Referrals", value: "12", color: "#48C78E", graphType: "bar", icon: "ShareNetwork", colorRules: [{ id: uid(), color: "green", value: 10, op: ">=" }, { id: uid(), color: "yellow", value: 5, op: ">=", value2: 9 }, { id: uid(), color: "red", value: 4, op: "<=" }], modal: { type: "leads", title: "Referrals", mainValue: "12", color: "#48C78E", transactions: [] }, history: [] },
    ];
    const finMetrics: any[] = [
      { id: parentId, label: "Overhead", value: "$15,000", color: "#0F6E56", graphType: "cashflow", icon: "Briefcase", fiveAccountParentId: undefined, colorRules: [{ id: uid(), color: "green", value: 20000, op: ">=" }], modal: { type: "cashflow", title: "Overhead", mainValue: "$15,000", color: "#0F6E56", fiveAccountEnabled: true, accountType: "overhead", transactions: [{ date: "2026-05-15", description: "Rent payment", debit: 5000 }, { date: "2026-05-16", description: "Client payment received", credit: 8000 }] }, history: [] },
      { id: uid(), label: "Profit", value: "$8,200", color: "#0F6E56", graphType: "cashflow", icon: "TrendUp", fiveAccountParentId: parentId, colorRules: [{ id: uid(), color: "green", value: 7500, op: ">=" }], modal: { type: "cashflow", title: "Profit", mainValue: "$8,200", color: "#0F6E56", fiveAccountEnabled: true, accountType: "profit", transactions: [{ date: "2026-05-16", description: "Profit allocation", credit: 4100 }] }, history: [] },
      { id: uid(), label: "Tax", value: "$4,100", color: "#0F6E56", graphType: "cashflow", icon: "Receipt", fiveAccountParentId: parentId, colorRules: [{ id: uid(), color: "green", value: 5000, op: ">=" }], modal: { type: "cashflow", title: "Tax", mainValue: "$4,100", color: "#0F6E56", fiveAccountEnabled: true, accountType: "tax", transactions: [{ date: "2026-05-16", description: "Tax allocation", credit: 4100 }] }, history: [] },
      { id: uid(), label: "Investments", value: "$3,500", color: "#0F6E56", graphType: "cashflow", icon: "PiggyBank", fiveAccountParentId: parentId, modal: { type: "cashflow", title: "Investments", mainValue: "$3,500", color: "#0F6E56", fiveAccountEnabled: true, accountType: "investments", transactions: [{ date: "2026-05-17", description: "Investment transfer", credit: 600 }] }, history: [] },
      { id: uid(), label: "Owner", value: "$2,000", color: "#0F6E56", graphType: "cashflow", icon: "User", fiveAccountParentId: parentId, modal: { type: "cashflow", title: "Owner", mainValue: "$2,000", color: "#0F6E56", fiveAccountEnabled: true, accountType: "owner", transactions: [] }, history: [] },
    ];
    const healthMetrics: any[] = [
      { id: uid(), label: "Steps", value: "8,500", color: "#4CAF7D", graphType: "bar", icon: "PersonSimpleWalk", colorRules: [{ id: uid(), color: "green", value: 10000, op: ">=" }, { id: uid(), color: "yellow", value: 7000, op: ">=", value2: 9999 }, { id: uid(), color: "red", value: 6999, op: "<=" }], modal: { type: "generic", title: "Steps", mainValue: "8,500", color: "#4CAF7D", transactions: [] }, history: [] },
      { id: uid(), label: "Sleep Hours", value: "7.2", color: "#7B68EE", graphType: "bar", icon: "Moon", colorRules: [{ id: uid(), color: "green", value: 8, op: ">=" }], modal: { type: "generic", title: "Sleep Hours", mainValue: "7.2", color: "#7B68EE", transactions: [] }, history: [] },
    ];

    const newSections: any[] = [
      { id: uid(), title: "Coaching Business", avatars: [], metrics: demoMetrics },
      { id: uid(), title: "Finances", avatars: [], metrics: finMetrics },
      { id: uid(), title: "Health", avatars: [], metrics: healthMetrics },
    ];

    setSections(prev => {
      const merged = [...prev];
      for (const s of newSections) {
        const existing = merged.find((x: any) => x.title === s.title);
        if (!existing) merged.push(s as any);
      }
      return merged;
    });

    const findMetric = (label: string) => { for (const s of newSections) { const m = s.metrics.find((mm: any) => mm.label === label); if (m) return m.id; } return undefined; };
    const newTasks: any[] = [
      { id: uid(), text: "Follow up with Sarah about coaching package", done: false, priority: true, assignedTo: email, createdBy: email, createdAt: new Date().toISOString(), linkedMetricId: findMetric("New Clients") },
      { id: uid(), text: "Prepare Q2 financial report", done: false, priority: true, assignedTo: email, createdBy: email, createdAt: new Date().toISOString(), linkedMetricId: findMetric("Revenue"), dueDate: "2026-05-28" },
      { id: uid(), text: "Review client session notes", done: false, priority: false, assignedTo: email, createdBy: email, createdAt: new Date().toISOString(), linkedMetricId: findMetric("Client Sessions") },
      { id: uid(), text: "Send referral thank-you emails", done: false, priority: true, assignedTo: email, createdBy: email, createdAt: new Date().toISOString(), linkedMetricId: findMetric("Referrals") },
      { id: uid(), text: "Track daily water intake", done: false, priority: false, assignedTo: email, createdBy: email, createdAt: new Date().toISOString(), linkedMetricId: findMetric("Steps") },
      { id: uid(), text: "Schedule client feedback calls", done: true, priority: false, assignedTo: email, createdBy: email, createdAt: new Date().toISOString(), linkedMetricId: findMetric("Client Retention") },
      { id: uid(), text: "Review tax documents", done: true, priority: true, assignedTo: email, createdBy: email, createdAt: new Date().toISOString() },
      { id: uid(), text: "Update coaching curriculum", done: false, priority: false, assignedTo: email, createdBy: email, createdAt: new Date().toISOString(), dueDate: "2026-05-20" },
    ];
    setTasksData(prev => {
      const existingTexts = new Set(prev.map(t => t.text));
      const filtered = newTasks.filter((t: any) => !existingTexts.has(t.text));
      return [...prev, ...filtered];
    });

    const newGoals: any[] = [
      { id: uid(), label: "Grow Coaching Practice", status: "active", pct: 65, due: "Q3 2026", attachedMetrics: [{ sectionLabel: "Coaching Business", metricLabel: "New Clients" }, { sectionLabel: "Coaching Business", metricLabel: "Revenue" }], description: "Expand client base by 30%", createdAt: new Date().toISOString(), steps: [], isManual: true },
      { id: uid(), label: "Improve Personal Health", status: "active", pct: 72, due: "2026-12-31", attachedMetrics: [{ sectionLabel: "Health", metricLabel: "Steps" }, { sectionLabel: "Health", metricLabel: "Sleep Hours" }], description: "10k steps and 8hr sleep", createdAt: new Date().toISOString(), steps: [], isManual: true },
      { id: uid(), label: "Financial Independence", status: "drafted", pct: 40, due: "2027", attachedMetrics: [{ sectionLabel: "Finances", metricLabel: "Profit" }, { sectionLabel: "Finances", metricLabel: "Investments" }], description: "Build 6-month emergency fund", createdAt: new Date().toISOString(), steps: [], isManual: true },
    ];
    setGoalsData(prev => {
      const existingLabels = new Set(prev.map(g => g.label));
      return [...prev, ...newGoals.filter((g: any) => !existingLabels.has(g.label))] as any;
    });

    setProfile((p: any) => ({ ...p, five_account_enabled: true, timezone: "America/New_York" }));
    if (userId && userEmail) {
      saveUserData("settings", userId, { mode: "business-and-personal", monthlyExpenses: 7500, ownerSalary: 5000, postTransactionEnabled: true });
      setFiveAccountSettings({ mode: "business-and-personal", monthlyExpenses: 7500, ownerSalary: 5000, postTransactionEnabled: true });
    }
  }, [dbReady, userId, userEmail, setSections, setTasksData, setGoalsData, setProfile, setFiveAccountSettings, saveUserData]);

  const health = calculateHealth(
   sections,
   profile.health_green_multiplier,
   profile.health_yellow_multiplier,
   profile.health_red_multiplier
);
  const hc = ({ green: "#4CAF7D", yellow: "#F5A623", red: "#E85D75", gray: "#F5A623" } as Record<string, string>)[health.barColor] || "#F5A623";

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
  if (hidden.includes(pageName)) return false;
  // Check team-based page permissions
  const pageAccessPages = ["home", "goals", "playbooks"];
  if (pageAccessPages.includes(pageName)) {
    const myMember = orgMembers.find(m => m.email === userEmail && m.status === "active");
    if (myMember && myMember.teamId) {
      const teamPerm = teamPermissions.find(p => p.teamId === myMember.teamId);
      if (teamPerm?.allowedPageIds !== undefined && teamPerm.allowedPageIds !== null) {
        return teamPerm.allowedPageIds.includes(pageName);
      }
    }
  }
  return true;
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
    onAddNewOrg={() => setShowCreateOrg(true)}
    onRenameOrg={(org) => setRenamingOrg(org)}
    onDeleteOrg={(org) => setDeleteOrgTarget(org)}
    currentUserLevel={currentUserLevel}
    onOpenInviteModal={() => setShowInviteModal(true)}
    menuPermissions={profile.menu_permissions ?? {}}
    tasks={tasksData} setTasks={setTasksData}
    orgMembers={orgMembers} userEmail={userEmail}
  />);

  if (!dbReady) return (
    <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", background: "linear-gradient(160deg,#2196F3 0%,#00BCD4 100%)" }}>
      <DashelloLoader size={360} />
    </div>
  );

  return (
    <>
    <style>{`@media (max-width:767px){.touch-btn{min-height:44px!important;min-width:44px!important}.touch-btn-sm{min-height:36px!important;min-width:36px!important}.stack-mobile{grid-template-columns:1fr!important}.hide-mobile{display:none!important}}`}</style>
    <div id="app-container" style={{ display: "flex", height: "100dvh", fontFamily: "'Inter',system-ui,sans-serif", background: "#F8FAFC", position: "relative" }}>
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
              <div style={{ padding: "3px 10px", borderRadius: 6, background: "#F59E0B", color: "#fff", fontSize: 15, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.04 }}>{__('common.previewMode', 'Preview Mode')}</div>
              <span style={{ fontSize: 15, color: "#92400E" }}>{__('common.viewingAs', 'Viewing as ')}<strong>{previewMember?.name || previewMember?.email}</strong></span>
              {previewLevel && <span style={{ fontSize: 15, padding: "2px 8px", borderRadius: 99, background: "#FDE68A", color: "#92400E", textTransform: "capitalize" }}>{previewLevel}</span>}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={() => { setPreviewMember(null); setPreviewPerms(null); }}
                style={{ padding: "6px 14px", borderRadius: 8, border: "1.5px solid #D97706", background: "#fff", color: "#92400E", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
                Exit Preview
              </button>
              <button onClick={() => { setPreviewFromSave(true); setPreviewMember(null); setPreviewPerms(null); setPage("team"); }}
                style={{ padding: "6px 16px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
                Save & Exit
              </button>
            </div>
          </div>
        ) : (
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 6 : 8, padding: isMobile ? "10px 8px" : "11px clamp(10px,3vw,26px)", borderBottom: "1px solid #E8EDF2", background: "#fff", flexShrink: 0 }}>
          <div onClick={() => { setPage("home"); setSidebarOpen(false); }} style={{ width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, marginRight: isMobile ? 0 : 2, overflow: "hidden" }}>
            <img src="https://dashello.co/wp-content/uploads/2023/08/cropped-Dashello-Icon.png" alt="Dashello" style={{ width: 28, height: 28, objectFit: "contain" }} />
          </div>
          {!sidebarOpen && (
            <div onClick={() => setSidebarOpen(true)} style={{ width: isMobile ? 44 : 34, height: isMobile ? 44 : 34, borderRadius: "50%", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", marginRight: isMobile ? 0 : 4, flexShrink: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {[0, 1, 2].map(i => <div key={i} style={{ width: 14, height: 2, background: "#475569", borderRadius: 2 }} />)}
              </div>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 6 : 10, flex: 1, minWidth: 0 }}>
            {(page === "home" && !inlineView) || page === "goals" || page === "team" ? (
              <div style={{ display: "flex", borderRadius: 8, border: "1px solid #e2e8f0", overflow: "hidden", flexShrink: 0 }}>
                {[__('common.row', 'Row'), page === "goals" ? __('common.expanded', 'Expanded') : __('common.column', 'Column')].map((lbl, i) => (
                  <div key={lbl} onClick={() => { if (page === "goals") setGoalsViewMode(i === 0 ? "row" : "expanded"); if (page === "team") setTeamViewMode(i === 0 ? "row" : "expanded"); }}
                    style={{ padding: isMobile ? "8px 12px" : "5px 13px", fontSize: 15, fontWeight: 500, cursor: "pointer", userSelect: "none",
                      background: (page === "home" && i === 0) || (page === "goals" && ((i === 0 && goalsViewMode === "row") || (i === 1 && goalsViewMode === "expanded"))) || (page === "team" && ((i === 0 && teamViewMode === "row") || (i === 1 && teamViewMode === "expanded"))) ? "#3B82F6" : "#fff",
                      color: (page === "home" && i === 0) || (page === "goals" && ((i === 0 && goalsViewMode === "row") || (i === 1 && goalsViewMode === "expanded"))) || (page === "team" && ((i === 0 && teamViewMode === "row") || (i === 1 && teamViewMode === "expanded"))) ? "#fff" : "#94a3b8" }}>{lbl}</div>
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
              <div onClick={() => setShowChat(v => !v)} style={{ width: 34, height: 34, borderRadius: "50%", border: "1.5px solid #e2e8f0", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <IconGlyph name="ChatCircleDots" size={18} color="#64748b" />
              </div>
              <div onClick={() => setPage("integrations")} style={{ width: 34, height: 34, borderRadius: "50%", border: "1.5px solid #e2e8f0", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <IconGlyph name="Plugs" size={18} color="#64748b" />
              </div>
            </div>
          ) : (
            <>
              <div onClick={() => setShowChat(v => !v)} style={{ padding: "6px 16px", borderRadius: 20, border: "1px solid #e2e8f0", fontSize: 15, color: "#64748b", cursor: "pointer", background: showChat ? "#EFF6FF" : "#fff", whiteSpace: "nowrap" }}>{__('common.chat', 'Chat')}</div>
              <div onClick={() => setPage("integrations")} style={{ padding: "7px clamp(10px,2vw,20px)", borderRadius: 8, background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>{__('common.customize', 'Customize')}</div>
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
          {page === "goals" && isPageAccessible("goals") && <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}><GoalsPage goals={goalsData} setGoals={setGoalsData} sections={isPreviewMode && previewSections ? previewSections : sections} viewMode={goalsViewMode} onOpenOnboarding={() => setShowGoalOnboarding(true)} onEditGoal={handleEditGoal} onDuplicateGoal={handleDuplicateGoal} tasks={tasksData} setTasks={setTasksData} userEmail={userEmail} orgMembers={orgMembers} /></div>}
          {page === "tasks" && isPageAccessible("tasks") && <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}><TasksPage tasks={tasksData} setTasks={setTasksData} userEmail={userEmail} orgMembers={orgMembers} teamRows={teamRows} sections={sections} goals={goalsData} onViewMetric={id => setViewMetricId(id)} onViewGoal={id => setViewGoalId(id)} onViewDecision={() => setPage("decisions")} onViewTeamMember={m => { setPendingMemberDetail(m); }} timezone={profile.timezone} healthBarColor={health.barColor} /></div>}
          {page === "decisions" && isPageAccessible("decisions") && <DecisionsPage tasks={tasksData} setTasks={setTasksData} userEmail={userEmail} />}
          {page === "integrations" && isPageAccessible("integrations") && <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}><IntegrationsPage onSelectApp={a => { setSelectedApp(a); setPage("app-detail"); }} /></div>}
          {page === "app-detail" && selectedApp && <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}><AppDetailPage app={selectedApp} onBack={() => setPage("integrations")} /></div>}
          {page === "team" && isPageAccessible("team") && <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}><TeamPage sections={isPreviewMode && previewSections ? previewSections : sections} orgMembers={orgMembers} setOrgMembers={setOrgMembers} teamRows={teamRows} setTeamRows={setTeamRows} teamPermissions={teamPermissions} setTeamPermissions={setTeamPermissions} currentUserLevel={currentUserLevel} userEmail={userEmail} onOpenInvite={() => setShowInviteModal(true)} onPreviewMember={(member, perms) => { setPreviewMember(member); setPreviewPerms(perms); setPage("home"); }} onExitPreviewSave={() => { setPreviewFromSave(false); }} previewFromSave={previewFromSave} pendingMemberDetail={pendingMemberDetail} onClearPendingMember={() => setPendingMemberDetail(null)} tasks={tasksData} setTasks={setTasksData} teamViewMode={teamViewMode} menuPermissions={profile.menu_permissions ?? {}} /></div>}
          {page === "settings" && isPageAccessible("settings") && <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}><SettingsPage userId={userId!} userEmail={userEmail} profile={profile} forceDisableFiveAccount={fiveAccountForceOff} onForceDisableAcknowledged={() => setFiveAccountForceOff(false)} onProfileSaved={p => setProfile(p)} onFiveAccountCreated={handleFiveAccountCreated} onFiveAccountDisabled={handleGlobalFiveAccountDisabled} fiveAccountSettings={fiveAccountSettings} onFiveAccountSettingsChange={handleUpdateSettings} currentUserLevel={currentUserLevel} activeOrg={activeOrg} onRenameOrg={handleRenameOrg} /></div>}
          {page === "playbooks" && isPageAccessible("playbooks") && <Suspense fallback={<div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center" }}><DashelloLoader size={120} /></div>}><PlaybooksPage userId={userId} tasks={tasksData} setTasks={setTasksData} userEmail={userEmail} /></Suspense>}
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
          {!["home","goals","tasks","decisions","integrations","app-detail","team","settings","playbooks","equation-builder"].includes(page) && (
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 48 }}>
              <div style={{ fontSize: 72, fontWeight: 800, color: "#e2e8f0", marginBottom: 8 }}>404</div>
              <div style={{ fontSize: 18, color: "#64748b", marginBottom: 24 }}>{__('common.somethingWrong', "Something isn't quite right.")}</div>
              <button onClick={() => setPage("home")} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: "#3B82F6", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
                Go to home page
              </button>
            </div>
          )}
        </div>
      </div>

      {showChat && <ChatPanel sections={sections} isMobile={isMobile} onClose={() => setShowChat(false)} />}

      {showGoalOnboarding && <GoalOnboarding sections={sections} isMobile={isMobile} onClose={() => setShowGoalOnboarding(false)} onCreate={handleCreateGoal} />}

      {editingGoal && <GoalSettingsModal goal={editingGoal} sections={sections} isMobile={isMobile} onSave={handleSaveGoal} onDuplicate={handleDuplicateGoal} onDelete={handleDeleteGoal} onClose={() => setEditingGoal(null)} />}

      {showInviteModal && <AddTeamModal orgId={activeOrg?.id ?? ""} orgs={orgs} setOrgs={setOrgs} orgMembers={orgMembers} setOrgMembers={setOrgMembers} teamRows={teamRows} setTeamRows={setTeamRows} invitedByName={profile.full_name} onClose={() => setShowInviteModal(false)} currentUserLevel={currentUserLevel} />}

      {showCreateOrg && (
        <div onClick={() => setShowCreateOrg(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "32px", width: "100%", maxWidth: 400, boxShadow: "0 24px 64px rgba(0,0,0,0.18)", textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2332", marginBottom: 16 }}>Create New Dashboard Account</div>
            <input id="new-org-name" autoFocus placeholder="Dashboard account name"
              onKeyDown={e => { if (e.key === "Enter") { const val = (document.getElementById("new-org-name") as HTMLInputElement)?.value; if (val?.trim()) handleCreateOrg(val); } }}
              style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box", marginBottom: 16 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { const val = (document.getElementById("new-org-name") as HTMLInputElement)?.value; if (val?.trim()) handleCreateOrg(val); }}
                style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Create</button>
              <button onClick={() => setShowCreateOrg(false)}
                style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>Go Back</button>
            </div>
          </div>
        </div>
      )}

      {/* Rename org modal */}
      {renamingOrg && (
        <div onClick={() => setRenamingOrg(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "32px", width: "100%", maxWidth: 400, boxShadow: "0 24px 64px rgba(0,0,0,0.18)", textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2332", marginBottom: 16 }}>Rename Dashboard</div>
            <input id="rename-org-input" defaultValue={renamingOrg.name} autoFocus placeholder="Dashboard name"
              onKeyDown={e => { if (e.key === "Enter") { const val = (document.getElementById("rename-org-input") as HTMLInputElement)?.value; if (val?.trim()) handleRenameOrg(renamingOrg.id, val); } }}
              style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box", marginBottom: 16 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { const val = (document.getElementById("rename-org-input") as HTMLInputElement)?.value; if (val?.trim()) handleRenameOrg(renamingOrg.id, val); }}
                style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Save</button>
              <button onClick={() => setRenamingOrg(null)}
                style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete org modal */}
      {deleteOrgTarget && (
        <div onClick={() => { setDeleteOrgTarget(null); setDeleteOrgConfirmText(""); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "32px", width: "100%", maxWidth: 440, boxShadow: "0 24px 64px rgba(0,0,0,0.18)" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#E85D75", marginBottom: 12 }}>Delete Dashboard</div>
            <div style={{ fontSize: 15, color: "#475569", marginBottom: 16, lineHeight: 1.6 }}>
              <strong>Warning:</strong> All content, integrations, users, and data associated with this dashboard account will be permanently deleted. This action cannot be undone.
            </div>
            <div style={{ fontSize: 15, color: "#475569", marginBottom: 12 }}>
              Type <strong>{deleteOrgTarget.name}</strong> to confirm deletion:
            </div>
            <input value={deleteOrgConfirmText} onChange={e => setDeleteOrgConfirmText(e.target.value)} autoFocus placeholder="Type the dashboard name to confirm"
              style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box", marginBottom: 16 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleDeleteOrg} disabled={deleteOrgConfirmText !== deleteOrgTarget.name}
                style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: deleteOrgConfirmText === deleteOrgTarget.name ? "#E85D75" : "#e2e8f0", color: "#fff", fontSize: 15, fontWeight: 600, cursor: deleteOrgConfirmText === deleteOrgTarget.name ? "pointer" : "not-allowed" }}>Permanently Delete</button>
              <button onClick={() => { setDeleteOrgTarget(null); setDeleteOrgConfirmText(""); }}
                style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

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

      {/* ── Member detail modal (triggered from Tasks page team member click) ── */}
      {pendingMemberDetail && (
        <div onClick={() => setPendingMemberDetail(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 480, maxHeight: "90vh", overflow: "auto", position: "relative" }}>
            <button onClick={() => setPendingMemberDetail(null)} style={{ position: "absolute", top: 12, right: 16, width: 28, height: 28, borderRadius: "50%", border: "none", background: "#f1f5f9", cursor: "pointer", fontSize: 16, color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: "#94a3b8", marginBottom: 8 }}>
              {(pendingMemberDetail.name?.[0] || pendingMemberDetail.email[0] || "?").toUpperCase()}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2332", marginBottom: 2 }}>{pendingMemberDetail.name || pendingMemberDetail.email}</div>
            <div style={{ fontSize: 15, color: "#3B82F6", fontWeight: 600, textTransform: "capitalize", marginBottom: 16 }}>{pendingMemberDetail.level}</div>
            {(tasksData || []).filter(t => t.assignedTo === pendingMemberDetail.email && !t.done && t.priority).length > 0 && (
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: hc, marginBottom: 8 }}>★ {__('common.priorities', 'Priorities')}</div>
                {(tasksData || []).filter(t => t.assignedTo === pendingMemberDetail.email && !t.done && t.priority).map(t => (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, background: `${hc}20`, marginBottom: 4 }}>
                    <div style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0, border: `1.5px solid ${hc}`, background: "transparent" }} />
                    <span style={{ flex: 1, fontSize: 15, color: "#1a2332", fontWeight: 600, minWidth: 0 }}>{t.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
    </>
  );
}
