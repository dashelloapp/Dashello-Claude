import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "./lib/supabase";
import * as PhosphorReact from "@phosphor-icons/react";

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
type RuleOp = ">=" | "<=" | ">" | "<" | "between" | "==" | "!=";

interface ColorRule {
  id: string;
  color: "red" | "yellow" | "green";
  op: RuleOp;
  value: number;
  value2?: number;
}

interface DataPoint { timestamp: number; value: number; }
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
  history?: DataPoint[];
  fiveAccountParentId?: string; // set on child boxes created by five-account
  currencySymbol?: string;
}
interface Section { id: string; title: string; avatars: string[]; metrics: Metric[]; }

// ─── Traffic light ──────────────────────────────────────────────────────────
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
    if (rule.op === "==" && num === rule.value) match = true;
    if (rule.op === "!=" && num !== rule.value) match = true;
    if (rule.op === "between" && rule.value2 != null && num >= rule.value && num <= rule.value2) match = true;
    if (match) return rule.color;
  }
  return "gray";
}
function getColorForValue(val: number, rules: ColorRule[]): MetricColor {
  if (!rules || rules.length === 0) return "gray";
  for (const rule of rules) {
    let match = false;
    if (rule.op === ">=" && val >= rule.value) match = true;
    if (rule.op === "<=" && val <= rule.value) match = true;
    if (rule.op === ">" && val > rule.value) match = true;
    if (rule.op === "<" && val < rule.value) match = true;
    if (rule.op === "==" && val === rule.value) match = true;
    if (rule.op === "!=" && val !== rule.value) match = true;
    if (rule.op === "between" && rule.value2 != null && val >= rule.value && val <= rule.value2) match = true;
    if (match) return rule.color;
  }
  return "gray";
}
// ─── Health score calculation ──────────────────────────────────────────────
type HealthResult = {
  score: number;
  barColor: "green" | "yellow" | "red";
  hasData: boolean;
  counts: { green: number; yellow: number; red: number; gray: number };
};

function calculateHealth(
  sections: Section[],
  greenMult: number,
  yellowMult: number,
  redMult: number
): HealthResult {
  // Only boxes WITH color rules count toward health
  const rulesBoxes = sections
    .flatMap(s => s.metrics)
    .filter(m => Array.isArray(m.colorRules) && m.colorRules.length > 0);

  const N = rulesBoxes.length;
  const counts = { green: 0, yellow: 0, red: 0, gray: 0 };

  if (N === 0) {
    return { score: 0, barColor: "green", hasData: false, counts };
  }

  const baseWeight = 100 / N;
  let total = 0;

  for (const metric of rulesBoxes) {
    const color = resolveColor(metric);
    counts[color]++;
    if (color === "green") total += baseWeight * greenMult;
    else if (color === "yellow") total += baseWeight * yellowMult;
    else if (color === "red") total += baseWeight * redMult;
    // gray (rule didn't match) contributes 0
  }

  const score = Math.max(0, Math.min(100, Math.round(total)));

  // Bar color: any red → red; else any yellow → yellow; else green
  let barColor: "green" | "yellow" | "red";
  if (counts.red > 0) barColor = "red";
  else if (counts.yellow > 0) barColor = "yellow";
  else barColor = "green";

  return { score, barColor, hasData: true, counts };
}

