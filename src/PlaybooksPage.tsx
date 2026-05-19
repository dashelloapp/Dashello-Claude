import { Node as TipTapNode, mergeAttributes } from "@tiptap/core";
import { useState, useRef, useEffect, useCallback, Fragment, useLayoutEffect } from "react";
import { useTranslation } from "./i18n";

const IframeExtension = TipTapNode.create({
  name: "iframe",
  group: "block",
  atom: true,
  addAttributes() {
    return { src: { default: null }, style: { default: "width:100%;height:315px;border:none;border-radius:0" }, allowfullscreen: { default: "true" } };
  },
  parseHTML() { return [{ tag: "iframe" }]; },
  renderHTML({ HTMLAttributes }) { return ["iframe", mergeAttributes(HTMLAttributes)]; },
});
import { useSmartPosition } from "./hooks/useSmartPosition";
import { supabase } from "./lib/supabase";
import * as PhosphorReact from "@phosphor-icons/react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import ImageExt from "@tiptap/extension-image";
import LinkExt from "@tiptap/extension-link";
import { Table as TableExt } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import Color from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

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

// ── Icon helpers ──────────────────────────────────────────────────────────
function IconGlyph({ name, size = 20, color = "#3B82F6", weight = "regular" }: {
  name: string; size?: number; color?: string; weight?: "thin" | "light" | "regular" | "bold" | "fill" | "duotone";
}) {
  if (!name) return null;
  const IconComponent = (PhosphorReact as any)[name];
  if (!IconComponent) {
    return <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block", flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" fill="none" /></svg>;
  }
  return <IconComponent size={size} color={color} weight={weight} style={{ display: "block", flexShrink: 0 }} />;
}

const ICON_NONE = "";
const PHOSPHOR_CATEGORIES: { label: string; icons: string[] }[] = [
  { label: "Finance", icons: ["CreditCard","Wallet","Money","Coins","Bank","Receipt","Invoice","Cardholder","CurrencyDollar","CurrencyEur","CurrencyGbp","CurrencyJpy","CurrencyKrw","CurrencyInr","CurrencyBtc","PiggyBank","Vault","HandCoins","HandDeposit","HandWithdraw","TrendUp","TrendDown","ChartLine","ChartBar","ChartPie","ChartDonut","Percent","Calculator","Briefcase","Buildings","ShoppingCart","ShoppingBag","Storefront","Tag","Barcode",] },
  { label: "Business", icons: ["Handshake","UsersThree","UserCircle","IdentificationCard","Suitcase","SuitcaseRolling","Target","Trophy","Medal","MedalMilitary","Star","StarFour","Crown","CrownSimple","Rocket","Lightbulb","Clipboard","ClipboardText","Files","FolderOpen","Folder","Archive","Bookmarks","BookmarkSimple","Table","Rows","Columns","SquaresFour","GridFour","ListBullets","ListChecks","ListNumbers","Notebook","Notepad","FileText","FilePdf","FileDoc","FileXls",] },
  { label: "Communication", icons: ["Envelope","EnvelopeOpen","EnvelopeSimple","Phone","PhoneCall","PhoneIncoming","PhoneOutgoing","ChatCircle","ChatCircleDots","ChatText","ChatTeardrop","Chats","ChatsCircle","Megaphone","MegaphoneSimple","Bell","BellRinging","BellSimple","Broadcast","Rss","Share","ShareNetwork","PaperPlaneTilt","At","Hash","Link","LinkSimple","Globe","GlobeHemisphereWest","GlobeHemisphereEast",] },
  { label: "Analytics", icons: ["ChartLineUp","ChartLineDown","ChartDonut","ChartBarHorizontal","ChartScatter","ChartPolar","ArrowUp","ArrowDown","ArrowRight","ArrowLeft","ArrowUUpRight","ArrowUUpLeft","ArrowsOut","ArrowsIn","ArrowsClockwise","ArrowsCounterClockwise","ArrowsLeftRight","ArrowsDownUp","Pulse","Gauge","Database","HardDrive","HardDrives","Cloud","CloudArrowUp","CloudArrowDown","CloudCheck","CloudX","MagnifyingGlass","MagnifyingGlassPlus","MagnifyingGlassMinus","Funnel","FunnelSimple","SortAscending","SortDescending",] },
  { label: "Status", icons: ["CheckCircle","XCircle","WarningCircle","Warning","Info","Question","Check","CheckFat","CheckSquare","X","XSquare","Plus","PlusCircle","Minus","MinusCircle","Lock","LockOpen","LockKey","Key","KeyReturn","Shield","ShieldCheck","ShieldWarning","Fire","FireSimple","Snowflake","Lightning","LightningSlash","Timer","Clock","ClockCountdown","Calendar","CalendarBlank","CalendarCheck","Alarm",] },
  { label: "People", icons: ["User","UserPlus","UserMinus","UserCheck","UserCircle","UserCirclePlus","UserCircleMinus","UserList","UserFocus","Users","UsersFour","UsersThree","PersonSimple","PersonSimpleRun","PersonSimpleWalk","PersonArmsSpread","Smiley","SmileyMeh","SmileySad","SmileyWink","SmileyAngry","SmileyNervous","SmileyXEyes","Heart","HeartStraight","HandHeart","Heartbeat","FirstAid","FirstAidKit","Stethoscope","Pill","Student","GraduationCap","Certificate","Scales","Gavel",] },
  { label: "Tools", icons: ["Gear","GearSix","GearFine","Wrench","Hammer","Screwdriver","Nut","Toolbox","Code","CodeSimple","CodeBlock","Terminal","TerminalWindow","Desktop","Laptop","DeviceMobile","DeviceTablet","Monitor","Printer","Camera","CameraPlus","Image","ImageSquare","ImagesSquare","PencilSimple","PencilLine","Pen","PenNib","Eraser","Trash","TrashSimple","Copy","CopySimple","MagicWand","PaintBrush","PaintBrushBroad","PaintBucket","Palette","Eyedropper",] },
  { label: "Nature", icons: ["Sun","SunDim","SunHorizon","Moon","MoonStars","CloudSun","CloudMoon","CloudRain","CloudSnow","CloudLightning","CloudFog","Rainbow","RainbowCloud","Tree","TreePalm","TreeEvergreen","Plant","Flower","FlowerLotus","FlowerTulip","Leaf","Cactus","Mountains","Waves","Drop","DropHalf","Fish","Bird","Butterfly","Dog","Cat","Cow","Horse","Rabbit",] },
  { label: "Transit", icons: ["Car","CarSimple","CarProfile","Taxi","Truck","Van","Motorcycle","Bicycle","Scooter","Bus","Train","TrainSimple","TrainRegional","Tram","Airplane","AirplaneTakeoff","AirplaneLanding","Rocket","Boat","Sailboat","RocketLaunch","MapPin","MapTrifold","NavigationArrow","Compass","Path","RoadHorizon","TrafficCone","TrafficSign","TrafficSignal",] },
  { label: "Food", icons: ["ForkKnife","CookingPot","BowlFood","Bread","Coffee","Hamburger","Pizza","Popcorn","FishSimple","BeerBottle","Wine","Knife","Cake","Cookie","OrangeSlice","Orange","IceCream","AppleLogo",] },
  { label: "Health", icons: ["Hospital","Syringe","Thermometer","TestTube","Flask","Dna","MaskHappy","HandSoap","HeartBreak","HeartHalf",] },
];
const ALL_PHOSPHOR_ICONS = PHOSPHOR_CATEGORIES.flatMap(c => c.icons);
const DISPLAY_CATEGORIES = [{ label: "All", icons: ALL_PHOSPHOR_ICONS }, ...PHOSPHOR_CATEGORIES];

function IconPicker({ selected, onSelect }: { selected: string; onSelect: (icon: string) => void }) {
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
      }}>No icon</div>
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
              style={{ height: 36, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                background: selected === ic ? "#EFF6FF" : "#f8fafc",
                border: selected === ic ? "1.5px solid #3B82F6" : "1.5px solid #e2e8f0" }}>
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

function autoSelectIcon(item: { type: string; files?: {type:string}[]; links?: unknown[]; content?: string }): string {
  if (item.type === "template") return "GitFork";
  if (item.type === "filled-template") return "Notebook";
  if (item.content) return "FileText";
  const f = item.files?.[0];
  if (f) {
    if (f.type.includes("pdf")) return "FilePdf";
    if (f.type.includes("word") || f.type.includes("document")) return "FileDoc";
    if (f.type.includes("image")) return "FileImage";
    return "FileDoc";
  }
  if (item.links && item.links.length > 0) return item.links.length === 1 ? "Link" : "Link";
  return "Notebook";
}

// ── Types ─────────────────────────────────────────────────────────────────
type TemplateFieldType = "text" | "textarea" | "checkbox" | "radio" | "info" | "fill-checklist" | "big-checklist" | "sync-checklist";
interface TemplateField {
  id: string;
  type: TemplateFieldType;
  header: string;
  description: string;
  placeholder: string;
  required: boolean;
  options?: string[];
  color: string;
  dateAutoFill?: boolean;
  dateFormat?: string;
  column?: 1 | 2;
  textSize?: number;
  checklistLayout?: "together" | "separate";
  bigChecklistMode?: "fill" | "option";
  checklistPredetermined?: boolean;
  checklistPredeterminedCount?: number;
  checkboxSubtype?: "checkbox" | "fill-checklist" | "big-checklist" | "sync-checklist";
  syncToTasks?: boolean;
}
type RecurrenceInterval = "daily" | "weekly" | "monthly" | "quarterly" | "semi-annually" | "yearly" | "custom";
interface RecurrenceConfig {
  enabled: boolean;
  interval: RecurrenceInterval;
  customDays?: number;
  lastReset?: string;
  nextReset?: string;
}
interface PlaybookFile {
  id: string;
  name: string;
  type: string;
  size: number;
  storagePath: string;
}
interface PlaybookLink {
  id: string;
  title: string;
  url: string;
}
interface PlaybookItem {
  id: string;
  label: string;
  icon: string;
  type: "document" | "template" | "filled-template";
  createdAt: string;
  content?: string;
  files?: PlaybookFile[];
  links?: PlaybookLink[];
  templateFields?: TemplateField[];
  templateId?: string;
  filledData?: Record<string, string>;
  columns?: 1 | 2;
  recurrence?: RecurrenceConfig;
}
interface PlaybookRow {
  id: string;
  title: string;
  items: PlaybookItem[];
}

