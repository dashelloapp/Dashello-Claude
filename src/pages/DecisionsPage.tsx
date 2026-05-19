import { useState, useRef, useEffect } from "react";
import { Section, Task } from "../types";
import { IconGlyph } from "../components/shared";

interface DecisionOption {
  id: string;
  label: string;
  pros: string[];
  cons: string[];
  connections: { proIndex: number; conIndex: number }[];
}
interface CompletedDecision {
  id: string;
  decisionStatement: string;
  favoriteOption: DecisionOption;
  priorityText: string;
  allOptions: DecisionOption[];
  completedAt: string;
  priorityTaskId?: string;
}
interface DecisionSnapshot {
  id: string;
  decisionStatement: string;
  favoriteOptionId: string | null;
  options: DecisionOption[];
  savedAt: string;
  priorityTaskId?: string;
}

const STORAGE_KEY = "decision-filter-current";

export function DecisionMakingFilter({ tasks, setTasks, userEmail }: {
  tasks?: Task[]; setTasks?: React.Dispatch<React.SetStateAction<Task[]>>;
  userEmail?: string;
}) {
  const [options, setOptions] = useState<DecisionOption[]>(() => { try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) { const parsed = JSON.parse(saved); if (parsed?.options?.length) return parsed.options; } } catch {} return [ { id: crypto.randomUUID(), label: "Option A", pros: [""], cons: [""], connections: [] }, { id: crypto.randomUUID(), label: "Option B", pros: [""], cons: [""], connections: [] }, { id: crypto.randomUUID(), label: "Option C", pros: [""], cons: [""], connections: [] }, ]; });
  const [favoriteOptionId, setFavoriteOptionId] = useState<string | null>(() => { try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) { const parsed = JSON.parse(saved); return parsed?.favoriteOptionId ?? null; } } catch {} return null; });
  const [decisionStatement, setDecisionStatement] = useState(() => { try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) { const parsed = JSON.parse(saved); return parsed?.decisionStatement ?? ""; } } catch {} return ""; });
  const [showQuickStart, setShowQuickStart] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const [convertText, setConvertText] = useState("");
  const [saveError, setSaveError] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [completedDecisions, setCompletedDecisions] = useState<CompletedDecision[]>([]);
  const [savedDecisions, setSavedDecisions] = useState<DecisionSnapshot[]>(() => { try { const saved = localStorage.getItem("decision-filter-saved"); if (saved) return JSON.parse(saved); } catch {} return []; });
  const [dragging, setDragging] = useState<{ optionId: string; source: "pro" | "con"; index: number; startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const dotRefs = useRef<Record<string, HTMLElement | null>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const focusTarget = useRef<{ id: string } | null>(null);

  useEffect(() => {
    if (focusTarget.current) {
      const el = document.getElementById(focusTarget.current.id);
      if (el) { el.focus(); }
      focusTarget.current = null;
    }
  });

  const addOption = () => { const letter = String.fromCharCode(65 + options.length); setOptions([...options, { id: crypto.randomUUID(), label: `Option ${letter}`, pros: [""], cons: [""], connections: [] }]); };
  const removeOption = (id: string) => { setOptions(options.filter(o => o.id !== id)); if (favoriteOptionId === id) setFavoriteOptionId(null); };
  const updateLabel = (id: string, label: string) => { setOptions(options.map(o => o.id === id ? { ...o, label } : o)); };
  const addPro = (optionId: string) => { setOptions(options.map(o => o.id === optionId ? { ...o, pros: [...o.pros, ""] } : o)); focusTarget.current = { id: `pro-${optionId}-${options.find(o => o.id === optionId)?.pros.length || 0}` }; };
  const updatePro = (optionId: string, index: number, value: string) => { setOptions(options.map(o => o.id === optionId ? { ...o, pros: o.pros.map((p, i) => i === index ? value : p) } : o)); };
  const removePro = (optionId: string, index: number) => { setOptions(options.map(o => o.id === optionId ? { ...o, pros: o.pros.filter((_, i) => i !== index), connections: o.connections.filter(c => c.proIndex !== index).map(c => ({ proIndex: c.proIndex > index ? c.proIndex - 1 : c.proIndex, conIndex: c.conIndex })) } : o)); };
  const addCon = (optionId: string) => { setOptions(options.map(o => o.id === optionId ? { ...o, cons: [...o.cons, ""] } : o)); focusTarget.current = { id: `con-${optionId}-${options.find(o => o.id === optionId)?.cons.length || 0}` }; };
  const updateCon = (optionId: string, index: number, value: string) => { setOptions(options.map(o => o.id === optionId ? { ...o, cons: o.cons.map((c, i) => i === index ? value : c) } : o)); };
  const removeCon = (optionId: string, index: number) => { setOptions(options.map(o => o.id === optionId ? { ...o, cons: o.cons.filter((_, i) => i !== index), connections: o.connections.filter(c => c.conIndex !== index).map(c => ({ proIndex: c.proIndex, conIndex: c.conIndex > index ? c.conIndex - 1 : c.conIndex })) } : o)); };
  const handleProDotMouseDown = (e: React.MouseEvent, optionId: string, proIndex: number) => { e.preventDefault(); const rect = containerRef.current?.getBoundingClientRect(); if (!rect) return; setDragging({ optionId, source: "pro", index: proIndex, startX: e.clientX - rect.left, startY: e.clientY - rect.top, currentX: e.clientX - rect.left, currentY: e.clientY - rect.top }); };
  const handleConDotMouseDown = (e: React.MouseEvent, optionId: string, conIndex: number) => { e.preventDefault(); const rect = containerRef.current?.getBoundingClientRect(); if (!rect) return; setDragging({ optionId, source: "con", index: conIndex, startX: e.clientX - rect.left, startY: e.clientY - rect.top, currentX: e.clientX - rect.left, currentY: e.clientY - rect.top }); };
  const handleMouseMove = (e: React.MouseEvent) => { if (!dragging) return; const rect = containerRef.current?.getBoundingClientRect(); if (!rect) return; setDragging({ ...dragging, currentX: e.clientX - rect.left, currentY: e.clientY - rect.top }); };
  const handleMouseUp = (e: React.MouseEvent) => { if (!dragging) return; const target = e.target as HTMLElement; const proDot = target.closest("[data-pro-dot]") as HTMLElement | null; const conDot = target.closest("[data-con-dot]") as HTMLElement | null; const otherDot = dragging.source === "pro" ? conDot : proDot; if (otherDot) { const optionId = otherDot.dataset.optionId || dragging.optionId; if (optionId === dragging.optionId) { const proIndex = dragging.source === "pro" ? dragging.index : parseInt(otherDot.dataset.proIndex ?? "0", 10); const conIndex = dragging.source === "con" ? dragging.index : parseInt(otherDot.dataset.conIndex ?? "0", 10); setOptions(options.map(o => o.id !== optionId ? o : { ...o, connections: [...o.connections, { proIndex, conIndex }] })); } } setDragging(null); };
  const removeConnection = (optionId: string, proIndex: number, conIndex: number) => { setOptions(options.map(o => o.id === optionId ? { ...o, connections: o.connections.filter(c => !(c.proIndex === proIndex && c.conIndex === conIndex)) } : o)); };
  const handleConvertToPriority = () => { if (!convertText.trim() || !setTasks || !userEmail || !favoriteOption) return; const taskId = crypto.randomUUID(); setTasks(prev => [...prev, { id: taskId, text: convertText.trim(), done: false, assignedTo: userEmail, createdBy: userEmail, createdAt: new Date().toISOString(), priority: true, linkedDecisionId: taskId }]); const snapshot: DecisionSnapshot = { id: crypto.randomUUID(), decisionStatement, favoriteOptionId, options, savedAt: new Date().toISOString(), priorityTaskId: taskId }; setSavedDecisions(prev => [...prev, snapshot]); setShowConvert(false); setConvertText(""); resetCurrent(); };
  useEffect(() => { const taskArr = tasks ?? []; setSavedDecisions(prev => prev.map(sd => { if (!sd.priorityTaskId) return sd; const task = taskArr.find(t => t.id === sd.priorityTaskId); if (task?.done) { const favOpt = sd.options.find(o => o.id === sd.favoriteOptionId); if (favOpt) { setCompletedDecisions(prev => [...prev, { id: crypto.randomUUID(), decisionStatement: sd.decisionStatement, favoriteOption: JSON.parse(JSON.stringify(favOpt)), priorityText: task.text, allOptions: JSON.parse(JSON.stringify(sd.options)), completedAt: new Date().toISOString(), priorityTaskId: sd.priorityTaskId }]); } return null; } return sd; }).filter(Boolean) as DecisionSnapshot[]); setCompletedDecisions(prev => prev.filter(cd => { if (!cd.priorityTaskId) return true; const task = taskArr.find(t => t.id === cd.priorityTaskId); if (task && !task.done) { setSavedDecisions(prev => [...prev, { id: crypto.randomUUID(), decisionStatement: cd.decisionStatement, favoriteOptionId: cd.allOptions.find(o => o.label === cd.favoriteOption.label)?.id ?? null, options: JSON.parse(JSON.stringify(cd.allOptions)), savedAt: new Date().toISOString(), priorityTaskId: cd.priorityTaskId }]); return false; } return true; })); }, [tasks]);
  const handleRevertDecision = (completed: CompletedDecision) => { setSavedDecisions(prev => [...prev, { id: crypto.randomUUID(), decisionStatement: completed.decisionStatement, favoriteOptionId: completed.allOptions.find(o => o.label === completed.favoriteOption.label)?.id ?? null, options: completed.allOptions, savedAt: new Date().toISOString() }]); setCompletedDecisions(prev => prev.filter(c => c.id !== completed.id)); };
  const handleSaveForLater = () => { if (!decisionStatement.trim()) { setSaveError("Please complete Step 1 first — write out your decision to be made."); return; } setSaveError(""); const snapshot: DecisionSnapshot = { id: crypto.randomUUID(), decisionStatement, favoriteOptionId, options, savedAt: new Date().toISOString() }; setSavedDecisions(prev => [...prev, snapshot]); resetCurrent(); };
  const handleRestoreDecision = (snapshot: DecisionSnapshot) => { setOptions(snapshot.options); setDecisionStatement(snapshot.decisionStatement); setFavoriteOptionId(snapshot.favoriteOptionId); setSavedDecisions(prev => prev.filter(s => s.id !== snapshot.id)); };
  const handleDeleteSaved = (id: string) => { setSavedDecisions(prev => prev.filter(s => s.id !== id)); setConfirmDeleteId(null); };
  const resetCurrent = () => { setOptions([{ id: crypto.randomUUID(), label: "Option A", pros: [""], cons: [""], connections: [] }, { id: crypto.randomUUID(), label: "Option B", pros: [""], cons: [""], connections: [] }, { id: crypto.randomUUID(), label: "Option C", pros: [""], cons: [""], connections: [] }]); setFavoriteOptionId(null); setDecisionStatement(""); };
  const favoriteOption = options.find(o => o.id === favoriteOptionId);
  const getConnectionPath = (option: DecisionOption, proIndex: number, conIndex: number) => { const proDot = dotRefs.current[`pro-${option.id}-${proIndex}`]; const conDot = dotRefs.current[`con-${option.id}-${conIndex}`]; if (!proDot || !conDot || !containerRef.current) return null; const containerRect = containerRef.current.getBoundingClientRect(); const proRect = proDot.getBoundingClientRect(); const conRect = conDot.getBoundingClientRect(); const x1 = proRect.left - containerRect.left + proRect.width / 2; const y1 = proRect.top - containerRect.top + proRect.height / 2; const x2 = conRect.left - containerRect.left + conRect.width / 2; const y2 = conRect.top - containerRect.top + conRect.height / 2; const cx1 = x1 + (x2 - x1) * 0.4; const cy1 = y1; const cx2 = x2 - (x2 - x1) * 0.4; const cy2 = y2; return `M ${x1} ${y1} C ${cx1} ${cy1} ${cx2} ${cy2} ${x2} ${y2}`; };

  const renderColumn = (option: DecisionOption) => {
    const isFavorite = option.id === favoriteOptionId;
    return (
      <div key={option.id} style={{ flex: "1 1 100%", minWidth: 0, maxWidth: "100%", background: isFavorite ? "#EFF6FF" : "#fff", borderRadius: 12, border: isFavorite ? "2px solid #3B82F6" : "1px solid #e2e8f0", padding: "16px", display: "flex", flexDirection: "column", gap: 10, position: "relative", opacity: favoriteOptionId && !isFavorite ? 0.5 : 1, transition: "opacity 0.2s, border-color 0.2s", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
          <input value={option.label} onChange={e => updateLabel(option.id, e.target.value)} style={{ flex: 1, fontSize: 16, fontWeight: 700, color: "#1a2332", border: "none", background: "transparent", outline: "none", fontFamily: "inherit", padding: "4px 0" }} />
          <div onClick={() => { if (favoriteOptionId === option.id) setFavoriteOptionId(null); else setFavoriteOptionId(option.id); }} style={{ cursor: "pointer", fontSize: 20, color: isFavorite ? "#F5A623" : "#cbd5e1", transition: "color 0.2s" }} title={isFavorite ? "Remove as favorite" : "Set as favorite"}>{isFavorite ? "★" : "☆"}</div>
          <div onClick={() => removeOption(option.id)} style={{ cursor: "pointer", fontSize: 16, color: "#cbd5e1" }} title="Delete option">×</div>
        </div>
        <div style={{ display: "flex", gap: 32, flex: 1, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 160px", minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#4CAF7D", marginBottom: 8, paddingLeft: 2 }}>Pros</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, background: "#F8FAFC", borderRadius: 8, padding: "8px 6px" }}>
              {option.pros.map((pro, pi) => (
                <div key={pi} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 4px", borderRadius: 6, background: "#fff", border: "1px solid #f0f2f5" }}>
                  <span style={{ fontSize: 14, color: "#4CAF7D", flexShrink: 0 }}>+</span>
                  <input id={`pro-${option.id}-${pi}`} value={pro} onChange={e => updatePro(option.id, pi, e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (pro.trim()) addPro(option.id); } }} placeholder="Add a pro..." style={{ flex: 1, fontSize: 14, color: "#1a2332", border: "none", background: "transparent", outline: "none", fontFamily: "inherit", padding: "2px 0", minWidth: 0 }} />
                  {option.pros.length > 1 && <div onClick={() => removePro(option.id, pi)} style={{ cursor: "pointer", fontSize: 14, color: "#cbd5e1", flexShrink: 0 }}>×</div>}
                  {pro.trim() && <div ref={el => { dotRefs.current[`pro-${option.id}-${pi}`] = el; }} data-pro-dot="true" data-option-id={option.id} data-pro-index={pi} onMouseDown={e => handleProDotMouseDown(e, option.id, pi)} style={{ width: 16, height: 16, borderRadius: "50%", background: "#4CAF7D", cursor: "crosshair", flexShrink: 0, marginLeft: 4 }} title="Drag to connect to a con" />}
                </div>
              ))}
              <div onClick={() => addPro(option.id)} style={{ fontSize: 13, color: "#4CAF7D", cursor: "pointer", display: "flex", alignItems: "center", gap: 2, padding: "2px 4px" }}><span style={{ fontSize: 13 }}>+</span> Add pro</div>
            </div>
          </div>
          <div style={{ flex: "1 1 160px", minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#E85D75", marginBottom: 8, paddingLeft: 2 }}>Cons</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, background: "#FFF5F5", borderRadius: 8, padding: "8px 6px" }}>
              {option.cons.map((con, ci) => (
                <div key={ci} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 4px", borderRadius: 6, background: "#fff", border: "1px solid #fee2e2" }}>
                  {con.trim() && <div ref={el => { dotRefs.current[`con-${option.id}-${ci}`] = el; }} data-con-dot="true" data-option-id={option.id} data-con-index={ci} onMouseDown={e => handleConDotMouseDown(e, option.id, ci)} style={{ width: 16, height: 16, borderRadius: "50%", background: "#E85D75", cursor: "crosshair", flexShrink: 0, marginRight: 4 }} title="Drop here to connect from a pro" />}
                  <span style={{ fontSize: 14, color: "#E85D75", flexShrink: 0 }}>−</span>
                  <input id={`con-${option.id}-${ci}`} value={con} onChange={e => updateCon(option.id, ci, e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (con.trim()) addCon(option.id); } }} placeholder="Add a con..." style={{ flex: 1, fontSize: 14, color: "#1a2332", border: "none", background: "transparent", outline: "none", fontFamily: "inherit", padding: "2px 0", minWidth: 0 }} />
                  {option.cons.length > 1 && <div onClick={() => removeCon(option.id, ci)} style={{ cursor: "pointer", fontSize: 14, color: "#cbd5e1", flexShrink: 0 }}>×</div>}
                </div>
              ))}
              <div onClick={() => addCon(option.id)} style={{ fontSize: 13, color: "#E85D75", cursor: "pointer", display: "flex", alignItems: "center", gap: 2, padding: "2px 4px", justifyContent: "flex-end" }}><span style={{ fontSize: 13 }}>+</span> Add con</div>
            </div>
          </div>
        </div>
        {option.connections.map((conn, ci) => { const path = getConnectionPath(option, conn.proIndex, conn.conIndex); if (!path) return null; return (<svg key={ci} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 5, overflow: "visible" }}><path d={path} fill="none" stroke="#3B82F6" strokeWidth={1.5} strokeDasharray="4 2" opacity={0.6} /><circle onClick={() => removeConnection(option.id, conn.proIndex, conn.conIndex)} style={{ cursor: "pointer", pointerEvents: "all" }} cx={(() => { const p = getConnectionPath(option, conn.proIndex, conn.conIndex); if (!p) return 0; const pts = p.match(/[\d.]+/g); return pts ? (parseFloat(pts[pts.length-2]) + parseFloat(pts[0])) / 2 : 0; })()} cy={(() => { const p = getConnectionPath(option, conn.proIndex, conn.conIndex); if (!p) return 0; const pts = p.match(/[\d.]+/g); return pts ? (parseFloat(pts[pts.length-1]) + parseFloat(pts[1])) / 2 : 0; })()} r={5} fill="#3B82F6" opacity={0.3} /></svg>); })}
      </div>
    );
  };

  const quickStartGuide = (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setShowQuickStart(false)}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: "90vw", maxWidth: 640, maxHeight: "90vh", overflow: "auto", position: "relative", fontSize: 15, lineHeight: 1.6, color: "#1a2332" }}>
        <button onClick={() => setShowQuickStart(false)} style={{ position: "absolute", top: 12, right: 16, width: 28, height: 28, borderRadius: "50%", border: "none", background: "#f1f5f9", cursor: "pointer", fontSize: 16, color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2332", marginBottom: 16 }}>Decision Making Filter - Quick Start Guide</div>
        <div style={{ fontSize: 15, color: "#64748b", marginBottom: 16 }}>The Decision Making Filter is based on the Ignatian method of discernment - a time-tested framework for making decisions with clarity, freedom, and peace. Below are the 11 steps of the process, adapted and explained alongside the tools available in this filter.</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[{ n: "1", title: "Identify the decision to be made", body: "State the issue as a practical choice - something you will do or not do. It must be real (a decision actually facing you), yours to make (you have the authority), and informed (you can get the necessary information). Use the \"Decision to be made\" field above to write it out as a positive, concrete statement." },{ n: "2", title: "Formulate the issue in a proposal", body: "Frame your decision as either X vs. non-X (e.g., \"I will accept the job offer\" vs. \"I will not accept it\") or X vs. Y (e.g., \"I will stay at my current job\" vs. \"I will accept the new offer\"). Multiple options like A vs. B vs. C work well for complex decisions." },{ n: "3", title: "Pray for openness and inner freedom", body: "Before weighing evidence, pause. Ask to be free from prejudgment, fear, pride, or any attachment that might steer you unconsciously. The goal is to want only what is truly best - not easiest or most comfortable. Read Scripture slowly and notice what stirs in you." },{ n: "4", title: "Gather all necessary information", body: "Find out the relevant specifics: Who? What? Where? When? How much? Consult everyone who will be affected by the decision." },{ n: "5", title: "Repeat the prayer for freedom", body: "After gathering input, new feelings and desires will have surfaced. Return to prayer. This is a freedom check." },{ n: "6", title: "List pros and cons for each alternative", body: "For each option column, add every advantage (pro) and disadvantage (con) you can think of." },{ n: "7", title: "Evaluate the advantages and disadvantages (trade-offs)", body: "Review your lists. Use the colored patches and drag green dots to red dots to draw connection lines." },{ n: "8", title: "Observe the direction of your will", body: "As you evaluate, notice which option your desires are leaning toward." },{ n: "9", title: "Ask for feelings of consolation", body: "Ask for feelings of peace, joy, confidence, deeper faith, and trust about the option you are leaning toward." },{ n: "10", title: "Trust and make your decision", body: "Even if you are not entirely certain, make your choice in trust." },{ n: "11", title: "Confirm and convert to action", body: "If the decision holds, click Convert to Priority to create a new priority task." }].map(s => (
            <div key={s.n} style={{ display: "flex", gap: 10 }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0, marginTop: 1 }}>{s.n}</div>
              <div><div style={{ fontWeight: 600, fontSize: 15 }}>{s.title}</div><div style={{ fontSize: 14, color: "#64748b" }}>{s.body}</div></div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16, padding: 12, background: "#F0FDF4", borderRadius: 10, fontSize: 14, color: "#0F6E56", lineHeight: 1.5 }}><strong>Remember:</strong> The goal of discernment is not a perfect decision - it is a <em>peaceful</em> one.</div>
      </div>
    </div>
  );

  const activeDecisions = savedDecisions.filter(sd => sd.priorityTaskId && !tasks?.find(t => t.id === sd.priorityTaskId)?.done);
  const savedDrafts = savedDecisions.filter(sd => !sd.priorityTaskId);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => { try { const saved = localStorage.getItem("decision-filter-collapsed"); if (saved) return { current: false, active: false, saved: false, completed: false, ...JSON.parse(saved) }; } catch {} return { current: false, active: false, saved: false, completed: false }; });
  useEffect(() => { localStorage.setItem("decision-filter-collapsed", JSON.stringify(collapsed)); }, [collapsed]);
  const toggleCollapse = (k: string) => setCollapsed(p => ({ ...p, [k]: !p[k] }));
  const renderCollapsibleHeader = (key: string, label: string, icon: string, iconColor: string, count?: number) => (
    <div onClick={() => toggleCollapse(key)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "8px 0", userSelect: "none" }}>
      <span style={{ fontSize: 13, color: collapsed[key] ? "#3B82F6" : "#64748b", transition: "transform 0.2s", transform: collapsed[key] ? "rotate(-90deg)" : "rotate(0deg)" }}>▼</span>
      <IconGlyph name={icon} size={16} color={iconColor} />
      <span style={{ fontSize: 15, fontWeight: 600, color: "#1a2332" }}>{label}</span>
      {count !== undefined && <span style={{ fontSize: 13, color: "#94a3b8", background: "#f1f5f9", padding: "1px 8px", borderRadius: 99 }}>{count}</span>}
    </div>
  );
  const renderSection = (key: string, label: string, icon: string, iconColor: string, items: any[], renderItem: (item: any) => any) => (
    <div style={{ marginTop: 8 }}>{renderCollapsibleHeader(key, label, icon, iconColor, items.length)}{!collapsed[key] && items.length === 0 && <div style={{ padding: "12px 0", textAlign: "center", fontSize: 14, color: "#94a3b8" }}>No {label.toLowerCase()}.</div>}{!collapsed[key] && items.length > 0 && <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{items.map(renderItem)}</div>}</div>
  );
  const renderSavedCard = (sd: DecisionSnapshot) => (
    <div key={sd.id} style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", padding: "12px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {sd.decisionStatement ? <div style={{ fontSize: 14, fontWeight: 600, color: "#1a2332", fontStyle: "italic" }}>"{sd.decisionStatement}"</div> : <div style={{ fontSize: 14, fontWeight: 600, color: "#1a2332" }}>Untitled Decision</div>}
          <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 2, display: "flex", gap: 12 }}><span>{sd.options.length} options</span><span>Saved {new Date(sd.savedAt).toLocaleDateString()}</span></div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => handleRestoreDecision(sd)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#EFF6FF", fontSize: 13, cursor: "pointer", color: "#3B82F6", fontWeight: 600 }}>Edit</button>
          {confirmDeleteId === sd.id ? (<div style={{ display: "flex", gap: 4 }}><button onClick={() => handleDeleteSaved(sd.id)} style={{ padding: "5px 8px", borderRadius: 6, border: "none", background: "#E85D75", fontSize: 12, cursor: "pointer", color: "#fff", fontWeight: 600 }}>Confirm</button><button onClick={() => setConfirmDeleteId(null)} style={{ padding: "5px 8px", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 12, cursor: "pointer", color: "#94a3b8" }}>Cancel</button></div>) : (
            <button onClick={() => setConfirmDeleteId(sd.id)} style={{ padding: "5px 8px", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 13, cursor: "pointer", color: "#94a3b8" }}>×</button>
          )}
        </div>
      </div>
    </div>
  );
  const renderCompletedCard = (cd: CompletedDecision) => (
    <div key={cd.id} style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, justifyContent: "space-between" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332", marginBottom: 2 }}>{cd.favoriteOption.label}</div>
          {cd.decisionStatement && <div style={{ fontSize: 13, color: "#64748b", marginBottom: 6, fontStyle: "italic" }}>"{cd.decisionStatement}"</div>}
          <div style={{ fontSize: 13, color: "#475569", marginBottom: 8, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ background: "#EFF6FF", padding: "1px 6px", borderRadius: 4, fontSize: 12, color: "#3B82F6", fontWeight: 600 }}>Priority: {cd.priorityText}</span>
            <span style={{ color: "#94a3b8" }}>•</span><span style={{ color: "#94a3b8" }}>{new Date(cd.completedAt).toLocaleDateString()}</span>
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 13, color: "#94a3b8" }}>
            <span>{cd.favoriteOption.pros.filter(p => p.trim()).length} pros</span>
            <span>{cd.favoriteOption.cons.filter(c => c.trim()).length} cons</span>
            <span>{cd.favoriteOption.connections.length} connections</span>
          </div>
        </div>
        <button onClick={() => handleRevertDecision(cd)} style={{ padding: "6px 14px", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 13, cursor: "pointer", color: "#3B82F6", fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>Revert</button>
      </div>
    </div>
  );

  return (
    <div style={{ padding: "clamp(16px,4vw,32px)", height: "100%", overflowY: "auto", boxSizing: "border-box" }}>
      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: "clamp(20px,4vw,26px)", fontWeight: 700, color: "#1a2332", marginBottom: 2 }}>Decisions</div>
      </div>
      {renderCollapsibleHeader("current", "Decision Making Filter", "Funnel", "#3B82F6")}
      {!collapsed["current"] && <div style={{ background: "#fff", borderRadius: 16, padding: 20, border: "1px solid #e2e8f0", maxWidth: "100%", overflowX: "hidden", boxSizing: "border-box" }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{ width: 24, height: 24, borderRadius: "50%", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0, marginTop: 1 }}>1</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: "#1a2332", marginBottom: 6 }}>Identify the decision to be made</div>
          <textarea value={decisionStatement} onChange={e => { setDecisionStatement(e.target.value); setSaveError(""); }} placeholder='What decision are you facing? Be specific and concrete - e.g., "Whether to accept the job offer from Company B"' rows={2} style={{ width: "100%", fontSize: 14, color: "#1a2332", border: "1.5px solid #e2e8f0", borderRadius: 8, background: "#fff", outline: "none", fontFamily: "inherit", padding: "8px 10px", resize: "vertical", boxSizing: "border-box" }} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
        <div style={{ width: 24, height: 24, borderRadius: "50%", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0, marginTop: 1 }}>2</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: "#1a2332", marginBottom: 2 }}>Formulate the issue in a proposal</div>
          <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Name your options clearly. <span onClick={() => setShowQuickStart(true)} style={{ color: "#3B82F6", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}>Open guide for tips</span></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", maxWidth: "100%" }}>
            {options.map(option => (
              <div key={option.id} style={{ flex: "1 1 100%", minWidth: 0, maxWidth: "100%", borderRadius: 10, border: "1px solid #e2e8f0", padding: "10px 12px", display: "flex", alignItems: "center", gap: 6, background: "#fff", boxSizing: "border-box" }}>
                <input value={option.label} onChange={e => updateLabel(option.id, e.target.value)} style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "#1a2332", border: "none", background: "transparent", outline: "none", fontFamily: "inherit", padding: "2px 0", minWidth: 0 }} />
                <div onClick={() => removeOption(option.id)} style={{ cursor: "pointer", fontSize: 15, color: "#cbd5e1", flexShrink: 0 }}>×</div>
              </div>
            ))}
            <div onClick={addOption} style={{ flex: "1 1 100%", minWidth: 0, minHeight: 40, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, borderRadius: 10, border: "2px dashed #e2e8f0", cursor: "pointer", color: "#94a3b8", fontSize: 14, fontWeight: 500 }}>+ Add Option</div>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center" }}>
        <div style={{ width: 24, height: 24, borderRadius: "50%", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0 }}>3</div>
        <div style={{ fontWeight: 600, fontSize: 14, color: "#1a2332" }}>Pray for openness and inner freedom</div>
        <div onClick={() => setShowQuickStart(true)} style={{ fontSize: 13, color: "#3B82F6", cursor: "pointer", fontWeight: 500, textDecoration: "underline", textUnderlineOffset: 2 }}>View guide for tips</div>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, marginLeft: 34, alignItems: "center" }}>
        {[{ n: "3", desc: "Pray for openness" },{ n: "4", desc: "Gather information" },{ n: "5", desc: "Freedom check" }].map(s => (
          <div key={s.n} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "#F8FAFC", borderRadius: 8, border: "1px solid #e2e8f0" }}>
            <div style={{ width: 20, height: 20, borderRadius: "50%", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{s.n}</div>
            <span style={{ fontSize: 13, color: "#64748b" }}>{s.desc}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <div style={{ width: 24, height: 24, borderRadius: "50%", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0, marginTop: 1 }}>6</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: "#1a2332", marginBottom: 4 }}>List pros and cons for each alternative</div>
          <div style={{ position: "relative" }}>
            <div ref={containerRef} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={() => setDragging(null)} style={{ display: "flex", gap: 12, flexWrap: "wrap", overflow: "visible", maxWidth: "100%" }}>
              {options.map(renderColumn)}
              <div onClick={addOption} style={{ flex: "1 1 100%", minWidth: 0, minHeight: 60, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 12, border: "2px dashed #e2e8f0", cursor: "pointer", color: "#94a3b8", fontSize: 15, fontWeight: 600 }}>+ Add Option</div>
            </div>
            {dragging && <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 50 }}><path d={`M ${dragging.startX} ${dragging.startY} C ${dragging.startX + (dragging.currentX - dragging.startX) * 0.4} ${dragging.startY} ${dragging.currentX - (dragging.currentX - dragging.startX) * 0.4} ${dragging.currentY} ${dragging.currentX} ${dragging.currentY}`} fill="none" stroke="#3B82F6" strokeWidth={2} strokeDasharray="5 3" opacity={0.7} /></svg>}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, marginLeft: 34, alignItems: "center", flexWrap: "wrap" }}>
        {[{ n: "7", desc: "Evaluate trade-offs" },{ n: "8", desc: "Observe your will" },{ n: "9", desc: "Feel consolation" },{ n: "10", desc: "Trust & decide" }].map(s => (
          <div key={s.n} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "#F8FAFC", borderRadius: 8, border: "1px solid #e2e8f0" }}>
            <div style={{ width: 20, height: 20, borderRadius: "50%", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{s.n}</div>
            <span style={{ fontSize: 13, color: "#64748b" }}>{s.desc}</span>
          </div>
        ))}
      </div>
      {favoriteOption && (
        <div style={{ marginTop: 16, padding: 20, background: "#F0FDF4", borderRadius: 12, border: "2px solid #4CAF7D", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff", flexShrink: 0 }}>11</div>
            <span style={{ fontSize: 20, color: "#F5A623" }}>★</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: "#1a2332" }}>Your Favorite Option: {favoriteOption.label}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
            <div><div style={{ fontSize: 14, fontWeight: 600, color: "#4CAF7D", marginBottom: 4 }}>Pros</div><ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: "#1a2332", lineHeight: 1.6 }}>{favoriteOption.pros.filter(p => p.trim()).map((p, i) => <li key={i}>{p}</li>)}{favoriteOption.pros.filter(p => p.trim()).length === 0 && <li style={{ color: "#94a3b8" }}>No pros listed</li>}</ul></div>
            <div><div style={{ fontSize: 14, fontWeight: 600, color: "#E85D75", marginBottom: 4 }}>Cons</div><ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: "#1a2332", lineHeight: 1.6 }}>{favoriteOption.cons.filter(c => c.trim()).map((c, i) => <li key={i}>{c}</li>)}{favoriteOption.cons.filter(c => c.trim()).length === 0 && <li style={{ color: "#94a3b8" }}>No cons listed</li>}</ul></div>
          </div>
          {favoriteOption.connections.length > 0 && <div style={{ marginBottom: 12, padding: 8, background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0" }}><div style={{ fontSize: 13, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>Trade-offs</div>{favoriteOption.connections.map((conn, ci) => (<div key={ci} style={{ fontSize: 13, color: "#475569", display: "flex", gap: 6, alignItems: "center", padding: "2px 0" }}><span style={{ color: "#4CAF7D" }}>+ {favoriteOption.pros[conn.proIndex] || "(empty)"}</span><span style={{ color: "#94a3b8" }}>↔</span><span style={{ color: "#E85D75" }}>− {favoriteOption.cons[conn.conIndex] || "(empty)"}</span></div>))}</div>}
          <div style={{ marginBottom: 12, padding: 12, background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#1a2332", marginBottom: 8 }}>Final Discernment Check - Ask Yourself</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14, color: "#475569" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}><input type="checkbox" style={{ accentColor: "#3B82F6" }} /> Have I prayed for openness to God's will and freedom from disordered attachments?</label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}><input type="checkbox" style={{ accentColor: "#3B82F6" }} /> Do I feel consolation - peace, joy, deeper faith, confidence - about this option?</label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}><input type="checkbox" style={{ accentColor: "#3B82F6" }} /> Does this choice serve God, my neighbors, and my true, authentic self?</label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}><input type="checkbox" style={{ accentColor: "#3B82F6" }} /> Have I slept on it and returned with the same peace?</label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}><input type="checkbox" style={{ accentColor: "#3B82F6" }} /> Am I ready to trust God and make this decision, even without total certainty?</label>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => { const label = favoriteOption.label; const pros = favoriteOption.pros.filter(p => p.trim()); const text = pros.length > 0 ? `${label}: ${pros[0]}` : label; setConvertText(text); setShowConvert(true); }} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>Convert to Priority</button>
            <span style={{ fontSize: 14, color: "#94a3b8" }}>Creates an actionable priority on your Tasks page</span>
          </div>
        </div>
      )}
      {favoriteOption === null && options.some(o => o.pros.some(p => p.trim()) || o.cons.some(c => c.trim())) && (
        <div style={{ marginTop: 12, padding: 14, background: "#FFF8ED", borderRadius: 10, border: "1px solid #F5A623", fontSize: 14, color: "#92400E", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>💡</span>
          Click the star <span style={{ color: "#F5A623" }}>☆</span> on any option to mark it as your favorite and see a detailed preview below.
        </div>
      )}
      {/* Save Draft button inside collapsible */}
      {saveError && <div style={{ marginTop: 8, fontSize: 13, color: "#E85D75", textAlign: "center", fontWeight: 500 }}>{saveError}</div>}
      <button onClick={() => { if (!decisionStatement.trim()) { setSaveError("Please complete Step 1 first — write out your decision to be made."); return; } setSaveError(""); handleSaveForLater(); }} style={{ marginTop: 12, padding: "10px 24px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 14, cursor: decisionStatement.trim() ? "pointer" : "not-allowed", color: "#F5A623", fontWeight: 600, opacity: decisionStatement.trim() ? 1 : 0.5, display: "block", width: "100%", textAlign: "center" }}>Save Draft</button>
      </div>}
      {renderSection("active", "Current Decisions", "RocketLaunch", "#3B82F6", activeDecisions, renderSavedCard)}
      {renderSection("saved", "Saved Decisions", "Notebook", "#F5A623", savedDrafts, renderSavedCard)}
      {renderSection("completed", "Completed Decisions", "CheckCircle", "#4CAF7D", completedDecisions, renderCompletedCard)}
      {showConvert && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setShowConvert(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: "90vw", maxWidth: 480, position: "relative" }}>
            <button onClick={() => setShowConvert(false)} style={{ position: "absolute", top: 12, right: 16, width: 28, height: 28, borderRadius: "50%", border: "none", background: "#f1f5f9", cursor: "pointer", fontSize: 16, color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1a2332", marginBottom: 4 }}>Convert to Priority</div>
            <div style={{ fontSize: 14, color: "#64748b", marginBottom: 12 }}>Edit the text below to make it an actionable priority (present tense, action-oriented).</div>
            <input value={convertText} onChange={e => setConvertText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleConvertToPriority(); }} autoFocus style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #3B82F6", fontSize: 15, outline: "none", boxSizing: "border-box", marginBottom: 12 }} />
            <div style={{ marginBottom: 12, fontSize: 13, color: "#94a3b8" }}>Tip: Use present tense action verbs</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleConvertToPriority} disabled={!convertText.trim()} style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: "none", background: convertText.trim() ? "linear-gradient(135deg,#3B82F6,#06B6D4)" : "#e2e8f0", color: "#fff", fontSize: 15, fontWeight: 700, cursor: convertText.trim() ? "pointer" : "not-allowed" }}>Create Priority</button>
              <button onClick={() => setShowConvert(false)} style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {showQuickStart && quickStartGuide}
    </div>
  );
}

export default function DecisionsPage({ tasks, setTasks, userEmail }: {
  tasks?: Task[]; setTasks?: React.Dispatch<React.SetStateAction<Task[]>>;
  userEmail?: string;
}) {
  return (
    <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
      <DecisionMakingFilter tasks={tasks} setTasks={setTasks} userEmail={userEmail} />
    </div>
  );
}
