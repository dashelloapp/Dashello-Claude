import { useState, useRef, useEffect, useLayoutEffect, Fragment } from "react";
import { Section, Metric, MetricColor, OrgMember, TeamRow, TeamPermissions, OrgPermissionLevel, Task } from "../types";
import { IconGlyph, Av, Toggle, SectionCard, EditAddRowModal } from "../components/shared";
import { useTranslation } from "../i18n";
import { useSmartPosition } from "../hooks/useSmartPosition";
import { capitalize } from "../utils/helpers";
import { supabase } from "../lib/supabase";

const LEVEL_ORDER: OrgPermissionLevel[] = ["viewer", "editor", "admin", "owner"];

const _months = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "Jun.", "Jul.", "Aug.", "Sep.", "Oct.", "Nov.", "Dec."];
function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return `${_months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

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

function TeamPage({ sections, orgMembers, setOrgMembers, teamRows, setTeamRows, teamPermissions, setTeamPermissions, currentUserLevel, userEmail, onOpenInvite, onPreviewMember, onExitPreviewSave, previewFromSave, pendingMemberDetail, onClearPendingMember, tasks, setTasks, teamViewMode, menuPermissions }: {
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
  teamViewMode?: "row" | "expanded";
  menuPermissions?: Record<string, string[]>;
}) {
  const { t: __ } = useTranslation();
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [editingTeam, setEditingTeam] = useState<TeamRow | null>(null);
  const [permModalTeam, setPermModalTeam] = useState<TeamRow | null>(null);
  const [permModalMember, setPermModalMember] = useState<OrgMember | null>(null);
  const [transferringFrom, setTransferringFrom] = useState<OrgMember | null>(null);
  const [deleteConfirmMember, setDeleteConfirmMember] = useState<OrgMember | null>(null);
  const [deleteConfirmStep, setDeleteConfirmStep] = useState(0);
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
        <h1 style={{ margin: 0, fontSize: "clamp(20px,4vw,26px)", fontWeight: 700, color: "#1a2332" }}>{__('common.team', 'Team')}</h1>
        {isManager && (
          <button onClick={onOpenInvite} style={{ padding: "7px 18px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", marginLeft: "auto" }}>+ Invite</button>
        )}
      </div>

      {sortedTeams.length === 0 && isManager && (
        <div style={{ textAlign: "center", padding: 40, color: "#94a3b8", fontSize: 15 }}>
          No teams yet. Create one below.
        </div>
      )}

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

            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", flex: 1, minHeight: 48 }}>
                {membersInTeam.map(member => {
                  const levelColor = MEMBER_COLORS[member.level] || "#4C9FE8";
                  const isOwner = member.level === "owner";
                  const isSelf = member.email === userEmail;
                  const { allowedSections, metricCount } = computeMemberAccess(member);
                  const memberPriorityTasks = (tasks || []).filter(t => t.assignedTo === member.email && !t.done && t.priority);
                  const isExpanded = teamViewMode === "expanded";
                  return (
                    <div key={member.id}
                      onClick={() => { if (teamViewMode !== "expanded") setMemberDetail(member); }}
                      onMouseEnter={e => { if (teamViewMode !== "expanded") { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.boxShadow = "0 10px 28px rgba(0,0,0,0.15)"; } }}
                      onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.06)"; }}
                      style={{
                        width: isExpanded ? 320 : 140, minHeight: isExpanded ? 200 : 140, borderRadius: 16, background: "#f1f5f9",
                        padding: isExpanded ? "24px 20px" : "14px 10px", display: "flex", flexDirection: "column",
                        alignItems: "center", justifyContent: "flex-start", gap: isExpanded ? 10 : 10,
                        cursor: isExpanded ? "default" : "pointer", flexShrink: 0,
                        transition: "transform 0.15s, box-shadow 0.15s",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                        position: "relative",
                      }}
                    >
                      <div style={{ fontSize: 15, fontWeight: 700, color: levelColor, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "center", width: "100%" }}>
                        {isOwner ? "Owner" : member.level}
                      </div>
                      {member.avatarUrl ? (
                        <img src={member.avatarUrl} alt="" style={{ width: isExpanded ? 56 : 48, height: isExpanded ? 56 : 48, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                      ) : (
                        <div style={{ width: isExpanded ? 56 : 48, height: isExpanded ? 56 : 48, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: isExpanded ? 22 : 18, fontWeight: 700, color: "#94a3b8", flexShrink: 0 }}>
                          {(member.name?.[0] || member.email[0] || "?").toUpperCase()}
                        </div>
                      )}
                      <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332", textAlign: "center", width: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {capitalize(member.name) || member.email.split("@")[0]}
                      </div>
                      {isExpanded && (
                        <>
                          <div style={{ textAlign: "left", width: "100%", background: "#fff", borderRadius: 10, padding: "10px 10px", marginBottom: 4 }}>
                            <div style={{ fontSize: 15, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{__('common.access', 'Access')}</div>
                            <div style={{ fontSize: 15, color: "#1a2332", marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              <strong>{__('common.rows', 'Rows')}:</strong> {allowedSections.length > 0 ? allowedSections.map(s => s.title).join(", ") : "None"}
                            </div>
                            <div style={{ fontSize: 15, color: "#1a2332", marginBottom: 2 }}>
                              <strong>{__('common.metrics', 'Metrics')}:</strong> {metricCount}
                            </div>
                            {(() => {
                              const pageList = [
                                { id: "home", label: "Home" },
                                { id: "goals", label: "Goals" },
                                { id: "tasks", label: "Tasks" },
                                { id: "integrations", label: "Integrations" },
                                { id: "team", label: "Team" },
                                { id: "settings", label: "Settings" },
                                { id: "playbooks", label: "Playbooks" },
                              ];
                              const hidden = (menuPermissions || {})[member.level] || [];
                              const accessible = pageList.filter(p => !hidden.includes(p.id) && !(member.level === "viewer" && (p.id === "integrations" || p.id === "team"))).map(p => p.label);
                              return (
                                <div style={{ fontSize: 15, color: "#1a2332", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  <strong>{__('common.pages', 'Pages')}:</strong> {accessible.length > 0 ? accessible.join(", ") : "None"}
                                </div>
                              );
                            })()}
                          </div>
                          {memberPriorityTasks.length > 0 && (
                            <div style={{ width: "100%", background: "#fff", borderRadius: 10, padding: "10px 10px" }}>
                              <div style={{ fontSize: 15, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{__('common.priorities', 'Priorities')}</div>
                              {memberPriorityTasks.slice(0, 3).map(t => (
                                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                                  <span style={{ width: 14, height: 14, borderRadius: "50%", flexShrink: 0, border: "1.5px solid #d1d5db", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 15 }} />
                                  <span style={{ fontSize: 15, color: "#1a2332", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{t.text}</span>
                                </div>
                              ))}
                              {memberPriorityTasks.length > 3 && (
                                <div style={{ fontSize: 15, color: "#94a3b8", textAlign: "left", width: "100%" }}>
                                  +{memberPriorityTasks.length - 3} more
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}
                      {isSelf && (
                        <div style={{ background: "#334155", borderRadius: 99, padding: "2px 8px", fontSize: 15, fontWeight: 700, color: "#fff", marginTop: isExpanded ? 0 : -4 }}>
                          YOU
                        </div>
                      )}
                    </div>
                  );
                })}

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
                    <div style={{ fontSize: 15, fontWeight: 600, color: "#94a3b8", textAlign: "center", width: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {member.email.split("@")[0]}
                    </div>
                    <div style={{ fontSize: 15, color: "#94a3b8" }}>{__('common.pending', 'Pending')}</div>
                    {isManager && (
                      <div onClick={(e) => { e.stopPropagation(); handleResendInvite(member); }}
                        style={{ fontSize: 15, color: "#3B82F6", cursor: "pointer", fontWeight: 600 }}>
                        {__('common.resendInvite', 'Resend Invite')}
                      </div>
                    )}
                  </div>
                ))}

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

            <div style={{ height: 1, background: "#f1f5f9", marginTop: 20 }} />
          </div>
        );
      })}

      {isManager && (
        <div onClick={() => setShowAddTeam(true)} style={{ display: "flex", alignItems: "center", gap: 8, color: "#94a3b8", fontSize: 15, cursor: "pointer", padding: "6px 0" }}>
          <div style={{ width: 26, height: 26, borderRadius: "50%", border: "1.5px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, color: "#94a3b8" }}>+</div>
          Add Team
        </div>
      )}

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
              {memberDetail.avatarUrl ? (
                <img src={memberDetail.avatarUrl} alt="" style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover", margin: "0 auto 12px", display: "block" }} />
              ) : (
              <div style={{ width: 64, height: 64, borderRadius: "50%", background: bgColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 700, color: "#fff", margin: "0 auto 12px" }}>
                {(memberDetail.name?.[0] || memberDetail.email[0] || "?").toUpperCase()}
              </div>
              )}
              <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2332", marginBottom: 2 }}>{memberDetail.name || memberDetail.email}</div>
              <div style={{ fontSize: 15, color: "#3B82F6", fontWeight: 600, textTransform: "capitalize", marginBottom: 16 }}>{memberDetail.level}</div>
              <div style={{ textAlign: "left", background: "#f8fafc", borderRadius: 12, padding: "14px 16px", marginBottom: 18 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>{__('common.access', 'Access')}</div>
                <div style={{ fontSize: 15, color: "#1a2332", marginBottom: 4 }}>
                  <strong>{__('common.rows', 'Rows')}:</strong> {allowedSections.length > 0 ? allowedSections.map(s => s.title).join(", ") : "None"}
                </div>
                <div style={{ fontSize: 15, color: "#1a2332", marginBottom: 4 }}>
                  <strong>{__('common.metrics', 'Metrics')}:</strong> {metricCount}
                </div>
                <div style={{ fontSize: 15, color: "#1a2332" }}>
                  <strong>{__('common.pages', 'Pages')}:</strong> {(() => {
                    const pageList = [
                      { id: "home", label: "Home" },
                      { id: "goals", label: "Goals" },
                      { id: "tasks", label: "Tasks" },
                      { id: "integrations", label: "Integrations" },
                      { id: "team", label: "Team" },
                      { id: "settings", label: "Settings" },
                      { id: "playbooks", label: "Playbooks" },
                    ];
                    const hidden = (menuPermissions || {})[memberDetail.level] || [];
                    const accessible = pageList.filter(p => !hidden.includes(p.id) && !(memberDetail.level === "viewer" && (p.id === "integrations" || p.id === "team"))).map(p => p.label);
                    return accessible.length > 0 ? accessible.join(", ") : "None";
                  })()}
                </div>
              </div>
              {(tasks || []).filter(t => t.assignedTo === memberDetail.email && !t.done && t.priority).length > 0 && (
                <div style={{ textAlign: "left", background: "#f8fafc", borderRadius: 12, padding: "14px 16px", marginBottom: 18 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>{__('common.priorities', 'Priorities')}</div>
                  {(tasks || []).filter(t => t.assignedTo === memberDetail.email && !t.done && t.priority).map(t => (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <div onClick={(e) => { e.stopPropagation(); if (setTasks) setTasks(prev => prev.map(x => x.id === t.id ? { ...x, done: !x.done } : x)); }}
                        style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0, cursor: "pointer", border: t.done ? "none" : "1.5px solid #d1d5db", background: t.done ? "#4CAF7D" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 15 }}>{t.done ? "✓" : ""}</div>
                      <span style={{ fontSize: 15, color: "#1a2332", flex: 1, textDecoration: t.done ? "line-through" : "none", minWidth: 0 }}>{t.text}</span>
                      {t.dueDate && <span style={{ fontSize: 15, color: "#94a3b8", whiteSpace: "nowrap" }}>{formatDate(t.dueDate)}</span>}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {isSelf && memberDetail.level === "owner" && currentUserLevel === "owner" && (
                  <button onClick={() => { setTransferringFrom(memberDetail); setMemberDetail(null); }}
                    disabled={otherActiveMembers.length === 0}
                    style={{
                      width: "100%", padding: "10px 0", borderRadius: 8,
                      border: "1.5px solid #E8A317", background: "#fff",
                      color: otherActiveMembers.length === 0 ? "#cbd5e1" : "#E8A317",
                      fontSize: 15, fontWeight: 600, cursor: otherActiveMembers.length === 0 ? "not-allowed" : "pointer",
                    }}>
                    Transfer Ownership{otherActiveMembers.length === 0 ? " (no other members)" : ""}
                  </button>
                )}
                {isManager && !isSelf && memberDetail.level !== "owner" && (
                  <button onClick={() => { setPermModalMember(memberDetail); setMemberDetail(null); }}
                    style={{ width: "100%", padding: "10px 0", borderRadius: 8, border: "1.5px solid #3B82F6", background: "#fff", color: "#3B82F6", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
                    {__('common.editPermissions', 'Edit Permissions')}
                  </button>
                )}
                {isManager && !isSelf && memberDetail.level !== "owner" && sortedTeamsList.length > 1 && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <select value={memberDetail.teamId} onChange={e => {
                      setOrgMembers(prev => prev.map(m => m.id === memberDetail.id ? { ...m, teamId: e.target.value } : m));
                      setMemberDetail(null);
                    }}
                      style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", background: "#fff" }}>
                      {sortedTeamsList.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <span style={{ fontSize: 15, color: "#94a3b8", whiteSpace: "nowrap" }}>{__('common.changeTeam', 'Change Team')}</span>
                  </div>
                )}
                {isManager && !isSelf && memberDetail.level !== "owner" && (
                  <button onClick={() => { setDeleteConfirmMember(memberDetail); setDeleteConfirmStep(0); setMemberDetail(null); }}
                    style={{ width: "100%", padding: "10px 0", borderRadius: 8, border: "1.5px solid #E85D75", background: "#fff", color: "#E85D75", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
                    {__('common.deleteMember', 'Delete Member')}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {transferringFrom && (
        <div onClick={() => setTransferringFrom(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "28px", width: "100%", maxWidth: 400, boxShadow: "0 24px 64px rgba(0,0,0,0.18)" }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 700, color: "#1a2332" }}>{__('common.transferOwnership', 'Transfer Ownership')}</h3>
            <p style={{ fontSize: 15, color: "#64748b", marginBottom: 16 }}>{__('team.transferOwnershipDesc', 'Select a team member to become the new owner. You will become an admin.')}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {orgMembers.filter(m => m.id !== transferringFrom.id && m.status === "active").map(m => (
                <div key={m.id} onClick={() => handleTransferOwnership(m.id)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, border: "1px solid #e2e8f0", cursor: "pointer", background: "#fff" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                  onMouseLeave={e => (e.currentTarget.style.background = "#fff")}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: MEMBER_COLORS[m.level] || "#4C9FE8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
                    {(m.name?.[0] || m.email[0] || "?").toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332" }}>{m.name || m.email}</div>
                    <div style={{ fontSize: 15, color: "#64748b", textTransform: "capitalize" }}>{m.level}</div>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setTransferringFrom(null)} style={{ marginTop: 16, width: "100%", padding: "10px 0", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", color: "#64748b", fontSize: 15, cursor: "pointer" }}>{__('common.cancel', 'Cancel')}</button>
          </div>
        </div>
      )}

      {deleteConfirmMember && (
        <div onClick={() => { setDeleteConfirmMember(null); setDeleteConfirmStep(0); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "28px", width: "100%", maxWidth: 380, boxShadow: "0 24px 64px rgba(0,0,0,0.18)", textAlign: "center" }}>
            {deleteConfirmStep === 0 ? (
              <>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332", marginBottom: 8 }}>Remove {deleteConfirmMember.name || deleteConfirmMember.email}?</div>
                <p style={{ fontSize: 15, color: "#64748b", marginBottom: 18 }}>{__('team.deleteMemberDesc', 'This member will lose access to this organization and its data.')}</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => { setDeleteConfirmMember(null); setDeleteConfirmStep(0); }}
                    style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", color: "#64748b", fontSize: 15, cursor: "pointer" }}>
                    Cancel
                  </button>
                  <button onClick={() => setDeleteConfirmStep(1)}
                    style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: "#E85D75", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
                    Delete
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#E85D75", marginBottom: 8 }}>Confirm Deletion</div>
                <p style={{ fontSize: 15, color: "#64748b", marginBottom: 18 }}>Are you absolutely sure? This action cannot be undone. All access for <strong>{deleteConfirmMember.name || deleteConfirmMember.email}</strong> will be permanently removed.</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => { setDeleteConfirmMember(null); setDeleteConfirmStep(0); }}
                    style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", color: "#64748b", fontSize: 15, cursor: "pointer" }}>
                    Cancel
                  </button>
                  <button onClick={() => { setOrgMembers(prev => prev.filter(m => m.id !== deleteConfirmMember.id)); setDeleteConfirmMember(null); setDeleteConfirmStep(0); }}
                    style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: "#E85D75", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
                    Yes, Delete Forever
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

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
              <p style={{ margin: "0 0 18px", fontSize: 15, color: "#94a3b8" }}>{__('team.selectOrInvite', 'Select an existing member or invite a new one.')}</p>

              {membersNotInTeam.length > 0 && (
                <>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>{__('team.existingMembers', 'Existing Members')}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
                    {membersNotInTeam.map(m => (
                      <div key={m.id} onClick={() => handleAddExistingMember(m.id)}
                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10, border: "1px solid #e2e8f0", cursor: "pointer", background: "#fff" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                        onMouseLeave={e => (e.currentTarget.style.background = "#fff")}>
                        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: "#94a3b8", flexShrink: 0 }}>
                          {(m.name?.[0] || m.email[0] || "?").toUpperCase()}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332" }}>{m.name || m.email.split("@")[0]}</div>
                          <div style={{ fontSize: 15, color: "#64748b", textTransform: "capitalize" }}>{m.level}</div>
                        </div>
                        <div style={{ fontSize: 15, color: "#3B82F6", fontWeight: 600 }}>{__('common.add', 'Add')}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 16 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>{__('team.inviteNew', 'Invite New Member')}</div>
                <input value={addMemberEmail} onChange={e => setAddMemberEmail(e.target.value)} placeholder="Email"
                  style={{ width: "100%", padding: "8px 11px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box", marginBottom: 8 }} />
                <select value={addMemberLevel} onChange={e => setAddMemberLevel(e.target.value as OrgPermissionLevel)}
                  style={{ width: "100%", padding: "7px 9px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", background: "#fff", marginBottom: 10 }}>
                  {LEVEL_ORDER.slice(0, LEVEL_ORDER.indexOf(currentUserLevel) + 1).map(l => (
                    <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>
                  ))}
                </select>
                <button onClick={handleInviteNewMemberToTeam}
                  style={{ width: "100%", padding: "9px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
                  Send Invite
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showAddTeam && <EditAddRowModal onSave={(name) => { addTeam(name); setShowAddTeam(false); }} onClose={() => setShowAddTeam(false)} />}

      {editingTeam && (
        <EditAddRowModal initial={editingTeam.name} onSave={(name) => { renameTeam(editingTeam.id, name); setEditingTeam(null); }} onClose={() => setEditingTeam(null)} />
      )}

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

function TeamRowMenu({ isDefault, onEditPermissions, onRename, onDelete }: { isDefault?: boolean; onEditPermissions: () => void; onRename: () => void; onDelete: () => void; }) {
  const { t: __ } = useTranslation();
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
      <div ref={triggerRef} onClick={() => setOpen(v => !v)} style={{ width: 26, height: 26, borderRadius: "50%", background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 15, color: "#94a3b8", flexShrink: 0 }}>···</div>
      {open && (
        <div ref={menuRef} style={{ ...menuPos, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid #e2e8f0", zIndex: 100, minWidth: 170, overflow: "hidden" }}>
          <div onClick={() => { if (!isDefault) { setOpen(false); onEditPermissions(); } }}
            style={{ padding: "9px 14px", fontSize: 15, cursor: isDefault ? "not-allowed" : "pointer", color: isDefault ? "#94a3b8" : "#1a2332" }}
            onMouseEnter={e => { if (!isDefault) e.currentTarget.style.background = "#f8fafc"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>{__('common.editPermissions', 'Edit Permissions')}{isDefault ? " (locked)" : ""}</div>
          <div onClick={() => { setOpen(false); onRename(); }}
            style={{ padding: "9px 14px", fontSize: 15, cursor: "pointer", color: "#1a2332" }}
            onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>{__('common.editName', 'Edit Name')}</div>
          {!confirmDelete
            ? <div onClick={() => setConfirmDelete(true)}
                style={{ padding: "9px 14px", fontSize: 15, cursor: "pointer", color: "#E85D75" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#fff5f5")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>{__('team.delete', 'Delete Team')}</div>
            : <div style={{ padding: "10px 14px", borderTop: "1px solid #f1f5f9" }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#E85D75", marginBottom: 8 }}>Delete this team?</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => setConfirmDelete(false)}
                    style={{ flex: 1, padding: "5px 0", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>{__('common.cancel', 'Cancel')}</button>
                  <button onClick={() => { onDelete(); setOpen(false); }}
                    style={{ flex: 1, padding: "5px 0", borderRadius: 6, border: "none", background: "#E85D75", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{__('common.delete', 'Delete')}</button>
                </div>
              </div>}
        </div>
      )}
    </div>
  );
}

function TeamPermissionsModal({ teamName, sections, initialPermissions, onSave, onClose }: {
  teamName: string; sections: Section[];
  initialPermissions: TeamPermissions;
  onSave: (perms: TeamPermissions) => void; onClose: () => void;
}) {
  const { t: __ } = useTranslation();
  const [allowedSectionIds, setAllowedSectionIds] = useState<string[] | null>(initialPermissions.allowedSectionIds);
  const [metricOverrides, setMetricOverrides] = useState<{ sectionId: string; allowedMetricIds: string[] | null }[] | null>(initialPermissions.metricOverrides);
  const PAGE_LABELS: Record<string, string> = { home: "Home", goals: "Goals", playbooks: "Playbooks" };
  const [allowedPageIds, setAllowedPageIds] = useState<string[] | null>(initialPermissions.allowedPageIds ?? null);
  const isPageAllowed = (pid: string) => allowedPageIds === null || allowedPageIds.includes(pid);

  const toggleSection = (sid: string, on: boolean) => {
    setAllowedSectionIds(prev => {
      if (prev === null) {
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
        if (!existing) return current;
        const updatedMetrics = existing.allowedMetricIds === null ? null : (existing.allowedMetricIds.includes(mid) ? existing.allowedMetricIds : [...existing.allowedMetricIds, mid]);
        if (updatedMetrics === null) {
          return current.filter(m => m.sectionId !== sid);
        }
        return current.map(m => m.sectionId === sid ? { ...m, allowedMetricIds: updatedMetrics } : m);
      }
      if (existing?.allowedMetricIds === null) {
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
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#1a2332" }}>{__('team.permissionsFor', 'Permissions for')} {teamName}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>×</button>
        </div>
        <p style={{ fontSize: 15, color: "#94a3b8", marginBottom: 16 }}>{__('team.selectAccess', 'Select which rows and metric boxes this team can access.')}</p>

        {sections.map(section => (
          <div key={section.id} style={{ marginBottom: 14, border: "1px solid #f1f5f9", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "#f8fafc", borderBottom: isSectionAllowed(section.id) ? "1px solid #f1f5f9" : "none" }}>
              <input type="checkbox" checked={isSectionAllowed(section.id)} onChange={e => toggleSection(section.id, e.target.checked)}
                style={{ accentColor: "#3B82F6", width: 16, height: 16, cursor: "pointer", flexShrink: 0 }} />
              <span style={{ fontSize: 15, fontWeight: 600, color: "#1a2332", flex: 1 }}>{section.title}</span>
              <span style={{ fontSize: 15, color: "#94a3b8" }}>{section.metrics.length} box{section.metrics.length !== 1 ? "es" : ""}</span>
            </div>
            {isSectionAllowed(section.id) && section.metrics.length > 0 && (
              <div style={{ padding: "6px 14px 10px 38px" }}>
                {section.metrics.map(m => (
                  <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer" }}>
                    <input type="checkbox" checked={isMetricAllowed(section.id, m.id)}
                      onChange={e => toggleMetric(section.id, m.id, e.target.checked)}
                      style={{ accentColor: "#3B82F6", width: 14, height: 14, cursor: "pointer", flexShrink: 0 }} />
                    <span style={{ fontSize: 15, color: "#475569" }}>{m.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}

        <div style={{ marginBottom: 16, border: "1px solid #f1f5f9", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", background: "#f8fafc", fontSize: 15, fontWeight: 600, color: "#1a2332" }}>{__('common.pageAccess', 'Page Access')}</div>
          <div style={{ padding: "6px 14px 10px" }}>
            {Object.entries(PAGE_LABELS).map(([id, label]) => (
              <label key={id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer" }}>
                <input type="checkbox" checked={isPageAllowed(id)}
                  onChange={e => setAllowedPageIds(prev => {
                    if (prev === null) return e.target.checked ? null : Object.keys(PAGE_LABELS).filter(k => k !== id);
                    if (e.target.checked) return [...prev, id];
                    const next = prev.filter(p => p !== id);
                    return next.length === 0 ? null : next;
                  })}
                  style={{ accentColor: "#3B82F6", width: 14, height: 14, cursor: "pointer", flexShrink: 0 }} />
                <span style={{ fontSize: 15, color: "#475569" }}>{label}</span>
              </label>
            ))}
          </div>
        </div>

        <button onClick={() => { onSave({ teamId: initialPermissions.teamId, allowedSectionIds, metricOverrides, allowedPageIds }); }}
          style={{ width: "100%", padding: "11px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
          Save Permissions
        </button>
      </div>
    </div>
  );
}

function MemberPermissionsModal({ member, sections, initialPerms, onSave, onViewAs, onClose }: {
  member: OrgMember; sections: Section[];
  initialPerms: TeamPermissions | null;
  onSave: (perms: TeamPermissions) => void;
  onViewAs: (perms: TeamPermissions) => void;
  onClose: () => void;
}) {
  const { t: __ } = useTranslation();
  const [allowedSectionIds, setAllowedSectionIds] = useState<string[] | null>(initialPerms?.allowedSectionIds ?? null);
  const [metricOverrides, setMetricOverrides] = useState<{ sectionId: string; allowedMetricIds: string[] | null }[] | null>(initialPerms?.metricOverrides ?? null);
  const PAGE_LABELS: Record<string, string> = { home: "Home", goals: "Goals", playbooks: "Playbooks" };
  const [allowedPageIds, setAllowedPageIds] = useState<string[] | null>(initialPerms?.allowedPageIds ?? null);
  const isPageAllowed = (pid: string) => allowedPageIds === null || allowedPageIds.includes(pid);

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

  const currentPerms: TeamPermissions = { teamId: initialPerms?.teamId ?? "", allowedSectionIds, metricOverrides, allowedPageIds };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "24px", width: "100%", maxWidth: 520, boxShadow: "0 20px 60px rgba(0,0,0,0.18)", overflowY: "auto", maxHeight: "90vh" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#4C9FE8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: "#fff" }}>
              {(member.name?.[0] || member.email[0] || "?").toUpperCase()}
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#1a2332" }}>{member.name || member.email}</h3>
              <div style={{ fontSize: 15, color: "#64748b", textTransform: "capitalize" }}>{member.level}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>×</button>
        </div>
        <p style={{ fontSize: 15, color: "#94a3b8", marginBottom: 16 }}>{__('team.memberAccessDesc', 'Select which rows, metric boxes, and pages this member can access.')}</p>

        {sections.map(section => (
          <div key={section.id} style={{ marginBottom: 12, border: "1px solid #f1f5f9", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "#f8fafc", borderBottom: isSectionAllowed(section.id) ? "1px solid #f1f5f9" : "none" }}>
              <input type="checkbox" checked={isSectionAllowed(section.id)} onChange={e => toggleSection(section.id, e.target.checked)}
                style={{ accentColor: "#3B82F6", width: 16, height: 16, cursor: "pointer", flexShrink: 0 }} />
              <span style={{ fontSize: 15, fontWeight: 600, color: "#1a2332", flex: 1 }}>{section.title}</span>
              <span style={{ fontSize: 15, color: "#94a3b8" }}>{section.metrics.length} box{section.metrics.length !== 1 ? "es" : ""}</span>
            </div>
            {isSectionAllowed(section.id) && section.metrics.length > 0 && (
              <div style={{ padding: "6px 14px 10px 38px" }}>
                {section.metrics.map(m => (
                  <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer" }}>
                    <input type="checkbox" checked={isMetricAllowed(section.id, m.id)}
                      onChange={e => toggleMetric(section.id, m.id, e.target.checked)}
                      style={{ accentColor: "#3B82F6", width: 14, height: 14, cursor: "pointer", flexShrink: 0 }} />
                    <span style={{ fontSize: 15, color: "#475569" }}>{m.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}

        <div style={{ marginBottom: 16, border: "1px solid #f1f5f9", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", background: "#f8fafc", fontSize: 15, fontWeight: 600, color: "#1a2332" }}>{__('common.pageAccess', 'Page Access')}</div>
          <div style={{ padding: "6px 14px 10px" }}>
            {Object.entries(PAGE_LABELS).map(([id, label]) => (
              <label key={id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer" }}>
                <input type="checkbox" checked={isPageAllowed(id)}
                  onChange={e => setAllowedPageIds(prev => {
                    if (prev === null) return e.target.checked ? null : Object.keys(PAGE_LABELS).filter(k => k !== id);
                    if (e.target.checked) return [...prev, id];
                    const next = prev.filter(p => p !== id);
                    return next.length === 0 ? null : next;
                  })}
                  style={{ accentColor: "#3B82F6", width: 14, height: 14, cursor: "pointer", flexShrink: 0 }} />
                <span style={{ fontSize: 15, color: "#475569" }}>{label}</span>
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button onClick={() => { onViewAs(currentPerms); }}
            style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1.5px solid #3B82F6", background: "#fff", color: "#3B82F6", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
            View as {member.name || member.email}
          </button>
          <button onClick={() => { onSave(currentPerms); }}
            style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
            Save Permissions
          </button>
        </div>
      </div>
    </div>
  );
}

export { TeamPage, TeamRowMenu, TeamPermissionsModal, MemberPermissionsModal };
