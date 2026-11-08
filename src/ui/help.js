/**
 * Help panel (F4 IA) — the instrument's one declared utility surface.
 *
 * `?` (or the header button) opens it; Escape closes it and focus returns to
 * where it came from. It holds two tabs: the static keyboard map (`keys`) and
 * the agent bridge surface (`agent`). Tabs use the ARIA tabs pattern — one
 * roving tab stop, ArrowLeft/Right (plus Home/End) between tabs, click to
 * activate. The panel is hidden by default, so the default rendered instrument
 * is unchanged.
 */

export function createHelpPanel(deps) {
  const { panel, button, closeButton, onTabChange } = deps;
  let open = false;
  let returnFocus = null;

  const tabs = [...panel.querySelectorAll("[data-agent-tab]")];
  const tabPanels = [...panel.querySelectorAll("[data-agent-panel]")];
  let activeTab = tabs.length ? tabs[0].dataset.agentTab : null;

  function activateTab(name, { focus = false } = {}) {
    const next = tabs.find((tab) => tab.dataset.agentTab === name);
    if (!next) return;
    activeTab = name;
    for (const tab of tabs) {
      const selected = tab === next;
      tab.setAttribute("aria-selected", String(selected));
      tab.setAttribute("tabindex", selected ? "0" : "-1");
      tab.classList.toggle("on", selected);
      if (selected && focus) tab.focus();
    }
    for (const tabPanel of tabPanels) {
      tabPanel.hidden = tabPanel.dataset.agentPanel !== name;
    }
    if (typeof onTabChange === "function") onTabChange(name);
  }

  function show() {
    if (open) return;
    open = true;
    const origin = document.activeElement;
    returnFocus = origin instanceof HTMLElement && origin !== document.body ? origin : button;
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    activateTab(activeTab);
    closeButton.focus();
  }

  function hide(refocus = true) {
    if (!open) return;
    open = false;
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (refocus) {
      const target =
        returnFocus && returnFocus !== document.body && document.contains(returnFocus) ? returnFocus : button;
      target.focus();
    }
    returnFocus = null;
  }

  function toggle() {
    if (open) hide();
    else show();
  }

  button.addEventListener("click", toggle);
  closeButton.addEventListener("click", () => hide());

  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    hide();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "?") return;
    const target = event.target;
    if (target && (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) || target.closest?.("#nibs"))) {
      return;
    }
    event.preventDefault();
    toggle();
  });

  for (const tab of tabs) {
    tab.addEventListener("click", () => activateTab(tab.dataset.agentTab));

    /* ARIA tabs pattern: arrows move and activate, Home/End jump to the ends. */
    tab.addEventListener("keydown", (event) => {
      const index = tabs.indexOf(tab);
      if (index < 0) return;
      let next = -1;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      event.stopPropagation();
      activateTab(tabs[next].dataset.agentTab, { focus: true });
    });
  }

  /* Keep the DOM in step with the declared default even before first open. */
  if (tabs.length) activateTab(activeTab);

  return {
    show,
    hide,
    toggle,
    isOpen: () => open,
    setTab: (name) => activateTab(name),
    activeTab: () => activeTab,
  };
}
