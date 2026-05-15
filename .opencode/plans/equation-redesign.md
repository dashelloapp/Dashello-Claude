# Equation Builder Redesign Plan

## Overview
Comprehensive redesign of the equation builder: simplify the plus menu, add parentheses/fraction symbols, remove total operators, fix step numbering, add keyboard shortcuts.

---

## 1. Simplify Plus Button Menu (3 options)

**Current (lines 3850-3870):** 8 menu items (Add Metric, Add Number, Add Symbol, divider, 4 total operators)

**New menu:**
1. **Metric** — opens metric search (`setForceSearch(true)`)
2. **Number** — calls `handleAddNumberStep()`
3. **Math** — opens the symbol picker grid with 6 buttons

**Changes:**
- Delete Total Operator entries from renderAddMenu (lines 3859-3866)
- Delete the divider line (line 3859)
- "Add Symbol" stays but label can stay as "Math" or "Symbol"
- Keep "Add Metric" and "Add Number" unchanged
- Add a new state or mode for the math picker that shows the extended symbol set

---

## 2. Extended Math Symbol Picker

**Current:** Math picker shows 4 buttons: +, −, ×, ÷ (at lines 4195-4214)

**New math picker with 6 buttons:**
| + | − | × | ÷ |
| ( ) | a/b |

- **+** — inserts operator `+`
- **−** — inserts operator `-`
- **×** — inserts operator `*`
- **÷** — inserts operator `/`
- **( )** — creates an empty paren-group: inserts `{type:"operator", operator:"paren-start"}` and `{type:"operator", operator:"paren-end"}` wrapping nothing, with a plus button inside
- **a/b (fraction)** — creates a fraction structure: takes the next two value-type steps to form numerator/denominator, or creates two empty groups with divide line

**Fraction button HTML (use in the math picker button):**
```html
<span style="display:inline-flex;flex-direction:column;align-items:center;line-height:1">
  <span style="padding:0 4px 2px;border-bottom:2px solid currentColor;font-size:14px">□</span>
  <span style="padding:2px 4px 0;font-size:14px">□</span>
</span>
```
Renders as stacked □ symbols with a horizontal divide line, visually distinct from other buttons.

**Changes:**
- Update `handleSelectOperator` to accept `"paren-start" | "paren-end"` and a new fraction type
- Add handlers: `handleAddParentheses()` and `handleAddFraction()`
- Update the math picker render (around line 4203) to show 6 buttons instead of 4

---

## 3. Remove Total Operators (cleanup)

**Remove all references to:**
- `"total-multiply"`, `"total-divide"`, `"total-add"`, `"total-subtract"` from `EquationStep.operator` type (line 63)
- `handleAddTotalOperator` function (lines 3386-3400)
- Total operator rendering in:
  - `innerRenderGroup` operator display (line 3841)
  - Main sections building (lines 4041-4058)
  - `renderRange` sections building (lines 3913-3929)
  - Total-op rendering in renderRange (lines 3989-4035)
  - Total-op rendering in main sections (lines 4120-4175)
- `evaluateEquation` total operator logic (lines 257-266)
- `buildEquationPreviewString` total operator display (lines 360-363)
- `buildEquationMetricIds` total operator handling (lines 386-389)
- `handleSelectOperator` total map conversion (lines 3357-3364)

---

## 4. Parentheses Symbol Behavior

**New handler `handleAddParentheses()`:**
- If `editingStepIndex !== null` and the step is a placeholder, replace it with paren-start/paren-end pair
- Otherwise, insert at `addAtIndex` (or end of steps):
  - Insert `{ type: "operator", operator: "paren-start" }`
  - Insert `{ type: "operator", operator: "paren-end" }`
  - This creates an empty group with no content (just the markers)

**Visual:** In the preview, a paren group is rendered as a bordered container with a plus button inside (already existing behavior at lines 4066-4098). The group will show empty initially with just a plus button.

**Switching symbols:** When you click on an existing operator step in the preview, you can switch it to parentheses. This replaces the operator with `paren-start/paren-end`.

---

## 5. Fraction Symbol Behavior

**New handler `handleAddFraction()`:**
- If inserting empty: create two empty paren-groups with a divide line between them
  - Numerator: `{type:"operator", operator:"paren-start"}` + `{type:"operator", operator:"paren-end"}`
  - Divide operator: `{type:"operator", operator:"/"}`
  - Denominator: `{type:"operator", operator:"paren-start"}` + `{type:"operator", operator:"paren-end"}`
- Visual: The numerator and denominator each appear as empty groups with plus buttons, separated by a horizontal line

**Extend fraction rendering** (currently lines 3566-3660): Fetches 3 consecutive steps and renders top/metric, operator circle, bottom/metric. Update to render:
- Top: render the numerator group content (via renderRange)
- Divide line (horizontal rule)
- Bottom: render the denominator group content (via renderRange)

