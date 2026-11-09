"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from "react";
import { createPortal } from "react-dom";

export type BrandedSelectOption<T extends string = string> = {
  id: T;
  label: string;
  /** Optional secondary description or subtitle shown in the menu (and optionally in the trigger). */
  detail?: string;
  /** Optional compact pill/badge shown on the right side of the option row. */
  badge?: string;
  disabled?: boolean;
};

export type BrandedSelectProps<T extends string = string> = {
  value: T;
  options: readonly BrandedSelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  disabled?: boolean;
  className?: string;
  size?: "compact" | "default";
  placeholder?: string;
  /** Whether to show `option.detail` inline inside the closed trigger button when present. */
  showDetailInTrigger?: boolean;
  /** Whether to show `option.badge` inline inside the closed trigger button when present (default true). */
  showBadgeInTrigger?: boolean;
  id?: string;
};

type MenuPosition = {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: "bottom" | "top";
};

function findNextEnabledIndex<T extends string>(
  options: readonly BrandedSelectOption<T>[],
  startIndex: number,
  step: 1 | -1
): number {
  const len = options.length;
  if (len === 0) return -1;
  let idx = startIndex;
  for (let i = 0; i < len; i++) {
    idx = (idx + step + len) % len;
    if (!options[idx]?.disabled) return idx;
  }
  return -1;
}

function findFirstEnabledIndex<T extends string>(options: readonly BrandedSelectOption<T>[]): number {
  return options.findIndex((opt) => !opt.disabled);
}

function findLastEnabledIndex<T extends string>(options: readonly BrandedSelectOption<T>[]): number {
  for (let i = options.length - 1; i >= 0; i--) {
    if (!options[i]?.disabled) return i;
  }
  return -1;
}

