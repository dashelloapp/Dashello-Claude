import { useState, useRef, useEffect, Fragment } from "react";
import { FiveAccountSettings, FiveAccountMode, OrgPermissionLevel, Metric, Section } from "../types";
import { IconGlyph, Av, Toggle, SectionCard, LanguageSelector } from "../components/shared";
import { FIVE_DESC, FIVE_EQUATION_POINTS, FIVE_ACCOUNT_LABELS, WORLD_CURRENCIES, DEFAULT_FIVE_ACCOUNT_SETTINGS } from "../utils/constants";
import { runFiveAccountEquation, syncSettingsToMetrics, makeFiveAccountMetric, applyAccessibilitySettings } from "../utils/equations";
import { useTranslation } from "../i18n";
import { supabase } from "../lib/supabase";

function ProfileField({ label, value, onChange, disabled }: { label: string; value: string; onChange?: (v: string) => void; disabled?: boolean }) {
  return (
    <div style={{ marginBottom: 13 }}>
      <label style={{ fontSize: 15, color: "#64748b", display: "block", marginBottom: 3 }}>{label}</label>
      <input value={value} onChange={e => onChange?.(e.target.value)} disabled={disabled}
        style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" as const, background: disabled ? "#f8fafc" : "#fff", color: disabled ? "#94a3b8" : "#1a2332" }} />
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
  const { t: __ } = useTranslation();
  const [localProfile, setLocalProfile] = useState({
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
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const setDirtyBoth = (v: boolean) => { setDirty(v); dirtyRef.current = v; };
  const [uploading, setUploading] = useState(false);
  const [fiveAccountConfirm, setFiveAccountConfirm] = useState(false);
  const [timezoneSearch, setTimezoneSearch] = useState("");
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirtyRef.current) e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);
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
      timezone: data.timezone ?? "",
      acc_header_size: data.acc_header_size ?? 30,
      acc_subheading_size: data.acc_subheading_size ?? 20,
      acc_min_body: data.acc_min_body ?? 15,
    });
    if (data) applyAccessibilitySettings(data.acc_header_size ?? 30, data.acc_min_body ?? 15, data.acc_subheading_size ?? 20);
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
    await supabase.from("profiles").upsert({ id: userId, ...updated, updated_at: new Date().toISOString() });
    onProfileSaved(updated);
    if (v) {
      onFiveAccountCreated();
      setFiveAccountConfirm(true);
      setTimeout(() => setFiveAccountConfirm(false), 4000);
    } else {
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
        <div style={{ fontSize: 15, color: "#1a2332" }}>{label} <span style={{ fontSize: 15, color: "#94a3b8", fontStyle: "italic" }}>(coming soon)</span></div>
        <div style={{ fontSize: 15, color: "#94a3b8" }}>{sub}</div>
      </div>
      <Toggle on={false} onChange={() => { }} disabled />
    </div>
  );

  return (
    <div style={{ padding: "clamp(16px,4vw,32px)", maxWidth: 860 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: "clamp(20px,4vw,26px)", fontWeight: 700, color: "#1a2332" }}>{__('common.profile', 'Profile')}</h1>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20, alignItems: "start" }}>
        <div style={{ background: "#fff", borderRadius: 14, padding: 22, border: "1px solid #f1f5f9", alignSelf: "start" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
            <div onClick={() => fileRef.current?.click()} style={{ width: 58, height: 58, borderRadius: "50%", background: "#4C9FE8", cursor: "pointer", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
              {localProfile.avatar_url ? <img src={localProfile.avatar_url} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (localProfile.full_name?.[0]?.toUpperCase() ?? "👤")}
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={handlePhotoUpload} style={{ display: "none" }} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332" }}>{localProfile.full_name || "Your Name"}</div>
              <button onClick={() => fileRef.current?.click()} style={{ fontSize: 15, color: "#3B82F6", background: "none", border: "none", cursor: "pointer", padding: 0 }}>{uploading ? "Uploading..." : "Change photo"}</button>
            </div>
          </div>
          <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 600, color: "#1a2332" }}>Account</h3>
          <ProfileField label="Full Name" value={localProfile.full_name} onChange={v => { setLocalProfile(p => ({ ...p, full_name: v })); setDirtyBoth(true); }} />
          <ProfileField label="Email" value={userEmail} disabled />
          <ProfileField label="Company" value={localProfile.company} onChange={currentUserLevel === "owner" || !currentUserLevel ? v => { setLocalProfile(p => ({ ...p, company: v })); setDirtyBoth(true); } : undefined} disabled={currentUserLevel !== "owner" && currentUserLevel !== undefined} />
            <div style={{ position: "relative" }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>{__('common.timezone', 'Timezone')}</div>
              <input value={localProfile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone} onChange={e => { setLocalProfile(p => ({ ...p, timezone: e.target.value })); setTimezoneSearch(e.target.value); setDirtyBoth(true); }}
                onFocus={() => setTimezoneSearch(localProfile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)}
                placeholder="Start typing to search..."
                style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
              {timezoneSearch && (() => {
                const allTz = Intl.supportedValuesOf?.("timeZone") || [
                  "America/New_York","America/Chicago","America/Denver","America/Los_Angeles","America/Anchorage","Pacific/Honolulu",
                  "Europe/London","Europe/Paris","Europe/Berlin","Europe/Moscow","Asia/Dubai","Asia/Kolkata","Asia/Shanghai","Asia/Tokyo",
                  "Australia/Sydney","Pacific/Auckland","UTC",
                ];
                const filtered = allTz.filter(tz => tz.toLowerCase().includes(timezoneSearch.toLowerCase()));
                if (filtered.length === 0 || (filtered.length === 1 && filtered[0].toLowerCase() === timezoneSearch.toLowerCase())) return null;
                return (
                  <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid #e2e8f0", zIndex: 200, maxHeight: 200, overflowY: "auto", marginTop: 2 }}>
                    {filtered.map(tz => (
                      <div key={tz} onClick={() => { setLocalProfile(p => ({ ...p, timezone: tz })); setTimezoneSearch(""); }}
                        style={{ padding: "7px 10px", fontSize: 15, cursor: "pointer", color: "#1a2332", borderBottom: "1px solid #f1f5f9" }}
                        onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>{tz}</div>
                    ))}
                  </div>
                );
              })()}
            </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {(currentUserLevel === "owner" || !currentUserLevel) && (
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, border: "1px solid #f1f5f9", opacity: 0.55, pointerEvents: "none" as const }}>
            <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 600, color: "#94a3b8" }}>{__('common.plan', 'Plan')}</h3>
            {[{ name: "Free", features: "3 rows, 10 metrics" }, { name: "Pro", features: "Unlimited rows, integrations" }, { name: "Business", features: "Team access, all apps" }].map(p => (
              <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, marginBottom: 6, background: p.name === "Pro" ? "#EFF6FF" : "#F8FAFC", border: p.name === "Pro" ? "1.5px solid #3B82F6" : "1.5px solid transparent" }}>
                <div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid", borderColor: p.name === "Pro" ? "#3B82F6" : "#d1d5db", background: p.name === "Pro" ? "#3B82F6" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {p.name === "Pro" && <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#fff" }} />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332" }}>{p.name}</div>
                  <div style={{ fontSize: 15, color: "#94a3b8" }}>{p.features}</div>
                </div>
              </div>
            ))}
          </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, border: "1px solid #f1f5f9" }}>
            <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 600, color: "#1a2332" }}>{__('common.preferences', 'Preferences')}</h3>
            <GrayPref label="Email notifications" sub="Daily digest of key metrics" />
            <GrayPref label="Dark mode" sub="Switch to dark theme" />
            <GrayPref label="Two-factor auth" sub="Require 2FA on login" />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0" }}>
              <div>
                <div style={{ fontSize: 15, color: "#1a2332" }}>{__('common.fiveAccount', 'Five-Account System')}</div>
                <div style={{ fontSize: 15, color: "#94a3b8" }}>{__('settings.enableProfitFirst', 'Enable Profit First method globally')}</div>
              </div>
              <Toggle on={localProfile.five_account_enabled} onChange={handleFiveAccountToggle} />
            </div>
            {fiveAccountConfirm && (
              <div style={{ marginTop: 8, background: "#F0FDF4", border: "1px solid #c3e6d4", borderRadius: 8, padding: "8px 12px", fontSize: 15, color: "#0F6E56", display: "flex", alignItems: "center", gap: 6 }}>
                ✓ Five-Account System created — Finances row added to your dashboard.
              </div>
            )}

            {localProfile.five_account_enabled && (
              <div style={{ background: "#F0FDF4", border: "1px solid #c3e6d4", borderRadius: 10, padding: "12px 14px", marginTop: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#0F6E56", marginBottom: 10 }}>{__('settings.fiveAccountConfig', 'Five-Account Configuration')}</div>

                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332", marginBottom: 6 }}>Bank Account Mode</div>
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
                        <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332" }}>{label}</div>
                        <div style={{ fontSize: 15, color: "#64748b" }}>{sub}</div>
                      </div>
                    </label>
                  ))}
                </div>

                <div style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: 15, fontWeight: 600, color: "#1a2332", display: "block", marginBottom: 3 }}>{__('settings.monthlyExpenses', 'Monthly Operating Expenses (incl. owner salary)')}</label>
                  <input type="number" value={fiveAccountSettings.monthlyExpenses || ""}
                    onChange={e => onFiveAccountSettingsChange({ ...fiveAccountSettings, monthlyExpenses: parseFloat(e.target.value) || 0 })}
                    placeholder="e.g. 25000"
                    style={{ width: "100%", padding: "6px 10px", borderRadius: 7, border: "1.5px solid #c3e6d4", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
                  {fiveAccountSettings.monthlyExpenses > 0 && (
                    <div style={{ fontSize: 15, color: "#64748b", marginTop: 3 }}>
                      Overhead target: <strong>${(fiveAccountSettings.monthlyExpenses * 2).toLocaleString()}</strong> &nbsp;·&nbsp;
                      Profit target: <strong>${(fiveAccountSettings.monthlyExpenses * 6).toLocaleString()}</strong>
                    </div>
                  )}
                </div>

                <div style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: 15, fontWeight: 600, color: "#1a2332", display: "block", marginBottom: 3 }}>{__('settings.ownerSalary', "Total Owner's Salary (monthly)")}</label>
                 <input type="number" value={fiveAccountSettings.ownerSalary ?? ""}
                    onChange={e => onFiveAccountSettingsChange({ ...fiveAccountSettings, ownerSalary: parseFloat(e.target.value) || 0 })}
                    placeholder="e.g. 8000"
                    style={{ width: "100%", padding: "6px 10px", borderRadius: 7, border: "1.5px solid #c3e6d4", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
                  {fiveAccountSettings.ownerSalary > 0 && (
                    <div style={{ fontSize: 15, color: "#64748b", marginTop: 3 }}>
                      Annual: <strong>${(fiveAccountSettings.ownerSalary * 12).toLocaleString()}</strong>
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderTop: "1px solid #c3e6d4", marginTop: 6 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332" }}>{__('settings.postTxnOnEdit', 'Post Transaction on Edit')}</div>
                    <div style={{ fontSize: 15, color: "#64748b" }}>{__('settings.promptTransaction', 'Prompt to log a transaction when a Five-Account value changes')}</div>
                  </div>
                  <Toggle on={fiveAccountSettings.postTransactionEnabled}
                    onChange={v => onFiveAccountSettingsChange({ ...fiveAccountSettings, postTransactionEnabled: v })} />
                </div>

                <button onClick={() => onFiveAccountSettingsChange(DEFAULT_FIVE_ACCOUNT_SETTINGS)}
                  style={{ marginTop: 10, width: "100%", padding: "6px 0", borderRadius: 7, border: "1px solid #c3e6d4", background: "transparent", fontSize: 15, color: "#0F6E56", cursor: "pointer", fontWeight: 600 }}>
                  Reset to Profit First Defaults
                </button>
              </div>
            )}
          </div>
        </div>

          <div style={{ background: "#fff", borderRadius: 14, padding: 20, border: "1px solid #f1f5f9" }}>
            <h3 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 600, color: "#1a2332" }}>{__('common.healthScore', 'Health Score')}</h3>
            <p style={{ margin: "0 0 14px", fontSize: 15, color: "#94a3b8", lineHeight: 1.5 }}>
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
                  <span style={{ fontSize: 15, color: "#1a2332" }}>{label}</span>
                </div>
                <input
                  type="number"
                  step={0.1}
                  value={localProfile[key]}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    if (isNaN(v)) return;
                    setLocalProfile(p => ({ ...p, [key]: v }));
                    setDirtyBoth(true);
                  }}
                  style={{ width: 72, padding: "5px 9px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", textAlign: "right" }}
                />
              </div>
            ))}
          </div>

          {(currentUserLevel === "owner" || !currentUserLevel) && (
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, border: "1px solid #f1f5f9" }}>
            <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 600, color: "#1a2332" }}>{__('common.menuVisibility', 'Menu Visibility')}</h3>
            <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 14 }}>{__('settings.menuVisibilityDesc', 'Customize which menu items each role can access. Home is always visible.')}</div>
            {(["viewer","editor","admin"] as const).map(level => {
              const hidden = localProfile.menu_permissions?.[level] || [];
              return (
                <div key={level} style={{ marginBottom: 12, background: "#F8FAFC", borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332", marginBottom: 8, textTransform: "capitalize" }}>{level}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {(["goals","tasks","playbooks","integrations","team","settings"] as const).map(item => {
                      const isHidden = hidden.includes(item);
                      const forcedOff = level === "viewer" && (item === "integrations" || item === "team");
                      return (
                        <label key={item} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, background: forcedOff ? "#f1f5f9" : isHidden ? "#F8FAFC" : "#F0FDF4", border: forcedOff ? "1px solid #e2e8f0" : isHidden ? "1px solid #e2e8f0" : "1px solid #c3e6d4", fontSize: 15, color: forcedOff ? "#94a3b8" : isHidden ? "#64748b" : "#0F6E56", cursor: forcedOff ? "not-allowed" : "pointer", userSelect: "none", opacity: forcedOff ? 0.5 : 1 }}>
                          <input type="checkbox" checked={!forcedOff && !isHidden} disabled={forcedOff}
                            onChange={() => {
                              const next = isHidden ? hidden.filter(h => h !== item) : [...hidden, item];
                              setLocalProfile(p => ({ ...p, menu_permissions: { ...p.menu_permissions, [level]: next } })); setDirtyBoth(true);
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

          <div style={{ background: "#fff", borderRadius: 14, padding: 20, border: "1px solid #f1f5f9" }}>
            <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 600, color: "#1a2332" }}>{__('settings.accessibility', 'Accessibility')}</h3>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 6 }}>{__('settings.headerSize', 'Header Size')} (px)</div>
              <input type="number" min={15} max={36} value={localProfile.acc_header_size}
                onChange={e => {
                  const v = parseInt(e.target.value);
                  if (isNaN(v)) return;
                  setLocalProfile(p => ({ ...p, acc_header_size: v < 15 ? 15 : Math.min(v, 36) }));
                  setDirtyBoth(true);
                }}
                style={{ width: 80, padding: "5px 9px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }}
              />
              {localProfile.acc_header_size < 15 && <span style={{ fontSize: 15, color: "#E85D75", marginLeft: 8 }}>{__('settings.headerMinError', "Can't go lower than 15px")}</span>}
              <div style={{ marginTop: 8, fontSize: localProfile.acc_header_size, fontWeight: 700, color: "#1a2332" }}>
                {__('settings.headerPreview', 'Preview Heading')} — {localProfile.acc_header_size}px
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 6 }}>{__('settings.subheadingSize', 'Subheading Size')} (px)</div>
              <input type="number" min={13} max={30} value={localProfile.acc_subheading_size}
                onChange={e => {
                  const v = parseInt(e.target.value);
                  if (isNaN(v)) return;
                  setLocalProfile(p => ({ ...p, acc_subheading_size: v < 13 ? 13 : Math.min(v, 30) }));
                  setDirtyBoth(true);
                }}
                style={{ width: 80, padding: "5px 9px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }}
              />
              <div style={{ marginTop: 8, fontSize: localProfile.acc_subheading_size, fontWeight: 600, color: "#1a2332" }}>
                {__('settings.subheadingPreview', 'Preview Subheading')} — {localProfile.acc_subheading_size}px
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 6 }}>{__('settings.bodyTextSize', 'Body Text Size')} (px)</div>
              <input type="number" min={11} max={24} value={localProfile.acc_min_body}
                onChange={e => {
                  const v = parseInt(e.target.value);
                  if (isNaN(v)) return;
                  setLocalProfile(p => ({ ...p, acc_min_body: v < 11 ? 11 : Math.min(v, 24) }));
                  setDirtyBoth(true);
                }}
                style={{ width: 80, padding: "5px 9px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }}
              />
              {localProfile.acc_min_body < 11 && <span style={{ fontSize: 15, color: "#E85D75", marginLeft: 8 }}>{__('settings.bodyMinError', "Can't go lower than 11px")}</span>}
              <div style={{ marginTop: 8, fontSize: localProfile.acc_min_body, color: "#64748b" }}>
                {__('settings.bodyPreview', 'Preview body text')} — {localProfile.acc_min_body}px
              </div>
            </div>
            <LanguageSelector onChange={() => setDirtyBoth(true)} />
          </div>
        <div style={{ position: "sticky", bottom: 0, background: "#F8FAFC", padding: "16px 0", display: "flex", justifyContent: "center", zIndex: 100 }}>
          <button onClick={async () => {
              setSaving(true);
              const { error } = await supabase.from("profiles").upsert({ id: userId, ...localProfile, updated_at: new Date().toISOString() });
              if (!error) { onProfileSaved({ ...localProfile }); applyAccessibilitySettings(localProfile.acc_header_size, localProfile.acc_min_body, localProfile.acc_subheading_size); setSaved(true); setDirtyBoth(false); setTimeout(() => window.location.reload(), 800); }
              setSaving(false);
            }} disabled={saving}
            style={{ padding: "12px 48px", borderRadius: 8, border: "none", background: dirty ? "linear-gradient(135deg,#3B82F6,#06B6D4)" : "#e2e8f0", color: "#fff", fontSize: 15, fontWeight: 600, cursor: dirty && !saving ? "pointer" : "default" }}>
            {saving ? "Saving..." : saved ? "✓ Saved!" : dirty ? "Save All Changes" : "All settings saved"}
          </button>
        </div>
      </div>
    </div>
  );
}

export { SettingsPage, ProfileField };
