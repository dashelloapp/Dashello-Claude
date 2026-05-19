import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, Fragment } from "react";
import { Section, Metric, MetricColor, MetricModalData, MetricType, GraphType, OrgMember, TeamRow, TeamPermissions, OrgPermissionLevel, RuleOp, ColorRule, Org, Goal, Task } from "../types";
import { resolveColor, computeMetricHealth, formatValue } from "../utils/helpers";
import { IconGlyph, Av, Toggle, SectionCard } from "../components/shared";
import { MS, FIVE_DESC, FIVE_ACCOUNT_LABELS, ICON_NONE } from "../utils/constants";
import { useTranslation } from "../i18n";
import { useSmartPosition } from "../hooks/useSmartPosition";
import { supabase } from "../lib/supabase";
import { makeModal, makeFiveAccountMetric } from "../utils/equations";
import { MetricBoxSettingsModal } from "../components/MetricSettings";

// ── DB helpers ────────────────────────────────────────────────────────────
async function inviteTeamMember(email: string, orgId: string, level: OrgPermissionLevel, invitedByName: string, orgName?: string) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");
  try {
    const res = await supabase.functions.invoke("invite-member", {
      body: { email, orgId, level, invitedByName, orgName },
    });
    if (res.error) {
      let msg = "Unknown error";
      try {
        const ctx = res.error.context;
        if (ctx && typeof ctx.text === "function") {
          const bodyText = await ctx.text();
          console.error("invite-member raw response body:", bodyText);
          try {
            const parsed = JSON.parse(bodyText);
            if (parsed?.error) msg = parsed.error;
          } catch {
            msg = bodyText || msg;
          }
        }
      } catch (e) {
        console.error("invite-member error parsing failed:", e);
      }
      console.error("invite-member error:", msg);
      throw new Error(msg);
    }
    return res.data;
  } catch (err: any) {
    console.error("inviteTeamMember failed:", err);
    throw new Error(err.message || "Failed to reach the invite service. Make sure the edge function is deployed.");
  }
}

const LEVEL_ORDER: OrgPermissionLevel[] = ["viewer", "editor", "admin", "owner"];

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
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: colors[colorIdx], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{initial}</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332" }}>{name}</div>
            <div style={{ fontSize: 15, color: "#64748b", textTransform: "capitalize" }}>{level}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MOBILE MENU (smart-positioned) ─────────────────────────────────────────