export function BrandedSelect<T extends string = string>({
  value,
  options,
  onChange,
  ariaLabel,
  ariaLabelledBy,
  disabled = false,
  className = "",
  size = "compact",
  placeholder = "Select…",
  showDetailInTrigger = false,
  showBadgeInTrigger = true,
  id
}: BrandedSelectProps<T>) {
  const reactId = useId();
  const baseId = id ?? `gm-select-${reactId.replace(/:/g, "")}`;
  const listboxId = `${baseId}-listbox`;

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  const typeaheadRef = useRef<{ buffer: string; timer: number | null }>({ buffer: "", timer: null });

  const selectedIndex = useMemo(
    () => options.findIndex((opt) => opt.id === value),
    [options, value]
  );
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const computePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === "undefined") return;
    const rect = trigger.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;
    const gap = 5;
    const estimatedRowHeight = size === "compact" ? 36 : 40;
    const estimatedHeight = Math.min(264, Math.max(88, options.length * estimatedRowHeight + 12));

    const spaceBelow = vh - rect.bottom - margin - gap;
    const spaceAbove = rect.top - margin - gap;
    const placeTop = spaceBelow < Math.min(estimatedHeight, 180) && spaceAbove > spaceBelow;

    const minWidth = Math.max(rect.width, size === "compact" ? 156 : 196);
    const width = Math.min(Math.max(rect.width, minWidth), vw - margin * 2);
    const left = Math.max(margin, Math.min(rect.left, vw - width - margin));

    if (placeTop) {
      setPosition({
        bottom: Math.max(margin, vh - rect.top + gap),
        left,
        width,
        maxHeight: Math.max(96, Math.min(264, spaceAbove)),
        placement: "top"
      });
    } else {
      setPosition({
        top: Math.max(margin, rect.bottom + gap),
        left,
        width,
        maxHeight: Math.max(96, Math.min(264, spaceBelow)),
        placement: "bottom"
      });
    }
  }, [options.length, size]);

  const openMenu = useCallback(
    (initialIdx?: number) => {
      if (disabled || options.length === 0) return;
      const targetIdx =
        initialIdx !== undefined && initialIdx >= 0 && !options[initialIdx]?.disabled
          ? initialIdx
          : selectedIndex >= 0 && !options[selectedIndex]?.disabled
            ? selectedIndex
            : findFirstEnabledIndex(options);
      setActiveIndex(targetIdx);
      computePosition();
      setOpen(true);
    },
    [computePosition, disabled, options, selectedIndex]
  );

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => {
        triggerRef.current?.focus();
      });
    }
  }, []);

  const commitOption = useCallback(
    (index: number) => {
      const opt = options[index];
      if (!opt || opt.disabled) return;
      if (opt.id !== value) {
        onChange(opt.id);
      }
      closeMenu(true);
    },
    [closeMenu, onChange, options, value]
  );

  useLayoutEffect(() => {
    if (!open) return;
    computePosition();
    const handleViewport = () => computePosition();
    window.addEventListener("resize", handleViewport);
    window.addEventListener("scroll", handleViewport, true);
    return () => {
      window.removeEventListener("resize", handleViewport);
      window.removeEventListener("scroll", handleViewport, true);
    };
  }, [open, computePosition]);

  useEffect(() => {
    if (!open) return;
    const node = optionRefs.current[activeIndex];
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "nearest" });
    }
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

  useEffect(() => {
    const state = typeaheadRef.current;
    return () => {
      if (state.timer !== null) window.clearTimeout(state.timer);
    };
  }, []);

  const handleTypeahead = (char: string) => {
    const state = typeaheadRef.current;
    if (state.timer !== null) window.clearTimeout(state.timer);
    state.buffer += char.toLowerCase();
    state.timer = window.setTimeout(() => {
      state.buffer = "";
      state.timer = null;
    }, 500);

    const query = state.buffer;
    const startFrom = open && activeIndex >= 0 ? activeIndex : selectedIndex >= 0 ? selectedIndex : -1;
    const len = options.length;
    for (let offset = 1; offset <= len; offset++) {
      const idx = (startFrom + offset) % len;
      const candidate = options[idx];
      if (!candidate || candidate.disabled) continue;
      if (candidate.label.toLowerCase().startsWith(query)) {
        if (open) {
          setActiveIndex(idx);
        } else {
          openMenu(idx);
        }
        return;
      }
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const { key } = event;

    if (key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        openMenu();
      } else {
        const next = findNextEnabledIndex(options, activeIndex >= 0 ? activeIndex : -1, 1);
        if (next >= 0) setActiveIndex(next);
      }
      return;
    }

    if (key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openMenu(selectedIndex >= 0 ? selectedIndex : findLastEnabledIndex(options));
      } else {
        const prev = findNextEnabledIndex(options, activeIndex >= 0 ? activeIndex : 0, -1);
        if (prev >= 0) setActiveIndex(prev);
      }
      return;
    }

    if (key === "Home") {
      if (!open) return;
      event.preventDefault();
      const first = findFirstEnabledIndex(options);
      if (first >= 0) setActiveIndex(first);
      return;
    }

    if (key === "End") {
      if (!open) return;
      event.preventDefault();
      const last = findLastEnabledIndex(options);
      if (last >= 0) setActiveIndex(last);
      return;
    }

    if (key === "Enter" || key === " ") {
      event.preventDefault();
      if (!open) {
        openMenu();
      } else if (activeIndex >= 0) {
        commitOption(activeIndex);
      }
      return;
    }

    if (key === "Escape") {
      if (!open) return;
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }

    if (key === "Tab") {
      if (open) setOpen(false);
      return;
    }

    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      handleTypeahead(key);
    }
  };

  const handleTriggerClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    // Guard against synthetic clicks originating inside the portaled menu when wrapped in a <label>
    if (menuRef.current && menuRef.current.contains(event.target as Node)) return;
    if (open) {
      closeMenu(false);
    } else {
      openMenu();
    }
  };

  const activeOptionId = open && activeIndex >= 0 ? `${baseId}-opt-${activeIndex}` : undefined;

  return (
    <>
      <button
        ref={triggerRef}
        id={baseId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        disabled={disabled}
        className={`gm-select-trigger gm-select-${size}${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}
        onClick={handleTriggerClick}
        onKeyDown={handleKeyDown}
      >
        <span className="gm-select-value">
          <span className="gm-select-label">{selectedOption ? selectedOption.label : placeholder}</span>
          {showDetailInTrigger && selectedOption?.detail && (
            <span className="gm-select-inline-detail">· {selectedOption.detail}</span>
          )}
          {showBadgeInTrigger && selectedOption?.badge && (
            <span className="gm-select-inline-badge">{selectedOption.badge}</span>
          )}
        </span>
        <svg
          className="gm-select-chevron"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          aria-hidden="true"
        >
          <path
            d="M2.5 4.5L6 8L9.5 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.65"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open &&
        position &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            className={`gm-select-popover gm-select-popover-${size} gm-select-place-${position.placement}`}
            style={{
              position: "fixed",
              left: `${position.left}px`,
              width: `${position.width}px`,
              maxHeight: `${position.maxHeight}px`,
              ...(position.top !== undefined ? { top: `${position.top}px` } : {}),
              ...(position.bottom !== undefined ? { bottom: `${position.bottom}px` } : {})
            }}
            onMouseDown={(event) => {
              // Keep focus on the combobox trigger while interacting with options
              event.preventDefault();
            }}
            onClick={(event) => {
              // Prevent bubbling to outer <label> wrappers
              event.stopPropagation();
            }}
          >
            {options.map((option, index) => {
              const isSelected = option.id === value;
              const isActive = index === activeIndex;
              return (
                <div
                  key={option.id}
                  ref={(el) => {
                    optionRefs.current[index] = el;
                  }}
                  id={`${baseId}-opt-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  className={`gm-select-option${isSelected ? " is-selected" : ""}${isActive ? " is-active" : ""}${option.disabled ? " is-disabled" : ""}`}
                  onMouseEnter={() => {
                    if (!option.disabled) setActiveIndex(index);
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!option.disabled) commitOption(index);
                  }}
                >
                  <div className="gm-select-option-copy">
                    <span className="gm-select-option-label">{option.label}</span>
                    {option.detail && <small className="gm-select-option-detail">{option.detail}</small>}
                  </div>
                  <div className="gm-select-option-meta">
                    {option.badge && <span className="gm-select-option-badge">{option.badge}</span>}
                    <span className="gm-select-check" aria-hidden="true">
                      {isSelected ? "✓" : ""}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
