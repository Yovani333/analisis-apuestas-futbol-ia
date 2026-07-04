import test from "node:test";
import assert from "node:assert/strict";
import { collapseGuideModules } from "../public/guide-state.js";
import { setTooltipPopoverOpen } from "../public/info-tooltip.js";

function button() {
  const classes = new Set(["button--ready"]);
  const attributes = new Map([["aria-expanded", "true"]]);
  return {
    textContent: "Ocultar",
    classList: { remove: (value) => classes.delete(value), contains: (value) => classes.has(value) },
    setAttribute: (key, value) => attributes.set(key, value),
    getAttribute: (key) => attributes.get(key)
  };
}

test("una búsqueda nueva cierra módulos y limpia botones heredados", () => {
  const details = [{ open: true }, { open: true }];
  const content = { hidden: false };
  const control = button();
  collapseGuideModules({ details, parts: [{ contents: () => [content], buttons: () => [control] }] });
  assert.equal(details.every((item) => item.open === false), true);
  assert.equal(content.hidden, true);
  assert.equal(control.textContent, "Mostrar");
  assert.equal(control.getAttribute("aria-expanded"), "false");
  assert.equal(control.classList.contains("button--ready"), false);
});

test("el tooltip usa la capa popover al abrirse dentro de un diálogo", () => {
  let topLayer = false;
  const popover = {
    hidden: true,
    matches: () => topLayer,
    showPopover: () => { topLayer = true; },
    hidePopover: () => { topLayer = false; }
  };
  setTooltipPopoverOpen(popover, true);
  assert.equal(popover.hidden, false);
  assert.equal(topLayer, true);
  setTooltipPopoverOpen(popover, false);
  assert.equal(popover.hidden, true);
  assert.equal(topLayer, false);
});
