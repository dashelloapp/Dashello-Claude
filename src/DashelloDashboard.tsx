import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "./lib/supabase";

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

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

type MetricColor = "green" | "yellow" | "red" | "gray";
type Page = "home" | "goals" | "tasks" | "integrations" | "team" | "settings" | "app-detail";
type GraphType = "bar-h" | "linear" | "pie" | "bar-v";
type MetricType = "counter" | "percentage" | "financial";
type RuleOp = ">=" | "<=" | ">" | "<" | "between";

interface ColorRule {
  id: string;
  color: "red" | "yellow" | "green";
  op: RuleOp;
  value: number;
  value2?: number;
}

// Historical data point for charts
interface DataPoint {
  timestamp: number; // unix ms
  value: number;
}

interface Transaction { date: string; description: string; credit?: number; debit?: number; }
interface StatRow { label: string; value: string; synced?: boolean; }
interface ProjRow { label: string; sub: string; value: string; }
interface NextAction { label?: string; avatar?: string; }

interface MetricModalData {
  type: "cashflow" | "leads" | "emails" | "invoices" | "website" | "generic";
  title: string; color: MetricColor; healthPct: number | null;
  mainValue: string; syncTime: string;
  stats: StatRow[]; transactions?: Transaction[];
  projections: ProjRow[]; suggestions: string[]; nextActions: NextAction[];
  fiveAccountEnabled?: boolean;
  accountType?: "overhead" | "profit" | "tax" | "investments" | "owner";
}

interface Metric {
  id: string; label: string; value: string; icon: string; color: MetricColor;
  modal: MetricModalData;
  graphType?: GraphType; metricType?: MetricType;
  colorRules?: ColorRule[];
  connectedApps?: string[];
  history?: DataPoint[]; // persisted chart data
}
interface Section { id: string; title: string; avatars: string[]; metrics: Metric[]; }

// ─── Traffic light: evaluate rules against current value ───────────────────
function resolveColor(metric: Metric): MetricColor {
  if (!metric.colorRules || metric.colorRules.length === 0) return "gray";
  const num = parseFloat(metric.value.replace(/[^0-9.\-]/g, ""));
  if (isNaN(num)) return "gray";
  for (const rule of metric.colorRules) {
    let match = false;
    if (rule.op === ">=" && num >= rule.value) match = true;
    if (rule.op === "<=" && num <= rule.value) match = true;
    if (rule.op === ">" && num > rule.value) match = true;
    if (rule.op === "<" && num < rule.value) match = true;
    if (rule.op === "between" && rule.value2 != null && num >= rule.value && num <= rule.value2) match = true;
    if (match) return rule.color;
  }
  return "gray";
}

// Get color for a specific numeric value against rules
function getColorForValue(val: number, rules: ColorRule[]): MetricColor {
  if (!rules || rules.length === 0) return "gray";
  for (const rule of rules) {
    let match = false;
    if (rule.op === ">=" && val >= rule.value) match = true;
    if (rule.op === "<=" && val <= rule.value) match = true;
    if (rule.op === ">" && val > rule.value) match = true;
    if (rule.op === "<" && val < rule.value) match = true;
    if (rule.op === "between" && rule.value2 != null && val >= rule.value && val <= rule.value2) match = true;
    if (match) return rule.color;
  }
  return "gray";
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS / STYLES
// ═══════════════════════════════════════════════════════════════════════════

const MS: Record<MetricColor, { bg: string; text: string; iconBg: string; darkText: string }> = {
  green:  { bg: "#4CAF7D", text: "#fff",     iconBg: "rgba(255,255,255,0.25)", darkText: "#fff" },
  yellow: { bg: "#F5A623", text: "#fff",     iconBg: "rgba(255,255,255,0.25)", darkText: "#fff" },
  red:    { bg: "#E85D75", text: "#fff",     iconBg: "rgba(255,255,255,0.25)", darkText: "#fff" },
  gray:   { bg: "#E8EDF2", text: "#4A5568",  iconBg: "rgba(100,116,139,0.12)", darkText: "#4A5568" },
};

const FIVE_DESC: Record<string, string> = {
  overhead:    "2 months of operating expenses. Everything above this flows to Profit.",
  profit:      "Builds to a 6-month emergency fund. Surplus splits 50/50 to Tax & Investments.",
  tax:         "50% of surplus Profit allocation. Set aside for taxes.",
  investments: "50% of surplus Profit allocation. Long-term growth fund.",
  owner:       "Your salary — paid from Overhead as a fixed operating expense.",
};

// ═══════════════════════════════════════════════════════════════════════════
// ELEGANT ICON FONT — load via CDN + icon list
// ═══════════════════════════════════════════════════════════════════════════

// We load the Elegant Icon font from the downloaded zip hosted via jsDelivr/unpkg fallback
// The font CSS is injected once at app load
const ELEGANT_FONT_CSS = `
@font-face {
  font-family: 'ElegantIcons';
  src: url('https://cdn.jsdelivr.net/npm/elegant-icons@0.0.1/fonts/ElegantIcons.eot');
  src: url('https://cdn.jsdelivr.net/npm/elegant-icons@0.0.1/fonts/ElegantIcons.eot?#iefix') format('embedded-opentype'),
       url('https://cdn.jsdelivr.net/npm/elegant-icons@0.0.1/fonts/ElegantIcons.woff') format('woff'),
       url('https://cdn.jsdelivr.net/npm/elegant-icons@0.0.1/fonts/ElegantIcons.ttf') format('truetype'),
       url('https://cdn.jsdelivr.net/npm/elegant-icons@0.0.1/fonts/ElegantIcons.svg#ElegantIcons') format('svg');
  font-weight: normal;
  font-style: normal;
}
[class^="icon_"],[class^="arrow_"],[class^="social_"],[class*=" icon_"],[class*=" arrow_"]{
  font-family:'ElegantIcons' !important;
  speak:none;
  font-style:normal !important;
  font-weight:normal !important;
  font-variant:normal;
  text-transform:none;
  line-height:1;
  -webkit-font-smoothing:antialiased;
  -moz-osx-font-smoothing:grayscale;
}
`;

// Categorized icon list — class names from Elegant Themes icon font
const ICON_NONE = "";
const ICON_CATEGORIES: { label: string; icons: string[] }[] = [
  {
    label: "Arrows & Navigation",
    icons: [
      "arrow_up","arrow_down","arrow_left","arrow_right",
      "arrow_carrot-up","arrow_carrot-down","arrow_carrot-left","arrow_carrot-right",
      "arrow_triangle-up","arrow_triangle-down","arrow_triangle-left","arrow_triangle-right",
      "arrow_back","arrow_expand","arrow_condense","arrow_move",
      "arrow_up-down","arrow_left-right","arrow_expand_alt2","arrow_condense_alt",
    ]
  },
  {
    label: "Finance & Business",
    icons: [
      "icon_creditcard","icon_wallet","icon_currency","icon_cart",
      "icon_bag","icon_briefcase","icon_shield","icon_percent",
      "icon_piechart","icon_datareport","icon_flowchart","icon_balance",
      "icon_target","icon_building","icon_calulator","icon_floppy",
      "icon_drive","icon_id","icon_id-2",
    ]
  },
  {
    label: "People & Communication",
    icons: [
      "icon_profile","icon_group","icon_mail","icon_phone",
      "icon_chat","icon_comment","icon_quotations","icon_headphones",
      "icon_mic","icon_vol-mute","icon_volume-low","icon_volume-high",
    ]
  },
  {
    label: "Tools & Settings",
    icons: [
      "icon_cog","icon_cogs","icon_tool","icon_tools",
      "icon_toolbox","icon_pencil","icon_pencil-edit","icon_drawer",
      "icon_folder","icon_folder-open","icon_folder-add","icon_archive",
      "icon_document","icon_documents","icon_book","icon_clipboard",
    ]
  },
  {
    label: "Status & Alerts",
    icons: [
      "icon_check","icon_close","icon_plus","icon_minus",
      "icon_check_alt2","icon_close_alt2","icon_plus_alt2","icon_minus_alt2",
      "icon_error-circle","icon_error-oct","icon_error-triangle","icon_info",
      "icon_question","icon_blocked","icon_lock","icon_lock-open",
    ]
  },
  {
    label: "Media & Time",
    icons: [
      "icon_clock","icon_calendar","icon_hourglass","icon_refresh",
      "icon_loading","icon_search","icon_zoom-in","icon_zoom-out",
      "icon_camera","icon_film","icon_music","icon_upload","icon_download",
    ]
  },
  {
    label: "Misc & Nature",
    icons: [
      "icon_globe","icon_globe-2","icon_map","icon_pin","icon_compass",
      "icon_star","icon_star_alt","icon_heart","icon_like","icon_dislike",
      "icon_gift","icon_ribbon","icon_tag","icon_tags","icon_trash","icon_key",
      "icon_lightbulb","icon_cloud","icon_cloud-upload","icon_cloud-download",
      "icon_house","icon_puzzle","icon_mug","icon_pens","icon_easel",
    ]
  },
];

const ALL_ICONS_FLAT = ICON_CATEGORIES.flatMap(c => c.icons);

// Render an Elegant Icon
function ElegantIcon({ name, size = 20, color }: { name: string; size?: number; color?: string }) {
  if (!name) return null;
  return (
    <span
      className={name}
      style={{
        fontFamily: "'ElegantIcons', sans-serif",
        fontSize: size,
        color: color ?? "inherit",
        lineHeight: 1,
        display: "inline-block",
        fontStyle: "normal",
        fontWeight: "normal",
        fontVariant: "normal",
        textTransform: "none",
        WebkitFontSmoothing: "antialiased",
      } as React.CSSProperties}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CHART COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function MetricChart({
  history, rules, graphType, metricType, currentValue
}: {
  history: DataPoint[];
  rules: ColorRule[];
  graphType: GraphType;
  metricType: MetricType;
  currentValue: string;
}) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; val: number; color: MetricColor } | null>(null);

  // Build display points — use history if available, else generate demo
  const points: DataPoint[] = history && history.length > 1 ? history : (() => {
    const base = parseFloat(currentValue.replace(/[^0-9.\-]/g, "")) || 50;
    return Array.from({ length: 8 }, (_, i) => ({
      timestamp: Date.now() - (7 - i) * 86400000,
      value: Math.max(0, base * (0.7 + Math.random() * 0.6))
    }));
  })();

  // Determine axis range from rules if available
  const allRuleVals = rules.flatMap(r => r.op === "between" && r.value2 != null ? [r.value, r.value2] : [r.value]);
  const vals = points.map(p => p.value);
  const dataMin = Math.min(...vals);
  const dataMax = Math.max(...vals);
  const ruleMin = allRuleVals.length > 0 ? Math.min(...allRuleVals) : dataMin;
  const ruleMax = allRuleVals.length > 0 ? Math.max(...allRuleVals) : dataMax;
  const yMin = Math.min(dataMin, ruleMin) * 0.9;
  const yMax = Math.max(dataMax, ruleMax) * 1.1 || 100;

  const W = 320, H = 160, padL = 40, padR = 10, padT = 10, padB = 30;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const xScale = (i: number) => padL + (i / (points.length - 1)) * chartW;
  const yScale = (v: number) => padT + chartH - ((v - yMin) / (yMax - yMin || 1)) * chartH;

  const colorOf = (v: number) => MS[getColorForValue(v, rules)].bg;

  // Build zone fills for line chart background
  const buildZonePath = (minV: number, maxV: number) => {
    const y1 = yScale(maxV);
    const y2 = yScale(minV);
    return `M ${padL} ${y1} L ${W - padR} ${y1} L ${W - padR} ${y2} L ${padL} ${y2} Z`;
  };

  // Sort rules to determine color zones
  const sortedRules = [...rules].sort((a, b) => a.value - b.value);

  if (graphType === "pie") {
    // For pie: show percentage breakdown of how many data points fall in each color zone
    const counts: Record<MetricColor, number> = { red: 0, yellow: 0, green: 0, gray: 0 };
    points.forEach(p => counts[getColorForValue(p.value, rules)]++);
    const total = points.length;
    const slices = (["green", "yellow", "red", "gray"] as MetricColor[])
      .map(c => ({ color: c, count: counts[c], pct: counts[c] / total }))
      .filter(s => s.count > 0);

    const cx = 80, cy = 75, r = 60;
    let startAngle = -Math.PI / 2;
    const paths: React.ReactElement[] = [];
    slices.forEach((s, i) => {
      const angle = s.pct * 2 * Math.PI;
      const endAngle = startAngle + angle;
      const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle), y2 = cy + r * Math.sin(endAngle);
      const large = angle > Math.PI ? 1 : 0;
      paths.push(
        <path key={i}
          d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`}
          fill={MS[s.color].bg} stroke="#fff" strokeWidth={2} />
      );
      startAngle = endAngle;
    });

    return (
      <svg viewBox="0 0 200 150" style={{ width: "100%", height: 160 }}>
        {paths}
        {/* Legend */}
        {slices.map((s, i) => (
          <g key={i}>
            <rect x={150} y={20 + i * 22} width={12} height={12} rx={3} fill={MS[s.color].bg} />
            <text x={167} y={31 + i * 22} fontSize={10} fill="#64748b">{s.color} {Math.round(s.pct * 100)}%</text>
          </g>
        ))}
      </svg>
    );
  }

  if (graphType === "bar-v" || graphType === "bar-h") {
    const isH = graphType === "bar-h";
    const barW = isH ? 0 : Math.max(4, chartW / points.length - 4);
    const barH = isH ? Math.max(8, chartH / points.length - 4) : 0;

    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 160 }}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(t => {
          const y = padT + chartH * (1 - t);
          return <line key={t} x1={padL} x2={W - padR} y1={y} y2={y} stroke="#f1f5f9" strokeWidth={1} />;
        })}
        {points.map((p, i) => {
          const col = colorOf(p.value);
          if (!isH) {
            const x = padL + (i / points.length) * chartW + 2;
            const barTop = yScale(p.value);
            const barHeight = yScale(yMin) - barTop;
            return (
              <g key={i}>
                <rect x={x} y={barTop} width={barW} height={barHeight} fill={col} rx={3}
                  onMouseEnter={e => setTooltip({ x: x + barW / 2, y: barTop - 6, val: p.value, color: getColorForValue(p.value, rules) })}
                  onMouseLeave={() => setTooltip(null)} style={{ cursor: "pointer" }} />
              </g>
            );
          } else {
            const y = padT + (i / points.length) * chartH + 2;
            const barWidth = ((p.value - yMin) / (yMax - yMin || 1)) * chartW;
            return (
              <g key={i}>
                <rect x={padL} y={y} width={barWidth} height={barH} fill={col} rx={3}
                  onMouseEnter={() => setTooltip({ x: padL + barWidth + 4, y: y + barH / 2, val: p.value, color: getColorForValue(p.value, rules) })}
                  onMouseLeave={() => setTooltip(null)} style={{ cursor: "pointer" }} />
              </g>
            );
          }
        })}
        {tooltip && (
          <g>
            <rect x={tooltip.x - 22} y={tooltip.y - 18} width={44} height={18} rx={4} fill={MS[tooltip.color].bg} />
            <text x={tooltip.x} y={tooltip.y - 5} textAnchor="middle" fontSize={10} fill="#fff" fontWeight="600">
              {tooltip.val.toFixed(1)}
            </text>
          </g>
        )}
      </svg>
    );
  }

  // Linear chart (default)
  const pathD = points.map((p, i) => {
    const x = xScale(i), y = yScale(p.value);
    if (i === 0) return `M ${x} ${y}`;
    const px = xScale(i - 1), py = yScale(points[i - 1].value);
    const cx = (px + x) / 2;
    return ` C ${cx} ${py} ${cx} ${y} ${x} ${y}`;
  }).join("");

  // Area path to baseline
  const areaD = pathD + ` L ${xScale(points.length - 1)} ${yScale(yMin)} L ${xScale(0)} ${yScale(yMin)} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 160, overflow: "visible" }}>
      <defs>
        {/* Zone fills */}
        {sortedRules.map((r, i) => {
          const zoneMin = i === 0 ? yMin : sortedRules[i - 1].value;
          const zoneMax = r.op === "between" && r.value2 != null ? r.value2 : r.value;
          return (
            <clipPath key={r.id} id={`zone-${r.id}`}>
              <path d={buildZonePath(Math.max(yMin, zoneMin), Math.min(yMax, zoneMax))} />
            </clipPath>
          );
        })}
      </defs>

      {/* Background zone shading */}
      {rules.length > 0 && sortedRules.map((r, i) => {
        const zMin = i === 0 ? yMin : sortedRules[i - 1].value;
        const zMax = r.op === "between" && r.value2 != null ? r.value2 : r.value;
        const top = yScale(Math.min(yMax, zMax));
        const bottom = yScale(Math.max(yMin, zMin));
        if (bottom <= top) return null;
        return (
          <rect key={r.id}
            x={padL} y={top} width={chartW} height={bottom - top}
            fill={MS[r.color].bg} opacity={0.12} rx={0} />
        );
      })}

      {/* Y-axis labels */}
      {[0, 0.5, 1].map(t => {
        const v = yMin + t * (yMax - yMin);
        return (
          <text key={t} x={padL - 4} y={yScale(v) + 4} textAnchor="end" fontSize={9} fill="#94a3b8">
            {v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}
          </text>
        );
      })}

      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map(t => {
        const y = padT + chartH * (1 - t);
        return <line key={t} x1={padL} x2={W - padR} y1={y} y2={y} stroke="#f1f5f9" strokeWidth={1} />;
      })}

      {/* Area fill */}
      <path d={areaD} fill="url(#areaGrad)" opacity={0.15} />
      <defs>
        <linearGradient id="areaGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.6} />
          <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* Line */}
      <path d={pathD} fill="none" stroke="#3B82F6" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

      {/* Rule threshold lines */}
      {rules.map(r => (
        <line key={r.id}
          x1={padL} x2={W - padR}
          y1={yScale(r.value)} y2={yScale(r.value)}
          stroke={MS[r.color].bg} strokeWidth={1.5} strokeDasharray="4 3" opacity={0.7} />
      ))}

      {/* Data points */}
      {points.map((p, i) => {
        const x = xScale(i), y = yScale(p.value);
        const col = colorOf(p.value);
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={5} fill={col} stroke="#fff" strokeWidth={2}
              onMouseEnter={() => setTooltip({ x, y: y - 10, val: p.value, color: getColorForValue(p.value, rules) })}
              onMouseLeave={() => setTooltip(null)}
              style={{ cursor: "pointer" }} />
          </g>
        );
      })}

      {/* Tooltip */}
      {tooltip && (
        <g>
          <rect x={tooltip.x - 24} y={tooltip.y - 20} width={48} height={18} rx={5} fill={MS[tooltip.color].bg} />
          <text x={tooltip.x} y={tooltip.y - 7} textAnchor="middle" fontSize={10} fill="#fff" fontWeight="700">
            {tooltip.val.toFixed(1)}
          </text>
        </g>
      )}

      {/* X-axis date labels */}
      {points.map((p, i) => {
        if (i % Math.ceil(points.length / 4) !== 0 && i !== points.length - 1) return null;
        const d = new Date(p.timestamp);
        return (
          <text key={i} x={xScale(i)} y={H - 4} textAnchor="middle" fontSize={8} fill="#94a3b8">
            {`${d.getMonth() + 1}/${d.getDate()}`}
          </text>
        );
      })}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL DATA
