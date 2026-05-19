import { useState } from "react";
import { IconGlyph, SectionCard, Toggle } from "../components/shared";
import { useTranslation } from "../i18n";

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
        <h1 style={{ margin: 0, fontSize: "clamp(20px,4vw,26px)", fontWeight: 700, color: "#1a2332" }}>All Apps <span style={{ fontSize: 15, color: "#94a3b8", fontWeight: 400 }}>(Coming Soon)</span></h1>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search apps..."
            style={{ padding: "7px 13px", borderRadius: 20, border: "1px solid #e2e8f0", fontSize: 15, outline: "none", width: 160 }} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 14, marginBottom: 28, opacity: 0.35, pointerEvents: "none", filter: "grayscale(0.7)", userSelect: "none" }}>
        {filtered.map(app => (
          <div key={app.id} onClick={() => onSelectApp(app)} style={{ background: "#fff", borderRadius: 14, padding: 18, border: "1px solid #f1f5f9", cursor: "pointer", transition: "box-shadow 0.15s" }}
            onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.08)")}
            onMouseLeave={e => (e.currentTarget.style.boxShadow = "none")}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 24 }}>{app.logo}</div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332" }}>{app.name}</div>
                <div style={{ fontSize: 15, color: "#94a3b8" }}>{app.desc}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 15, padding: "2px 8px", borderRadius: 99, fontWeight: 600, background: app.connected ? "#DCFCE7" : "#F1F5F9", color: app.connected ? "#15803D" : "#94a3b8" }}>
                {app.connected ? "Connected" : "Not Connected"}
              </span>
              <span style={{ fontSize: 15, color: "#3B82F6", cursor: "pointer" }}>{app.connected ? "Manage →" : "Connect →"}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ background: "#EEF9F4", border: "1px solid #c3e6d4", borderRadius: 14, padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#0F6E56", marginBottom: 6 }}>🏦 Phase 3: Live Bank Integration via Plaid</div>
        <p style={{ margin: "0 0 10px", fontSize: 15, color: "#1e6b4e", lineHeight: 1.6 }}>Connect your real bank account through Plaid and Dashello will automatically calculate your Five-Account balances.</p>
        <button style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: "#0F6E56", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Connect Bank Account →</button>
      </div>
    </div>
  );
}

function AppDetailPage({ app, onBack }: { app: typeof APPS[0]; onBack: () => void }) {
  const { t: __ } = useTranslation();
  return (
    <div style={{ padding: "clamp(16px,4vw,32px)" }}>
      <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: "#3B82F6", fontSize: 15, marginBottom: 16, display: "flex", alignItems: "center", gap: 4 }}>← Back to All Apps</button>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ fontSize: 32 }}>{app.logo}</div>
        <div>
          <h1 style={{ margin: 0, fontSize: "clamp(18px,4vw,24px)", fontWeight: 700, color: "#1a2332" }}>{app.name}</h1>
          <div style={{ fontSize: 15, color: "#94a3b8" }}>{app.desc}</div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          {app.connected
            ? <button style={{ padding: "7px 18px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#E85D75" }}>{__('common.disconnect', 'Disconnect')}</button>
            : <button style={{ padding: "7px 18px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{__('common.connect', 'Connect')} {app.name}</button>}
        </div>
      </div>
      <SectionCard title="Workflows">
        {["Auto-create tasks from overdue invoices", "Notify team on lead stage change", "Weekly summary to Slack"].map((w, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: i < 2 ? "1px solid #f1f5f9" : "none" }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#4CAF7D", flexShrink: 0 }} />
            <span style={{ fontSize: 15, color: "#1a2332", flex: 1 }}>{w}</span>
            <Toggle on={i < 2} onChange={() => { }} />
          </div>
        ))}
      </SectionCard>
    </div>
  );
}

export { IntegrationsPage, AppDetailPage, APPS };