// ── TipTap Rich Text Editor ───────────────────────────────────────────────
function MenuBar({ editor, showSource, onToggleSource }: { editor: any; showSource?: boolean; onToggleSource?: () => void }) {
  if (!editor) return null;
  const [showTablePicker, setShowTablePicker] = useState(false);
  const tablePickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (tablePickerRef.current && !tablePickerRef.current.contains(e.target as any)) setShowTablePicker(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);
  const addImage = () => {
    const url = window.prompt("Image URL");
    if (url) editor.chain().focus().setImage({ src: url }).run();
  };
  const addVideo = () => {
    const url = window.prompt("Video URL or iframe embed code\nSupports YouTube, Loom, Vimeo, Wistia, Skool, and any embeddable iframe");
    if (!url) return;
    if (url.startsWith("<iframe")) {
      editor.chain().focus().insertContent(url).run();
    } else {
      let embedUrl = url;
      const ytMatch = url.match(/(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?([a-zA-Z0-9_-]{11})/);
      if (ytMatch) embedUrl = `https://www.youtube.com/embed/${ytMatch[1]}`;
      const loomMatch = url.match(/loom\.com\/share\/([a-zA-Z0-9_-]+)/);
      if (loomMatch) embedUrl = `https://www.loom.com/embed/${loomMatch[1]}`;
      editor.chain().focus().insertContent(`<iframe src="${embedUrl}" style="width:100%;max-width:560px;height:315px;border:none;border-radius:8px" allowfullscreen></iframe>`).run();
    }
  };
  const insertDateShortcode = () => {
    editor.chain().focus().insertContent(`[today's date]`).run();
  };  
  const insertTable = (rows: number, cols: number) => {
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
    setShowTablePicker(false);
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 2, padding: "6px 8px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc", position: "relative" }}>
      <button key="bold" onClick={() => editor.chain().focus().toggleBold().run()} title="Bold"
        style={{ width: 28, height: 28, borderRadius: 4, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          background: editor.isActive("bold") ? "#dbeafe" : "transparent", color: editor.isActive("bold") ? "#3B82F6" : "#64748b" }}>
        <PhosphorReact.TextB size={16} color="currentColor" weight={editor.isActive("bold") ? "bold" : "regular"} /></button>
      <button key="italic" onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic"
        style={{ width: 28, height: 28, borderRadius: 4, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          background: editor.isActive("italic") ? "#dbeafe" : "transparent", color: editor.isActive("italic") ? "#3B82F6" : "#64748b" }}>
        <PhosphorReact.TextItalic size={16} color="currentColor" /></button>
      <button key="underline" onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline"
        style={{ width: 28, height: 28, borderRadius: 4, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          background: editor.isActive("underline") ? "#dbeafe" : "transparent", color: editor.isActive("underline") ? "#3B82F6" : "#64748b" }}>
        <PhosphorReact.TextUnderline size={16} color="currentColor" /></button>
      <div style={{ width: 1, background: "#e2e8f0", margin: "0 4px" }} />
      {[["H1",1],["H2",2],["H3",3],["P",0]].map(([l,level]) => (
        <button key={String(level)} onClick={() => level === 0 ? editor.chain().focus().setParagraph().run() : editor.chain().focus().toggleHeading({ level: level as 1|2|3 }).run()} title={level === 0 ? "Paragraph" : `Heading ${level}`}
          style={{ width: level === 0 ? 28 : 32, height: 28, borderRadius: 4, border: "none", cursor: "pointer", fontSize: level === 0 ? 11 : level === 1 ? 13 : level === 2 ? 12 : 11, fontWeight: level === 0 ? 400 : 700,
            background: level === 0 ? (editor.isActive("paragraph") ? "#dbeafe" : "transparent") : (editor.isActive("heading", { level }) ? "#dbeafe" : "transparent"),
            color: level === 0 ? (editor.isActive("paragraph") ? "#3B82F6" : "#64748b") : (editor.isActive("heading", { level }) ? "#3B82F6" : "#64748b") }}>{l}</button>
      ))}
      <div style={{ width: 1, background: "#e2e8f0", margin: "0 4px" }} />
      {[{a:"left"},{a:"center"},{a:"right"}].map(({a}) => (
        <button key={a} onClick={() => editor.chain().focus().setTextAlign(a).run()} title={`Align ${a}`}
          style={{ width: 28, height: 28, borderRadius: 4, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            background: editor.isActive({ textAlign: a }) ? "#dbeafe" : "transparent",
            color: editor.isActive({ textAlign: a }) ? "#3B82F6" : "#64748b" }}>
          <svg width="16" height="14" viewBox="0 0 16 14" fill="none">
            {a === "left" ? <>
              <rect x="0" y="0" width="14" height="2" rx="1" fill="currentColor" />
              <rect x="0" y="3" width="10" height="2" rx="1" fill="currentColor" />
              <rect x="0" y="6" width="15" height="2" rx="1" fill="currentColor" />
              <rect x="0" y="9" width="6" height="2" rx="1" fill="currentColor" />
              <rect x="0" y="12" width="12" height="2" rx="1" fill="currentColor" />
            </> : a === "center" ? <>
              <rect x="1" y="0" width="14" height="2" rx="1" fill="currentColor" />
              <rect x="3" y="3" width="10" height="2" rx="1" fill="currentColor" />
              <rect x="0.5" y="6" width="15" height="2" rx="1" fill="currentColor" />
              <rect x="5" y="9" width="6" height="2" rx="1" fill="currentColor" />
              <rect x="2" y="12" width="12" height="2" rx="1" fill="currentColor" />
            </> : <>
              <rect x="2" y="0" width="14" height="2" rx="1" fill="currentColor" />
              <rect x="6" y="3" width="10" height="2" rx="1" fill="currentColor" />
              <rect x="1" y="6" width="15" height="2" rx="1" fill="currentColor" />
              <rect x="10" y="9" width="6" height="2" rx="1" fill="currentColor" />
              <rect x="4" y="12" width="12" height="2" rx="1" fill="currentColor" />
            </>}
          </svg>
        </button>
      ))}
      <div style={{ width: 1, background: "#e2e8f0", margin: "0 4px" }} />
      <button onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list"
        style={{ width: 28, height: 28, borderRadius: 4, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          background: editor.isActive("bulletList") ? "#dbeafe" : "transparent", color: "#64748b" }}>
        <PhosphorReact.ListBullets size={16} color={editor.isActive("bulletList") ? "#3B82F6" : "currentColor"} /></button>
      <button onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list"
        style={{ width: 28, height: 28, borderRadius: 4, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          background: editor.isActive("orderedList") ? "#dbeafe" : "transparent", color: "#64748b" }}>
        <PhosphorReact.ListNumbers size={16} color={editor.isActive("orderedList") ? "#3B82F6" : "currentColor"} /></button>
      <div style={{ width: 1, background: "#e2e8f0", margin: "0 4px" }} />
      <button onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Quote"
        style={{ width: 28, height: 28, borderRadius: 4, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          background: editor.isActive("blockquote") ? "#dbeafe" : "transparent", color: "#64748b" }}>
        <PhosphorReact.Quotes size={16} color={editor.isActive("blockquote") ? "#3B82F6" : "currentColor"} /></button>
      <button onClick={addImage} title="Insert image"
        style={{ width: 28, height: 28, borderRadius: 4, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
        <PhosphorReact.Image size={16} color="currentColor" /></button>
      <button onClick={addVideo} title="Insert video (YouTube, Loom, Vimeo, iframe)"
        style={{ width: 28, height: 28, borderRadius: 4, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
        <PhosphorReact.VideoCamera size={16} color="currentColor" /></button>
      <button onClick={() => { const url = window.prompt("Link URL", "https://"); if (url) editor.chain().focus().setLink({ href: url }).run(); }} title="Add link"
        style={{ width: 28, height: 28, borderRadius: 4, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          background: editor.isActive("link") ? "#dbeafe" : "transparent", color: editor.isActive("link") ? "#3B82F6" : "#64748b" }}>
        <PhosphorReact.Link size={16} color={editor.isActive("link") ? "#3B82F6" : "currentColor"} /></button>
      <button onClick={insertDateShortcode} title="Insert today's date"
        style={{ width: 28, height: 28, borderRadius: 4, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
        <PhosphorReact.CalendarBlank size={16} color="currentColor" /></button>
      <div style={{ position: "relative" }} ref={tablePickerRef}>
        {showTablePicker && (() => {
          const rect = tablePickerRef.current?.getBoundingClientRect();
          return (
          <div style={{ position: "fixed", top: rect ? rect.bottom + 4 : 0, left: rect ? rect.left : 0, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid #e2e8f0", zIndex: 9999, padding: 12, minWidth: 180 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 8 }}>Insert Table</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
              <label style={{ fontSize: 15, color: "#1a2332" }}>Rows:
                <select id="table-rows" defaultValue={3} style={{ marginLeft: 4, padding: "2px 4px", borderRadius: 4, border: "1px solid #e2e8f0", fontSize: 15 }}>
                  {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 15, color: "#1a2332" }}>Cols:
                <select id="table-cols" defaultValue={3} style={{ marginLeft: 4, padding: "2px 4px", borderRadius: 4, border: "1px solid #e2e8f0", fontSize: 15 }}>
                  {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
            <button onClick={() => { const r = (document.getElementById("table-rows") as HTMLSelectElement)?.value; const c = (document.getElementById("table-cols") as HTMLSelectElement)?.value; if (r && c) insertTable(parseInt(r), parseInt(c)); }}
              style={{ width: "100%", padding: "6px 0", borderRadius: 6, border: "none", background: "#3B82F6", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Create</button>
          </div>
        );})()}
        <button onClick={() => { if (editor.isActive("table")) { editor.chain().focus().deleteTable().run(); } else { setShowTablePicker(!showTablePicker); } }} title="Table"
          style={{ width: 28, height: 28, borderRadius: 4, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            background: editor.isActive("table") ? "#dbeafe" : "transparent", color: "#64748b" }}>
          <PhosphorReact.Table size={16} color={editor.isActive("table") ? "#3B82F6" : "currentColor"} /></button>
      </div>
      <button onClick={() => onToggleSource?.()} title={showSource ? "Rich text mode" : "Source code mode"}
        style={{ width: 28, height: 28, borderRadius: 4, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          background: showSource ? "#dbeafe" : "transparent", color: showSource ? "#3B82F6" : "#64748b" }}>
        <PhosphorReact.Code size={16} color={showSource ? "#3B82F6" : "currentColor"} /></button>
      <div style={{ flex: 1 }} />
      <input type="color" value={editor.getAttributes("textStyle").color || "#000000"}
        onChange={e => editor.chain().focus().setColor(e.target.value).run()} title="Text color"
        style={{ width: 24, height: 24, padding: 0, border: "none", cursor: "pointer" }} />
    </div>
  );
}

function RichEditor({ content, onChange, placeholder }: {
  content: string; onChange: (html: string) => void; placeholder?: string;
}) {
  const { t: __ } = useTranslation();
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteResolve, setPasteResolve] = useState<((rich: boolean) => void) | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [sourceHtml, setSourceHtml] = useState(content || "");
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      ImageExt,
      LinkExt.configure({ openOnClick: true }),
      TableExt.configure({ resizable: true }),
      TableRow,
      TableCell.configure({ 
        HTMLAttributes: { style: "border:1px solid #d1d5db;padding:6px 10px" },
      }),
      TableHeader.configure({
        HTMLAttributes: { style: "border:1px solid #d1d5db;padding:6px 10px;background:#f8fafc;font-weight:600" },
      }),
      TextStyle, Color, Highlight,
      IframeExtension,
    ],
    content: content || "",
    onUpdate: ({ editor }) => { if (!showSource) onChange(editor.getHTML()); },
    editorProps: {
      attributes: { class: "prose" as string, style: "min-height: 280px; outline: none; cursor: text;" },
      handlePaste: (view, event) => {
        event.preventDefault();
        const html = event.clipboardData?.getData("text/html") || "";
        const text = event.clipboardData?.getData("text/plain") || "";
        if (!text && !html) return true;
        new Promise<void>(resolve => {
          setShowPasteModal(true);
          setPasteResolve(() => (rich: boolean) => {
            if (rich && html) {
              editor?.chain().focus().insertContent(html).run();
            } else {
              editor?.chain().focus().insertContent(text).run();
            }
            setShowPasteModal(false);
            setPasteResolve(null);
            resolve();
          });
        });
        return true;
      },
    },
  });

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content || "");
    }
  }, [content]);

  useEffect(() => {
    if (!showSource && editor && sourceHtml !== editor.getHTML()) {
      editor.commands.setContent(sourceHtml || "");
      onChange(sourceHtml);
    }
  }, [showSource]);

  return (
    <div style={{ border: "1.5px solid #e2e8f0", borderRadius: 10, overflow: "hidden", position: "relative" }}>
      <MenuBar editor={editor} showSource={showSource} onToggleSource={() => {
        if (!showSource && editor) {
          setSourceHtml(editor.getHTML());
        }
        setShowSource(v => !v);
      }} />
      {showSource ? (
        <textarea value={sourceHtml} onChange={e => { setSourceHtml(e.target.value); onChange(e.target.value); }}
          style={{ width: "100%", minHeight: 300, maxHeight: 500, padding: "12px 16px", border: "none", fontSize: 15, fontFamily: "'SF Mono','Fira Code',monospace", outline: "none", resize: "vertical", boxSizing: "border-box" }} />
      ) : (
      <div style={{ padding: "12px 16px", minHeight: 300, maxHeight: 500, overflowY: "auto", fontSize: 15, lineHeight: 1.6, color: "#1a2332", cursor: "text" }}
        onClick={() => editor?.chain().focus().run()}>
        <EditorContent editor={editor} />
      </div>
      )}
      {showPasteModal && (
        <div style={{ position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)", background: "#fff", borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.15)", border: "1px solid #e2e8f0", zIndex: 300, padding: 16, display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: "#1a2332" }}>{__('playbooks.pasteAs', 'Paste as:')}</span>
          <button onClick={() => pasteResolve?.(false)} style={{ padding: "6px 14px", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>{__('playbooks.plainText', 'Plain text')}</button>
          <button onClick={() => pasteResolve?.(true)} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#3B82F6", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{__('playbooks.richText', 'Rich text')}</button>
        </div>
      )}
    </div>
  );
}

function RichEditorSmall({ content, onChange }: { content: string; onChange: (html: string) => void }) {
  const { t: __ } = useTranslation();
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteResolve, setPasteResolve] = useState<((rich: boolean) => void) | null>(null);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      TextStyle, Color,
      LinkExt.configure({ openOnClick: true }),
      IframeExtension,
    ],
    content: content || "",
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: { style: "min-height: 40px; outline: none; cursor: text;" },
      handlePaste: (view, event) => {
        event.preventDefault();
        const html = event.clipboardData?.getData("text/html") || "";
        const text = event.clipboardData?.getData("text/plain") || "";
        if (!text && !html) return true;
        new Promise<void>(resolve => {
          setShowPasteModal(true);
          setPasteResolve(() => (rich: boolean) => {
            if (rich && html) {
              editor?.chain().focus().insertContent(html).run();
            } else {
              editor?.chain().focus().insertContent(text).run();
            }
            setShowPasteModal(false);
            setPasteResolve(null);
            resolve();
          });
        });
        return true;
      },
    },
  });
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content || "");
    }
  }, [content]);
  return (
    <div style={{ border: "1.5px solid #e2e8f0", borderRadius: 8, overflow: "hidden", position: "relative" }}
      onClick={() => editor?.chain().focus().run()}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 1, padding: "3px 6px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
        <button onClick={() => editor?.chain().focus().toggleBold().run()} title="Bold"
          style={{ width: 24, height: 24, borderRadius: 4, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            background: editor?.isActive("bold") ? "#dbeafe" : "transparent", color: editor?.isActive("bold") ? "#3B82F6" : "#64748b" }}>
          <PhosphorReact.TextB size={14} color="currentColor" weight={editor?.isActive("bold") ? "bold" : "regular"} /></button>
        <button onClick={() => editor?.chain().focus().toggleItalic().run()} title="Italic"
          style={{ width: 24, height: 24, borderRadius: 4, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            background: editor?.isActive("italic") ? "#dbeafe" : "transparent", color: editor?.isActive("italic") ? "#3B82F6" : "#64748b" }}>
          <PhosphorReact.TextItalic size={14} color="currentColor" /></button>
        <button onClick={() => editor?.chain().focus().toggleUnderline().run()} title="Underline"
          style={{ width: 24, height: 24, borderRadius: 4, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            background: editor?.isActive("underline") ? "#dbeafe" : "transparent", color: editor?.isActive("underline") ? "#3B82F6" : "#64748b" }}>
          <PhosphorReact.TextUnderline size={14} color="currentColor" /></button>
        <div style={{ width: 1, background: "#e2e8f0", margin: "0 2px" }} />
        {[["H1",1],["H2",2],["H3",3],["P",0]].map(([l,level]) => (
          <button key={String(level)} onClick={() => level === 0 ? editor?.chain().focus().setParagraph().run() : editor?.chain().focus().toggleHeading({ level: level as 1|2|3 }).run()} title={level === 0 ? "Paragraph" : `Heading ${level}`}
            style={{ padding: "0 4px", height: 24, borderRadius: 4, border: "none", cursor: "pointer", fontSize: level === 0 ? 9 : level === 1 ? 11 : level === 2 ? 10 : 9, fontWeight: level === 0 ? 400 : 700,
              background: level === 0 ? (editor?.isActive("paragraph") ? "#dbeafe" : "transparent") : (editor?.isActive("heading", { level }) ? "#dbeafe" : "transparent"),
              color: level === 0 ? (editor?.isActive("paragraph") ? "#3B82F6" : "#64748b") : (editor?.isActive("heading", { level }) ? "#3B82F6" : "#64748b") }}>{l}</button>
        ))}
        <div style={{ width: 1, background: "#e2e8f0", margin: "0 2px" }} />
        {[{a:"left"},{a:"center"},{a:"right"}].map(({a}) => (
          <button key={a} onClick={() => editor?.chain().focus().setTextAlign(a).run()} title={`Align ${a}`}
            style={{ width: 24, height: 24, borderRadius: 4, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              background: editor?.isActive({ textAlign: a }) ? "#dbeafe" : "transparent",
              color: editor?.isActive({ textAlign: a }) ? "#3B82F6" : "#64748b" }}>
            <svg width="14" height="12" viewBox="0 0 14 12" fill="none">
              {a === "left" ? <>
                <rect x="0" y="0" width="12" height="1.6" rx="0.8" fill="currentColor" />
                <rect x="0" y="2.6" width="8" height="1.6" rx="0.8" fill="currentColor" />
                <rect x="0" y="5.2" width="13" height="1.6" rx="0.8" fill="currentColor" />
                <rect x="0" y="7.8" width="5" height="1.6" rx="0.8" fill="currentColor" />
                <rect x="0" y="10.4" width="10" height="1.6" rx="0.8" fill="currentColor" />
              </> : a === "center" ? <>
                <rect x="1" y="0" width="12" height="1.6" rx="0.8" fill="currentColor" />
                <rect x="3" y="2.6" width="8" height="1.6" rx="0.8" fill="currentColor" />
                <rect x="0.5" y="5.2" width="13" height="1.6" rx="0.8" fill="currentColor" />
                <rect x="4.5" y="7.8" width="5" height="1.6" rx="0.8" fill="currentColor" />
                <rect x="2" y="10.4" width="10" height="1.6" rx="0.8" fill="currentColor" />
              </> : <>
                <rect x="2" y="0" width="12" height="1.6" rx="0.8" fill="currentColor" />
                <rect x="6" y="2.6" width="8" height="1.6" rx="0.8" fill="currentColor" />
                <rect x="1" y="5.2" width="13" height="1.6" rx="0.8" fill="currentColor" />
                <rect x="9" y="7.8" width="5" height="1.6" rx="0.8" fill="currentColor" />
                <rect x="4" y="10.4" width="10" height="1.6" rx="0.8" fill="currentColor" />
              </>}
            </svg>
          </button>
        ))}
        <div style={{ width: 1, background: "#e2e8f0", margin: "0 2px" }} />
        <button onClick={() => editor?.chain().focus().toggleBulletList().run()} title="Bullet list"
          style={{ width: 24, height: 24, borderRadius: 4, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            background: editor?.isActive("bulletList") ? "#dbeafe" : "transparent", color: "#64748b" }}>
          <PhosphorReact.ListBullets size={14} color={editor?.isActive("bulletList") ? "#3B82F6" : "currentColor"} /></button>
        <button onClick={() => editor?.chain().focus().toggleOrderedList().run()} title="Numbered list"
          style={{ width: 24, height: 24, borderRadius: 4, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            background: editor?.isActive("orderedList") ? "#dbeafe" : "transparent", color: "#64748b" }}>
          <PhosphorReact.ListNumbers size={14} color={editor?.isActive("orderedList") ? "#3B82F6" : "currentColor"} /></button>
        <div style={{ width: 1, background: "#e2e8f0", margin: "0 2px" }} />
        <button onClick={() => editor?.chain().focus().toggleBlockquote().run()} title="Quote"
          style={{ width: 24, height: 24, borderRadius: 4, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            background: editor?.isActive("blockquote") ? "#dbeafe" : "transparent", color: "#64748b" }}>
          <PhosphorReact.Quotes size={14} color={editor?.isActive("blockquote") ? "#3B82F6" : "currentColor"} /></button>
        <button onClick={() => { const url = window.prompt("Image URL"); if (url) editor?.chain().focus().setImage({ src: url }).run(); }} title="Insert image"
          style={{ width: 24, height: 24, borderRadius: 4, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
          <PhosphorReact.Image size={14} color="currentColor" /></button>
        <button onClick={() => { const url = window.prompt("Video URL or iframe embed code"); if (url) { if (url.startsWith("<iframe")) { editor?.chain().focus().insertContent(url).run(); } else { let embed = url; const yt = url.match(/(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?([a-zA-Z0-9_-]{11})/); if (yt) embed = `https://www.youtube.com/embed/${yt[1]}`; const lm = url.match(/loom\.com\/share\/([a-zA-Z0-9_-]+)/); if (lm) embed = `https://www.loom.com/embed/${lm[1]}`; editor?.chain().focus().insertContent(`<iframe src="${embed}" style="width:100%;max-width:560px;height:315px;border:none;border-radius:8px" allowfullscreen></iframe>`).run(); } }} } title="Insert video"
          style={{ width: 24, height: 24, borderRadius: 4, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
          <PhosphorReact.VideoCamera size={14} color="currentColor" /></button>
        <button onClick={() => { const url = window.prompt("Link URL", "https://"); if (url) editor?.chain().focus().setLink({ href: url }).run(); }} title="Add link"
          style={{ width: 24, height: 24, borderRadius: 4, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            background: editor?.isActive("link") ? "#dbeafe" : "transparent", color: editor?.isActive("link") ? "#3B82F6" : "#64748b" }}>
          <PhosphorReact.Link size={14} color={editor?.isActive("link") ? "#3B82F6" : "currentColor"} /></button>
        <button onClick={() => editor?.chain().focus().insertContent(`[today's date]`).run()} title="Insert today's date"
          style={{ width: 24, height: 24, borderRadius: 4, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
          <PhosphorReact.CalendarBlank size={14} color="currentColor" /></button>
        <button onClick={() => editor?.chain().focus().toggleCodeBlock().run()} title="Code block"
          style={{ width: 24, height: 24, borderRadius: 4, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            background: editor?.isActive("codeBlock") ? "#dbeafe" : "transparent", color: editor?.isActive("codeBlock") ? "#3B82F6" : "#64748b" }}>
          <PhosphorReact.Code size={14} color={editor?.isActive("codeBlock") ? "#3B82F6" : "currentColor"} /></button>
        <input type="color" value={editor?.getAttributes("textStyle").color || "#000000"}
          onChange={e => editor?.chain().focus().setColor(e.target.value).run()}
          style={{ width: 18, height: 18, padding: 0, border: "none", cursor: "pointer", marginLeft: "auto" }} />
      </div>
      <div style={{ padding: "6px 10px", minHeight: 60, fontSize: 15, lineHeight: 1.5, cursor: "text" }}>
        <EditorContent editor={editor} />
      </div>
      {showPasteModal && (
        <div style={{ position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)", background: "#fff", borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.15)", border: "1px solid #e2e8f0", zIndex: 300, padding: 12, display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: "#1a2332" }}>{__('playbooks.pasteAs', 'Paste as:')}</span>
          <button onClick={() => pasteResolve?.(false)} style={{ padding: "4px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>{__('playbooks.plainText', 'Plain text')}</button>
          <button onClick={() => pasteResolve?.(true)} style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: "#3B82F6", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{__('playbooks.richText', 'Rich text')}</button>
        </div>
      )}
    </div>
  );
}

// ── PDF Generation ────────────────────────────────────────────────────────
async function downloadPdf(elementId: string, filename: string) {
  const el = document.getElementById(elementId);
  if (!el) return;
  try {
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, logging: false, allowTaint: true, height: el.scrollHeight, windowHeight: el.scrollHeight });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF("p", "in", "letter");
    const margin = 0.75;
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const pdfW = pageW - margin * 2;
    const pdfH = (canvas.height * pdfW) / canvas.width;
    const pageContentH = pageH - margin * 2;
    if (pdfH <= pageContentH) {
      pdf.addImage(imgData, "PNG", margin, margin, pdfW, pdfH);
    } else {
      let remaining = pdfH;
      let srcY = 0;
      const pageImgH = (pageContentH * canvas.width) / pdfW;
      let pageNum = 0;
      while (remaining > 0) {
        if (pageNum > 0) pdf.addPage();
        const h = Math.min(pageImgH, canvas.height - srcY);
        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = canvas.width;
        pageCanvas.height = h;
        const ctx = pageCanvas.getContext("2d");
        if (!ctx) break;
        ctx.drawImage(canvas, 0, srcY, canvas.width, h, 0, 0, canvas.width, h);
        const pageData = pageCanvas.toDataURL("image/png");
        const renderH = (h * pdfW) / canvas.width;
        pdf.addImage(pageData, "PNG", margin, margin, pdfW, renderH);
        srcY += h;
        remaining -= h;
        pageNum++;
      }
    }
    pdf.save(filename);
  } catch {}
}

// ── Upload helper ─────────────────────────────────────────────────────────
async function uploadFile(file: File, userId: string, itemId: string): Promise<PlaybookFile | null> {
  try {
    const path = `${userId}/${itemId}/${file.name}`;
    const { error } = await supabase.storage.from("playbooks").upload(path, file, { upsert: true });
    if (error) throw error;
    return { id: crypto.randomUUID(), name: file.name, type: file.type, size: file.size, storagePath: path };
  } catch { return null; }
}

function getFileUrl(path: string) {
  const { data } = supabase.storage.from("playbooks").getPublicUrl(path);
  return data.publicUrl;
}

function renderShortcodes(html: string): string {
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  return html.replace(/\[today's date\]/g, today);
}

function getDateString(format: string, date?: Date): string {
  const d = date || new Date();
  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const pad = (n: number) => String(n).padStart(2, "0");
  const ordinal = (n: number) => {
    if (n > 3 && n < 21) return n + "th";
    switch (n % 10) { case 1: return n + "st"; case 2: return n + "nd"; case 3: return n + "rd"; default: return n + "th"; }
  };
  const tokens: [RegExp, string][] = [
    [/dddd/g, days[d.getDay()]],
    [/MMMM/g, months[d.getMonth()]],
    [/MMM/g, months[d.getMonth()].slice(0, 3)],
    [/Do/g, ordinal(d.getDate())],
    [/DD/g, pad(d.getDate())],
    [/D(?!\w)/g, String(d.getDate())],
    [/YYYY/g, String(d.getFullYear())],
    [/YY(?!\w)/g, String(d.getFullYear()).slice(-2)],
    [/MM/g, pad(d.getMonth() + 1)],
    [/M(?!\w)/g, String(d.getMonth() + 1)],
  ];
  return tokens.reduce((str, [re, val]) => str.replace(re, val), format);
}

  const renderChecklistPreview = (data: string | undefined, options?: string[], layout?: string, __: (k: string, f?: string) => string = () => "") => {
    if (!data) return <span style={{ color: "#cbd5e1", fontStyle: "italic" }}>{__('playbooks.noItems', 'No items')}</span>;
    if (layout === "separate" && options) {
      const selected = new Set(data.split(",").filter(Boolean));
      const hasAny = options.some((_, oi) => selected.has(`opt-${oi}`));
      if (!hasAny) return <span style={{ color: "#cbd5e1", fontStyle: "italic" }}>{__('playbooks.noItems', 'No items')}</span>;
      return options.map((opt, oi) => selected.has(`opt-${oi}`) ? (
        <div key={oi} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2, fontSize: 15, textDecoration: "line-through", color: "#94a3b8" }}>
          <span>☑</span> {opt}
        </div>
      ) : null);
    }
    try {
      const arr = JSON.parse(data);
      if (!Array.isArray(arr) || arr.length === 0) return <span style={{ color: "#cbd5e1", fontStyle: "italic" }}>{__('playbooks.noItems', 'No items')}</span>;
      return arr.filter((x: any) => x.text).map((x: any, xi: number) => (
        <div key={xi} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2, fontSize: 15, textDecoration: x.checked ? "line-through" : "none", color: x.checked ? "#94a3b8" : "#1a2332" }}>
          <span>{x.checked ? "☑" : "☐"}</span> {x.text}
        </div>
      ));
    } catch { return <span style={{ color: "#cbd5e1", fontStyle: "italic" }}>{__('playbooks.noItems', 'No items')}</span>; }
  };

  // ── Row Menu (smart-positioned ··· dropdown) ────────────────────────────
  function RowMenu({ row, onDelete }: { row: { id: string; title: string }; onDelete: (id: string) => void }) {
    const { t: __ } = useTranslation();
    const [showMenu, setShowMenu] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const triggerRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const { style: menuPos } = useSmartPosition(triggerRef, menuRef, showMenu, { top: 36 });

    useEffect(() => {
      const h = (e: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(e.target as any)) { setShowMenu(false); setConfirmDelete(false); }
      };
      document.addEventListener("mousedown", h);
      return () => document.removeEventListener("mousedown", h);
    }, []);

    return (
      <div style={{ position: "relative" }}>
        <div ref={triggerRef} onClick={() => setShowMenu(v => !v)}
          style={{ width: 26, height: 26, borderRadius: "50%", background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 15, color: "#94a3b8" }}>···</div>
        {showMenu && (
          <div ref={menuRef} style={{ ...menuPos, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid #e2e8f0", zIndex: 100, minWidth: 160, overflow: "hidden" }}>
            {!confirmDelete ? (
              <div onClick={() => setConfirmDelete(true)}
                style={{ padding: "9px 14px", fontSize: 15, cursor: "pointer", color: "#E85D75" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#fff5f5")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>Delete row</div>
            ) : (
              <div style={{ padding: "10px 14px" }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#E85D75", marginBottom: 8 }}>Delete "{row.title}"?</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => setConfirmDelete(false)}
                    style={{ flex: 1, padding: "5px 0", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>{__('common.cancel', 'Cancel')}</button>
                  <button onClick={() => { onDelete(row.id); }}
                    style={{ flex: 1, padding: "5px 0", borderRadius: 6, border: "none", background: "#E85D75", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{__('common.delete', 'Delete')}</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

// ── Demo Data Seeding (trigger with /#seed) ────────────────────────────
async function seedDemoData(userId: string, existingRows: PlaybookRow[], setRows: (rows: PlaybookRow[]) => void) {
  if (existingRows.some(r => r.items.some(i => i.label === "Client Intake"))) return;
  const uid = () => crypto.randomUUID();
  const newRows: PlaybookRow[] = [
    { id: uid(), title: "Templates", items: [
      { id: uid(), label: "Client Intake", icon: "ClipboardText", type: "template" as const, createdAt: new Date().toISOString(),
        templateFields: [
          { id: uid(), type: "text" as const, header: "Full Name", placeholder: "Enter full name", required: true, color: "#1a2332", column: 1 as const, description: "", options: undefined, dateAutoFill: undefined, dateFormat: undefined, textSize: undefined, checklistLayout: undefined, bigChecklistMode: undefined, checklistPredetermined: undefined, checklistPredeterminedCount: undefined, checkboxSubtype: undefined, syncToTasks: undefined },
          { id: uid(), type: "text" as const, header: "Email", placeholder: "email@example.com", required: true, color: "#1a2332", column: 1 as const, description: "", options: undefined, dateAutoFill: undefined, dateFormat: undefined, textSize: undefined, checklistLayout: undefined, bigChecklistMode: undefined, checklistPredetermined: undefined, checklistPredeterminedCount: undefined, checkboxSubtype: undefined, syncToTasks: undefined },
          { id: uid(), type: "textarea" as const, header: "Goals", placeholder: "Describe your coaching goals...", color: "#1a2332", column: 1 as const, description: "", options: undefined, dateAutoFill: undefined, dateFormat: undefined, textSize: undefined, checklistLayout: undefined, bigChecklistMode: undefined, checklistPredetermined: undefined, checklistPredeterminedCount: undefined, checkboxSubtype: undefined, syncToTasks: undefined, required: false },
        ],
      },
    ]},
  ];
  const merged = [...existingRows];
  for (const row of newRows) {
    const existing = merged.find(r => r.title === row.title);
    if (existing) existing.items.push(...row.items);
    else merged.push(row);
  }
  setRows(merged);
  await saveUserData("playbooks", userId, merged);
}

// ── Main Component ────────────────────────────────────────────────────────
  export function PlaybooksPage({ userId, tasks, setTasks, userEmail }: {
    userId: string | null;
    tasks?: { id: string; text: string; done: boolean; priority?: boolean; assignedTo: string; createdBy: string; createdAt: string; linkedMetricId?: string; linkedGoalId?: string; dueDate?: string }[];
    setTasks?: React.Dispatch<React.SetStateAction<any[]>>;
    userEmail?: string;
  }) {
  const { t: __ } = useTranslation();
  const [rows, setRows] = useState<PlaybookRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Navigation within playbooks page
  const [subView, setSubView] = useState<"list" | "template-builder" | "template-fill">("list");
  const [editItem, setEditItem] = useState<PlaybookItem | null>(null);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);

  // Creation workflow state
  const [showCreate, setShowCreate] = useState(false);
  const [createRowId, setCreateRowId] = useState<string | null>(null);
  const [createStep, setCreateStep] = useState(0);
  const [createName, setCreateName] = useState("");
  const [createIcon, setCreateIcon] = useState("");
  const [createType, setCreateType] = useState<"document" | "template" | null>(null);
  const [createDocMode, setCreateDocMode] = useState<"editor" | "file" | null>(null);
  const [createContent, setCreateContent] = useState("");
  const [createFiles, setCreateFiles] = useState<PlaybookFile[]>([]);
  const [createLinks, setCreateLinks] = useState<PlaybookLink[]>([]);
  const [createTemplateFields, setCreateTemplateFields] = useState<TemplateField[]>([]);
  const createFieldDragRef = useRef<string | null>(null);
  const [createFieldDragOver, setCreateFieldDragOver] = useState<string | null>(null);
  const [createUploading, setCreateUploading] = useState(false);
  const [createColumns, setCreateColumns] = useState<1 | 2>(1);
  const [createLayout, setCreateLayout] = useState<1 | 2>(1);
  const [createRecurrence, setCreateRecurrence] = useState<RecurrenceConfig>({ enabled: false, interval: "monthly" });
  const [editTemplateId, setEditTemplateId] = useState<string | null>(null);
  const [createDeleteConfirm, setCreateDeleteConfirm] = useState(false);
  const handleDeleteTemplate = async () => {
    if (!editTemplateId) return;
    const updated = rows.map(r => ({ ...r, items: r.items.filter(i => i.id !== editTemplateId) })).filter(r => r.items.length > 0);
    setRows(updated);
    if (userId) await saveUserData("playbooks", userId, updated);
    setSubView("list");
    resetCreate();
  };
  const handleDuplicateTemplate = async () => {
    if (!editTemplateId) return;
    const existing = rows.flatMap(r => r.items).find(i => i.id === editTemplateId);
    if (!existing) return;
    const dup: PlaybookItem = { ...existing, id: crypto.randomUUID(), label: existing.label + " (Copy)", createdAt: new Date().toISOString() };
    const updated = rows.map(r => r.items.some(i => i.id === editTemplateId) ? { ...r, items: [...r.items, dup] } : r);
    setRows(updated);
    if (userId) await saveUserData("playbooks", userId, updated);
    setSubView("list");
    resetCreate();
  };
  // Template fill state
  const [fillTemplateId, setFillTemplateId] = useState<string | null>(null);
  const [fillTemplateRowId, setFillTemplateRowId] = useState<string | null>(null);
  const [fillData, setFillData] = useState<Record<string, string>>({});

  // Detail / edit modals
  const [detailItem, setDetailItem] = useState<PlaybookItem | null>(null);
  const [detailFillData, setDetailFillData] = useState<Record<string,string>>({});
  const [detailSaveStatus, setDetailSaveStatus] = useState<"" | "saving" | "saved">("");
  const detailFillTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const autoSaveDetail = useCallback(() => {
    if (detailFillTimerRef.current) clearTimeout(detailFillTimerRef.current);
    detailFillTimerRef.current = setTimeout(async () => {
      setDetailSaveStatus("saving");
      const item = detailItem;
      if (!item) return;
      const rid = rows.find(r => r.items.some(i => i.id === item.id))?.id;
      if (!rid) return;
      const updated = rows.map(r => r.id === rid ? { ...r, items: r.items.map(i => i.id === item.id ? { ...i, filledData: detailFillData } : i) } : r);
      setRows(updated);
      if (userId) await saveUserData("playbooks", userId, updated);
      setDetailSaveStatus("saved");
      setTimeout(() => setDetailSaveStatus(""), 2000);
    }, 600);
  }, [detailItem, detailFillData, rows, userId]);
  const [editSettingsItem, setEditSettingsItem] = useState<PlaybookItem | null>(null);
  const [editSettingsName, setEditSettingsName] = useState("");
  const [editSettingsIcon, setEditSettingsIcon] = useState("");

  // Drag states
  const dragItemRef = useRef<{ rowId: string; itemId: string } | null>(null);
  const dragRowRef = useRef<string | null>(null);
  const [dragItemState, setDragItemState] = useState<{ rowId: string; itemId: string } | null>(null);
  const [dragOverItem, setDragOverItem] = useState<{ rowId: string; itemId: string } | null>(null);
  const [dragOverRow, setDragOverRow] = useState<string | null>(null);
  const [showRowModal, setShowRowModal] = useState(false);
  const [rowModalInitial, setRowModalInitial] = useState("");
  const [rowModalCallback, setRowModalCallback] = useState<((name: string) => void) | null>(null);
  const [editingRowTitle, setEditingRowTitle] = useState<string | null>(null);
  const [editingRowTitleValue, setEditingRowTitleValue] = useState("");

   // ── Init & Save ──────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      if (!userId) { setLoading(false); return; }
      const saved = await loadUserData("playbooks", userId);
      if (saved && Array.isArray(saved) && saved.length > 0) {
        setRows(saved);
      } else {
        const defaultRow = { id: crypto.randomUUID(), title: "Playbooks", items: [] };
        setRows([defaultRow]);
        if (userId) await saveUserData("playbooks", userId, [defaultRow]);
      }
      setLoading(false);
      // Check if we should seed demo data (triggered by hash or initial load with no playbooks)
      if (typeof window !== "undefined" && window.location.hash === "#seed") {
        window.location.hash = "";
        await seedDemoData(userId, rows, setRows);
      }
    })();
  }, [userId]);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    if (!userId || loading) return;
    const timer = setTimeout(() => {
      saveUserData("playbooks", userId, rowsRef.current);
    }, 300);
    return () => clearTimeout(timer);
  }, [rows, userId, loading]);

  // Save on unmount
  useEffect(() => {
    return () => {
      if (userId && rowsRef.current.length > 0) {
        saveUserData("playbooks", userId, rowsRef.current);
      }
    };
  }, [userId]);

  // ── Row management ────────────────────────────────────────────────────
  const addRow = async (name: string) => {
    const u = [...rows, { id: crypto.randomUUID(), title: name, items: [] }];
    setRows(u);
    if (userId) await saveUserData("playbooks", userId, u);
  };
  const renameRow = async (rid: string, name: string) => {
    const u = rows.map(r => r.id === rid ? { ...r, title: name } : r);
    setRows(u);
    if (userId) await saveUserData("playbooks", userId, u);
  };
  const removeRow = async (rid: string) => {
    const u = rows.filter(r => r.id !== rid);
    setRows(u);
    if (userId) await saveUserData("playbooks", userId, u);
  };



  // ── Drag and drop (items) ─────────────────────────────────────────────
  const handleItemDragStart = useCallback((rid: string, iid: string) => {
    dragItemRef.current = { rowId: rid, itemId: iid };
    setDragItemState({ rowId: rid, itemId: iid });
  }, []);
  const handleItemDragEnter = useCallback((targetRid: string, targetIid: string) => {
    if (!dragItemRef.current) return;
    setDragOverItem({ rowId: targetRid, itemId: targetIid });
  }, []);
  const handleItemDrop = useCallback((targetRid: string, targetIid: string) => {
    const src = dragItemRef.current;
    if (!src) { setDragItemState(null); setDragOverItem(null); return; }
    if (src.rowId === targetRid && src.itemId === targetIid) {
      dragItemRef.current = null; setDragItemState(null); setDragOverItem(null); return;
    }
    const prev = rowsRef.current;
    const srcRow = prev.find(r => r.id === src.rowId);
    if (!srcRow) { dragItemRef.current = null; setDragItemState(null); setDragOverItem(null); return; }
    const moving = srcRow.items.find(i => i.id === src.itemId);
    if (!moving) { dragItemRef.current = null; setDragItemState(null); setDragOverItem(null); return; }
    const without = prev.map(r => r.id === src.rowId ? { ...r, items: r.items.filter(i => i.id !== src.itemId) } : r);
    const updated = without.map(r => {
      if (r.id !== targetRid) return r;
      if (targetIid === "__end__") return { ...r, items: [...r.items, moving] };
      const idx = r.items.findIndex(i => i.id === targetIid);
      if (idx === -1) return { ...r, items: [...r.items, moving] };
      const items = [...r.items];
      items.splice(idx, 0, moving);
      return { ...r, items };
    });
    setRows(updated);
    if (userId) saveUserData("playbooks", userId, updated);
    dragItemRef.current = null; setDragItemState(null); setDragOverItem(null);
  }, [userId]);

  // ── Drag and drop (rows) ──────────────────────────────────────────────
  const handleRowDragStart = useCallback((rid: string) => {
    dragRowRef.current = rid; setDragItemState(null);
  }, []);
  const handleRowDragEnter = useCallback((targetRid: string) => {
    if (!dragRowRef.current || dragRowRef.current === targetRid) return;
    setDragOverRow(targetRid);
  }, []);
  const handleRowDrop = useCallback((targetRid: string) => {
    const from = dragRowRef.current;
    if (!from || from === targetRid) { dragRowRef.current = null; setDragOverRow(null); return; }
    const arr = [...rowsRef.current];
    const fi = arr.findIndex(r => r.id === from);
    const ti = arr.findIndex(r => r.id === targetRid);
    if (fi === -1 || ti === -1) { dragRowRef.current = null; setDragOverRow(null); return; }
    const [moved] = arr.splice(fi, 1);
    arr.splice(ti, 0, moved);
    setRows(arr);
    if (userId) saveUserData("playbooks", userId, arr);
    dragRowRef.current = null; setDragOverRow(null);
  }, [userId]);
  const handleDragEnd = useCallback(() => {
    dragItemRef.current = null; dragRowRef.current = null;
    setDragItemState(null); setDragOverItem(null); setDragOverRow(null);
  }, []);

  // ── Creation helpers ──────────────────────────────────────────────────
  const resetCreate = () => {
    setCreateStep(0); setCreateName(""); setCreateType(null); setCreateDocMode(null);
    setCreateContent(""); setCreateFiles([]); setCreateLinks([]); setCreateTemplateFields([]);
    setShowCreate(false); setCreateRowId(null);
    setCreateColumns(1); setCreateLayout(1); setCreateRecurrence({ enabled: false, interval: "monthly" });
    setCreateIcon(""); setEditTemplateId(null);
  };
  const handleCreateSave = async () => {
    if (!createName.trim() || !createRowId || !createType) return;
    if (editTemplateId) {
      // Update existing template
      const iconValue = createIcon || autoSelectIcon({ type: "template", files: [], links: [], content: "" });
      const updated = rows.map(r => ({
        ...r,
        items: r.items.map(i => i.id === editTemplateId ? {
          ...i,
          label: createName.trim(),
          icon: iconValue,
          templateFields: createTemplateFields.length > 0 ? createTemplateFields : undefined,
          columns: createLayout === 2 || createTemplateFields.some(f => (f.column || 1) === 2) ? 2 as const : 1 as const,
          recurrence: createRecurrence.enabled ? createRecurrence : undefined,
        } : i),
      }));
      setRows(updated);
      if (userId) await saveUserData("playbooks", userId, updated);
      setSubView("list");
      resetCreate();
      return;
    }
    const newItem: PlaybookItem = {
      id: crypto.randomUUID(), label: createName.trim(),
      icon: createIcon || ICON_NONE, type: createType,
      createdAt: new Date().toISOString(),
      content: createContent || undefined,
      files: createFiles.length > 0 ? createFiles : undefined,
      links: createLinks.length > 0 ? createLinks : undefined,
      templateFields: createType === "template" && createTemplateFields.length > 0 ? createTemplateFields : undefined,
      columns: createType === "template" ? (createLayout === 2 || createTemplateFields.some(f => (f.column || 1) === 2) ? 2 : 1 as const) : undefined,
      recurrence: createType === "template" && createRecurrence.enabled ? createRecurrence : undefined,
    };
    if (!createIcon) newItem.icon = autoSelectIcon(newItem);
    let updated: PlaybookRow[];
    if (createType === "template") {
      const existingRow = rows.find(r => r.title === "Templates");
      if (existingRow) {
        updated = rows.map(r => r.id === existingRow.id ? { ...r, items: [...r.items, newItem] } : r);
      } else {
        updated = [...rows, { id: crypto.randomUUID(), title: "Templates", items: [newItem] }];
      }
    } else {
      updated = rows.map(r => r.id === createRowId ? { ...r, items: [...r.items, newItem] } : r);
    }
    setRows(updated);
    if (userId) await saveUserData("playbooks", userId, updated);
    if (createType === "template") setSubView("list");
    resetCreate();
  };
  const handleCreateFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    if (file.size > 25 * 1024 * 1024) { alert("File must be under 25MB"); return; }
    setCreateUploading(true);
    const result = await uploadFile(file, userId, "temp");
    if (result) setCreateFiles(p => [...p, result]);
    setCreateUploading(false);
  };
  const handleCreateAddLink = () => {
    setCreateLinks(p => [...p, { id: crypto.randomUUID(), title: "", url: "" }]);
  };
  const updateCreateLink = (id: string, updates: Partial<PlaybookLink>) => {
    setCreateLinks(p => p.map(l => l.id === id ? { ...l, ...updates } : l));
  };
  const removeCreateLink = (id: string) => {
    setCreateLinks(p => p.filter(l => l.id !== id));
  };

  // ── Template fill helpers ─────────────────────────────────────────────
  const startFill = (item: PlaybookItem, rid: string) => {
    // Initialize fillData
    const fd: Record<string, string> = {};
    item.templateFields?.forEach(f => {
      fd[f.id] = f.dateAutoFill ? getDateString(f.dateFormat || "MMMM Do, YYYY") : "";
    });
    // Count existing playbooks from this template to number duplicates
    const existingCount = rows.flatMap(r => r.items).filter(i => i.templateId === item.id).length;
    const labelSuffix = existingCount === 0 ? "" : ` ${existingCount + 1}`;
    const docRowId = rows.find(r => r.items.some(i => i.type === "document"))?.id || rows.find(r => r.id !== rid)?.id || rid;
    const newItem: PlaybookItem = {
      id: crypto.randomUUID(), label: item.label + labelSuffix,
      icon: "Notebook", type: "filled-template",
      createdAt: new Date().toISOString(),
      templateId: item.id,
      filledData: fd,
      recurrence: item.recurrence ? { ...item.recurrence } : undefined,
    };
    newItem.icon = autoSelectIcon(newItem);
    const updated = rows.map(r => r.id === docRowId ? { ...r, items: [...r.items, newItem] } : r);
    setRows(updated);
    if (userId) saveUserData("playbooks", userId, updated);
  };
  const handleFillSave = (existingId?: string) => {
    if (!fillTemplateId || !fillTemplateRowId) return;
    const templateItem = rows.flatMap(r => r.items).find(i => i.id === fillTemplateId);
    if (!templateItem) return;
    if (existingId) {
      const updated = rows.map(r => r.id === fillTemplateRowId ? { ...r, items: r.items.map(i => i.id === existingId ? { ...i, filledData: fillData } : i) } : r);
      setRows(updated);
      if (userId) saveUserData("playbooks", userId, updated);
    } else {
      const newItem: PlaybookItem = {
        id: crypto.randomUUID(), label: templateItem.label,
        icon: "Notebook", type: "filled-template",
        createdAt: new Date().toISOString(),
        templateId: fillTemplateId || undefined,
        filledData: fillData,
        recurrence: templateItem.recurrence ? { ...templateItem.recurrence } : undefined,
      };
      newItem.icon = autoSelectIcon(newItem);
      const docRowId = rows.find(r => r.items.some(i => i.type === "document"))?.id || rows.find(r => r.id !== fillTemplateRowId)?.id || fillTemplateRowId;
      const updated = rows.map(r => r.id === docRowId ? { ...r, items: [...r.items, newItem] } : r);
      setRows(updated);
      if (userId) saveUserData("playbooks", userId, updated);
      fillSavedItemRef.current = newItem.id;
    }
  };
  const [fillSaveStatus, setFillSaveStatus] = useState<"" | "saving" | "saved">("");
  const fillTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fillSavedItemRef = useRef<string | null>(null);
  const autoSaveFill = useCallback(() => {
    if (fillTimerRef.current) clearTimeout(fillTimerRef.current);
    fillTimerRef.current = setTimeout(async () => {
      setFillSaveStatus("saving");
      const existingId = fillSavedItemRef.current;
      const tItem = rows.flatMap(r => r.items).find(i => i.id === fillTemplateId);
      if (!tItem || !fillTemplateRowId) { setFillSaveStatus(""); return; }
      if (existingId) {
      const updated = rows.map(r => r.id === fillTemplateRowId ? { ...r, items: r.items.map(i => i.id === existingId ? { ...i, filledData: fillData } : i) } : r);
        setRows(updated);
        if (userId) await saveUserData("playbooks", userId, updated);
      } else {
        // Find the Documents/Playbooks row (first row with document-type items, or first non-template row)
        const docRowId = rows.find(r => r.items.some(i => i.type === "document"))?.id || rows.find(r => r.id !== fillTemplateRowId)?.id || fillTemplateRowId;
        const newItem: PlaybookItem = {
          id: crypto.randomUUID(), label: tItem.label,
          icon: "Notebook", type: "filled-template",
          createdAt: new Date().toISOString(),
          templateId: fillTemplateId || undefined,
          filledData: fillData,
          recurrence: tItem.recurrence ? { ...tItem.recurrence } : undefined,
        };
        newItem.icon = autoSelectIcon(newItem);
        const updated = rows.map(r => r.id === docRowId ? { ...r, items: [...r.items, newItem] } : r);
        setRows(updated);
        if (userId) await saveUserData("playbooks", userId, updated);
        fillSavedItemRef.current = newItem.id;
      }
      setFillSaveStatus("saved");
      setTimeout(() => setFillSaveStatus(""), 2000);
    }, 600);
  }, [fillData, fillTemplateId, fillTemplateRowId, rows, userId]);

  const syncChecklistItem = useCallback((checked: boolean, text: string) => {
    if (!setTasks || !userEmail) return;
    if (checked) {
      setTasks(prev => [...prev, {
        id: crypto.randomUUID(), text, done: false, priority: true,
        assignedTo: userEmail, createdBy: userEmail, createdAt: new Date().toISOString(),
      }]);
    }
  }, [setTasks, userEmail]);

  // ── Detail / Edit ─────────────────────────────────────────────────────
  const openDetail = (item: PlaybookItem) => {
    // If empty document (no content, files, links, filled data), go straight to settings
    if (item.type === "document" && !item.content && (!item.files || item.files.length === 0) && (!item.links || item.links.length === 0)) {
      openEditSettings(item);
      return;
    }
    if (item.type === "template") {
      openEditSettings(item);
      return;
    }
    setDetailItem(item);
    if (item.type === "filled-template" && item.filledData) {
      setDetailFillData({ ...item.filledData });
    } else {
      setDetailFillData({});
    }
  };
  const openEditSettings = (item: PlaybookItem) => {
    if (item.type === "template") {
      const rid = rows.find(r => r.items.some(i => i.id === item.id))?.id;
      if (rid) {
        setCreateRowId(rid); setCreateType("template"); setSubView("template-builder");
        setCreateName(item.label);
        setCreateIcon(item.icon || "");
        setCreateLayout(item.columns === 2 ? 2 : 1);
        setCreateTemplateFields(item.templateFields ? [...item.templateFields] : []);
        setCreateRecurrence(item.recurrence || { enabled: false, interval: "monthly" });
        setEditTemplateId(item.id);
        setCreateDeleteConfirm(false);
      }
      return;
    }
    setEditSettingsItem(item);
    setEditSettingsName(item.label);
    setEditSettingsIcon(item.icon);
    setEditSettingsContent(item.content || "");
    setEditSettingsRecurrence(item.recurrence || { enabled: false, interval: "monthly" });
    setEditSettingsFiles(item.files ? [...item.files] : []);
    setEditSettingsLinks(item.links ? [...item.links] : []);
  };
  const [editSettingsContent, setEditSettingsContent] = useState("");
  const [editSettingsExpanded, setEditSettingsExpanded] = useState(false);
  const [editSettingsRecurrence, setEditSettingsRecurrence] = useState<RecurrenceConfig>({ enabled: false, interval: "monthly" });
  const [editSettingsFiles, setEditSettingsFiles] = useState<PlaybookFile[]>([]);
  const [editSettingsLinks, setEditSettingsLinks] = useState<PlaybookLink[]>([]);
  const [editSettingsUploading, setEditSettingsUploading] = useState(false);
  const handleEditSettingsUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    if (file.size > 25 * 1024 * 1024) { alert("File must be under 25MB"); return; }
    setEditSettingsUploading(true);
    const result = await uploadFile(file, userId, "temp");
    if (result) setEditSettingsFiles(p => [...p, result]);
    setEditSettingsUploading(false);
  };
  const saveEditSettings = () => {
    if (!editSettingsItem) return;
    const rid = rows.find(r => r.items.some(i => i.id === editSettingsItem.id))?.id;
    if (!rid) return;
    const updated = rows.map(r => r.id === rid ? { ...r, items: r.items.map(i => i.id === editSettingsItem.id ? { ...i, label: editSettingsName, icon: editSettingsIcon, content: editSettingsContent, files: editSettingsFiles.length > 0 ? editSettingsFiles : undefined, links: editSettingsLinks.length > 0 ? editSettingsLinks : undefined, recurrence: editSettingsItem.type !== "template" ? editSettingsRecurrence : undefined } : i) } : r);
    setRows(updated);
    if (userId) saveUserData("playbooks", userId, updated);
    setEditSettingsItem(null);
    setEditSettingsExpanded(false);
    setEditSettingsRecurrence({ enabled: false, interval: "monthly" });
    setEditSettingsFiles([]);
    setEditSettingsLinks([]);
  };
  const duplicateItem = () => {
    if (!editSettingsItem) return;
    const rid = rows.find(r => r.items.some(i => i.id === editSettingsItem.id))?.id;
    if (!rid) return;
    const dup: PlaybookItem = { ...editSettingsItem, id: crypto.randomUUID(), label: editSettingsName + " (Copy)", createdAt: new Date().toISOString() };
    const updated = rows.map(r => r.id === rid ? { ...r, items: [...r.items, dup] } : r);
    setRows(updated);
    if (userId) saveUserData("playbooks", userId, updated);
    setEditSettingsItem(null);
    setEditSettingsExpanded(false);
  };
  const deleteItem = () => {
    if (!editSettingsItem) return;
    const rid = rows.find(r => r.items.some(i => i.id === editSettingsItem.id))?.id;
    if (!rid) return;
    const updated = rows.map(r => r.id === rid ? { ...r, items: r.items.filter(i => i.id !== editSettingsItem.id) } : r);
    setRows(updated);
    if (userId) saveUserData("playbooks", userId, updated);
    setEditSettingsItem(null);
    setEditSettingsExpanded(false);
    setDeleteConfirmText("");
  };
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [fileUploadPopup, setFileUploadPopup] = useState<{ files: File[]; rowId: string } | null>(null);
  const [dragOverUpload, setDragOverUpload] = useState(false);

  // ── File upload handlers ──────────────────────────────────────────────
  const handleFileUpload = async (files: File[], rowId: string, mode: "one" | "separate") => {
    const maxFiles = 5;
    const toUpload = files.slice(0, maxFiles);
    const results: PlaybookFile[] = [];
    for (const file of toUpload) {
      if (file.size > 25 * 1024 * 1024) { alert(`"${file.name}" is over 25MB and will be skipped.`); continue; }
      const result = await uploadFile(file, userId || "", "temp");
      if (result) results.push(result);
    }
    if (results.length === 0) return;
    if (mode === "one") {
      const newItem: PlaybookItem = {
        id: crypto.randomUUID(), label: results.length === 1 ? results[0].name.replace(/\.[^/.]+$/, "") : "Uploaded Files",
        icon: "FileDoc", type: "document", createdAt: new Date().toISOString(), files: results,
      };
      newItem.icon = autoSelectIcon(newItem);
      const updated = rows.map(r => r.id === rowId ? { ...r, items: [...r.items, newItem] } : r);
      setRows(updated);
      if (userId) await saveUserData("playbooks", userId, updated);
    } else {
      for (const file of results) {
        const newItem: PlaybookItem = {
          id: crypto.randomUUID(), label: file.name.replace(/\.[^/.]+$/, ""),
          icon: "FileDoc", type: "document", createdAt: new Date().toISOString(), files: [file],
        };
        newItem.icon = autoSelectIcon(newItem);
        const updated = rows.map(r => r.id === rowId ? { ...r, items: [...r.items, newItem] } : r);
        setRows(updated);
        if (userId) await saveUserData("playbooks", userId, updated);
      }
    }
    setFileUploadPopup(null);
  };

  // ── Link detection ────────────────────────────────────────────────────
  const detectLinkTitle = (url: string): string => {
    const u = url.toLowerCase();
    if (/(youtube\.com|youtu\.be)/.test(u)) return "Video";
    if (u.includes("loom.com")) return "Video";
    if (u.includes("vimeo.com")) return "Video";
    if (/docs\.google\.com\/document/.test(u)) return "Google Doc";
    if (u.includes("docs.google.com/spreadsheets")) return "Google Sheet";
    if (u.includes("docs.google.com/presentation")) return "Google Slides";
    if (u.includes("onedrive.live.com") || u.includes("1drv.ms")) return "One Drive";
    if (u.includes("dropbox.com")) return "Dropbox";
    if (u.includes("drive.google.com")) return "Google Drive";
    if (/\.(mp4|mov|avi|wmv|webm)$/i.test(url)) return "Video";
    if (/\.(pdf)$/i.test(url)) return "PDF";
    if (/\.(doc|docx)$/i.test(url)) return "Document";
    if (/\.(xls|xlsx)$/i.test(url)) return "Spreadsheet";
    return "Link";
  };

  const handleLinkDrop = async (url: string) => {
    const firstRow = rows[0];
    if (!firstRow) return;
    const title = detectLinkTitle(url);
    const newItem: PlaybookItem = {
      id: crypto.randomUUID(), label: title,
      icon: "Link", type: "document", createdAt: new Date().toISOString(),
      links: [{ id: crypto.randomUUID(), title, url }],
    };
    const updated = rows.map(r => r.id === firstRow.id ? { ...r, items: [...r.items, newItem] } : r);
    setRows(updated);
    if (userId) await saveUserData("playbooks", userId, updated);
  };

  // ── Render helpers ────────────────────────────────────────────────────

  if (loading) return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", color: "#94a3b8", fontSize: 15 }}>
      Loading playbooks...
    </div>
  );

  // ── SUBVIEW: Template Builder ─────────────────────────────────────────
  if (subView === "template-builder") {
    const addField = (type: TemplateFieldType) => {
      const newField: TemplateField = {
        id: crypto.randomUUID(), type, header: "", description: "", placeholder: "",
        required: false, options: type === "checkbox" || type === "radio" || type === "big-checklist" ? ["Option 1"] : undefined,
        color: "#1a2332", column: 1, textSize: 30, checklistLayout: "together", bigChecklistMode: "option", syncToTasks: false,
        checkboxSubtype: type === "checkbox" ? "checkbox" : undefined, checklistPredetermined: false, checklistPredeterminedCount: 5,
      };
      const subtypes: Record<string, Partial<TemplateField>> = {
        checkbox: { options: ["Option 1"], color: "#1a2332", textSize: 30, checklistLayout: "together" },
        "fill-checklist": { options: undefined, color: "#1a2332" },
        "sync-checklist": { options: undefined, color: "#1a2332" },
        info: { options: undefined, color: "#64748b" },
      };
      Object.assign(newField, subtypes[type]);
      setCreateTemplateFields(p => [...p, newField]);
    };
    const updateField = (id: string, updates: Partial<TemplateField>) => {
      setCreateTemplateFields(p => p.map(f => f.id === id ? { ...f, ...updates } : f));
    };
    const removeField = (id: string) => setCreateTemplateFields(p => p.filter(f => f.id !== id));
    const moveFieldWithinColumn = (id: string, dir: -1 | 1) => {
      setCreateTemplateFields(p => {
        const col = (p.find(f => f.id === id)?.column || 1);
        const colIndices = p.map((f, i) => ({ f, i })).filter(x => (x.f.column || 1) === col).map(x => x.i);
        const idx = p.findIndex(f => f.id === id);
        const posInCol = colIndices.indexOf(idx);
        const targetPos = posInCol + dir;
        if (targetPos < 0 || targetPos >= colIndices.length) return p;
        const arr = [...p];
        const targetIdx = colIndices[targetPos];
        [arr[idx], arr[targetIdx]] = [arr[targetIdx], arr[idx]];
        return arr;
      });
    };
    const moveFieldToColumn = (id: string, col: 1 | 2) => {
      setCreateTemplateFields(p => p.map(f => f.id === id ? { ...f, column: col } : f));
    };
    const handleFieldDragStart = (id: string) => { createFieldDragRef.current = id; };
    const handleFieldDragEnter = (id: string) => { if (createFieldDragRef.current !== id) setCreateFieldDragOver(id); };
    const handleFieldDrop = (id: string) => {
      const from = createFieldDragRef.current;
      if (!from || from === id) { createFieldDragRef.current = null; setCreateFieldDragOver(null); return; }
      setCreateTemplateFields(p => {
        const arr = [...p];
        const fi = arr.findIndex(f => f.id === from);
        const ti = arr.findIndex(f => f.id === id);
        if (fi === -1 || ti === -1) return p;
        const [moved] = arr.splice(fi, 1);
        arr.splice(ti, 0, moved);
        return arr;
      });
      createFieldDragRef.current = null;
      setCreateFieldDragOver(null);
    };
    const handleFieldDragEnd = () => { createFieldDragRef.current = null; setCreateFieldDragOver(null); };

    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px clamp(16px,3vw,24px)", borderBottom: "1px solid #e2e8f0", background: "#fff", flexShrink: 0 }}>
          <button onClick={() => { setSubView("list"); resetCreate(); }}
            style={{ padding: "6px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>← Back</button>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1a2332", flex: 1 }}>{__('playbooks.templateSettings', 'Playbook Template Settings')}</h2>
        </div>
        <div style={{ flex: 1, display: "flex", overflow: "hidden", flexDirection: window.innerWidth < 768 ? "column" : "row" }}>
          {/* LEFT: Editor */}
          <div style={{ flex: 1, overflowY: "auto", padding: "clamp(12px,2vw,20px)" }}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 6 }}>{__('playbooks.templateName', 'TEMPLATE NAME')}</div>
                <input value={createName} onChange={e => setCreateName(e.target.value)} placeholder="e.g. Impact Filter"
                  style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>{__('playbooks.icon', 'ICON')}</div>
                <IconPicker selected={createIcon} onSelect={setCreateIcon} />
              </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>LAYOUT</div>
              <div style={{ display: "flex", gap: 8 }}>
                {([1, 2] as const).map(c => (
                  <label key={c} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 15, color: "#64748b", cursor: "pointer" }}>
                    <input type="radio" name="createLayout" checked={createLayout === c} onChange={() => setCreateLayout(c)}
                      style={{ accentColor: "#3B82F6", margin: 0 }} /> {c} Column{c > 1 ? "s" : ""}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
              {(["text","textarea","checkbox","radio","info"] as TemplateFieldType[]).map(t => (
                <button key={t} onClick={() => addField(t)}
                  style={{ padding: "5px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b", textTransform: "capitalize" }}>
                  + {t === "textarea" ? "Text Area" : t === "info" ? "Info" : t === "checkbox" ? "Checkbox" : t === "radio" ? "Radio" : "Text"}
                </button>
              ))}
            </div>

            {(() => {
              const cols: Record<number, TemplateField[]> = { 1: [], 2: [] };
              for (const f of createTemplateFields) cols[f.column || 1].push(f);
              return ([1, 2] as const).map(col => cols[col].length === 0 && col === 2 && createTemplateFields.every(f => (f.column || 1) === 1) ? null : (
                <div key={col}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, marginTop: col === 2 ? 20 : 0 }}>{__('playbooks.column', 'Column')} {col}</div>
                  {cols[col].map(f => {
                    const colFields = cols[col];
                    const idxInCol = colFields.indexOf(f);
                    return (
                    <div key={f.id} style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", padding: 14, marginBottom: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                        <span style={{ fontSize: 15, fontWeight: 600, color: "#64748b", textTransform: "uppercase", flex: 1 }}>{f.type} field</span>
                        <button onClick={() => moveFieldToColumn(f.id, col === 1 ? 2 : 1)} title={col === 1 ? "Move to column 2" : "Move to column 1"}
                          style={{ width: 22, height: 22, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 15, background: "#f1f5f9", color: "#64748b" }}>{col === 1 ? "→" : "←"}</button>
                        <button onClick={() => moveFieldWithinColumn(f.id, -1)} disabled={idxInCol === 0}
                          style={{ width: 22, height: 22, borderRadius: 4, border: "none", cursor: idxInCol === 0 ? "default" : "pointer", fontSize: 15, background: "#f1f5f9", color: idxInCol === 0 ? "#e2e8f0" : "#64748b" }}>↑</button>
                        <button onClick={() => moveFieldWithinColumn(f.id, 1)} disabled={idxInCol === colFields.length - 1}
                          style={{ width: 22, height: 22, borderRadius: 4, border: "none", cursor: idxInCol === colFields.length - 1 ? "default" : "pointer", fontSize: 15, background: "#f1f5f9", color: idxInCol === colFields.length - 1 ? "#e2e8f0" : "#64748b" }}>↓</button>
                        <button onClick={() => removeField(f.id)}
                          style={{ width: 22, height: 22, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 15, background: "#fee2e2", color: "#E85D75" }}>✕</button>
                      </div>
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 2 }}>Header</div>
                        <RichEditorSmall content={f.header} onChange={html => updateField(f.id, { header: html })} />
                      </div>
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 2 }}>Description</div>
                        <RichEditorSmall content={f.description} onChange={html => updateField(f.id, { description: html })} />
                      </div>
                      {(() => {
                        const fType = f.type === "checkbox" ? (f.checkboxSubtype || "checkbox") : f.type;
                        return (<>
                      {f.type !== "checkbox" && f.type !== "radio" && f.type !== "info" && f.type !== "big-checklist" && f.type !== "fill-checklist" && f.type !== "sync-checklist" && (
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 2 }}>{__('playbooks.placeholder', 'Placeholder')}</div>
                        <RichEditorSmall content={f.placeholder} onChange={html => updateField(f.id, { placeholder: html })} />
                      </div>
                      )}
                      {f.type === "checkbox" && (
                        <div style={{ marginBottom: 8 }}>
                          <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 4 }}>Checklist Type</div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                            {(["checkbox","fill-checklist","big-checklist","sync-checklist"] as const).map(sub => (
                              <label key={sub} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 6,
                                background: f.checkboxSubtype === sub || (!f.checkboxSubtype && sub === "checkbox") ? "#EFF6FF" : "#F8FAFC",
                                border: f.checkboxSubtype === sub || (!f.checkboxSubtype && sub === "checkbox") ? "1.5px solid #3B82F6" : "1.5px solid #e2e8f0",
                                fontSize: 15, color: f.checkboxSubtype === sub || (!f.checkboxSubtype && sub === "checkbox") ? "#3B82F6" : "#64748b", cursor: "pointer" }}>
                                <input type="radio" checked={f.checkboxSubtype === sub || (!f.checkboxSubtype && sub === "checkbox")}
                                  onChange={() => updateField(f.id, { checkboxSubtype: sub === "checkbox" ? undefined : sub, options: sub === "big-checklist" || sub === "checkbox" ? ["Option 1"] : undefined })}
                                  style={{ accentColor: "#3B82F6", margin: 0 }} />
                                {sub === "checkbox" ? "Checkboxes" : sub === "fill-checklist" ? "Fill Checklist" : sub === "big-checklist" ? "Big Checklist" : "Sync Checklist"}
                              </label>
                            ))}
                          </div>
                          {/* Subtype-specific settings */}
                          {(fType === "fill-checklist" || fType === "sync-checklist") && (
                            <div style={{ marginBottom: 6 }}>
                              <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 2 }}>{__('playbooks.placeholder', 'Placeholder')}</div>
                              <RichEditorSmall content={f.placeholder} onChange={html => updateField(f.id, { placeholder: html })} />
                            </div>
                          )}
                          {fType === "big-checklist" && (
                            <div>
                              <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 4 }}>{__('playbooks.checklistLayout', 'Checklist Layout')}</div>
                              <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                                {(["together","separate"] as const).map(l => (
                                  <label key={l} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 15, color: "#64748b", cursor: "pointer" }}>
                                    <input type="radio" name={`layout-${f.id}`} checked={(f.checklistLayout || "together") === l} onChange={() => updateField(f.id, { checklistLayout: l })}
                                      style={{ accentColor: "#3B82F6", margin: 0 }} /> {l === "together" ? "Together" : "Separate"}
                                  </label>
                                ))}
                              </div>
                              <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 4 }}>{__('playbooks.checklistMode', 'Checklist Mode')}</div>
                              <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                                {(["option","fill"] as const).map(m => (
                                  <label key={m} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 15, color: "#64748b", cursor: "pointer" }}>
                                    <input type="radio" name={`mode-${f.id}`} checked={(f.bigChecklistMode || "option") === m}
                                      onChange={() => updateField(f.id, { bigChecklistMode: m })}
                                      style={{ accentColor: "#3B82F6", margin: 0 }} /> {m === "option" ? "Option Checkboxes" : "Fill-in Checkboxes"}
                                  </label>
                                ))}
                              </div>
                              {f.bigChecklistMode === "fill" && f.checklistLayout === "separate" && (
                                <div style={{ marginBottom: 6 }}>
                                  <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 15, color: "#64748b", cursor: "pointer" }}>
                                    <input type="checkbox" checked={!!f.checklistPredetermined} onChange={e => updateField(f.id, { checklistPredetermined: e.target.checked, options: e.target.checked ? (f.checklistPredeterminedCount ? f.options : []) : undefined })}
                                      style={{ accentColor: "#3B82F6", margin: 0 }} /> Select predetermined amount
                                  </label>
                                  {f.checklistPredetermined && (
                                    <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
                                      <span style={{ fontSize: 15, color: "#64748b" }}>How many checkboxes?</span>
                                      <input type="number" min={1} max={50} value={f.checklistPredeterminedCount || 5}
                                        onChange={e => { const count = parseInt(e.target.value) || 5; updateField(f.id, { checklistPredeterminedCount: count, options: Array.from({ length: count }, (_, i) => `Item ${i + 1}`) }); }}
                                        style={{ width: 60, padding: "4px 8px", borderRadius: 4, border: "1px solid #e2e8f0", fontSize: 15, outline: "none" }} />
                                    </div>
                                  )}
                                </div>
                              )}
                              {f.bigChecklistMode === "option" && f.checklistLayout === "separate" && !f.checklistPredetermined && (
                                <div>
                                  <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 4 }}>{__('common.options', 'Options')}</div>
                                  {(f.options || []).map((opt, oi) => (
                                    <div key={oi} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                                      <input value={opt} onChange={e => { const opts = [...(f.options || [])]; opts[oi] = e.target.value; updateField(f.id, { options: opts }); }}
                                        style={{ flex: 1, padding: "4px 8px", borderRadius: 4, border: "1px solid #e2e8f0", fontSize: 15, outline: "none" }} />
                                      <button onClick={() => { const opts = (f.options || []).filter((_, j) => j !== oi); updateField(f.id, { options: opts.length > 0 ? opts : undefined }); }}
                                        style={{ width: 20, height: 20, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 15, background: "#fee2e2", color: "#E85D75" }}>✕</button>
                                    </div>
                                  ))}
                                  <button onClick={() => updateField(f.id, { options: [...(f.options || []), `Item ${(f.options || []).length + 1}`] })}
                                    style={{ padding: "3px 10px", borderRadius: 4, border: "1px dashed #d1d5db", background: "transparent", fontSize: 15, cursor: "pointer", color: "#94a3b8" }}>+ Add Item</button>
                                </div>
                              )}
                              {f.bigChecklistMode === "option" && f.checklistLayout === "separate" && f.checklistPredetermined && (
                                <div style={{ marginBottom: 6 }}>
                                  <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 15, color: "#64748b", cursor: "pointer" }}>
                                    <input type="checkbox" checked={!!f.checklistPredetermined} onChange={e => updateField(f.id, { checklistPredetermined: e.target.checked })}
                                      style={{ accentColor: "#3B82F6", margin: 0 }} /> How many checkboxes?
                                  </label>
                                  {f.checklistPredetermined && (
                                    <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
                                      <input type="number" min={1} max={50} value={f.checklistPredeterminedCount || 5}
                                        onChange={e => { const count = parseInt(e.target.value) || 5; updateField(f.id, { checklistPredeterminedCount: count, options: Array.from({ length: count }, (_, i) => `Item ${i + 1}`) }); }}
                                        style={{ width: 60, padding: "4px 8px", borderRadius: 4, border: "1px solid #e2e8f0", fontSize: 15, outline: "none" }} />
                                    </div>
                                  )}
                                </div>
                              )}
                              <div style={{ marginBottom: 6 }}>
                                <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 2 }}>{__('playbooks.size', 'Size')}: {(f.textSize || 30)}px</div>
                                <input type="range" min={30} max={100} value={f.textSize || 30}
                                  onChange={e => updateField(f.id, { textSize: parseInt(e.target.value) })}
                                  style={{ width: "100%", accentColor: "#3B82F6" }} />
                              </div>
                              {f.checklistLayout !== "separate" && (
                                <div style={{ marginBottom: 6 }}>
                                  <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 2 }}>{__('playbooks.placeholder', 'Placeholder')}</div>
                                  <RichEditorSmall content={f.placeholder} onChange={html => updateField(f.id, { placeholder: html })} />
                                </div>
                              )}
                              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 15, color: "#64748b", cursor: "pointer", marginTop: 4 }}>
                                <input type="checkbox" checked={!!f.syncToTasks} onChange={e => updateField(f.id, { syncToTasks: e.target.checked })}
                                  style={{ accentColor: "#3B82F6", margin: 0 }} /> Sync to Priorities (Tasks)
                              </label>
                            </div>
                          )}
                          {fType === "checkbox" && (f.options || []).map((opt, oi) => (
                            <div key={oi} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                              <input type="checkbox" disabled style={{ accentColor: "#3B82F6" }} />
                              <input value={opt} onChange={e => { const opts = [...(f.options || [])]; opts[oi] = e.target.value; updateField(f.id, { options: opts }); }}
                                style={{ flex: 1, padding: "4px 8px", borderRadius: 4, border: "1px solid #e2e8f0", fontSize: 15, outline: "none" }} />
                              <button onClick={() => { const opts = (f.options || []).filter((_, j) => j !== oi); updateField(f.id, { options: opts.length > 0 ? opts : undefined }); }}
                                style={{ width: 20, height: 20, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 15, background: "#fee2e2", color: "#E85D75" }}>✕</button>
                            </div>
                          ))}
                          {fType === "checkbox" && (
                            <button onClick={() => updateField(f.id, { options: [...(f.options || []), `Option ${(f.options || []).length + 1}`] })}
                              style={{ padding: "3px 10px", borderRadius: 4, border: "1px dashed #d1d5db", background: "transparent", fontSize: 15, cursor: "pointer", color: "#94a3b8" }}>+ Add Option</button>
                          )}
                        </div>
                      )}
                      </>);
                      })()}
                      {(f.type === "fill-checklist" || (f.type === "checkbox" && f.checkboxSubtype === "fill-checklist") || f.type === "sync-checklist" || (f.type === "checkbox" && f.checkboxSubtype === "sync-checklist")) && (
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 2 }}>{__('playbooks.placeholder', 'Placeholder')}</div>
                        <RichEditorSmall content={f.placeholder} onChange={html => updateField(f.id, { placeholder: html })} />
                      </div>
                      )}
                      {f.type === "big-checklist" || (f.type === "checkbox" && f.checkboxSubtype === "big-checklist") && (
                        <div style={{ marginBottom: 8 }}>
                          <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 4 }}>{__('playbooks.checklistLayout', 'Checklist Layout')}</div>
                          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                            {(["together","separate"] as const).map(l => (
                              <label key={l} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 15, color: "#64748b", cursor: "pointer" }}>
                                <input type="radio" name={`layout-${f.id}`} checked={(f.checklistLayout || "together") === l} onChange={() => updateField(f.id, { checklistLayout: l })}
                                  style={{ accentColor: "#3B82F6", margin: 0 }} /> {l === "together" ? "Together" : "Separate"}
                              </label>
                            ))}
                          </div>
                          {/* ── Big Checklist Mode (fill / option) ── */}
                          <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 4 }}>{__('playbooks.checklistMode', 'Checklist Mode')}</div>
                          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                            {(["option","fill"] as const).map(m => (
                              <label key={m} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 15, color: "#64748b", cursor: "pointer" }}>
                                <input type="radio" name={`mode-${f.id}`} checked={(f.bigChecklistMode || "option") === m}
                                  onChange={() => updateField(f.id, { bigChecklistMode: m })}
                                  style={{ accentColor: "#3B82F6", margin: 0 }} /> {m === "option" ? "Option Checkboxes" : "Fill-in Checkboxes"}
                              </label>
                            ))}
                          </div>
                          {/* ── Text Size Slider ── */}
                          <div style={{ marginBottom: 6 }}>
                            <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 2 }}>{__('playbooks.size', 'Size')}: {(f.textSize || 30)}px</div>
                            <input type="range" min={30} max={100} value={f.textSize || 30}
                              onChange={e => updateField(f.id, { textSize: parseInt(e.target.value) })}
                              style={{ width: "100%", accentColor: "#3B82F6" }} />
                          </div>
                          {f.checklistLayout === "separate" && (
                            <div>
                              <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 4 }}>{__('common.options', 'Options')}</div>
                              {(f.options || []).map((opt, oi) => (
                                <div key={oi} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                                  <input value={opt} onChange={e => {
                                    const opts = [...(f.options || [])];
                                    opts[oi] = e.target.value;
                                    updateField(f.id, { options: opts });
                                  }} style={{ flex: 1, padding: "4px 8px", borderRadius: 4, border: "1px solid #e2e8f0", fontSize: 15, outline: "none" }} />
                                  <button onClick={() => {
                                    const opts = (f.options || []).filter((_, j) => j !== oi);
                                    updateField(f.id, { options: opts.length > 0 ? opts : undefined });
                                  }} style={{ width: 20, height: 20, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 15, background: "#fee2e2", color: "#E85D75" }}>✕</button>
                                </div>
                              ))}
                              <button onClick={() => updateField(f.id, { options: [...(f.options || []), `Item ${(f.options || []).length + 1}`] })}
                                style={{ padding: "3px 10px", borderRadius: 4, border: "1px dashed #d1d5db", background: "transparent", fontSize: 15, cursor: "pointer", color: "#94a3b8" }}>+ Add Item</button>
                            </div>
                          )}
                          {f.checklistLayout !== "separate" && (
                            <div style={{ marginBottom: 6 }}>
                              <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 2 }}>{__('playbooks.placeholder', 'Placeholder')}</div>
                              <RichEditorSmall content={f.placeholder} onChange={html => updateField(f.id, { placeholder: html })} />
                            </div>
                          )}
                        </div>
                      )}
                      {f.type === "sync-checklist" || (f.type === "checkbox" && f.checkboxSubtype === "sync-checklist") && (
                        <div style={{ marginBottom: 6 }}>
                          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 15, color: "#64748b", cursor: "pointer", marginBottom: 4 }}>
                            <input type="checkbox" checked={!!f.syncToTasks} onChange={e => updateField(f.id, { syncToTasks: e.target.checked })}
                              style={{ accentColor: "#3B82F6", margin: 0 }} /> Sync to Tasks
                          </label>
                          <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 2 }}>{__('playbooks.placeholder', 'Placeholder')}</div>
                          <RichEditorSmall content={f.placeholder} onChange={html => updateField(f.id, { placeholder: html })} />
                        </div>
                      )}
                      {(f.type === "checkbox" || f.type === "radio") && (
                        <div style={{ marginBottom: 6 }}>
                          <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 4 }}>{__('common.options', 'Options')}</div>
                          {(f.options || []).map((opt, oi) => (
                            <div key={oi} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                              <input value={opt} onChange={e => {
                                const opts = [...(f.options || [])];
                                opts[oi] = e.target.value;
                                updateField(f.id, { options: opts });
                              }} style={{ flex: 1, padding: "4px 8px", borderRadius: 4, border: "1px solid #e2e8f0", fontSize: 15, outline: "none" }} />
                              <button onClick={() => {
                                const opts = (f.options || []).filter((_, j) => j !== oi);
                                updateField(f.id, { options: opts.length > 0 ? opts : undefined });
                              }} style={{ width: 20, height: 20, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 15, background: "#fee2e2", color: "#E85D75" }}>✕</button>
                            </div>
                          ))}
                          <button onClick={() => updateField(f.id, { options: [...(f.options || []), `Option ${(f.options || []).length + 1}`] })}
                            style={{ padding: "3px 10px", borderRadius: 4, border: "1px dashed #d1d5db", background: "transparent", fontSize: 15, cursor: "pointer", color: "#94a3b8" }}>+ Add Option</button>
                        </div>
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 15, color: "#64748b", cursor: "pointer" }}>
                          <input type="checkbox" checked={f.required} onChange={e => updateField(f.id, { required: e.target.checked })}
                            style={{ accentColor: "#3B82F6", margin: 0 }} /> Required
                        </label>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontSize: 15, color: "#94a3b8" }}>Color:</span>
                          <input type="color" value={f.color} onChange={e => updateField(f.id, { color: e.target.value })}
                            style={{ width: 22, height: 22, padding: 0, border: "none", cursor: "pointer" }} />
                        </div>
                      </div>
                    </div>
                  );})}
                </div>
              ));
            })()}
            <div style={{ padding: "16px 0", borderTop: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
              {editTemplateId && createDeleteConfirm ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 15, color: "#E85D75", fontWeight: 600 }}>{__('common.areYouSure', 'Are you sure?')}</span>
                  <button onClick={() => setCreateDeleteConfirm(false)}
                    style={{ padding: "6px 14px", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>{__('common.cancel', 'Cancel')}</button>
                  <button onClick={handleDeleteTemplate}
                    style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#E85D75", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{__('common.yesDelete', 'Yes, Delete')}</button>
                </div>
              ) : (
                <>
                  {editTemplateId && <button onClick={() => { setCreateDeleteConfirm(true); }} style={{ padding: "8px 16px", borderRadius: 8, border: "1.5px solid #E85D75", background: "#fff", fontSize: 15, cursor: "pointer", color: "#E85D75", fontWeight: 600 }}>{__('common.delete', 'Delete')}</button>}
                  {editTemplateId && <button onClick={handleDuplicateTemplate} style={{ padding: "8px 16px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>{__('common.duplicate', 'Duplicate')}</button>}
                  <div style={{ flex: 1 }} />
                  <button onClick={handleCreateSave} disabled={!createName.trim()}
                    style={{ padding: "10px 28px", borderRadius: 8, border: "none",
                      background: createName.trim() ? "linear-gradient(135deg,#3B82F6,#06B6D4)" : "#e2e8f0",
                      color: "#fff", fontSize: 15, fontWeight: 600, cursor: createName.trim() ? "pointer" : "default" }}>
                    Save Template
                  </button>
                </>
              )}
            </div>
          </div>

          {/* RIGHT: Preview */}
          <div style={{ flex: 1, overflowY: "auto", padding: "clamp(12px,2vw,20px)", background: "#F8FAFC", borderLeft: window.innerWidth >= 768 ? "1px solid #e2e8f0" : "none", borderTop: window.innerWidth < 768 ? "1px solid #e2e8f0" : "none" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 12 }}>{__('playbooks.preview', 'PREVIEW')}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1a2332", marginBottom: 16 }}>{createName || "Template Name"}</div>
            {createLayout === 2 && <div style={{ fontSize: 15, color: "#3B82F6", fontWeight: 600, marginBottom: 8 }}>{__('playbooks.twoColumn', 'Two-column layout')}</div>}
            {createTemplateFields.length === 0 ? (
              <div style={{ fontSize: 15, color: "#cbd5e1", fontStyle: "italic" }}>Add fields to see preview</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: createLayout === 2 ? "1fr 1fr" : "1fr", gap: 10 }}
                className={createLayout === 2 ? "stack-mobile" : ""}>
                {createTemplateFields.map(f => (
                  <div key={f.id}
                    onDragEnter={() => handleFieldDragEnter(f.id)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => handleFieldDrop(f.id)}
                    onDragEnd={handleFieldDragEnd}
                    style={{ background: "#f1f5f9", borderRadius: 10, padding: 14, outline: createFieldDragOver === f.id ? "2px dashed #3B82F6" : "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, userSelect: "none" }}>
                      <div draggable onDragStart={e => { e.stopPropagation(); handleFieldDragStart(f.id); }}
                        style={{ cursor: "grab", color: "#cbd5e1", fontSize: 15, lineHeight: 1, letterSpacing: 2, width: 20, flexShrink: 0 }}
                        title="Drag to reorder">⠿</div>
                      <div style={{ flex: 1 }}>
                        {f.header && <div style={{ fontSize: 15, fontWeight: 600, color: f.color, marginBottom: 4 }} dangerouslySetInnerHTML={{ __html: renderShortcodes(f.dateAutoFill ? getDateString(f.dateFormat || "MMMM Do, YYYY") : f.header) }} />}
                        {f.description && <div style={{ fontSize: 15, color: "#64748b", marginBottom: 6, fontStyle: "italic" }} dangerouslySetInnerHTML={{ __html: renderShortcodes(f.description) }} />}
                      </div>
                    </div>
                    {f.type === "text" && <div style={{ padding: "8px 12px", borderRadius: 6, background: "#fff", fontSize: 15, color: "#94a3b8" }} dangerouslySetInnerHTML={{ __html: f.placeholder || "Text input..." }} />}
                    {f.type === "textarea" && <div style={{ padding: "8px 12px", borderRadius: 6, background: "#fff", fontSize: 15, color: "#94a3b8", minHeight: 60 }} dangerouslySetInnerHTML={{ __html: f.placeholder || "Long text..." }} />}
                    {f.type === "checkbox" && (f.options || []).map((opt, oi) => (
                      <div key={oi} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, fontSize: 15, color: "#94a3b8" }}>
                        <div style={{ width: 16, height: 16, borderRadius: 3, border: "1.5px solid #d1d5db", background: "#fff" }} />
                        {opt}
                      </div>
                    ))}
                    {f.type === "radio" && (f.options || []).map((opt, oi) => (
                      <div key={oi} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, fontSize: 15, color: "#94a3b8" }}>
                        <div style={{ width: 16, height: 16, borderRadius: "50%", border: "1.5px solid #d1d5db", background: "#fff" }} />
                        {opt}
                      </div>
                    ))}
                    {f.type === "info" && f.description && (
                      <div style={{ fontSize: 15, color: "#64748b", lineHeight: 1.5, fontStyle: "italic" }} dangerouslySetInnerHTML={{ __html: renderShortcodes(f.description) }} />
                    )}
                    {f.type === "fill-checklist" || (f.type === "checkbox" && f.checkboxSubtype === "fill-checklist") && (
                      <div style={{ fontSize: 15, color: "#94a3b8", fontStyle: "italic" }} dangerouslySetInnerHTML={{ __html: f.placeholder || "Add checklist items..." }} />
                    )}
                    {f.type === "big-checklist" || (f.type === "checkbox" && f.checkboxSubtype === "big-checklist") && (
                      <div>
                        <div style={{
                          fontSize: (f.textSize || 30) * 0.65,
                          color: "#94a3b8", fontStyle: f.checklistLayout === "separate" ? "normal" : "italic", marginBottom: 4
                        }}>
                          {f.checklistLayout === "separate" ? (f.options || []).map((opt, oi) => (
                            <div key={oi} style={{
                              display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6,
                              fontSize: (f.textSize || 30) * 0.65,
                              color: "#1a2332"
                            }}>
                              <div style={{
                                width: (f.textSize || 30) * 0.65 * 1.2,
                                height: (f.textSize || 30) * 0.65 * 1.2,
                                borderRadius: "50%", border: "2px solid #d1d5db", background: "#fff", flexShrink: 0, marginTop: 2
                              }} />
                              <span>{opt}</span>
                            </div>
                          )) : <span style={{ color: "#94a3b8" }}>Add tasks to this checklist...</span>}
                        </div>
                      </div>
                    )}
                    {f.type === "sync-checklist" || (f.type === "checkbox" && f.checkboxSubtype === "sync-checklist") && (
                      <div style={{ fontSize: 15, color: "#94a3b8", fontStyle: "italic" }} dangerouslySetInnerHTML={{ __html: f.placeholder || "Synced checklist items..." }} />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── SUBVIEW: Template Fill ────────────────────────────────────────────
  if (subView === "template-fill") {
    const tItem = rows.flatMap(r => r.items).find(i => i.id === fillTemplateId);
    if (!tItem?.templateFields) return null;
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px clamp(16px,3vw,24px)", borderBottom: "1px solid #e2e8f0", background: "#fff", flexShrink: 0 }}>
          <button onClick={() => { setSubView("list"); setFillTemplateId(null); }}
            style={{ padding: "6px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>← Back</button>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1a2332", flex: 1 }}>{tItem.label}</h2>
        </div>
        <div style={{ flex: 1, display: "flex", overflow: "hidden", flexDirection: window.innerWidth < 768 ? "column" : "row" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "clamp(12px,2vw,20px)" }}>
            <div style={{ display: "grid", gridTemplateColumns: tItem.columns === 2 && window.innerWidth >= 768 ? "1fr 1fr" : "1fr", gap: 16 }} className={tItem.columns === 2 ? "stack-mobile" : ""}>
              {tItem.templateFields.map(f => {
                const displayHeader = f.dateAutoFill ? getDateString(f.dateFormat || "MMMM Do, YYYY") : f.header;
                return (
                      <div key={f.id}>
                        {displayHeader && <div style={{ fontSize: 15, fontWeight: 600, color: f.color, marginBottom: 4 }} dangerouslySetInnerHTML={{ __html: renderShortcodes(displayHeader) }} />}
                        {f.description && <div style={{ fontSize: 15, color: "#64748b", marginBottom: 6, fontStyle: "italic" }} dangerouslySetInnerHTML={{ __html: renderShortcodes(f.description) }} />}
                        {f.type === "text" && (
                          <input value={fillData[f.id] || ""} onChange={e => { setFillData(p => ({ ...p, [f.id]: e.target.value })); autoSaveFill(); }}
                            placeholder={f.placeholder?.replace(/<[^>]*>/g, "")}
                            style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
                        )}
                        {f.type === "textarea" && (
                          <textarea value={fillData[f.id] || ""} onChange={e => { setFillData(p => ({ ...p, [f.id]: e.target.value })); autoSaveFill(); }}
                            placeholder={f.placeholder?.replace(/<[^>]*>/g, "")}
                            style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box", minHeight: 100, resize: "vertical", fontFamily: "inherit" }} />
                        )}
                        {(f.type === "checkbox") && (f.options || []).map((opt, oi) => (
                          <label key={oi} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, fontSize: 15, color: "#1a2332", cursor: "pointer" }}>
                            <input type="checkbox" checked={(fillData[f.id] || "").includes(opt)}
                              onChange={e => {
                                const current = new Set((fillData[f.id] || "").split(",").filter(Boolean));
                                if (e.target.checked) current.add(opt); else current.delete(opt);
                                setFillData(p => ({ ...p, [f.id]: Array.from(current).join(",") }));
                                autoSaveFill();
                              }} style={{ accentColor: "#3B82F6" }} />
                            {opt}
                          </label>
                        ))}
                        {(f.type === "radio") && (f.options || []).map((opt, oi) => (
                          <label key={oi} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, fontSize: 15, color: "#1a2332", cursor: "pointer" }}>
                            <input type="radio" name={`field-${f.id}`} checked={fillData[f.id] === opt}
                              onChange={() => { setFillData(p => ({ ...p, [f.id]: opt })); autoSaveFill(); }} style={{ accentColor: "#3B82F6" }} />
                            {opt}
                          </label>
                        ))}
                        {f.type === "info" && (
                          <div style={{ fontSize: 15, color: "#64748b", lineHeight: 1.6, marginBottom: 4 }}>{f.description ? <span dangerouslySetInnerHTML={{ __html: renderShortcodes(f.description) }} /> : null}</div>
                        )}
                        {f.type === "fill-checklist" || (f.type === "checkbox" && f.checkboxSubtype === "fill-checklist") && (() => {
                          const items: {id:string,text:string,checked:boolean}[] = (() => { try { const p = JSON.parse(fillData[f.id] || "[]"); return Array.isArray(p) ? p : []; } catch { return []; } })();
                          return (
                            <div>
                              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                                <input placeholder={f.placeholder?.replace(/<[^>]*>/g, "") || "Add item..."}
                                  onKeyDown={e => { if (e.key === "Enter" && (e.target as HTMLInputElement).value.trim()) { const newItem = { id: crypto.randomUUID(), text: (e.target as HTMLInputElement).value.trim(), checked: false }; setFillData(p => ({ ...p, [f.id]: JSON.stringify([...items, newItem]) })); autoSaveFill(); (e.target as HTMLInputElement).value = ""; } }}
                                  style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }} />
                                <button onClick={() => { const inp = (document.getElementById(`fill-inp-${f.id}`) as HTMLInputElement); if (inp?.value?.trim()) { const newItem = { id: crypto.randomUUID(), text: inp.value.trim(), checked: false }; setFillData(p => ({ ...p, [f.id]: JSON.stringify([...items, newItem]) })); autoSaveFill(); inp.value = ""; } }}
                                  style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: "#3B82F6", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Add</button>
                              </div>
                              {items.map((item, ii) => (
                                <label key={item.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, fontSize: 15, color: "#1a2332", cursor: "pointer" }}>
                                  <input type="checkbox" checked={item.checked} onChange={e => {
                                    const n = [...items]; n[ii] = { ...n[ii], checked: e.target.checked };
                                    setFillData(p => ({ ...p, [f.id]: JSON.stringify(n) })); autoSaveFill();
                                  }} style={{ accentColor: "#3B82F6" }} />
                                  <span style={{ textDecoration: item.checked ? "line-through" : "none", color: item.checked ? "#94a3b8" : "#1a2332" }}>{item.text}</span>
                                </label>
                              ))}
                            </div>
                          );
                        })()}
                        {f.type === "big-checklist" || (f.type === "checkbox" && f.checkboxSubtype === "big-checklist") && (() => {
                          const size = f.textSize || 30;
                          const fontSizeVal = size * 0.65;
                          const checkboxSize = fontSizeVal * 1.2;
                          const layout = f.checklistLayout || "together";
                          const mode = f.bigChecklistMode || "option";

                          if (layout === "separate" && mode === "option") {
                            return (
                              <div>
                                {(f.options || []).map((opt, oi) => (
                                  <div key={oi} style={{ background: "#F8FAFC", borderRadius: 10, padding: 12, marginBottom: 8, border: "1px solid #e2e8f0" }}>
                                    <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: fontSizeVal, color: "#1a2332", cursor: "pointer" }}>
                                      <div onClick={() => {
                                        const current = new Set((fillData[f.id] || "").split(",").filter(Boolean));
                                        const checked = current.has(`opt-${oi}`);
                                        const newChecked = !checked;
                                        if (checked) current.delete(`opt-${oi}`); else current.add(`opt-${oi}`);
                                        setFillData(p => ({ ...p, [f.id]: Array.from(current).join(",") })); autoSaveFill();
                                        if (f.syncToTasks && newChecked) syncChecklistItem(true, opt);
                                      }} style={{ width: checkboxSize, height: checkboxSize, borderRadius: "50%", border: (fillData[f.id] || "").includes(`opt-${oi}`) ? "none" : "2px solid #d1d5db", background: (fillData[f.id] || "").includes(`opt-${oi}`) ? "#4CAF7D" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2, color: "#fff", fontSize: checkboxSize * 0.55 }}>
                                        {(fillData[f.id] || "").includes(`opt-${oi}`) ? "✓" : ""}
                                      </div>
                                      <span style={{ textDecoration: (fillData[f.id] || "").includes(`opt-${oi}`) ? "line-through" : "none", color: (fillData[f.id] || "").includes(`opt-${oi}`) ? "#94a3b8" : "#1a2332" }}>{opt}</span>
                                    </label>
                                  </div>
                                ))}
                              </div>
                            );
                          }

                          if (layout === "separate" && mode === "fill") {
                            return (
                              <div>
                                {(f.options || []).map((opt, oi) => {
                                  const val = (() => { try { return JSON.parse(fillData[f.id] || "{}")?.[`opt-${oi}`] || ""; } catch { return ""; } })();
                                  return (
                                    <div key={oi} style={{ background: "#F8FAFC", borderRadius: 10, padding: 12, marginBottom: 8, border: "1px solid #e2e8f0" }}>
                                      <div style={{ fontSize: fontSizeVal, color: "#1a2332", marginBottom: 4 }}>{opt}</div>
                                      <input value={val} placeholder="Enter amount..."
                                        onChange={e => {
                                          try { const obj = JSON.parse(fillData[f.id] || "{}"); obj[`opt-${oi}`] = e.target.value; setFillData(p => ({ ...p, [f.id]: JSON.stringify(obj) })); } catch { setFillData(p => ({ ...p, [f.id]: JSON.stringify({ [`opt-${oi}`]: e.target.value }) })); }
                                          autoSaveFill();
                                        }}
                                        style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: fontSizeVal * 0.8, outline: "none", boxSizing: "border-box" }} />
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          }

                          // Together layout
                          const items: {id:string,text:string,checked:boolean}[] = (() => { try { const p = JSON.parse(fillData[f.id] || "[]"); return Array.isArray(p) ? p : []; } catch { return []; } })();
                          return (
                            <div>
                              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                                <input id={`big-inp-${f.id}`} placeholder={f.placeholder?.replace(/<[^>]*>/g, "") || "Add task..."}
                                  onKeyDown={e => { if (e.key === "Enter" && (e.target as HTMLInputElement).value.trim()) { const newItem = { id: crypto.randomUUID(), text: (e.target as HTMLInputElement).value.trim(), checked: false }; setFillData(p => ({ ...p, [f.id]: JSON.stringify([...items, newItem]) })); autoSaveFill(); (e.target as HTMLInputElement).value = ""; } }}
                                  style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: fontSizeVal * 0.8, outline: "none" }} />
                                <button onClick={() => { const inp = document.getElementById(`big-inp-${f.id}`) as HTMLInputElement; if (inp?.value?.trim()) { const newItem = { id: crypto.randomUUID(), text: inp.value.trim(), checked: false }; setFillData(p => ({ ...p, [f.id]: JSON.stringify([...items, newItem]) })); autoSaveFill(); inp.value = ""; } }}
                                  style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: "#3B82F6", color: "#fff", fontSize: fontSizeVal * 0.8, fontWeight: 600, cursor: "pointer" }}>Add</button>
                              </div>
                              {items.map((item, ii) => (
                                <div key={item.id} style={{ background: mode === "option" ? "transparent" : "#F8FAFC", borderRadius: mode === "option" ? 0 : 10, padding: mode === "option" ? 0 : 10, marginBottom: mode === "option" ? 6 : 8, border: mode === "option" ? "none" : "1px solid #e2e8f0" }}>
                                  {mode === "option" ? (
                                    <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: fontSizeVal, color: "#1a2332", cursor: "pointer" }}>
                                      <div onClick={() => { const n = [...items]; n[ii] = { ...n[ii], checked: !n[ii].checked }; setFillData(p => ({ ...p, [f.id]: JSON.stringify(n) })); autoSaveFill(); if (f.syncToTasks && !n[ii].checked) syncChecklistItem(true, n[ii].text); }}
                                        style={{ width: checkboxSize, height: checkboxSize, borderRadius: "50%", border: item.checked ? "none" : "2px solid #d1d5db", background: item.checked ? "#4CAF7D" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2, color: "#fff", fontSize: checkboxSize * 0.55 }}>
                                        {item.checked ? "✓" : ""}
                                      </div>
                                      <span style={{ textDecoration: item.checked ? "line-through" : "none", color: item.checked ? "#94a3b8" : "#1a2332" }}>{item.text}</span>
                                    </label>
                                  ) : (
                                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                                      <div style={{ width: checkboxSize, height: checkboxSize, borderRadius: "50%", border: item.checked ? "none" : "2px solid #d1d5db", background: item.checked ? "#4CAF7D" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2, color: "#fff", fontSize: checkboxSize * 0.55 }}>
                                        {item.checked ? "✓" : ""}
                                      </div>
                                      <div style={{ flex: 1 }}>
                                        <input value={item.text} placeholder="Type here..."
                                          onChange={e => { const n = [...items]; n[ii] = { ...n[ii], text: e.target.value }; setFillData(p => ({ ...p, [f.id]: JSON.stringify(n) })); }}
                                          onBlur={() => autoSaveFill()}
                                          style={{ width: "100%", padding: "0", border: "none", background: "transparent", fontSize: fontSizeVal, color: "#1a2332", outline: "none", fontFamily: "inherit" }} />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                        {f.type === "sync-checklist" || (f.type === "checkbox" && f.checkboxSubtype === "sync-checklist") && (() => {
                          const items: {id:string,text:string,checked:boolean}[] = (() => { try { const p = JSON.parse(fillData[f.id] || "[]"); return Array.isArray(p) ? p : []; } catch { return []; } })();
                          return (
                            <div>
                              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                                <input id={`sync-inp-${f.id}`} placeholder={f.placeholder?.replace(/<[^>]*>/g, "") || "Add task..."}
                                  onKeyDown={e => { if (e.key === "Enter" && (e.target as HTMLInputElement).value.trim()) { const newItem = { id: crypto.randomUUID(), text: (e.target as HTMLInputElement).value.trim(), checked: false }; setFillData(p => ({ ...p, [f.id]: JSON.stringify([...items, newItem]) })); autoSaveFill(); (e.target as HTMLInputElement).value = ""; } }}
                                  style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }} />
                                <button onClick={() => { const inp = document.getElementById(`sync-inp-${f.id}`) as HTMLInputElement; if (inp?.value?.trim()) { const newItem = { id: crypto.randomUUID(), text: inp.value.trim(), checked: false }; setFillData(p => ({ ...p, [f.id]: JSON.stringify([...items, newItem]) })); autoSaveFill(); inp.value = ""; } }}
                                  style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: "#3B82F6", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Add</button>
                              </div>
                              {items.map((item, ii) => (
                                <label key={item.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, fontSize: 15, color: "#1a2332", cursor: "pointer" }}>
                                  <input type="checkbox" checked={item.checked} onChange={e => {
                                    const n = [...items]; n[ii] = { ...n[ii], checked: e.target.checked };
                                    setFillData(p => ({ ...p, [f.id]: JSON.stringify(n) })); autoSaveFill();
                                  }} style={{ accentColor: "#3B82F6" }} />
                                  <span style={{ textDecoration: item.checked ? "line-through" : "none", color: item.checked ? "#94a3b8" : "#1a2332" }}>{item.text}</span>
                                </label>
                              ))}
                              {f.syncToTasks && (
                                <div style={{ marginTop: 6, fontSize: 15, color: "#94a3b8", fontStyle: "italic" }}>
                                  <PhosphorReact.ArrowsClockwise size={12} color="#94a3b8" /> Synced to Tasks
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    );})}
                  </div>
              {fillSaveStatus && (<div style={{ marginTop: 16, textAlign: "center", fontSize: 15, color: fillSaveStatus === "saved" ? "#4CAF7D" : "#94a3b8", fontWeight: 600 }}>
                {fillSaveStatus === "saving" ? "Saving…" : "Saved ✓"}
              </div>
            )}
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "clamp(12px,2vw,20px)", background: "#F8FAFC", borderLeft: window.innerWidth >= 768 ? "1px solid #e2e8f0" : "none", borderTop: window.innerWidth < 768 ? "1px solid #e2e8f0" : "none" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 12 }}>{__('playbooks.preview', 'PREVIEW')}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1a2332", marginBottom: 16 }}>{tItem.label}</div>
            {(() => {
              const colFields: Record<number, TemplateField[]> = { 1: [], 2: [] };
              for (const f of tItem.templateFields) colFields[f.column || 1].push(f);
              const hasCol2 = colFields[2].length > 0;
              return [1, 2].map(col => colFields[col].length === 0 ? null : (
                <div key={col}>
                  {hasCol2 && <div style={{ fontSize: 15, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, marginTop: col === 2 ? 16 : 0 }}>{__('playbooks.column', 'Column')} {col}</div>}
                  {colFields[col].map((f: any) => {
                    const displayHeader = f.dateAutoFill ? getDateString(f.dateFormat || "MMMM Do, YYYY") : f.header;
                    return (
                    <div key={f.id} style={{ background: "#f1f5f9", borderRadius: 10, padding: 14, marginBottom: 10 }}>
                      {displayHeader && <div style={{ fontSize: 15, fontWeight: 600, color: f.color, marginBottom: 4 }} dangerouslySetInnerHTML={{ __html: renderShortcodes(displayHeader) }} />}
                      {f.description && <div style={{ fontSize: 15, color: "#64748b", marginBottom: 6, fontStyle: "italic" }} dangerouslySetInnerHTML={{ __html: renderShortcodes(f.description) }} />}
                      <div style={{ fontSize: 15, color: "#1a2332" }}>{f.type === "fill-checklist" || (f.type === "checkbox" && f.checkboxSubtype === "fill-checklist") || f.type === "big-checklist" || (f.type === "checkbox" && f.checkboxSubtype === "big-checklist") || f.type === "sync-checklist" || (f.type === "checkbox" && f.checkboxSubtype === "sync-checklist") ? renderChecklistPreview(fillData[f.id], f.options, f.checklistLayout, __) : fillData[f.id] || (f.placeholder && f.type !== "checkbox" && f.type !== "radio" && f.type !== "info" ? <span style={{ color: "#94a3b8" }} dangerouslySetInnerHTML={{ __html: f.placeholder }} /> : <span style={{ color: "#cbd5e1", fontStyle: "italic" }}>Empty</span>)}</div>
                    </div>
                    );
                  })}
                </div>
                ));
              })()}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}
      onDragEnd={handleDragEnd}>
      <div style={{ flex: 1, overflowY: "auto", padding: "clamp(16px,4vw,28px) clamp(16px,4vw,32px)" }}>
        {rows.map(row => (
          <div key={row.id} style={{ marginBottom: 28, position: "relative", borderRadius: 8,
            outline: dragOverRow === row.id ? "2px dashed #3B82F6" : "none", padding: dragOverRow === row.id ? "4px" : "0" }}
            onDragEnter={() => handleRowDragEnter(row.id)} onDragOver={e => e.preventDefault()} onDrop={() => handleRowDrop(row.id)}>
            {/* Row header */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <div draggable onDragStart={() => handleRowDragStart(row.id)}
                style={{ cursor: "grab", color: "#cbd5e1", fontSize: 15, padding: "0 2px", flexShrink: 0 }} title="Drag to reorder">⠿</div>
              {editingRowTitle === row.id ? (
                <input autoFocus value={editingRowTitleValue} onChange={e => setEditingRowTitleValue(e.target.value)}
                  onBlur={() => { if (editingRowTitleValue.trim() && editingRowTitleValue.trim() !== row.title) renameRow(row.id, editingRowTitleValue.trim()); setEditingRowTitle(null); }}
                  onKeyDown={e => { if (e.key === "Enter") { if (editingRowTitleValue.trim() && editingRowTitleValue.trim() !== row.title) renameRow(row.id, editingRowTitleValue.trim()); setEditingRowTitle(null); } if (e.key === "Escape") setEditingRowTitle(null); }}
                  style={{ margin: 0, fontSize: "clamp(16px,3vw,20px)", fontWeight: 700, color: "#1a2332", padding: "2px 6px", border: "1.5px solid #3B82F6", borderRadius: 4, outline: "none", background: "#fff", fontFamily: "inherit", maxWidth: 300 }} />
              ) : (
                <h2 onClick={() => { setEditingRowTitle(row.id); setEditingRowTitleValue(row.title); }}
                  style={{ margin: 0, fontSize: "clamp(16px,3vw,20px)", fontWeight: 700, color: "#1a2332", cursor: "text" }}>{row.title}</h2>
              )}
              <RowMenu row={row} onDelete={removeRow} />
              <div style={{ flex: 1 }} />
            </div>

            {/* Items grid */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}
              onDragOver={e => { e.preventDefault(); if (dragItemState) handleItemDragEnter(row.id, "__end__"); }}
              onDrop={() => handleItemDrop(row.id, "__end__")}>
              {row.items.map(item => {
                const isSingleLink = !!(!item.content && (!item.files || item.files.length === 0) && item.links?.length === 1);
                const isSingleFile = !!(!item.content && item.files?.length === 1 && (!item.links || item.links.length === 0));
                const isMulti = !!(!item.content && ((item.links && item.links.length > 1) || (item.files && item.files.length > 1)));
                const showAction = isSingleLink || isSingleFile;
                const actionLabel = isSingleFile ? `View ${item.files![0].name.split(".").pop()?.toUpperCase() || "FILE"}` : "View Link";
                const isDragTarget = dragOverItem?.rowId === row.id && dragOverItem?.itemId === item.id;
                return (
                  <Fragment key={item.id}>
                    {isDragTarget && <div style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />}
                    <PlaybookCard item={item} rowId={row.id} onDetail={openDetail} onEdit={openEditSettings}
                      onStartFill={startFill} isSingleLink={isSingleLink} isSingleFile={isSingleFile} isMulti={isMulti}
                      showAction={showAction} actionLabel={actionLabel}
                      onDragStart={() => handleItemDragStart(row.id, item.id)}
                      onDragEnter={() => handleItemDragEnter(row.id, item.id)}
                      onDrop={() => handleItemDrop(row.id, item.id)} />
                  </Fragment>
                );
              })}
              {dragOverItem?.rowId === row.id && dragOverItem?.itemId === "__end__" && row.items.length === 0 && (
                <div style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />
              )}
              {/* Add button */}
              <div onClick={() => { setCreateRowId(row.id); setShowCreate(true); }}
                style={{ width: 44, height: 44, borderRadius: "50%", border: "1.5px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#94a3b8", fontSize: 20,                 alignSelf: "center" }}>+</div>
            </div>
          </div>
        ))}

        {/* New Row */}
        <div onClick={() => { setRowModalInitial(""); setRowModalCallback(() => (name: string) => addRow(name)); setShowRowModal(true); }}
          style={{ display: "flex", alignItems: "center", gap: 8, color: "#94a3b8", fontSize: 15, cursor: "pointer", padding: "6px 0" }}>
          <div style={{ width: 26, height: 26, borderRadius: "50%", border: "1.5px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, color: "#94a3b8" }}>+</div>
          New Row
        </div>

        {/* Playbook / Template buttons */}
        <div style={{ display: "flex", gap: 10, justifyContent: "center", margin: "12px 0" }}>
          {(["document","template"] as const).map(t => (
            <div key={t} onClick={() => { const firstRow = rows[0]; if (!firstRow) { setRowModalInitial(""); setRowModalCallback(() => (name: string) => addRow(name)); setShowRowModal(true); return; } setCreateRowId(firstRow.id); setCreateType(t); if (t === "template") { setSubView("template-builder"); } else { setShowCreate(true); } }}
              style={{ flex: 1, maxWidth: 200, padding: "14px 12px", borderRadius: 10, border: "1.5px dashed #d1d5db", background: "#fff", cursor: "pointer", textAlign: "center" }}>
              <div style={{ fontSize: 22, marginBottom: 4, display: "flex", justifyContent: "center" }}>
                <IconGlyph name={t === "document" ? "Notebook" : "GitFork"} size={24} color="#94a3b8" />
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 2 }}>
                {t === "document" ? "Playbook" : "Template"}
              </div>
            </div>
          ))}
        </div>

        {/* Upload Zone */}
        <div onDragOver={e => { e.preventDefault(); setDragOverUpload(true); }} onDragLeave={() => setDragOverUpload(false)}
          onDrop={async e => { e.preventDefault(); setDragOverUpload(false); const link = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain"); if (link && (link.startsWith("http://") || link.startsWith("https://"))) { await handleLinkDrop(link); return; } const files = Array.from(e.dataTransfer.files).filter(f => f.size <= 25 * 1024 * 1024); if (files.length === 0) return; const firstRow = rows[0]; if (firstRow) { if (files.length > 1) setFileUploadPopup({ files, rowId: firstRow.id }); else await handleFileUpload(files, firstRow.id, "one"); } }}
          onPaste={async e => { const text = e.clipboardData.getData("text/plain"); if (!text) return; const urlMatch = text.match(/https?:\/\/[^\s]+/); if (urlMatch) { e.preventDefault(); await handleLinkDrop(urlMatch[0]); } }}
          style={{ margin: "12px 0", padding: "24px 16px", borderRadius: 12, border: `2px dashed ${dragOverUpload ? "#3B82F6" : "#e2e8f0"}`, background: dragOverUpload ? "#EFF6FF" : "#fff", textAlign: "center", cursor: "pointer", transition: "all 0.15s" }}
          onClick={() => { const inp = document.createElement("input"); inp.type = "file"; inp.multiple = true; inp.accept = ".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.webp,.gif"; inp.onchange = async () => { const files = Array.from(inp.files || []).filter(f => f.size <= 25 * 1024 * 1024); if (files.length === 0) return; const firstRow = rows[0]; if (firstRow) { if (files.length > 1) setFileUploadPopup({ files, rowId: firstRow.id }); else await handleFileUpload(files, firstRow.id, "one"); } }; inp.click(); }}>
          <div style={{ fontSize: 28, color: dragOverUpload ? "#3B82F6" : "#cbd5e1", marginBottom: 6 }}>
            <PhosphorReact.UploadSimple size={32} color={dragOverUpload ? "#3B82F6" : "#cbd5e1"} />
          </div>
          <div style={{ fontSize: 15, color: dragOverUpload ? "#3B82F6" : "#94a3b8", fontWeight: 500, marginBottom: 4 }}>
            {dragOverUpload ? "Drop files here" : "Drag and drop files here"}
          </div>
          <div style={{ fontSize: 15, color: "#cbd5e1", marginBottom: 8 }}>PDF, Word, Images, Text — 25MB max per file</div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 14px", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#f8fafc", fontSize: 15, color: "#94a3b8", cursor: "pointer" }}>
            <PhosphorReact.FolderOpen size={14} color="#94a3b8" /> Select files from computer
          </div>
        </div>

        {/* Upload popup */}
        {fileUploadPopup && (
          <div onClick={() => setFileUploadPopup(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2100, padding: 16 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 24, width: "100%", maxWidth: 380, boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332", marginBottom: 4 }}>{__('playbooks.uploadFiles', 'Upload')} {fileUploadPopup.files.length} {__('playbooks.files', 'files')}</div>
              <div style={{ fontSize: 15, color: "#64748b", marginBottom: 16 }}>How would you like to organize them?</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                <button onClick={() => handleFileUpload(fileUploadPopup.files, fileUploadPopup.rowId, "one")}
                  style={{ padding: "12px 16px", borderRadius: 10, border: "1.5px solid #e2e8f0", background: "#fff", cursor: "pointer", textAlign: "left", fontSize: 15, color: "#1a2332" }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>All as one playbook</div>
                  <div style={{ fontSize: 15, color: "#94a3b8" }}>Combine all files into a single playbook</div>
                </button>
                <button onClick={() => handleFileUpload(fileUploadPopup.files, fileUploadPopup.rowId, "separate")}
                  style={{ padding: "12px 16px", borderRadius: 10, border: "1.5px solid #e2e8f0", background: "#fff", cursor: "pointer", textAlign: "left", fontSize: 15, color: "#1a2332" }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{__('playbooks.separate', 'Separate playbooks')}</div>
                  <div style={{ fontSize: 15, color: "#94a3b8" }}>Create one playbook per file</div>
                </button>
              </div>
              <button onClick={() => setFileUploadPopup(null)}
                style={{ width: "100%", padding: "8px 0", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>{__('common.cancel', 'Cancel')}</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Row Modal ─────────────────────────────────────────────────── */}
      {showRowModal && (
        <EditAddRowModalCustom initial={rowModalInitial}
          onSave={(name) => { rowModalCallback?.(name); setShowRowModal(false); }}
          onClose={() => setShowRowModal(false)} />
      )}

      {/* ── Creation Workflow ─────────────────────────────────────────── */}
      {showCreate && (
        <div onClick={() => { if (createStep === 0) resetCreate(); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 520, maxHeight: "92vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}>
            {/* Step indicator */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0, marginBottom: 16 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ display: "flex", alignItems: "center" }}>
                  <div style={{ width: 24, height: 24, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                    background: createStep > i ? "#4CAF7D" : createStep === i ? "#3B82F6" : "#e2e8f0",
                    color: "#fff", fontSize: 15, fontWeight: 700, transition: "all 0.2s" }}>
                    {createStep > i ? <IconGlyph name="Check" size={14} color="#fff" weight="bold" /> : i + 1}
                  </div>
                  {i < 2 && <div style={{ width: 32, height: 2, background: createStep > i ? "#4CAF7D" : "#e2e8f0", transition: "background 0.3s" }} />}
                </div>
              ))}
            </div>

            {createStep === 0 && (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#1a2332", marginBottom: 4 }}>Create Playbook</div>
                <div style={{ fontSize: 15, color: "#64748b", marginBottom: 20 }}>Name your playbook and choose a type</div>
                <input autoFocus value={createName} onChange={e => setCreateName(e.target.value)} placeholder="Playbook name..."
                  style={{ width: "100%", padding: "12px 16px", borderRadius: 10, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", marginBottom: 16, boxSizing: "border-box" }} />
                <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 20 }}>
                  {(["document","template"] as const).map(t => (
                    <div key={t} onClick={() => setCreateType(t)} style={{ flex: 1, maxWidth: 220, padding: "20px 16px", borderRadius: 12,
                      border: `2px solid ${createType === t ? "#3B82F6" : "#e2e8f0"}`,
                      background: createType === t ? "#EFF6FF" : "#fff", cursor: "pointer", textAlign: "center", transition: "all 0.15s" }}>
                      <div style={{ fontSize: 28, marginBottom: 8, display: "flex", justifyContent: "center" }}>
                        <IconGlyph name={t === "document" ? "Notebook" : "GitFork"} size={32} color={createType === t ? "#3B82F6" : "#64748b"} />
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332", marginBottom: 4 }}>
                        {t === "document" ? "Playbook" : "Playbook Template"}
                      </div>
                      <div style={{ fontSize: 15, color: "#64748b" }}>
                        {t === "document"
                          ? "Standard operating procedures, guidelines, and scripts for your business"
                          : "Reusable templates for your team to copy and create new playbooks"}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                  <button onClick={resetCreate} style={{ padding: "10px 24px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>{__('common.cancel', 'Cancel')}</button>
                  <button onClick={() => {
                    if (createType === "template") { setSubView("template-builder"); setShowCreate(false); }
                    else setCreateStep(1);
                  }} disabled={!createName.trim() || !createType}
                    style={{ padding: "10px 24px", borderRadius: 8, border: "none",
                      background: createName.trim() && createType ? "linear-gradient(135deg,#3B82F6,#06B6D4)" : "#e2e8f0",
                      color: "#fff", fontSize: 15, fontWeight: 600, cursor: createName.trim() && createType ? "pointer" : "default" }}>
                    {createType === "template" ? "Build Template →" : "Next →"}
                  </button>
                </div>
              </div>
            )}

            {createStep === 1 && createType === "document" && (
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#1a2332", marginBottom: 4, textAlign: "center" }}>Choose Mode</div>
                <div style={{ fontSize: 15, color: "#64748b", marginBottom: 20, textAlign: "center" }}>How would you like to create this playbook?</div>
                <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 20 }}>
                  {(["editor","file"] as const).map(m => (
                    <div key={m} onClick={() => setCreateDocMode(m)} style={{ flex: 1, maxWidth: 220, padding: "20px 16px", borderRadius: 12,
                      border: `2px solid ${createDocMode === m ? "#3B82F6" : "#e2e8f0"}`,
                      background: createDocMode === m ? "#EFF6FF" : "#fff", cursor: "pointer", textAlign: "center" }}>
                      <div style={{ fontSize: 28, marginBottom: 8, display: "flex", justifyContent: "center" }}>
                        <IconGlyph name={m === "editor" ? "FileText" : "Paperclip"} size={32} color={createDocMode === m ? "#3B82F6" : "#64748b"} />
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332", marginBottom: 4 }}>
                        {m === "editor" ? "Document Mode" : "Link / File Mode"}
                      </div>
                      <div style={{ fontSize: 15, color: "#64748b" }}>
                        {m === "editor"
                          ? "Create rich text with formatting, images, and tables"
                          : "Upload a PDF, document, or add links to resources"}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                  <button onClick={() => setCreateStep(0)} style={{ padding: "10px 24px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>← Back</button>
                  <button onClick={() => setCreateStep(2)} disabled={!createDocMode}
                    style={{ padding: "10px 24px", borderRadius: 8, border: "none",
                      background: createDocMode ? "linear-gradient(135deg,#3B82F6,#06B6D4)" : "#e2e8f0",
                      color: "#fff", fontSize: 15, fontWeight: 600, cursor: createDocMode ? "pointer" : "default" }}>Next →</button>
                </div>
              </div>
            )}

            {createStep === 2 && createType === "document" && createDocMode === "editor" && (
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2332", marginBottom: 16 }}>{createName}</div>
                <RichEditor content={createContent} onChange={setCreateContent} placeholder="Start writing..." />
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 8 }}>{__('playbooks.attachments', 'ATTACHMENTS')}</div>
                  {/* Files */}
                  {createFiles.map(f => (
                    <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 6, background: "#f8fafc", marginBottom: 4, fontSize: 15, color: "#64748b" }}>
                      <IconGlyph name="FileDoc" size={16} color="#64748b" />
                      <span style={{ flex: 1 }}>{f.name}</span>
                      <span style={{ color: "#94a3b8" }}>{(f.size / 1024).toFixed(0)}KB</span>
                      <button onClick={() => setCreateFiles(p => p.filter(x => x.id !== f.id))} style={{ width: 20, height: 20, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 15, background: "#fee2e2", color: "#E85D75" }}>✕</button>
                    </div>
                  ))}
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 6, border: "1px dashed #d1d5db", cursor: "pointer", fontSize: 15, color: "#94a3b8", marginBottom: 8 }}>
                    {createUploading ? "Uploading..." : "Upload File"}
                    <input type="file" onChange={handleCreateFileUpload} style={{ display: "none" }} accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.webp,.gif" />
                  </label>
                  {/* Links */}
                  {createLinks.map(l => (
                    <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <input value={l.title} onChange={e => updateCreateLink(l.id, { title: e.target.value })} placeholder="Link title"
                        style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }} />
                      <input value={l.url} onChange={e => updateCreateLink(l.id, { url: e.target.value })} placeholder="URL"
                        style={{ flex: 2, padding: "6px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }} />
                      <button onClick={() => removeCreateLink(l.id)} style={{ width: 22, height: 22, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 15, background: "#fee2e2", color: "#E85D75" }}>✕</button>
                    </div>
                  ))}
                  <button onClick={handleCreateAddLink} style={{ display: "block", padding: "6px 14px", borderRadius: 6, border: "1px dashed #d1d5db", background: "transparent", fontSize: 15, cursor: "pointer", color: "#94a3b8", marginTop: 4 }}>+ Add Link</button>
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
                  <button onClick={() => setCreateStep(1)} style={{ padding: "10px 24px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>← Back</button>
                  <button onClick={handleCreateSave} style={{ padding: "10px 28px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{__('common.save', 'Save')}</button>
                </div>
              </div>
            )}

            {createStep === 2 && createType === "document" && createDocMode === "file" && (
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2332", marginBottom: 16 }}>{createName}</div>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 8 }}>{__('playbooks.files', 'FILES')}</div>
                  {createFiles.map(f => (
                    <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 6, background: "#f8fafc", marginBottom: 4, fontSize: 15, color: "#64748b" }}>
                      <IconGlyph name="FileDoc" size={16} color="#64748b" />
                      <span style={{ flex: 1 }}>{f.name}</span>
                      <span style={{ color: "#94a3b8" }}>{(f.size / 1024).toFixed(0)}KB</span>
                      <button onClick={() => setCreateFiles(p => p.filter(x => x.id !== f.id))} style={{ width: 20, height: 20, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 15, background: "#fee2e2", color: "#E85D75" }}>✕</button>
                    </div>
                  ))}
                  <label style={{ display: "block", padding: "20px", borderRadius: 8, border: "2px dashed #e2e8f0", cursor: "pointer", textAlign: "center", fontSize: 15, color: "#94a3b8", marginBottom: 8 }}>
                    {createUploading ? "Uploading..." : "Click to upload or drag and drop (max 25MB)"}
                    <input type="file" onChange={handleCreateFileUpload} style={{ display: "none" }} accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.webp,.gif" />
                  </label>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 8 }}>{__('playbooks.links', 'LINKS')}</div>
                  {createLinks.map(l => (
                    <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <input value={l.title} onChange={e => updateCreateLink(l.id, { title: e.target.value })} placeholder="Link title"
                        style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }} />
                      <input value={l.url} onChange={e => updateCreateLink(l.id, { url: e.target.value })} placeholder="URL"
                        style={{ flex: 2, padding: "6px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }} />
                      <button onClick={() => removeCreateLink(l.id)} style={{ width: 22, height: 22, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 15, background: "#fee2e2", color: "#E85D75" }}>✕</button>
                    </div>
                  ))}
                  <button onClick={handleCreateAddLink} style={{ padding: "6px 14px", borderRadius: 6, border: "1px dashed #d1d5db", background: "transparent", fontSize: 15, cursor: "pointer", color: "#94a3b8" }}>+ Add Link</button>
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
                  <button onClick={() => setCreateStep(1)} style={{ padding: "10px 24px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>← Back</button>
                  <button onClick={handleCreateSave} style={{ padding: "10px 28px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{__('common.save', 'Save')}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Detail Modal ──────────────────────────────────────────────── */}
      {detailItem && (
        <div onClick={() => setDetailItem(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 640, maxHeight: "92vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.2)", position: "relative" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 20 }}>
              {detailItem.icon && <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#fff", border: "1.5px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <IconGlyph name={detailItem.icon} size={20} color="#3B82F6" />
              </div>}
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1a2332" }}>{detailItem.label}</h2>
                <div style={{ fontSize: 15, color: "#94a3b8", marginTop: 2 }}>
                  {detailItem.type === "document" ? "Document" : detailItem.type === "template" ? "Template" : "Filled Playbook"}
                  {detailItem.type === "filled-template" && detailSaveStatus === "saved" && <span style={{ color: "#4CAF7D", fontWeight: 600, marginLeft: 6 }}>✓</span>}
                  {detailItem.type === "filled-template" && detailSaveStatus === "saving" && <span style={{ color: "#94a3b8", marginLeft: 6 }}>…</span>}
                  {detailItem.createdAt ? ` · ${new Date(detailItem.createdAt).toLocaleDateString()}` : ""}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => { openEditSettings(detailItem); }}
                  style={{ width: 32, height: 32, borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <IconGlyph name="Gear" size={16} color="#64748b" />
                </button>
                <button onClick={async () => {
                  if (detailItem.content) {
                    await downloadPdf("playbook-content", `${detailItem.label}.pdf`);
                  }
                }} title="Download PDF"
                  style={{ width: 32, height: 32, borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <IconGlyph name="Download" size={16} color="#64748b" />
                </button>
                <button onClick={() => setDetailItem(null)} style={{ width: 32, height: 32, borderRadius: 8, border: "none", background: "#f1f5f9", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "#64748b" }}>×</button>
              </div>
            </div>

            {detailItem.content && (
              <div id="playbook-content" style={{ fontSize: 15, lineHeight: 1.7, color: "#1a2332", padding: "20px 40px", border: "none", marginBottom: 16, maxWidth: 800, marginLeft: "auto", marginRight: "auto" }}
                dangerouslySetInnerHTML={{ __html: renderShortcodes(detailItem.content) }} />
            )}

            {detailItem.files && detailItem.files.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 8 }}>{__('playbooks.files', 'FILES')}</div>
                {detailItem.files.map(f => (
                  <a key={f.id} href={getFileUrl(f.storagePath)} target="_blank" rel="noopener noreferrer"
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 6, background: "#f8fafc", marginBottom: 4, textDecoration: "none", fontSize: 15, color: "#1a2332" }}>
                    <IconGlyph name="FileDoc" size={18} color="#64748b" />
                    <span style={{ flex: 1 }}>{f.name}</span>
                    <IconGlyph name="ArrowUpRight" size={14} color="#3B82F6" weight="bold" />
                  </a>
                ))}
              </div>
            )}

            {detailItem.links && detailItem.links.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 8 }}>{__('playbooks.links', 'LINKS')}</div>
                {detailItem.links.map(l => (
                  <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer"
                    style={{ display: "block", padding: "8px 12px", borderRadius: 6, background: "#f8fafc", marginBottom: 4, textDecoration: "none", fontSize: 15 }}>
                    <div style={{ fontWeight: 600, color: "#1a2332", marginBottom: 2 }}>{l.title || l.url}</div>
                    <div style={{ color: "#3B82F6", fontSize: 15, wordBreak: "break-all" }}>{l.url}</div>
                  </a>
                ))}
              </div>
            )}

            {detailItem.type === "filled-template" && detailItem.filledData && detailItem.templateId && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 8 }}>{__('playbooks.content', 'CONTENT')}</div>
                {(() => {
                  const template = rows.flatMap(r => r.items).find(i => i.id === detailItem.templateId);
                  return template?.templateFields?.map(f => {
                    const displayHeader = f.dateAutoFill ? getDateString(f.dateFormat || "MMMM Do, YYYY") : f.header;
                    return (
                    <div key={f.id} style={{ background: "#f1f5f9", borderRadius: 8, padding: 12, marginBottom: 8 }}>
                      {displayHeader && <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4, color: f.color }} dangerouslySetInnerHTML={{ __html: renderShortcodes(displayHeader) }} />}
                      {f.description && <div style={{ fontSize: 15, color: "#64748b", marginBottom: 6, fontStyle: "italic" }}>{f.description}</div>}
                      {f.type === "text" && (
                        <input value={detailFillData[f.id] || ""} onChange={e => { setDetailFillData(p => ({ ...p, [f.id]: e.target.value })); autoSaveDetail(); }}
                          placeholder={f.placeholder?.replace(/<[^>]*>/g, "")}
                          style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
                      )}
                      {f.type === "textarea" && (
                        <textarea value={detailFillData[f.id] || ""} onChange={e => { setDetailFillData(p => ({ ...p, [f.id]: e.target.value })); autoSaveDetail(); }}
                          placeholder={f.placeholder?.replace(/<[^>]*>/g, "")}
                          style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box", minHeight: 60, resize: "vertical", fontFamily: "inherit" }} />
                      )}
                      {f.type === "info" && f.description && (
                        <div style={{ fontSize: 15, color: "#64748b", lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: renderShortcodes(f.description) }} />
                      )}
                      {(f.type === "checkbox") && (f.options || []).map((opt, oi) => (
                        <label key={oi} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, fontSize: 15, color: "#1a2332", cursor: "pointer" }}>
                          <input type="checkbox" checked={(detailFillData[f.id] || "").includes(opt)}
                            onChange={e => {
                              const current = new Set((detailFillData[f.id] || "").split(",").filter(Boolean));
                              if (e.target.checked) current.add(opt); else current.delete(opt);
                              setDetailFillData(p => ({ ...p, [f.id]: Array.from(current).join(",") }));
                              autoSaveDetail();
                            }} style={{ accentColor: "#3B82F6" }} />
                          {opt}
                        </label>
                      ))}
                      {(f.type === "radio") && (f.options || []).map((opt, oi) => (
                        <label key={oi} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, fontSize: 15, color: "#1a2332", cursor: "pointer" }}>
                          <input type="radio" name={`detail-${f.id}`} checked={detailFillData[f.id] === opt}
                            onChange={() => { setDetailFillData(p => ({ ...p, [f.id]: opt })); autoSaveDetail(); }} style={{ accentColor: "#3B82F6" }} />
                          {opt}
                        </label>
                      ))}
                      {f.type === "fill-checklist" || (f.type === "checkbox" && f.checkboxSubtype === "fill-checklist") && (() => {
                        const items: {id:string,text:string,checked:boolean}[] = (() => { try { const p = JSON.parse(detailFillData[f.id] || "[]"); return Array.isArray(p) ? p : []; } catch { return []; } })();
                        return (
                          <div>
                            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                              <input placeholder={f.placeholder?.replace(/<[^>]*>/g, "") || "Add item..."}
                                onKeyDown={e => { if (e.key === "Enter" && (e.target as HTMLInputElement).value.trim()) { const newItem = { id: crypto.randomUUID(), text: (e.target as HTMLInputElement).value.trim(), checked: false }; setDetailFillData(p => ({ ...p, [f.id]: JSON.stringify([...items, newItem]) })); autoSaveDetail(); (e.target as HTMLInputElement).value = ""; } }}
                                style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }} />
                              <button onClick={() => { const inp = document.getElementById(`detail-inp-${f.id}`) as HTMLInputElement; if (inp?.value?.trim()) { const newItem = { id: crypto.randomUUID(), text: inp.value.trim(), checked: false }; setDetailFillData(p => ({ ...p, [f.id]: JSON.stringify([...items, newItem]) })); autoSaveDetail(); inp.value = ""; } }}
                                style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: "#3B82F6", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Add</button>
                            </div>
                            {items.map((item, ii) => (
                              <label key={item.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, fontSize: 15, color: "#1a2332", cursor: "pointer" }}>
                                <input type="checkbox" checked={item.checked} onChange={e => { const n = [...items]; n[ii] = { ...n[ii], checked: e.target.checked }; setDetailFillData(p => ({ ...p, [f.id]: JSON.stringify(n) })); autoSaveDetail(); }} style={{ accentColor: "#3B82F6" }} />
                                <span style={{ textDecoration: item.checked ? "line-through" : "none", color: item.checked ? "#94a3b8" : "#1a2332" }}>{item.text}</span>
                              </label>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  );});
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Edit Settings Modal ───────────────────────────────────────── */}
      {editSettingsItem && !editSettingsExpanded && (
        <div onClick={() => { setEditSettingsItem(null); setEditSettingsExpanded(false); setDeleteConfirmText(""); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2100, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 720, maxHeight: "90vh", overflow: "hidden", boxShadow: "0 24px 64px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "20px 24px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 12 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#1a2332", flex: 1 }}>Edit {editSettingsItem.type === "template" ? "Template" : "Playbook"}</h2>
              <button onClick={() => setEditSettingsExpanded(true)}
                style={{ width: 26, height: 26, borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: "#64748b" }} title="Expand">⛶</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>{__('playbooks.name', 'PLAYBOOK NAME')}</div>
                <input value={editSettingsName} onChange={e => setEditSettingsName(e.target.value)}
                  style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>{__('playbooks.icon', 'ICON')}</div>
                <IconPicker selected={editSettingsIcon} onSelect={setEditSettingsIcon} />
              </div>
              {editSettingsItem.type !== "template" && (
                <>
                {(editSettingsFiles.length > 0 || editSettingsLinks.length > 0 || !editSettingsContent) ? (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 8 }}>{__('playbooks.attachments', 'ATTACHMENTS')}</div>
                    {editSettingsFiles.map(f => (
                      <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 6, background: "#f8fafc", marginBottom: 4, fontSize: 15, color: "#64748b" }}>
                        <IconGlyph name="FileDoc" size={16} color="#64748b" />
                        <span style={{ flex: 1 }}>{f.name}</span>
                        <span style={{ color: "#94a3b8" }}>{(f.size / 1024).toFixed(0)}KB</span>
                        <button onClick={() => setEditSettingsFiles(p => p.filter(x => x.id !== f.id))} style={{ width: 20, height: 20, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 15, background: "#fee2e2", color: "#E85D75" }}>✕</button>
                      </div>
                    ))}
                    <label style={{ display: "block", padding: "14px", borderRadius: 8, border: "2px dashed #e2e8f0", cursor: "pointer", textAlign: "center", fontSize: 15, color: "#94a3b8", marginBottom: 8 }}>
                      {editSettingsUploading ? "Uploading..." : "Click to upload or drag and drop (max 25MB)"}
                      <input type="file" onChange={handleEditSettingsUpload} style={{ display: "none" }} accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.webp,.gif" />
                    </label>
                    {editSettingsLinks.map(l => (
                      <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                        <input value={l.title} onChange={e => setEditSettingsLinks(p => p.map(x => x.id === l.id ? { ...x, title: e.target.value } : x))} placeholder="Link title"
                          style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }} />
                        <input value={l.url} onChange={e => setEditSettingsLinks(p => p.map(x => x.id === l.id ? { ...x, url: e.target.value } : x))} placeholder="URL"
                          style={{ flex: 2, padding: "6px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }} />
                        <button onClick={() => setEditSettingsLinks(p => p.filter(x => x.id !== l.id))} style={{ width: 22, height: 22, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 15, background: "#fee2e2", color: "#E85D75" }}>✕</button>
                      </div>
                    ))}
                    <button onClick={() => setEditSettingsLinks(p => [...p, { id: crypto.randomUUID(), title: "", url: "" }])} style={{ padding: "6px 14px", borderRadius: 6, border: "1px dashed #d1d5db", background: "transparent", fontSize: 15, cursor: "pointer", color: "#94a3b8", marginTop: 4 }}>+ Add Link</button>
                  </div>
                ) : (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>{__('playbooks.content', 'CONTENT')}</div>
                    <RichEditor content={editSettingsContent} onChange={setEditSettingsContent} />
                  </div>
                )}
                {(editSettingsContent && (editSettingsFiles.length > 0 || editSettingsLinks.length > 0)) && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 8 }}>{__('playbooks.attachments', 'ATTACHMENTS')}</div>
                    {editSettingsFiles.map(f => (
                      <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 6, background: "#f8fafc", marginBottom: 4, fontSize: 15, color: "#64748b" }}>
                        <IconGlyph name="FileDoc" size={16} color="#64748b" />
                        <span style={{ flex: 1 }}>{f.name}</span>
                        <button onClick={() => setEditSettingsFiles(p => p.filter(x => x.id !== f.id))} style={{ width: 20, height: 20, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 15, background: "#fee2e2", color: "#E85D75" }}>✕</button>
                      </div>
                    ))}
                    {editSettingsLinks.map(l => (
                      <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                        <input value={l.title} onChange={e => setEditSettingsLinks(p => p.map(x => x.id === l.id ? { ...x, title: e.target.value } : x))} placeholder="Link title"
                          style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }} />
                        <input value={l.url} onChange={e => setEditSettingsLinks(p => p.map(x => x.id === l.id ? { ...x, url: e.target.value } : x))} placeholder="URL"
                          style={{ flex: 2, padding: "6px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }} />
                        <button onClick={() => setEditSettingsLinks(p => p.filter(x => x.id !== l.id))} style={{ width: 22, height: 22, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 15, background: "#fee2e2", color: "#E85D75" }}>✕</button>
                      </div>
                    ))}
                    <button onClick={() => setEditSettingsLinks(p => [...p, { id: crypto.randomUUID(), title: "", url: "" }])} style={{ padding: "6px 14px", borderRadius: 6, border: "1px dashed #d1d5db", background: "transparent", fontSize: 15, cursor: "pointer", color: "#94a3b8", marginTop: 4 }}>+ Add Link</button>
                  </div>
                )}
                </>
              )}
              {(editSettingsItem.type === "document" || editSettingsItem.type === "filled-template") && (
                <div style={{ marginBottom: 14, padding: 14, background: "#f8fafc", borderRadius: 10, border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 8 }}>{__('playbooks.recurrence', 'RECURRENCE SETTINGS')}</div>
                  <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 15, color: "#64748b", cursor: "pointer" }}>
                    <input type="checkbox" checked={editSettingsRecurrence.enabled} onChange={e => setEditSettingsRecurrence(p => ({ ...p, enabled: e.target.checked }))}
                      style={{ accentColor: "#3B82F6", margin: 0 }} /> Auto-reset this item
                  </label>
                  {editSettingsRecurrence.enabled && (
                    <>
                      <select value={editSettingsRecurrence.interval} onChange={e => setEditSettingsRecurrence(p => ({ ...p, interval: e.target.value as RecurrenceInterval }))}
                        style={{ width: "100%", marginTop: 6, padding: "6px 10px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 15, outline: "none" }}>
                        <option value="daily">Every Day</option>
                        <option value="weekly">Every Week</option>
                        <option value="monthly">Every Month</option>
                        <option value="quarterly">Every Quarter</option>
                        <option value="semi-annually">Every 6 Months</option>
                        <option value="yearly">Every Year</option>
                        <option value="custom">Custom...</option>
                      </select>
                      {editSettingsRecurrence.interval === "custom" && (
                        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6 }}>
                          <span style={{ fontSize: 15, color: "#64748b" }}>Every</span>
                          <input type="number" min={1} value={editSettingsRecurrence.customDays || 1} onChange={e => setEditSettingsRecurrence(p => ({ ...p, customDays: parseInt(e.target.value) || 1 }))}
                            style={{ width: 60, padding: "4px 8px", borderRadius: 4, border: "1px solid #e2e8f0", fontSize: 15, outline: "none" }} />
                          <span style={{ fontSize: 15, color: "#64748b" }}>days</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            <div style={{ padding: "16px 24px", borderTop: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
              {deleteConfirmText ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 15, color: "#E85D75", fontWeight: 600 }}>{__('common.areYouSure', 'Are you sure?')}</span>
                  <button onClick={() => setDeleteConfirmText("")}
                    style={{ padding: "6px 14px", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>{__('common.cancel', 'Cancel')}</button>
                  <button onClick={deleteItem}
                    style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#E85D75", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{__('common.yesDelete', 'Yes, Delete')}</button>
                </div>
              ) : (
                <>
                  <button onClick={() => setDeleteConfirmText("pending")} style={{ padding: "8px 16px", borderRadius: 8, border: "1.5px solid #E85D75", background: "#fff", fontSize: 15, cursor: "pointer", color: "#E85D75", fontWeight: 600 }}>{__('common.delete', 'Delete')}</button>
                  <button onClick={duplicateItem} style={{ padding: "8px 16px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>{__('common.duplicate', 'Duplicate')}</button>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => { setEditSettingsItem(null); setEditSettingsExpanded(false); setDeleteConfirmText(""); }} style={{ padding: "8px 18px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>{__('common.cancel', 'Cancel')}</button>
                  <button onClick={saveEditSettings} style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{__('common.save', 'Save')}</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Settings EXPANDED (full inline) ────────────────────────── */}
      {editSettingsItem && editSettingsExpanded && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2100, background: "#fff", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px clamp(16px,3vw,24px)", borderBottom: "1px solid #e2e8f0", background: "#fff", flexShrink: 0 }}>
            <button onClick={() => setEditSettingsExpanded(false)}
              style={{ padding: "6px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>← Collapse</button>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#1a2332", flex: 1 }}>Editing: {editSettingsName || editSettingsItem.label}</h2>
            <button onClick={saveEditSettings} style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>{__('common.save', 'Save')}</button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "clamp(16px,3vw,28px)", display: "flex", gap: 24, flexDirection: "row" }}>
            <div style={{ width: 280, flexShrink: 0 }}>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>{__('playbooks.name', 'PLAYBOOK NAME')}</div>
                <input value={editSettingsName} onChange={e => setEditSettingsName(e.target.value)}
                  style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>{__('playbooks.icon', 'ICON')}</div>
                <IconPicker selected={editSettingsIcon} onSelect={setEditSettingsIcon} />
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {(editSettingsFiles.length > 0 || editSettingsLinks.length > 0 || !editSettingsContent) ? (
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 8 }}>{__('playbooks.attachments', 'ATTACHMENTS')}</div>
                  {editSettingsFiles.map(f => (
                    <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 6, background: "#f8fafc", marginBottom: 4, fontSize: 15, color: "#64748b" }}>
                      <IconGlyph name="FileDoc" size={16} color="#64748b" />
                      <span style={{ flex: 1 }}>{f.name}</span>
                      <button onClick={() => setEditSettingsFiles(p => p.filter(x => x.id !== f.id))} style={{ width: 20, height: 20, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 15, background: "#fee2e2", color: "#E85D75" }}>✕</button>
                    </div>
                  ))}
                  <label style={{ display: "block", padding: "20px", borderRadius: 8, border: "2px dashed #e2e8f0", cursor: "pointer", textAlign: "center", fontSize: 15, color: "#94a3b8", marginBottom: 12 }}>
                    {editSettingsUploading ? "Uploading..." : "Click to upload or drag and drop (max 25MB)"}
                    <input type="file" onChange={handleEditSettingsUpload} style={{ display: "none" }} accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.webp,.gif" />
                  </label>
                  {editSettingsLinks.map(l => (
                    <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <input value={l.title} onChange={e => setEditSettingsLinks(p => p.map(x => x.id === l.id ? { ...x, title: e.target.value } : x))} placeholder="Link title"
                        style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }} />
                      <input value={l.url} onChange={e => setEditSettingsLinks(p => p.map(x => x.id === l.id ? { ...x, url: e.target.value } : x))} placeholder="URL"
                        style={{ flex: 2, padding: "6px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none" }} />
                      <button onClick={() => setEditSettingsLinks(p => p.filter(x => x.id !== l.id))} style={{ width: 22, height: 22, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 15, background: "#fee2e2", color: "#E85D75" }}>✕</button>
                    </div>
                  ))}
                  <button onClick={() => setEditSettingsLinks(p => [...p, { id: crypto.randomUUID(), title: "", url: "" }])} style={{ padding: "6px 14px", borderRadius: 6, border: "1px dashed #d1d5db", background: "transparent", fontSize: 15, cursor: "pointer", color: "#94a3b8" }}>+ Add Link</button>
                  {editSettingsContent && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>{__('playbooks.content', 'CONTENT')}</div>
                      <RichEditor content={editSettingsContent} onChange={setEditSettingsContent} />
                    </div>
                  )}
                </div>
              ) : (
                <RichEditor content={editSettingsContent} onChange={setEditSettingsContent} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Inline Row Edit Modal ────────────────────────────────────────────────
function EditAddRowModalCustom({ initial, onSave, onClose }: {
  initial?: string; onSave: (name: string) => void; onClose: () => void;
}) {
  const { t: __ } = useTranslation();
  const [name, setName] = useState(initial ?? "");
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 380, boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#1a2332", marginBottom: 4 }}>
          {initial ? "Rename Row" : "New Row"}
        </h2>
        <div style={{ fontSize: 15, color: "#64748b", marginBottom: 16 }}>Give your row a name</div>
        <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Row name..."
          onKeyDown={e => { if (e.key === "Enter" && name.trim()) onSave(name.trim()); }}
          style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", marginBottom: 16, boxSizing: "border-box" }} />
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b" }}>{__('common.cancel', 'Cancel')}</button>
          <button onClick={() => name.trim() && onSave(name.trim())} disabled={!name.trim()}
            style={{ padding: "8px 18px", borderRadius: 8, border: "none",
              background: name.trim() ? "linear-gradient(135deg,#3B82F6,#06B6D4)" : "#e2e8f0",
              color: "#fff", fontSize: 15, fontWeight: 600, cursor: name.trim() ? "pointer" : "default" }}>{__('common.save', 'Save')}</button>
        </div>
      </div>
    </div>
  );
}

function PlaybookCard({ item, rowId, onDetail, onEdit, onStartFill, isSingleLink, isSingleFile, isMulti, showAction, actionLabel, onDragStart, onDragEnter, onDrop }: {
  item: PlaybookItem; rowId: string;
  onDetail: (item: PlaybookItem) => void; onEdit: (item: PlaybookItem) => void; onStartFill: (item: PlaybookItem, rid: string) => void;
  isSingleLink?: boolean; isSingleFile?: boolean; isMulti?: boolean; showAction?: boolean; actionLabel?: string;
  onDragStart?: () => void; onDragEnter?: () => void; onDrop?: () => void;
}) {
  const { t: __ } = useTranslation();
  const [cardHov, setCardHov] = useState(false);
  const activeColor = item.type === "template" ? "#3B82F6" : item.type === "filled-template" ? "#4CAF7D" : "#64748b";
  return (
    <div draggable onDragStart={onDragStart} onDragEnter={onDragEnter} onDrop={onDrop}
      onMouseEnter={() => setCardHov(true)} onMouseLeave={() => setCardHov(false)}
      onClick={() => onDetail(item)}
      style={{ width: 150, minHeight: 150, background: "#fff", borderRadius: 16, border: "1px solid #f1f5f9",
        padding: "14px 12px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        cursor: "pointer", position: "relative", flexShrink: 0,
        transform: cardHov ? "translateY(-3px)" : "none",
        transition: "transform 0.15s, box-shadow 0.15s",
        boxShadow: cardHov ? "0 10px 28px rgba(0,0,0,0.12)" : "0 2px 8px rgba(0,0,0,0.06)" }}>
      {item.icon && <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
        <IconGlyph name={item.icon} size={20} color={activeColor} />
      </div>}
      <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332", textAlign: "center", lineHeight: 1.3, marginBottom: 8 }}>{item.label}</div>
      {item.type === "template" ? (
        <div onClick={e => { e.stopPropagation(); onStartFill(item, rowId); }}
          style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, background: "#EFF6FF", color: "#3B82F6", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
          + Add New
        </div>
      ) : item.type === "filled-template" ? (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, background: "#F0FDF4", color: "#4CAF7D", fontSize: 15, fontWeight: 500 }}>
          <IconGlyph name="Check" size={12} color="#4CAF7D" weight="bold" /> View
        </div>
      ) : showAction ? (
        <a href={isSingleLink ? item.links![0].url : (isSingleFile ? getFileUrl(item.files![0].storagePath) : "#")}
          target="_blank" rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, background: "#EFF6FF", color: "#3B82F6", fontSize: 15, fontWeight: 500, textDecoration: "none" }}>
          {actionLabel} <IconGlyph name="ArrowUpRight" size={12} color="#3B82F6" weight="bold" />
        </a>
      ) : isMulti ? (
        <div style={{ fontSize: 15, color: "#94a3b8", textAlign: "center" }}>
          {item.links && item.links.length > 0 ? `${item.links.length} link${item.links.length > 1 ? "s" : ""}` : ""}
          {item.links && item.links.length > 0 && item.files && item.files.length > 0 ? " · " : ""}
          {item.files && item.files.length > 0 ? `${item.files.length} file${item.files.length > 1 ? "s" : ""}` : ""}
        </div>
      ) : item.content ? (
        <div style={{ fontSize: 15, color: "#94a3b8" }}>{__('playbooks.viewDocument', 'View Document')}</div>
      ) : null}
      <div style={{ position: "absolute", top: 6, right: 6, display: "flex", gap: 2 }}>
        <div onClick={e => { e.stopPropagation(); onEdit(item); }}
          style={{ width: 22, height: 22, borderRadius: 6, background: cardHov ? "#f1f5f9" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 15, color: "#94a3b8" }}>···</div>
      </div>
    </div>
  );
}