// ═══════════════════════════════════════════════════════════════════════════

function makeModal(label: string, value: string, color: MetricColor, extra?: Partial<MetricModalData>): MetricModalData {
  return {
    type: "generic", title: label, color, healthPct: null, mainValue: value, syncTime: "10:23AM",
    stats: [{ label: "Balance", value }],
    projections: [{ label: "Projected Value", sub: "Based on past data | Synced from 10:23AM", value }],
    suggestions: [], nextActions: [{ avatar: "AJ" }, { avatar: "BK" }], ...extra
  };
}

const CASHFLOW_MODALS: Record<string, MetricModalData> = {
  overhead: makeModal("Overhead", "$79,941.08", "green", {
    type: "cashflow", healthPct: 100,
    stats: [{ label: "Balance", value: "$79,941.08", synced: true }, { label: "Income", value: "$52,786.45", synced: true }, { label: "Expenses", value: "$25,345.37", synced: true }],
    transactions: [
      { date: "March 13", description: "Web hosting", credit: 197.35 },
      { date: "March 6", description: "Accounting Services", credit: 765.45 },
      { date: "February 10", description: "New Invoice Payment", debit: 25987.34 },
      { date: "January 30", description: "Electric Bill", credit: 5034.03 },
      { date: "January 1", description: "Inventory Payment", credit: 10385.68 },
    ],
    projections: [
      { label: "Projected Income", sub: "Based on goals and past income | Synced from 10:23AM", value: "$47,213.55" },
      { label: "Projected Expenses To Meet", sub: "Based on goals and past expenses | Synced from 10:23AM", value: "$24,654.63" },
      { label: "Need To Still Make This Month:", sub: "Based on goals, income, and past expenses | Synced from 10:23AM", value: "$35,058.92" },
    ],
    suggestions: ["Add $9,756 to Tax account", "Add $9,756 to Profit account"],
    nextActions: [{ avatar: "AJ" }, { avatar: "BK" }, { avatar: "CL" }, {}],
    fiveAccountEnabled: true, accountType: "overhead"
  }),
  profit: makeModal("Profit", "$235,000.00", "yellow", {
    type: "cashflow", healthPct: 35,
    stats: [{ label: "Balance", value: "$235,000.00", synced: true }, { label: "Goal", value: "$600,000", synced: true }],
    transactions: [
      { date: "January 15", description: "Transfer Received from Overhead", debit: 4950.00 },
      { date: "October 15", description: "Transfer Received from Overhead", debit: 16250.00 },
      { date: "September 27", description: "Transfer Received from Overhead", credit: 2550.00 },
    ],
    projections: [{ label: "Projected Complete Date", sub: "Based on goals and past income | Synced from 10:23AM", value: "March 17/25" }],
    suggestions: ["Add $3,500 from Overhead"],
    nextActions: [{ avatar: "AJ" }, { avatar: "BK" }, { avatar: "CL" }, {}],
    fiveAccountEnabled: true, accountType: "profit"
  }),
  tax: makeModal("Tax", "$23,750.00", "gray", {
    type: "cashflow", healthPct: null, title: "Taxes",
    stats: [{ label: "Balance", value: "$23,750.00", synced: true }],
    transactions: [
      { date: "January 30", description: "Tax Bill", credit: 5000.00 },
      { date: "January 15", description: "Transfer Received from Overhead", debit: 4950.00 },
      { date: "October 30", description: "Tax Bill", credit: 5000.00 },
      { date: "October 15", description: "Transfer from Overhead", credit: 47.69, debit: 16250.00 },
    ],
    projections: [
      { label: "Next Tax Payment Estimated", sub: "Based on goals and past income | Synced from 10:23AM", value: "$0" },
      { label: "Amount Still Needed For Next Payment", sub: "Based on goals and past expenses | Synced from 10:23AM", value: "$5,000" },
      { label: "Next Tax Payment Date", sub: "Based on goals, income, and past expenses | Synced from 10:23AM", value: "April 30th" },
    ],
    suggestions: [], nextActions: [{ avatar: "AJ" }, { avatar: "BK" }, { avatar: "CL" }, {}],
    fiveAccountEnabled: true, accountType: "tax"
  }),
  investments: makeModal("Investments", "$0.00", "gray", {
    type: "cashflow", healthPct: null, title: "Invest",
    stats: [{ label: "Balance", value: "$0.00", synced: true }, { label: "Goals", value: "Fully Fund Profit First", synced: true }, { label: "Funding Start Date", value: "March 17, 2025", synced: true }],
    transactions: [],
    projections: [
      { label: "Amount Still Needed For Next Payment", sub: "Based on goals and past income | Synced from 10:23AM", value: "$0" },
      { label: "Next Tax Payment Estimated", sub: "Based on goals and past expenses | Synced from 10:23AM", value: "$0" },
      { label: "Next Tax Payment Date", sub: "Based on goals, income, and past expenses | Synced from 10:23AM", value: "..." },
    ],
    suggestions: [], nextActions: [{ avatar: "AJ" }, { avatar: "BK" }, { avatar: "CL" }, {}],
    fiveAccountEnabled: true, accountType: "investments"
  }),
  owner: makeModal("Owner", "$7,500", "green", {
    type: "cashflow", healthPct: 100,
    stats: [{ label: "Balance", value: "$7,500", synced: true }],
    transactions: [], projections: [], suggestions: [], nextActions: [],
    fiveAccountEnabled: true, accountType: "owner"
  }),
};

const SALES_MODALS: Record<string, MetricModalData> = {
  leads: makeModal("Leads", "12", "red", {
    type: "leads", healthPct: 25,
    stats: [{ label: "Amount", value: "12" }, { label: "Leads Moved", value: "5" }, { label: "Conversions", value: "24%" }, { label: "Leads Closed", value: "13" }, { label: "Leads Opened", value: "7" }, { label: "Goal", value: "50 / Month" }],
    projections: [
      { label: "Projected Sales ✦", sub: "Based on goals and past income | Synced from 10:23AM", value: "$45K" },
      { label: "Projected New Leads ✦", sub: "Based on goals and past expenses | Synced from 10:23AM", value: "569" },
    ],
    suggestions: [],
    nextActions: [{ label: "Close 5 more calls", avatar: "AJ" }, { label: "Send 34 quotes", avatar: "BK" }, { avatar: "CL" }, { avatar: "DM" }]
  }),
  emails: makeModal("Emails Opened", "789", "green", {
    type: "emails", healthPct: 100,
    stats: [{ label: "Bounce Rate", value: "3%", synced: true }, { label: "Open Rate", value: "26%", synced: true }, { label: "Click-through Rate", value: "4.5%", synced: true }, { label: "Total Emails Sent", value: "3,034", synced: true }],
    projections: [
      { label: "Open Rate", sub: "Based on goals and past income | Synced from 10:23AM", value: "26%" },
      { label: "Click-through Rate", sub: "Based on goals and past expenses | Synced from 10:23AM", value: "Increase" },
      { label: "Bounce Rate", sub: "Based on goals, income, and past expenses | Synced from 10:23AM", value: "3%" },
    ],
    suggestions: [], nextActions: [{ avatar: "AJ" }, { avatar: "BK" }, { avatar: "CL" }, {}]
  }),
  invoices: makeModal("Invoices In Progress", "$10,050.76", "gray", {
    type: "invoices", healthPct: null,
    stats: [{ label: "Total Invoices", value: "37", synced: true }, { label: "Conversion Rate", value: "78%", synced: true }, { label: "Average Order Value", value: "$270", synced: true }],
    projections: [
      { label: "Projected Funds", sub: "Based on goals and past income | Synced from 10:23AM", value: "$34,000" },
      { label: "Invoices Need Sending", sub: "Based on goals and past expenses | Synced from 10:23AM", value: "45" },
    ],
    suggestions: ["Send 13 invoices"], nextActions: [{ avatar: "AJ" }, { avatar: "BK" }, { avatar: "CL" }, {}]
  }),
  website: makeModal("Website Engagement", "67%", "green", {
    type: "website", healthPct: 80,
    stats: [{ label: "Site Sessions", value: "7,987", synced: true }, { label: "Ave Session Duration", value: "23 seconds", synced: true }, { label: "Unique Visitors", value: "57.6K", synced: true }, { label: "Clicks to Contact", value: "356", synced: true }, { label: "Bounce Rate", value: "37%", synced: true }],
    projections: [
      { label: "Clicks Next Month", sub: "Based on goals and past income | Synced from 10:23AM", value: "356" },
      { label: "Conversion Rate Next Month", sub: "Based on goals and past expenses | Synced from 10:23AM", value: "Increase" },
      { label: "Projected Visitors Next Month", sub: "Based on goals, income, and past expenses | Synced from 10:23AM", value: "57.6K" },
    ],
    suggestions: [], nextActions: [{ avatar: "AJ" }, { avatar: "BK" }, { avatar: "CL" }, {}]
  }),
};

const INIT_SECTIONS: Section[] = [];

// ═══════════════════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function Av({ initials, size = 30 }: { initials?: string; size?: number }) {
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

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div onClick={() => onChange(!on)} style={{
      width: 44, height: 24, borderRadius: 99, cursor: "pointer",
      background: on ? "#4CAF7D" : "#e2e8f0", position: "relative",
      transition: "background 0.2s", flexShrink: 0
    }}>
      <div style={{
        position: "absolute", top: 3, left: on ? 22 : 3,
        width: 18, height: 18, borderRadius: "50%",
        background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.2)", transition: "left 0.2s"
      }} />
    </div>
  );
}

function SectionCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#F8FAFC", borderRadius: 16, padding: 20, display: "flex", flexDirection: "column" }}>
      {title && <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2332", marginBottom: 16 }}>{title}</div>}
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSACTION TABLE
// ═══════════════════════════════════════════════════════════════════════════

function TxnTable({ transactions }: { transactions: Transaction[] }) {
  const fmt = (n?: number) => n != null ? n.toLocaleString("en-US", { minimumFractionDigits: 2 }) : "";
  const th: React.CSSProperties = { fontSize: 12, color: "#94a3b8", padding: "6px 8px", textAlign: "left", fontWeight: 500, borderBottom: "1px solid #f1f5f9" };
  const td: React.CSSProperties = { fontSize: 12, color: "#475569", padding: "6px 8px", borderBottom: "1px solid #f8fafc" };
  return (
    <div style={{ background: "#fff", borderRadius: "0 0 12px 12px", border: "1px solid #e2e8f0", borderTop: "none" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          <th style={{ ...th, width: "50%" }}>Transactions</th>
          <th style={{ ...th, textAlign: "right" }}>Credit</th>
          <th style={{ ...th, textAlign: "right" }}>Debit</th>
          <th style={{ ...th, textAlign: "right" }}>Balance</th>
        </tr></thead>
        <tbody>
          {transactions.length === 0
            ? <tr><td colSpan={4} style={{ ...td, color: "#cbd5e1", textAlign: "center", padding: 16 }}>No transactions yet</td></tr>
            : transactions.map((t, i) => <tr key={i}>
              <td style={td}>{t.date} – {t.description}</td>
              <td style={{ ...td, textAlign: "right" }}>{fmt(t.credit)}</td>
              <td style={{ ...td, textAlign: "right" }}>{fmt(t.debit)}</td>
              <td style={{ ...td, textAlign: "right", color: "#94a3b8" }}>$xxx,xxx.xx</td>
            </tr>)}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// BOTTOM THREE CARDS — shared across all popup types
// ═══════════════════════════════════════════════════════════════════════════

function BottomThreeCards({ data }: { data: MetricModalData }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16 }}>
      {/* Projections */}
      <SectionCard>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2332", marginBottom: 12 }}>Projections</div>
        <div style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic", marginBottom: 12 }}>Coming Soon</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, opacity: 0.35 }}>
          {[1, 2, 3].map(i => (
            <div key={i}>
              <div style={{ height: 8, borderRadius: 99, background: "#e2e8f0", marginBottom: 4, width: "70%" }} />
              <div style={{ height: 6, borderRadius: 99, background: "#e2e8f0", width: "50%" }} />
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Suggestions */}
      <SectionCard>
        <div style={{ display: "inline-block", background: "#3B82F6", color: "#fff", borderRadius: 99, padding: "6px 18px", fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Suggestions</div>
        <div style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic", marginBottom: 12 }}>Coming Soon</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, opacity: 0.35 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 22, height: 22, borderRadius: "50%", border: "1.5px solid #d1d5db", flexShrink: 0 }} />
              <div style={{ height: 7, borderRadius: 99, background: "#e2e8f0", flex: 1 }} />
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Next Actions */}
      <SectionCard>
        <div style={{ display: "inline-block", background: "#3B82F6", color: "#fff", borderRadius: 99, padding: "6px 18px", fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Next Actions</div>
        {data.nextActions.map((a, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div style={{ width: 20, height: 20, borderRadius: "50%", border: "1.5px solid #4CAF7D", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#4CAF7D" }}>✓</div>
            {a.label ? <span style={{ fontSize: 13, color: "#1a2332", flex: 1 }}>{a.label}</span> : <div style={{ flex: 1, height: 7, borderRadius: 99, background: "#e2e8f0" }} />}
            <Av initials={a.avatar} />
          </div>
        ))}
        {data.nextActions.length === 0 && <div style={{ fontSize: 13, color: "#cbd5e1" }}>No actions yet</div>}
      </SectionCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// METRIC DETAIL MODAL
// ═══════════════════════════════════════════════════════════════════════════

function MetricModal({
  data, metric, onClose, onEdit, onValueChange
}: {
  data: MetricModalData;
  metric?: Metric;
  onClose: () => void;
  onEdit?: () => void;
  onValueChange?: (newValue: string) => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [localValue, setLocalValue] = useState(data.mainValue);
  const [isEditingValue, setIsEditingValue] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const activeColor: MetricColor = metric ? resolveColor(metric) : data.color;
  const accent = MS[activeColor].bg;
  const isCash = data.fiveAccountEnabled && !!data.accountType;
  const isCounter = !isCash && metric?.metricType === "counter";
  const metricType = metric?.metricType ?? "financial";
  const graphType = metric?.graphType ?? "linear";
  const colorRules = metric?.colorRules ?? [];
  const history = metric?.history ?? [];

  // Parse numeric value for +/- buttons
  const parseVal = (v: string) => parseFloat(v.replace(/[^0-9.\-]/g, "")) || 0;
  const formatVal = (n: number, mt: MetricType, original: string): string => {
    const hasPrefix = original.match(/^[$€£¥]/)?.[0] ?? "";
    const hasSuffix = original.match(/[%]$/)?.[0] ?? "";
    if (mt === "financial") return `${hasPrefix}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (mt === "percentage") return `${n.toFixed(1)}${hasSuffix || "%"}`;
    return `${n % 1 === 0 ? Math.round(n) : n.toFixed(1)}`;
  };

  const handleIncrement = (dir: 1 | -1) => {
    const n = parseVal(localValue);
    const step = metricType === "financial" ? 100 : metricType === "percentage" ? 1 : 1;
    const next = n + dir * step;
    const formatted = formatVal(next, metricType, localValue);
    setLocalValue(formatted);
    onValueChange?.(formatted);
  };

  const handleValueSave = () => {
    onValueChange?.(localValue);
    setIsEditingValue(false);
  };

  const healthColor = activeColor !== "gray" ? accent : "#e5e7eb";
  const healthPct = data.healthPct ?? 0;

  const CloseBtn = () => (
    <button onClick={onClose} style={{
      width: 34, height: 34, borderRadius: "50%", border: "1.5px solid #e2e8f0",
      background: "#f8fafc", fontSize: 20, cursor: "pointer", color: "#475569",
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0, lineHeight: 1, padding: 0
    }}>×</button>
  );

  const EditSettingsBtn = () => (
    <button onClick={onEdit} style={{
      background: "#9CA3AF", color: "#fff", border: "none", borderRadius: 8,
      padding: "10px 24px", fontSize: 14, fontWeight: 600, cursor: "pointer"
    }}>Edit Settings</button>
  );

  // ── CASHFLOW / FIVE-ACCOUNT LAYOUT ─────────────────────────────────────
  if (isCash) {
    return (
      <div ref={overlayRef} onClick={e => { if (e.target === overlayRef.current) onClose(); }} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex",
        alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 20
      }}>
        <div style={{
          background: "#fff", borderRadius: 24, width: "100%", maxWidth: 900,
          maxHeight: "92vh", overflowY: "auto", padding: "36px 36px 32px",
          position: "relative", boxShadow: "0 32px 80px rgba(0,0,0,0.2)"
        }}>
          <style>{`@keyframes mIn{from{opacity:0;transform:scale(0.97)}to{opacity:1;transform:scale(1)}}`}</style>

          {/* Header row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 30, fontWeight: 700, color: "#1a2332" }}>{data.title}</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <EditSettingsBtn />
              <CloseBtn />
            </div>
          </div>

          {data.accountType && (
            <div style={{ background: "linear-gradient(135deg,#EEF9F4,#E8F4FD)", border: "1px solid #c3e6d4", borderRadius: 12, padding: "12px 16px", marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#0F6E56", marginBottom: 4 }}>Five-Account System — {data.accountType}</div>
              <p style={{ margin: 0, fontSize: 12, color: "#1e6b4e" }}>{FIVE_DESC[data.accountType]}</p>
            </div>
          )}

          {/* Health bar */}
          <div style={{ marginBottom: 20 }}>
            {data.healthPct != null ? (
              <>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#1a2332", marginBottom: 7 }}>Health — <strong>{data.healthPct}%</strong></div>
                <div style={{ height: 32, borderRadius: 99, background: "#e5e7eb", maxWidth: 260, overflow: "hidden" }}>
                  <div style={{ width: `${data.healthPct}%`, height: "100%", borderRadius: 99, background: accent }} />
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#1a2332", marginBottom: 8 }}>Health — <strong>N/A</strong></div>
                <button style={{ padding: "8px 22px", borderRadius: 99, border: "1.5px solid #d1d5db", background: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>Set A Goal</button>
              </>
            )}
          </div>

          <div style={{ marginBottom: 24 }}>
            <div style={{ background: accent, borderRadius: "12px 12px 0 0", padding: "20px 22px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  {data.stats.map((s, i) => (
                    <div key={i} style={{ marginBottom: i < data.stats.length - 1 ? 12 : 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 13, color: "rgba(255,255,255,0.82)" }}>{s.label}</span>
                        {s.synced && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>Synced from {data.syncTime}</span>}
                      </div>
                      <div style={{ fontSize: i === 0 ? 22 : 18, fontWeight: 700, color: "#fff" }}>{s.value}</div>
                    </div>
                  ))}
                </div>
                <button style={{ background: "#fff", border: "none", borderRadius: 20, padding: "6px 18px", fontSize: 13, cursor: "pointer", fontWeight: 600, flexShrink: 0, marginLeft: 16 }}>Filter</button>
              </div>
            </div>
            <TxnTable transactions={data.transactions ?? []} />
          </div>
          <BottomThreeCards data={data} />
        </div>
      </div>
    );
  }

  // ── COUNTER LAYOUT ──────────────────────────────────────────────────────
  if (isCounter) {
    return (
      <div ref={overlayRef} onClick={e => { if (e.target === overlayRef.current) onClose(); }} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex",
        alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 20
      }}>
        <div style={{
          background: "#fff", borderRadius: 24, width: "100%", maxWidth: 780,
          maxHeight: "92vh", overflowY: "auto", padding: "36px 36px 32px",
          position: "relative", boxShadow: "0 32px 80px rgba(0,0,0,0.2)"
        }}>
          <button onClick={onClose} style={{ display: "none" }} />

          {/* Header: title centered, Edit Settings + close top right */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28, flexWrap: "wrap", gap: 10 }}>
            <div style={{ flex: 1 }} />
            <h2 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#1a2332" }}>{data.title}</h2>
            <div style={{ flex: 1, display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center" }}>
              <EditSettingsBtn />
              <CloseBtn />
            </div>
          </div>

          {/* Icon circle */}
          {metric?.icon && metric.icon !== ICON_NONE && (
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{
                width: 72, height: 72, borderRadius: "50%",
                border: "2px solid #1a2332", display: "inline-flex",
                alignItems: "center", justifyContent: "center"
              }}>
                <ElegantIcon name={metric.icon} size={30} color="#1a2332" />
              </div>
            </div>
          )}

          {/* Health bar */}
          <div style={{ maxWidth: 380, margin: "0 auto 8px" }}>
            <div style={{ height: 36, borderRadius: 99, background: "#e5e7eb", overflow: "hidden" }}>
              <div style={{ width: `${healthPct}%`, height: "100%", borderRadius: 99, background: healthColor, transition: "width 0.4s" }} />
            </div>
          </div>
          <p style={{ textAlign: "center", fontSize: 14, marginBottom: 28, color: "#1a2332" }}>
            Health Goal — <strong>{data.healthPct ?? "N/A"}{data.healthPct != null ? "%" : ""}</strong>
          </p>

          {/* Value with +/- */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 32, marginBottom: 8 }}>
            <button onClick={() => handleIncrement(-1)} style={{ width: 42, height: 42, borderRadius: "50%", border: "1.5px solid #d1d5db", background: "none", fontSize: 22, cursor: "pointer", color: "#6b7280" }}>−</button>
            {isEditingValue ? (
              <input
                value={localValue}
                onChange={e => setLocalValue(e.target.value)}
                onBlur={handleValueSave}
                onKeyDown={e => { if (e.key === "Enter") handleValueSave(); if (e.key === "Escape") setIsEditingValue(false); }}
                autoFocus
                style={{ fontSize: 72, fontWeight: 700, color: "#1a2332", lineHeight: 1, border: "none", borderBottom: "2px solid #3B82F6", outline: "none", width: 220, textAlign: "center", background: "transparent" }}
              />
            ) : (
              <span
                onClick={() => setIsEditingValue(true)}
                style={{ fontSize: 72, fontWeight: 700, color: "#1a2332", lineHeight: 1, cursor: "text", borderBottom: "2px solid transparent", transition: "border-color 0.15s" }}
                title="Click to edit"
              >{localValue}</span>
            )}
            <button onClick={() => handleIncrement(1)} style={{ width: 42, height: 42, borderRadius: "50%", border: "1.5px solid #d1d5db", background: "none", fontSize: 22, cursor: "pointer", color: "#6b7280" }}>+</button>
          </div>
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <div style={{ height: 2, background: "#1a2332", width: 240, margin: "0 auto 6px" }} />
            <span style={{ fontSize: 13, fontStyle: "italic", color: "#6b7280" }}>Synced from {data.syncTime}</span>
          </div>

          {/* Details + Chart */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
            <SectionCard>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14 }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: "#1a2332" }}>Details</span>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>Synced from {data.syncTime}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 14px" }}>
                {data.stats.map((s, i) => (
                  <div key={i}>
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>{s.label}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332" }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </SectionCard>
            <SectionCard>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332", marginBottom: 8 }}>History Chart</div>
              <MetricChart history={history} rules={colorRules} graphType={graphType} metricType={metricType} currentValue={localValue} />
            </SectionCard>
          </div>

          <BottomThreeCards data={data} />
        </div>
      </div>
    );
  }

  // ── FINANCIAL / PERCENTAGE / GENERIC LAYOUT ─────────────────────────────
  return (
    <div ref={overlayRef} onClick={e => { if (e.target === overlayRef.current) onClose(); }} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex",
      alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 20
    }}>
      <div style={{
        background: "#fff", borderRadius: 24, width: "100%", maxWidth: 900,
        maxHeight: "92vh", overflowY: "auto", padding: "36px 36px 32px",
        position: "relative", boxShadow: "0 32px 80px rgba(0,0,0,0.2)"
      }}>
        <button onClick={onClose} style={{ display: "none" }} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 30, fontWeight: 700, color: "#1a2332" }}>{data.title}</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <EditSettingsBtn />
            <CloseBtn />
          </div>
        </div>

        {/* Health */}
        <div style={{ marginBottom: 20 }}>
          {data.healthPct != null ? (
            <>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#1a2332", marginBottom: 7 }}>Health — <strong>{data.healthPct}%</strong></div>
              <div style={{ height: 32, borderRadius: 99, background: "#e5e7eb", maxWidth: 260, overflow: "hidden" }}>
                <div style={{ width: `${data.healthPct}%`, height: "100%", borderRadius: 99, background: accent }} />
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#1a2332", marginBottom: 8 }}>Health — <strong>N/A</strong></div>
              <button style={{ padding: "8px 22px", borderRadius: 99, border: "1.5px solid #d1d5db", background: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>Set A Goal</button>
            </>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 24, marginBottom: 26 }}>
          {/* Stats card */}
          <div style={{ background: accent, borderRadius: 16, padding: "20px 22px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: activeColor === "gray" ? "#64748b" : "rgba(255,255,255,0.8)" }}>Amount</div>
                <div style={{ fontSize: 10, color: activeColor === "gray" ? "#94a3b8" : "rgba(255,255,255,0.55)" }}>Synced from {data.syncTime}</div>
              </div>
              <button style={{ background: activeColor === "gray" ? "#fff" : "rgba(255,255,255,0.9)", border: "none", borderRadius: 20, padding: "4px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600, color: "#1a2332" }}>Filter</button>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: activeColor === "gray" ? "#1a2332" : "#fff", marginBottom: 14 }}>{data.mainValue}</div>
            {data.stats.map((s, i) => (
              <div key={i} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, color: activeColor === "gray" ? "#64748b" : "rgba(255,255,255,0.82)" }}>{s.label}</span>
                  {s.synced && <span style={{ fontSize: 10, color: activeColor === "gray" ? "#94a3b8" : "rgba(255,255,255,0.5)" }}>Synced from {data.syncTime}</span>}
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: activeColor === "gray" ? "#1a2332" : "#fff" }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Manual adjust + chart */}
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#1a2332", marginBottom: 10 }}>Manually Adjust Metric</div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
              <button onClick={() => handleIncrement(-1)} style={{ width: 32, height: 32, borderRadius: "50%", border: "1.5px solid #d1d5db", background: "none", fontSize: 18, cursor: "pointer", color: "#9CA3AF" }}>−</button>
              <div>
                {isEditingValue ? (
                  <input
                    value={localValue}
                    onChange={e => setLocalValue(e.target.value)}
                    onBlur={handleValueSave}
                    onKeyDown={e => { if (e.key === "Enter") handleValueSave(); if (e.key === "Escape") setIsEditingValue(false); }}
                    autoFocus
                    style={{ fontSize: 28, fontWeight: 700, color: "#1a2332", lineHeight: 1, border: "none", borderBottom: "2px solid #3B82F6", outline: "none", width: 140, background: "transparent" }}
                  />
                ) : (
                  <div
                    onClick={() => setIsEditingValue(true)}
                    title="Click to edit"
                    style={{ fontSize: 28, fontWeight: 700, color: "#1a2332", lineHeight: 1, cursor: "text" }}
                  >{localValue}</div>
                )}
                <div style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>Synced from {data.syncTime}</div>
              </div>
              <button onClick={() => handleIncrement(1)} style={{ width: 32, height: 32, borderRadius: "50%", border: "1.5px solid #d1d5db", background: "none", fontSize: 18, cursor: "pointer", color: "#9CA3AF" }}>+</button>
            </div>
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "6px 10px" }}>
              <MetricChart history={history} rules={colorRules} graphType={graphType} metricType={metricType} currentValue={localValue} />
            </div>
          </div>
        </div>

        <BottomThreeCards data={data} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ADD COLOR RULE MODAL
// ═══════════════════════════════════════════════════════════════════════════

function AddColorRuleModal({ onSave, onClose, existing }: {
  onSave: (rule: ColorRule) => void; onClose: () => void; existing?: ColorRule;
}) {
  const [color, setColor] = useState<"red" | "yellow" | "green">(existing?.color ?? "red");
  const [op, setOp] = useState<RuleOp>(existing?.op ?? ">=");
  const [val, setVal] = useState(existing?.value?.toString() ?? "");
  const [val2, setVal2] = useState(existing?.value2?.toString() ?? "");

  const opLabels: RuleOp[] = [">=", "<=", ">", "<", "between"];
  const opDisplay: Record<RuleOp, string> = {
    ">=": "≥ (greater than or equal)", "<=": "≤ (less than or equal)",
    ">": "> (greater than)", "<": "< (less than)", "between": "between (range)"
  };

  const save = () => {
    const n = parseFloat(val); if (isNaN(n)) return;
    onSave({ id: existing?.id ?? crypto.randomUUID(), color, op, value: n, value2: op === "between" ? parseFloat(val2) : undefined });
    onClose();
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 4000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "28px 28px 24px", width: "100%", maxWidth: 560, boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#1a2332" }}>Add Color Rule</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8" }}>×</button>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1a2332", marginBottom: 12 }}>1. Select Condition</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 13, color: "#64748b", width: 90, flexShrink: 0 }}>If Metric is</span>
              <select value={op} onChange={e => setOp(e.target.value as RuleOp)}
                style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none", background: "#fff", cursor: "pointer" }}>
                {opLabels.map(o => <option key={o} value={o}>{opDisplay[o]}</option>)}
              </select>
            </div>
            {op !== "between" ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, color: "#64748b", width: 90, flexShrink: 0 }}>Value</span>
                <input value={val} onChange={e => setVal(e.target.value)} placeholder="Enter number"
                  style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 14, outline: "none" }} />
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, color: "#64748b", width: 90, flexShrink: 0 }}>Min Value</span>
                  <input value={val} onChange={e => setVal(e.target.value)} placeholder="Min"
                    style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 14, outline: "none" }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, color: "#64748b", width: 90, flexShrink: 0 }}>Max Value</span>
                  <input value={val2} onChange={e => setVal2(e.target.value)} placeholder="Max"
                    style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 14, outline: "none" }} />
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1a2332", marginBottom: 12 }}>2. Select Color</div>
          <div style={{ display: "flex", gap: 12 }}>
            {(["red", "yellow", "green"] as const).map(c => (
              <div key={c} onClick={() => setColor(c)} style={{
                display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                padding: "10px 14px", borderRadius: 10, flex: 1, justifyContent: "center",
                border: `2px solid ${color === c ? MS[c].bg : "#e2e8f0"}`,
                background: color === c ? MS[c].bg + "18" : "#fff", transition: "all 0.15s"
              }}>
                <span style={{ width: 14, height: 14, borderRadius: "50%", background: MS[c].bg, display: "inline-block", flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: color === c ? MS[c].bg : "#64748b", textTransform: "capitalize" }}>{c}</span>
              </div>
            ))}
          </div>
        </div>

        <button onClick={save} style={{
          width: "100%", padding: "12px 0", borderRadius: 8, border: "none",
          background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer"
        }}>Save Rule</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ICON PICKER COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

function IconPicker({ selected, onSelect }: { selected: string; onSelect: (icon: string) => void }) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState(0);

  const filtered = search.trim()
    ? ICON_CATEGORIES.map(c => ({ ...c, icons: c.icons.filter(i => i.toLowerCase().includes(search.toLowerCase())) })).filter(c => c.icons.length > 0)
    : ICON_CATEGORIES;

  return (
    <div>
      {/* No icon option */}
      <div onClick={() => onSelect(ICON_NONE)} style={{
        display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px",
        borderRadius: 6, cursor: "pointer", marginBottom: 8,
        background: selected === ICON_NONE ? "#EFF6FF" : "#F8FAFC",
        border: selected === ICON_NONE ? "1.5px solid #3B82F6" : "1.5px solid #e2e8f0",
        fontSize: 12, color: "#64748b"
      }}>No icon</div>

      {/* Search */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search icons..."
        style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none", marginBottom: 8, boxSizing: "border-box" }}
      />

      {/* Category tabs */}
      {!search && (
        <div style={{ display: "flex", gap: 4, overflowX: "auto", marginBottom: 8, paddingBottom: 2 }}>
          {ICON_CATEGORIES.map((c, i) => (
            <button key={i} onClick={() => setActiveCategory(i)} style={{
              padding: "3px 8px", borderRadius: 20, border: "none", cursor: "pointer", flexShrink: 0,
              background: activeCategory === i ? "#3B82F6" : "#f1f5f9",
              color: activeCategory === i ? "#fff" : "#64748b", fontSize: 10, fontWeight: 500
            }}>{c.label.split(" ")[0]}</button>
          ))}
        </div>
      )}

      {/* Icon grid */}
      <div style={{ height: 160, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 10, padding: 6 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
          {(search ? filtered.flatMap(c => c.icons) : (filtered[activeCategory]?.icons ?? [])).map(ic => (
            <div
              key={ic}
              onClick={() => onSelect(ic)}
              title={ic.replace(/^(icon_|arrow_|social_)/, "")}
              style={{
                width: 34, height: 34, borderRadius: 6, display: "flex", alignItems: "center",
                justifyContent: "center", cursor: "pointer",
                background: selected === ic ? "#EFF6FF" : "#f8fafc",
                border: selected === ic ? "1.5px solid #3B82F6" : "1.5px solid #e2e8f0",
                transition: "background 0.1s"
              }}
            >
              <ElegantIcon name={ic} size={17} color="#3B82F6" />
            </div>
          ))}
        </div>
      </div>

      {selected && selected !== ICON_NONE && (
        <div style={{ marginTop: 6, fontSize: 12, color: "#64748b", display: "flex", alignItems: "center", gap: 6 }}>
          Selected: <ElegantIcon name={selected} size={16} color="#3B82F6" />
          <span style={{ color: "#94a3b8" }}>{selected.replace(/^(icon_|arrow_|social_)/, "")}</span>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// METRIC BOX SETTINGS MODAL
// ═══════════════════════════════════════════════════════════════════════════

function MetricBoxSettingsModal({ initial, onSave, onDelete, onClose }: {
  initial?: Metric; onSave: (m: Omit<Metric, "id">) => void; onDelete?: () => void; onClose: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [value, setValue] = useState(initial?.value ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? ICON_NONE);
  const [graphType, setGraphType] = useState<GraphType>(initial?.graphType ?? "linear");
  const [metricType, setMetricType] = useState<MetricType>(initial?.metricType ?? "counter");
  const [fiveOn, setFiveOn] = useState(initial?.modal?.fiveAccountEnabled ?? false);
  const [rules, setRules] = useState<ColorRule[]>(initial?.colorRules ?? []);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRule, setEditingRule] = useState<ColorRule | undefined>();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [saveError, setSaveError] = useState("");

  const graphTypes: [GraphType, string][] = [["linear", "Line Chart"], ["bar-v", "Bar Vertical"], ["bar-h", "Bar Horizontal"], ["pie", "Pie Chart"]];
  const metricTypes: [MetricType, string][] = [["counter", "Counter"], ["percentage", "Percentage"], ["financial", "Financial"]];

  const Radio = ({ checked, onChange, label: rl }: { checked: boolean; onChange: () => void; label: string }) => (
    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "#1a2332", marginBottom: 6 }}>
      <input type="radio" checked={checked} onChange={onChange} style={{ accentColor: "#3B82F6", margin: 0 }} />{rl}
    </label>
  );

  const SectionLabel = ({ children }: { children: string }) => (
    <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>{children}</div>
  );

  const openAddRule = () => { setEditingRule(undefined); setShowRuleModal(true); };
  const openEditRule = (r: ColorRule) => { setEditingRule(r); setShowRuleModal(true); };
  const saveRule = (r: ColorRule) => setRules(prev => { const i = prev.findIndex(x => x.id === r.id); if (i >= 0) { const a = [...prev]; a[i] = r; return a; } return [...prev, r]; });
  const removeRule = (id: string) => setRules(prev => prev.filter(r => r.id !== id));
  const ruleDesc = (r: ColorRule) => r.op === "between" ? `between ${r.value}–${r.value2}` : `${r.op} ${r.value}`;

  const handleSave = () => {
    if (!label.trim()) { setSaveError("Please enter a title for this metric box."); return; }
    if (!value.trim()) { setSaveError("Please enter a current value."); return; }
    setSaveError("");
    const baseColor: MetricColor = "gray";
    const m = makeModal(label, value || "0", baseColor, {
      fiveAccountEnabled: fiveOn,
      type: fiveOn ? "cashflow" : metricType === "counter" ? "leads" : metricType === "percentage" ? "website" : "invoices"
    });
    onSave({
      label, value: value || "0", icon, color: baseColor, modal: m,
      graphType, metricType, colorRules: rules,
      connectedApps: initial?.connectedApps ?? [],
      history: initial?.history ?? [],
    });
    onClose();
  };

  // Enter key saves
  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter") handleSave(); };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 16 }}>
        <div onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown} style={{
          background: "#fff", borderRadius: 20, width: "100%", maxWidth: 700,
          maxHeight: "92vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.2)"
        }}>
          <style>{`@keyframes mIn{from{opacity:0;transform:scale(0.97)}to{opacity:1;transform:scale(1)}}`}</style>

          {/* Header */}
          <div style={{ padding: "22px 24px 0", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="Metric Box Title"
              style={{ fontSize: 18, fontWeight: 700, border: "none", outline: "none", color: "#1a2332", background: "transparent", flex: 1, minWidth: 0 }}
            />
            <button onClick={onClose} style={{
              width: 32, height: 32, borderRadius: "50%", border: "1.5px solid #e2e8f0",
              background: "#f8fafc", fontSize: 18, cursor: "pointer", color: "#94a3b8",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0, marginLeft: 12, lineHeight: 1
            }}>×</button>
          </div>

          <div style={{ padding: "8px 24px 24px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>

              {/* LEFT COLUMN */}
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

                <div>
                  <SectionLabel>Metric Type</SectionLabel>
                  {metricTypes.map(([t, l]) => <Radio key={t} checked={metricType === t} onChange={() => setMetricType(t)} label={l} />)}
                </div>

                <div>
                  <SectionLabel>Current Value</SectionLabel>
                  <input value={value} onChange={e => setValue(e.target.value)} placeholder="e.g. 75 or $12,000"
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                </div>

                <div>
                  <SectionLabel>Connected Apps</SectionLabel>
                  {(initial?.connectedApps ?? []).length === 0
                    ? <div style={{ fontSize: 12, color: "#cbd5e1", fontStyle: "italic" }}>No apps connected yet</div>
                    : (initial?.connectedApps ?? []).map((a, i) => (
                      <span key={i} style={{ display: "inline-block", background: "#EFF6FF", borderRadius: 8, padding: "4px 10px", fontSize: 12, color: "#3B82F6", marginRight: 6, marginBottom: 4 }}>{a}</span>
                    ))
                  }
                </div>

                {/* Five-Account System */}
                <div style={{ background: "#F0FDF4", border: "1px solid #c3e6d4", borderRadius: 10, padding: "10px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: fiveOn ? 8 : 0 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332" }}>Five-Account System</div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>Profit First budgeting method</div>
                    </div>
                    <Toggle on={fiveOn} onChange={setFiveOn} />
                  </div>
                  {fiveOn && <div style={{ fontSize: 11, color: "#0F6E56", background: "#dcfce7", borderRadius: 6, padding: "6px 10px" }}>
                    ✓ Box will display bank transactions and 5-account math.</div>}
                </div>

                {/* Color Rules */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <button style={{ padding: "9px 0", borderRadius: 8, border: "none", background: "#64748b", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    Create Equation
                  </button>
                  <button onClick={openAddRule} style={{ padding: "9px 0", borderRadius: 8, border: "none", background: "#64748b", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    Create Color Rule
                  </button>
                </div>

                {/* Active rules */}
                {rules.length > 0 && (
                  <div>
                    <SectionLabel>Active Color Rules</SectionLabel>
                    {rules.map(r => (
                      <div key={r.id} style={{ background: "#F8FAFC", borderRadius: 10, padding: "8px 12px", marginBottom: 7, border: "1px solid #e2e8f0" }}>
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                              <span style={{ width: 10, height: 10, borderRadius: "50%", background: MS[r.color].bg, flexShrink: 0, display: "inline-block" }} />
                              <span style={{ fontSize: 12, fontWeight: 600, color: "#1a2332", textTransform: "capitalize" }}>{r.color}</span>
                            </div>
                            <div style={{ fontSize: 11, color: "#64748b" }}>If metric is {ruleDesc(r)} → {r.color}</div>
                          </div>
                          <div style={{ display: "flex", gap: 6, marginLeft: 8 }}>
                            <button onClick={() => openEditRule(r)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#3B82F6", padding: 0 }}>Edit</button>
                            <button onClick={() => removeRule(r.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#E85D75", padding: 0 }}>✕</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* RIGHT COLUMN */}
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <SectionLabel>Select Icon</SectionLabel>
                  <IconPicker selected={icon} onSelect={setIcon} />
                </div>

                <div>
                  <SectionLabel>Graph Type</SectionLabel>
                  {graphTypes.map(([g, l]) => <Radio key={g} checked={graphType === g} onChange={() => setGraphType(g)} label={l} />)}
                </div>
              </div>
            </div>

            {/* Save button */}
            <button onClick={handleSave} style={{
              width: "100%", padding: "13px 0", borderRadius: 8, border: "none", marginTop: 24,
              background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer"
            }}>Save</button>
            {saveError && (
              <div style={{ fontSize: 12, color: "#E85D75", marginTop: 6, textAlign: "center" }}>{saveError}</div>
            )}

            {/* Delete */}
            {(initial || onDelete) && !showDeleteConfirm && (
              <div style={{ textAlign: "center", marginTop: 12 }}>
                <button onClick={() => setShowDeleteConfirm(true)} style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "#E85D75", fontSize: 13, textDecoration: "underline", padding: 0
                }}>Delete Metric Box</button>
              </div>
            )}
            {showDeleteConfirm && (
              <div style={{ marginTop: 12, background: "#FFF5F5", borderRadius: 10, padding: "14px 16px", border: "1px solid #fecaca", textAlign: "center" }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#E85D75", marginBottom: 10 }}>
                  Are you sure you want to delete this metric box?
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                  <button onClick={() => setShowDeleteConfirm(false)} style={{
                    padding: "8px 20px", borderRadius: 8, border: "1.5px solid #e2e8f0",
                    background: "#fff", fontSize: 13, cursor: "pointer", color: "#64748b"
                  }}>Cancel</button>
                  <button onClick={() => { if (onDelete) { onDelete(); onClose(); } }} style={{
                    padding: "8px 20px", borderRadius: 8, border: "none",
                    background: "#E85D75", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer"
                  }}>Yes, Delete</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {showRuleModal && <AddColorRuleModal existing={editingRule} onSave={saveRule} onClose={() => setShowRuleModal(false)} />}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// EDIT/ADD ROW MODAL
// ═══════════════════════════════════════════════════════════════════════════

function EditAddRowModal({ initial, onSave, onClose }: { initial?: string; onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(initial ?? "");
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "28px 28px 24px", width: "90%", maxWidth: 360, boxShadow: "0 20px 60px rgba(0,0,0,0.18)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1a2332" }}>Edit/Add Row</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8" }}>×</button>
        </div>
        <label style={{ fontSize: 13, color: "#64748b", display: "block", marginBottom: 6 }}>Label</label>
        <input value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && name.trim()) { onSave(name.trim()); onClose(); } }}
          placeholder="Row Name"
          style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 24 }} />
        <button onClick={() => { if (name.trim()) { onSave(name.trim()); onClose(); } }}
          style={{ width: "100%", padding: "11px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
          Save
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ADD TEAM MODAL
// ═══════════════════════════════════════════════════════════════════════════

function AddTeamModal({ onClose }: { onClose: () => void }) {
  const [members, setMembers] = useState([{ email: "", access: "View" }]);
  const addRow = () => setMembers(p => [...p, { email: "", access: "View" }]);
  const update = (i: number, field: "email" | "access", val: string) => setMembers(p => p.map((m, j) => j === i ? { ...m, [field]: val } : m));
  const accessLevels = ["View", "Edit", "Admin"];
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "32px", width: "100%", maxWidth: 480, boxShadow: "0 24px 64px rgba(0,0,0,0.18)" }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8" }}>×</button>
        </div>
        <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 700, color: "#1a2332", textAlign: "center" }}>Add your team</h2>
        <p style={{ margin: "0 0 24px", fontSize: 13, color: "#94a3b8", textAlign: "center", lineHeight: 1.5 }}>
          You can set permission levels for each team member, and give access to different metrics to only the people that need to see them.
        </p>
        {members.map((m, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, marginBottom: 12, alignItems: "center" }}>
            <input value={m.email} onChange={e => update(i, "email", e.target.value)} placeholder="Email"
              style={{ padding: "9px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none" }} />
            <div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 2 }}>Level Access</div>
              <select value={m.access} onChange={e => update(i, "access", e.target.value)}
                style={{ padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none", background: "#fff", cursor: "pointer" }}>
                {accessLevels.map(a => <option key={a}>{a}</option>)}
              </select>
            </div>
          </div>
        ))}
        <button onClick={addRow} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#3B82F6", padding: "4px 0", marginBottom: 20, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Add more
        </button>
        <button onClick={onClose} style={{ width: "100%", padding: "12px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
          Add
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// METRIC BLOCK (face of the card)
// ═══════════════════════════════════════════════════════════════════════════

function MetricBlock({ metric, onClick, onDragStart, onDragOver, onDrop, isDragOver }: {
  metric: Metric; onClick: () => void;
  onDragStart: () => void; onDragOver: (e: React.DragEvent) => void; onDrop: () => void; isDragOver: boolean;
}) {
  const activeColor = resolveColor(metric);
  const s = MS[activeColor];
  const [hov, setHov] = useState(false);
  const hasIcon = metric.icon && metric.icon !== ICON_NONE;

  // Gray state: dark text. Color state: white text.
  const textColor = activeColor === "gray" ? "#4A5568" : "#fff";
  const iconBg = activeColor === "gray" ? "rgba(100,116,139,0.12)" : "rgba(255,255,255,0.25)";

  return (
    <div
      draggable onDragStart={onDragStart} onDragOver={onDragOver} onDrop={e => { e.preventDefault(); onDrop(); }}
      onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        width: 140, minHeight: 140, borderRadius: 16, background: s.bg,
        padding: "14px 12px", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: hasIcon ? "space-between" : "center",
        cursor: "pointer", position: "relative", flexShrink: 0,
        transform: hov ? "translateY(-3px)" : "none",
        transition: "transform 0.15s,box-shadow 0.15s",
        boxShadow: hov ? "0 10px 28px rgba(0,0,0,0.15)" : "0 2px 8px rgba(0,0,0,0.06)",
        outline: isDragOver ? "3px dashed rgba(59,130,246,0.6)" : "3px solid transparent"
      }}
    >
      {/* Title at top */}
      <div style={{ fontSize: 12, fontWeight: 600, color: textColor, lineHeight: 1.3, textAlign: "center", width: "100%" }}>
        {metric.label}
      </div>

      {/* Icon circle in center — always white bg */}
      {hasIcon && (
        <div style={{
          width: 48, height: 48, borderRadius: "50%", background: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
        }}>
          <ElegantIcon name={metric.icon} size={22} color={activeColor === "gray" ? "#3B82F6" : MS[activeColor].bg} />
        </div>
      )}

      {/* Value at bottom */}
      <div style={{ fontSize: 15, fontWeight: 700, color: textColor, textAlign: "center", width: "100%" }}>
        {metric.value}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ROW CONTEXT MENU
// ═══════════════════════════════════════════════════════════════════════════

function RowMenu({ onRename, onDelete, onClose }: { onRename: () => void; onDelete: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);
  return (
    <div ref={ref} style={{
      position: "absolute", top: 36, right: 0, background: "#fff", borderRadius: 10,
      boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid #e2e8f0",
      zIndex: 100, minWidth: 150, overflow: "hidden"
    }}>
      {[{ label: "✏️  Rename row", action: onRename }, { label: "🗑️  Delete row", action: onDelete }].map(item => (
        <div key={item.label} onClick={() => { item.action(); onClose(); }}
          style={{ padding: "10px 16px", fontSize: 13, cursor: "pointer", color: "#1a2332" }}
          onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>{item.label}</div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD SECTION
// ═══════════════════════════════════════════════════════════════════════════

function DashSection({
  section, onAddMetric, onRemoveMetric, onUpdateMetric, onRenameSection, onRemoveSection,
  onClickMetric, onMetricDragStart, onMetricDrop, dragOverMetric,
  onSectionDragStart, onSectionDragOver, onSectionDrop, isSectionDragOver
}: {
  section: Section; onAddMetric: (sid: string, m: Omit<Metric, "id">) => void;
  onRemoveMetric: (sid: string, mid: string) => void;
  onUpdateMetric: (sid: string, mid: string, m: Omit<Metric, "id">) => void;
  onRenameSection: (sid: string, name: string) => void;
  onRemoveSection: (sid: string) => void;
  onClickMetric: (m: MetricModalData, metric: Metric) => void;
  onMetricDragStart: (sid: string, mid: string) => void;
  onMetricDrop: (tsid: string, tmid: string) => void;
  dragOverMetric: string | null;
  onSectionDragStart: () => void; onSectionDragOver: (e: React.DragEvent) => void;
  onSectionDrop: () => void; isSectionDragOver: boolean;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingMetric, setEditingMetric] = useState<Metric | null>(null);
  const [showRowModal, setShowRowModal] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div onDragOver={onSectionDragOver} onDrop={onSectionDrop} style={{
      marginBottom: 32, position: "relative",
      outline: isSectionDragOver ? "2px dashed #3B82F6" : "none", borderRadius: 8,
      padding: isSectionDragOver ? "4px" : "0"
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div draggable onDragStart={onSectionDragStart} style={{ cursor: "grab", color: "#cbd5e1", fontSize: 16, padding: "0 2px", flexShrink: 0 }} title="Drag to reorder">⠿</div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#1a2332" }}>{section.title}</h2>
        <div style={{ width: 18, height: 18, borderRadius: 3, background: "#1a2332", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <span style={{ color: "#fff", fontSize: 10 }}>↗</span>
        </div>
        <div style={{ display: "flex", marginLeft: 4, paddingLeft: 6 }}>
          {section.avatars.map(a => (
            <div key={a} style={{
              width: 32, height: 32, borderRadius: "50%", background: "#4C9FE8", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600,
              border: "2px solid #fff", marginLeft: -6, flexShrink: 0
            }}>{a}</div>
          ))}
        </div>
        <div style={{
          width: 32, height: 32, borderRadius: "50%", marginLeft: -6, background: "#4C9FE8",
          border: "2px solid #fff", display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", color: "#fff", fontSize: 18
        }}>+</div>
        <div style={{ position: "relative" }}>
          <div onClick={() => setShowMenu(v => !v)} style={{
            width: 28, height: 28, borderRadius: "50%", background: "#F1F5F9",
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 14, color: "#94a3b8"
          }}>···</div>
          {showMenu && <RowMenu onRename={() => { setShowMenu(false); setShowRowModal(true); }} onDelete={() => onRemoveSection(section.id)} onClose={() => setShowMenu(false)} />}
        </div>
        <div style={{ flex: 1 }} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <div style={{ width: 32, height: 32, borderRadius: "50%", border: "1.5px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#94a3b8", flexShrink: 0, marginRight: 8 }}>›</div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {section.metrics.map(m => (
            <MetricBlock key={m.id} metric={m}
              onClick={() => onClickMetric(m.modal, m)}
              onDragStart={() => onMetricDragStart(section.id, m.id)}
              onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={() => onMetricDrop(section.id, m.id)}
              isDragOver={dragOverMetric === `${section.id}:${m.id}`} />
          ))}
          <div onClick={() => setShowAdd(true)} style={{
            width: 48, height: 48, borderRadius: "50%", border: "1.5px solid #e2e8f0",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", color: "#94a3b8", fontSize: 22, alignSelf: "center"
          }}>+</div>
        </div>
      </div>
      <div style={{ height: 1, background: "#f1f5f9", marginTop: 24 }} />

      {showAdd && (
        <MetricBoxSettingsModal
          onSave={m => { onAddMetric(section.id, m); setShowAdd(false); }}
          onClose={() => setShowAdd(false)} />
      )}

      {editingMetric && (
        <MetricBoxSettingsModal
          initial={editingMetric}
          onSave={m => { onUpdateMetric(section.id, editingMetric.id, m); setEditingMetric(null); }}
          onDelete={() => onRemoveMetric(section.id, editingMetric.id)}
          onClose={() => setEditingMetric(null)} />
      )}

      {showRowModal && (
        <EditAddRowModal
          initial={section.title}
          onSave={name => onRenameSection(section.id, name)}
          onClose={() => setShowRowModal(false)} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE: GOALS
// ═══════════════════════════════════════════════════════════════════════════

function GoalsPage({ goals, setGoals }: { goals: any[]; setGoals: (g: any[]) => void }) {
  const [view, setView] = useState<"list" | "expanded">("list");
  return (
    <div style={{ padding: "clamp(16px,4vw,32px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 28, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: "clamp(20px,4vw,26px)", fontWeight: 700, color: "#1a2332" }}>Company Goals</h1>
        <div style={{ display: "flex", gap: 8, marginLeft: 8 }}>
          {(["list", "expanded"] as const).map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: "6px 16px", borderRadius: 20, border: "none", fontSize: 13, cursor: "pointer", fontWeight: 500,
              background: view === v ? "#3B82F6" : "#e2e8f0", color: view === v ? "#fff" : "#64748b", textTransform: "capitalize"
            }}>{v === "list" ? "List" : "Expanded"}</button>
          ))}
        </div>
        <button style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", marginLeft: "auto" }}>
          ⊕ Add Goal
        </button>
      </div>

      {view === "list" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {goals.map((g, i) => (
            <div key={i} style={{ background: "#fff", borderRadius: 16, padding: "18px 20px", border: "1px solid #f1f5f9" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", border: "1.5px solid #d1d5db", flexShrink: 0 }} />
                <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332", flex: 1 }}>{g.label}</div>
                <button style={{ background: "none", border: "none", fontSize: 13, color: "#3B82F6", cursor: "pointer", padding: 0 }}>Edit</button>
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>Progress - {g.pct}%</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1, height: 10, borderRadius: 99, background: "#e5e7eb", overflow: "hidden" }}>
                  <div style={{ width: `${g.pct}%`, height: "100%", borderRadius: 99, background: "#4CAF7D" }} />
                </div>
                <span style={{ fontSize: 12, color: "#94a3b8", flexShrink: 0 }}>Due: {g.due}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 20 }}>
          {goals.map((g, i) => (
            <div key={i} style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #f1f5f9" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332", flex: 1 }}>{g.label}</div>
                <button style={{ background: "none", border: "none", fontSize: 13, color: "#3B82F6", cursor: "pointer", padding: 0 }}>Edit</button>
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Progress - {g.pct}%</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <div style={{ flex: 1, height: 10, borderRadius: 99, background: "#e5e7eb", overflow: "hidden" }}>
                  <div style={{ width: `${g.pct}%`, height: "100%", borderRadius: 99, background: "#4CAF7D" }} />
                </div>
                <span style={{ fontSize: 12, color: "#94a3b8", flexShrink: 0 }}>Due: {g.due}</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1a2332", marginBottom: 10 }}>Projections:</div>
              {g.projections.map((p: any, pi: number) => (
                <div key={pi} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>{p.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#1a2332" }}>{p.value}</div>
                </div>
              ))}
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1a2332", marginTop: 14, marginBottom: 10 }}>Metrics Tracking This Goal:</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {g.metrics.map((m: any, mi: number) => (
                  <div key={mi} style={{ background: MS[m.color as MetricColor].bg, borderRadius: 10, padding: "8px 12px", minWidth: 80 }}>
                    <div style={{ fontSize: 11, color: MS[m.color as MetricColor].text, fontWeight: 600 }}>{m.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: MS[m.color as MetricColor].text, marginTop: 2 }}>{m.value}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE: TASKS
// ═══════════════════════════════════════════════════════════════════════════

function TasksPage({ tasks, setTasks }: { tasks: any[]; setTasks: (t: any[]) => void }) {
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");
  const toggle = (id: string) => setTasks(tasks.map((x: any) => x.id === id ? { ...x, done: !x.done } : x));
  const filtered = tasks.filter(t => filter === "all" ? true : filter === "active" ? !t.done : t.done);
  const suggestedTasks = [
    { text: "Close 5 more calls", tag: "Sales" },
    { text: "Send 13 invoices", tag: "Finance" },
    { text: "Add $3,500 from Overhead", tag: "Cashflow" },
  ];
  return (
    <div style={{ padding: "clamp(16px,4vw,32px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 28, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: "clamp(20px,4vw,26px)", fontWeight: 700, color: "#1a2332" }}>Tasks</h1>
        <button style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", marginLeft: "auto" }}>
          + Add Task
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(200px,1fr)", gap: 24 }}>
        <div>
          <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
            {(["all", "active", "completed"] as const).map(f => (
              <div key={f} onClick={() => setFilter(f)} style={{
                padding: "6px 16px", borderRadius: 20, fontSize: 13, fontWeight: 500, cursor: "pointer",
                background: filter === f ? "#3B82F6" : "#f1f5f9", color: filter === f ? "#fff" : "#64748b", textTransform: "capitalize"
              }}>
                {f}{f === "all" ? ` (${tasks.length})` : ""}
              </div>
            ))}
          </div>
          {filtered.map(t => (
            <div key={t.id} style={{
              display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", background: "#fff",
              borderRadius: 12, marginBottom: 8, border: "1px solid #f1f5f9", opacity: t.done ? 0.6 : 1, transition: "opacity 0.2s"
            }}>
              <div onClick={() => toggle(t.id)} style={{
                width: 22, height: 22, borderRadius: "50%", flexShrink: 0, cursor: "pointer",
                border: t.done ? "none" : "1.5px solid #d1d5db", background: t.done ? "#4CAF7D" : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12
              }}>{t.done ? "✓" : ""}</div>
              <div style={{ flex: 1, fontSize: 14, color: "#1a2332", textDecoration: t.done ? "line-through" : "none" }}>{t.text}</div>
              <div style={{ fontSize: 12, color: "#94a3b8", flexShrink: 0 }}>Due {t.due}</div>
              <Av initials={t.assignee} size={28} />
            </div>
          ))}
        </div>
        <div>
          <SectionCard title="Suggested Tasks ✦">
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 14 }}>Based on your dashboard metrics</div>
            {suggestedTasks.map((t, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#fff", borderRadius: 10, marginBottom: 8, border: "1px solid #f1f5f9" }}>
                <div style={{ fontSize: 18, color: "#94a3b8", cursor: "pointer" }}>⊕</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: "#1a2332" }}>{t.text}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>{t.tag}</div>
                </div>
              </div>
            ))}
          </SectionCard>
          <div style={{ marginTop: 16 }}>
            <SectionCard>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1a2332", marginBottom: 12 }}>Task Summary</div>
              {[["Total", tasks.length], ["Completed", tasks.filter(t => t.done).length], ["Pending", tasks.filter(t => !t.done).length]].map(([l, v]) => (
                <div key={l as string} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: "#64748b" }}>{l}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#1a2332" }}>{v}</span>
                </div>
              ))}
            </SectionCard>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE: INTEGRATIONS
// ═══════════════════════════════════════════════════════════════════════════

const APPS = [
  { id: "asana", name: "Asana", logo: "🟧", color: "#F06A35", connected: true, desc: "Task & project management", metrics: ["Tasks Completed", "Metric Boxes", "Workflows"] },
  { id: "trello", name: "Trello", logo: "🟦", color: "#0052CC", connected: true, desc: "Visual project boards", metrics: ["Tasks Completed", "Metric Boxes", "Workflows"] },
  { id: "analytics", name: "Google Analytics", logo: "📊", color: "#E37400", connected: false, desc: "Website traffic & engagement", metrics: ["Data Synced", "Metric Boxes", "Workflows"] },
  { id: "quickbooks", name: "QuickBooks", logo: "🟩", color: "#2CA01C", connected: true, desc: "Accounting & invoicing", metrics: ["Data Synced", "Metric Boxes", "Workflows"] },
  { id: "hubspot", name: "HubSpot", logo: "🟠", color: "#FF7A59", connected: false, desc: "CRM & marketing hub", metrics: ["Data Synced", "Metric Boxes", "Workflows"] },
  { id: "plaid", name: "Plaid", logo: "🔗", color: "#111827", connected: false, desc: "Bank account linking", metrics: ["Data Synced", "Metric Boxes", "Workflows"] },
];

function IntegrationsPage({ onSelectApp }: { onSelectApp: (app: typeof APPS[0]) => void }) {
  const [search, setSearch] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const filtered = APPS.filter(a => a.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <div style={{ padding: "clamp(16px,4vw,32px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: "clamp(20px,4vw,26px)", fontWeight: 700, color: "#1a2332" }}>All Apps</h1>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search apps..."
            style={{ padding: "8px 14px", borderRadius: 20, border: "1px solid #e2e8f0", fontSize: 13, outline: "none", width: 180 }} />
          <button onClick={() => setShowAddModal(true)} style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            + Add Integration
          </button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 16, marginBottom: 32 }}>
        {filtered.map(app => (
          <div key={app.id} onClick={() => onSelectApp(app)} style={{
            background: "#fff", borderRadius: 16, padding: 20, border: "1px solid #f1f5f9",
            cursor: "pointer", transition: "box-shadow 0.15s", boxShadow: "0 2px 8px rgba(0,0,0,0.04)"
          }}
            onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.1)")}
            onMouseLeave={e => (e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.04)")}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 28 }}>{app.logo}</div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332" }}>{app.name}</div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>{app.desc}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 99, fontWeight: 600, background: app.connected ? "#DCFCE7" : "#F1F5F9", color: app.connected ? "#15803D" : "#94a3b8" }}>
                {app.connected ? "Connected" : "Not Connected"}
              </span>
              <span style={{ fontSize: 12, color: "#3B82F6", cursor: "pointer" }}>{app.connected ? "Manage →" : "Connect →"}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ background: "#EEF9F4", border: "1px solid #c3e6d4", borderRadius: 16, padding: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#0F6E56", marginBottom: 8 }}>🏦 Phase 3: Live Bank Integration via Plaid</div>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "#1e6b4e", lineHeight: 1.6 }}>
          Connect your real bank account through Plaid and Dashello will automatically calculate your Five-Account balances.
        </p>
        <button style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "#0F6E56", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          Connect Bank Account →
        </button>
      </div>

      {showAddModal && (
        <div onClick={() => setShowAddModal(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 24, padding: "36px 32px", width: "100%", maxWidth: 560, boxShadow: "0 32px 80px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
              <button onClick={() => setShowAddModal(false)} style={{ background: "none", border: "none", fontSize: 26, cursor: "pointer", color: "#1a2332" }}>×</button>
            </div>
            <h2 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 700, color: "#1a2332", textAlign: "center" }}>Add your metrics</h2>
            <p style={{ margin: "0 0 24px", fontSize: 13, color: "#94a3b8", textAlign: "center", lineHeight: 1.6 }}>
              Select the apps you use or search for your favourite apps.
            </p>
            <input placeholder='Search "Salesforce"....' style={{ width: "100%", padding: "10px 16px", borderRadius: 20, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none", boxSizing: "border-box", marginBottom: 20 }} />
            {APPS.map(app => (
              <div key={app.id} style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 14 }}>
                <div style={{ fontSize: 22 }}>{app.logo}</div>
                <div style={{ flex: 1, fontSize: 15, fontWeight: 600, color: "#1a2332" }}>{app.name}</div>
                <button style={{ padding: "10px 28px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", color: "#1a2332" }}>
                  {app.connected ? "Connected" : "Connect"}
                </button>
              </div>
            ))}
            <button onClick={() => setShowAddModal(false)} style={{ width: "100%", padding: "13px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AppDetailPage({ app, onBack }: { app: typeof APPS[0]; onBack: () => void }) {
  const sampleMetrics = [
    { label: "Tasks Completed", value: "127", change: "+12%", color: "green" as MetricColor },
    { label: "Active Projects", value: "8", change: "+2", color: "yellow" as MetricColor },
    { label: "Overdue Items", value: "3", change: "-5", color: "red" as MetricColor },
  ];
  return (
    <div style={{ padding: "clamp(16px,4vw,32px)" }}>
      <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: "#3B82F6", fontSize: 14, marginBottom: 20, display: "flex", alignItems: "center", gap: 4 }}>
        ← Back to All Apps
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        <div style={{ fontSize: 36 }}>{app.logo}</div>
        <div>
          <h1 style={{ margin: 0, fontSize: "clamp(20px,4vw,26px)", fontWeight: 700, color: "#1a2332" }}>{app.name}</h1>
          <div style={{ fontSize: 13, color: "#94a3b8" }}>{app.desc}</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          {app.connected
            ? <button style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", fontSize: 13, cursor: "pointer", color: "#E85D75" }}>Disconnect</button>
            : <button style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Connect {app.name}</button>
          }
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 16, marginBottom: 28 }}>
        {sampleMetrics.map((m, i) => (
          <div key={i} style={{ background: MS[m.color].bg, borderRadius: 16, padding: 20 }}>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", marginBottom: 6 }}>{m.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#fff" }}>{m.value}</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 4 }}>{m.change} this month</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 20 }}>
        <SectionCard title="Workflows">
          {["Auto-create tasks from overdue invoices", "Notify team on lead stage change", "Weekly summary to Slack"].map((w, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: i < 2 ? "1px solid #f1f5f9" : "none" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#4CAF7D", flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: "#1a2332", flex: 1 }}>{w}</span>
              <Toggle on={i < 2} onChange={() => { }} />
            </div>
          ))}
        </SectionCard>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE: TEAM
// ═══════════════════════════════════════════════════════════════════════════

function TeamPage() {
  const [showInvite, setShowInvite] = useState(false);
  const members = [
    { name: "Alex Johnson", role: "Owner", initials: "AJ", email: "alex@company.com", tasks: 12, color: "#4C9FE8" },
    { name: "Beth Kim", role: "Marketing", initials: "BK", email: "beth@company.com", tasks: 8, color: "#7B68EE" },
    { name: "Chris Lee", role: "Sales", initials: "CL", email: "chris@company.com", tasks: 15, color: "#48C78E" },
    { name: "Dana Miller", role: "Finance", initials: "DM", email: "dana@company.com", tasks: 5, color: "#F5A623" },
    { name: "Emma Nash", role: "Operations", initials: "EN", email: "emma@company.com", tasks: 9, color: "#E85D75" },
    { name: "Frank Owen", role: "Dev", initials: "FO", email: "frank@company.com", tasks: 11, color: "#06B6D4" },
  ];
  return (
    <div style={{ padding: "clamp(16px,4vw,32px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 28, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: "clamp(20px,4vw,26px)", fontWeight: 700, color: "#1a2332" }}>Team</h1>
        <button onClick={() => setShowInvite(true)} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", marginLeft: "auto" }}>
          + Invite Member
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 16, marginBottom: 28 }}>
        {members.map((m, i) => (
          <div key={i} style={{ background: "#fff", borderRadius: 16, padding: 20, border: "1px solid #f1f5f9", textAlign: "center" }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: m.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700, color: "#fff", margin: "0 auto 12px" }}>{m.initials}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332" }}>{m.name}</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>{m.role}</div>
            <div style={{ fontSize: 12, color: "#3B82F6", marginBottom: 12 }}>{m.email}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2332" }}>{m.tasks}</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>Tasks</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 16 }}>
        {[{ color: "green" as MetricColor, label: "Team", value: "6 members" }, { color: "yellow" as MetricColor, label: "Open Tasks", value: "60" }, { color: "gray" as MetricColor, label: "Completed", value: "2 this week" }].map((b, i) => (
          <div key={i} style={{ background: MS[b.color].bg, borderRadius: 16, padding: 20 }}>
            <div style={{ fontSize: 13, color: MS[b.color].text, opacity: 0.8 }}>{b.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: MS[b.color].text, marginTop: 4 }}>{b.value}</div>
          </div>
        ))}
      </div>
      {showInvite && <AddTeamModal onClose={() => setShowInvite(false)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE: SETTINGS
// ═══════════════════════════════════════════════════════════════════════════

function ProfileField({ label, value, onChange, disabled }: {
  label: string; value: string; onChange?: (v: string) => void; disabled?: boolean
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 13, color: "#64748b", display: "block", marginBottom: 4 }}>{label}</label>
      <input value={value} onChange={e => onChange?.(e.target.value)} disabled={disabled}
        style={{
          width: "100%", padding: "9px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0",
          fontSize: 14, outline: "none", boxSizing: "border-box" as const,
          background: disabled ? "#f8fafc" : "#fff", color: disabled ? "#94a3b8" : "#1a2332"
        }} />
    </div>
  );
}

function SettingsPage({ userId, userEmail, onProfileSaved }: {
  userId: string; userEmail: string; onProfileSaved: (p: any) => void;
}) {
  const [localProfile, setLocalProfile] = useState({
    full_name: "", company: "", street: "", city: "",
    state: "", zip: "", country: "", avatar_url: "",
    five_account_enabled: false,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [plan, setPlan] = useState("Pro");
  const [notif, setNotif] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!userId) return;
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle().then(({ data }) => {
      if (data) setLocalProfile({
        full_name: data.full_name ?? "", company: data.company ?? "",
        street: data.street ?? "", city: data.city ?? "", state: data.state ?? "",
        zip: data.zip ?? "", country: data.country ?? "", avatar_url: data.avatar_url ?? "",
        five_account_enabled: data.five_account_enabled ?? false,
      });
    });
  }, [userId]);

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase.from("profiles").upsert({
      id: userId, ...localProfile, updated_at: new Date().toISOString(),
    });
    if (!error) { onProfileSaved({ ...localProfile }); setSaved(true); setTimeout(() => setSaved(false), 3000); }
    setSaving(false);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
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

  return (
    <div style={{ padding: "clamp(16px,4vw,32px)", maxWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 28, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: "clamp(20px,4vw,26px)", fontWeight: 700, color: "#1a2332" }}>Profile</h1>
        <div style={{ marginLeft: "auto", padding: "6px 16px", borderRadius: 20, background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 13, fontWeight: 600 }}>
          {plan} Plan
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 24 }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #f1f5f9" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
            <div onClick={() => fileRef.current?.click()} style={{
              width: 64, height: 64, borderRadius: "50%", background: "#4C9FE8", cursor: "pointer",
              overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 24, fontWeight: 700, color: "#fff", flexShrink: 0, position: "relative"
            }}>
              {localProfile.avatar_url
                ? <img src={localProfile.avatar_url} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : (localProfile.full_name?.[0]?.toUpperCase() ?? "👤")}
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={handlePhotoUpload} style={{ display: "none" }} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#1a2332" }}>{localProfile.full_name || "Your Name"}</div>
              <button onClick={() => fileRef.current?.click()} style={{ fontSize: 12, color: "#3B82F6", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                {uploading ? "Uploading..." : "Change photo"}
              </button>
            </div>
          </div>
          <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, color: "#1a2332" }}>Account</h3>
          <ProfileField label="Full Name" value={localProfile.full_name} onChange={v => setLocalProfile(p => ({ ...p, full_name: v }))} />
          <ProfileField label="Email" value={userEmail} disabled />
          <ProfileField label="Company" value={localProfile.company} onChange={v => setLocalProfile(p => ({ ...p, company: v }))} />
          <h3 style={{ margin: "20px 0 16px", fontSize: 15, fontWeight: 600, color: "#1a2332" }}>Address</h3>
          <ProfileField label="Street Address" value={localProfile.street} onChange={v => setLocalProfile(p => ({ ...p, street: v }))} />
          <ProfileField label="City" value={localProfile.city} onChange={v => setLocalProfile(p => ({ ...p, city: v }))} />
          <ProfileField label="State" value={localProfile.state} onChange={v => setLocalProfile(p => ({ ...p, state: v }))} />
          <ProfileField label="ZIP Code" value={localProfile.zip} onChange={v => setLocalProfile(p => ({ ...p, zip: v }))} />
          <ProfileField label="Country" value={localProfile.country} onChange={v => setLocalProfile(p => ({ ...p, country: v }))} />
          <button onClick={handleSave} disabled={saving} style={{
            width: "100%", padding: "10px", borderRadius: 8, border: "none",
            background: saved ? "#4CAF7D" : "linear-gradient(135deg,#3B82F6,#06B6D4)",
            color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", marginTop: 8
          }}>
            {saving ? "Saving..." : saved ? "✓ Saved!" : "Save Changes"}
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #f1f5f9" }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, color: "#1a2332" }}>Plan</h3>
            {[{ name: "Free", price: "$0/mo", features: "3 rows, 10 metrics" }, { name: "Pro", price: "$29/mo", features: "Unlimited rows, integrations" }, { name: "Business", price: "$79/mo", features: "Team access, all apps" }].map(p => (
              <div key={p.name} onClick={() => setPlan(p.name)} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
                borderRadius: 10, marginBottom: 8, cursor: "pointer",
                background: plan === p.name ? "#EFF6FF" : "#F8FAFC",
                border: plan === p.name ? "1.5px solid #3B82F6" : "1.5px solid transparent"
              }}>
                <div style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid", borderColor: plan === p.name ? "#3B82F6" : "#d1d5db", background: plan === p.name ? "#3B82F6" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {plan === p.name && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#1a2332" }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>{p.features}</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#3B82F6" }}>{p.price}</div>
              </div>
            ))}
          </div>
          <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #f1f5f9" }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, color: "#1a2332" }}>Preferences</h3>
            {[
              { label: "Email notifications", sub: "Daily digest of key metrics", on: notif, set: setNotif },
              { label: "Dark mode", sub: "Switch to dark theme", on: darkMode, set: setDarkMode },
              { label: "Two-factor auth (coming soon)", sub: "Require 2FA on login", on: false, set: () => { } },
              {
                label: "Five-Account System", sub: "Enable Profit First method globally",
                on: localProfile.five_account_enabled,
                set: (v: boolean) => setLocalProfile(p => ({ ...p, five_account_enabled: v }))
              },
            ].map((item, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: i < 3 ? "1px solid #f1f5f9" : "none" }}>
                <div>
                  <div style={{ fontSize: 14, color: i === 2 ? "#94a3b8" : "#1a2332" }}>{item.label}</div>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>{item.sub}</div>
                </div>
                <Toggle on={item.on} onChange={item.set} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CHAT PANEL
// ═══════════════════════════════════════════════════════════════════════════

function ChatPanel({ sections, onClose }: { sections: Section[]; onClose: () => void }) {
  const channels = ["General", ...sections.map(s => s.title)];
  const [active, setActive] = useState("General");
  const sampleMsgs: Record<string, { name: string; time: string; text: string }[]> = {
    General: [{ name: "Julia", time: "14:27", text: "Sounds good @Bryan." }, { name: "Bryan", time: "14:23", text: "Thanks @Julia. When can you have it transferred over by?" }],
    Cashflow: [{ name: "Julia", time: "14:27", text: "Sounds good @Bryan." }, { name: "Bryan", time: "14:23", text: "Thanks @Julia. When can you have it transferred over by?" }],
    Sales: [{ name: "Julia", time: "15:53", text: "@Bryan, that's right. our sales are up by 20%, let's celebrate!" }, { name: "Bryan", time: "15:56", text: "@Julia, I'll go get the ice-cream cake!" }],
    Marketing: [{ name: "Julia", time: "14:20", text: "@Bryan. How come?" }, { name: "Bryan", time: "14:39", text: "@Julia, A couple of the Marketing Team members are sick so things are behind..." }],
  };
  const msgs = sampleMsgs[active] ?? sampleMsgs["General"];
  return (
    <div style={{
      position: "fixed", right: 0, top: 0, bottom: 0, width: "clamp(280px,30vw,360px)",
      background: "#fff", boxShadow: "-4px 0 32px rgba(0,0,0,0.12)", zIndex: 1500,
      display: "flex", flexDirection: "column"
    }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#1a2332" }}>Chat</div>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8" }}>×</button>
      </div>
      <div style={{ display: "flex", gap: 4, padding: "8px 12px", borderBottom: "1px solid #f1f5f9", overflowX: "auto" }}>
        {channels.map(ch => (
          <button key={ch} onClick={() => setActive(ch)} style={{
            padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 500, border: "none", cursor: "pointer", flexShrink: 0,
            background: active === ch ? "#3B82F6" : "#f1f5f9", color: active === ch ? "#fff" : "#64748b"
          }}>{ch}</button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "flex-start" }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#4C9FE8", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, color: "#fff" }}>
              {m.name[0]}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#1a2332", marginBottom: 2 }}>{m.name} <span style={{ color: "#94a3b8", fontWeight: 400 }}>{m.time}</span></div>
              <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.5 }}>{m.text}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ padding: "12px 16px", borderTop: "1px solid #f1f5f9" }}>
        <input placeholder="Type Response..." style={{ width: "100%", padding: "10px 16px", borderRadius: 99, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none", boxSizing: "border-box", background: "#f8fafc" }} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SIDEBAR
// ═══════════════════════════════════════════════════════════════════════════

const NAV = [
  { icon: "⊞", label: "Home", page: "home" as Page },
  { icon: "◎", label: "Goals", page: "goals" as Page },
  { icon: "✓", label: "Tasks", page: "tasks" as Page },
  { icon: "⛓", label: "Integrations", page: "integrations" as Page },
  { icon: "👥", label: "Team", page: "team" as Page },
  { icon: "⚙", label: "Settings", page: "settings" as Page },
];

function Sidebar({ active, onNav, onClose, isMobile, avatarUrl, firstName }: {
  active: Page; onNav: (p: Page) => void; onClose: () => void;
  isMobile: boolean; avatarUrl?: string; firstName?: string;
}) {
  return (
    <aside style={{
      width: 260, flexShrink: 0, background: "#fff",
      display: "flex", flexDirection: "column",
      boxShadow: "2px 0 12px rgba(0,0,0,0.08)",
      height: "100%", minHeight: "100vh",
      overflowY: "auto", overflowX: "hidden",
      scrollbarWidth: "none",
    } as React.CSSProperties}>
      <style>{`aside::-webkit-scrollbar{display:none} .nav-item:hover{background:#f1f5f9 !important}`}</style>

      <div style={{ padding: "28px 20px 20px", borderBottom: "1px solid #f1f5f9", display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", position: "relative", marginBottom: 12 }}>
          <div style={{ width: 60, height: 60, borderRadius: "50%", background: "#e2e8f0", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>
            {avatarUrl ? <img src={avatarUrl} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ color: "#94a3b8" }}>👤</span>}
          </div>
          {!isMobile && (
            <div onClick={onClose} style={{
              position: "absolute", right: 0, width: 28, height: 28, borderRadius: "50%",
              border: "1.5px solid #e2e8f0", background: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", color: "#94a3b8", fontSize: 16
            }}>‹</div>
          )}
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332", lineHeight: 1.3 }}>
            {firstName ? `Welcome ${firstName}` : "Welcome"}
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>to your dashboard</div>
        </div>
      </div>

      <nav style={{ flex: 1, padding: "12px 12px" }}>
        {NAV.map(item => (
          <div key={item.label} className="nav-item" onClick={() => onNav(item.page)} style={{
            display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
            borderRadius: 10, marginBottom: 2, cursor: "pointer",
            background: active === item.page ? "#EFF6FF" : "transparent",
            color: active === item.page ? "#3B82F6" : "#475569",
            fontSize: 13, fontWeight: active === item.page ? 600 : 400, transition: "background 0.15s"
          }}>
            <span style={{ fontSize: 15, flexShrink: 0 }}>{item.icon}</span>
            <span style={{ whiteSpace: "nowrap" }}>{item.label}</span>
          </div>
        ))}
      </nav>

      <div style={{ padding: "16px 20px", borderTop: "1px solid #f1f5f9", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <img src="https://dashello.co/wp-content/uploads/2023/08/Logo.png" alt="Dashello" style={{ height: 28, objectFit: "contain", maxWidth: "80%" }} />
        <button onClick={() => supabase.auth.signOut()} style={{
          width: "100%", padding: "8px 0", borderRadius: 8,
          border: "1.5px solid #e2e8f0", background: "transparent",
          color: "#94a3b8", fontSize: 12, fontWeight: 600, cursor: "pointer"
        }}>Sign Out</button>
      </div>
    </aside>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// HOME PAGE
// ═══════════════════════════════════════════════════════════════════════════

function HomePage({
  sections, setSections, onClickMetric
}: {
  sections: Section[];
  setSections: React.Dispatch<React.SetStateAction<Section[]>>;
  onClickMetric: (m: MetricModalData, metric: Metric) => void;
}) {
  const dragMetric = useRef<{ sid: string; mid: string } | null>(null);
  const dragSection = useRef<string | null>(null);
  const [dragOverMetric, setDragOverMetric] = useState<string | null>(null);
  const [dragOverSection, setDragOverSection] = useState<string | null>(null);
  const [showAddRow, setShowAddRow] = useState(false);

  const addSection = (name: string) => setSections(p => [...p, { id: crypto.randomUUID(), title: name, avatars: [], metrics: [] }]);
  const renameSection = (sid: string, name: string) => setSections(p => p.map(s => s.id === sid ? { ...s, title: name } : s));
  const removeSection = (sid: string) => setSections(p => p.filter(s => s.id !== sid));
  const addMetric = (sid: string, m: Omit<Metric, "id">) => setSections(p => p.map(s => s.id === sid ? { ...s, metrics: [...s.metrics, { ...m, id: crypto.randomUUID() }] } : s));
  const removeMetric = (sid: string, mid: string) => setSections(p => p.map(s => s.id === sid ? { ...s, metrics: s.metrics.filter(m => m.id !== mid) } : s));
  const updateMetric = (sid: string, mid: string, updated: Omit<Metric, "id">) => setSections(p => p.map(s => s.id === sid ? { ...s, metrics: s.metrics.map(m => m.id === mid ? { ...updated, id: mid } : m) } : s));

  const handleMetricDrop = useCallback((tSid: string, tMid: string) => {
    if (!dragMetric.current) return;
    const { sid: fSid, mid: fMid } = dragMetric.current;
    if (fSid === tSid && fMid === tMid) { dragMetric.current = null; return; }
    setSections(prev => {
      const moving = prev.find(s => s.id === fSid)!.metrics.find(m => m.id === fMid)!;
      const without = prev.map(s => s.id === fSid ? { ...s, metrics: s.metrics.filter(m => m.id !== fMid) } : s);
      return without.map(s => { if (s.id !== tSid) return s; const idx = s.metrics.findIndex(m => m.id === tMid); const ms = [...s.metrics]; ms.splice(idx, 0, moving); return { ...s, metrics: ms }; });
    });
    dragMetric.current = null; setDragOverMetric(null);
  }, [setSections]);

  const handleSectionDrop = useCallback((tSid: string) => {
    if (!dragSection.current || dragSection.current === tSid) return;
    const fSid = dragSection.current;
    setSections(prev => { const a = [...prev]; const fi = a.findIndex(s => s.id === fSid); const ti = a.findIndex(s => s.id === tSid); const [m] = a.splice(fi, 1); a.splice(ti, 0, m); return a; });
    dragSection.current = null; setDragOverSection(null);
  }, [setSections]);

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "clamp(16px,4vw,28px) clamp(16px,4vw,32px)" }}>
      {sections.map(s => (
        <DashSection key={s.id} section={s}
          onAddMetric={addMetric} onRemoveMetric={removeMetric} onUpdateMetric={updateMetric}
          onRenameSection={renameSection} onRemoveSection={removeSection}
          onClickMetric={onClickMetric}
          onMetricDragStart={(sid, mid) => { dragMetric.current = { sid, mid }; dragSection.current = null; }}
          onMetricDrop={handleMetricDrop} dragOverMetric={dragOverMetric}
          onSectionDragStart={() => { dragSection.current = s.id; dragMetric.current = null; }}
          onSectionDragOver={e => { e.preventDefault(); setDragOverSection(s.id); }}
          onSectionDrop={() => handleSectionDrop(s.id)}
          isSectionDragOver={dragOverSection === s.id} />
      ))}
      <div onClick={() => setShowAddRow(true)} style={{ display: "flex", alignItems: "center", gap: 10, color: "#94a3b8", fontSize: 14, cursor: "pointer", padding: "8px 0" }}>
        <div style={{ width: 28, height: 28, borderRadius: "50%", border: "1.5px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "#94a3b8" }}>+</div>
        New Row
      </div>
      {showAddRow && <EditAddRowModal onSave={addSection} onClose={() => setShowAddRow(false)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// APP ROOT
// ═══════════════════════════════════════════════════════════════════════════

export default function DashelloDashboard() {
  const [page, setPage] = useState<Page>("home");
  const [sections, setSections] = useState<Section[]>([]);
  const [activeModal, setActiveModal] = useState<{ data: MetricModalData; metric: Metric } | null>(null);
  const [editingMetricFromModal, setEditingMetricFromModal] = useState<Metric | null>(null);
  const [selectedApp, setSelectedApp] = useState<typeof APPS[0] | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showChat, setShowChat] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");
  const [dbReady, setDbReady] = useState(false);
  const [profile, setProfile] = useState({
    full_name: "", company: "", street: "", city: "",
    state: "", zip: "", country: "", avatar_url: "",
    five_account_enabled: false,
  });

  const [tasksData, setTasksData] = useState([
    { id: "1", text: "Review Q3 financials", done: false, assignee: "AJ", due: "Mar 15" },
    { id: "2", text: "Follow up with 5 leads", done: true, assignee: "BK", due: "Mar 12" },
    { id: "3", text: "Update marketing report", done: false, assignee: "CL", due: "Mar 18" },
    { id: "4", text: "Team standup notes", done: true, assignee: "AJ", due: "Mar 11" },
    { id: "5", text: "Invoice client #4821", done: false, assignee: "DM", due: "Mar 20" },
    { id: "6", text: "Send 34 quotes", done: false, assignee: "BK", due: "Mar 22" },
    { id: "7", text: "Add $9,756 to Tax account", done: false, assignee: "AJ", due: "Mar 14" },
  ]);

  const [goalsData, setGoalsData] = useState([
    {
      label: "Increase Sales by 25%", current: "$235,000", target: "$1,200,000", pct: 20, due: "May 26th",
      projections: [{ label: "Projected Sales This Month", value: "<27" }, { label: "Projected Income From Sales", value: "<$10,000" }, { label: "Projected New Customers", value: "<250" }],
      metrics: [{ label: "Leads", value: "12", color: "red" }, { label: "Emails Opened", value: "789", color: "green" }, { label: "Invoices In Progress", value: "$10,050.76", color: "gray" }]
    },
    {
      label: "Fully Fund Business Emergency - $200k", current: "$70,000", target: "$200,000", pct: 35, due: "Dec 17th",
      projections: [{ label: "Projected Funded Date", value: "Mar. 17/25" }, { label: "Projected Monthly Save", value: "$20,000" }],
      metrics: [{ label: "Overhead", value: "$79,941", color: "green" }, { label: "Profit", value: "$235K", color: "yellow" }, { label: "Tax", value: "$23,750", color: "gray" }]
    },
    {
      label: "500 New Sign Ups Per Month", current: "125", target: "500", pct: 25, due: "30th",
      projections: [{ label: "Projected New Sign Ups", value: "350" }, { label: "Projected Click Conversion", value: "4.2%" }],
      metrics: [{ label: "Website", value: "67%", color: "green" }]
    },
  ]);

  // Inject Elegant Icon Font CSS
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = ELEGANT_FONT_CSS;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  // Auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) { setUserId(session.user.id); setUserEmail(session.user.email ?? ""); }
    });
  }, []);

  // Load data
  useEffect(() => {
    if (!userId) return;
    async function load() {
      const [savedSections, savedTasks, savedGoals] = await Promise.all([
        loadUserData("sections", userId!),
        loadUserData("tasks", userId!),
        loadUserData("goals", userId!),
      ]);
      if (savedSections) setSections(savedSections);
      if (savedTasks) setTasksData(savedTasks);
      if (savedGoals) setGoalsData(savedGoals);

      const { data: prof } = await supabase.from("profiles").select("*").eq("id", userId!).maybeSingle();
      if (prof) setProfile({
        full_name: prof.full_name ?? "", company: prof.company ?? "",
        street: prof.street ?? "", city: prof.city ?? "", state: prof.state ?? "",
        zip: prof.zip ?? "", country: prof.country ?? "", avatar_url: prof.avatar_url ?? "",
        five_account_enabled: prof.five_account_enabled ?? false,
      });
      setDbReady(true);
    }
    load();
  }, [userId]);

  // Auto-save
  useEffect(() => { if (userId && dbReady) saveUserData("sections", userId, sections); }, [sections, userId, dbReady]);
  useEffect(() => { if (userId && dbReady) saveUserData("tasks", userId, tasksData); }, [tasksData, userId, dbReady]);
  useEffect(() => { if (userId && dbReady) saveUserData("goals", userId, goalsData); }, [goalsData, userId, dbReady]);

  // Mobile detection
  useEffect(() => {
    const check = () => { const m = window.innerWidth < 768; setIsMobile(m); if (!m) setSidebarOpen(true); };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // When a metric value is changed in the detail modal, update sections
  const handleValueChange = (newValue: string) => {
    if (!activeModal) return;
    const metricId = activeModal.metric.id;
    const timestamp = Date.now();
    const numericVal = parseFloat(newValue.replace(/[^0-9.\-]/g, ""));

    setSections(prev => prev.map(s => ({
      ...s,
      metrics: s.metrics.map(m => {
        if (m.id !== metricId) return m;
        const newPoint: DataPoint = { timestamp, value: isNaN(numericVal) ? 0 : numericVal };
        const history = [...(m.history ?? []), newPoint].slice(-50); // keep last 50
        return { ...m, value: newValue, history };
      })
    })));

    // Also update the active modal's data
    setActiveModal(prev => prev ? {
      ...prev,
      metric: { ...prev.metric, value: newValue },
      data: { ...prev.data, mainValue: newValue }
    } : null);
  };

  const handleClickMetric = (data: MetricModalData, metric: Metric) => {
    setActiveModal({ data, metric });
  };

  const handleEditFromModal = () => {
    if (activeModal) {
      setEditingMetricFromModal(activeModal.metric);
      setActiveModal(null);
    }
  };

  const handleNav = (p: Page) => { setPage(p); setSelectedApp(null); if (isMobile) setSidebarOpen(false); };

  const sidebarEl = (
    <Sidebar active={page} onNav={handleNav} onClose={() => setSidebarOpen(false)}
      isMobile={isMobile} avatarUrl={profile.avatar_url} firstName={profile.full_name?.split(" ")[0] ?? ""} />
  );

  if (!dbReady) return (
    <div style={{
      display: "flex", height: "100vh", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(160deg,#2196F3 0%,#00BCD4 100%)", fontSize: 18, color: "#fff",
      fontFamily: "Inter, sans-serif"
    }}>
      Loading your dashboard...
    </div>
  );

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "'Inter',system-ui,sans-serif", background: "#F8FAFC", position: "relative" }}>

      {isMobile && sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 900 }} />
      )}

      {sidebarOpen && (
        isMobile ? (
          <div style={{ position: "fixed", left: 0, top: 0, bottom: 0, width: 260, zIndex: 1000 }}>
            {sidebarEl}
            <div onClick={() => setSidebarOpen(false)} style={{
              position: "absolute", top: 16, right: -48, width: 36, height: 36, borderRadius: "50%",
              background: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", fontSize: 20, color: "#475569", zIndex: 1001
            }}>×</div>
          </div>
        ) : sidebarEl
      )}

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* Top bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px clamp(12px,3vw,28px)", borderBottom: "1px solid #E8EDF2", background: "#fff", flexShrink: 0, flexWrap: "wrap" }}>
          {!sidebarOpen && (
            <div onClick={() => setSidebarOpen(true)} style={{ width: 36, height: 36, borderRadius: "50%", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", marginRight: 4, flexShrink: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {[0, 1, 2].map(i => <div key={i} style={{ width: 16, height: 2, background: "#475569", borderRadius: 2 }} />)}
              </div>
            </div>
          )}
          {page === "home" && (
            <div style={{ display: "flex", borderRadius: 8, border: "1px solid #e2e8f0", overflow: "hidden" }}>
              {["Row", "Column"].map((lbl, i) => (
                <div key={lbl} style={{ padding: "6px 14px", fontSize: 13, fontWeight: 500, cursor: "pointer", background: i === 0 ? "#3B82F6" : "#fff", color: i === 0 ? "#fff" : "#94a3b8" }}>{lbl}</div>
              ))}
            </div>
          )}
          <div style={{ flex: 1 }} />
          <div onClick={() => setShowChat(v => !v)} style={{ padding: "7px 18px", borderRadius: 20, border: "1px solid #e2e8f0", fontSize: 13, color: "#64748b", cursor: "pointer", background: showChat ? "#EFF6FF" : "#fff" }}>Chat</div>
          <div style={{ padding: "8px clamp(12px,2vw,22px)", borderRadius: 8, background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Customize</div>
        </div>

        {/* Page content */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {page === "home" && <HomePage sections={sections} setSections={setSections} onClickMetric={handleClickMetric} />}
          {page === "goals" && <div style={{ flex: 1, overflowY: "auto" }}><GoalsPage goals={goalsData} setGoals={setGoalsData} /></div>}
          {page === "tasks" && <div style={{ flex: 1, overflowY: "auto" }}><TasksPage tasks={tasksData} setTasks={setTasksData} /></div>}
          {page === "integrations" && <div style={{ flex: 1, overflowY: "auto" }}><IntegrationsPage onSelectApp={a => { setSelectedApp(a); setPage("app-detail"); }} /></div>}
          {page === "app-detail" && selectedApp && <div style={{ flex: 1, overflowY: "auto" }}><AppDetailPage app={selectedApp} onBack={() => setPage("integrations")} /></div>}
          {page === "team" && <div style={{ flex: 1, overflowY: "auto" }}><TeamPage /></div>}
          {page === "settings" && <div style={{ flex: 1, overflowY: "auto" }}><SettingsPage userId={userId!} userEmail={userEmail} onProfileSaved={p => setProfile(p)} /></div>}
        </div>
      </div>

      {showChat && <ChatPanel sections={sections} onClose={() => setShowChat(false)} />}

      {/* Metric detail modal */}
      {activeModal && (
        <MetricModal
          data={activeModal.data}
          metric={activeModal.metric}
          onClose={() => setActiveModal(null)}
          onEdit={handleEditFromModal}
          onValueChange={handleValueChange}
        />
      )}

      {/* Edit settings from modal — find the actual metric in sections to pass as initial */}
      {editingMetricFromModal && (() => {
        let foundSection: string | undefined;
        for (const s of sections) {
          if (s.metrics.find(m => m.id === editingMetricFromModal.id)) { foundSection = s.id; break; }
        }
        return (
          <MetricBoxSettingsModal
            initial={editingMetricFromModal}
            onSave={updated => {
              if (foundSection) {
                setSections(prev => prev.map(s => s.id === foundSection
                  ? { ...s, metrics: s.metrics.map(m => m.id === editingMetricFromModal.id ? { ...updated, id: m.id, history: m.history ?? [] } : m) }
                  : s));
              }
              setEditingMetricFromModal(null);
            }}
            onDelete={() => {
              if (foundSection) setSections(prev => prev.map(s => s.id === foundSection ? { ...s, metrics: s.metrics.filter(m => m.id !== editingMetricFromModal.id) } : s));
              setEditingMetricFromModal(null);
            }}
            onClose={() => setEditingMetricFromModal(null)}
          />
        );
      })()}
    </div>
  );
}