function MobileMenu({ triggerRef, onClose, onChat, onCustomize }: { triggerRef: React.RefObject<HTMLDivElement | null>; onClose: () => void; onChat: () => void; onCustomize: () => void }) {
  const { t: __ } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const { style: menuPos } = useSmartPosition(triggerRef, menuRef, true, { top: 40 });

  useEffect(() => {
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  return (
    <div ref={menuRef} style={{ ...menuPos, background: "#fff", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid #e2e8f0", zIndex: 100, minWidth: 140, overflow: "hidden" }}>
      <div onClick={() => { onChat(); onClose(); }} style={{ padding: "10px 16px", fontSize: 15, color: "#64748b", cursor: "pointer", borderBottom: "1px solid #f1f5f9" }}>{__('common.chat', 'Chat')}</div>
      <div onClick={() => { onCustomize(); onClose(); }} style={{ padding: "10px 16px", fontSize: 15, color: "#64748b", cursor: "pointer" }}>{__('common.customize', 'Customize')}</div>
    </div>
  );
}

// ── ROW CONTEXT MENU ───────────────────────────────────────────────────────────
function RowMenu({ onRename, onDelete, onClose, triggerRef }: { onRename?: () => void; onDelete: () => void; onClose: () => void; triggerRef: React.RefObject<HTMLDivElement | null> }) {
  const { t: __ } = useTranslation();
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
          style={{ padding: "9px 14px", fontSize: 15, cursor: "pointer", color: "#1a2332" }}
          onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>{__('common.renameRow', 'Rename row')}</div>
      )}

      {!confirmDelete
        ? <div onClick={() => setConfirmDelete(true)}
            style={{ padding: "9px 14px", fontSize: 15, cursor: "pointer", color: "#E85D75" }}
            onMouseEnter={e => (e.currentTarget.style.background = "#fff5f5")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>{__('common.deleteRow', 'Delete row')}</div>
        : <div style={{ padding: "10px 14px", borderTop: "1px solid #f1f5f9" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#E85D75", marginBottom: 8 }}>{__('common.deleteRow', 'Delete this row?')}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setConfirmDelete(false)}
                style={{ flex: 1, padding: "5px 0", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>{__('common.cancel', 'Cancel')}</button>
              <button onClick={() => { onDelete(); onClose(); }}
                style={{ flex: 1, padding: "5px 0", borderRadius: 6, border: "none", background: "#E85D75", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{__('common.delete', 'Delete')}</button>
            </div>
          </div>}
    </div>
  );
}

// ── EDIT/ADD ROW MODAL ────────────────────────────────────────────────────────
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
          style={{ width: "100%", padding: "8px 11px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box", marginBottom: 18 }} />
        <button onClick={() => { if (name.trim()) { onSave(name.trim()); onClose(); } }}
          style={{ width: "100%", padding: "10px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
          Save
        </button>
      </div>
    </div>
  );
}

// ── ADD TEAM MODAL ─────────────────────────────────────────────────────────────
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
        <p style={{ margin: "0 0 20px", fontSize: 15, color: "#94a3b8", textAlign: "center" }}>Invite team members and assign them to a team.</p>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: showTeamDropdown ? "1fr auto auto" : "1fr auto", gap: 8, marginBottom: 10, alignItems: "center" }}>
            <input data-team-email-input value={r.email} onChange={e => update(i, "email", e.target.value)} onKeyDown={e => handleKeyDown(e, i)} placeholder="Email"
              style={{ padding: "8px 11px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }} />
             <select value={r.level} onChange={e => update(i, "level", e.target.value)}
              style={{ padding: "7px 9px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", background: "#fff" }}>
              {allowedLevels.map(l => (
                <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>
              ))}
            </select>
            {showTeamDropdown && (
              <select value={r.teamId} onChange={e => update(i, "teamId", e.target.value)}
                style={{ padding: "7px 9px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", background: "#fff" }}>
                {sortedTeams.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
          </div>
        ))}
        <button onClick={addRow}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, color: "#3B82F6", padding: "3px 0", marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
          + Add more
        </button>

        {error && <div style={{ marginBottom: 10, padding: "8px 12px", background: "#fef2f2", borderRadius: 8, fontSize: 15, color: "#dc2626" }}>{error}</div>}

        {success.length > 0 && (
          <div style={{ marginBottom: 10, padding: "8px 12px", background: "#f0fdf4", borderRadius: 8, fontSize: 15, color: "#15803d", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 16 }}>✓</span> Invitation{success.length > 1 ? "s" : ""} sent to {success.join(", ")}
          </div>
        )}

        <button onClick={handleSubmit} disabled={sending}
          style={{ width: "100%", padding: "11px 0", borderRadius: 8, border: "none", background: sending ? "#94a3b8" : "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: sending ? "default" : "pointer" }}>
          {sending ? "Sending..." : "Add"}
        </button>
      </div>
    </div>
  );
}

// ── METRIC BLOCK ───────────────────────────────────────────────────────────────
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
      <div style={{ fontSize: 15, fontWeight: 600, color: textColor, lineHeight: 1.3, textAlign: "center", width: "100%" }}>
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

// ── DASHBOARD SECTION — with robust drag-drop ──────────────────────────────────
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
          <div ref={rowMenuTriggerRef} onClick={() => setShowMenu(v => !v)} style={{ width: 26, height: 26, borderRadius: "50%", background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 15, color: "#94a3b8" }}>···</div>
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

// ── BREADCRUMB NAV ─────────────────────────────────────────────────────────────
function BreadcrumbNav({ items, onNavigate }: {
  items: { label: string; key: string }[];
  onNavigate: (key: string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 15, overflowX: "auto", whiteSpace: "nowrap", flexShrink: 0, scrollbarWidth: "none", msOverflowStyle: "none" }}>
      {items.map((item, i) => (
        <Fragment key={item.key}>
          {i > 0 && <span style={{ color: "#cbd5e1", fontWeight: 400, fontSize: 15 }}>/</span>}
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

// ═══════════════════════════════════════════════════════════════════════════
// HOMEPAGE
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
      <div onClick={() => setShowAddRow(true)} style={{ display: "flex", alignItems: "center", gap: 8, color: "#94a3b8", fontSize: 15, cursor: "pointer", padding: "6px 0" }}>
        <div style={{ width: 26, height: 26, borderRadius: "50%", border: "1.5px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, color: "#94a3b8" }}>+</div>
        New Row
      </div>
      {showAddRow && <EditAddRowModal onSave={addSection} onClose={() => setShowAddRow(false)} />}
    </div>
  );
}

export { HoverAvatar, MobileMenu, RowMenu, EditAddRowModal, AddTeamModal, MetricBlock, DashSection, BreadcrumbNav, HomePage };
