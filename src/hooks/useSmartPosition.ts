import { useState, useLayoutEffect, RefObject } from "react";

interface SmartPositionOptions {
  top?: number;
  margin?: number;
  alignRight?: boolean;
}

export function useSmartPosition(
  triggerRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
  isOpen: boolean,
  options: SmartPositionOptions = {}
) {
  const defaultTop = options.top ?? 36;
  const margin = options.margin ?? 8;
  const alignRight = options.alignRight !== false;

  const [style, setStyle] = useState<{
    position: "absolute";
    top: number;
    right?: number;
    left?: number;
    visibility: "hidden" | "visible";
  }>({
    position: "absolute",
    top: defaultTop,
    right: alignRight ? 0 : undefined,
    left: alignRight ? undefined : 0,
    visibility: "hidden",
  });

  useLayoutEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;

    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const menuWidth = menuRect.width || (menu.offsetWidth || 160);
    const menuHeight = menuRect.height || (menu.offsetHeight || 100);

    let top = defaultTop;
    let left: number | undefined;
    let rightVal: number | undefined;

    if (alignRight) {
      rightVal = 0;
      const expectedLeftEdge = triggerRect.right - menuWidth;
      if (expectedLeftEdge < margin) {
        rightVal = undefined;
        left = 0;
      }
    } else {
      left = 0;
      const expectedRightEdge = triggerRect.left + menuWidth;
      if (expectedRightEdge > window.innerWidth - margin) {
        left = undefined;
        rightVal = 0;
      }
    }

    const expectedBottom = triggerRect.top + defaultTop + menuHeight;
    if (expectedBottom > window.innerHeight - margin) {
      top = -(menuHeight + 4);
    }

    setStyle({
      position: "absolute",
      top,
      right: rightVal,
      left,
      visibility: "visible",
    });
  }, [isOpen, triggerRef, menuRef, defaultTop, margin, alignRight]);

  return { style, setStyle };
}
