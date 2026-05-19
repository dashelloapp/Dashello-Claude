import { useState, useRef, useEffect, useLayoutEffect, Fragment } from "react";
import { Section, Goal, Task, Metric, MetricColor, MetricModalData, GoalType, GoalSubType, GoalStatus, GoalStep, GoalTarget, GoalAttachedMetric, GoalTrackingMode, RuleOp, GoalTargetType, GoalNote, OrgMember, OrgPermissionLevel, DataPoint } from "../types";
import { resolveColor, computeMetricHealth, findMetricByLabel, evaluateGoalStep, computeGoalProgress, makeGoal, formatTarget } from "../utils/helpers";
import { IconGlyph, Av, Toggle, SectionCard, MetricBlock } from "../components/shared";
import { MS } from "../utils/constants";
import { useTranslation } from "../i18n";
import { supabase } from "../lib/supabase";
import * as PhosphorReact from "@phosphor-icons/react";


export function GoalsPage({ goals, setGoals, sections, viewMode, onOpenOnboarding, onEditGoal, onDuplicateGoal, tasks, setTasks, userEmail, orgMembers }: {
  goals: Goal[]; setGoals: (g: Goal[]) => void; sections: Section[];
  viewMode: "row" | "expanded";
  onOpenOnboarding: () => void; onEditGoal: (g: Goal) => void; onDuplicateGoal: (g: Goal) => void;
  tasks?: Task[]; setTasks?: React.Dispatch<React.SetStateAction<Task[]>>;
  userEmail?: string; orgMembers?: OrgMember[];
}) {
  const { t: __ } = useTranslation();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ active: false, drafted: false, completed: false });
  const [confirmComplete, setConfirmComplete] = useState<Goal | null>(null);
  const [goalAddTask, setGoalAddTask] = useState<{ goalId: string; text: string; assignee: string; dueDate: string; priority: boolean } | null>(null);
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
            {g.due && <span style={{ fontSize: 15, color: "#94a3b8", whiteSpace: "nowrap" }}>{g.due}</span>}
            <div onClick={() => onEditGoal(g)} style={{ width: 32, height: 32, borderRadius: 8, background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }} title="Edit goal settings">
              <IconGlyph name="PencilSimple" size={16} color="#64748b" />
            </div>
          </div>

          {/* Progress bar - always shown */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, height: 24, borderRadius: 99, background: "#e5e7eb", overflow: "hidden" }}>
              <div style={{ width: `${g.pct}%`, height: "100%", borderRadius: 99, background: barBg, transition: "width 0.3s" }} />
            </div>
            <span style={{ fontSize: 15, fontWeight: 700, color: barBg, minWidth: 40, textAlign: "right" }}>{g.pct}%</span>
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
                        <div style={{ position: "absolute", top: 4, left: 4, width: 22, height: 22, borderRadius: "50%", background: "#3B82F6", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, zIndex: 2 }}>{si + 1}</div>
                        <div style={{ position: "absolute", bottom: 4, right: 4, display: "flex", alignItems: "center", gap: 2, padding: "2px 6px", borderRadius: 99, background: met ? "rgba(76,175,125,0.85)" : "rgba(220,38,38,0.85)", color: "#fff", fontSize: 15, fontWeight: 600 }}>
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
                  {(() => {
                    const linked = (tasks || []).filter(t => t.linkedGoalId === g.id && !t.done);
                    return (
                      <div style={{ display: "contents" }}>
                        {linked.length > 0 && <button onClick={(e) => { e.stopPropagation(); setGoalExpandActions(g.id); }}
                          style={{ position: "absolute", bottom: 4, right: 4, width: 22, height: 22, borderRadius: 4, border: "none", background: "rgba(255,255,255,0.9)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: "#64748b", boxShadow: "0 1px 3px rgba(0,0,0,0.12)" }}
                          title="View all next actions">⛶</button>}
                        {linked.map(t => {
                          const assigneeMember = (orgMembers || []).find(m => m.email === t.assignedTo);
                          return (
                            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, position: "relative" }}>
                              <div onClick={(e) => { e.stopPropagation(); if (setTasks) setTasks(prev => prev.map(x => x.id === t.id ? { ...x, done: !x.done } : x)); }}
                                style={{ width: 18, height: 18, borderRadius: "50%", flexShrink: 0, cursor: "pointer", border: t.done ? "none" : "1.5px solid #d1d5db", background: t.done ? "#4CAF7D" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 15 }}>{t.done ? "✓" : ""}</div>
                              <span style={{ fontSize: 15, color: "#1a2332", flex: 1, textDecoration: t.done ? "line-through" : "none", minWidth: 0 }}>{t.text}</span>
                              {assigneeMember ? (
                                assigneeMember.avatarUrl
                                  ? <img src={assigneeMember.avatarUrl} alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                                  : <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: "#94a3b8", flexShrink: 0 }}>
                                      {(assigneeMember.name?.[0] || assigneeMember.email[0] || "?").toUpperCase()}
                                    </div>
                              ) : null}
                              <div onClick={(e) => { e.stopPropagation(); goalMenuTriggerElRef.current = e.currentTarget as HTMLElement; setGoalMenuTaskId(goalMenuTaskId === t.id ? null : t.id); }} style={{ width: 22, height: 22, borderRadius: "50%", background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 15, color: "#94a3b8", flexShrink: 0 }}>···</div>
                              {goalMenuTaskId === t.id && (
                                <div ref={goalMenuRef} style={{ ...goalMenuPos, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid #e2e8f0", zIndex: 100, minWidth: 150, overflow: "hidden" }}>
                                  <div style={{ padding: "7px 12px", fontSize: 15, fontWeight: 600, color: "#64748b", borderBottom: "1px solid #f1f5f9" }}>{__('common.assignTo', 'Assign To')}</div>
                                  {(orgMembers || []).filter(m => m.status === "active").map(m => (
                                    <div key={m.id} onClick={() => { setTasks?.(prev => prev.map(x => x.id === t.id ? { ...x, assignedTo: m.email } : x)); setGoalMenuTaskId(null); }}
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
                                      <input type="date" value={t.dueDate || ""} onChange={e => { setTasks?.(prev => prev.map(x => x.id === t.id ? { ...x, dueDate: e.target.value || undefined } : x)); setGoalMenuTaskId(null); }}
                                        style={{ width: "100%", padding: "4px 6px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
                                    </div>
                                  </div>
                                  <div onClick={() => { setTasks?.(prev => prev.filter(x => x.id !== t.id)); setGoalMenuTaskId(null); }}
                                    style={{ padding: "8px 12px", fontSize: 15, cursor: "pointer", color: "#E85D75", borderTop: "1px solid #f1f5f9" }}
                                    onMouseEnter={e => e.currentTarget.style.background = "#fff5f5"}
                                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>{__('common.delete', 'Delete')}</div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {linked.length === 0 && !goalAddTask && <div style={{ fontSize: 15, color: "#cbd5e1", fontStyle: "italic" }}>{__('common.noActions', 'No actions yet')}</div>}
                        {goalAddTask?.goalId === g.id ? (
                          <div style={{ marginTop: 6 }}>
                            <input value={goalAddTask.text} onChange={e => setGoalAddTask({ ...goalAddTask, text: e.target.value })} placeholder="New action..."
                              onKeyDown={e => { if (e.key === "Enter" && goalAddTask.text.trim() && setTasks && userEmail) { setTasks(prev => [...prev, { id: crypto.randomUUID(), text: goalAddTask.text.trim(), done: false, assignedTo: goalAddTask.assignee || userEmail, createdBy: userEmail, linkedGoalId: g.id, createdAt: new Date().toISOString(), dueDate: goalAddTask.dueDate || undefined, priority: goalAddTask.priority || undefined }]); setGoalAddTask(null); } }}
                              autoFocus style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1.5px solid #3B82F6", fontSize: 15, outline: "none", boxSizing: "border-box", marginBottom: 6 }} />
                            <label style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 15, color: goalAddTask.priority ? "#F5A623" : "#94a3b8", cursor: "pointer", marginBottom: 4 }}>
                              <input type="checkbox" checked={goalAddTask.priority} onChange={e => setGoalAddTask({ ...goalAddTask, priority: e.target.checked })} style={{ accentColor: "#F5A623", margin: 0, width: 12, height: 12 }} />
                              {goalAddTask.priority ? "" : "Make priority?"}
                            </label>
                            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                              <select value={goalAddTask.assignee} onChange={e => setGoalAddTask({ ...goalAddTask, assignee: e.target.value })}
                                style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", background: "#fff" }}>
                                <option value={userEmail}>Me</option>
                                {(orgMembers || []).filter(m => m.status === "active" && m.email !== userEmail).map(m => (
                                  <option key={m.id} value={m.email}>{m.name || m.email.split("@")[0]}</option>
                                ))}
                              </select>
                              <input type="date" value={goalAddTask.dueDate} onChange={e => setGoalAddTask({ ...goalAddTask, dueDate: e.target.value })}
                                style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
                            </div>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button onClick={() => { if (goalAddTask.text.trim() && setTasks && userEmail) { setTasks(prev => [...prev, { id: crypto.randomUUID(), text: goalAddTask.text.trim(), done: false, assignedTo: goalAddTask.assignee || userEmail, createdBy: userEmail, linkedGoalId: g.id, createdAt: new Date().toISOString(), dueDate: goalAddTask.dueDate || undefined, priority: goalAddTask.priority || undefined }]); setGoalAddTask(null); } }}
                                disabled={!goalAddTask.text.trim()}
                                style={{ flex: 1, padding: "5px 14px", borderRadius: 6, border: "none", background: goalAddTask.text.trim() ? "#3B82F6" : "#e2e8f0", color: "#fff", fontSize: 15, fontWeight: 600, cursor: goalAddTask.text.trim() ? "pointer" : "not-allowed" }}>{__('common.add', 'Add')}</button>
                              <button onClick={() => setGoalAddTask(null)} style={{ flex: 1, padding: "5px 14px", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>{__('common.cancel', 'Cancel')}</button>
                            </div>
                          </div>
                        ) : (
                          <div onClick={() => setGoalAddTask({ goalId: g.id, text: "", assignee: userEmail || "", dueDate: "", priority: false })} style={{ fontSize: 15, color: "#3B82F6", cursor: "pointer", fontWeight: 600, marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
                            <span style={{ fontSize: 15 }}>+</span> Add Task
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
              <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332", marginBottom: 20 }}>{__('common.nextActions', 'Next Actions')} — {g.label}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {(tasks || []).filter(t => t.linkedGoalId === g.id && !t.done).map(t => {
                  const assigneeMember = (orgMembers || []).find(m => m.email === t.assignedTo);
                  return (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: "#fff", border: "1px solid #f1f5f9", position: "relative" }}>
                      <div onClick={(e) => { e.stopPropagation(); if (setTasks) setTasks(prev => prev.map(x => x.id === t.id ? { ...x, done: !x.done } : x)); }} style={{ width: 18, height: 18, borderRadius: "50%", flexShrink: 0, cursor: "pointer", border: t.done ? "none" : "1.5px solid #d1d5db", background: t.done ? "#4CAF7D" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 15 }}>{t.done ? "✓" : ""}</div>
                      <span style={{ fontSize: 15, color: "#1a2332", flex: 1, minWidth: 0 }}>{t.text}</span>
                      {assigneeMember ? (
                        assigneeMember.avatarUrl
                          ? <img src={assigneeMember.avatarUrl} alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                          : <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: "#94a3b8", flexShrink: 0 }}>
                              {(assigneeMember.name?.[0] || assigneeMember.email[0] || "?").toUpperCase()}
                            </div>
                      ) : null}
                      <div onClick={(e) => { e.stopPropagation(); goalMenuTriggerElRef.current = e.currentTarget as HTMLElement; setGoalMenuTaskId(goalMenuTaskId === t.id ? null : t.id); }} style={{ width: 22, height: 22, borderRadius: "50%", background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 15, color: "#94a3b8", flexShrink: 0 }}>···</div>
                      {goalMenuTaskId === t.id && (
                        <div ref={goalMenuRef} style={{ ...goalMenuPos, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid #e2e8f0", zIndex: 100, minWidth: 150, overflow: "hidden" }}>
                          <div style={{ padding: "7px 12px", fontSize: 15, fontWeight: 600, color: "#64748b", borderBottom: "1px solid #f1f5f9" }}>{__('common.assignTo', 'Assign To')}</div>
                          {(orgMembers || []).filter(m => m.status === "active").map(m => (
                            <div key={m.id} onClick={() => { setTasks?.(prev => prev.map(x => x.id === t.id ? { ...x, assignedTo: m.email } : x)); setGoalMenuTaskId(null); }}
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
                              <input type="date" value={t.dueDate || ""} onChange={e => { setTasks?.(prev => prev.map(x => x.id === t.id ? { ...x, dueDate: e.target.value || undefined } : x)); setGoalMenuTaskId(null); }}
                                style={{ width: "100%", padding: "4px 6px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
                            </div>
                          </div>
                          <div onClick={() => { setTasks?.(prev => prev.filter(x => x.id !== t.id)); setGoalMenuTaskId(null); }}
                            style={{ padding: "8px 12px", fontSize: 15, cursor: "pointer", color: "#E85D75", borderTop: "1px solid #f1f5f9" }}
                            onMouseEnter={e => e.currentTarget.style.background = "#fff5f5"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>{__('common.delete', 'Delete')}</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {goalAddTask?.goalId === g.id ? (
                <div style={{ marginTop: 12 }}>
                  <input value={goalAddTask.text} onChange={e => setGoalAddTask({ ...goalAddTask, text: e.target.value })} placeholder="New action..."
                    onKeyDown={e => { if (e.key === "Enter" && goalAddTask.text.trim() && setTasks && userEmail) { setTasks(prev => [...prev, { id: crypto.randomUUID(), text: goalAddTask.text.trim(), done: false, assignedTo: goalAddTask.assignee || userEmail, createdBy: userEmail, linkedGoalId: g.id, createdAt: new Date().toISOString(), dueDate: goalAddTask.dueDate || undefined, priority: goalAddTask.priority || undefined }]); setGoalAddTask(null); } }}
                    style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box", marginBottom: 6 }} />
                  <label style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 15, color: goalAddTask.priority ? "#F5A623" : "#94a3b8", cursor: "pointer", marginBottom: 4 }}>
                    <input type="checkbox" checked={goalAddTask.priority} onChange={e => setGoalAddTask({ ...goalAddTask, priority: e.target.checked })} style={{ accentColor: "#F5A623", margin: 0, width: 12, height: 12 }} />
                    {goalAddTask.priority ? "" : "Make priority?"}
                  </label>
                  <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                    <select value={goalAddTask.assignee} onChange={e => setGoalAddTask({ ...goalAddTask, assignee: e.target.value })}
                      style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", background: "#fff" }}>
                      <option value={userEmail}>Me</option>
                      {(orgMembers || []).filter(m => m.status === "active" && m.email !== userEmail).map(m => (
                        <option key={m.id} value={m.email}>{m.name || m.email.split("@")[0]}</option>
                      ))}
                    </select>
                    <input type="date" value={goalAddTask.dueDate} onChange={e => setGoalAddTask({ ...goalAddTask, dueDate: e.target.value })}
                      style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => { if (goalAddTask.text.trim() && setTasks && userEmail) { setTasks(prev => [...prev, { id: crypto.randomUUID(), text: goalAddTask.text.trim(), done: false, assignedTo: goalAddTask.assignee || userEmail, createdBy: userEmail, linkedGoalId: g.id, createdAt: new Date().toISOString(), dueDate: goalAddTask.dueDate || undefined, priority: goalAddTask.priority || undefined }]); setGoalAddTask(null); } }}
                      disabled={!goalAddTask.text.trim()}
                      style={{ flex: 1, padding: "5px 14px", borderRadius: 6, border: "none", background: goalAddTask.text.trim() ? "#3B82F6" : "#e2e8f0", color: "#fff", fontSize: 15, fontWeight: 600, cursor: goalAddTask.text.trim() ? "pointer" : "not-allowed" }}>{__('common.add', 'Add')}</button>
                    <button onClick={() => setGoalAddTask(null)} style={{ flex: 1, padding: "5px 14px", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>{__('common.cancel', 'Cancel')}</button>
                  </div>
                </div>
              ) : (
                <div onClick={() => setGoalAddTask({ goalId: g.id, text: "", assignee: userEmail || "", dueDate: "", priority: false })} style={{ fontSize: 15, color: "#3B82F6", cursor: "pointer", fontWeight: 600, marginTop: 12, display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 15 }}>+</span> Add Task
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
        <span style={{ fontSize: 15, color: collapsed[key] ? "#3B82F6" : "#64748b", transition: "transform 0.2s", transform: collapsed[key] ? "rotate(-90deg)" : "rotate(0deg)" }}>▼</span>
        <span style={{ fontSize: 15, fontWeight: 600, color: "#1a2332" }}>{label}</span>
        <span style={{ fontSize: 15, color: "#94a3b8", background: "#f1f5f9", padding: "1px 8px", borderRadius: 99 }}>{items.length}</span>
      </div>
      {!collapsed[key] && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.length === 0 ? (
            <div style={{ padding: "20px 0", textAlign: "center", fontSize: 15, color: "#94a3b8" }}>
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
        <h1 style={{ margin: 0, fontSize: "clamp(20px,4vw,26px)", fontWeight: 700, color: "#1a2332" }}>{__('common.goals', 'Goals')}</h1>
        <button onClick={onOpenOnboarding} style={{ padding: "7px 18px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", marginLeft: "auto" }}>⊕ Add Goal</button>
      </div>
      {renderSection("active", "Active", active)}
      {renderSection("drafted", "Drafted", drafted)}
      {renderSection("completed", "Completed", completed)}

      {/* Completion confirmation dialog */}
      {confirmComplete && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: "28px 32px", maxWidth: 380, textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1a2332", marginBottom: 12 }}>{__('goal.markComplete', 'Mark goal as complete?')}</div>
            <div style={{ fontSize: 15, color: "#64748b", marginBottom: 20 }}>Are you sure "<strong>{confirmComplete.label}</strong>" is finished?</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button onClick={() => setConfirmComplete(null)} style={{ padding: "10px 24px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>{__('common.cancel', 'Cancel')}</button>
              <button onClick={() => handleCompleteGoal(confirmComplete)} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "#4CAF7D", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{__('common.yesComplete', 'Yes, Complete')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function GoalOnboarding({ sections, isMobile, onClose, onCreate }: { sections: Section[]; isMobile?: boolean; onClose: () => void; onCreate: (g: Goal) => void }) {
  const { t: __ } = useTranslation();
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
    if (configTargetType === "percentage" && !configPct.trim()) return;
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
                color: i <= page ? "#fff" : "#94a3b8", fontSize: 15, fontWeight: 700, transition: "all 0.2s" }}>
              {(i === 0 && step1Complete) || (i === 1 && step2Complete) || i < page ? <IconGlyph name="Check" size={16} color="#fff" weight="bold" /> : i + 1}
            </div>
            {i < 2 && <div style={{ width: 40, height: 2, background: ((i === 0 && step1Complete) || i < page) ? "#4CAF7D" : "#e2e8f0", transition: "background 0.3s" }} />}
          </div>
        ))}
      </div>
      {/* Current step summary */}
      <div style={{ textAlign: "center" }}>
        {page === 0 && <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332" }}>{__('onboarding.step1', 'Step 1: Name, Deadline & Type')}</div>}
        {page === 1 && <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332" }}>Step 2: {goalType === "metric" ? "Attach Metrics & Set Targets" : "Build Your Goal"}</div>}
        {page === 2 && <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332" }}>{__('onboarding.step3', 'Step 3: AI Projections')}</div>}
        {page === 3 && <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332" }}>{__('common.reviewSave', 'Review & Save')}</div>}
      </div>
    </div>
  );

  const renderPage0 = () => (
    <div style={{ maxWidth: 420, margin: "0 auto", textAlign: "center" }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#1a2332", marginBottom: 4 }}>Create Goal</div>
      <div style={{ fontSize: 15, color: "#64748b", marginBottom: 24 }}>{__('onboarding.nameGoalType', 'Name your goal and choose a type')}</div>

      <input autoFocus value={goalName} onChange={e => setGoalName(e.target.value)} placeholder="Goal name..." style={{ width: "100%", padding: "12px 16px", borderRadius: 10, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", marginBottom: 14, boxSizing: "border-box" }} />

      <div style={{ textAlign: "left", marginBottom: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>{__('goal.deadline', 'DEADLINE (optional)')}</div>
        <input value={dueDate} onChange={e => setDueDate(e.target.value)} type="date" style={{ width: "100%", padding: "12px 16px", borderRadius: 10, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", marginBottom: 6, boxSizing: "border-box" }} />
        <div style={{ fontSize: 15, color: "#94a3b8", lineHeight: 1.4, marginBottom: 16 }}>
          Set a deadline to track progress against time. Without a deadline, this becomes an evergreen goal that shows your average health score.
        </div>
      </div>

      <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 8, textAlign: "left" }}>GOAL TYPE</div>
      <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 20 }}>
        {(["equation", "metric"] as GoalType[]).map(t => (
          <div key={t} onClick={() => setGoalType(t)} style={{ flex: 1, maxWidth: 200, padding: "20px 16px", borderRadius: 12, border: `2px solid ${goalType === t ? "#3B82F6" : "#e2e8f0"}`, background: goalType === t ? "#EFF6FF" : "#fff", cursor: "pointer", textAlign: "center", transition: "all 0.15s" }}>
            <div style={{ fontSize: 28, marginBottom: 8, display: "flex", justifyContent: "center" }}>
              {t === "equation" ? <IconGlyph name="ChartBar" size={32} color={goalType === t ? "#3B82F6" : "#64748b"} /> : <IconGlyph name="Gauge" size={32} color={goalType === t ? "#3B82F6" : "#64748b"} />}
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332", marginBottom: 4 }}>{t === "equation" ? "Equation Goal" : "Metric Goal"}</div>
            <div style={{ fontSize: 15, color: "#64748b" }}>{t === "equation" ? "Set targets on specific metrics" : "Track average health of metric boxes"}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
        <button onClick={onClose} style={{ padding: "10px 24px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>{__('common.cancel', 'Cancel')}</button>
        <button onClick={handlePage0Next} disabled={!step1Complete} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: step1Complete ? "linear-gradient(135deg,#3B82F6,#06B6D4)" : "#e2e8f0", color: "#fff", fontSize: 15, fontWeight: 600, cursor: step1Complete ? "pointer" : "default" }}>{__('common.next', 'Next →')}</button>
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
        <div style={{ fontSize: 15, color: "#64748b", marginBottom: 24, textAlign: "center" }}>
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
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "#F8FAFC", borderRadius: 10, marginBottom: 6, fontSize: 15, border: "1px solid #f1f5f9" }}>
                  <span style={{ width: 24, height: 24, borderRadius: "50%", background: "#3B82F6", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
                  <span style={{ flex: 1, color: "#1a2332", fontWeight: 500 }}>{m?.label ?? item.metricLabel}</span>
                  {isStep && <span style={{ color: "#64748b", fontSize: 15 }}>{formatTarget((item as GoalStep).target)}</span>}
                  {!isStep && <span style={{ color: "#64748b", fontSize: 15 }}>{health}%</span>}
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
            <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332", marginBottom: 12 }}>
              Target for: <span style={{ color: "#3B82F6" }}>{configMetric.metricLabel}</span>
            </div>
            <select value={configTargetType} onChange={e => setConfigTargetType(e.target.value as GoalTargetType)} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", marginBottom: 10 }}>
              <option value="color_rule">{__('common.colorRule', 'Color Rule')}</option>
              <option value="number_reach">{__('common.numberReached', 'Number Reached')}</option>
              <option value="number_range">{__('common.numberRangeReached', 'Number Range Reached')}</option>
              <option value="percentage">{__('common.percentageReached', 'Percentage Reached')}</option>
            </select>
            {configTargetType === "number_reach" && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                <select value={configOp} onChange={e => setConfigOp(e.target.value as RuleOp)} style={{ padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }}>
                  {[">=", "<=", ">", "<", "==", "!="].map(op => <option key={op} value={op}>{op}</option>)}
                </select>
                <input value={configVal} onChange={e => setConfigVal(e.target.value)} type="number" placeholder="Value" style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }} />
              </div>
            )}
            {configTargetType === "number_range" && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                <input value={configVal} onChange={e => setConfigVal(e.target.value)} type="number" placeholder="Min" style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }} />
                <span style={{ color: "#94a3b8" }}>to</span>
                <input value={configVal2} onChange={e => setConfigVal2(e.target.value)} type="number" placeholder="Max" style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }} />
              </div>
            )}
            {configTargetType === "percentage" && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 15, color: "#64748b" }}>≥</span>
                <input value={configPct} onChange={e => setConfigPct(e.target.value)} type="number" placeholder="e.g. 80%" style={{ width: 120, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }} />
                <span style={{ fontSize: 15, color: "#64748b" }}>% health</span>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={resetConfig} style={{ padding: "8px 16px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>{__('common.cancel', 'Cancel')}</button>
              <button onClick={confirmStep} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{__('common.addStep', 'Add Step')}</button>
            </div>
          </div>
        ) : (
          /* Search */
          <div>
            <input autoFocus value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Start typing the name of a metric box..." style={{ width: "100%", padding: "12px 16px", borderRadius: 10, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", marginBottom: 12, boxSizing: "border-box" }} />
            {searchQuery.trim() && (
              <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid #f1f5f9", borderRadius: 10, marginBottom: 12 }}>
                {filteredMetrics.length === 0 ? (
                  <div style={{ padding: 20, textAlign: "center", fontSize: 15, color: "#94a3b8" }}>{__('common.noMetrics', 'No metrics found')}</div>
                ) : filteredMetrics
                  .filter(m => isEquationMode ? !steps.some(s => s.metricLabel === m.metricLabel) : !attachedMetrics.some(a => a.metricLabel === m.metricLabel))
                  .slice(0, 8)
                  .map((m, i) => (
                    <div key={i} onClick={() => {
                      if (isEquationMode) { setConfigMetric({ sectionLabel: m.sectionLabel, metricLabel: m.metricLabel }); setSearchQuery(""); }
                      else { setAttachedMetrics(p => [...p, { sectionLabel: m.sectionLabel, metricLabel: m.metricLabel, trackingMode: "average" }]); setSearchQuery(""); }
                    }} style={{ padding: "12px 14px", borderBottom: i < Math.min(filteredMetrics.length, 8) - 1 ? "1px solid #f1f5f9" : "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, fontSize: 15, color: "#1a2332" }}>
                      <span style={{ width: 10, height: 10, borderRadius: "50%", background: MS[m.color].bg, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontWeight: 500 }}>{m.metricLabel}</span>
                      <span style={{ color: "#94a3b8", fontSize: 15 }}>{m.value}</span>
                      <span style={{ fontSize: 15, color: "#3B82F6", fontWeight: 600, flexShrink: 0 }}>{isEquationMode ? "Select →" : "+ Attach"}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 8 }}>
          <button onClick={() => setPage(0)} style={{ padding: "10px 24px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>← Back</button>
          <button onClick={() => setPage(2)} disabled={!step2Complete} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: step2Complete ? "linear-gradient(135deg,#3B82F6,#06B6D4)" : "#e2e8f0", color: "#fff", fontSize: 15, fontWeight: 600, cursor: step2Complete ? "pointer" : "default" }}>
            {step2Complete ? "Next →" : isEquationMode ? "Add at least one step" : "Attach at least one metric"}
          </button>
        </div>
      </div>
    );
  };

  const renderPage2 = () => (
    <div style={{ maxWidth: 480, margin: "0 auto" }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#1a2332", marginBottom: 4, textAlign: "center" }}>AI Projections</div>
      <div style={{ fontSize: 15, color: "#64748b", marginBottom: 24, textAlign: "center" }}>Choose how far back to analyze</div>

      <div style={{ background: "#F8FAFC", borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <IconGlyph name="Star" size={20} color="#F5A623" weight="fill" />
          <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332" }}>{__('common.projectionsFilter', 'Projections Filter')}</div>
        </div>
        <select value={aiFilter} onChange={e => setAiFilter(e.target.value)} style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", marginBottom: 12 }}>
          <option value="3months">{__('common.past3Months', 'Past 3 Months')}</option>
          <option value="7days">{__('common.past7Days', 'Past 7 Days')}</option>
          <option value="1year">{__('common.pastYear', 'Past Year')}</option>
          <option value="alltime">All Time</option>
        </select>
        <div style={{ fontSize: 15, color: "#64748b", lineHeight: 1.5, fontStyle: "italic" }}>
          AI projections will analyze your past data and tasks to predict future trends and keep your business on track.
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
        <button onClick={() => setPage(1)} style={{ padding: "10px 24px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>← Back</button>
        <button onClick={() => setPage(3)} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{__('common.next', 'Next →')}</button>
      </div>
    </div>
  );

  const renderPage3 = () => (
    <div style={{ maxWidth: 520, margin: "0 auto" }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#1a2332", marginBottom: 4, textAlign: "center" }}>{__('common.reviewGoal', 'Review Your Goal')}</div>
      <div style={{ fontSize: 15, color: "#64748b", marginBottom: 24, textAlign: "center" }}>Check everything looks right before saving</div>

      {/* Goal header */}
      <div style={{ background: "#fff", borderRadius: 12, border: "1.5px solid #e2e8f0", padding: 18, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ flex: 1, fontSize: 16, fontWeight: 700, color: "#1a2332" }}>{goalName || "Untitled Goal"}</span>
          <div onClick={() => setPage(0)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 2, color: "#94a3b8", fontSize: 15 }}><IconGlyph name="PencilSimple" size={12} color="#94a3b8" /> Edit</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ height: 24, flex: 1, borderRadius: 99, background: "#e5e7eb", overflow: "hidden" }}>
            <div style={{ width: `${0}%`, height: "100%", borderRadius: 99, background: "#94a3b8" }} />
          </div>
          {dueDate && <span style={{ fontSize: 15, color: "#94a3b8" }}>{__('common.due', 'Due')}: {dueDate}</span>}
          <div onClick={() => setPage(0)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 2, color: "#94a3b8", fontSize: 15 }}><IconGlyph name="PencilSimple" size={12} color="#94a3b8" /></div>
        </div>
      </div>

      {/* Metrics tracking */}
      <div style={{ background: "#fff", borderRadius: 12, border: "1.5px solid #e2e8f0", padding: 18, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: "#1a2332" }}>{__('goal.metricsTracking', 'Metrics Tracking This Goal')}</span>
          <div onClick={() => setPage(1)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 2, color: "#94a3b8", fontSize: 15 }}><IconGlyph name="PencilSimple" size={12} color="#94a3b8" /> Edit</div>
        </div>
        {(goalType === "equation" ? steps : attachedMetrics).length === 0 ? (
          <div style={{ fontSize: 15, color: "#94a3b8", padding: "8px 0" }}>{__('common.noMetricsAttached', 'No metrics attached yet')}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(goalType === "equation" ? steps : attachedMetrics).map((item: any, i: number) => {
              const m = findMetricByLabel(sections, item.sectionLabel, item.metricLabel);
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#F8FAFC", borderRadius: 8, fontSize: 15 }}>
                  <span style={{ width: 24, height: 24, borderRadius: "50%", background: "#3B82F6", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
                  <span style={{ flex: 1, color: "#1a2332" }}>{m?.label ?? item.metricLabel}</span>
                  {goalType === "equation" && <span style={{ color: "#64748b", fontSize: 15 }}>{formatTarget((item as GoalStep).target)}</span>}
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
          <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: "#1a2332" }}>{__('common.projections', 'Projections')}</span>
          <span style={{ fontSize: 15, color: "#64748b" }}>{aiFilter === "3months" ? "Past 3 Months" : aiFilter === "7days" ? "Past 7 Days" : aiFilter === "1year" ? "Past Year" : "All Time"}</span>
          <div onClick={() => setPage(2)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 2, color: "#94a3b8", fontSize: 15 }}><IconGlyph name="PencilSimple" size={12} color="#94a3b8" /> Edit</div>
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
        <button onClick={() => setPage(2)} style={{ padding: "10px 24px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>← Back</button>
        <button onClick={handleFinish} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{__('common.saveGoal', 'Save Goal')}</button>
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

export function GoalSettingsModal({ goal, sections, isMobile, onSave, onDuplicate, onDelete, onClose }: { goal: Goal; sections: Section[]; isMobile?: boolean; onSave: (g: Goal) => void; onDuplicate: (g: Goal) => void; onDelete: (id: string) => void; onClose: () => void }) {
  const { t: __ } = useTranslation();
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
    if (configTargetType === "percentage" && !configPct.trim()) return;
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
      <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332", marginBottom: 10 }}>Target for: <span style={{ color: "#3B82F6" }}>{configMetric?.metricLabel}</span></div>
      <select value={configTargetType} onChange={e => setConfigTargetType(e.target.value as GoalTargetType)} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", marginBottom: 10 }}>
        <option value="color_rule">{__('common.colorRule', 'Color Rule')}</option>
        <option value="number_reach">{__('common.numberReached', 'Number Reached')}</option>
        <option value="number_range">{__('common.numberRangeReached', 'Number Range Reached')}</option>
        <option value="percentage">{__('common.percentageReached', 'Percentage Reached')}</option>
      </select>
      {configTargetType === "number_reach" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <select value={configOp} onChange={e => setConfigOp(e.target.value as RuleOp)} style={{ padding: "6px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }}>
            {[">=", "<=", ">", "<", "==", "!="].map(op => <option key={op} value={op}>{op}</option>)}
          </select>
          <input value={configVal} onChange={e => setConfigVal(e.target.value)} type="number" placeholder="Value" style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }} />
        </div>
      )}
      {configTargetType === "number_range" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <input value={configVal} onChange={e => setConfigVal(e.target.value)} type="number" placeholder="Min" style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }} />
          <span style={{ color: "#94a3b8" }}>to</span>
          <input value={configVal2} onChange={e => setConfigVal2(e.target.value)} type="number" placeholder="Max" style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }} />
        </div>
      )}
      {configTargetType === "percentage" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 15, color: "#64748b" }}>≥</span>
          <input value={configPct} onChange={e => setConfigPct(e.target.value)} type="number" placeholder="e.g. 80%" style={{ width: 120, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }} />
          <span style={{ fontSize: 15, color: "#64748b" }}>% health</span>
        </div>
      )}
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{ padding: "6px 14px", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>{__('common.cancel', 'Cancel')}</button>
        <button onClick={() => {
          let target: GoalTarget;
          if (configTargetType === "percentage" && !configPct.trim()) return;
          if (configTargetType === "number_reach") target = { type: "number_reach", operator: configOp, value: parseFloat(configVal) || 0 };
          else if (configTargetType === "number_range") target = { type: "number_range", value: parseFloat(configVal) || 0, value2: parseFloat(configVal2) || 0 };
          else if (configTargetType === "percentage") target = { type: "percentage", percent: Math.min(100, Math.max(0, parseInt(configPct) || 100)) };
          else target = { type: "color_rule" };
          onConfirm(target);
        }} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{__('common.addStep', 'Add Step')}</button>
      </div>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: isMobile ? "#fff" : "rgba(0,0,0,0.15)", display: "flex", flexDirection: "column" }}>
      <div style={{ background: "#fff", flex: 1, overflowY: "auto", width: "100%", padding: isMobile ? "20px 16px" : "clamp(24px,4vw,40px)", borderRadius: isMobile ? 0 : 20, maxWidth: isMobile ? "100%" : 640, margin: isMobile ? 0 : "auto", maxHeight: isMobile ? "100dvh" : "90vh", boxShadow: isMobile ? "none" : "0 25px 50px rgba(0,0,0,0.15)" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <button onClick={handleClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#64748b", padding: 0 }}>×</button>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2332", flex: 1 }}>{__('goal.settings', 'Goal Settings')}</div>
        </div>

        {/* Name & Due Date */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>{__('common.label', 'LABEL')}</div>
            <input value={edited.label} onChange={e => setEdited(p => ({ ...p, label: e.target.value }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>{__('common.dueDate', 'DUE DATE')}</div>
            <input value={edited.due} onChange={e => setEdited(p => ({ ...p, due: e.target.value }))} type="date" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
          </div>
        </div>

        {/* Type & Status */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>{__('goal.type', 'TYPE')}</div>
            <select value={edited.type} onChange={e => setEdited(p => ({ ...p, type: e.target.value as GoalType }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }}>
              <option value="equation">{__('goal.equationGoal', 'Equation Goal')}</option>
              <option value="metric">{__('goal.metricGoal', 'Metric Goal')}</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>{__('goal.status', 'STATUS')}</div>
            <select value={edited.status} onChange={e => setEdited(p => ({ ...p, status: e.target.value as GoalStatus }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }}>
              <option value="active">Active</option>
              <option value="drafted">{__('common.drafted', 'Drafted')}</option>
              <option value="completed">Completed</option>
            </select>
          </div>
        </div>

        {/* Steps section (for equation type) */}
        {edited.type === "equation" && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 6 }}>{__('goal.steps', 'STEPS')} ({edited.steps.length})</div>
            {edited.steps.map((s, i) => {
              const m = findMetricByLabel(sections, s.sectionLabel, s.metricLabel);
              const met = evaluateGoalStep(s, sections);
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: met ? "#ECFDF5" : "#FEF2F2", borderRadius: 8, marginBottom: 4, fontSize: 15 }}>
                  <span style={{ fontWeight: 600, color: "#3B82F6", minWidth: 20 }}>{i + 1}.</span>
                  <span style={{ flex: 1, color: "#1a2332" }}>{m?.label ?? s.metricLabel}</span>
                  <span style={{ color: "#64748b", fontSize: 15 }}>{formatTarget(s.target)}</span>
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
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search to add a metric step..." style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
                {searchQuery.trim() && (
                  <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid #f1f5f9", borderRadius: 8, marginTop: 4 }}>
                    {filteredMetrics.length === 0 ? (
                      <div style={{ padding: 14, textAlign: "center", fontSize: 15, color: "#94a3b8" }}>{__('common.noMetrics', 'No metrics found')}</div>
                    ) : filteredMetrics.map((m, i) => (
                      <div key={i} onClick={() => { setConfigMetric({ sectionLabel: m.sectionLabel, metricLabel: m.metricLabel }); setSearchQuery(""); }} style={{ padding: "8px 12px", borderBottom: i < filteredMetrics.length - 1 ? "1px solid #f1f5f9" : "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, fontSize: 15, color: "#1a2332" }}>
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
            <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 6 }}>ATTACHED METRICS</div>
            {edited.attachedMetrics.map((a, i) => {
              const m = findMetricByLabel(sections, a.sectionLabel, a.metricLabel);
              const health = m ? computeMetricHealth(m) : 0;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#F8FAFC", borderRadius: 8, marginBottom: 4, fontSize: 15 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: health >= 80 ? "#4CAF7D" : health >= 50 ? "#F5A623" : "#E85D75", flexShrink: 0 }} />
                  <span style={{ flex: 1, color: "#1a2332" }}>{m?.label ?? a.metricLabel}</span>
                  <span style={{ color: "#64748b", fontSize: 15 }}>{health}%</span>
                  <select value={a.trackingMode} onChange={e => { const v = e.target.value as GoalTrackingMode; setEdited(p => ({ ...p, attachedMetrics: p.attachedMetrics.map((x, j) => j === i ? { ...x, trackingMode: v } : x) })); }} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 15, outline: "none" }}>
                    <option value="average">Average</option>
                    <option value="off">{__('common.off', 'Off')}</option>
                    <option value="direct">{__('common.direct', 'Direct')}</option>
                    <option value="health_over_time">{__('goal.healthOverTime', 'Health Over Time')}</option>
                  </select>
                  <span onClick={() => setEdited(p => ({ ...p, attachedMetrics: p.attachedMetrics.filter((_, j) => j !== i) }))} style={{ cursor: "pointer", color: "#E85D75", fontSize: 16 }}>×</span>
                </div>
              );
            })}
            <div style={{ marginTop: 8 }}>
              <input value={searchQuery} onChange={e => { setSearchQuery(e.target.value); }} placeholder="Start typing the name of a metric box..." style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
              {searchQuery.trim() && (
                <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid #f1f5f9", borderRadius: 8, marginTop: 4 }}>
                  {filteredMetrics.filter(m => !edited.attachedMetrics.some(a => a.metricLabel === m.metricLabel)).length === 0 ? (
                    <div style={{ padding: 14, textAlign: "center", fontSize: 15, color: "#94a3b8" }}>{__('common.noMetrics', 'No metrics found')}</div>
                  ) : filteredMetrics.filter(m => !edited.attachedMetrics.some(a => a.metricLabel === m.metricLabel)).map((mmm, i) => (
                    <div key={i} onClick={() => { setEdited(p => ({ ...p, attachedMetrics: [...p.attachedMetrics, { sectionLabel: mmm.sectionLabel, metricLabel: mmm.metricLabel, trackingMode: "average" }] })); setSearchQuery(""); }} style={{ padding: "8px 12px", borderBottom: i < filteredMetrics.length - 1 ? "1px solid #f1f5f9" : "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, fontSize: 15, color: "#1a2332" }}>
                      <span style={{ width: 10, height: 10, borderRadius: "50%", background: MS[mmm.color].bg, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontWeight: 500 }}>{mmm.metricLabel}</span>
                      <span style={{ color: "#94a3b8", fontSize: 15 }}>{mmm.value}</span>
                      <span style={{ fontSize: 15, color: "#3B82F6", fontWeight: 600, flexShrink: 0 }}>+ Attach</span>
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
            <span style={{ fontSize: 15, fontWeight: 600, color: "#64748b" }}>{__('common.progressPreview', 'Progress Preview')}</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: liveBarColor === "green" ? "#4CAF7D" : liveBarColor === "yellow" ? "#F5A623" : "#E85D75" }}>{livePct}%</span>
          </div>
          <div style={{ height: 24, borderRadius: 99, background: "#e5e7eb", overflow: "hidden" }}>
            <div style={{ width: `${livePct}%`, height: "100%", borderRadius: 99, background: liveBarColor === "green" ? "#4CAF7D" : liveBarColor === "yellow" ? "#F5A623" : "#E85D75", transition: "width 0.3s" }} />
          </div>
        </div>

        {/* Save */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
          <button onClick={handleClose} style={{ padding: "10px 24px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>{__('common.cancel', 'Cancel')}</button>
          <button onClick={saveGoal} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{__('common.save', 'Save')}</button>
        </div>

        {/* Duplicate & Delete as links (like MetricBoxSettingsModal) */}
        <div style={{ display: "flex", justifyContent: "center", gap: 20, marginTop: 18, paddingTop: 18, borderTop: "1px solid #f1f5f9" }}>
          <div onClick={() => { onDuplicate(makeGoal({ ...edited, label: edited.label + " (copy)", status: "drafted" })); }} style={{ fontSize: 15, color: "#3B82F6", cursor: "pointer", fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>
            <IconGlyph name="Copy" size={14} color="#3B82F6" /> Duplicate Goal
          </div>
          <div onClick={() => { if (confirm("Delete this goal?")) { onDelete(edited.id); onClose(); } }} style={{ fontSize: 15, color: "#E85D75", cursor: "pointer", fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>
            <IconGlyph name="Trash" size={14} color="#E85D75" /> Delete Goal
          </div>
        </div>
      </div>
    </div>
  );
}
