import { useState, useRef, useEffect } from "react";
import { useTranslation, LANGUAGES } from "../i18n";
import { Transaction, Metric, MetricColor } from "../types";
import { ALL_PHOSPHOR_ICONS, DISPLAY_CATEGORIES, ICON_NONE, MS } from "../utils/constants";
import { resolveColor } from "../utils/helpers";
import * as PhosphorReact from "@phosphor-icons/react";

export function IconGlyph({ name, size = 20, color = "#3B82F6", weight = "regular" }: {
  name: string; size?: number; color?: string; weight?: "thin" | "light" | "regular" | "bold" | "fill" | "duotone";
}) {
  if (!name) return null;
  const IconComponent = (PhosphorReact as any)[name];
  if (!IconComponent) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block", flexShrink: 0 }}>
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" fill="none" />
      </svg>
    );
  }
  return <IconComponent size={size} color={color} weight={weight} style={{ display: "block", flexShrink: 0 }} />;
}

export function Av({ initials, size = 30 }: { initials?: string; size?: number }) {
  const colors = ["#4C9FE8", "#7B68EE", "#48C78E", "#F5A623", "#E85D75"];
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: initials ? colors[initials.charCodeAt(0) % 5] : "#e2e8f0",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.36, fontWeight: 600, color: "#fff"
    }}>
      {initials ?? ""}
    </div>
  );
}

export function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div onClick={() => !disabled && onChange(!on)} style={{
      width: 44, height: 24, borderRadius: 99, cursor: disabled ? "not-allowed" : "pointer",
      background: on ? "#4CAF7D" : "#e2e8f0", position: "relative",
      transition: "background 0.2s", flexShrink: 0, opacity: disabled ? 0.5 : 1
    }}>
      <div style={{
        position: "absolute", top: 3, left: on ? 22 : 3,
        width: 18, height: 18, borderRadius: "50%",
        background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.2)", transition: "left 0.2s"
      }} />
    </div>
  );
}

export function SectionCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#F8FAFC", borderRadius: 16, padding: 20, display: "flex", flexDirection: "column" }}>
      {title && <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2332", marginBottom: 16 }}>{title}</div>}
      {children}
    </div>
  );
}

export function IconPicker({ selected, onSelect }: { selected: string; onSelect: (icon: string) => void }) {
  const { t: __ } = useTranslation();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState(0);

  const displayIcons = search.trim()
    ? ALL_PHOSPHOR_ICONS.filter(i => i.toLowerCase().includes(search.toLowerCase()))
    : DISPLAY_CATEGORIES[activeCategory]?.icons ?? [];

  return (
    <div>
      <div onClick={() => onSelect(ICON_NONE)} style={{
        display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px",
        borderRadius: 6, cursor: "pointer", marginBottom: 8,
        background: selected === ICON_NONE ? "#EFF6FF" : "#F8FAFC",
        border: selected === ICON_NONE ? "1.5px solid #3B82F6" : "1.5px solid #e2e8f0",
        fontSize: 15, color: "#64748b"
      }}>{__('common.noIcon', 'No icon')}</div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search icons..."
        style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", marginBottom: 8, boxSizing: "border-box" }} />

      {!search && (
        <div style={{ display: "flex", gap: 4, overflowX: "auto", marginBottom: 8, paddingBottom: 2 }}>
          {DISPLAY_CATEGORIES.map((cat, i) => (
            <button key={i} onClick={() => setActiveCategory(i)} style={{
              padding: "3px 8px", borderRadius: 20, border: "none", cursor: "pointer", flexShrink: 0,
              background: activeCategory === i ? "#3B82F6" : "#f1f5f9",
              color: activeCategory === i ? "#fff" : "#64748b", fontSize: 15, fontWeight: 500
            }}>{cat.label}</button>
          ))}
        </div>
      )}

      <div style={{ height: 160, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 10, padding: 6 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 4 }}>
          {displayIcons.map(ic => (
            <div key={ic} onClick={() => onSelect(ic)} title={ic}
              style={{
                height: 36, borderRadius: 6, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", cursor: "pointer", gap: 2,
                background: selected === ic ? "#EFF6FF" : "#f8fafc",
                border: selected === ic ? "1.5px solid #3B82F6" : "1.5px solid #e2e8f0",
              }}>
              <IconGlyph name={ic} size={16} color={selected === ic ? "#3B82F6" : "#64748b"} />
            </div>
          ))}
        </div>
      </div>

      {selected && selected !== ICON_NONE && (
        <div style={{ marginTop: 6, fontSize: 15, color: "#64748b", display: "flex", alignItems: "center", gap: 6 }}>
          Selected: <IconGlyph name={selected} size={14} color="#3B82F6" />
          <span style={{ color: "#94a3b8" }}>{selected}</span>
        </div>
      )}
    </div>
  );
}

