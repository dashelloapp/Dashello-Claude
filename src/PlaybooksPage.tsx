import { useState, useRef, useEffect, useCallback, Fragment } from "react";
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
const ICON_NAMES = [
  "Notebook","FileText","FilePdf","FileDoc","FileImage","Link","GitFork","Target",
  "CheckSquare","BookOpen","Scroll","ClipboardText","ListChecks","Article","Newspaper",
  "ReadCvLogo","Books","GraduationCap","ChalkboardTeacher","PresentationChart",
  "Lightbulb","Strategy","FlowArrow","ShareNetwork","ShareFat","PaperPlaneTilt",
  "Envelope","ChatCircleDots","ChatText","RocketLaunch","Rocket","MagicWand",
  "Star","Heart","Fire","Crown","Medal","Trophy","Award","Certificate",
];

function IconPicker({ selected, onSelect }: { selected: string; onSelect: (icon: string) => void }) {
  const [search, setSearch] = useState("");
  const displayIcons = search.trim()
    ? ICON_NAMES.filter(i => i.toLowerCase().includes(search.toLowerCase()))
    : ICON_NAMES;
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
      <div style={{ height: 140, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 10, padding: 6 }}>
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
        <div style={{ marginTop: 6, fontSize: 12, color: "#64748b", display: "flex", alignItems: "center", gap: 6 }}>
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
type TemplateFieldType = "text" | "textarea" | "checkbox" | "radio";
interface TemplateField {
  id: string;
  type: TemplateFieldType;
  header: string;
  placeholder: string;
  required: boolean;
  options?: string[];
  color: string;
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
}
interface PlaybookRow {
  id: string;
  title: string;
  items: PlaybookItem[];
}

// ── TipTap Rich Text Editor ───────────────────────────────────────────────
function MenuBar({ editor }: { editor: any }) {
  if (!editor) return null;
  const addImage = () => {
    const url = window.prompt("Image URL");
    if (url) editor.chain().focus().setImage({ src: url }).run();
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 2, padding: "6px 8px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
      {[["Bold","bold"],["Italic","italic"],["Underline","underline"]].map(([label, action]) => (
        <button key={action} onClick={() => editor.chain().focus()[action === "underline" ? "toggleUnderline" : "toggle" + label]().run()} title={label}
          style={{ width: 28, height: 28, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
            background: editor.isActive(action === "underline" ? "underline" : label.toLowerCase()) ? "#dbeafe" : "transparent",
            color: editor.isActive(action === "underline" ? "underline" : label.toLowerCase()) ? "#3B82F6" : "#64748b" }}>
          {label === "Bold" ? "B" : label === "Italic" ? "I" : "U"}</button>
      ))}
      <div style={{ width: 1, background: "#e2e8f0", margin: "0 4px" }} />
      {[["H1",1],["H2",2],["H3",3]].map(([l,level]) => (
        <button key={String(level)} onClick={() => editor.chain().focus().toggleHeading({ level: level as 1|2|3 }).run()} title={`Heading ${level}`}
          style={{ width: 32, height: 28, borderRadius: 4, border: "none", cursor: "pointer", fontSize: level === 1 ? 13 : level === 2 ? 12 : 11, fontWeight: 700,
            background: editor.isActive("heading", { level }) ? "#dbeafe" : "transparent",
            color: editor.isActive("heading", { level }) ? "#3B82F6" : "#64748b" }}>{l}</button>
      ))}
      <div style={{ width: 1, background: "#e2e8f0", margin: "0 4px" }} />
      {[["left","Left"],["center","Center"],["right","Right"]].map(([align,label]) => (
        <button key={align} onClick={() => editor.chain().focus().setTextAlign(align).run()} title={label}
          style={{ width: 28, height: 28, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 11,
            background: editor.isActive({ textAlign: align }) ? "#dbeafe" : "transparent",
            color: editor.isActive({ textAlign: align }) ? "#3B82F6" : "#64748b" }}>{label[0]}</button>
      ))}
      <div style={{ width: 1, background: "#e2e8f0", margin: "0 4px" }} />
      <button onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list"
        style={{ width: 28, height: 28, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 12,
          background: editor.isActive("bulletList") ? "#dbeafe" : "transparent", color: "#64748b" }}>•</button>
      <button onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list"
        style={{ width: 28, height: 28, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 11,
          background: editor.isActive("orderedList") ? "#dbeafe" : "transparent", color: "#64748b" }}>1.</button>
      <div style={{ width: 1, background: "#e2e8f0", margin: "0 4px" }} />
      <button onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Quote"
        style={{ width: 28, height: 28, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 12,
          background: editor.isActive("blockquote") ? "#dbeafe" : "transparent", color: "#64748b" }}>❝</button>
      <button onClick={addImage} title="Insert image"
        style={{ width: 28, height: 28, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 12, color: "#64748b" }}>🖼</button>
      <button onClick={() => editor.chain().focus().toggleTable().run()} title="Table"
        style={{ width: 28, height: 28, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 12,
          background: editor.isActive("table") ? "#dbeafe" : "transparent", color: "#64748b" }}>⊞</button>
      {editor.isActive("table") && (
        <button onClick={() => editor.chain().focus().deleteTable().run()} title="Delete table"
          style={{ width: 28, height: 28, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 10, color: "#E85D75" }}>✕</button>
      )}
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
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      ImageExt,
      LinkExt.configure({ openOnClick: true }),
      TableExt.configure({ resizable: true }),
      TableRow, TableCell, TableHeader,
      TextStyle, Color, Highlight,
    ],
    content: content || "",
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: { class: "prose" as string },
    },
  });

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content || "");
    }
  }, [content]);

  return (
    <div style={{ border: "1.5px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
      <MenuBar editor={editor} />
      <div style={{ padding: "12px 16px", minHeight: 300, maxHeight: 500, overflowY: "auto", fontSize: 14, lineHeight: 1.6, color: "#1a2332" }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function RichEditorSmall({ content, onChange }: { content: string; onChange: (html: string) => void }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      TextStyle, Color,
    ],
    content: content || "",
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content || "");
    }
  }, [content]);
  return (
    <div style={{ border: "1.5px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 2, padding: "3px 6px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
        {[["B","bold"],["I","italic"],["U","underline"]].map(([label,action]) => (
          <button key={action} onClick={() => {
            if (!editor) return;
            const chain = editor.chain().focus();
            if (action === "underline") chain.toggleUnderline().run();
            else if (action === "bold") chain.toggleBold().run();
            else if (action === "italic") chain.toggleItalic().run();
          }}
            style={{ width: 24, height: 24, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 10, fontWeight: 600,
              background: editor?.isActive(action === "underline" ? "underline" : label.toLowerCase()) ? "#dbeafe" : "transparent",
              color: editor?.isActive(action === "underline" ? "underline" : label.toLowerCase()) ? "#3B82F6" : "#64748b" }}>{label}</button>
        ))}
        <input type="color" value={editor?.getAttributes("textStyle").color || "#000000"}
          onChange={e => editor?.chain().focus().setColor(e.target.value).run()}
          style={{ width: 20, height: 20, padding: 0, border: "none", cursor: "pointer", marginLeft: 4 }} />
      </div>
      <div style={{ padding: "6px 10px", minHeight: 60, fontSize: 13, lineHeight: 1.5 }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

// ── PDF Generation ────────────────────────────────────────────────────────
async function downloadPdf(elementId: string, filename: string) {
  const el = document.getElementById(elementId);
  if (!el) return;
  try {
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, logging: false });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF("p", "mm", "a4");
    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = (canvas.height * pdfW) / canvas.width;
    pdf.addImage(imgData, "PNG", 0, 0, pdfW, pdfH);
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

// ── Main Component ────────────────────────────────────────────────────────
export function PlaybooksPage({ userId }: { userId: string | null }) {
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
  const [createType, setCreateType] = useState<"document" | "template" | null>(null);
  const [createDocMode, setCreateDocMode] = useState<"editor" | "file" | null>(null);
  const [createContent, setCreateContent] = useState("");
  const [createFiles, setCreateFiles] = useState<PlaybookFile[]>([]);
  const [createLinks, setCreateLinks] = useState<PlaybookLink[]>([]);
  const [createTemplateFields, setCreateTemplateFields] = useState<TemplateField[]>([]);
  const [createUploading, setCreateUploading] = useState(false);

  // Template fill state
  const [fillTemplateId, setFillTemplateId] = useState<string | null>(null);
  const [fillTemplateRowId, setFillTemplateRowId] = useState<string | null>(null);
  const [fillData, setFillData] = useState<Record<string, string>>({});

  // Detail / edit modals
  const [detailItem, setDetailItem] = useState<PlaybookItem | null>(null);
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

  // ── Init ─────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      if (!userId) { setLoading(false); return; }
      const saved = await loadUserData("playbooks", userId);
      if (saved && Array.isArray(saved) && saved.length > 0) {
        setRows(saved);
      } else {
        setRows([{ id: "default", title: "Playbooks", items: [] }]);
      }
      setLoading(false);
    })();
  }, [userId]);

  useEffect(() => {
    if (!userId || loading) return;
    const timer = setTimeout(() => saveUserData("playbooks", userId, rows), 500);
    return () => clearTimeout(timer);
  }, [rows, userId, loading]);

  // ── Row management ────────────────────────────────────────────────────
  const addRow = (name: string) => {
    setRows(p => [...p, { id: crypto.randomUUID(), title: name, items: [] }]);
  };
  const renameRow = (rid: string, name: string) => {
    setRows(p => p.map(r => r.id === rid ? { ...r, title: name } : r));
  };
  const removeRow = (rid: string) => {
    setRows(p => p.filter(r => r.id !== rid));
  };

  // ── Item management ───────────────────────────────────────────────────
  const addItem = (rid: string, item: PlaybookItem) => {
    setRows(p => p.map(r => r.id === rid ? { ...r, items: [...r.items, item] } : r));
  };
  const removeItem = (rid: string, iid: string) => {
    setRows(p => p.map(r => r.id === rid ? { ...r, items: r.items.filter(i => i.id !== iid) } : r));
  };
  const updateItem = (rid: string, iid: string, updates: Partial<PlaybookItem>) => {
    setRows(p => p.map(r => r.id === rid ? { ...r, items: r.items.map(i => i.id === iid ? { ...i, ...updates } : i) } : r));
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
    setRows(prev => {
      const srcRow = prev.find(r => r.id === src.rowId);
      if (!srcRow) return prev;
      const moving = srcRow.items.find(i => i.id === src.itemId);
      if (!moving) return prev;
      const without = prev.map(r => r.id === src.rowId ? { ...r, items: r.items.filter(i => i.id !== src.itemId) } : r);
      return without.map(r => {
        if (r.id !== targetRid) return r;
        if (targetIid === "__end__") return { ...r, items: [...r.items, moving] };
        const idx = r.items.findIndex(i => i.id === targetIid);
        if (idx === -1) return { ...r, items: [...r.items, moving] };
        const items = [...r.items];
        items.splice(idx, 0, moving);
        return { ...r, items };
      });
    });
    dragItemRef.current = null; setDragItemState(null); setDragOverItem(null);
  }, []);

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
    setRows(prev => {
      const arr = [...prev];
      const fi = arr.findIndex(r => r.id === from);
      const ti = arr.findIndex(r => r.id === targetRid);
      if (fi === -1 || ti === -1) return prev;
      const [moved] = arr.splice(fi, 1);
      arr.splice(ti, 0, moved);
      return arr;
    });
    dragRowRef.current = null; setDragOverRow(null);
  }, []);
  const handleDragEnd = useCallback(() => {
    dragItemRef.current = null; dragRowRef.current = null;
    setDragItemState(null); setDragOverItem(null); setDragOverRow(null);
  }, []);

  // ── Creation helpers ──────────────────────────────────────────────────
  const resetCreate = () => {
    setCreateStep(0); setCreateName(""); setCreateType(null); setCreateDocMode(null);
    setCreateContent(""); setCreateFiles([]); setCreateLinks([]); setCreateTemplateFields([]);
    setShowCreate(false); setCreateRowId(null);
  };
  const handleCreateSave = async () => {
    if (!createName.trim() || !createRowId || !createType) return;
    const newItem: PlaybookItem = {
      id: crypto.randomUUID(), label: createName.trim(),
      icon: ICON_NONE, type: createType,
      createdAt: new Date().toISOString(),
      content: createContent || undefined,
      files: createFiles.length > 0 ? createFiles : undefined,
      links: createLinks.length > 0 ? createLinks : undefined,
      templateFields: createType === "template" && createTemplateFields.length > 0 ? createTemplateFields : undefined,
    };
    newItem.icon = autoSelectIcon(newItem);
    addItem(createRowId, newItem);
    if (createType === "template") {
      const hasTemplate = rows.some(r => r.title === "Templates");
      if (!hasTemplate) addRow("Templates");
    }
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
    setFillTemplateId(item.id); setFillTemplateRowId(rid);
    const fd: Record<string, string> = {};
    item.templateFields?.forEach(f => { fd[f.id] = ""; });
    setFillData(fd); setSubView("template-fill");
  };
  const handleFillSave = () => {
    if (!fillTemplateId || !fillTemplateRowId) return;
    const templateItem = rows.flatMap(r => r.items).find(i => i.id === fillTemplateId);
    if (!templateItem) return;
    const newItem: PlaybookItem = {
      id: crypto.randomUUID(), label: templateItem.label,
      icon: "Notebook", type: "filled-template",
      createdAt: new Date().toISOString(),
      templateId: fillTemplateId,
      filledData: fillData,
    };
    newItem.icon = autoSelectIcon(newItem);
    addItem(fillTemplateRowId, newItem);
    setSubView("list"); setFillTemplateId(null); setFillTemplateRowId(null); setFillData({});
  };

  // ── Detail / Edit ─────────────────────────────────────────────────────
  const openDetail = (item: PlaybookItem) => setDetailItem(item);
  const openEditSettings = (item: PlaybookItem) => {
    setEditSettingsItem(item);
    setEditSettingsName(item.label);
    setEditSettingsIcon(item.icon);
  };
  const saveEditSettings = () => {
    if (!editSettingsItem) return;
    const rid = rows.find(r => r.items.some(i => i.id === editSettingsItem.id))?.id;
    if (rid) updateItem(rid, editSettingsItem.id, { label: editSettingsName, icon: editSettingsIcon });
    setEditSettingsItem(null);
  };

  // ── Render helpers ────────────────────────────────────────────────────

  if (loading) return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", color: "#94a3b8", fontSize: 14 }}>
      Loading playbooks...
    </div>
  );

  // ── SUBVIEW: Template Builder ─────────────────────────────────────────
  if (subView === "template-builder") {
    const addField = (type: TemplateFieldType) => {
      setCreateTemplateFields(p => [...p, {
        id: crypto.randomUUID(), type, header: "", placeholder: "",
        required: false, options: type === "checkbox" || type === "radio" ? ["Option 1"] : undefined,
        color: "#1a2332",
      }]);
    };
    const updateField = (id: string, updates: Partial<TemplateField>) => {
      setCreateTemplateFields(p => p.map(f => f.id === id ? { ...f, ...updates } : f));
    };
    const removeField = (id: string) => setCreateTemplateFields(p => p.filter(f => f.id !== id));
    const moveField = (idx: number, dir: -1 | 1) => {
      const nidx = idx + dir;
      if (nidx < 0 || nidx >= createTemplateFields.length) return;
      setCreateTemplateFields(p => {
        const arr = [...p];
        const [moved] = arr.splice(idx, 1);
        arr.splice(nidx, 0, moved);
        return arr;
      });
    };

    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px clamp(16px,3vw,24px)", borderBottom: "1px solid #e2e8f0", background: "#fff", flexShrink: 0 }}>
          <button onClick={() => { setSubView("list"); resetCreate(); }}
            style={{ padding: "6px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 12, cursor: "pointer", color: "#64748b" }}>← Back</button>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1a2332", flex: 1 }}>Create Playbook Template</h2>
        </div>
        <div style={{ flex: 1, display: "flex", overflow: "hidden", flexDirection: window.innerWidth < 768 ? "column" : "row" }}>
          {/* LEFT: Editor */}
          <div style={{ flex: 1, overflowY: "auto", padding: "clamp(12px,2vw,20px)" }}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#64748b", marginBottom: 6 }}>TEMPLATE NAME</div>
              <input value={createName} onChange={e => setCreateName(e.target.value)} placeholder="e.g. Impact Filter"
                style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
            </div>

            {createTemplateFields.map((f, idx) => (
              <div key={f.id} style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", padding: 14, marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", flex: 1 }}>{f.type} field</span>
                  <button onClick={() => moveField(idx, -1)} disabled={idx === 0}
                    style={{ width: 22, height: 22, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 10, background: "#f1f5f9", color: idx === 0 ? "#e2e8f0" : "#64748b" }}>↑</button>
                  <button onClick={() => moveField(idx, 1)} disabled={idx === createTemplateFields.length - 1}
                    style={{ width: 22, height: 22, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 10, background: "#f1f5f9", color: idx === createTemplateFields.length - 1 ? "#e2e8f0" : "#64748b" }}>↓</button>
                  <button onClick={() => removeField(f.id)}
                    style={{ width: 22, height: 22, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 12, background: "#fee2e2", color: "#E85D75" }}>✕</button>
                </div>
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 2 }}>Header</div>
                  <RichEditorSmall content={f.header} onChange={html => updateField(f.id, { header: html })} />
                </div>
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 2 }}>Placeholder</div>
                  <RichEditorSmall content={f.placeholder} onChange={html => updateField(f.id, { placeholder: html })} />
                </div>
                {(f.type === "checkbox" || f.type === "radio") && (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>Options</div>
                    {(f.options || []).map((opt, oi) => (
                      <div key={oi} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                        <input value={opt} onChange={e => {
                          const opts = [...(f.options || [])];
                          opts[oi] = e.target.value;
                          updateField(f.id, { options: opts });
                        }} style={{ flex: 1, padding: "4px 8px", borderRadius: 4, border: "1px solid #e2e8f0", fontSize: 12, outline: "none" }} />
                        <button onClick={() => {
                          const opts = (f.options || []).filter((_, j) => j !== oi);
                          updateField(f.id, { options: opts.length > 0 ? opts : undefined });
                        }} style={{ width: 20, height: 20, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 10, background: "#fee2e2", color: "#E85D75" }}>✕</button>
                      </div>
                    ))}
                    <button onClick={() => updateField(f.id, { options: [...(f.options || []), `Option ${(f.options || []).length + 1}`] })}
                      style={{ padding: "3px 10px", borderRadius: 4, border: "1px dashed #d1d5db", background: "transparent", fontSize: 11, cursor: "pointer", color: "#94a3b8" }}>+ Add Option</button>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#64748b", cursor: "pointer" }}>
                    <input type="checkbox" checked={f.required} onChange={e => updateField(f.id, { required: e.target.checked })}
                      style={{ accentColor: "#3B82F6", margin: 0 }} /> Required
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>Color:</span>
                    <input type="color" value={f.color} onChange={e => updateField(f.id, { color: e.target.value })}
                      style={{ width: 22, height: 22, padding: 0, border: "none", cursor: "pointer" }} />
                  </div>
                </div>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              {(["text","textarea","checkbox","radio"] as TemplateFieldType[]).map(t => (
                <button key={t} onClick={() => addField(t)}
                  style={{ padding: "6px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 11, cursor: "pointer", color: "#64748b", textTransform: "capitalize" }}>
                  + {t === "textarea" ? "Text Area" : t === "checkbox" ? "Checkbox" : t === "radio" ? "Radio" : "Text"}
                </button>
              ))}
            </div>
            <button onClick={handleCreateSave} disabled={!createName.trim()}
              style={{ padding: "10px 28px", borderRadius: 8, border: "none",
                background: createName.trim() ? "linear-gradient(135deg,#3B82F6,#06B6D4)" : "#e2e8f0",
                color: "#fff", fontSize: 13, fontWeight: 600, cursor: createName.trim() ? "pointer" : "default" }}>
              Save Template
            </button>
          </div>

          {/* RIGHT: Preview */}
          <div style={{ flex: 1, overflowY: "auto", padding: "clamp(12px,2vw,20px)", background: "#F8FAFC", borderLeft: window.innerWidth >= 768 ? "1px solid #e2e8f0" : "none", borderTop: window.innerWidth < 768 ? "1px solid #e2e8f0" : "none" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#64748b", marginBottom: 12 }}>PREVIEW</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1a2332", marginBottom: 16 }}>{createName || "Template Name"}</div>
            {createTemplateFields.length === 0 ? (
              <div style={{ fontSize: 13, color: "#cbd5e1", fontStyle: "italic" }}>Add fields to see preview</div>
            ) : createTemplateFields.map((f, idx) => (
              <div key={f.id} style={{
                background: "#f1f5f9", borderRadius: 10, padding: 14, marginBottom: 10,
              }}>
                {f.header && <div style={{ fontSize: 13, fontWeight: 600, color: f.color, marginBottom: 4 }} dangerouslySetInnerHTML={{ __html: f.header }} />}
                {f.type === "text" && (
                  <div style={{ padding: "8px 12px", borderRadius: 6, background: "#fff", fontSize: 13, color: "#94a3b8" }}
                    dangerouslySetInnerHTML={{ __html: f.placeholder || "Text input..." }} />
                )}
                {f.type === "textarea" && (
                  <div style={{ padding: "8px 12px", borderRadius: 6, background: "#fff", fontSize: 13, color: "#94a3b8", minHeight: 60 }}
                    dangerouslySetInnerHTML={{ __html: f.placeholder || "Long text..." }} />
                )}
                {f.type === "checkbox" && (f.options || []).map((opt, oi) => (
                  <div key={oi} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, fontSize: 13, color: "#94a3b8" }}>
                    <div style={{ width: 16, height: 16, borderRadius: 3, border: "1.5px solid #d1d5db", background: "#fff" }} />
                    {opt}
                  </div>
                ))}
                {f.type === "radio" && (f.options || []).map((opt, oi) => (
                  <div key={oi} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, fontSize: 13, color: "#94a3b8" }}>
                    <div style={{ width: 16, height: 16, borderRadius: "50%", border: "1.5px solid #d1d5db", background: "#fff" }} />
                    {opt}
                  </div>
                ))}
              </div>
            ))}
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
            style={{ padding: "6px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 12, cursor: "pointer", color: "#64748b" }}>← Back</button>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1a2332", flex: 1 }}>{tItem.label}</h2>
        </div>
        <div style={{ flex: 1, display: "flex", overflow: "hidden", flexDirection: window.innerWidth < 768 ? "column" : "row" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "clamp(12px,2vw,20px)" }}>
            {tItem.templateFields.map(f => (
              <div key={f.id} style={{ marginBottom: 16 }}>
                {f.header && <div style={{ fontSize: 13, fontWeight: 600, color: f.color, marginBottom: 4 }} dangerouslySetInnerHTML={{ __html: f.header }} />}
                {f.type === "text" && (
                  <input value={fillData[f.id] || ""} onChange={e => setFillData(p => ({ ...p, [f.id]: e.target.value }))}
                    placeholder="" style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 14, outline: "none", boxSizing: "border-box" }}
                    dangerouslySetInnerHTML={{ __html: "" }} />
                )}
                {/* the actual input */}
                {f.type === "text" && (
                  <input value={fillData[f.id] || ""} onChange={e => setFillData(p => ({ ...p, [f.id]: e.target.value }))}
                    placeholder={f.placeholder.replace(/<[^>]*>/g, "")}
                    style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                )}
                {f.type === "textarea" && (
                  <textarea value={fillData[f.id] || ""} onChange={e => setFillData(p => ({ ...p, [f.id]: e.target.value }))}
                    placeholder={f.placeholder.replace(/<[^>]*>/g, "")}
                    style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 14, outline: "none", boxSizing: "border-box", minHeight: 100, resize: "vertical", fontFamily: "inherit" }} />
                )}
                {(f.type === "checkbox") && (f.options || []).map((opt, oi) => (
                  <label key={oi} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, fontSize: 13, color: "#1a2332", cursor: "pointer" }}>
                    <input type="checkbox" checked={(fillData[f.id] || "").includes(opt)}
                      onChange={e => {
                        const current = new Set((fillData[f.id] || "").split(",").filter(Boolean));
                        if (e.target.checked) current.add(opt); else current.delete(opt);
                        setFillData(p => ({ ...p, [f.id]: Array.from(current).join(",") }));
                      }} style={{ accentColor: "#3B82F6" }} />
                    {opt}
                  </label>
                ))}
                {(f.type === "radio") && (f.options || []).map((opt, oi) => (
                  <label key={oi} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, fontSize: 13, color: "#1a2332", cursor: "pointer" }}>
                    <input type="radio" name={`field-${f.id}`} checked={fillData[f.id] === opt}
                      onChange={() => setFillData(p => ({ ...p, [f.id]: opt }))} style={{ accentColor: "#3B82F6" }} />
                    {opt}
                  </label>
                ))}
              </div>
            ))}
            <button onClick={handleFillSave}
              style={{ padding: "10px 28px", borderRadius: 8, border: "none",
                background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Save Playbook
            </button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "clamp(12px,2vw,20px)", background: "#F8FAFC", borderLeft: window.innerWidth >= 768 ? "1px solid #e2e8f0" : "none", borderTop: window.innerWidth < 768 ? "1px solid #e2e8f0" : "none" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#64748b", marginBottom: 12 }}>PREVIEW</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1a2332", marginBottom: 16 }}>{tItem.label}</div>
            {tItem.templateFields.map(f => (
              <div key={f.id} style={{ background: "#f1f5f9", borderRadius: 10, padding: 14, marginBottom: 10 }}>
                {f.header && <div style={{ fontSize: 13, fontWeight: 600, color: f.color, marginBottom: 4 }} dangerouslySetInnerHTML={{ __html: f.header }} />}
                <div style={{ fontSize: 13, color: "#1a2332" }}>{fillData[f.id] || (f.placeholder ? <span style={{ color: "#94a3b8" }} dangerouslySetInnerHTML={{ __html: f.placeholder }} /> : <span style={{ color: "#cbd5e1", fontStyle: "italic" }}>Empty</span>)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── MAIN LIST VIEW ────────────────────────────────────────────────────
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
              <h2 style={{ margin: 0, fontSize: "clamp(16px,3vw,20px)", fontWeight: 700, color: "#1a2332" }}>{row.title}</h2>
              <div style={{ position: "relative" }}>
                <div onClick={() => { setRowModalInitial(row.title); setRowModalCallback(() => (name: string) => { renameRow(row.id, name); }); setShowRowModal(true); }}
                  style={{ width: 26, height: 26, borderRadius: "50%", background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 13, color: "#94a3b8" }}>···</div>
              </div>
              <div style={{ flex: 1 }} />
            </div>

            {/* Items grid */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}
              onDragOver={e => { e.preventDefault(); if (dragItemState) handleItemDragEnter(row.id, "__end__"); }}
              onDrop={() => handleItemDrop(row.id, "__end__")}>
              {row.items.map(item => {
                const isSingleLink = !item.content && (!item.files || item.files.length === 0) && item.links?.length === 1;
                const isSingleFile = !item.content && item.files?.length === 1 && (!item.links || item.links.length === 0);
                const isMulti = !item.content && ((item.links && item.links.length > 1) || (item.files && item.files.length > 1));
                const showAction = isSingleLink || isSingleFile;
                const actionLabel = isSingleFile ? `View ${item.files![0].name.split(".").pop()?.toUpperCase() || "FILE"}` : "View Link";
                const isDragTarget = dragOverItem?.rowId === row.id && dragOverItem?.itemId === item.id;
                return (
                  <Fragment key={item.id}>
                    {isDragTarget && <div style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />}
                    <div draggable onDragStart={() => handleItemDragStart(row.id, item.id)}
                      onDragEnter={() => handleItemDragEnter(row.id, item.id)}
                      onDrop={() => handleItemDrop(row.id, item.id)}
                      style={{ width: 200, background: "#f8fafc", borderRadius: 12, border: "1px solid #f1f5f9", overflow: "hidden", cursor: "grab" }}>
                      {/* Icon + Title */}
                      <div onClick={() => openDetail(item)} style={{ padding: 14, cursor: "pointer" }}>
                        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
                          <IconGlyph name={item.icon || "Notebook"} size={18} color="#3B82F6" />
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332", marginBottom: 2 }}>{item.label}</div>
                        {item.type === "template" ? (
                          <div onClick={e => { e.stopPropagation(); startFill(item, row.id); }}
                            style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, background: "#EFF6FF", color: "#3B82F6", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                            + Add New
                          </div>
                        ) : item.type === "filled-template" ? (
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, background: "#F0FDF4", color: "#4CAF7D", fontSize: 11, fontWeight: 500 }}>
                            <IconGlyph name="Check" size={12} color="#4CAF7D" weight="bold" /> View Playbook
                          </div>
                        ) : showAction ? (
                          <a href={isSingleLink ? item.links![0].url : `#file-${item.files![0].id}`}
                            target={isSingleLink ? "_blank" : undefined}
                            rel="noopener noreferrer"
                            onClick={e => { if (!isSingleLink) e.preventDefault(); }}
                            style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, background: "#EFF6FF", color: "#3B82F6", fontSize: 11, fontWeight: 500, textDecoration: "none" }}>
                            {actionLabel} <IconGlyph name="ArrowUpRight" size={12} color="#3B82F6" weight="bold" />
                          </a>
                        ) : isMulti ? (
                          <div style={{ fontSize: 11, color: "#94a3b8" }}>
                            {item.links && item.links.length > 0 ? `${item.links.length} link${item.links.length > 1 ? "s" : ""}` : ""}
                            {item.links && item.links.length > 0 && item.files && item.files.length > 0 ? " · " : ""}
                            {item.files && item.files.length > 0 ? `${item.files.length} file${item.files.length > 1 ? "s" : ""}` : ""}
                          </div>
                        ) : item.content ? (
                          <div style={{ fontSize: 11, color: "#94a3b8" }}>View Document</div>
                        ) : null}
                      </div>
                    </div>
                  </Fragment>
                );
              })}
              {dragOverItem?.rowId === row.id && dragOverItem?.itemId === "__end__" && row.items.length === 0 && (
                <div style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />
              )}
              {/* Add button */}
              <div onClick={() => { setCreateRowId(row.id); setShowCreate(true); }}
                style={{ width: 44, height: 44, borderRadius: "50%", border: "1.5px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#94a3b8", fontSize: 20, alignSelf: "center" }}>+</div>
            </div>
          </div>
        ))}

        {/* New Row */}
        <div onClick={() => { setRowModalInitial(""); setRowModalCallback(() => (name: string) => addRow(name)); setShowRowModal(true); }}
          style={{ display: "flex", alignItems: "center", gap: 8, color: "#94a3b8", fontSize: 13, cursor: "pointer", padding: "6px 0" }}>
          <div style={{ width: 26, height: 26, borderRadius: "50%", border: "1.5px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, color: "#94a3b8" }}>+</div>
          New Row
        </div>
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
                    color: "#fff", fontSize: 11, fontWeight: 700, transition: "all 0.2s" }}>
                    {createStep > i ? <IconGlyph name="Check" size={14} color="#fff" weight="bold" /> : i + 1}
                  </div>
                  {i < 2 && <div style={{ width: 32, height: 2, background: createStep > i ? "#4CAF7D" : "#e2e8f0", transition: "background 0.3s" }} />}
                </div>
              ))}
            </div>

            {createStep === 0 && (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#1a2332", marginBottom: 4 }}>Create Playbook</div>
                <div style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>Name your playbook and choose a type</div>
                <input autoFocus value={createName} onChange={e => setCreateName(e.target.value)} placeholder="Playbook name..."
                  style={{ width: "100%", padding: "12px 16px", borderRadius: 10, border: "1.5px solid #e2e8f0", fontSize: 14, outline: "none", marginBottom: 16, boxSizing: "border-box" }} />
                <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 20 }}>
                  {(["document","template"] as const).map(t => (
                    <div key={t} onClick={() => setCreateType(t)} style={{ flex: 1, maxWidth: 220, padding: "20px 16px", borderRadius: 12,
                      border: `2px solid ${createType === t ? "#3B82F6" : "#e2e8f0"}`,
                      background: createType === t ? "#EFF6FF" : "#fff", cursor: "pointer", textAlign: "center", transition: "all 0.15s" }}>
                      <div style={{ fontSize: 28, marginBottom: 8, display: "flex", justifyContent: "center" }}>
                        <IconGlyph name={t === "document" ? "Notebook" : "GitFork"} size={32} color={createType === t ? "#3B82F6" : "#64748b"} />
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#1a2332", marginBottom: 4 }}>
                        {t === "document" ? "Playbook" : "Playbook Template"}
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b" }}>
                        {t === "document"
                          ? "Standard operating procedures, guidelines, and scripts for your business"
                          : "Reusable templates for your team to copy and create new playbooks"}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                  <button onClick={resetCreate} style={{ padding: "10px 24px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 13, cursor: "pointer", color: "#64748b" }}>Cancel</button>
                  <button onClick={() => {
                    if (createType === "template") { setSubView("template-builder"); setShowCreate(false); }
                    else setCreateStep(1);
                  }} disabled={!createName.trim() || !createType}
                    style={{ padding: "10px 24px", borderRadius: 8, border: "none",
                      background: createName.trim() && createType ? "linear-gradient(135deg,#3B82F6,#06B6D4)" : "#e2e8f0",
                      color: "#fff", fontSize: 13, fontWeight: 600, cursor: createName.trim() && createType ? "pointer" : "default" }}>
                    {createType === "template" ? "Build Template →" : "Next →"}
                  </button>
                </div>
              </div>
            )}

            {createStep === 1 && createType === "document" && (
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#1a2332", marginBottom: 4, textAlign: "center" }}>Choose Mode</div>
                <div style={{ fontSize: 13, color: "#64748b", marginBottom: 20, textAlign: "center" }}>How would you like to create this playbook?</div>
                <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 20 }}>
                  {(["editor","file"] as const).map(m => (
                    <div key={m} onClick={() => setCreateDocMode(m)} style={{ flex: 1, maxWidth: 220, padding: "20px 16px", borderRadius: 12,
                      border: `2px solid ${createDocMode === m ? "#3B82F6" : "#e2e8f0"}`,
                      background: createDocMode === m ? "#EFF6FF" : "#fff", cursor: "pointer", textAlign: "center" }}>
                      <div style={{ fontSize: 28, marginBottom: 8, display: "flex", justifyContent: "center" }}>
                        <IconGlyph name={m === "editor" ? "FileText" : "Paperclip"} size={32} color={createDocMode === m ? "#3B82F6" : "#64748b"} />
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#1a2332", marginBottom: 4 }}>
                        {m === "editor" ? "Document Mode" : "Link / File Mode"}
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b" }}>
                        {m === "editor"
                          ? "Create rich text with formatting, images, and tables"
                          : "Upload a PDF, document, or add links to resources"}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                  <button onClick={() => setCreateStep(0)} style={{ padding: "10px 24px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 13, cursor: "pointer", color: "#64748b" }}>← Back</button>
                  <button onClick={() => setCreateStep(2)} disabled={!createDocMode}
                    style={{ padding: "10px 24px", borderRadius: 8, border: "none",
                      background: createDocMode ? "linear-gradient(135deg,#3B82F6,#06B6D4)" : "#e2e8f0",
                      color: "#fff", fontSize: 13, fontWeight: 600, cursor: createDocMode ? "pointer" : "default" }}>Next →</button>
                </div>
              </div>
            )}

            {createStep === 2 && createType === "document" && createDocMode === "editor" && (
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2332", marginBottom: 16 }}>{createName}</div>
                <RichEditor content={createContent} onChange={setCreateContent} placeholder="Start writing..." />
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 8 }}>ATTACHMENTS</div>
                  {/* Files */}
                  {createFiles.map(f => (
                    <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 6, background: "#f8fafc", marginBottom: 4, fontSize: 12, color: "#64748b" }}>
                      <IconGlyph name="FileDoc" size={16} color="#64748b" />
                      <span style={{ flex: 1 }}>{f.name}</span>
                      <span style={{ color: "#94a3b8" }}>{(f.size / 1024).toFixed(0)}KB</span>
                      <button onClick={() => setCreateFiles(p => p.filter(x => x.id !== f.id))} style={{ width: 20, height: 20, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 10, background: "#fee2e2", color: "#E85D75" }}>✕</button>
                    </div>
                  ))}
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 6, border: "1px dashed #d1d5db", cursor: "pointer", fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>
                    {createUploading ? "Uploading..." : "Upload File"}
                    <input type="file" onChange={handleCreateFileUpload} style={{ display: "none" }} accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.webp,.gif" />
                  </label>
                  {/* Links */}
                  {createLinks.map(l => (
                    <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <input value={l.title} onChange={e => updateCreateLink(l.id, { title: e.target.value })} placeholder="Link title"
                        style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none" }} />
                      <input value={l.url} onChange={e => updateCreateLink(l.id, { url: e.target.value })} placeholder="URL"
                        style={{ flex: 2, padding: "6px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none" }} />
                      <button onClick={() => removeCreateLink(l.id)} style={{ width: 22, height: 22, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 10, background: "#fee2e2", color: "#E85D75" }}>✕</button>
                    </div>
                  ))}
                  <button onClick={handleCreateAddLink} style={{ display: "block", padding: "6px 14px", borderRadius: 6, border: "1px dashed #d1d5db", background: "transparent", fontSize: 12, cursor: "pointer", color: "#94a3b8", marginTop: 4 }}>+ Add Link</button>
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
                  <button onClick={() => setCreateStep(1)} style={{ padding: "10px 24px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 13, cursor: "pointer", color: "#64748b" }}>← Back</button>
                  <button onClick={handleCreateSave} style={{ padding: "10px 28px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Save</button>
                </div>
              </div>
            )}

            {createStep === 2 && createType === "document" && createDocMode === "file" && (
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2332", marginBottom: 16 }}>{createName}</div>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 8 }}>FILES</div>
                  {createFiles.map(f => (
                    <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 6, background: "#f8fafc", marginBottom: 4, fontSize: 12, color: "#64748b" }}>
                      <IconGlyph name="FileDoc" size={16} color="#64748b" />
                      <span style={{ flex: 1 }}>{f.name}</span>
                      <span style={{ color: "#94a3b8" }}>{(f.size / 1024).toFixed(0)}KB</span>
                      <button onClick={() => setCreateFiles(p => p.filter(x => x.id !== f.id))} style={{ width: 20, height: 20, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 10, background: "#fee2e2", color: "#E85D75" }}>✕</button>
                    </div>
                  ))}
                  <label style={{ display: "block", padding: "20px", borderRadius: 8, border: "2px dashed #e2e8f0", cursor: "pointer", textAlign: "center", fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>
                    {createUploading ? "Uploading..." : "Click to upload or drag and drop (max 25MB)"}
                    <input type="file" onChange={handleCreateFileUpload} style={{ display: "none" }} accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.webp,.gif" />
                  </label>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 8 }}>LINKS</div>
                  {createLinks.map(l => (
                    <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <input value={l.title} onChange={e => updateCreateLink(l.id, { title: e.target.value })} placeholder="Link title"
                        style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none" }} />
                      <input value={l.url} onChange={e => updateCreateLink(l.id, { url: e.target.value })} placeholder="URL"
                        style={{ flex: 2, padding: "6px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 12, outline: "none" }} />
                      <button onClick={() => removeCreateLink(l.id)} style={{ width: 22, height: 22, borderRadius: 4, border: "none", cursor: "pointer", fontSize: 10, background: "#fee2e2", color: "#E85D75" }}>✕</button>
                    </div>
                  ))}
                  <button onClick={handleCreateAddLink} style={{ padding: "6px 14px", borderRadius: 6, border: "1px dashed #d1d5db", background: "transparent", fontSize: 12, cursor: "pointer", color: "#94a3b8" }}>+ Add Link</button>
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
                  <button onClick={() => setCreateStep(1)} style={{ padding: "10px 24px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 13, cursor: "pointer", color: "#64748b" }}>← Back</button>
                  <button onClick={handleCreateSave} style={{ padding: "10px 28px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Save</button>
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
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#fff", border: "1.5px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <IconGlyph name={detailItem.icon || "Notebook"} size={20} color="#3B82F6" />
              </div>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1a2332" }}>{detailItem.label}</h2>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                  {detailItem.type === "document" ? "Document" : detailItem.type === "template" ? "Template" : "Filled Playbook"}
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
              <div id="playbook-content" style={{ fontSize: 14, lineHeight: 1.7, color: "#1a2332", padding: 16, border: "1px solid #e2e8f0", borderRadius: 10, marginBottom: 16 }}
                dangerouslySetInnerHTML={{ __html: detailItem.content }} />
            )}

            {detailItem.files && detailItem.files.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 8 }}>FILES</div>
                {detailItem.files.map(f => (
                  <a key={f.id} href={getFileUrl(f.storagePath)} target="_blank" rel="noopener noreferrer"
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 6, background: "#f8fafc", marginBottom: 4, textDecoration: "none", fontSize: 13, color: "#1a2332" }}>
                    <IconGlyph name="FileDoc" size={18} color="#64748b" />
                    <span style={{ flex: 1 }}>{f.name}</span>
                    <IconGlyph name="ArrowUpRight" size={14} color="#3B82F6" weight="bold" />
                  </a>
                ))}
              </div>
            )}

            {detailItem.links && detailItem.links.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 8 }}>LINKS</div>
                {detailItem.links.map(l => (
                  <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer"
                    style={{ display: "block", padding: "8px 12px", borderRadius: 6, background: "#f8fafc", marginBottom: 4, textDecoration: "none", fontSize: 13 }}>
                    <div style={{ fontWeight: 600, color: "#1a2332", marginBottom: 2 }}>{l.title || l.url}</div>
                    <div style={{ color: "#3B82F6", fontSize: 12, wordBreak: "break-all" }}>{l.url}</div>
                  </a>
                ))}
              </div>
            )}

            {detailItem.type === "filled-template" && detailItem.filledData && detailItem.templateId && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 8 }}>CONTENT</div>
                {(() => {
                  const template = rows.flatMap(r => r.items).find(i => i.id === detailItem.templateId);
                  return template?.templateFields?.map(f => (
                    <div key={f.id} style={{ background: "#f1f5f9", borderRadius: 8, padding: 12, marginBottom: 8 }}>
                      {f.header && <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: f.color }} dangerouslySetInnerHTML={{ __html: f.header }} />}
                      <div style={{ fontSize: 13, color: "#1a2332" }}>{detailItem.filledData?.[f.id] || <span style={{ color: "#cbd5e1", fontStyle: "italic" }}>Empty</span>}</div>
                    </div>
                  ));
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Edit Settings Modal ───────────────────────────────────────── */}
      {editSettingsItem && (
        <div onClick={() => setEditSettingsItem(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2100, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 420, boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#1a2332", marginBottom: 16 }}>Edit Settings</h2>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>PLAYBOOK NAME</div>
              <input value={editSettingsName} onChange={e => setEditSettingsName(e.target.value)}
                style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>ICON</div>
              <IconPicker selected={editSettingsIcon} onSelect={setEditSettingsIcon} />
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setEditSettingsItem(null)} style={{ padding: "8px 18px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 12, cursor: "pointer", color: "#64748b" }}>Cancel</button>
              <button onClick={saveEditSettings} style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Inline Row Edit Modal ────────────────────────────────────────────────
function EditAddRowModalCustom({ initial, onSave, onClose }: {
  initial: string; onSave: (name: string) => void; onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 380, boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#1a2332", marginBottom: 4 }}>
          {initial ? "Rename Row" : "New Row"}
        </h2>
        <div style={{ fontSize: 13, color: "#64748b", marginBottom: 16 }}>Give your row a name</div>
        <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Row name..."
          onKeyDown={e => { if (e.key === "Enter" && name.trim()) onSave(name.trim()); }}
          style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 14, outline: "none", marginBottom: 16, boxSizing: "border-box" }} />
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 12, cursor: "pointer", color: "#64748b" }}>Cancel</button>
          <button onClick={() => name.trim() && onSave(name.trim())} disabled={!name.trim()}
            style={{ padding: "8px 18px", borderRadius: 8, border: "none",
              background: name.trim() ? "linear-gradient(135deg,#3B82F6,#06B6D4)" : "#e2e8f0",
              color: "#fff", fontSize: 12, fontWeight: 600, cursor: name.trim() ? "pointer" : "default" }}>Save</button>
        </div>
      </div>
    </div>
  );
}
