import { TOOLTIP_DEFINITIONS, tooltipKeyForLabel } from "./tooltip-definitions.js";

const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
})[character]);

export function infoTooltip(key, accessibleLabel = "") {
  const definition = TOOLTIP_DEFINITIONS[key];
  if (!definition) return "";
  const label = accessibleLabel || `Información sobre ${definition.title}`;
  return `<button class="info-tooltip" type="button" data-tooltip-key="${escapeHtml(key)}" aria-label="${escapeHtml(label)}" aria-expanded="false">?</button>`;
}

export function labelWithTooltip(label, explicitKey = null) {
  const key = explicitKey || tooltipKeyForLabel(label);
  return key ? `<span class="term-with-help">${escapeHtml(label)}${infoTooltip(key)}</span>` : escapeHtml(label);
}

export function setTooltipPopoverOpen(popover, open) {
  if (open) {
    popover.hidden = false;
    if (typeof popover.showPopover === "function" && !popover.matches(":popover-open")) popover.showPopover();
    return;
  }
  if (typeof popover.hidePopover === "function" && popover.matches(":popover-open")) popover.hidePopover();
  popover.hidden = true;
}

export function initializeInfoTooltips(root = document) {
  if (root.querySelector("#info-tooltip-popover")) return;
  const popover = document.createElement("aside");
  popover.id = "info-tooltip-popover";
  popover.className = "info-tooltip-popover";
  popover.setAttribute("role", "tooltip");
  popover.setAttribute("popover", "manual");
  popover.hidden = true;
  document.body.append(popover);
  let activeTrigger = null;
  let closeTimer = null;
  let pinnedByClick = false;

  const position = () => {
    if (!activeTrigger || popover.hidden) return;
    const trigger = activeTrigger.getBoundingClientRect();
    const box = popover.getBoundingClientRect();
    const margin = 10;
    const left = Math.max(margin, Math.min(trigger.left + trigger.width / 2 - box.width / 2, window.innerWidth - box.width - margin));
    const below = trigger.bottom + margin;
    const top = below + box.height <= window.innerHeight - margin ? below : Math.max(margin, trigger.top - box.height - margin);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  };

  const close = () => {
    if (activeTrigger) activeTrigger.setAttribute("aria-expanded", "false");
    activeTrigger = null;
    pinnedByClick = false;
    setTooltipPopoverOpen(popover, false);
  };

  const open = (trigger, pinned = false) => {
    const definition = TOOLTIP_DEFINITIONS[trigger?.dataset.tooltipKey];
    if (!definition) return;
    if (activeTrigger && activeTrigger !== trigger) activeTrigger.setAttribute("aria-expanded", "false");
    activeTrigger = trigger;
    pinnedByClick = pinned;
    trigger.setAttribute("aria-expanded", "true");
    popover.innerHTML = `<strong>${escapeHtml(definition.title)}</strong><p>${escapeHtml(definition.meaning)}</p><dl><div><dt>Uso</dt><dd>${escapeHtml(definition.use)}</dd></div><div><dt>Interpretación</dt><dd>${escapeHtml(definition.interpretation)}</dd></div></dl><small>${escapeHtml(definition.warning)}</small>`;
    setTooltipPopoverOpen(popover, true);
    requestAnimationFrame(position);
  };

  root.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-tooltip-key]");
    if (trigger) {
      event.preventDefault();
      event.stopPropagation();
      open(trigger, true);
      return;
    }
    if (!event.target.closest("#info-tooltip-popover")) close();
  });
  root.addEventListener("pointerover", (event) => {
    if (event.pointerType === "touch") return;
    const trigger = event.target.closest("[data-tooltip-key]");
    if (trigger) { clearTimeout(closeTimer); if (activeTrigger !== trigger || popover.hidden) open(trigger); }
  });
  root.addEventListener("pointerout", (event) => {
    if (event.pointerType === "touch" || pinnedByClick || !event.target.closest("[data-tooltip-key]")) return;
    closeTimer = setTimeout(close, 160);
  });
  root.addEventListener("focusin", (event) => { const trigger = event.target.closest("[data-tooltip-key]"); if (trigger && (activeTrigger !== trigger || popover.hidden)) open(trigger); });
  root.addEventListener("focusout", (event) => { if (!pinnedByClick && event.target.closest("[data-tooltip-key]")) closeTimer = setTimeout(close, 120); });
  popover.addEventListener("pointerenter", () => clearTimeout(closeTimer));
  popover.addEventListener("pointerleave", () => { if (!pinnedByClick) closeTimer = setTimeout(close, 120); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
  window.addEventListener("resize", position);
  window.addEventListener("scroll", position, true);
}
