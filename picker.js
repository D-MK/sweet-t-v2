const ITEM_HEIGHT = 44;
const VISIBLE_PAD_ROWS = 2;

export function openWheelPicker({ min, max, step = 1, value, label, onPick }) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
    throw new Error("openWheelPicker: invalid range");
  }
  if (typeof onPick !== "function") {
    throw new Error("openWheelPicker: onPick is required");
  }

  const values = [];
  for (let v = min; v <= max; v += step) values.push(v);

  const startValue =
    Number.isFinite(value) && value >= min && value <= max ? value : min;
  let currentIndex = values.indexOf(startValue);
  if (currentIndex < 0) currentIndex = 0;

  const overlay = document.createElement("div");
  overlay.className = "wheel-picker";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  if (label) overlay.setAttribute("aria-label", label);

  const sheet = document.createElement("div");
  sheet.className = "wheel-picker-sheet";

  const header = document.createElement("div");
  header.className = "wheel-picker-header";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "wheel-picker-cancel ghost";
  cancelBtn.textContent = "Cancel";

  const title = document.createElement("div");
  title.className = "wheel-picker-title";
  title.textContent = label || "";

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "wheel-picker-confirm primary";
  confirmBtn.textContent = "Done";

  header.append(cancelBtn, title, confirmBtn);

  const wheel = document.createElement("div");
  wheel.className = "wheel-picker-wheel";

  const column = document.createElement("div");
  column.className = "wheel-picker-column";
  column.setAttribute("role", "listbox");
  if (label) column.setAttribute("aria-label", label);
  column.tabIndex = 0;

  const padTop = document.createElement("div");
  padTop.className = "wheel-picker-pad";
  padTop.setAttribute("aria-hidden", "true");
  column.appendChild(padTop);

  for (const v of values) {
    const item = document.createElement("div");
    item.className = "wheel-picker-item";
    item.dataset.value = String(v);
    item.textContent = String(v);
    item.setAttribute("role", "option");
    column.appendChild(item);
  }

  const padBottom = document.createElement("div");
  padBottom.className = "wheel-picker-pad";
  padBottom.setAttribute("aria-hidden", "true");
  column.appendChild(padBottom);

  const highlight = document.createElement("div");
  highlight.className = "wheel-picker-highlight";
  highlight.setAttribute("aria-hidden", "true");

  wheel.append(column, highlight);
  sheet.append(header, wheel);
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  function markSelected(idx) {
    const items = column.querySelectorAll(".wheel-picker-item");
    items.forEach((el, i) => {
      const isSel = i === idx;
      el.classList.toggle("is-selected", isSel);
      el.setAttribute("aria-selected", isSel ? "true" : "false");
    });
  }

  function indexFromScroll() {
    const idx = Math.round(column.scrollTop / ITEM_HEIGHT);
    return Math.max(0, Math.min(values.length - 1, idx));
  }

  function scrollToIndex(idx, behavior = "auto") {
    column.scrollTo({ top: idx * ITEM_HEIGHT, behavior });
  }

  let scrollIdleTimer = null;
  function onScroll() {
    currentIndex = indexFromScroll();
    markSelected(currentIndex);
    clearTimeout(scrollIdleTimer);
    scrollIdleTimer = setTimeout(() => {
      const snapped = currentIndex * ITEM_HEIGHT;
      if (Math.abs(column.scrollTop - snapped) > 0.5) {
        scrollToIndex(currentIndex, "smooth");
      }
    }, 120);
  }

  function onItemClick(e) {
    const item = e.target.closest(".wheel-picker-item");
    if (!item) return;
    const idx = values.indexOf(Number(item.dataset.value));
    if (idx < 0) return;
    currentIndex = idx;
    scrollToIndex(idx, "smooth");
  }

  function close() {
    clearTimeout(scrollIdleTimer);
    column.removeEventListener("scroll", onScroll);
    column.removeEventListener("click", onItemClick);
    cancelBtn.removeEventListener("click", onCancel);
    confirmBtn.removeEventListener("click", onConfirm);
    overlay.removeEventListener("click", onBackdropClick);
    document.removeEventListener("keydown", onKey);
    document.body.style.overflow = prevOverflow;
    overlay.remove();
  }

  function commit() {
    const picked = values[currentIndex];
    close();
    if (picked === 0) {
      onPick(null);
    } else {
      onPick(picked);
    }
  }

  function onConfirm() {
    commit();
  }

  function onCancel() {
    close();
  }

  function onBackdropClick(e) {
    if (e.target === overlay) close();
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      currentIndex = Math.min(values.length - 1, currentIndex + 1);
      scrollToIndex(currentIndex, "smooth");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      currentIndex = Math.max(0, currentIndex - 1);
      scrollToIndex(currentIndex, "smooth");
    } else if (e.key === "PageDown") {
      e.preventDefault();
      currentIndex = Math.min(values.length - 1, currentIndex + 5);
      scrollToIndex(currentIndex, "smooth");
    } else if (e.key === "PageUp") {
      e.preventDefault();
      currentIndex = Math.max(0, currentIndex - 5);
      scrollToIndex(currentIndex, "smooth");
    } else if (e.key === "Home") {
      e.preventDefault();
      currentIndex = 0;
      scrollToIndex(currentIndex, "smooth");
    } else if (e.key === "End") {
      e.preventDefault();
      currentIndex = values.length - 1;
      scrollToIndex(currentIndex, "smooth");
    }
  }

  column.addEventListener("scroll", onScroll, { passive: true });
  column.addEventListener("click", onItemClick);
  cancelBtn.addEventListener("click", onCancel);
  confirmBtn.addEventListener("click", onConfirm);
  overlay.addEventListener("click", onBackdropClick);
  document.addEventListener("keydown", onKey);

  markSelected(currentIndex);
  requestAnimationFrame(() => {
    scrollToIndex(currentIndex, "auto");
    column.focus({ preventScroll: true });
  });
}

export const WHEEL_PAD_ROWS = VISIBLE_PAD_ROWS;
export const WHEEL_ITEM_HEIGHT = ITEM_HEIGHT;