// ─── Value formatting ──────────────────────────────────────────────────────
function formatValue(raw: string, mt: MetricType, currency = "$"): string {
  const stripped = raw.replace(/[^0-9.]/g, "");
  const num = parseFloat(stripped);
  if (isNaN(num)) return raw;
  if (mt === "financial") {
    return `${currency}${num.toLocaleString("en-US", { minimumFractionDigits: stripped.includes(".") ? 2 : 0, maximumFractionDigits: 2 })}`;
  }
  if (mt === "percentage") {
    return `${stripped}%`;
  }
  return stripped; // counter — plain number
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const MS: Record<MetricColor, { bg: string; text: string }> = {
  green:  { bg: "#4CAF7D", text: "#fff" },
  yellow: { bg: "#F5A623", text: "#fff" },
  red:    { bg: "#E85D75", text: "#fff" },
  gray:   { bg: "#E8EDF2", text: "#4A5568" },
};

const FIVE_DESC: Record<string, string> = {
  overhead:    "2 months of operating expenses. Everything above this flows to Profit.",
  profit:      "Builds to a 6-month emergency fund. Surplus splits 50/50 to Tax & Investments.",
  tax:         "50% of surplus Profit allocation. Set aside for taxes.",
  investments: "50% of surplus Profit allocation. Long-term growth fund.",
  owner:       "Your salary — paid from Overhead as a fixed operating expense.",
};

const FIVE_ACCOUNT_LABELS = ["Overhead", "Profit", "Tax", "Investments", "Owner"] as const;
const FIVE_ACCOUNT_ICONS: Record<string, string> = {
  Overhead: "CreditCard", Profit: "TrendUp", Tax: "Receipt",
  Investments: "Wallet", Owner: "UserCircle",
};

const WORLD_CURRENCIES = [
  { symbol: "$", name: "US Dollar" }, { symbol: "€", name: "Euro" },
  { symbol: "£", name: "British Pound" }, { symbol: "¥", name: "Japanese Yen" },
  { symbol: "₹", name: "Indian Rupee" }, { symbol: "C$", name: "Canadian Dollar" },
  { symbol: "A$", name: "Australian Dollar" }, { symbol: "CHF", name: "Swiss Franc" },
  { symbol: "₩", name: "Korean Won" }, { symbol: "R$", name: "Brazilian Real" },
  { symbol: "MX$", name: "Mexican Peso" }, { symbol: "S$", name: "Singapore Dollar" },
  { symbol: "HK$", name: "Hong Kong Dollar" }, { symbol: "kr", name: "Swedish Krona" },
  { symbol: "NOK", name: "Norwegian Krone" }, { symbol: "DKK", name: "Danish Krone" },
  { symbol: "PLN", name: "Polish Zloty" }, { symbol: "CZK", name: "Czech Koruna" },
  { symbol: "₺", name: "Turkish Lira" }, { symbol: "₽", name: "Russian Ruble" },
  { symbol: "R", name: "South African Rand" }, { symbol: "AED", name: "UAE Dirham" },
  { symbol: "SAR", name: "Saudi Riyal" }, { symbol: "฿", name: "Thai Baht" },
  { symbol: "₫", name: "Vietnamese Dong" }, { symbol: "₦", name: "Nigerian Naira" },
  { symbol: "KES", name: "Kenyan Shilling" }, { symbol: "EGP", name: "Egyptian Pound" },
  { symbol: "ARS", name: "Argentine Peso" }, { symbol: "CLP", name: "Chilean Peso" },
];

// ═══════════════════════════════════════════════════════════════════════════
// PHOSPHOR ICONS
// ═══════════════════════════════════════════════════════════════════════════

const ICON_NONE = "";

const PHOSPHOR_CATEGORIES: { label: string; icons: string[] }[] = [
  {
    label: "Finance",
    icons: [
      "CreditCard","Wallet","Money","Coins","Bank","Receipt","Invoice","Cardholder",
      "CurrencyDollar","CurrencyEur","CurrencyGbp","CurrencyJpy","CurrencyKrw","CurrencyInr","CurrencyBtc",
      "PiggyBank","Vault","HandCoins","HandDeposit","HandWithdraw",
      "TrendUp","TrendDown","ChartLine","ChartBar","ChartPie","ChartDonut","Percent",
      "Calculator","Briefcase","Buildings","ShoppingCart","ShoppingBag","Storefront","Tag","Barcode",
    ]
  },
  {
    label: "Business",
    icons: [
      "Handshake","UsersThree","UserCircle","IdentificationCard","Suitcase","SuitcaseRolling",
      "Target","Trophy","Medal","MedalMilitary","Star","StarFour","Crown","CrownSimple","Rocket","Lightbulb",
      "Clipboard","ClipboardText","Files","FolderOpen","Folder","Archive","Bookmarks","BookmarkSimple",
      "Table","Rows","Columns","SquaresFour","GridFour","ListBullets","ListChecks","ListNumbers",
      "Notebook","Notepad","FileText","FilePdf","FileDoc","FileXls",
    ]
  },
  {
    label: "Communication",
    icons: [
      "Envelope","EnvelopeOpen","EnvelopeSimple","Phone","PhoneCall","PhoneIncoming","PhoneOutgoing",
      "ChatCircle","ChatCircleDots","ChatText","ChatTeardrop","Chats","ChatsCircle",
      "Megaphone","MegaphoneSimple","Bell","BellRinging","BellSimple","Broadcast","Rss","Share","ShareNetwork",
      "PaperPlaneTilt","At","Hash","Link","LinkSimple","Globe","GlobeHemisphereWest","GlobeHemisphereEast",
    ]
  },
  {
    label: "Analytics",
    icons: [
      "ChartLineUp","ChartLineDown","ChartDonut","ChartBarHorizontal","ChartScatter","ChartPolar",
      "ArrowUp","ArrowDown","ArrowRight","ArrowLeft","ArrowUUpRight","ArrowUUpLeft","ArrowsOut","ArrowsIn",
      "ArrowsClockwise","ArrowsCounterClockwise","ArrowsLeftRight","ArrowsDownUp","Pulse","Activity",
      "Database","HardDrive","HardDrives","Cloud","CloudArrowUp","CloudArrowDown","CloudCheck","CloudX",
      "MagnifyingGlass","MagnifyingGlassPlus","MagnifyingGlassMinus","Funnel","FunnelSimple","SortAscending","SortDescending",
    ]
  },
  {
    label: "Status",
    icons: [
      "CheckCircle","XCircle","WarningCircle","Warning","Info","Question",
      "Check","CheckFat","CheckSquare","X","XSquare","Plus","PlusCircle","Minus","MinusCircle",
      "Lock","LockOpen","LockKey","Key","KeyReturn","Shield","ShieldCheck","ShieldWarning",
      "Fire","FireSimple","Snowflake","Lightning","LightningSlash","Timer","Clock","ClockCountdown","Calendar","CalendarBlank","CalendarCheck","Alarm",
    ]
  },
  {
    label: "People",
    icons: [
      "User","UserPlus","UserMinus","UserCheck","UserCircle","UserCirclePlus","UserCircleMinus","UserList","UserFocus",
      "Users","UsersFour","UsersThree","PersonSimple","PersonSimpleRun","PersonSimpleWalk","PersonArmsSpread",
      "Smiley","SmileyMeh","SmileySad","SmileyWink","SmileyAngry","SmileyNervous","SmileyXEyes",
      "Heart","HeartStraight","HandHeart","Heartbeat","FirstAid","FirstAidKit","Stethoscope","Pill",
      "Student","GraduationCap","Certificate","Scales","Gavel",
    ]
  },
  {
    label: "Tools",
    icons: [
      "Gear","GearSix","GearFine","Wrench","Hammer","Screwdriver","Nut","Toolbox",
      "Code","CodeSimple","CodeBlock","Terminal","TerminalWindow","Desktop","Laptop","DeviceMobile","DeviceTablet","Monitor","Printer",
      "Camera","CameraPlus","Image","ImageSquare","ImagesSquare","PencilSimple","PencilLine","Pen","PenNib","Eraser","Trash","TrashSimple","Copy","CopySimple",
      "MagicWand","PaintBrush","PaintBrushBroad","PaintBucket","Palette","Eyedropper",
    ]
  },
  {
    label: "Nature",
    icons: [
      "Sun","SunDim","SunHorizon","Moon","MoonStars","CloudSun","CloudMoon","CloudRain","CloudSnow","CloudLightning","CloudFog","Rainbow","RainbowCloud",
      "Tree","TreePalm","TreeEvergreen","Plant","Flower","FlowerLotus","FlowerTulip","Leaf","Cactus","Mountains","Waves","Drop","DropHalf","Fish","Bird","Butterfly","Dog","Cat","Cow","Horse","Rabbit",
    ]
  },
  {
    label: "Transit",
    icons: [
      "Car","CarSimple","CarProfile","Taxi","Truck","Van","Motorcycle","Bicycle","Scooter",
      "Bus","Train","TrainSimple","TrainRegional","Tram","Airplane","AirplaneTakeoff","AirplaneLanding","Helicopter","Boat","Sailboat","RocketLaunch",
      "MapPin","MapTrifold","Navigation","NavigationArrow","Compass","Path","Road","RoadHorizon","TrafficCone","TrafficSign","TrafficSignal",
    ]
  },
];

const ALL_PHOSPHOR_ICONS = PHOSPHOR_CATEGORIES.flatMap(c => c.icons);

// Renders any Phosphor icon by name from the official @phosphor-icons/react package.
// Falls back to a circle if the name doesn't match a known icon.
function IconGlyph({ name, size = 20, color = "#3B82F6", weight = "regular" }: {
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

// ═══════════════════════════════════════════════════════════════════════════
// MODAL DATA
// ═══════════════════════════════════════════════════════════════════════════

function makeModal(label: string, value: string, color: MetricColor, extra?: Partial<MetricModalData>): MetricModalData {
  return {
    type: "generic", title: label, color, healthPct: null, mainValue: value, syncTime: "10:23AM",
    stats: [{ label: "Value", value }],
    projections: [], suggestions: [], nextActions: [{ avatar: "AJ" }, { avatar: "BK" }], ...extra
  };
}

function makeFiveAccountMetric(accountType: "overhead" | "profit" | "tax" | "investments" | "owner", parentId: string): Omit<Metric, "id"> {
  const label = accountType.charAt(0).toUpperCase() + accountType.slice(1);
  const modal = makeModal(label, "$0.00", "gray", {
    type: "cashflow", fiveAccountEnabled: true, accountType,
    stats: [{ label: "Balance", value: "$0.00", synced: true }],
    transactions: [], projections: [], suggestions: [], nextActions: [],
  });
  return {
    label, value: "$0.00",
    icon: FIVE_ACCOUNT_ICONS[label] ?? "Wallet",
    color: "gray", modal, metricType: "financial", graphType: "linear",
    colorRules: [], connectedApps: [], history: [],
    fiveAccountParentId: parentId,
  };
}

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

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
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

function SectionCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#F8FAFC", borderRadius: 16, padding: 20, display: "flex", flexDirection: "column" }}>
      {title && <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2332", marginBottom: 16 }}>{title}</div>}
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ICON PICKER
// ═══════════════════════════════════════════════════════════════════════════

function IconPicker({ selected, onSelect }: { selected: string; onSelect: (icon: string) => void }) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState(0);

  const displayIcons = search.trim()
    ? ALL_PHOSPHOR_ICONS.filter(i => i.toLowerCase().includes(search.toLowerCase()))
    : PHOSPHOR_CATEGORIES[activeCategory]?.icons ?? [];

  return (
    <div>
      <div onClick={() => onSelect(ICON_NONE)} style={{
        display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px",
        borderRadius: 6, cursor: "pointer", marginBottom: 8,
        background: selected === ICON_NONE ? "#EFF6FF" : "#F8FAFC",
        border: selected === ICON_NONE ? "1.5px solid #3B82F6" : "1.5px solid #e2e8f0",
        fontSize: 12, color: "#64748b"
      }}>No icon</div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search icons..."
        style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none", marginBottom: 8, boxSizing: "border-box" }} />

      {!search && (
        <div style={{ display: "flex", gap: 4, overflowX: "auto", marginBottom: 8, paddingBottom: 2 }}>
          {PHOSPHOR_CATEGORIES.map((cat, i) => (
            <button key={i} onClick={() => setActiveCategory(i)} style={{
              padding: "3px 8px", borderRadius: 20, border: "none", cursor: "pointer", flexShrink: 0,
              background: activeCategory === i ? "#3B82F6" : "#f1f5f9",
              color: activeCategory === i ? "#fff" : "#64748b", fontSize: 10, fontWeight: 500
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
        <div style={{ marginTop: 6, fontSize: 12, color: "#64748b", display: "flex", alignItems: "center", gap: 6 }}>
          Selected: <IconGlyph name={selected} size={14} color="#3B82F6" />
          <span style={{ color: "#94a3b8" }}>{selected}</span>
        </div>
      )}
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
              <td style={{ ...td, textAlign: "right", color: "#94a3b8" }}>—</td>
            </tr>)}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// BOTTOM THREE CARDS
// ═══════════════════════════════════════════════════════════════════════════

function BottomThreeCards({ data }: { data: MetricModalData }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16 }}>
      <SectionCard>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#1a2332", marginBottom: 8 }}>Projections</div>
        <div style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic", marginBottom: 10 }}>Coming Soon</div>
        {[1, 2, 3].map(i => <div key={i} style={{ height: 8, borderRadius: 99, background: "#e2e8f0", marginBottom: 8, width: `${70 - i * 10}%`, opacity: 0.4 }} />)}
      </SectionCard>
      <SectionCard>
        <div style={{ display: "inline-block", background: "#3B82F6", color: "#fff", borderRadius: 99, padding: "5px 14px", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Suggestions</div>
        <div style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic", marginBottom: 10 }}>Coming Soon</div>
        {[1, 2, 3].map(i => <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, opacity: 0.4 }}>
          <div style={{ width: 20, height: 20, borderRadius: "50%", border: "1.5px solid #d1d5db", flexShrink: 0 }} />
          <div style={{ height: 7, borderRadius: 99, background: "#e2e8f0", flex: 1 }} />
        </div>)}
      </SectionCard>
      <SectionCard>
        <div style={{ display: "inline-block", background: "#3B82F6", color: "#fff", borderRadius: 99, padding: "5px 14px", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Next Actions</div>
        {data.nextActions.map((a, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div style={{ width: 20, height: 20, borderRadius: "50%", border: "1.5px solid #4CAF7D", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#4CAF7D" }}>✓</div>
            {a.label ? <span style={{ fontSize: 13, color: "#1a2332", flex: 1 }}>{a.label}</span> : <div style={{ flex: 1, height: 7, borderRadius: 99, background: "#e2e8f0" }} />}
            <Av initials={a.avatar} />
          </div>
        ))}
        {data.nextActions.length === 0 && <div style={{ fontSize: 12, color: "#cbd5e1", fontStyle: "italic" }}>No actions yet</div>}
      </SectionCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CHART
// ═══════════════════════════════════════════════════════════════════════════

function MetricChart({ history, rules, graphType, currentValue }: {
  history: DataPoint[]; rules: ColorRule[]; graphType: GraphType; currentValue: string;
}) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; val: number; color: MetricColor } | null>(null);

  // Insufficient data state — need at least 5 historic data points
  if (!history || history.length < 5) {
    const needed = 5 - (history?.length ?? 0);
    return (
      <div style={{
        height: 150, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        background: "#F8FAFC", border: "1.5px dashed #e2e8f0", borderRadius: 10, padding: 12, gap: 6
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>Insufficient Data</div>
        <div style={{ fontSize: 11, color: "#cbd5e1", textAlign: "center", lineHeight: 1.4 }}>
          {needed} more data point{needed === 1 ? "" : "s"} needed<br/>
          <span style={{ fontSize: 10 }}>({history?.length ?? 0} of 5 recorded)</span>
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
  const colorOf = (v: number) => MS[getColorForValue(v, rules)].bg;

  if (graphType === "pie") {
    const counts: Record<MetricColor, number> = { red: 0, yellow: 0, green: 0, gray: 0 };
    points.forEach(p => counts[getColorForValue(p.value, rules)]++);
    const total = points.length;
    const slices = (["green", "yellow", "red", "gray"] as MetricColor[])
      .map(c => ({ color: c, pct: counts[c] / total })).filter(s => s.pct > 0);
    const cx = 70, cy = 70, r = 55;
    let angle = -Math.PI / 2;
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

// ═══════════════════════════════════════════════════════════════════════════
// METRIC DETAIL MODAL
// ═══════════════════════════════════════════════════════════════════════════

function MetricModal({ data, metric, onClose, onEdit, onValueChange }: {
  data: MetricModalData; metric?: Metric;
  onClose: () => void; onEdit?: () => void; onValueChange?: (v: string) => void;
}) {
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
  const isCash = !!(data.fiveAccountEnabled && data.accountType);
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
      padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer"
    }}>Edit Settings</button>
  );

  const statTextColor = isColored ? "rgba(255,255,255,0.82)" : "#64748b";
  const statValColor = isColored ? "#fff" : "#1a2332";

  // ── CASHFLOW ─────────────────────────────────────────────────────────────
  if (isCash) return (
    <div ref={overlayRef} onClick={e => { if (e.target === overlayRef.current) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 24, width: "100%", maxWidth: 900, maxHeight: "92vh", overflowY: "auto", padding: "28px 32px 32px", boxShadow: "0 32px 80px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#1a2332" }}>{data.title}</h2>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}><EditBtn /><CloseBtn /></div>
        </div>
        {data.accountType && (
          <div style={{ background: "linear-gradient(135deg,#EEF9F4,#E8F4FD)", border: "1px solid #c3e6d4", borderRadius: 12, padding: "10px 14px", marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#0F6E56", marginBottom: 2 }}>Five-Account System — {data.accountType}</div>
            <p style={{ margin: 0, fontSize: 11, color: "#1e6b4e" }}>{FIVE_DESC[data.accountType]}</p>
          </div>
        )}
        {data.healthPct != null
          ? <><div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332", marginBottom: 6 }}>Health — <strong>{data.healthPct}%</strong></div>
            <div style={{ height: 28, borderRadius: 99, background: "#e5e7eb", maxWidth: 260, overflow: "hidden", marginBottom: 20 }}>
              <div style={{ width: `${data.healthPct}%`, height: "100%", borderRadius: 99, background: accent }} /></div></>
          : <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332", marginBottom: 6 }}>Health — N/A</div>
            <button style={{ padding: "6px 18px", borderRadius: 99, border: "1.5px solid #d1d5db", background: "#fff", fontSize: 12, cursor: "pointer" }}>Set A Goal</button>
          </div>}
        <div style={{ marginBottom: 24 }}>
          <div style={{ background: accent, borderRadius: "12px 12px 0 0", padding: "18px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                {data.stats.map((s, i) => (
                  <div key={i} style={{ marginBottom: i < data.stats.length - 1 ? 10 : 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12, color: statTextColor }}>{s.label}</span>
                      {s.synced && <span style={{ fontSize: 10, color: isColored ? "rgba(255,255,255,0.5)" : "#94a3b8" }}>Synced {data.syncTime}</span>}
                    </div>
                    <div style={{ fontSize: i === 0 ? 20 : 16, fontWeight: 700, color: statValColor }}>{s.value}</div>
                  </div>
                ))}
              </div>
              <button style={{ background: "#fff", border: "none", borderRadius: 20, padding: "5px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600, flexShrink: 0, marginLeft: 14, color: "#1a2332" }}>Filter</button>
            </div>
          </div>
          <TxnTable transactions={data.transactions ?? []} />
        </div>
        <BottomThreeCards data={data} />
      </div>
    </div>
  );

  // ── COUNTER ───────────────────────────────────────────────────────────────
  if (isCounter) return (
    <div ref={overlayRef} onClick={e => { if (e.target === overlayRef.current) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 24, width: "100%", maxWidth: 780, maxHeight: "92vh", overflowY: "auto", padding: "28px 32px 32px", boxShadow: "0 32px 80px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div style={{ flex: 1 }} />
          <h2 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#1a2332" }}>{data.title}</h2>
          <div style={{ flex: 1, display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center" }}><EditBtn /><CloseBtn /></div>
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
        <p style={{ textAlign: "center", fontSize: 13, marginBottom: 24, color: "#64748b" }}>Health Goal — <strong style={{ color: "#1a2332" }}>{data.healthPct ?? "N/A"}{data.healthPct != null ? "%" : ""}</strong></p>
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
          <span style={{ fontSize: 12, fontStyle: "italic", color: "#94a3b8" }}>Synced from {data.syncTime}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
          <SectionCard>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332", marginBottom: 10 }}>Details</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px" }}>
              {data.stats.map((s, i) => <div key={i}>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>{s.label}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#1a2332" }}>{s.value}</div>
              </div>)}
            </div>
          </SectionCard>
          <SectionCard>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332", marginBottom: 6 }}>History</div>
            <MetricChart history={history} rules={colorRules} graphType={graphType} currentValue={localValue} />
          </SectionCard>
        </div>
        <BottomThreeCards data={data} />
      </div>
    </div>
  );

  // ── FINANCIAL / PERCENTAGE / GENERIC ──────────────────────────────────────
  return (
    <div ref={overlayRef} onClick={e => { if (e.target === overlayRef.current) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 24, width: "100%", maxWidth: 900, maxHeight: "92vh", overflowY: "auto", padding: "28px 32px 32px", boxShadow: "0 32px 80px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#1a2332" }}>{data.title}</h2>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}><EditBtn /><CloseBtn /></div>
        </div>
        {data.healthPct != null
          ? <><div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332", marginBottom: 6 }}>Health — <strong>{data.healthPct}%</strong></div>
            <div style={{ height: 28, borderRadius: 99, background: "#e5e7eb", maxWidth: 260, overflow: "hidden", marginBottom: 20 }}>
              <div style={{ width: `${data.healthPct}%`, height: "100%", borderRadius: 99, background: accent }} /></div></>
          : <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332", marginBottom: 6 }}>Health — N/A</div>
            <button style={{ padding: "6px 18px", borderRadius: 99, border: "1.5px solid #d1d5db", background: "#fff", fontSize: 12, cursor: "pointer" }}>Set A Goal</button>
          </div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 22, marginBottom: 26 }}>
          <div style={{ background: accent, borderRadius: 16, padding: "18px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: statTextColor }}>Amount</div>
                <div style={{ fontSize: 9, color: isColored ? "rgba(255,255,255,0.5)" : "#94a3b8" }}>Synced from {data.syncTime}</div>
              </div>
              <button style={{ background: "#fff", border: "none", borderRadius: 20, padding: "3px 12px", fontSize: 11, cursor: "pointer", fontWeight: 600, color: "#1a2332" }}>Filter</button>
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: statValColor, marginBottom: 12 }}>{data.mainValue}</div>
            {data.stats.map((s, i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11, color: statTextColor }}>{s.label}</span>
                  {s.synced && <span style={{ fontSize: 9, color: isColored ? "rgba(255,255,255,0.5)" : "#94a3b8" }}>Synced</span>}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: statValColor }}>{s.value}</div>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332", marginBottom: 8 }}>Manually Adjust Metric</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <button onClick={() => handleIncrement(-1)} style={{ width: 30, height: 30, borderRadius: "50%", border: "1.5px solid #d1d5db", background: "none", fontSize: 18, cursor: "pointer", color: "#9CA3AF" }}>−</button>
              <div>
                {isEditingValue
                  ? <input value={localValue} onChange={e => setLocalValue(e.target.value)} onBlur={handleValueSave} onKeyDown={e => { if (e.key === "Enter") handleValueSave(); }} autoFocus
                    style={{ fontSize: 26, fontWeight: 700, color: "#1a2332", border: "none", borderBottom: "2px solid #3B82F6", outline: "none", width: 130, background: "transparent" }} />
                  : <div onClick={() => setIsEditingValue(true)} style={{ fontSize: 26, fontWeight: 700, color: "#1a2332", cursor: "text" }} title="Click to edit">{localValue}</div>}
                <div style={{ fontSize: 10, color: "#94a3b8", fontStyle: "italic" }}>Synced from {data.syncTime}</div>
              </div>
              <button onClick={() => handleIncrement(1)} style={{ width: 30, height: 30, borderRadius: "50%", border: "1.5px solid #d1d5db", background: "none", fontSize: 18, cursor: "pointer", color: "#9CA3AF" }}>+</button>
            </div>
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "6px 8px" }}>
              <MetricChart history={history} rules={colorRules} graphType={graphType} currentValue={localValue} />
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

const opLabels: RuleOp[] = [">=", "<=", ">", "<", "==", "!=", "between"];
  const opDisplay: Record<RuleOp, string> = {
    ">=": "≥ (greater than or equal)", "<=": "≤ (less than or equal)",
    ">": "> (greater than)", "<": "< (less than)",
    "==": "= (equals)", "!=": "≠ (does not equal)",
    "between": "between (range)"
  };

  const save = () => {
    const n = parseFloat(val); if (isNaN(n)) return;
    onSave({ id: existing?.id ?? crypto.randomUUID(), color, op, value: n, value2: op === "between" ? parseFloat(val2) : undefined });
    onClose();
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 4000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "24px", width: "100%", maxWidth: 480, boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1a2332" }}>Add Color Rule</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8" }}>×</button>
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#1a2332", marginBottom: 10 }}>1. Select Condition</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: "#64748b", width: 80, flexShrink: 0 }}>If Metric is</span>
            <select value={op} onChange={e => setOp(e.target.value as RuleOp)}
              style={{ flex: 1, padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none", background: "#fff" }}>
              {opLabels.map(o => <option key={o} value={o}>{opDisplay[o]}</option>)}
            </select>
          </div>
          {op !== "between"
            ? <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "#64748b", width: 80, flexShrink: 0 }}>Value</span>
              <input value={val} onChange={e => setVal(e.target.value)} placeholder="Enter number"
                style={{ flex: 1, padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none" }} />
            </div>
            : <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "#64748b", width: 80, flexShrink: 0 }}>Min Value</span>
                <input value={val} onChange={e => setVal(e.target.value)} placeholder="Min"
                  style={{ flex: 1, padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none" }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "#64748b", width: 80, flexShrink: 0 }}>Max Value</span>
                <input value={val2} onChange={e => setVal2(e.target.value)} placeholder="Max"
                  style={{ flex: 1, padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none" }} />
              </div>
            </div>}
        </div>
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#1a2332", marginBottom: 10 }}>2. Select Color</div>
          <div style={{ display: "flex", gap: 10 }}>
            {(["red", "yellow", "green"] as const).map(c => (
              <div key={c} onClick={() => setColor(c)} style={{
                display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                padding: "8px 12px", borderRadius: 10, flex: 1, justifyContent: "center",
                border: `2px solid ${color === c ? MS[c].bg : "#e2e8f0"}`,
                background: color === c ? MS[c].bg + "18" : "#fff"
              }}>
                <span style={{ width: 12, height: 12, borderRadius: "50%", background: MS[c].bg, display: "inline-block" }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: color === c ? MS[c].bg : "#64748b", textTransform: "capitalize" }}>{c}</span>
              </div>
            ))}
          </div>
        </div>
        <button onClick={save} style={{ width: "100%", padding: "11px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          Save Rule
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// METRIC BOX SETTINGS MODAL
// ═══════════════════════════════════════════════════════════════════════════

function MetricBoxSettingsModal({ initial, siblings, onSave, onDelete, onDuplicate, onRecreateMissing, onClose }: {
  initial?: Metric;
  siblings?: Metric[];
  onSave: (m: Omit<Metric, "id">) => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onRecreateMissing?: (missingAccounts: string[]) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [rawValue, setRawValue] = useState(() => {
    // strip formatting to get raw number for editing
    return (initial?.value ?? "").replace(/[^0-9.]/g, "");
  });
  const [icon, setIcon] = useState(initial?.icon ?? ICON_NONE);
  const [graphType, setGraphType] = useState<GraphType>(initial?.graphType ?? "linear");
  const [metricType, setMetricType] = useState<MetricType>(initial?.metricType ?? "counter");
  const [currency, setCurrency] = useState(initial?.currencySymbol ?? "$");
  const [fiveOn, setFiveOn] = useState(initial?.modal?.fiveAccountEnabled ?? false);
  const [rules, setRules] = useState<ColorRule[]>(initial?.colorRules ?? []);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRule, setEditingRule] = useState<ColorRule | undefined>();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Live formatted preview of the value based on metric type
  const previewValue = formatValue(rawValue || "0", fiveOn ? "financial" : metricType, currency);

  const graphTypes: [GraphType, string][] = [["linear", "Line Chart"], ["bar-v", "Bar Vertical"], ["bar-h", "Bar Horizontal"], ["pie", "Pie Chart"]];
  const metricTypes: [MetricType, string][] = [["counter", "Counter"], ["percentage", "Percentage"], ["financial", "Financial"]];

  const SectionLabel = ({ children }: { children: string }) => (
    <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{children}</div>
  );

  const Radio = ({ checked, onChange, label: rl, disabled }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean }) => (
    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: disabled ? "not-allowed" : "pointer", fontSize: 12, color: disabled ? "#cbd5e1" : "#1a2332", marginBottom: 5 }}>
      <input type="radio" checked={checked} onChange={onChange} disabled={disabled} style={{ accentColor: "#3B82F6", margin: 0 }} />{rl}
    </label>
  );

  const openAddRule = () => { setEditingRule(undefined); setShowRuleModal(true); };
  const openEditRule = (r: ColorRule) => { setEditingRule(r); setShowRuleModal(true); };
  const saveRule = (r: ColorRule) => setRules(prev => { const i = prev.findIndex(x => x.id === r.id); if (i >= 0) { const a = [...prev]; a[i] = r; return a; } return [...prev, r]; });
  const removeRule = (id: string) => setRules(prev => prev.filter(r => r.id !== id));
  const ruleDesc = (r: ColorRule) => {
    if (r.op === "between") return `between ${r.value}–${r.value2}`;
    if (r.op === "==") return `equals ${r.value}`;
    if (r.op === "!=") return `does not equal ${r.value}`;
    return `${r.op} ${r.value}`;
  };

  const effectiveMetricType: MetricType = fiveOn ? "financial" : metricType;

  const handleSave = () => {
    if (!label.trim()) { setSaveError("Please enter a title for this metric box."); return; }
    if (!rawValue.trim()) { setSaveError("Please enter a current value."); return; }
    setSaveError("");
    const finalValue = previewValue;
    const m = makeModal(label, finalValue, "gray", {
      fiveAccountEnabled: fiveOn,
      type: fiveOn ? "cashflow" : effectiveMetricType === "counter" ? "leads" : effectiveMetricType === "percentage" ? "website" : "invoices",
      mainValue: finalValue,
    });
    onSave({
      label, value: finalValue, icon, color: "gray", modal: m,
      graphType, metricType: effectiveMetricType, colorRules: rules,
      connectedApps: initial?.connectedApps ?? [],
      history: initial?.history ?? [],
      fiveAccountParentId: initial?.fiveAccountParentId,
      currencySymbol: currency,
    });
    onClose();
  };

  const isSynced = !!initial?.fiveAccountParentId;

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 16 }}>
        <div onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === "Enter") handleSave(); }}
          style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 820, maxHeight: "92vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}>

          {/* Header */}
          <div style={{ padding: "20px 22px 0", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Metric Box Title"
              style={{ fontSize: 17, fontWeight: 700, border: "none", outline: "none", color: "#1a2332", background: "transparent", flex: 1, minWidth: 0 }} />
            <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: "50%", border: "1.5px solid #e2e8f0", background: "#f8fafc", fontSize: 18, cursor: "pointer", color: "#94a3b8", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginLeft: 10 }}>×</button>
          </div>

          {isSynced && (
            <div style={{ margin: "0 22px 6px", background: "#F0FDF4", border: "1px solid #c3e6d4", borderRadius: 8, padding: "6px 12px", fontSize: 11, color: "#0F6E56" }}>
              ✓ Synced from Five-Account System
            </div>
          )}

          <div style={{ padding: "6px 22px 22px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) minmax(280px, 1fr)", gap: 24 }}>

              {/* LEFT */}
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <SectionLabel>Metric Type</SectionLabel>
                  {metricTypes.map(([t, l]) => (
                    <Radio key={t} checked={effectiveMetricType === t} onChange={() => setMetricType(t)} label={l} disabled={fiveOn} />
                  ))}
                  {/* Currency dropdown appears when Financial is selected */}
                  {effectiveMetricType === "financial" && (
                    <div style={{ marginTop: 6 }}>
                      <SectionLabel>Currency</SectionLabel>
                      <select value={currency} onChange={e => setCurrency(e.target.value)}
                        style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none", background: "#fff" }}>
                        {WORLD_CURRENCIES.map(c => <option key={c.symbol} value={c.symbol}>{c.symbol} — {c.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>

                <div>
                  <SectionLabel>Current Value</SectionLabel>
                  <input value={rawValue} onChange={e => setRawValue(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Enter number"
                    style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                  {rawValue && (
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                      Preview: <strong style={{ color: "#3B82F6" }}>{previewValue}</strong>
                    </div>
                  )}
                </div>

                <div>
                  <SectionLabel>Connected Apps</SectionLabel>
                  {(initial?.connectedApps ?? []).length === 0
                    ? <div style={{ fontSize: 11, color: "#cbd5e1", fontStyle: "italic" }}>No apps connected yet</div>
                    : (initial?.connectedApps ?? []).map((a, i) => (
                      <span key={i} style={{ display: "inline-block", background: "#EFF6FF", borderRadius: 8, padding: "3px 8px", fontSize: 11, color: "#3B82F6", marginRight: 4, marginBottom: 3 }}>{a}</span>
                    ))}
                </div>

                {/* Five-Account System */}
                {(() => {
                  // Compute which siblings are missing from the Five-Account group, if any.
                  // Uses strict fiveAccountParentId matching.
                  let missingAccounts: string[] = [];
                  let groupAlreadyExists = false;
                  if (initial && fiveOn) {
                    // Determine the group's parent ID — either the parent's own id, or the child's parent reference.
                    const groupId = initial.fiveAccountParentId ?? initial.id;
                    // Collect all metrics in this group: the parent itself, plus any boxes whose parentId matches.
                    const groupMembers = (siblings ?? []).filter(s =>
                      s.id === groupId || s.fiveAccountParentId === groupId
                    );
                    // Always include the current metric being edited (it may not be in siblings).
                    if (!groupMembers.find(m => m.id === initial.id)) groupMembers.push(initial);
                    const presentLabels = new Set(groupMembers.map(m => m.label));
                    missingAccounts = FIVE_ACCOUNT_LABELS.filter(l => !presentLabels.has(l));
                    groupAlreadyExists = groupMembers.length > 1; // more than just the current box
                  }
                  return (
                    <div style={{ background: "#F0FDF4", border: "1px solid #c3e6d4", borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#1a2332" }}>Five-Account System</div>
                          <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>Profit First budgeting method</div>
                        </div>
                        <Toggle on={fiveOn} onChange={setFiveOn} />
                      </div>
                      {fiveOn && (
                        <>
                          <div style={{ fontSize: 11, color: "#0F6E56", background: "#dcfce7", borderRadius: 6, padding: "5px 10px", marginBottom: 6 }}>
                            ✓ Box will display bank transactions and 5-account math.
                          </div>

                          {/* Case 1: brand-new (no group exists yet) → show "this will create 4 more" warning */}
                          {!initial && (
                            <div style={{ fontSize: 11, color: "#92400e", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 6, padding: "5px 10px" }}>
                              ⚠ This will create 4 more metric boxes so all 5 checking accounts are separated out based on your bank balance.
                            </div>
                          )}

                          {/* Case 2: editing existing, group is complete → no warning */}

                          {/* Case 3: editing existing, group has missing siblings → show recreate warning */}
                          {initial && missingAccounts.length > 0 && groupAlreadyExists && (
                            <div style={{ fontSize: 11, color: "#92400e", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 6, padding: "8px 10px" }}>
                              <div style={{ marginBottom: 6 }}>
                                ⚠ You're missing the <strong>{missingAccounts.join(", ").replace(/, ([^,]*)$/, " and $1")}</strong> metric box{missingAccounts.length > 1 ? "es" : ""}. Would you like to recreate {missingAccounts.length > 1 ? "them" : "it"}?
                              </div>
                              {onRecreateMissing && (
                                <button
                                  onClick={() => { onRecreateMissing(missingAccounts); onClose(); }}
                                  style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#92400e", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                                  Recreate {missingAccounts.length > 1 ? "Them" : "It"}
                                </button>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })()}

                {/* Color Rules */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <button style={{ padding: "8px 0", borderRadius: 8, border: "none", background: "#64748b", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Create Equation</button>
                  <button onClick={openAddRule} style={{ padding: "8px 0", borderRadius: 8, border: "none", background: "#64748b", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Create Color Rule</button>
                </div>

                {rules.length > 0 && (
                  <div>
                    <SectionLabel>Active Color Rules</SectionLabel>
                    {rules.map(r => (
                      <div key={r.id} style={{ background: "#F8FAFC", borderRadius: 8, padding: "7px 10px", marginBottom: 6, border: "1px solid #e2e8f0" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 1 }}>
                              <span style={{ width: 9, height: 9, borderRadius: "50%", background: MS[r.color].bg, display: "inline-block" }} />
                              <span style={{ fontSize: 11, fontWeight: 600, color: "#1a2332", textTransform: "capitalize" }}>{r.color}</span>
                            </div>
                            <div style={{ fontSize: 10, color: "#64748b" }}>If metric is {ruleDesc(r)}</div>
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => openEditRule(r)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#3B82F6", padding: 0 }}>Edit</button>
                            <button onClick={() => removeRule(r.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#E85D75", padding: 0 }}>✕</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* RIGHT */}
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <SectionLabel>Select Icon</SectionLabel>
                  <IconPicker selected={icon} onSelect={setIcon} />
                </div>
                <div>
                  <SectionLabel>Graph Type</SectionLabel>
                  {graphTypes.map(([g, l]) => (
                    <label key={g} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "#1a2332", marginBottom: 5 }}>
                      <input type="radio" checked={graphType === g} onChange={() => setGraphType(g)} style={{ accentColor: "#3B82F6", margin: 0 }} />{l}
                    </label>
                  ))}
                </div>
              </div>
            </div>

          <button onClick={handleSave} style={{ width: "100%", padding: "12px 0", borderRadius: 8, border: "none", marginTop: 20, background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Save
            </button>
            {saveError && <div style={{ fontSize: 11, color: "#E85D75", marginTop: 5, textAlign: "center" }}>{saveError}</div>}

            {initial && onDuplicate && (
              <div style={{ textAlign: "center", marginTop: 10 }}>
                <button onClick={() => { onDuplicate(); onClose(); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#3B82F6", fontSize: 12, textDecoration: "underline" }}>
                  Duplicate Metric Box
                </button>
              </div>
            )}

            {(initial || onDelete) && !showDeleteConfirm && (
              <div style={{ textAlign: "center", marginTop: 8 }}>
                <button onClick={() => setShowDeleteConfirm(true)} style={{ background: "none", border: "none", cursor: "pointer", color: "#E85D75", fontSize: 12, textDecoration: "underline" }}>
                  Delete Metric Box
                </button>
              </div>
            )}
            {showDeleteConfirm && (
              <div style={{ marginTop: 10, background: "#FFF5F5", borderRadius: 10, padding: "12px 14px", border: "1px solid #fecaca", textAlign: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#E85D75", marginBottom: 8 }}>Are you sure you want to delete this metric box?</div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                  <button onClick={() => setShowDeleteConfirm(false)} style={{ padding: "6px 16px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 12, cursor: "pointer", color: "#64748b" }}>Cancel</button>
                  <button onClick={() => { onDelete?.(); onClose(); }} style={{ padding: "6px 16px", borderRadius: 8, border: "none", background: "#E85D75", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Yes, Delete</button>
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
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "24px", width: "90%", maxWidth: 360, boxShadow: "0 20px 60px rgba(0,0,0,0.18)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#1a2332" }}>{initial ? "Rename Row" : "Add Row"}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>×</button>
        </div>
        <input value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && name.trim()) { onSave(name.trim()); onClose(); } }}
          placeholder="Row name" autoFocus
          style={{ width: "100%", padding: "8px 11px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 18 }} />
        <button onClick={() => { if (name.trim()) { onSave(name.trim()); onClose(); } }}
          style={{ width: "100%", padding: "10px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
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
  const update = (i: number, f: "email" | "access", v: string) => setMembers(p => p.map((m, j) => j === i ? { ...m, [f]: v } : m));
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "28px", width: "100%", maxWidth: 460, boxShadow: "0 24px 64px rgba(0,0,0,0.18)" }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>×</button>
        </div>
        <h2 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 700, color: "#1a2332", textAlign: "center" }}>Add your team</h2>
        <p style={{ margin: "0 0 20px", fontSize: 12, color: "#94a3b8", textAlign: "center" }}>Set permission levels for each team member.</p>
        {members.map((m, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, marginBottom: 10, alignItems: "center" }}>
            <input value={m.email} onChange={e => update(i, "email", e.target.value)} placeholder="Email"
              style={{ padding: "8px 11px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none" }} />
            <select value={m.access} onChange={e => update(i, "access", e.target.value)}
              style={{ padding: "7px 9px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none", background: "#fff" }}>
              {["View", "Edit", "Admin"].map(a => <option key={a}>{a}</option>)}
            </select>
          </div>
        ))}
        <button onClick={() => setMembers(p => [...p, { email: "", access: "View" }])}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#3B82F6", padding: "3px 0", marginBottom: 16, display: "flex", alignItems: "center", gap: 4 }}>
          + Add more
        </button>
        <button onClick={onClose} style={{ width: "100%", padding: "11px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Add</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// METRIC BLOCK
// ═══════════════════════════════════════════════════════════════════════════

function MetricBlock({ metric, onClick, onDragStart, onDragEnter, onDrop, isDragOver }: {
  metric: Metric; onClick: () => void;
  onDragStart: () => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDrop: () => void;
  isDragOver: boolean;
}) {
  const activeColor = resolveColor(metric);
  const s = MS[activeColor];
  const [hov, setHov] = useState(false);
  const hasIcon = !!(metric.icon && metric.icon !== ICON_NONE);
  const isColored = activeColor !== "gray";
  const textColor = isColored ? "#fff" : "#4A5568";

  return (
    <div
      draggable
      onDragStart={e => { e.stopPropagation(); onDragStart(); }}
      onDragEnter={e => { e.preventDefault(); e.stopPropagation(); onDragEnter(e); }}
      onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={e => { e.preventDefault(); e.stopPropagation(); onDrop(); }}
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
      <div style={{ fontSize: 12, fontWeight: 600, color: textColor, lineHeight: 1.3, textAlign: "center", width: "100%" }}>
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

// ═══════════════════════════════════════════════════════════════════════════
// ROW CONTEXT MENU
// ═══════════════════════════════════════════════════════════════════════════

function RowMenu({ onRename, onDelete, onClose }: { onRename: () => void; onDelete: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, [onClose]);
  return (
    <div ref={ref} style={{ position: "absolute", top: 36, right: 0, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid #e2e8f0", zIndex: 100, minWidth: 150, overflow: "hidden" }}>
      {[{ label: "Rename row", action: onRename }, { label: "Delete row", action: onDelete }].map(item => (
        <div key={item.label} onClick={() => { item.action(); onClose(); }}
          style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", color: "#1a2332" }}
          onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>{item.label}</div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD SECTION — with robust drag-drop
// ═══════════════════════════════════════════════════════════════════════════

function DashSection({
  section, onAddMetric, onRemoveMetric, onUpdateMetric, onRenameSection, onRemoveSection,
  onClickMetric, dragState, onMetricDragStart, onMetricDragEnter, onMetricDrop,
  onSectionDragStart, onSectionDragEnter, onSectionDrop, isSectionDragOver
}: {
  section: Section;
  onAddMetric: (sid: string, m: Omit<Metric, "id">) => void;
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
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingMetric, setEditingMetric] = useState<Metric | null>(null);
  const [showRowModal, setShowRowModal] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  // Drop zone for the section itself (when dragging a metric over empty space in section)
  const handleSectionDropZone = (e: React.DragEvent) => {
    e.preventDefault();
    if (dragState && section.metrics.length === 0) {
      onMetricDrop(section.id, "__end__");
    }
  };

  const handleAddMetricWithFiveAccount = (m: Omit<Metric, "id">) => {
    const newId = crypto.randomUUID();
    onAddMetric(section.id, { ...m, id: newId } as any);

    // If five-account is on and this is not a child box, create the 4 siblings
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
       <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#1a2332" }}>{section.title}</h2>
        <div style={{ display: "flex", marginLeft: 2, paddingLeft: 4 }}>
          {section.avatars.map(a => (
            <div key={a} style={{ width: 28, height: 28, borderRadius: "50%", background: "#4C9FE8", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 600, border: "2px solid #fff", marginLeft: -5, flexShrink: 0 }}>{a}</div>
          ))}
        </div>
        <div style={{ position: "relative" }}>
          <div onClick={() => setShowMenu(v => !v)} style={{ width: 26, height: 26, borderRadius: "50%", background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 13, color: "#94a3b8" }}>···</div>
          {showMenu && <RowMenu onRename={() => { setShowMenu(false); setShowRowModal(true); }} onDelete={() => onRemoveSection(section.id)} onClose={() => setShowMenu(false)} />}
        </div>
        <div style={{ flex: 1 }} />
      </div>

      {/* Metrics row */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <div style={{ width: 28, height: 28, borderRadius: "50%", border: "1.5px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#94a3b8", flexShrink: 0, marginRight: 6 }}>›</div>
        <div
          style={{ display: "flex", gap: 10, flexWrap: "wrap", flex: 1, minHeight: 48 }}
          onDragOver={e => e.preventDefault()}
          onDrop={handleSectionDropZone}
        >
          {section.metrics.map(m => {
            const isDragOver = dragState?.sourceSid !== section.id || dragState?.sourceMid !== m.id
              ? false
              : false; // calculated below
            const isTarget = dragState && (dragState.sourceSid !== section.id || dragState.sourceMid !== m.id);
            return (
              <MetricBlock key={m.id} metric={m}
                onClick={() => onClickMetric(m.modal, m)}
                onDragStart={() => onMetricDragStart(section.id, m.id)}
                onDragEnter={e => { if (dragState && (dragState.sourceSid !== section.id || dragState.sourceMid !== m.id)) onMetricDragEnter(section.id, m.id); }}
                onDrop={() => onMetricDrop(section.id, m.id)}
                isDragOver={false}
              />
            );
          })}
          <div onClick={() => setShowAdd(true)} style={{ width: 44, height: 44, borderRadius: "50%", border: "1.5px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#94a3b8", fontSize: 20, alignSelf: "center" }}>+</div>
        </div>
      </div>
      <div style={{ height: 1, background: "#f1f5f9", marginTop: 20 }} />

      {showAdd && <MetricBoxSettingsModal
        onSave={m => { handleAddMetricWithFiveAccount(m); setShowAdd(false); }}
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
        onClose={() => setEditingMetric(null)} />}

      {showRowModal && <EditAddRowModal initial={section.title} onSave={name => onRenameSection(section.id, name)} onClose={() => setShowRowModal(false)} />}
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
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: "clamp(20px,4vw,26px)", fontWeight: 700, color: "#1a2332" }}>Company Goals</h1>
        <div style={{ display: "flex", gap: 6, marginLeft: 6 }}>
          {(["list", "expanded"] as const).map(v => (
            <button key={v} onClick={() => setView(v)} style={{ padding: "5px 14px", borderRadius: 20, border: "none", fontSize: 12, cursor: "pointer", fontWeight: 500, background: view === v ? "#3B82F6" : "#e2e8f0", color: view === v ? "#fff" : "#64748b", textTransform: "capitalize" }}>{v === "list" ? "List" : "Expanded"}</button>
          ))}
        </div>
        <button style={{ padding: "7px 18px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", marginLeft: "auto" }}>⊕ Add Goal</button>
      </div>
      {view === "list" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {goals.map((g, i) => (
            <div key={i} style={{ background: "#fff", borderRadius: 14, padding: "16px 18px", border: "1px solid #f1f5f9" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "#1a2332" }}>{g.label}</div>
                <span style={{ fontSize: 12, color: "#94a3b8" }}>Due: {g.due}</span>
                <button style={{ background: "none", border: "none", fontSize: 12, color: "#3B82F6", cursor: "pointer" }}>Edit</button>
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>Progress — {g.pct}%</div>
              <div style={{ height: 8, borderRadius: 99, background: "#e5e7eb", overflow: "hidden" }}>
                <div style={{ width: `${g.pct}%`, height: "100%", borderRadius: 99, background: "#4CAF7D" }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 18 }}>
          {goals.map((g, i) => (
            <div key={i} style={{ background: "#fff", borderRadius: 14, padding: 20, border: "1px solid #f1f5f9" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1a2332", marginBottom: 8 }}>{g.label}</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 3 }}>Progress — {g.pct}%</div>
              <div style={{ height: 8, borderRadius: 99, background: "#e5e7eb", overflow: "hidden", marginBottom: 14 }}>
                <div style={{ width: `${g.pct}%`, height: "100%", borderRadius: 99, background: "#4CAF7D" }} />
              </div>
              {g.metrics.map((m: any, mi: number) => (
                <div key={mi} style={{ display: "inline-block", background: MS[m.color as MetricColor].bg, borderRadius: 8, padding: "5px 10px", marginRight: 6, marginBottom: 4 }}>
                  <div style={{ fontSize: 10, color: MS[m.color as MetricColor].text, fontWeight: 600 }}>{m.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: MS[m.color as MetricColor].text }}>{m.value}</div>
                </div>
              ))}
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
  return (
    <div style={{ padding: "clamp(16px,4vw,32px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: "clamp(20px,4vw,26px)", fontWeight: 700, color: "#1a2332" }}>Tasks</h1>
        <button style={{ padding: "7px 18px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", marginLeft: "auto" }}>+ Add Task</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(180px,1fr)", gap: 20 }}>
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            {(["all", "active", "completed"] as const).map(f => (
              <div key={f} onClick={() => setFilter(f)} style={{ padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 500, cursor: "pointer", background: filter === f ? "#3B82F6" : "#f1f5f9", color: filter === f ? "#fff" : "#64748b", textTransform: "capitalize" }}>
                {f}{f === "all" ? ` (${tasks.length})` : ""}
              </div>
            ))}
          </div>
          {filtered.map(t => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "#fff", borderRadius: 10, marginBottom: 6, border: "1px solid #f1f5f9", opacity: t.done ? 0.6 : 1 }}>
              <div onClick={() => toggle(t.id)} style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, cursor: "pointer", border: t.done ? "none" : "1.5px solid #d1d5db", background: t.done ? "#4CAF7D" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11 }}>{t.done ? "✓" : ""}</div>
              <div style={{ flex: 1, fontSize: 13, color: "#1a2332", textDecoration: t.done ? "line-through" : "none" }}>{t.text}</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>Due {t.due}</div>
              <Av initials={t.assignee} size={26} />
            </div>
          ))}
        </div>
        <div>
          <SectionCard title="Suggested Tasks ✦">
            <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 10 }}>Based on your dashboard metrics</div>
            {["Close 5 more calls", "Send 13 invoices", "Add $3,500 from Overhead"].map((t, i) => (
              <div key={i} style={{ display: "flex", gap: 8, padding: "8px 10px", background: "#fff", borderRadius: 8, marginBottom: 6, border: "1px solid #f1f5f9" }}>
                <span style={{ fontSize: 16, color: "#94a3b8", cursor: "pointer" }}>⊕</span>
                <span style={{ fontSize: 12, color: "#1a2332" }}>{t}</span>
              </div>
            ))}
          </SectionCard>
          <div style={{ marginTop: 12 }}>
            <SectionCard>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1a2332", marginBottom: 10 }}>Task Summary</div>
              {[["Total", tasks.length], ["Completed", tasks.filter(t => t.done).length], ["Pending", tasks.filter(t => !t.done).length]].map(([l, v]) => (
                <div key={l as string} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: "#64748b" }}>{l}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#1a2332" }}>{v}</span>
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
        <h1 style={{ margin: 0, fontSize: "clamp(20px,4vw,26px)", fontWeight: 700, color: "#1a2332" }}>All Apps</h1>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search apps..."
            style={{ padding: "7px 13px", borderRadius: 20, border: "1px solid #e2e8f0", fontSize: 12, outline: "none", width: 160 }} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 14, marginBottom: 28 }}>
        {filtered.map(app => (
          <div key={app.id} onClick={() => onSelectApp(app)} style={{ background: "#fff", borderRadius: 14, padding: 18, border: "1px solid #f1f5f9", cursor: "pointer", transition: "box-shadow 0.15s" }}
            onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.08)")}
            onMouseLeave={e => (e.currentTarget.style.boxShadow = "none")}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 24 }}>{app.logo}</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#1a2332" }}>{app.name}</div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>{app.desc}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 99, fontWeight: 600, background: app.connected ? "#DCFCE7" : "#F1F5F9", color: app.connected ? "#15803D" : "#94a3b8" }}>
                {app.connected ? "Connected" : "Not Connected"}
              </span>
              <span style={{ fontSize: 11, color: "#3B82F6", cursor: "pointer" }}>{app.connected ? "Manage →" : "Connect →"}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ background: "#EEF9F4", border: "1px solid #c3e6d4", borderRadius: 14, padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#0F6E56", marginBottom: 6 }}>🏦 Phase 3: Live Bank Integration via Plaid</div>
        <p style={{ margin: "0 0 10px", fontSize: 12, color: "#1e6b4e", lineHeight: 1.6 }}>Connect your real bank account through Plaid and Dashello will automatically calculate your Five-Account balances.</p>
        <button style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: "#0F6E56", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Connect Bank Account →</button>
      </div>
    </div>
  );
}

function AppDetailPage({ app, onBack }: { app: typeof APPS[0]; onBack: () => void }) {
  return (
    <div style={{ padding: "clamp(16px,4vw,32px)" }}>
      <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: "#3B82F6", fontSize: 13, marginBottom: 16, display: "flex", alignItems: "center", gap: 4 }}>← Back to All Apps</button>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ fontSize: 32 }}>{app.logo}</div>
        <div>
          <h1 style={{ margin: 0, fontSize: "clamp(18px,4vw,24px)", fontWeight: 700, color: "#1a2332" }}>{app.name}</h1>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>{app.desc}</div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          {app.connected
            ? <button style={{ padding: "7px 18px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", fontSize: 12, cursor: "pointer", color: "#E85D75" }}>Disconnect</button>
            : <button style={{ padding: "7px 18px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Connect {app.name}</button>}
        </div>
      </div>
      <SectionCard title="Workflows">
        {["Auto-create tasks from overdue invoices", "Notify team on lead stage change", "Weekly summary to Slack"].map((w, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: i < 2 ? "1px solid #f1f5f9" : "none" }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#4CAF7D", flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: "#1a2332", flex: 1 }}>{w}</span>
            <Toggle on={i < 2} onChange={() => { }} />
          </div>
        ))}
      </SectionCard>
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
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: "clamp(20px,4vw,26px)", fontWeight: 700, color: "#1a2332" }}>Team</h1>
        <button onClick={() => setShowInvite(true)} style={{ padding: "7px 18px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", marginLeft: "auto" }}>+ Invite Member</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 14, marginBottom: 24 }}>
        {members.map((m, i) => (
          <div key={i} style={{ background: "#fff", borderRadius: 14, padding: 18, border: "1px solid #f1f5f9", textAlign: "center" }}>
            <div style={{ width: 52, height: 52, borderRadius: "50%", background: m.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: "#fff", margin: "0 auto 10px" }}>{m.initials}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1a2332" }}>{m.name}</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>{m.role}</div>
            <div style={{ fontSize: 11, color: "#3B82F6", marginBottom: 8 }}>{m.email}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1a2332" }}>{m.tasks}</div>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>Tasks</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12 }}>
        {[{ color: "green" as MetricColor, label: "Team", value: "6 members" }, { color: "yellow" as MetricColor, label: "Open Tasks", value: "60" }, { color: "gray" as MetricColor, label: "Completed", value: "2 this week" }].map((b, i) => (
          <div key={i} style={{ background: MS[b.color].bg, borderRadius: 14, padding: 18 }}>
            <div style={{ fontSize: 12, color: MS[b.color].text, opacity: 0.8 }}>{b.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: MS[b.color].text, marginTop: 3 }}>{b.value}</div>
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

function ProfileField({ label, value, onChange, disabled }: { label: string; value: string; onChange?: (v: string) => void; disabled?: boolean }) {
  return (
    <div style={{ marginBottom: 13 }}>
      <label style={{ fontSize: 12, color: "#64748b", display: "block", marginBottom: 3 }}>{label}</label>
      <input value={value} onChange={e => onChange?.(e.target.value)} disabled={disabled}
        style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none", boxSizing: "border-box" as const, background: disabled ? "#f8fafc" : "#fff", color: disabled ? "#94a3b8" : "#1a2332" }} />
    </div>
  );
}

function SettingsPage({ userId, userEmail, onProfileSaved, onFiveAccountCreated }: {
  userId: string; userEmail: string; onProfileSaved: (p: any) => void;
  onFiveAccountCreated: () => void;
}) {
  const [localProfile, setLocalProfile] = useState({
  full_name: "", company: "", street: "", city: "", state: "", zip: "", country: "",
  avatar_url: "", five_account_enabled: false,
  health_green_multiplier: 1.0,
  health_yellow_multiplier: 0.5,
  health_red_multiplier: -1.0,
});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fiveAccountConfirm, setFiveAccountConfirm] = useState(false);
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
    });
  });
}, [userId]);

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase.from("profiles").upsert({ id: userId, ...localProfile, updated_at: new Date().toISOString() });
    if (!error) { onProfileSaved({ ...localProfile }); setSaved(true); setTimeout(() => setSaved(false), 3000); }
    setSaving(false);
  };

  const handleFiveAccountToggle = async (v: boolean) => {
    const updated = { ...localProfile, five_account_enabled: v };
    setLocalProfile(updated);
    // Auto-save immediately
    await supabase.from("profiles").upsert({ id: userId, ...updated, updated_at: new Date().toISOString() });
    onProfileSaved(updated);
    if (v) {
      onFiveAccountCreated();
      setFiveAccountConfirm(true);
      setTimeout(() => setFiveAccountConfirm(false), 4000);
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
        <div style={{ fontSize: 13, color: "#1a2332" }}>{label} <span style={{ fontSize: 10, color: "#94a3b8", fontStyle: "italic" }}>(coming soon)</span></div>
        <div style={{ fontSize: 11, color: "#94a3b8" }}>{sub}</div>
      </div>
      <Toggle on={false} onChange={() => { }} disabled />
    </div>
  );

  return (
    <div style={{ padding: "clamp(16px,4vw,32px)", maxWidth: 860 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: "clamp(20px,4vw,26px)", fontWeight: 700, color: "#1a2332" }}>Profile</h1>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 20 }}>
        {/* Profile card */}
        <div style={{ background: "#fff", borderRadius: 14, padding: 22, border: "1px solid #f1f5f9" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
            <div onClick={() => fileRef.current?.click()} style={{ width: 58, height: 58, borderRadius: "50%", background: "#4C9FE8", cursor: "pointer", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
              {localProfile.avatar_url ? <img src={localProfile.avatar_url} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (localProfile.full_name?.[0]?.toUpperCase() ?? "👤")}
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={handlePhotoUpload} style={{ display: "none" }} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332" }}>{localProfile.full_name || "Your Name"}</div>
              <button onClick={() => fileRef.current?.click()} style={{ fontSize: 11, color: "#3B82F6", background: "none", border: "none", cursor: "pointer", padding: 0 }}>{uploading ? "Uploading..." : "Change photo"}</button>
            </div>
          </div>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600, color: "#1a2332" }}>Account</h3>
          <ProfileField label="Full Name" value={localProfile.full_name} onChange={v => setLocalProfile(p => ({ ...p, full_name: v }))} />
          <ProfileField label="Email" value={userEmail} disabled />
          <ProfileField label="Company" value={localProfile.company} onChange={v => setLocalProfile(p => ({ ...p, company: v }))} />
          <h3 style={{ margin: "16px 0 12px", fontSize: 14, fontWeight: 600, color: "#1a2332" }}>Address</h3>
          <ProfileField label="Street" value={localProfile.street} onChange={v => setLocalProfile(p => ({ ...p, street: v }))} />
          <ProfileField label="City" value={localProfile.city} onChange={v => setLocalProfile(p => ({ ...p, city: v }))} />
          <ProfileField label="State" value={localProfile.state} onChange={v => setLocalProfile(p => ({ ...p, state: v }))} />
          <ProfileField label="ZIP" value={localProfile.zip} onChange={v => setLocalProfile(p => ({ ...p, zip: v }))} />
          <ProfileField label="Country" value={localProfile.country} onChange={v => setLocalProfile(p => ({ ...p, country: v }))} />
          <button onClick={handleSave} disabled={saving} style={{ width: "100%", padding: "9px", borderRadius: 8, border: "none", background: saved ? "#4CAF7D" : "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 6 }}>
            {saving ? "Saving..." : saved ? "✓ Saved!" : "Save Changes"}
          </button>
        </div>

        {/* Plan + Preferences */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Plans — grayed out */}
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, border: "1px solid #f1f5f9", opacity: 0.55, pointerEvents: "none" as const }}>
            <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 600, color: "#94a3b8" }}>Plan</h3>
            {[{ name: "Free", features: "3 rows, 10 metrics" }, { name: "Pro", features: "Unlimited rows, integrations" }, { name: "Business", features: "Team access, all apps" }].map(p => (
              <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, marginBottom: 6, background: p.name === "Pro" ? "#EFF6FF" : "#F8FAFC", border: p.name === "Pro" ? "1.5px solid #3B82F6" : "1.5px solid transparent" }}>
                <div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid", borderColor: p.name === "Pro" ? "#3B82F6" : "#d1d5db", background: p.name === "Pro" ? "#3B82F6" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {p.name === "Pro" && <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#fff" }} />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332" }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>{p.features}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Preferences */}
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, border: "1px solid #f1f5f9" }}>
            <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 600, color: "#1a2332" }}>Preferences</h3>
            <GrayPref label="Email notifications" sub="Daily digest of key metrics" />
            <GrayPref label="Dark mode" sub="Switch to dark theme" />
            <GrayPref label="Two-factor auth" sub="Require 2FA on login" />
            {/* Five-Account System — functional */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0" }}>
              <div>
                <div style={{ fontSize: 13, color: "#1a2332" }}>Five-Account System</div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>Enable Profit First method globally</div>
              </div>
              <Toggle on={localProfile.five_account_enabled} onChange={handleFiveAccountToggle} />
            </div>
            {fiveAccountConfirm && (
              <div style={{ marginTop: 8, background: "#F0FDF4", border: "1px solid #c3e6d4", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#0F6E56", display: "flex", alignItems: "center", gap: 6 }}>
                ✓ Five-Account System created — Finances row added to your dashboard.
              </div>
            )}
          </div>

          {/* Health Score multipliers */}
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, border: "1px solid #f1f5f9" }}>
            <h3 style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 600, color: "#1a2332" }}>Health Score</h3>
            <p style={{ margin: "0 0 14px", fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
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
                  <span style={{ fontSize: 13, color: "#1a2332" }}>{label}</span>
                </div>
                <input
                  type="number"
                  step={0.1}
                  value={localProfile[key]}
                  onChange={async e => {
                    const v = parseFloat(e.target.value);
                    if (isNaN(v)) return;
                    const updated = { ...localProfile, [key]: v };
                    setLocalProfile(updated);
                    await supabase.from("profiles").upsert({ id: userId, ...updated, updated_at: new Date().toISOString() });
                    onProfileSaved(updated);
                  }}
                  style={{ width: 72, padding: "5px 9px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none", textAlign: "right" }}
                />
              </div>
            ))}
            <div style={{ marginTop: 10, fontSize: 10, color: "#94a3b8", lineHeight: 1.5 }}>
              Defaults: Green +1.0, Yellow +0.5, Red −1.0. A green box adds its full weight, yellow adds half, red subtracts a full weight.
            </div>
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
  const msgs: Record<string, { name: string; time: string; text: string }[]> = {
    General: [{ name: "Julia", time: "14:27", text: "Sounds good @Bryan." }, { name: "Bryan", time: "14:23", text: "Thanks @Julia. When can you have it transferred over by?" }],
  };
  const display = msgs[active] ?? msgs["General"];
  return (
    <div style={{ position: "fixed", right: 0, top: 0, bottom: 0, width: "clamp(260px,28vw,340px)", background: "#fff", boxShadow: "-4px 0 32px rgba(0,0,0,0.1)", zIndex: 1500, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332" }}>Chat</div>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>×</button>
      </div>
      <div style={{ display: "flex", gap: 4, padding: "6px 10px", borderBottom: "1px solid #f1f5f9", overflowX: "auto" }}>
        {channels.map(ch => (
          <button key={ch} onClick={() => setActive(ch)} style={{ padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 500, border: "none", cursor: "pointer", flexShrink: 0, background: active === ch ? "#3B82F6" : "#f1f5f9", color: active === ch ? "#fff" : "#64748b" }}>{ch}</button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "14px" }}>
        {display.map((m, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "flex-start" }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#4C9FE8", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, color: "#fff" }}>{m.name[0]}</div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#1a2332", marginBottom: 1 }}>{m.name} <span style={{ color: "#94a3b8", fontWeight: 400 }}>{m.time}</span></div>
              <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.5 }}>{m.text}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ padding: "10px 14px", borderTop: "1px solid #f1f5f9" }}>
        <input placeholder="Type Response..." style={{ width: "100%", padding: "8px 14px", borderRadius: 99, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none", boxSizing: "border-box", background: "#f8fafc" }} />
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

function Sidebar({ active, onNav, onClose, isMobile, avatarUrl, firstName, health }: {
  active: Page; onNav: (p: Page) => void; onClose: () => void;
  isMobile: boolean; avatarUrl?: string; firstName?: string;
  health: HealthResult;
}) {
  return (
    <aside style={{ width: 240, flexShrink: 0, background: "#fff", display: "flex", flexDirection: "column", boxShadow: "2px 0 12px rgba(0,0,0,0.06)", height: "100%", minHeight: "100vh", overflowY: "auto", scrollbarWidth: "none" } as React.CSSProperties}>
      <style>{`.nav-item:hover{background:#f1f5f9 !important}`}</style>
      <div style={{ padding: "24px 18px 18px", borderBottom: "1px solid #f1f5f9", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", position: "relative", marginBottom: 10 }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#e2e8f0", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
            {avatarUrl ? <img src={avatarUrl} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ color: "#94a3b8" }}>👤</span>}
          </div>
          {!isMobile && <div onClick={onClose} style={{ position: "absolute", right: 0, width: 26, height: 26, borderRadius: "50%", border: "1.5px solid #e2e8f0", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#94a3b8", fontSize: 14 }}>‹</div>}
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#1a2332" }}>{firstName ? `Welcome ${firstName}` : "Welcome"}</div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>to your dashboard</div>
        </div>
      </div>
      <nav style={{ flex: 1, padding: "10px 10px" }}>
        {NAV.map(item => (
          <div key={item.label} className="nav-item" onClick={() => onNav(item.page)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 11px", borderRadius: 9, marginBottom: 2, cursor: "pointer", background: active === item.page ? "#EFF6FF" : "transparent", color: active === item.page ? "#3B82F6" : "#475569", fontSize: 13, fontWeight: active === item.page ? 600 : 400, transition: "background 0.15s" }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>{item.icon}</span>
            <span style={{ whiteSpace: "nowrap" }}>{item.label}</span>
          </div>
        ))}
      </nav>
      {health.hasData && (() => {
  const barColors = { green: "#4CAF7D", yellow: "#F5A623", red: "#E85D75" };
  return (
    <div style={{ padding: "0 18px 14px" }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Health</span>
        <span style={{ color: "#1a2332", fontWeight: 700 }}>{health.score}%</span>
      </div>
      <div style={{ width: "100%", height: 8, background: "#f1f5f9", borderRadius: 99, overflow: "hidden" }}>
        <div style={{
          width: `${health.score}%`, height: "100%",
          background: barColors[health.barColor], borderRadius: 99,
          transition: "width 400ms ease, background 300ms ease"
        }} />
      </div>
      <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 4, textAlign: "center" }}>
        {health.counts.green}G · {health.counts.yellow}Y · {health.counts.red}R
        {health.counts.gray > 0 ? ` · ${health.counts.gray} unmatched` : ""}
      </div>
    </div>
  );
})()}
      <div style={{ padding: "14px 18px", borderTop: "1px solid #f1f5f9", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <img src="https://dashello.co/wp-content/uploads/2023/08/Logo.png" alt="Dashello" style={{ height: 26, objectFit: "contain", maxWidth: "80%" }} />
        <button onClick={() => supabase.auth.signOut()} style={{ width: "100%", padding: "7px 0", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "transparent", color: "#94a3b8", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Sign Out</button>
      </div>
    </aside>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// HOME PAGE — robust drag-drop
// ═══════════════════════════════════════════════════════════════════════════

function HomePage({ sections, setSections, onClickMetric }: {
  sections: Section[];
  setSections: React.Dispatch<React.SetStateAction<Section[]>>;
  onClickMetric: (data: MetricModalData, metric: Metric) => void;
}) {
  // Drag state stored in ref so it's always current in event handlers
  const dragMetricRef = useRef<{ sourceSid: string; sourceMid: string } | null>(null);
  const dragSectionRef = useRef<string | null>(null);
  const [dragMetricState, setDragMetricState] = useState<{ sourceSid: string; sourceMid: string } | null>(null);
  const [dragOverSid, setDragOverSid] = useState<string | null>(null);
  const [showAddRow, setShowAddRow] = useState(false);

  const addSection = (name: string) => setSections(p => [...p, { id: crypto.randomUUID(), title: name, avatars: [], metrics: [] }]);
  const renameSection = (sid: string, name: string) => setSections(p => p.map(s => s.id === sid ? { ...s, title: name } : s));
  const removeSection = (sid: string) => setSections(p => p.filter(s => s.id !== sid));
  const addMetric = (sid: string, m: Omit<Metric, "id">) => setSections(p => p.map(s => s.id === sid ? { ...s, metrics: [...s.metrics, { ...m, id: crypto.randomUUID() }] } : s));
  const removeMetric = (sid: string, mid: string) => setSections(p => p.map(s => s.id === sid ? { ...s, metrics: s.metrics.filter(m => m.id !== mid) } : s));
  const updateMetric = (sid: string, mid: string, updated: Omit<Metric, "id">) => setSections(p => p.map(s => s.id === sid ? { ...s, metrics: s.metrics.map(m => m.id === mid ? { ...updated, id: mid } : m) } : s));

  // Metric drag start
  const handleMetricDragStart = useCallback((sid: string, mid: string) => {
    dragMetricRef.current = { sourceSid: sid, sourceMid: mid };
    dragSectionRef.current = null;
    setDragMetricState({ sourceSid: sid, sourceMid: mid });
  }, []);

  // Metric drag enter on a target metric
  const handleMetricDragEnter = useCallback((targetSid: string, targetMid: string) => {
    if (!dragMetricRef.current) return;
    const { sourceSid, sourceMid } = dragMetricRef.current;
    if (sourceSid === targetSid && sourceMid === targetMid) return;

    setSections(prev => {
      // Find the moving metric
      const sourceSec = prev.find(s => s.id === sourceSid);
      if (!sourceSec) return prev;
      const movingMetric = sourceSec.metrics.find(m => m.id === sourceMid);
      if (!movingMetric) return prev;

      // Remove from source
      const withoutSource = prev.map(s =>
        s.id === sourceSid ? { ...s, metrics: s.metrics.filter(m => m.id !== sourceMid) } : s
      );

      // Insert before target
      return withoutSource.map(s => {
        if (s.id !== targetSid) return s;
        const targetIdx = s.metrics.findIndex(m => m.id === targetMid);
        if (targetIdx === -1) return { ...s, metrics: [...s.metrics, movingMetric] };
        const newMetrics = [...s.metrics];
        newMetrics.splice(targetIdx, 0, movingMetric);
        return { ...s, metrics: newMetrics };
      });
    });

    // Update drag source to new position
    dragMetricRef.current = { sourceSid: targetSid, sourceMid };
    setDragMetricState({ sourceSid: targetSid, sourceMid });
  }, [setSections]);

  // Metric drop — just clear state (position already set by dragEnter)
  const handleMetricDrop = useCallback((targetSid: string, targetMid: string) => {
    dragMetricRef.current = null;
    setDragMetricState(null);
    setDragOverSid(null);
  }, []);

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
          onAddMetric={addMetric} onRemoveMetric={removeMetric} onUpdateMetric={updateMetric}
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
        />
      ))}
      <div onClick={() => setShowAddRow(true)} style={{ display: "flex", alignItems: "center", gap: 8, color: "#94a3b8", fontSize: 13, cursor: "pointer", padding: "6px 0" }}>
        <div style={{ width: 26, height: 26, borderRadius: "50%", border: "1.5px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, color: "#94a3b8" }}>+</div>
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
  const [userEmail, setUserEmail] = useState("");
  const [dbReady, setDbReady] = useState(false);
  const [profile, setProfile] = useState({
  full_name: "", company: "", street: "", city: "", state: "", zip: "", country: "",
  avatar_url: "", five_account_enabled: false,
  health_green_multiplier: 1.0,
  health_yellow_multiplier: 0.5,
  health_red_multiplier: -1.0,
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
    { label: "Increase Sales by 25%", current: "$235,000", target: "$1,200,000", pct: 20, due: "May 26th", projections: [{ label: "Projected Sales", value: "<27" }], metrics: [{ label: "Leads", value: "12", color: "red" }, { label: "Emails", value: "789", color: "green" }] },
    { label: "Fully Fund Business Emergency - $200k", current: "$70,000", target: "$200,000", pct: 35, due: "Dec 17th", projections: [{ label: "Projected Date", value: "Mar. 17/25" }], metrics: [{ label: "Overhead", value: "$79,941", color: "green" }, { label: "Profit", value: "$235K", color: "yellow" }] },
    { label: "500 New Sign Ups Per Month", current: "125", target: "500", pct: 25, due: "30th", projections: [{ label: "Projected Sign Ups", value: "350" }], metrics: [{ label: "Website", value: "67%", color: "green" }] },
  ]);

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
  zip: prof.zip ?? "", country: prof.country ?? "",
  avatar_url: prof.avatar_url ?? "",
  five_account_enabled: prof.five_account_enabled ?? false,
  health_green_multiplier: prof.health_green_multiplier ?? 1.0,
  health_yellow_multiplier: prof.health_yellow_multiplier ?? 0.5,
  health_red_multiplier: prof.health_red_multiplier ?? -1.0,
});
      setDbReady(true);
    }
    load();
  }, [userId]);

  // Auto-save
  useEffect(() => { if (userId && dbReady) saveUserData("sections", userId, sections); }, [sections, userId, dbReady]);
  useEffect(() => { if (userId && dbReady) saveUserData("tasks", userId, tasksData); }, [tasksData, userId, dbReady]);
  useEffect(() => { if (userId && dbReady) saveUserData("goals", userId, goalsData); }, [goalsData, userId, dbReady]);

  // Mobile
  useEffect(() => {
    const check = () => { const m = window.innerWidth < 768; setIsMobile(m); if (!m) setSidebarOpen(true); };
    check(); window.addEventListener("resize", check); return () => window.removeEventListener("resize", check);
  }, []);

  // When value changed in modal, update sections + history
  const handleValueChange = (newValue: string) => {
    if (!activeModal) return;
    const metricId = activeModal.metric.id;
    const numericVal = parseFloat(newValue.replace(/[^0-9.\-]/g, ""));
    setSections(prev => prev.map(s => ({
      ...s, metrics: s.metrics.map(m => {
        if (m.id !== metricId) return m;
        const newPoint: DataPoint = { timestamp: Date.now(), value: isNaN(numericVal) ? 0 : numericVal };
        return { ...m, value: newValue, history: [...(m.history ?? []), newPoint].slice(-50) };
      })
    })));
    setActiveModal(prev => prev ? { ...prev, metric: { ...prev.metric, value: newValue }, data: { ...prev.data, mainValue: newValue } } : null);
  };

  const handleClickMetric = (data: MetricModalData, metric: Metric) => setActiveModal({ data, metric });
  const handleEditFromModal = () => { if (activeModal) { setEditingMetricFromModal(activeModal.metric); setActiveModal(null); } };

  // Five-Account created from Settings — adds "Finances" row with all 5 boxes
  const handleFiveAccountCreated = useCallback(() => {
    setSections(prev => {
      // Don't duplicate if row already exists
      if (prev.find(s => s.title === "Finances")) return prev;
      const parentId = crypto.randomUUID();
      const childMetrics = FIVE_ACCOUNT_LABELS.map(label => {
        const accountType = label.toLowerCase() as any;
        const child = makeFiveAccountMetric(accountType, parentId);
        return { ...child, id: crypto.randomUUID() };
      });
      const newSection: Section = { id: crypto.randomUUID(), title: "Finances", avatars: [], metrics: childMetrics };
      return [...prev, newSection];
    });
  }, [setSections]);

  const handleNav = (p: Page) => { setPage(p); setSelectedApp(null); if (isMobile) setSidebarOpen(false); };

 const health = calculateHealth(
  sections,
  profile.health_green_multiplier,
  profile.health_yellow_multiplier,
  profile.health_red_multiplier
);

const sidebarEl = (
  <Sidebar active={page} onNav={handleNav} onClose={() => setSidebarOpen(false)}
    isMobile={isMobile} avatarUrl={profile.avatar_url}
    firstName={profile.full_name?.split(" ")[0] ?? ""}
    health={health} />
);

  if (!dbReady) return (
    <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", background: "linear-gradient(160deg,#2196F3 0%,#00BCD4 100%)", fontSize: 18, color: "#fff", fontFamily: "Inter, sans-serif" }}>
      Loading your dashboard...
    </div>
  );

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "'Inter',system-ui,sans-serif", background: "#F8FAFC", position: "relative" }}>
      {isMobile && sidebarOpen && <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 900 }} />}
      {sidebarOpen && (
        isMobile
          ? <div style={{ position: "fixed", left: 0, top: 0, bottom: 0, width: 240, zIndex: 1000 }}>
            {sidebarEl}
            <div onClick={() => setSidebarOpen(false)} style={{ position: "absolute", top: 14, right: -44, width: 34, height: 34, borderRadius: "50%", background: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,0.15)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 18, color: "#475569", zIndex: 1001 }}>×</div>
          </div>
          : sidebarEl
      )}

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* Top bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px clamp(10px,3vw,26px)", borderBottom: "1px solid #E8EDF2", background: "#fff", flexShrink: 0, flexWrap: "wrap" }}>
          {!sidebarOpen && (
            <div onClick={() => setSidebarOpen(true)} style={{ width: 34, height: 34, borderRadius: "50%", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", marginRight: 4, flexShrink: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {[0, 1, 2].map(i => <div key={i} style={{ width: 14, height: 2, background: "#475569", borderRadius: 2 }} />)}
              </div>
            </div>
          )}
          {page === "home" && (
            <div style={{ display: "flex", borderRadius: 8, border: "1px solid #e2e8f0", overflow: "hidden" }}>
              {["Row", "Column"].map((lbl, i) => (
                <div key={lbl} style={{ padding: "5px 13px", fontSize: 12, fontWeight: 500, cursor: "pointer", background: i === 0 ? "#3B82F6" : "#fff", color: i === 0 ? "#fff" : "#94a3b8" }}>{lbl}</div>
              ))}
            </div>
          )}
          <div style={{ flex: 1 }} />
          <div onClick={() => setShowChat(v => !v)} style={{ padding: "6px 16px", borderRadius: 20, border: "1px solid #e2e8f0", fontSize: 12, color: "#64748b", cursor: "pointer", background: showChat ? "#EFF6FF" : "#fff" }}>Chat</div>
          <div style={{ padding: "7px clamp(10px,2vw,20px)", borderRadius: 8, background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Customize</div>
        </div>

        {/* Pages */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {page === "home" && <HomePage sections={sections} setSections={setSections} onClickMetric={handleClickMetric} />}
          {page === "goals" && <div style={{ flex: 1, overflowY: "auto" }}><GoalsPage goals={goalsData} setGoals={setGoalsData} /></div>}
          {page === "tasks" && <div style={{ flex: 1, overflowY: "auto" }}><TasksPage tasks={tasksData} setTasks={setTasksData} /></div>}
          {page === "integrations" && <div style={{ flex: 1, overflowY: "auto" }}><IntegrationsPage onSelectApp={a => { setSelectedApp(a); setPage("app-detail"); }} /></div>}
          {page === "app-detail" && selectedApp && <div style={{ flex: 1, overflowY: "auto" }}><AppDetailPage app={selectedApp} onBack={() => setPage("integrations")} /></div>}
          {page === "team" && <div style={{ flex: 1, overflowY: "auto" }}><TeamPage /></div>}
          {page === "settings" && <div style={{ flex: 1, overflowY: "auto" }}><SettingsPage userId={userId!} userEmail={userEmail} onProfileSaved={p => setProfile(p)} onFiveAccountCreated={handleFiveAccountCreated} /></div>}
        </div>
      </div>

      {showChat && <ChatPanel sections={sections} onClose={() => setShowChat(false)} />}

      {activeModal && (
        <MetricModal data={activeModal.data} metric={activeModal.metric}
          onClose={() => setActiveModal(null)} onEdit={handleEditFromModal} onValueChange={handleValueChange} />
      )}

     {editingMetricFromModal && (() => {
        let foundSid: string | undefined;
        for (const s of sections) { if (s.metrics.find(m => m.id === editingMetricFromModal.id)) { foundSid = s.id; break; } }
        const foundSection = sections.find(s => s.id === foundSid);
        return (
          <MetricBoxSettingsModal initial={editingMetricFromModal}
            siblings={foundSection?.metrics ?? []}
            onSave={updated => {
              if (foundSid) setSections(prev => prev.map(s => s.id === foundSid ? { ...s, metrics: s.metrics.map(m => m.id === editingMetricFromModal.id ? { ...updated, id: m.id, history: m.history ?? [] } : m) } : s));
              setEditingMetricFromModal(null);
            }}
            onDelete={() => {
              if (foundSid) setSections(prev => prev.map(s => s.id === foundSid ? { ...s, metrics: s.metrics.filter(m => m.id !== editingMetricFromModal.id) } : s));
              setEditingMetricFromModal(null);
            }}
            onDuplicate={() => {
              if (foundSid) {
                const { id, fiveAccountParentId, ...rest } = editingMetricFromModal;
                setSections(prev => prev.map(s => s.id === foundSid ? { ...s, metrics: [...s.metrics, { ...rest, label: `${editingMetricFromModal.label} (copy)`, history: [], id: crypto.randomUUID() }] } : s));
              }
              setEditingMetricFromModal(null);
            }}
            onRecreateMissing={(missing) => {
              if (foundSid) {
                const groupId = editingMetricFromModal.fiveAccountParentId ?? editingMetricFromModal.id;
                setSections(prev => prev.map(s => {
                  if (s.id !== foundSid) return s;
                  const newMetrics = missing.map(label => {
                    const accountType = label.toLowerCase() as any;
                    return { ...makeFiveAccountMetric(accountType, groupId), id: crypto.randomUUID() };
                  });
                  return { ...s, metrics: [...s.metrics, ...newMetrics] };
                }));
              }
              setEditingMetricFromModal(null);
            }}
            onClose={() => setEditingMetricFromModal(null)} />
        );
      })()}
    </div>
  );
}
