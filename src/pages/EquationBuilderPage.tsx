import { useState, useRef, useEffect, Fragment, useCallback } from "react";
import { Section, Metric, MetricColor, MetricType, MetricModalData, EquationStep, EquationConfig, ColorRule, StatRow, DataPoint } from "../types";
import { resolveColor, formatValue } from "../utils/helpers";
import { evaluateEquation, formatEquationResult, buildEquationPreviewString, assignStepNumbers } from "../utils/equations";
import { IconGlyph, Av, Toggle, SectionCard, MetricBlock } from "../components/shared";
import { ICON_NONE } from "../utils/constants";
import { useTranslation } from "../i18n";

function EquationBuilderPage({ allMetrics, sections, initialEquation, targetMetricId, onSave, onSaveDraft, onCancel, onDirty, isMobile }: {
  allMetrics: Metric[];
  sections: Section[];
  initialEquation?: EquationConfig;
  targetMetricId?: string;
  onSave: (equation: EquationConfig) => void;
  onSaveDraft?: (equation: EquationConfig) => void;
  onCancel: () => void;
  onDirty?: () => void;
  isMobile?: boolean;
}) {
  const { t: __ } = useTranslation();
  const [steps, setSteps] = useState<EquationStep[]>(initialEquation?.steps ?? []);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);
  const [dropLineIndex, setDropLineIndex] = useState<number | null>(null);
  const dropLineIndexRef = useRef<number | null>(null);
  const dragStepIdxRef = useRef<number | null>(null);
  const dragCountRef = useRef<number>(1);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [addAtIndex, setAddAtIndex] = useState<number | null>(null);
  const [pendingOperator, setPendingOperator] = useState(false);
  const [forceSearch, setForceSearch] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [checkedOrder, setCheckedOrder] = useState<number[]>([]);
  const checkedSteps = new Set(checkedOrder);
  const [selectedGroupStartIdx, setSelectedGroupStartIdx] = useState<number | null>(null);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<EquationStep[][]>([]);
  const [redoStack, setRedoStack] = useState<EquationStep[][]>([]);
  const stepsChangedRef = useRef(false);

  useEffect(() => {
    if (stepsChangedRef.current && onDirty) onDirty();
    stepsChangedRef.current = true;
  }, [steps]);
  const stepsRef = useRef(steps);
  const ignoreHistory = useRef(false);

  useEffect(() => {
    if (ignoreHistory.current) {
      ignoreHistory.current = false;
      stepsRef.current = steps;
      return;
    }
    if (steps !== stepsRef.current) {
      setUndoStack(u => {
        if (u.length > 0 && JSON.stringify(u[0]) === JSON.stringify(stepsRef.current)) return u;
        return [stepsRef.current, ...u].slice(0, 50);
      });
      setRedoStack([]);
      stepsRef.current = steps;
    }
  }, [steps]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prev = undoStack[0];
    setRedoStack(r => [steps, ...r].slice(0, 50));
    setUndoStack(u => u.slice(1));
    ignoreHistory.current = true;
    setEditingStepIndex(null);
    setSteps(prev);
  }, [undoStack, steps]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[0];
    setUndoStack(u => [steps, ...u].slice(0, 50));
    setRedoStack(r => r.slice(1));
    ignoreHistory.current = true;
    setEditingStepIndex(null);
    setSteps(next);
  }, [redoStack, steps]);

  useEffect(() => {
    const hasUnsaved = JSON.stringify(steps) !== JSON.stringify(initialEquation?.steps ?? []);
    if (hasUnsaved) {
      const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
      window.addEventListener("beforeunload", handler);
      return () => window.removeEventListener("beforeunload", handler);
    }
  }, [steps, initialEquation]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        if (checkedOrder.length >= 2) {
          handleGroupSelected();
        } else if (editingStepIndex !== null) {
          handleAddParentheses();
        } else {
          handleAddParentheses();
        }
      }
      if (e.metaKey && e.shiftKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        if (checkedOrder.length >= 2) {
          handleFractionSelected();
        } else if (editingStepIndex !== null) {
          handleAddFraction();
        } else {
          handleAddFraction();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [checkedOrder, editingStepIndex, steps]);

  const toggleChecked = (idx: number) => {
    setCheckedOrder(prev => {
      if (prev.includes(idx)) return prev.filter(i => i !== idx);
      return [...prev, idx];
    });
  };

  const renderCheckbox = (idx: number, isEditing: boolean) => (
    (isEditing || checkedOrder.length > 0) ? (
      <div onClick={e => { e.stopPropagation(); toggleChecked(idx); }} style={{ position: "absolute", top: 4, left: 4, width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 10, borderRadius: 4, border: "1.5px solid #94a3b8", background: checkedOrder.includes(idx) ? "#3B82F6" : "#fff", color: "#fff", fontSize: 15, fontWeight: 700, lineHeight: 1 }}>
        {checkedOrder.includes(idx) ? "✓" : ""}
      </div>
    ) : null
  );

  const handleGroupSelected = () => {
    const validOrder = checkedOrder.filter(i => i >= 0 && i < steps.length);
    if (validOrder.length < 2) return;
    const checkedSet = new Set(validOrder);
    const firstPos = validOrder[0];
    setSteps(prev => {
      const next: EquationStep[] = [];
      for (let i = 0; i < firstPos; i++) {
        if (!checkedSet.has(i)) next.push(prev[i]);
      }
      next.push({ type: "operator", operator: "paren-start" });
      for (const idx of validOrder) {
        next.push(prev[idx]);
      }
      next.push({ type: "operator", operator: "paren-end" });
      for (let i = firstPos; i < prev.length; i++) {
        if (!checkedSet.has(i)) next.push(prev[i]);
      }
      return next;
    });
    setCheckedOrder([]);
  };

  const handleFractionSelected = () => {
    const validOrder = checkedOrder.filter(i => i >= 0 && i < steps.length);
    if (validOrder.length < 2) return;
    const checkedSet = new Set(validOrder);
    const firstPos = validOrder[0];
    setSteps(prev => {
      const next: EquationStep[] = [];
      for (let i = 0; i < firstPos; i++) {
        if (!checkedSet.has(i)) next.push(prev[i]);
      }
      next.push({ type: "operator", operator: "paren-start" });
      for (const idx of validOrder) {
        next.push(prev[idx]);
      }
      next.push({ type: "operator", operator: "paren-end" });
      next.push({ type: "operator", operator: "/" });
      next.push({ type: "operator", operator: "paren-start" });
      next.push({ type: "operator", operator: "paren-end" });
      for (let i = firstPos; i < prev.length; i++) {
        if (!checkedSet.has(i)) next.push(prev[i]);
      }
      return next;
    });
    setCheckedOrder([]);
  };

  const handleRemoveGroup = (startIdx: number) => {
    setSteps(prev => {
      const next = [...prev];
      if (next[startIdx]?.type === "operator" && next[startIdx]?.operator === "paren-start") {
        let depth = 1;
        let endIdx = startIdx + 1;
        while (endIdx < next.length && depth > 0) {
          if (next[endIdx].type === "operator" && next[endIdx].operator === "paren-start") depth++;
          else if (next[endIdx].type === "operator" && next[endIdx].operator === "paren-end") depth--;
          if (depth > 0) endIdx++;
        }
        next.splice(startIdx, endIdx - startIdx + 1);
      }
      let changed = true;
      while (changed) {
        changed = false;
        for (let i = 0; i < next.length - 1; i++) {
          if (next[i].type === "operator" && next[i].operator === "paren-start" &&
              next[i + 1].type === "operator" && next[i + 1].operator === "paren-end") {
            next.splice(i, 2);
            changed = true;
            break;
          }
        }
      }
      return next;
    });
    setSelectedGroupStartIdx(null);
    setEditingStepIndex(null);
  };

  const showMathPicker = forceSearch
    ? false
    : editingStepIndex !== null
      ? steps[editingStepIndex]?.type === "operator"
      : pendingOperator || (steps.length > 0 && (steps[steps.length - 1].type === "metric" || steps[steps.length - 1].type === "number"));

  const availableMetrics = allMetrics.filter(m => m.id !== targetMetricId);

  const filteredMetrics = searchQuery.trim()
    ? availableMetrics.filter(m => m.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : availableMetrics;

  const targetMetric = allMetrics.find(m => m.id === targetMetricId);

  const liveResult = steps.length > 0 ? evaluateEquation(steps, allMetrics) : null;
  const liveFormatted = liveResult !== null && targetMetric
    ? formatEquationResult(liveResult, steps, allMetrics)
    : null;

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const stepsWithParents: { steps: EquationStep[]; parens: number[][] } = { steps, parens: [] };

  const clampToInnermostGroup = (rawIndex: number, stepsArr: EquationStep[]): number => {
    let innermostStart = -1;
    let innermostEnd = -1;
    const stack: number[] = [];
    for (let i = 0; i < stepsArr.length; i++) {
      const s = stepsArr[i];
      if (s.type === "operator" && s.operator === "paren-start") {
        stack.push(i);
      } else if (s.type === "operator" && s.operator === "paren-end") {
        const openIdx = stack.pop();
        if (openIdx !== undefined) {
          if (rawIndex > openIdx && rawIndex <= i) {
            if (innermostStart === -1 || openIdx > innermostStart) {
              innermostStart = openIdx;
              innermostEnd = i;
            }
          }
        }
      }
    }
    if (innermostStart === -1) return rawIndex;
    return Math.max(innermostStart + 1, Math.min(rawIndex, innermostEnd));
  };

  const handleSelectMetric = (m: Metric) => {
    setPendingOperator(false);
    setForceSearch(false);
    const step: EquationStep = {
      type: "metric",
      metricId: m.id,
      metricLabel: m.label,
      metricIcon: m.icon,
      metricColor: m.color,
      metricValue: m.value,
      metricType: m.metricType,
      currencySymbol: m.currencySymbol,
    };
    if (editingStepIndex !== null) {
      setSteps(prev => {
        const next = [...prev];
        next[editingStepIndex] = step;
        return next;
      });
      setEditingStepIndex(null);
    } else {
      const rawInsert = addAtIndex ?? steps.length;
      const clampedInsert = clampToInnermostGroup(rawInsert, steps);
      setSteps(prev => {
        const next = [...prev];
        next.splice(clampedInsert, 0, step);
        return next;
      });
      setAddAtIndex(clampedInsert + 1);
    }
    setSearchQuery("");
  };

  const handleSelectOperator = (op: "+" | "-" | "*" | "/") => {
    setPendingOperator(false);
    setForceSearch(false);
    if (editingStepIndex !== null) {
      setSteps(prev => {
        const next = [...prev];
        if (next[editingStepIndex].type === "operator") {
          next[editingStepIndex] = { ...next[editingStepIndex], operator: op };
        }
        return next;
      });
      setEditingStepIndex(null);
      setTimeout(() => searchRef.current?.focus(), 100);
    } else {
      const rawInsert = addAtIndex ?? steps.length;
      const clampedInsert = clampToInnermostGroup(rawInsert, steps);
      setSteps(prev => {
        const next = [...prev];
        next.splice(clampedInsert, 0, { type: "operator", operator: op });
        return next;
      });
      setAddAtIndex(clampedInsert + 1);
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  };

  const handleAddParentheses = () => {
    setShowAddMenu(false);
    setForceSearch(false);
    setPendingOperator(false);
    if (editingStepIndex !== null) {
      setSteps(prev => {
        const next = [...prev];
        const existing = next[editingStepIndex];
        if (existing) {
          next.splice(editingStepIndex, 1, { type: "operator", operator: "paren-start" }, existing, { type: "operator", operator: "paren-end" });
        } else {
          next.splice(editingStepIndex, 0, { type: "operator", operator: "paren-start" }, { type: "operator", operator: "paren-end" });
        }
        return next;
      });
      setEditingStepIndex(null);
    } else {
      const rawInsert = addAtIndex ?? steps.length;
      setSteps(prev => {
        const insertAt = clampToInnermostGroup(rawInsert, prev);
        const next = [...prev];
        next.splice(insertAt, 0, { type: "operator", operator: "paren-start" }, { type: "operator", operator: "paren-end" });
        return next;
      });
      setAddAtIndex(null);
    }
    setSearchQuery("");
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const handleAddFraction = () => {
    setShowAddMenu(false);
    setForceSearch(false);
    setPendingOperator(false);
    const fractionSteps: EquationStep[] = [
      { type: "operator", operator: "paren-start" },
      { type: "operator", operator: "paren-end" },
      { type: "operator", operator: "/" },
      { type: "operator", operator: "paren-start" },
      { type: "operator", operator: "paren-end" },
    ];
    if (editingStepIndex !== null) {
      setSteps(prev => {
        const next = [...prev];
        next.splice(editingStepIndex, 1, ...fractionSteps);
        return next;
      });
      setEditingStepIndex(null);
      setAddAtIndex(editingStepIndex + 1);
    } else {
      const rawInsert = addAtIndex ?? steps.length;
      const clampedInsert = clampToInnermostGroup(rawInsert, steps);
      setSteps(prev => {
        const next = [...prev];
        next.splice(clampedInsert, 0, ...fractionSteps);
        return next;
      });
      setAddAtIndex(clampedInsert + 1);
    }
    setSearchQuery("");
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const handleAddNumberStep = () => {
    setShowAddMenu(false);
    setForceSearch(false);
    setPendingOperator(false);
    const rawInsert = addAtIndex ?? steps.length;
    const clampedInsert = clampToInnermostGroup(rawInsert, steps);
    setSteps(prev => {
      const next = [...prev];
      next.splice(clampedInsert, 0, { type: "number", numberValue: 0 });
      return next;
    });
    setEditingStepIndex(clampedInsert);
    setAddAtIndex(clampedInsert + 1);
    setSearchQuery("");
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const handleEditStep = (idx: number) => {
    setEditingStepIndex(idx);
    const step = steps[idx];
    if (step.type === "metric") {
      setSearchQuery(step.metricLabel ?? "");
    }
  };

  const handleRemoveStep = (idx: number) => {
    setSteps(prev => {
      const next = [...prev];
      next.splice(idx, 1);
      let changed = true;
      while (changed) {
        changed = false;
        for (let i = 0; i < next.length - 1; i++) {
          if (next[i].type === "operator" && next[i].operator === "paren-start" &&
              next[i + 1].type === "operator" && next[i + 1].operator === "paren-end") {
            next.splice(i, 2);
            changed = true;
            break;
          }
        }
      }
      return next;
    });
    setEditingStepIndex(null);
  };

  const handleStepDrop = (toStepIdx: number) => {
    const fromIdx = dragStepIdxRef.current;
    const count = dragCountRef.current;
    if (fromIdx === null) {
      dragStepIdxRef.current = null;
      dragCountRef.current = 1;
      setDropLineIndex(null);
      dropLineIndexRef.current = null;
      return;
    }
    if (toStepIdx >= fromIdx && toStepIdx < fromIdx + count) {
      dragStepIdxRef.current = null;
      dragCountRef.current = 1;
      setDropLineIndex(null);
      dropLineIndexRef.current = null;
      return;
    }
    setSteps(prev => {
      const next = [...prev];
      const items = next.splice(fromIdx, count);
      let adjustedTo = fromIdx < toStepIdx ? toStepIdx - count : toStepIdx;
      if (count === 1 && toStepIdx === fromIdx + 1) adjustedTo++;
      const clampedTo = clampToInnermostGroup(adjustedTo, next);
      next.splice(clampedTo, 0, ...items);
      return next;
    });
    dragStepIdxRef.current = null;
    dragCountRef.current = 1;
    setDropLineIndex(null);
    dropLineIndexRef.current = null;
  };

  const handleSave = () => {
    if (!equationValid) return;
    onSave({ steps });
  };

  const handleSaveDraft = () => {
    onSaveDraft?.({ steps });
  };

  const cardSize = Math.max(60, 140 - steps.length * 3);
  const circleScale = Math.max(0.6, Math.min(1, cardSize / 140));

  const equationValid = (() => {
    const filteredSteps = steps.filter(s => !(s.type === "operator" && (s.operator === "paren-start" || s.operator === "paren-end")));
    if (filteredSteps.length < 3) return false;
    const isValueType = (t: string) => t === "metric" || t === "number";
    if (!isValueType(filteredSteps[0].type) || !isValueType(filteredSteps[filteredSteps.length - 1].type)) return false;
    for (let i = 0; i < filteredSteps.length - 1; i++) {
      const aIsValue = isValueType(filteredSteps[i].type);
      const bIsValue = isValueType(filteredSteps[i + 1].type);
      if (aIsValue === bIsValue) return false;
    }
    return true;
  })();

  return (
    <div style={{ flex: 1, display: isMobile ? "flex" : "flex", flexDirection: isMobile ? "column" : "row", background: "#fff", height: "100%" }}>
      <div style={{ flex: isMobile ? "none" : 3, display: "flex", flexDirection: "column", minWidth: 0, borderRight: !isMobile && targetMetric && steps.length > 0 ? "1px solid #e2e8f0" : "none", maxHeight: isMobile ? "none" : undefined }}>
        <div style={{ padding: isMobile ? "12px 16px" : "18px 24px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, flexWrap: "wrap", gap: 6 }}>
          <h2 style={{ margin: 0, fontSize: isMobile ? 16 : 20, fontWeight: 700, color: "#1a2332" }}>Create Equation</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 8, overflowX: "auto", whiteSpace: "nowrap", flexShrink: 0, scrollbarWidth: "none", msOverflowStyle: "none" }}>
            {checkedOrder.length >= 2 && (
              <button onClick={handleGroupSelected} style={{ padding: "6px 16px", borderRadius: 8, border: "none", background: "#3B82F6", fontSize: 15, cursor: "pointer", color: "#fff", fontWeight: 600, flexShrink: 0 }}>
                Group Selected ({checkedOrder.length})
              </button>
            )}
            <button onClick={handleUndo} disabled={undoStack.length === 0} style={{ width: 32, height: 32, borderRadius: "50%", border: "1.5px solid #e2e8f0", background: undoStack.length === 0 ? "#f8fafc" : "#fff", fontSize: 15, cursor: undoStack.length === 0 ? "not-allowed" : "pointer", color: undoStack.length === 0 ? "#cbd5e1" : "#64748b", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>↺</button>
            <button onClick={handleRedo} disabled={redoStack.length === 0} style={{ width: 32, height: 32, borderRadius: "50%", border: "1.5px solid #e2e8f0", background: redoStack.length === 0 ? "#f8fafc" : "#fff", fontSize: 15, cursor: redoStack.length === 0 ? "not-allowed" : "pointer", color: redoStack.length === 0 ? "#cbd5e1" : "#64748b", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>↻</button>
            <button onClick={() => {
              if (confirmAction === "reset") { setConfirmAction(null); setSteps(initialEquation?.steps ?? []); setEditingStepIndex(null); }
              else { setConfirmAction("reset"); }
            }} style={{ padding: "6px 16px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: confirmAction === "reset" ? "#E85D75" : "#64748b", fontWeight: confirmAction === "reset" ? 600 : 400, flexShrink: 0 }}>{confirmAction === "reset" ? "Confirm Reset?" : "Reset"}</button>
            <button onClick={() => {
              if (confirmAction === "delete") { setConfirmAction(null); setSteps([]); setEditingStepIndex(null); onSave({ steps: [] }); }
              else { setConfirmAction("delete"); }
            }} style={{ padding: "6px 16px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: confirmAction === "delete" ? "#E85D75" : "#64748b", fontWeight: confirmAction === "delete" ? 600 : 400, flexShrink: 0 }}>{confirmAction === "delete" ? "Confirm Delete?" : "Delete Equation"}</button>
            <button onClick={onCancel} style={{ padding: "6px 16px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 15, cursor: "pointer", color: "#64748b", flexShrink: 0 }}>{__('common.cancel', 'Cancel')}</button>
          </div>
        </div>

        <div style={{ flex: 1, padding: isMobile ? "16px" : "24px 32px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 20 }}>
          <div>
            {steps.length > 0 && (() => {
              const renderGroups: { type: "metric" | "operator" | "fraction" | "paren-group" | "number"; step?: EquationStep; steps?: EquationStep[]; groupIdx?: number; startIdx: number }[] = [];
              let i = 0;
              while (i < steps.length) {
                if (steps[i].type === "operator" && steps[i].operator === "paren-start") {
                  let depth = 1;
                  let j = i + 1;
                  while (j < steps.length && depth > 0) {
                    if (steps[j].type === "operator" && steps[j].operator === "paren-start") depth++;
                    else if (steps[j].type === "operator" && steps[j].operator === "paren-end") depth--;
                    if (depth > 0) j++;
                  }
                  renderGroups.push({ type: "paren-group", steps: steps.slice(i, j + 1), groupIdx: renderGroups.length, startIdx: i });
                  i = j + 1;
                } else if (steps[i].type === "number") {
                  renderGroups.push({ type: "number", step: steps[i], groupIdx: renderGroups.length, startIdx: i });
                  i++;
                } else {
                  renderGroups.push({ type: steps[i].type as "metric" | "operator", step: steps[i], groupIdx: renderGroups.length, startIdx: i });
                  i++;
                }
              }
              for (let ri = 0; ri < renderGroups.length - 2; ri++) {
                const a = renderGroups[ri];
                const b = renderGroups[ri + 1];
                const c = renderGroups[ri + 2];
                if (a.type === "paren-group" && b.type === "operator" && b.step?.operator === "/" && c.type === "paren-group") {
                  renderGroups.splice(ri, 3, { type: "fraction", steps: [...a.steps!, b.step, ...c.steps!], groupIdx: ri, startIdx: a.startIdx });
                }
              }
              const stepNumbers = assignStepNumbers(steps);
              return (
              <div onClick={() => { setSelectedGroupStartIdx(null); setEditingStepIndex(null); }} style={{ display: "flex", alignItems: "flex-start", flexWrap: "wrap", gap: 6, padding: "14px 18px", background: "#F8FAFC", borderRadius: 12, border: "1px solid #e2e8f0", minHeight: 60, position: "relative" }}>
                {(() => {
                  const innerRenderGroup = (g: typeof renderGroups[0], gi: number, si: number, sc: number, shrinkScale: number) => {
                    const startIdx = g.startIdx;
                    const lineBefore = dropLineIndex === startIdx;
                    const cs = sc;
                    const csScale = Math.max(0.6, Math.min(1, cs / 140));
                    if (g.type === "fraction" && g.steps) {
                      const slashIdxInSteps = g.steps.findIndex(s => s.type === "operator" && s.operator === "/");
                      const numStart = g.startIdx + 1;
                      const numEnd = g.startIdx + slashIdxInSteps;
                      const denStart = g.startIdx + slashIdxInSteps + 2;
                      const denEnd = g.startIdx + g.steps.length - 1;
                      const actualSlashIdx = g.startIdx + slashIdxInSteps;
                      const isNumEditing = editingStepIndex !== null && editingStepIndex >= numStart && editingStepIndex < numEnd;
                      const isDenEditing = editingStepIndex !== null && editingStepIndex >= denStart && editingStepIndex < denEnd;
                      const isEditing = isNumEditing || isDenEditing || editingStepIndex === actualSlashIdx;
                      const z1 = g.startIdx;
                      const z2 = numStart;
                      const z4 = denStart;
                      const z5 = g.startIdx + g.steps!.length;
                      const dropZone = (e: React.DragEvent) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const y = e.clientY - rect.top;
                        const w = rect.width;
                        const h = rect.height;
                        if (x < w * 0.15) return z1;
                        if (x > w * 0.85) return z5;
                        if (y < h * 0.5) return z2;
                        return z4;
                      };
                      return [
                        dropLineIndex === z1 && (
                          <div key={`fz1-${gi}-${si}`} style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />
                        ),
                        <div key={`f-${si}-${gi}`}
                          draggable
                          onDragStart={e => {
                            e.dataTransfer.setData("text/plain", "");
                            e.dataTransfer.effectAllowed = "move";
                            e.stopPropagation();
                            dragStepIdxRef.current = g.startIdx;
                            dragCountRef.current = g.steps!.length;
                            const el = e.currentTarget.cloneNode(true) as HTMLElement;
                            el.style.cssText = 'position:absolute;top:-999px;left:-999px;transform:scale(0.5);transform-origin:top left;border-radius:12px;overflow:hidden;outline:2px solid #3B82F6;background:#EFF6FF;';
                            el.style.pointerEvents = 'none';
                            document.body.appendChild(el);
                            const r = el.getBoundingClientRect();
                            e.dataTransfer.setDragImage(el, r.width / 2, r.height / 2);
                            setTimeout(() => document.body.removeChild(el), 0);
                          }}
                          onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDropLineIndex(dropZone(e)); dropLineIndexRef.current = dropZone(e); }}
                          onDrop={e => { e.preventDefault(); e.stopPropagation(); handleStepDrop(dropZone(e)); }}
                          onDragEnd={() => { dragStepIdxRef.current = null; dragCountRef.current = 1; setDropLineIndex(null); dropLineIndexRef.current = null; }}
                          onClick={e => { e.stopPropagation(); handleEditStep(actualSlashIdx); }}
                          style={{ position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "flex-start", borderRadius: 12, padding: 2, minWidth: `${Math.max(180, 140 * csScale)}px`, outline: isEditing ? "2px solid #3B82F6" : "2px solid transparent", background: isEditing ? "#EFF6FF" : "transparent" }}>
                          {isEditing && (
                            <div onClick={e => { e.stopPropagation(); setSteps(prev => { const n = [...prev]; n.splice(g.startIdx, g.steps!.length); return n; }); setEditingStepIndex(null); }} style={{ position: "absolute", top: 2, right: 2, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#3B82F6", fontSize: 22, fontWeight: 700, lineHeight: 1, zIndex: 10 }}>×</div>
                          )}
                          {renderCheckbox(actualSlashIdx, isEditing)}
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                            <div style={{ display: "inline-flex", flexWrap: "wrap", gap: 6, padding: "8px 12px", border: "2px solid #e2e8f0", borderRadius: 16, background: "#fff", alignItems: "flex-start", minWidth: `${140 * csScale}px` }}
                              onClick={e => e.stopPropagation()}>
                              {dropLineIndex === z2 && numEnd === numStart && (
                                <div style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />
                              )}
                              {renderRange(numStart, numEnd)}
                              {renderPlusButton(numEnd - 1, `fn-${si}-${gi}`)}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <div onClick={e => { e.stopPropagation(); handleEditStep(actualSlashIdx); }} style={{ width: 48 * csScale, height: 48 * csScale, borderRadius: "50%", background: "#3B82F6", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 * csScale, fontWeight: 700, cursor: "pointer" }}>÷</div>
                            </div>
                            <div style={{ display: "inline-flex", flexWrap: "wrap", gap: 6, padding: "8px 12px", border: "2px solid #e2e8f0", borderRadius: 16, background: "#fff", alignItems: "flex-start", minWidth: `${140 * csScale}px` }}
                              onClick={e => e.stopPropagation()}>
                              {dropLineIndex === z4 && denEnd === denStart && (
                                <div style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />
                              )}
                              {renderRange(denStart, denEnd)}
                              {renderPlusButton(denEnd, `fd-${si}-${gi}`)}
                            </div>
                          </div>
                        </div>
                      ];
                    }
                    if (g.type === "metric" && g.step) {
                      const step = g.step;
                      const idx = steps.indexOf(step);
                      const isEditing = editingStepIndex === idx;
                      const fullMetric = allMetrics.find(m => m.id === step.metricId);
                      return [
                        lineBefore && (
                          <div key={`ml-${gi}-${si}`} style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />
                        ),
                        <div key={`m-${si}-${gi}`}
                          draggable
                          onDragStart={e => {
                            e.dataTransfer.setData("text/plain", "");
                            e.dataTransfer.effectAllowed = "move";
                            e.stopPropagation();
                            dragStepIdxRef.current = idx;
                            dragCountRef.current = 1;
                            handleEditStep(idx);
                            const el = e.currentTarget.cloneNode(true) as HTMLElement;
                            el.style.cssText = 'position:absolute;top:-999px;left:-999px;transform:scale(0.5);transform-origin:top left;border-radius:12px;overflow:hidden;outline:2px solid #3B82F6;background:#EFF6FF;';
                            el.style.pointerEvents = 'none';
                            document.body.appendChild(el);
                            const r = el.getBoundingClientRect();
                            e.dataTransfer.setDragImage(el, r.width / 2, r.height / 2);
                            setTimeout(() => document.body.removeChild(el), 0);
                          }}
                          onDragOver={e => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const m = rect.left + rect.width / 2; const idx2 = e.clientX < m ? idx : idx + 1; setDropLineIndex(idx2); dropLineIndexRef.current = idx2; }}
                          onDrop={e => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const m = rect.left + rect.width / 2; const idx2 = e.clientX < m ? idx : idx + 1; handleStepDrop(idx2); }}
                          onDragEnd={() => { dragStepIdxRef.current = null; dragCountRef.current = 1; setDropLineIndex(null); dropLineIndexRef.current = null; }}
                          onClick={e => { e.stopPropagation(); handleEditStep(idx); }}
                          style={{ position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "flex-start", borderRadius: 12, padding: 2, outline: isEditing ? "2px solid #3B82F6" : "2px solid transparent", background: isEditing ? "#EFF6FF" : "transparent" }}>
                          {isEditing && (
                            <div onClick={e => { e.stopPropagation(); handleRemoveStep(idx); }} style={{ position: "absolute", top: 2, right: 2, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#3B82F6", fontSize: 22, fontWeight: 700, lineHeight: 1, zIndex: 10 }}>×</div>
                          )}
                          {renderCheckbox(idx, isEditing)}
                          <div style={{ display: "flex", justifyContent: "center", width: "100%", marginBottom: 3 }}>
                            <div style={{
                              width: 44 * csScale, height: 44 * csScale, borderRadius: "50%",
                              background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 20 * csScale, fontWeight: 700,
                              display: "flex", alignItems: "center", justifyContent: "center"
                            }}>
                              {stepNumbers.get(g.startIdx) ?? ""}
                            </div>
                          </div>
                          {fullMetric ? (
                            <MetricBlock
                              metric={fullMetric}
                              onClick={() => handleEditStep(idx)}
                              onDragStart={() => {}}
                              onDragEnter={() => {}}
                              onDrop={() => {}}
                              isDragOver={false}
                              disableDrag
                            />
                          ) : (
                            <div style={{ width: 140, minHeight: 140, borderRadius: 12, background: "#F8FAFC", border: "1.5px solid #e2e8f0", padding: "8px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                              <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2332", textAlign: "center" }}>{step.metricLabel ?? "?"}</div>
                              <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2332", textAlign: "center" }}>{step.metricValue ?? ""}</div>
                            </div>
                          )}
                        </div>
                      ];
                    }
                    if (g.type === "number" && g.step) {
                      const step = g.step;
                      const idx = steps.indexOf(step);
                      const isEditing = editingStepIndex === idx;
                      const numVal = step.numberValue !== undefined ? step.numberValue : "";
                      return [
                        lineBefore && (
                          <div key={`nl-${gi}-${si}`} style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />
                        ),
                        <div key={`n-${si}-${gi}`}
                          draggable
                          onDragStart={e => {
                            e.dataTransfer.setData("text/plain", "");
                            e.dataTransfer.effectAllowed = "move";
                            e.stopPropagation();
                            dragStepIdxRef.current = idx;
                            dragCountRef.current = 1;
                            handleEditStep(idx);
                            const el = e.currentTarget.cloneNode(true) as HTMLElement;
                            el.style.cssText = 'position:absolute;top:-999px;left:-999px;transform:scale(0.5);transform-origin:top left;border-radius:12px;overflow:hidden;outline:2px solid #3B82F6;background:#EFF6FF;';
                            el.style.pointerEvents = 'none';
                            document.body.appendChild(el);
                            const r = el.getBoundingClientRect();
                            e.dataTransfer.setDragImage(el, r.width / 2, r.height / 2);
                            setTimeout(() => document.body.removeChild(el), 0);
                          }}
                          onDragOver={e => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const m = rect.left + rect.width / 2; const idx2 = e.clientX < m ? idx : idx + 1; setDropLineIndex(idx2); dropLineIndexRef.current = idx2; }}
                          onDrop={e => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const m = rect.left + rect.width / 2; const idx2 = e.clientX < m ? idx : idx + 1; handleStepDrop(idx2); }}
                          onDragEnd={() => { dragStepIdxRef.current = null; dragCountRef.current = 1; setDropLineIndex(null); dropLineIndexRef.current = null; }}
                          onClick={e => { e.stopPropagation(); handleEditStep(idx); }}
                          style={{ position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "flex-start", borderRadius: 12, padding: 2, outline: isEditing ? "2px solid #3B82F6" : "2px solid transparent", background: isEditing ? "#EFF6FF" : "transparent" }}>
                          {isEditing && (
                            <div onClick={e => { e.stopPropagation(); handleRemoveStep(idx); }} style={{ position: "absolute", top: 2, right: 2, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#3B82F6", fontSize: 22, fontWeight: 700, lineHeight: 1, zIndex: 10 }}>×</div>
                          )}
                          {renderCheckbox(idx, isEditing)}
                          <div style={{ display: "flex", justifyContent: "center", width: "100%", marginBottom: 3 }}>
                            <div style={{
                              width: 44 * csScale, height: 44 * csScale, borderRadius: "50%",
                              background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 20 * csScale, fontWeight: 700,
                              display: "flex", alignItems: "center", justifyContent: "center"
                            }}>
                              {stepNumbers.get(g.startIdx) ?? ""}
                            </div>
                          </div>
                          <div style={{ width: 140, minHeight: 100, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 12, background: "#F8FAFC", border: "1.5px solid #e2e8f0", padding: "8px" }}>
                            {isEditing ? (
                              <input autoFocus type="number" value={numVal}
                                placeholder="0"
                                onChange={e => {
                                  const raw = e.target.value;
                                  setSteps(prev => {
                                    const n = [...prev];
                                    if (n[idx]) n[idx] = { ...n[idx], numberValue: raw === "" ? undefined : parseFloat(raw) };
                                    return n;
                                  });
                                }}
                                onClick={e => e.stopPropagation()}
                                style={{ width: "100%", fontFamily: "inherit", fontSize: 20, fontWeight: 700, color: step.numberValue !== undefined ? "#1a2332" : "#94a3b8", textAlign: "center", border: "none", background: "transparent", outline: "none", padding: 0 }}
                              />
                            ) : (
                              <div style={{ fontSize: 22, fontWeight: 700, color: "#1a2332" }}>{numVal || "0"}</div>
                            )}
                          </div>
                        </div>
                      ];
                    }
                    if (g.type === "operator" && g.step) {
                      const step = g.step;
                      const idx = steps.indexOf(step);
                      const isEditing = editingStepIndex === idx;
                      return [
                        lineBefore && (
                          <div key={`ol-${gi}-${si}`} style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />
                        ),
                        <div key={`o-${si}-${gi}`}
                          draggable
                          onDragStart={e => {
                            e.dataTransfer.setData("text/plain", "");
                            e.dataTransfer.effectAllowed = "move";
                            e.stopPropagation();
                            dragStepIdxRef.current = idx;
                            dragCountRef.current = 1;
                            handleEditStep(idx);
                            const el = e.currentTarget.cloneNode(true) as HTMLElement;
                            el.style.cssText = 'position:absolute;top:-999px;left:-999px;transform:scale(0.5);transform-origin:top left;border-radius:12px;overflow:hidden;outline:2px solid #3B82F6;background:#EFF6FF;';
                            el.style.pointerEvents = 'none';
                            document.body.appendChild(el);
                            const r = el.getBoundingClientRect();
                            e.dataTransfer.setDragImage(el, r.width / 2, r.height / 2);
                            setTimeout(() => document.body.removeChild(el), 0);
                          }}
                          onDragOver={e => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const m = rect.left + rect.width / 2; const idx2 = e.clientX < m ? idx : idx + 1; setDropLineIndex(idx2); dropLineIndexRef.current = idx2; }}
                          onDrop={e => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const m = rect.left + rect.width / 2; const idx2 = e.clientX < m ? idx : idx + 1; handleStepDrop(idx2); }}
                          onDragEnd={() => { dragStepIdxRef.current = null; dragCountRef.current = 1; setDropLineIndex(null); dropLineIndexRef.current = null; }}
                          onClick={e => { e.stopPropagation(); handleEditStep(idx); }}
                          style={{ position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "flex-start", borderRadius: 12, padding: 2, outline: isEditing ? "2px solid #3B82F6" : "2px solid transparent", background: isEditing ? "#EFF6FF" : "transparent" }}>
                          {isEditing && (
                            <div onClick={e => { e.stopPropagation(); handleRemoveStep(idx); }} style={{ position: "absolute", top: 2, right: 2, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#3B82F6", fontSize: 22, fontWeight: 700, lineHeight: 1, zIndex: 10 }}>×</div>
                          )}
                          {renderCheckbox(idx, isEditing)}
                          <div style={{ display: "flex", justifyContent: "center", width: "100%", marginBottom: 3 }}>
                            <div style={{
                              width: 44 * csScale, height: 44 * csScale, borderRadius: "50%",
                              background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 20 * csScale, fontWeight: 700,
                              display: "flex", alignItems: "center", justifyContent: "center"
                            }}>
                              {stepNumbers.get(g.startIdx) ?? ""}
                            </div>
                          </div>
                          <div style={{ width: 140, minHeight: 140, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <div style={{
                              width: 48 * csScale, height: 48 * csScale, borderRadius: "50%",
                              background: "#3B82F6", color: "#fff",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: 22 * csScale, fontWeight: 700,
                            }}>
                              {step.operator === "*" ? "×" : step.operator === "/" ? "÷" : step.operator}
                            </div>
                          </div>
                        </div>
                      ];
                    }
                    return null;
                  };

                  const renderAddMenu = (insertAt: number, menuKey: string) => (
                    showAddMenu && addAtIndex === insertAt ? (
                      <div key={menuKey} ref={addMenuRef} style={{ position: "absolute", left: 0, top: "100%", marginTop: 4, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid #e2e8f0", zIndex: 50, minWidth: 170, overflow: "hidden" }}>
                        <div onClick={e => { e.stopPropagation(); setShowAddMenu(false); setForceSearch(true); setPendingOperator(false); setEditingStepIndex(null); setSearchQuery(""); setTimeout(() => searchRef.current?.focus(), 50); }} style={{ padding: "9px 14px", fontSize: 15, cursor: "pointer", color: "#1a2332" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>{__('common.metric', 'Metric')}</div>
                        <div onClick={e => { e.stopPropagation(); handleAddNumberStep(); }} style={{ padding: "9px 14px", fontSize: 15, cursor: "pointer", color: "#1a2332" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>{__('common.number', 'Number')}</div>
                        <div onClick={e => { e.stopPropagation(); setShowAddMenu(false); setForceSearch(false); setPendingOperator(true); setEditingStepIndex(null); setSearchQuery(""); }} style={{ padding: "9px 14px", fontSize: 15, cursor: "pointer", color: "#1a2332" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>{__('equation.math', 'Math')}</div>
                      </div>
                    ) : null
                  );

                  const renderPlusButton = (insertAt: number, key: string) => (
                    <div key={key} style={{ alignSelf: "center", position: "relative" }}
                      onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDropLineIndex(insertAt); dropLineIndexRef.current = insertAt; }}
                      onDrop={e => { e.preventDefault(); e.stopPropagation(); handleStepDrop(insertAt); }}>
                      <div onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setAddAtIndex(insertAt); setShowAddMenu(v => !v); }}
                        style={{ width: 36, height: 36, borderRadius: "50%", border: "1.5px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#94a3b8", fontSize: 18, background: "#fff", flexShrink: 0 }}>+</div>
                      {renderAddMenu(insertAt, `menu-${key}`)}
                    </div>
                  );

                  const renderRange = (rStart: number, rEnd: number): React.ReactNode[] => {
                    const rangeLen = rEnd - rStart;
                    if (rangeLen <= 0) return [];
                    const subGroups: typeof renderGroups = [];
                    let ri = rStart;
                    while (ri < rEnd) {
                      if (steps[ri].type === "operator" && steps[ri].operator === "paren-start") {
                        let depth = 1; let rj = ri + 1;
                        while (rj < rEnd && depth > 0) {
                          if (steps[rj].type === "operator" && steps[rj].operator === "paren-start") depth++;
                          else if (steps[rj].type === "operator" && steps[rj].operator === "paren-end") depth--;
                          if (depth > 0) rj++;
                        }
                        subGroups.push({ type: "paren-group", steps: steps.slice(ri, rj + 1), groupIdx: ri, startIdx: ri });
                        ri = rj + 1;
                      } else if (steps[ri].type === "operator" && steps[ri].operator === "paren-end") {
                        ri++;
                      } else if (steps[ri].type === "number") {
                        subGroups.push({ type: "number", step: steps[ri], groupIdx: ri, startIdx: ri });
                        ri++;
                      } else {
                        subGroups.push({ type: steps[ri].type as "metric" | "operator", step: steps[ri], groupIdx: ri, startIdx: ri });
                        ri++;
                      }
                    }
                    if (subGroups.length === 0) return [];
                    for (let ri = 0; ri < subGroups.length - 2; ri++) {
                      const a = subGroups[ri];
                      const b = subGroups[ri + 1];
                      const c = subGroups[ri + 2];
                      if (a.type === "paren-group" && b.type === "operator" && b.step?.operator === "/" && c.type === "paren-group") {
                        subGroups.splice(ri, 3, { type: "fraction", steps: [...a.steps!, b.step, ...c.steps!], groupIdx: ri, startIdx: a.startIdx });
                      }
                    }

                    const subSections: typeof sections = [];
                    for (let sri = 0; sri < subGroups.length; sri++) {
                      const g = subGroups[sri];
                      const last = subSections[subSections.length - 1];
                      const sCnt = g.type === "fraction" || g.type === "paren-group" ? g.steps!.length : 1;
                      if (last && last.type === "seq") {
                        last.groups!.push(g);
                        last.endStepIdx = g.startIdx + sCnt;
                      } else {
                        subSections.push({ type: "seq", groups: [g], endStepIdx: g.startIdx + sCnt });
                      }
                    }

                    const subResult: React.ReactNode[] = [];
                    subSections.forEach((sec, ssi) => {
                      if (sec.type === "seq") {
                        const secRendered: React.ReactNode[] = [];
                        sec.groups!.forEach((g, ggi) => {
                          if (g.type === "paren-group") {
                            const pgLineBefore = dropLineIndex === g.startIdx;
                            const rpgIsSelected = selectedGroupStartIdx === g.startIdx;
                            if (pgLineBefore) secRendered.push(<div key={`rpgline-${rStart}-${ssi}-${ggi}`} style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />);
                            secRendered.push(
                              <div key={`rpg-${rStart}-${ssi}-${ggi}`}
                                onClick={e => { e.stopPropagation(); setSelectedGroupStartIdx(rpgIsSelected ? null : g.startIdx); }}
                                draggable
                                onDragStart={e => {
                                  e.dataTransfer.setData("text/plain", "");
                                  e.dataTransfer.effectAllowed = "move";
                                  e.stopPropagation();
                                  dragStepIdxRef.current = g.startIdx;
                                  dragCountRef.current = g.steps!.length;
                                  const el = e.currentTarget.cloneNode(true) as HTMLElement;
                                  el.style.cssText = 'position:absolute;top:-999px;left:-999px;transform:scale(0.5);transform-origin:top left;border-radius:12px;overflow:hidden;outline:2px solid #3B82F6;background:#EFF6FF;';
                                  el.style.pointerEvents = 'none';
                                  document.body.appendChild(el);
                                  const r = el.getBoundingClientRect();
                                  e.dataTransfer.setDragImage(el, r.width / 2, r.height / 2);
                                  setTimeout(() => document.body.removeChild(el), 0);
                                }}
                                onDragOver={e => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const x = e.clientX - rect.left; const w = rect.width; const idx = x < w * 0.15 ? g.startIdx : x > w * 0.85 ? g.startIdx + g.steps!.length : g.startIdx + g.steps!.length - 1; setDropLineIndex(idx); dropLineIndexRef.current = idx; }}
                                onDrop={e => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const x = e.clientX - rect.left; const w = rect.width; const idx = x < w * 0.15 ? g.startIdx : x > w * 0.85 ? g.startIdx + g.steps!.length : g.startIdx + g.steps!.length - 1; handleStepDrop(idx); }}
                                onDragEnd={() => { dragStepIdxRef.current = null; dragCountRef.current = 1; setDropLineIndex(null); dropLineIndexRef.current = null; }}
                                style={{ position: "relative", display: "inline-flex", flexWrap: "wrap", gap: 6, padding: "8px 12px", border: `2px solid ${rpgIsSelected ? "#3B82F6" : "#e2e8f0"}`, borderRadius: 16, background: "#fff", alignItems: "flex-start", minWidth: `${140 * Math.max(0.6, Math.min(1, cardSize / 140))}px`, minHeight: `${140 * Math.max(0.6, Math.min(1, cardSize / 140))}px` }}>
                                {rpgIsSelected && (
                                  <div onClick={e => { e.stopPropagation(); handleRemoveGroup(g.startIdx); }} style={{ position: "absolute", top: -6, right: -6, width: 24, height: 24, borderRadius: "50%", background: "#3B82F6", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 15, fontWeight: 700, zIndex: 20, boxShadow: "0 2px 6px rgba(0,0,0,0.15)" }}>×</div>
                                )}
                                {renderRange(g.startIdx + 1, g.startIdx + g.steps!.length - 1)}
                                {dropLineIndex === g.startIdx + g.steps!.length - 1 && dropLineIndex > g.startIdx && dropLineIndex < g.startIdx + g.steps!.length && (
                                  <div style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />
                                )}
                                {renderPlusButton(g.startIdx + g.steps!.length - 1, `rpgp-${rStart}-${ssi}-${ggi}`)}
                              </div>
                            );
                          } else {
                            const r = innerRenderGroup(g, ggi, ssi, cardSize, 1);
                            if (r) secRendered.push(...r);
                          }
                        });
                        const isLast = ssi === subSections.length - 1;
                        if (isLast) {
                          subResult.push(...secRendered);
                        } else {
                          subResult.push(
                            <div key={`rw-${rStart}-${ssi}`} style={{ display: "inline-flex", flexWrap: "wrap", gap: 6, padding: "8px 12px", border: "2px solid #e2e8f0", borderRadius: 16, background: "#fff", alignItems: "flex-start" }}
                              onClick={e => e.stopPropagation()}
                              onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDropLineIndex(sec.endStepIdx); dropLineIndexRef.current = sec.endStepIdx; }}
                              onDrop={e => { e.preventDefault(); e.stopPropagation(); handleStepDrop(sec.endStepIdx); }}>
                              {secRendered}
                              {dropLineIndex === sec.endStepIdx && <div style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />}
                              {renderPlusButton(sec.endStepIdx, `rp-${rStart}-${ssi}`)}
                            </div>
                          );
                        }
                      }
                    });
                    return subResult;
                  };

                  const sections: { type: "seq"; groups: typeof renderGroups; endStepIdx: number }[] = [];
                  for (let ri = 0; ri < renderGroups.length; ri++) {
                    const g = renderGroups[ri];
                    const last = sections[sections.length - 1];
                    const stepCount = g.type === "fraction" || g.type === "paren-group" ? g.steps!.length : 1;
                    if (last && last.type === "seq") {
                      last.groups!.push(g);
                      last.endStepIdx = g.startIdx + stepCount;
                    } else {
                      sections.push({ type: "seq", groups: [g], endStepIdx: g.startIdx + stepCount });
                    }
                  }

                  const result: React.ReactNode[] = [];
                  sections.forEach((sec, si) => {
                    if (sec.type === "seq") {
                      const groupsRendered: React.ReactNode[] = [];
                      sec.groups!.forEach((g, gi) => {
                          if (g.type === "paren-group") {
                          const lineBefore = dropLineIndex === g.startIdx;
                          const pgIsSelected = selectedGroupStartIdx === g.startIdx;
                          if (lineBefore) groupsRendered.push(<div key={`pgline-${si}-${gi}`} style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />);
                          groupsRendered.push(
                            <div key={`pg-${si}-${gi}`}
                              onClick={e => { e.stopPropagation(); setSelectedGroupStartIdx(pgIsSelected ? null : g.startIdx); }}
                              draggable
                              onDragStart={e => {
                                e.dataTransfer.setData("text/plain", "");
                                e.dataTransfer.effectAllowed = "move";
                                e.stopPropagation();
                                dragStepIdxRef.current = g.startIdx;
                                dragCountRef.current = g.steps!.length;
                                const el = e.currentTarget.cloneNode(true) as HTMLElement;
                                el.style.cssText = 'position:absolute;top:-999px;left:-999px;transform:scale(0.5);transform-origin:top left;border-radius:12px;overflow:hidden;outline:2px solid #3B82F6;background:#EFF6FF;';
                                el.style.pointerEvents = 'none';
                                document.body.appendChild(el);
                                const r = el.getBoundingClientRect();
                                e.dataTransfer.setDragImage(el, r.width / 2, r.height / 2);
                                setTimeout(() => document.body.removeChild(el), 0);
                              }}
                              onDragOver={e => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const x = e.clientX - rect.left; const w = rect.width; const idx = x < w * 0.15 ? g.startIdx : x > w * 0.85 ? g.startIdx + g.steps!.length : g.startIdx + g.steps!.length - 1; setDropLineIndex(idx); dropLineIndexRef.current = idx; }}
                              onDrop={e => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const x = e.clientX - rect.left; const w = rect.width; const idx = x < w * 0.15 ? g.startIdx : x > w * 0.85 ? g.startIdx + g.steps!.length : g.startIdx + g.steps!.length - 1; handleStepDrop(idx); }}
                              onDragEnd={() => { dragStepIdxRef.current = null; dragCountRef.current = 1; setDropLineIndex(null); dropLineIndexRef.current = null; }}
                              style={{ position: "relative", display: "inline-flex", flexWrap: "wrap", gap: 6, padding: "8px 12px", border: `2px solid ${pgIsSelected ? "#3B82F6" : "#e2e8f0"}`, borderRadius: 16, background: "#fff", alignItems: "flex-start", minWidth: `${140 * Math.max(0.6, Math.min(1, cardSize / 140))}px`, minHeight: `${140 * Math.max(0.6, Math.min(1, cardSize / 140))}px` }}>
                              {pgIsSelected && (
                                <div onClick={e => { e.stopPropagation(); handleRemoveGroup(g.startIdx); }} style={{ position: "absolute", top: -6, right: -6, width: 24, height: 24, borderRadius: "50%", background: "#3B82F6", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 15, fontWeight: 700, zIndex: 20, boxShadow: "0 2px 6px rgba(0,0,0,0.15)" }}>×</div>
                              )}
                              {renderRange(g.startIdx + 1, g.startIdx + g.steps!.length - 1)}
                              {dropLineIndex === g.startIdx + g.steps!.length - 1 && dropLineIndex > g.startIdx && dropLineIndex < g.startIdx + g.steps!.length && (
                                <div style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />
                              )}
                              {renderPlusButton(g.startIdx + g.steps!.length - 1, `pgp-${si}-${gi}`)}
                            </div>
                          );
                        } else {
                          const rendered = innerRenderGroup(g, gi, si, cardSize, 1);
                          if (rendered) groupsRendered.push(...rendered);
                        }
                      });
                      const isLast = si === sections.length - 1;
                      const lineAtEnd = dropLineIndex === sec.endStepIdx;
                      if (isLast) {
                        result.push(...groupsRendered);
                      } else {
                        result.push(
                          <div key={`wrap-${si}`} style={{ display: "inline-flex", flexWrap: "wrap", gap: 6, padding: "8px 12px", border: "2px solid #e2e8f0", borderRadius: 16, background: "#fff", alignItems: "flex-start" }}
                            onClick={e => e.stopPropagation()}
                            onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDropLineIndex(sec.endStepIdx); dropLineIndexRef.current = sec.endStepIdx; }}
                            onDrop={e => { e.preventDefault(); e.stopPropagation(); handleStepDrop(sec.endStepIdx); }}>
                            {groupsRendered}
                            {lineAtEnd && <div style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />}
                            {renderPlusButton(sec.endStepIdx, `sp-${si}`)}
                          </div>
                        );
                      }
                    }
                      });
                  result.push(renderPlusButton(steps.length, "end"));
                  return result;
                })()}
                {dropLineIndex === steps.length && (
                  <div key="end-line" style={{ width: 3, alignSelf: "stretch", background: "#3B82F6", borderRadius: 2, flexShrink: 0, minHeight: 60 }} />
                )}
              </div>
              );
            })()}
          </div>

          <div>
            {showMathPicker && (
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 10 }}>{__('equation.selectMath', 'Select the math:')}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <button onClick={() => handleSelectOperator("+")} style={{ padding: "14px 0", borderRadius: 16, border: "2px solid #e2e8f0", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer", fontSize: 24, fontWeight: 700, color: "#3B82F6" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#3B82F6"; e.currentTarget.style.background = "#EFF6FF"; }} onMouseLeave={e => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.background = "#fff"; }}>
                    <span>+</span>
                    <span style={{ fontSize: 15, fontWeight: 500, color: "#94a3b8" }}>{__('common.add', 'Add')}</span>
                  </button>
                  <button onClick={() => handleSelectOperator("-")} style={{ padding: "14px 0", borderRadius: 16, border: "2px solid #e2e8f0", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer", fontSize: 24, fontWeight: 700, color: "#3B82F6" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#3B82F6"; e.currentTarget.style.background = "#EFF6FF"; }} onMouseLeave={e => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.background = "#fff"; }}>
                    <span>−</span>
                    <span style={{ fontSize: 15, fontWeight: 500, color: "#94a3b8" }}>{__('equation.subtract', 'Subtract')}</span>
                  </button>
                  <button onClick={() => handleSelectOperator("*")} style={{ padding: "14px 0", borderRadius: 16, border: "2px solid #e2e8f0", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer", fontSize: 24, fontWeight: 700, color: "#3B82F6" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#3B82F6"; e.currentTarget.style.background = "#EFF6FF"; }} onMouseLeave={e => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.background = "#fff"; }}>
                    <span>×</span>
                    <span style={{ fontSize: 15, fontWeight: 500, color: "#94a3b8" }}>{__('equation.multiply', 'Multiply')}</span>
                  </button>
                  <button onClick={() => handleSelectOperator("/")} style={{ padding: "14px 0", borderRadius: 16, border: "2px solid #e2e8f0", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer", fontSize: 24, fontWeight: 700, color: "#3B82F6" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#3B82F6"; e.currentTarget.style.background = "#EFF6FF"; }} onMouseLeave={e => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.background = "#fff"; }}>
                    <span>÷</span>
                    <span style={{ fontSize: 15, fontWeight: 500, color: "#94a3b8" }}>{__('equation.divide', 'Divide')}</span>
                  </button>
                  <button onClick={() => handleAddParentheses()} style={{ padding: "14px 0", borderRadius: 16, border: "2px solid #e2e8f0", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer", fontSize: 24, fontWeight: 700, color: "#3B82F6" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#3B82F6"; e.currentTarget.style.background = "#EFF6FF"; }} onMouseLeave={e => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.background = "#fff"; }}>
                    <span style={{ fontSize: 20 }}>( )</span>
                    <span style={{ fontSize: 15, fontWeight: 500, color: "#94a3b8" }}>{__('common.group', 'Group')}</span>
                  </button>
                  <button onClick={() => handleAddFraction()} style={{ padding: "14px 0", borderRadius: 16, border: "2px solid #e2e8f0", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer", fontSize: 24, fontWeight: 700, color: "#3B82F6" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#3B82F6"; e.currentTarget.style.background = "#EFF6FF"; }} onMouseLeave={e => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.background = "#fff"; }}>
                    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", lineHeight: 1 }}>
                      <span style={{ padding: "0 4px 2px", borderBottom: "2px solid currentColor", fontSize: 15 }}>□</span>
                      <span style={{ padding: "2px 4px 0", fontSize: 15 }}>□</span>
                    </span>
                    <span style={{ fontSize: 15, fontWeight: 500, color: "#94a3b8" }}>{__('common.fraction', 'Fraction')}</span>
                  </button>
                </div>
              </div>
            )}
            {!showMathPicker && (
              <>
                <div style={{ marginBottom: 16 }}>
                  <input
                    ref={searchRef}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && steps.length > 0) {
                        e.preventDefault();
                        if (e.shiftKey) {
                          setSteps(prev => [{ type: "operator", operator: "paren-start" }, ...prev, { type: "operator", operator: "paren-end" }, { type: "operator", operator: "/" }, { type: "operator", operator: "paren-start" }, { type: "operator", operator: "paren-end" }]);
                        } else {
                          setSteps(prev => [{ type: "operator", operator: "paren-start" }, ...prev, { type: "operator", operator: "paren-end" }]);
                        }
                      }
                    }}
                    placeholder={steps.length === 0 ? "Start typing the name of a metric box..." : "Start typing the next metric box..."}
                    style={{
                      width: "100%", border: "none", outline: "none",
                      fontSize: steps.length === 0 ? 48 : 18,
                      fontWeight: steps.length === 0 ? 700 : 300,
                      color: "#1a2332", background: "transparent",
                      fontFamily: "inherit",
                      borderBottom: "2px solid #e2e8f0",
                      padding: steps.length === 0 ? "24px 0" : "8px 0",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                {filteredMetrics.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "row", gap: 10, overflowX: "auto", flexWrap: "nowrap", padding: "14px 0" }}>
                    {filteredMetrics.slice(0, 12).map(m => (
                      <div key={m.id} style={{ cursor: "pointer", flexShrink: 0 }}>
                        <MetricBlock metric={m} onClick={() => handleSelectMetric(m)} onDragStart={() => {}} onDragEnter={() => {}} onDrop={() => {}} isDragOver={false} disableDrag />
                      </div>
                    ))}
                  </div>
                )}
                {steps.length === 0 && (
                  <button onClick={handleAddNumberStep} style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#334155", fontSize: 15, fontWeight: 500, cursor: "pointer", marginTop: 12, display: "block" }}>
                    Start with a Number
                  </button>
                )}
                {searchQuery.trim() && filteredMetrics.length === 0 && (
                  <div style={{ padding: "20px", textAlign: "center", color: "#94a3b8", fontSize: 15 }}>
                    No metric boxes found matching "{searchQuery}"
                  </div>
                )}
                {steps.length === 0 && !searchQuery.trim() && filteredMetrics.length === 0 && (
                  <div style={{ padding: "40px 20px", textAlign: "center" }}>
                    <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 6 }}>{__('common.noMetricBoxes', 'No metric boxes available')}</div>
                    <div style={{ fontSize: 15, color: "#cbd5e1" }}>Create some metric boxes on your dashboard first</div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {isMobile && targetMetric && steps.length > 0 && (
          <div style={{ borderTop: "1px solid #e2e8f0", padding: "12px 16px", background: "#F8FAFC" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
              Final Output
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 20, fontWeight: 300, color: "#1a2332", fontFamily: "serif", lineHeight: 1 }}>=</span>
              <MetricBlock
                metric={{
                  id: targetMetric.id, label: targetMetric.label, icon: targetMetric.icon,
                  color: targetMetric.color, value: liveFormatted ?? "...",
                  metricType: targetMetric.metricType, currencySymbol: targetMetric.currencySymbol,
                  modal: targetMetric.modal, history: targetMetric.history, equation: targetMetric.equation,
                }}
                onClick={() => {}} onDragStart={() => {}} onDragEnter={() => {}} onDrop={() => {}} isDragOver={false} disableDrag
              />
            </div>
          </div>
        )}
        <div style={{ borderTop: "1px solid #e2e8f0", padding: isMobile ? "12px 16px" : "16px 24px", flexShrink: 0, background: "#F8FAFC", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          {onSaveDraft && (
            <button onClick={handleSaveDraft}
              style={{
                padding: isMobile ? "10px 18px" : "12px 24px", borderRadius: 8, border: "1.5px solid #3B82F6",
                background: "#fff", color: "#3B82F6",
                fontSize: isMobile ? 13 : 14, fontWeight: 600, cursor: "pointer",
              }}>
              Save Draft
            </button>
          )}
          <button onClick={handleSave} disabled={!equationValid}
            style={{
              padding: isMobile ? "10px 24px" : "12px 32px", borderRadius: 8, border: "none",
              background: equationValid ? "linear-gradient(135deg,#3B82F6,#06B6D4)" : "#e2e8f0",
              color: equationValid ? "#fff" : "#94a3b8",
              fontSize: isMobile ? 13 : 14, fontWeight: 600, cursor: equationValid ? "pointer" : "not-allowed",
            }}>
            Save Equation
          </button>
        </div>
      </div>

      {!isMobile && targetMetric && steps.length > 0 && (
        <div style={{ flex: 1, maxWidth: "25%", minWidth: 220, background: "#F8FAFC", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "20px 20px", borderBottom: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Final Output
            </div>
          </div>
          <div style={{ flex: 1, padding: "24px 20px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
            <span style={{ fontSize: 32, fontWeight: 300, color: "#1a2332", fontFamily: "serif", lineHeight: 1 }}>=</span>
            <MetricBlock
              metric={{
                id: targetMetric.id, label: targetMetric.label, icon: targetMetric.icon,
                color: targetMetric.color, value: liveFormatted ?? "...",
                metricType: targetMetric.metricType, currencySymbol: targetMetric.currencySymbol,
                modal: targetMetric.modal, history: targetMetric.history, equation: targetMetric.equation,
              }}
              onClick={() => {}} onDragStart={() => {}} onDragEnter={() => {}} onDrop={() => {}} isDragOver={false} disableDrag
            />
          </div>
        </div>
      )}
    </div>
  );
}

export { EquationBuilderPage };
