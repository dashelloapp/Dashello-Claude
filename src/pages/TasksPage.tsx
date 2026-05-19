import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { Task, OrgMember, TeamRow, Section, Goal, Metric, MetricColor, MetricModalData } from "../types";
import { resolveColor } from "../utils/helpers";
import { IconGlyph } from "../components/shared";
import { useTranslation } from "../i18n";

const _months = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "Jun.", "Jul.", "Aug.", "Sep.", "Oct.", "Nov.", "Dec."];
function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return `${_months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE: TASKS (lines 4146–4599)
// ═══════════════════════════════════════════════════════════════════════════

function TasksPage({ tasks, setTasks, userEmail, orgMembers, teamRows, sections, goals, onViewMetric, onViewGoal, onViewDecision, onViewTeamMember, timezone, healthBarColor }: {
  tasks: Task[]; setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  userEmail: string; orgMembers: OrgMember[]; teamRows: TeamRow[];
  sections: Section[]; goals: Goal[];
  onViewMetric: (id: string) => void; onViewGoal: (id: string) => void; onViewDecision?: () => void;
  onViewTeamMember: (m: OrgMember) => void; timezone: string; healthBarColor?: MetricColor;
}) {
  const { t: __ } = useTranslation();
  const pc = ({ green: { bg: "#F0FDF4", border: "#4CAF7D", accent: "#4CAF7D" }, yellow: { bg: "#FFF8ED", border: "#F5A623", accent: "#F5A623" }, red: { bg: "#FEF2F2", border: "#E85D75", accent: "#E85D75" }, gray: { bg: "#FFF8ED", border: "#F5A623", accent: "#F5A623" } } as Record<string, { bg: string; border: string; accent: string }>)[healthBarColor || "yellow"]!;
  const [showAdd, setShowAdd] = useState(false);
  const [taskFilter, setTaskFilter] = useState<"current" | "completed">("current");
  const [menuTaskId, setMenuTaskId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [inlineAddText, setInlineAddText] = useState("");
  const [showAddPriority, setShowAddPriority] = useState(false);
  const [priorityAddText, setPriorityAddText] = useState("");
  const [taskTabFilter, setTaskTabFilter] = useState<string | null>(null);
  const dragTaskRef = useRef<string | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
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

  const lastToggledRef = useRef<string | null>(null);

  const toggle = (id: string) => {
    lastToggledRef.current = id;
    setTasks(tasks.map(t => t.id === id ? { ...t, done: !t.done } : t));
    setMenuTaskId(null);
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && lastToggledRef.current) {
        toggle(lastToggledRef.current);
        lastToggledRef.current = null;
      }
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [tasks]);
  const handleTaskDragStart = (id: string) => { dragTaskRef.current = id; };
  const handleTaskDragOver = (targetId: string) => { if (dragTaskRef.current && dragTaskRef.current !== targetId) setDragOverTaskId(targetId); };
  const handleTaskDrop = (targetId: string) => {
    const from = dragTaskRef.current;
    if (!from || from === targetId) { dragTaskRef.current = null; setDragOverTaskId(null); return; }
    setTasks(prev => {
      const arr = [...prev];
      const fi = arr.findIndex(t => t.id === from);
      const ti = arr.findIndex(t => t.id === targetId);
      if (fi === -1 || ti === -1) return prev;
      const targetPriority = arr[ti].priority;
      const [moved] = arr.splice(fi, 1);
      const insertAt = fi < ti ? ti - 1 : ti;
      arr.splice(insertAt, 0, { ...moved, priority: targetPriority });
      return arr;
    });
    dragTaskRef.current = null; setDragOverTaskId(null);
  };
  const handlePriorityZoneDrop = () => {
    const from = dragTaskRef.current;
    if (from) { setTasks(prev => prev.map(t => t.id === from ? { ...t, priority: true } : t)); }
    dragTaskRef.current = null; setDragOverTaskId(null);
  };
  const handleRegularZoneDrop = () => {
    const from = dragTaskRef.current;
    if (from) { setTasks(prev => prev.map(t => t.id === from ? { ...t, priority: false } : t)); }
    dragTaskRef.current = null; setDragOverTaskId(null);
  };
  const myTasks = tasks.filter(t => t.assignedTo === userEmail);
  const priorityTasks = myTasks.filter(t => t.priority && !t.done);
  const nonPriority = myTasks.filter(t => !t.priority);
  const currentTasks = nonPriority.filter(t => !t.done);
  const completedTasks = myTasks.filter(t => t.done);
  const doneCount = completedTasks.length;
  const totalCount = myTasks.length;
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  const metricTabs = sections.flatMap(s => s.metrics.filter(m => myTasks.some(t => t.linkedMetricId === m.id)).map(m => ({ id: m.id, label: m.label, type: "metric" as const })));
  const hasGoalTasks = myTasks.some(t => t.linkedGoalId);
  const allTabs = [...metricTabs, ...(hasGoalTasks ? [{ id: "goals", label: "Goals", type: "goal" as const }] : [])];
  const activeTab = taskTabFilter || "all";
  const tabFiltered = taskTabFilter ? (
    taskTabFilter === "goal:goals" ? nonPriority.filter(t => t.linkedGoalId) :
    taskTabFilter.startsWith("metric:") ? nonPriority.filter(t => t.linkedMetricId === taskTabFilter.replace("metric:", "")) :
    nonPriority
  ) : nonPriority;

  const displayedTasks = taskFilter === "current" ? tabFiltered.filter(t => !t.done) : (taskFilter === "completed" ? myTasks.filter(t => t.done) : tabFiltered.filter(t => t.done));

  const handleInlineAdd = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || !inlineAddText.trim()) return;
    setTasks(prev => [...prev, {
      id: crypto.randomUUID(), text: inlineAddText.trim(), done: false,
      assignedTo: userEmail, createdBy: userEmail, createdAt: new Date().toISOString(),
    }]);
    setInlineAddText("");
  };

  const getMemberByEmail = (email: string) => orgMembers.find(m => m.email === email);
  const todayStr = timezone ? new Date().toLocaleDateString("en-CA", { timeZone: timezone }) : new Date().toISOString().split("T")[0];

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
    <div style={{ padding: "clamp(16px,4vw,32px)", boxSizing: "border-box", width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: "clamp(20px,4vw,26px)", fontWeight: 700, color: "#1a2332" }}>{__('common.tasks', 'Tasks')}</h1>
        <div style={{ marginLeft: "auto" }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))", gap: "clamp(12px,2vw,20px)", alignItems: "start" }}>
        {/* ── Left Column ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Your Tasks */}
          <div style={{ background: "#fff", borderRadius: 16, padding: "20px", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#1a2332", flex: 1 }}>{__('common.yourTasks', 'Your Tasks')}</h2>
              <div style={{ fontSize: 15, color: "#94a3b8" }}>{__('common.overallProgress', 'Overall Progress')}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#4CAF7D" }}>{doneCount}/{totalCount}</div>
            </div>
            {/* Progress bar */}
            <div style={{ height: 8, borderRadius: 99, background: "#e2e8f0", marginBottom: 16, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", borderRadius: 99, background: "#4CAF7D", transition: "width 0.3s" }} />
            </div>
            {/* Priorities */}
            {priorityTasks.length > 0 && (
              <div style={{ marginBottom: 12 }}
                onDragOver={e => e.preventDefault()} onDrop={handlePriorityZoneDrop}>
                <div style={{ fontSize: 15, fontWeight: 700, color: pc.accent, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  <span>★ {__('common.priorities', 'Priorities')}</span>
                  <span style={{ fontSize: 15, fontWeight: 500, color: "#94a3b8", background: "#f1f5f9", padding: "1px 8px", borderRadius: 99 }}>{priorityTasks.length}</span>
                </div>
                {priorityTasks.map(t => {
                  const assigneeMember = getMemberByEmail(t.assignedTo);
                  const isEditing = editingTaskId === t.id;
                  const isDueToday = t.dueDate === todayStr;
                  const isPastDue = !t.done && !!t.dueDate && t.dueDate < todayStr && !isDueToday;
                  return (
                    <div key={t.id} draggable onDragStart={() => handleTaskDragStart(t.id)} onDragOver={e => { e.preventDefault(); handleTaskDragOver(t.id); }} onDragLeave={() => setDragOverTaskId(null)} onDrop={e => { e.stopPropagation(); handleTaskDrop(t.id); }} onDragEnd={() => { dragTaskRef.current = null; setDragOverTaskId(null); }}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 8, background: isPastDue ? "#FEF2F2" : pc.bg, border: isPastDue && dragOverTaskId !== t.id ? "1px solid #FECACA" : dragOverTaskId === t.id ? "2px dashed #3B82F6" : `1px solid ${pc.border}`, marginBottom: 6, fontSize: 15 }}>
                      <div style={{ cursor: "grab", color: "#cbd5e1", fontSize: 15, lineHeight: 1, letterSpacing: 1, flexShrink: 0, userSelect: "none" }} title="Drag to reorder">⠿</div>
                      <div onClick={() => toggle(t.id)} style={{ width: 24, height: 24, borderRadius: "50%", flexShrink: 0, cursor: "pointer", border: t.done ? "none" : `2px solid ${pc.accent}`, background: t.done ? "#4CAF7D" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 15 }}>{t.done ? "✓" : ""}</div>
                      {isEditing ? (
                        <input value={editText} onChange={e => setEditText(e.target.value)}
                          onBlur={() => { if (editText.trim()) setTasks(prev => prev.map(x => x.id === t.id ? { ...x, text: editText.trim() } : x)); setEditingTaskId(null); }}
                          onKeyDown={e => { if (e.key === "Enter") { if (editText.trim()) setTasks(prev => prev.map(x => x.id === t.id ? { ...x, text: editText.trim() } : x)); setEditingTaskId(null); } }}
                          autoFocus style={{ flex: 1, padding: "4px 8px", borderRadius: 6, border: `1.5px solid ${pc.accent}`, fontSize: 15, outline: "none" }} />
                      ) : (
                        <div onClick={() => { setEditingTaskId(t.id); setEditText(t.text); setMenuTaskId(null); }} style={{ flex: 1, fontSize: 15, color: "#1a2332", fontWeight: 600, textDecoration: t.done ? "line-through" : "none", minWidth: 0, cursor: "text" }}>{t.text}</div>
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, position: "relative" }}>
                        {t.dueDate && <div style={{ fontSize: 15, color: isPastDue ? "#E85D75" : isDueToday ? "#F5A623" : "#94a3b8", fontWeight: isPastDue || isDueToday ? 600 : 400, whiteSpace: "nowrap" }}>{isPastDue ? "Past Due" : isDueToday ? "Due Today" : formatDate(t.dueDate)}</div>}
                        {(t.linkedMetricId || t.linkedGoalId || t.linkedDecisionId) && (
                          <div style={{ display: "flex", gap: 4 }}>
                            {t.linkedMetricId && <div onClick={() => onViewMetric(t.linkedMetricId!)} style={{ width: 22, height: 22, borderRadius: "50%", background: "#EFF6FF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                              <IconGlyph name="Eye" size={12} color="#3B82F6" />
                            </div>}
                            {t.linkedGoalId && <div onClick={() => onViewGoal(t.linkedGoalId!)} style={{ width: 22, height: 22, borderRadius: "50%", background: "#F3F0FF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                              <IconGlyph name="Target" size={12} color="#7B68EE" />
                            </div>}
                            {t.linkedDecisionId && <div onClick={() => onViewDecision?.()} style={{ width: 22, height: 22, borderRadius: "50%", background: "#FFF8ED", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                              <IconGlyph name="Funnel" size={12} color="#F5A623" weight="fill" />
                            </div>}
                          </div>
                        )}
                        <div onClick={(e) => { menuTriggerElRef.current = e.currentTarget as HTMLElement; setMenuTaskId(menuTaskId === t.id ? null : t.id); }} style={{ width: 24, height: 24, borderRadius: "50%", background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 15, color: "#94a3b8", flexShrink: 0 }}>···</div>
                        {menuTaskId === t.id && (
                          <div ref={menuRef} style={{ ...menuPos, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid #e2e8f0", zIndex: 100, minWidth: 160, overflow: "hidden" }}>
                            <div style={{ padding: "8px 12px", fontSize: 15, fontWeight: 600, color: "#64748b", borderBottom: "1px solid #f1f5f9" }}>{__('common.assignTo', 'Assign To')}</div>
                            {orgMembers.filter(m => m.status === "active").map(m => (
                              <div key={m.id} onClick={() => { setTasks(prev => prev.map(x => x.id === t.id ? { ...x, assignedTo: m.email } : x)); setMenuTaskId(null); }}
                                style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", cursor: "pointer", background: t.assignedTo === m.email ? "#EFF6FF" : "transparent" }}
                                onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                                onMouseLeave={e => e.currentTarget.style.background = t.assignedTo === m.email ? "#EFF6FF" : "transparent"}>
                                {m.avatarUrl ? <img src={m.avatarUrl} alt="" style={{ width: 18, height: 18, borderRadius: "50%", objectFit: "cover" }} />
                                  : <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: "#94a3b8" }}>{(m.name?.[0] || m.email[0] || "?").toUpperCase()}</div>}
                                <span style={{ fontSize: 15, color: "#1a2332", flex: 1 }}>{m.name || m.email.split("@")[0]}</span>
                                {t.assignedTo === m.email && <span style={{ fontSize: 15, color: "#3B82F6" }}>✓</span>}
                              </div>
                            ))}
                            <div style={{ borderTop: "1px solid #f1f5f9" }}>
                              <div style={{ padding: "7px 12px", fontSize: 15, fontWeight: 600, color: "#64748b" }}>{__('common.dueDate', 'Due Date')}</div>
                              <div style={{ padding: "0 12px 7px" }}>
                                <input type="date" value={t.dueDate || ""} onChange={e => { setTasks(prev => prev.map(x => x.id === t.id ? { ...x, dueDate: e.target.value || undefined } : x)); setMenuTaskId(null); }}
                                  style={{ width: "100%", padding: "4px 6px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
                              </div>
                            </div>
                            <div onClick={() => { setTasks(prev => prev.filter(x => x.id !== t.id)); setMenuTaskId(null); }}
                              style={{ padding: "8px 12px", fontSize: 15, cursor: "pointer", color: "#E85D75", borderTop: "1px solid #f1f5f9" }}
                              onMouseEnter={e => e.currentTarget.style.background = "#fff5f5"}
                              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>{__('common.delete', 'Delete')}</div>
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
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", marginBottom: 12, background: pc.bg, borderRadius: 8, border: `1px solid ${pc.border}` }}>
                <div style={{ width: 24, height: 24, borderRadius: "50%", border: `2px solid ${pc.accent}`, flexShrink: 0 }} />
                <input value={priorityAddText} onChange={e => setPriorityAddText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && priorityAddText.trim()) { setTasks(prev => [...prev, { id: crypto.randomUUID(), text: priorityAddText.trim(), done: false, assignedTo: userEmail, createdBy: userEmail, createdAt: new Date().toISOString(), priority: true }]); setPriorityAddText(""); setShowAddPriority(false); } }}
                  placeholder={__('tasks.typePriority', 'Type priority and press Enter...')}
                  autoFocus
                  style={{ flex: 1, padding: "6px 8px", borderRadius: 6, border: `1.5px solid ${pc.accent}`, fontSize: 15, outline: "none" }} />
                <div onClick={() => { if (priorityAddText.trim()) { setTasks(prev => [...prev, { id: crypto.randomUUID(), text: priorityAddText.trim(), done: false, assignedTo: userEmail, createdBy: userEmail, createdAt: new Date().toISOString(), priority: true }]); setPriorityAddText(""); setShowAddPriority(false); } else { setShowAddPriority(false); } }}
                  style={{ fontSize: 15, color: pc.accent, cursor: "pointer", fontWeight: 600 }}>{__('common.done', 'Done')}</div>
              </div>
            ) : (
              <div onClick={() => setShowAddPriority(true)} style={{ display: "flex", alignItems: "center", gap: 8, color: pc.accent, fontSize: 15, cursor: "pointer", padding: "4px 0", marginBottom: 12, fontWeight: 500 }}>
                <span style={{ fontSize: 16 }}>+</span> {__('common.addPriority', 'Add Priority')}
              </div>
            )}
            {/* Filter tabs + metric/goal tabs */}
            <div style={{ display: "flex", gap: 6, marginBottom: 12, overflowX: "auto", flexWrap: "nowrap", paddingBottom: 2, scrollbarWidth: "thin" }}>
              <div onClick={() => setTaskFilter("current")} style={{ padding: "5px 14px", borderRadius: 20, fontSize: 15, fontWeight: 500, cursor: "pointer", background: taskFilter === "current" ? "#3B82F6" : "#f1f5f9", color: taskFilter === "current" ? "#fff" : "#64748b" }}>
                Current ({tabFiltered.filter(t => !t.done).length})
              </div>
              <div onClick={() => setTaskFilter("completed")} style={{ padding: "5px 14px", borderRadius: 20, fontSize: 15, fontWeight: 500, cursor: "pointer", background: taskFilter === "completed" ? "#3B82F6" : "#f1f5f9", color: taskFilter === "completed" ? "#fff" : "#64748b" }}>
                Completed ({myTasks.filter(t => t.done).length})
              </div>
              {allTabs.map(tab => {
                const isActive = activeTab === `${tab.type}:${tab.id}`;
                return (
                  <div key={`${tab.type}:${tab.id}`} onClick={() => setTaskTabFilter(isActive ? null : `${tab.type}:${tab.id}`)}
                    style={{ padding: "5px 14px", borderRadius: 20, fontSize: 15, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap",
                      background: isActive ? "#3B82F6" : "#f1f5f9", color: isActive ? "#fff" : "#64748b" }}>{tab.label}</div>
                );
              })}
            </div>
            {/* Task list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {displayedTasks.length === 0 && (
                <div style={{ fontSize: 15, color: "#cbd5e1", fontStyle: "italic", padding: "12px 0", textAlign: "center" }}>
                  {taskFilter === "current" ? "No current tasks. Add one below!" : "No completed tasks yet."}
                </div>
              )}
              {displayedTasks.map(t => {
                const assigneeMember = getMemberByEmail(t.assignedTo);
                const isEditing = editingTaskId === t.id;
                const isDueToday = t.dueDate === todayStr;
                const isPastDue = !t.done && !!t.dueDate && t.dueDate < todayStr && !isDueToday;
                return (
                  <div key={t.id} draggable onDragStart={() => handleTaskDragStart(t.id)} onDragOver={e => { e.preventDefault(); handleTaskDragOver(t.id); }} onDragLeave={() => setDragOverTaskId(null)} onDrop={e => { e.stopPropagation(); handleTaskDrop(t.id); }} onDragEnd={() => { dragTaskRef.current = null; setDragOverTaskId(null); }}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: t.done ? "#f8fafc" : isPastDue ? "#FEF2F2" : isDueToday ? "#EFF6FF" : "#fff", border: dragOverTaskId === t.id ? "2px dashed #3B82F6" : isPastDue && !t.done ? "1px solid #FECACA" : isDueToday && !t.done ? "1px solid #93C5FD" : "none", opacity: t.done ? 0.6 : 1 }}>
                    <div style={{ cursor: "grab", color: "#cbd5e1", fontSize: 15, lineHeight: 1, letterSpacing: 1, flexShrink: 0, userSelect: "none" }} title="Drag to reorder">⠿</div>
                    <div onClick={() => toggle(t.id)} style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, cursor: "pointer", border: t.done ? "none" : "1.5px solid #d1d5db", background: t.done ? "#4CAF7D" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 15 }}>{t.done ? "✓" : ""}</div>
                    {isEditing ? (
                      <input value={editText} onChange={e => setEditText(e.target.value)}
                        onBlur={() => { if (editText.trim()) setTasks(prev => prev.map(x => x.id === t.id ? { ...x, text: editText.trim() } : x)); setEditingTaskId(null); }}
                        onKeyDown={e => { if (e.key === "Enter") { if (editText.trim()) setTasks(prev => prev.map(x => x.id === t.id ? { ...x, text: editText.trim() } : x)); setEditingTaskId(null); } }}
                        autoFocus style={{ flex: 1, padding: "4px 8px", borderRadius: 6, border: "1.5px solid #3B82F6", fontSize: 15, outline: "none" }} />
                    ) : (
                      <div onClick={() => { setEditingTaskId(t.id); setEditText(t.text); setMenuTaskId(null); }} style={{ flex: 1, fontSize: 15, color: "#1a2332", textDecoration: t.done ? "line-through" : "none", minWidth: 0, cursor: "text" }}>{t.text}</div>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, position: "relative" }}>
                      {t.dueDate && <div style={{ fontSize: 15, color: isPastDue ? "#E85D75" : isDueToday ? "#3B82F6" : "#94a3b8", fontWeight: isPastDue || isDueToday ? 600 : 400, whiteSpace: "nowrap" }}>{isPastDue ? "Past Due" : isDueToday ? "Due Today" : formatDate(t.dueDate)}</div>}
                      {(t.linkedMetricId || t.linkedGoalId || t.linkedDecisionId) && (
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
                          {t.linkedDecisionId && (
                            <div onClick={() => onViewDecision?.()} style={{ width: 22, height: 22, borderRadius: "50%", background: "#FFF8ED", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                              <IconGlyph name="Funnel" size={12} color="#F5A623" weight="fill" />
                            </div>
                          )}
                        </div>
                      )}
                      {/* Three-dot menu */}
                      <div onClick={(e) => { menuTriggerElRef.current = e.currentTarget as HTMLElement; setMenuTaskId(menuTaskId === t.id ? null : t.id); }} style={{ width: 24, height: 24, borderRadius: "50%", background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 15, color: "#94a3b8", flexShrink: 0 }}>···</div>
                      {menuTaskId === t.id && (
                        <div ref={menuRef} style={{ ...menuPos, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid #e2e8f0", zIndex: 100, minWidth: 160, overflow: "hidden" }}>
                          <div style={{ padding: "8px 12px", fontSize: 15, fontWeight: 600, color: "#64748b", borderBottom: "1px solid #f1f5f9" }}>{__('common.assignTo', 'Assign To')}</div>
                          {orgMembers.filter(m => m.status === "active").map(m => (
                            <div key={m.id} onClick={() => { setTasks(prev => prev.map(x => x.id === t.id ? { ...x, assignedTo: m.email } : x)); setMenuTaskId(null); }}
                              style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", cursor: "pointer", background: t.assignedTo === m.email ? "#EFF6FF" : "transparent" }}
                              onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                              onMouseLeave={e => e.currentTarget.style.background = t.assignedTo === m.email ? "#EFF6FF" : "transparent"}>
                              {m.avatarUrl ? <img src={m.avatarUrl} alt="" style={{ width: 20, height: 20, borderRadius: "50%", objectFit: "cover" }} />
                                : <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: "#94a3b8" }}>{(m.name?.[0] || m.email[0] || "?").toUpperCase()}</div>}
                              <span style={{ fontSize: 15, color: "#1a2332", flex: 1 }}>{m.name || m.email.split("@")[0]}</span>
                              {t.assignedTo === m.email && <span style={{ fontSize: 15, color: "#3B82F6" }}>✓</span>}
                            </div>
                          ))}
                          <div style={{ borderTop: "1px solid #f1f5f9" }}>
                            <div style={{ padding: "8px 12px", fontSize: 15, fontWeight: 600, color: "#64748b" }}>{__('common.dueDate', 'Due Date')}</div>
                            <div style={{ padding: "0 12px 8px" }}>
                              <input type="date" value={t.dueDate || ""} onChange={e => { setTasks(prev => prev.map(x => x.id === t.id ? { ...x, dueDate: e.target.value || undefined } : x)); setMenuTaskId(null); }}
                                style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
                            </div>
                          </div>
                          <div onClick={() => { setTasks(prev => prev.filter(x => x.id !== t.id)); setMenuTaskId(null); }}
                            style={{ padding: "9px 12px", fontSize: 15, cursor: "pointer", color: "#E85D75", borderTop: "1px solid #f1f5f9" }}
                            onMouseEnter={e => e.currentTarget.style.background = "#fff5f5"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>{__('common.delete', 'Delete')}</div>
                        </div>
                      )}
                      {/* Profile photo */}
                      {assigneeMember && (
                        assigneeMember.avatarUrl
                          ? <img src={assigneeMember.avatarUrl} alt="" style={{ width: 24, height: 24, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                          : <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: "#94a3b8", flexShrink: 0 }}>
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
                    style={{ flex: 1, padding: "6px 8px", borderRadius: 6, border: "1.5px solid #3B82F6", fontSize: 15, outline: "none" }} />
                  <div onClick={() => { if (inlineAddText.trim()) { handleInlineAdd({ key: "Enter" } as any); } else { setShowAdd(false); } }}
                    style={{ fontSize: 15, color: "#3B82F6", cursor: "pointer", fontWeight: 600 }}>{__('common.done', 'Done')}</div>
                </div>
              )}
            </div>
            {taskFilter === "completed" && completedTasks.length > 0 && (
              <div onClick={() => { if (confirm("Delete all completed tasks?")) setTasks(prev => prev.filter(t => !(t.assignedTo === userEmail && t.done))); }}
                style={{ display: "flex", alignItems: "center", gap: 6, color: "#E85D75", fontSize: 15, cursor: "pointer", padding: "8px 0 0", marginTop: 10 }}>
                <IconGlyph name="Archive" size={14} color="#E85D75" /> Archive & Delete
              </div>
            )}
            <div onClick={() => { setShowAdd(true); setTaskFilter("current"); }} style={{ display: "flex", alignItems: "center", gap: 8, color: "#94a3b8", fontSize: 15, cursor: "pointer", padding: "8px 0 0", marginTop: 10 }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", border: "1.5px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: "#94a3b8" }}>+</div>
              Add New Task
            </div>
          </div>

          {/* Suggested Tasks */}
          <div style={{ background: "linear-gradient(135deg,#EFF6FF,#F0FDF4)", borderRadius: 16, border: "1px solid #e2e8f0", padding: "20px", display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332", marginBottom: 4 }}>{__('common.suggestedTasks', 'Suggested Tasks ✦')}</div>
            <div style={{ fontSize: 15, color: "#64748b", marginBottom: 12, lineHeight: 1.5 }}>
              These AI tasks are from the metric boxes you have access to. They recommend next steps for your business based on your data to increase the health score of your business.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {suggestedTasks.length === 0 && (
                <div style={{ fontSize: 15, color: "#cbd5e1", fontStyle: "italic", padding: "12px 0", textAlign: "center" }}>{__('common.noAISuggestions', 'No AI suggestions yet. Use metric boxes to generate them.')}</div>
              )}
              {suggestedTasks.slice(0, 10).map((st, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                  <div onClick={() => addSuggestedTask(st.text)} style={{ width: 24, height: 24, borderRadius: "50%", border: "1.5px solid #3B82F6", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#3B82F6", fontSize: 15, flexShrink: 0, background: "#EFF6FF" }}>+</div>
                  <div style={{ flex: 1, fontSize: 15, color: "#1a2332", minWidth: 0 }}>{st.text}</div>
                  <span onClick={() => onViewMetric(st.metricId)} style={{ fontSize: 15, color: "#3B82F6", cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>
                    View Metrics →
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right Column: Team Tasks ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, color: "#1a2332" }}>{__('tasks.teamTasks', 'Team Tasks')}</h2>
          {teamMembersWithTasks.length === 0 && (
            <div style={{ fontSize: 15, color: "#cbd5e1", fontStyle: "italic", padding: 20, textAlign: "center" }}>{__('common.noTeamTasks', 'No team tasks yet.')}</div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, alignContent: "start" }}>
            {teamMembersWithTasks.map(({ member, memberTasks }) => (
              <div key={member.id} style={{ background: "#fff", borderRadius: 14, padding: "16px", boxSizing: "border-box" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  {member.avatarUrl ? (
                    <img src={member.avatarUrl} alt="" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: "#94a3b8", flexShrink: 0 }}>
                      {(member.name?.[0] || member.email[0] || "?").toUpperCase()}
                    </div>
                  )}
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332" }}>{member.name || member.email.split("@")[0]}</div>
                </div>
                <div style={{ padding: "5px 14px", borderRadius: 20, fontSize: 15, fontWeight: 500, background: "#3B82F6", color: "#fff", display: "inline-block", marginBottom: 8 }}>{__('common.nextActions', 'Next Actions')}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}
              onDragOver={e => e.preventDefault()} onDrop={handleRegularZoneDrop}>
                  {memberTasks.slice(0, 3).map(t => {
                    const isDueToday = t.dueDate === todayStr;
                    return (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, background: t.done ? "#f8fafc" : t.priority ? pc.bg : isDueToday ? "#EFF6FF" : "#fff", border: isDueToday && !t.done ? "1px solid #93C5FD" : "none", opacity: t.done ? 0.6 : 1 }}>
                      <div onClick={() => toggle(t.id)} style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0, cursor: "pointer", border: t.done ? "none" : t.priority ? `1.5px solid ${pc.accent}` : "1.5px solid #d1d5db", background: t.done ? "#4CAF7D" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 15 }}>{t.done ? "✓" : ""}</div>
                      <div style={{ flex: 1, fontSize: 15, color: "#1a2332", fontWeight: t.priority ? 600 : 400, textDecoration: t.done ? "line-through" : "none", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.text}</div>
                      {t.dueDate && <div style={{ fontSize: 15, color: isDueToday ? "#3B82F6" : "#94a3b8", fontWeight: isDueToday ? 600 : 400, whiteSpace: "nowrap", flexShrink: 0 }}>{isDueToday ? "Due Today" : formatDate(t.dueDate)}</div>}
                    </div>
                    );
                  })}
                  {memberTasks.length > 3 && (
                    <div onClick={() => onViewTeamMember(member)} style={{ fontSize: 15, color: "#3B82F6", cursor: "pointer", fontWeight: 600, padding: "6px 0 0", textAlign: "center", marginTop: 4 }}>
                      View All ({memberTasks.length} tasks) →
                    </div>
                  )}
                  {memberTasks.length <= 3 && memberTasks.length > 0 && (
                    <div onClick={() => onViewTeamMember(member)} style={{ fontSize: 15, color: "#3B82F6", cursor: "pointer", fontWeight: 600, padding: "4px 0 0", textAlign: "center" }}>
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

export { TasksPage, formatDate };
