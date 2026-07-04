export function resetModuleButton(button) {
  if (!button) return;
  button.textContent = "Mostrar";
  button.setAttribute("aria-expanded", "false");
  button.classList.remove("button--ready");
}

export function collapseGuideModules({ details = [], parts = [], extraContents = [], extraButtons = [] } = {}) {
  for (const item of details) item.open = false;
  for (const part of parts) {
    for (const content of part.contents()) if (content) content.hidden = true;
    for (const button of part.buttons()) resetModuleButton(button);
  }
  for (const content of extraContents) if (content) content.hidden = true;
  for (const button of extraButtons) resetModuleButton(button);
}