export function LanguageSelector() {
  const { language, setLanguage, t: __ } = useTranslation();
  const [query, setQuery] = useState("");
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const filtered = query
    ? LANGUAGES.filter(l => l.name.toLowerCase().includes(query.toLowerCase()) || l.nativeName.toLowerCase().includes(query.toLowerCase()) || l.code.toLowerCase() === query.toLowerCase()).slice(0, 20)
    : LANGUAGES.slice(0, 20);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setShow(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  return (
    <div style={{ marginBottom: 14, position: "relative" }} ref={ref}>
      <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 6 }}>{__('settings.language', 'Language')}</div>
      <input
        value={show ? query : `${language.name} (${language.nativeName})`}
        onChange={e => { setQuery(e.target.value); setShow(true); }}
        onFocus={() => { setShow(true); }}
        placeholder={__('settings.searchLanguage', 'Search for a language...')}
        style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" }}
      />
      {show && (
        <div style={{ position: "absolute", background: "#fff", borderRadius: 8, border: "1.5px solid #e2e8f0", marginTop: 4, maxHeight: 220, overflowY: "auto", zIndex: 5000, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", width: ref.current?.offsetWidth }}>
          {filtered.map(l => (
            <div key={l.code} onClick={() => { setLanguage(l); setQuery(""); setShow(false); }}
              style={{ padding: "8px 12px", fontSize: 15, cursor: "pointer", background: l.code === language.code ? "#EFF6FF" : "#fff", color: "#1a2332", borderBottom: "1px solid #f1f5f9" }}>
              {l.name} <span style={{ color: "#94a3b8" }}>({l.nativeName})</span>
            </div>
          ))}
          {filtered.length === 0 && <div style={{ padding: "8px 12px", fontSize: 15, color: "#94a3b8" }}>{__('settings.noLanguages', 'No languages found')}</div>}
        </div>
      )}
    </div>
  );
}

export function EditAddRowModal({ initial, onSave, onClose }: { initial?: string; onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(initial ?? "");
  const { t: __ } = useTranslation();
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

export function MetricBlock({ metric, onClick, onDragStart, onDragEnter, onDrop, isDragOver, disableDrag }: {
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

export function TxnTable({ transactions }: { transactions: Transaction[] }) {
  const { t: __ } = useTranslation();
  const fmt = (n?: number) => n != null ? n.toLocaleString("en-US", { minimumFractionDigits: 2 }) : "";
  const th: React.CSSProperties = { fontSize: 15, color: "#94a3b8", padding: "6px 8px", textAlign: "left", fontWeight: 500, borderBottom: "1px solid #f1f5f9" };
  const td: React.CSSProperties = { fontSize: 15, color: "#475569", padding: "6px 8px", borderBottom: "1px solid #f8fafc" };
  return (
    <div style={{ background: "#fff", borderRadius: "0 0 12px 12px", border: "1px solid #e2e8f0", borderTop: "none" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          <th style={{ ...th, width: "50%" }}>{__('common.transactions', 'Transactions')}</th>
          <th style={{ ...th, textAlign: "right" }}>{__('common.credit', 'Credit')}</th>
          <th style={{ ...th, textAlign: "right" }}>{__('common.debit', 'Debit')}</th>
          <th style={{ ...th, textAlign: "right" }}>{__('common.balance', 'Balance')}</th>
        </tr></thead>
        <tbody>
          {transactions.length === 0
            ? <tr><td colSpan={4} style={{ ...td, color: "#cbd5e1", textAlign: "center", padding: 16 }}>{__('common.noTransactions', 'No transactions yet')}</td></tr>
            : transactions.map((t, i) => <tr key={i}>
              <td style={td}>{t.date} – {t.description}</td>
              <td style={{ ...td, textAlign: "right" }}>{fmt(t.credit)}</td>
              <td style={{ ...td, textAlign: "right" }}>{fmt(t.debit)}</td>
              <td style={{ ...td, textAlign: "right", color: "#94a3b8" }}>—</td>
            </tr>)}
        </tbody>
      </table>
    </div>
  );
}