**Group detection:** Update `renderGroups` building (lines 3534-3557) to detect fraction patterns differently:
- Instead of just `metric [*|/] metric`, detect: `paren-group [*|/] paren-group` as a fraction
- Or: any sequence wrapped as a fraction with the divide line

---

## 6. Step Numbering (Sequential Left-to-Right)

**Current problem:** `groupIdx` is assigned by render order, NOT by actual step order. Groups inside groups get wrong numbers.

**New approach:** Compute step numbers by recursively walking the steps array left to right, counting only "data point" steps (metric, number, and math operators). Groups (parens, fractions) do NOT get numbers — only the steps *inside* them get numbers.

**Algorithm:**
```
function assignStepNumbers(steps: EquationStep[]): Map<number, number> {
  let counter = 1
  let result = new Map()
  let i = 0
  while (i < steps.length) {
    if (steps[i].type === "operator" && steps[i].operator === "paren-start") {
      // Skip grouping markers, recurse into content
      let depth = 1, j = i + 1
      while (j < steps.length && depth > 0) {
        if (steps[j].operator === "paren-start") depth++
        else if (steps[j].operator === "paren-end") depth--
        if (depth > 0) j++
      }
      // Recurse into paren content
      const innerCounts = assignStepNumbers(steps.slice(i+1, j))
      // Shift counters
      i = j + 1
      continue
    }
    // It's a data point → assign number
    result.set(i, counter++)
    i++
  }
  return result
}
```

**Rendering change:** Instead of using `groupIdx! + 1`, look up the step's index in the `stepNumbers` map and display that number. This applies to ALL numbered icon rendering locations.

The numbered icon circle styling should be **the same blue color** for all types: `background: "linear-gradient(135deg,#3B82F6,#06B6D4)"`.

---

## 7. Keyboard Shortcuts

**Enter key:** Wrap all current steps into a paren-group
- Take `steps` array, wrap entire thing: `[paren-start, ...steps, paren-end]`
- Add a plus button after the closing paren-end

**Shift+Enter:** Wrap all current steps as numerator of a fraction
- Take `steps` array, create fraction: `[paren-start, ...steps, paren-end, {operator: "/"}, paren-start, paren-end]`
- The denominator is an empty group with a plus button

**Implementation:**
- Add `onKeyDown` handler to the search input (lines 4225-4239)
- Check `e.key === "Enter"` and `e.shiftKey`
- Call `handleGroupAll()` or `handleFractionAll()` respectively

---

## 8. Edit Settings Inline/Popup Toggle

**Current:** MetricBoxSettingsModal always renders as a fixed overlay modal.

**New behavior:**
- Add a floating toggle button at the bottom-right of the modal: "Inline" icon (a box arrow icon or similar)
- When toggled, the modal changes from `position: fixed; inset: 0` overlay to an inline panel within the page flow
- Default is popup mode
- After saving and redirecting to home, reset back to popup mode for next use

**State:** Track `isInline` state in the parent component (DashelloDashboard). Pass to MetricBoxSettingsModal.

---

## Implementation Order

1. Remove total operator code (cleanup — removes noise, simplifies remaining work)
2. Simplify plus button menu to 3 items
3. Add parentheses and fraction handlers + math picker buttons
4. Implement sequential step numbering
5. Add keyboard shortcuts
6. Add inline/popup toggle for MetricBoxSettingsModal

## Files to Modify

- **`src/DashelloDashboard.tsx`** — All changes in this single file
- **Types** (EquationStep interface, line 63) — Remove total operators from union
- **Equation evaluation** (lines 257-266) — Remove total operator evaluation branches
- **Equation preview** (lines 360-363, 386-389) — Remove total operator display
- **renderAddMenu** (lines 3850-3870) — Simplify to 3 items
- **handleSelectOperator** (lines 3349-3384) — Remove total op mapping
- **handleAddTotalOperator** (lines 3386-3400) — Delete
- **Sections building** (lines 4041-4058, 3913-3929) — Remove total-op split logic
- **Total-op rendering** (lines 3989-4035, 4120-4175) — Delete
- **innerRenderGroup operator** (line 3841) — Remove total op display
- **renderGroups** (lines 3534-3557) — Update fraction detection
- **Fraction rendering** (lines 3566-3660) — Update to handle paren-group numerator/denominator
- **Numbered icons** (6 locations) — Replace `groupIdx! + 1` with sequential numbering
- **Math picker** (around line 4203) — Add parentheses and fraction buttons
- **Keyboard handler** — Add to search input onKeyDown
- **MetricBoxSettingsModal** (line 1953) — Add inline toggle
