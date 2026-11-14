/**
 * Explicit `copy to…` menu (F4 IA, DESIGN §8; D47).
 *
 * Replaces the armed-mode button: opening the menu moves focus in, Escape or
 * an outside click closes it and returns focus, arrows move between the lane
 * items, and the copy itself is one `copyLane` transaction (the live region
 * reports the destination state). The copy belongs to the rack, not the lane.
 *
 * D43/D46: items are labelled and identified by their stable lane key, and the
 * list is built from the **live** lane set on every open, so adding or deleting
 * lanes keeps the menu truthful.
 *
 * D47: the menu is no longer bound to one module-global button and the focused
 * lane. Each pane head in the stage bar owns an opener, so `open(anchor,
 * sourceLane)` takes both: the source lane is the pane's lane (not necessarily
 * the globally focused one), items exclude that source lane, and the accessible
 * name says `copy lane <source> to`. Focus-in, arrow keys, Home/End, Esc,
 * outside click, resize close, return focus and the copy transaction are the
 * same as before.
 */

import { S, liveLaneKeys } from "../state/instrument.ts";

export function createCopyMenu(deps) {
  const { store, onCopy } = deps;

  const menu = document.createElement("div");
  menu.className = "copy-menu";
  menu.id = "copyMenu";
  menu.hidden = true;
  menu.setAttribute("role", "menu");

  let items = [];
  let open = false;
  let anchorEl = null;
  let sourceLane = null;

  function rebuildItems() {
    menu.textContent = "";
    const destinations = liveLaneKeys().filter((key) => key !== sourceLane);
    items = destinations.map((key) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "op";
      item.setAttribute("role", "menuitem");
      item.setAttribute("tabindex", "-1");
      item.dataset.lane = key;
      item.textContent = `lane ${key}`;
      item.title = `Copy lane ${sourceLane} into lane ${key}`;
      item.addEventListener("click", () => activate(key));
      menu.appendChild(item);
      return item;
    });
    return destinations;
  }

  document.body.appendChild(menu);

  function position() {
    menu.hidden = false;
    const r = anchorEl.getBoundingClientRect();
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    let top = r.bottom + 4;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function focusItem(index) {
    if (items.length === 0) return;
    const n = items.length;
    items[((index % n) + n) % n].focus();
  }

  /** Open the menu for `sourceLane`, anchored under the pane-head opener. */
  function openMenu(anchor, lane) {
    if (!anchor || !lane) return;
    if (open) closeMenu(false);
    sourceLane = lane;
    /* Nothing to copy into when the lane set holds a single lane. */
    if (rebuildItems().length === 0) return;
    anchorEl = anchor;
    open = true;
    store.patch(() => { S.copyArmed = true; });
    menu.dataset.sourceLane = sourceLane;
    menu.setAttribute("aria-label", `copy lane ${sourceLane} to`);
    menu.hidden = false;
    position();
    anchorEl.setAttribute("aria-expanded", "true");
    anchorEl.setAttribute("aria-controls", menu.id);
    anchorEl.classList.add("on");
    focusItem(0);
    document.addEventListener("pointerdown", onOutside, true);
    window.addEventListener("resize", onResize);
  }

  function closeMenu(refocus = true) {
    if (!open) return;
    open = false;
    menu.hidden = true;
    if (anchorEl) {
      anchorEl.setAttribute("aria-expanded", "false");
      anchorEl.removeAttribute("aria-controls");
      anchorEl.classList.remove("on");
    }
    document.removeEventListener("pointerdown", onOutside, true);
    window.removeEventListener("resize", onResize);
    if (S.copyArmed) store.patch(() => { S.copyArmed = false; });
    const target = anchorEl;
    anchorEl = null;
    sourceLane = null;
    if (refocus && target && target.isConnected) target.focus();
  }

  function activate(key) {
    const src = sourceLane;
    const target = anchorEl;
    closeMenu(false);
    if (src && key !== src) onCopy(src, key);
    if (target && target.isConnected) target.focus();
  }

  function onOutside(event) {
    if (event.target === anchorEl || menu.contains(event.target)) return;
    closeMenu(false);
  }

  function onResize() {
    closeMenu(false);
  }

  menu.addEventListener("keydown", (event) => {
    const index = items.indexOf(document.activeElement);
    if (event.key === "ArrowDown") { event.preventDefault(); focusItem(index + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); focusItem(index - 1); }
    else if (event.key === "Home") { event.preventDefault(); focusItem(0); }
    else if (event.key === "End") { event.preventDefault(); focusItem(items.length - 1); }
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    } else if (event.key === "Tab") {
      closeMenu(false);
    }
  });

  return {
    open: openMenu,
    close: closeMenu,
    isOpen: () => open,
    isOpenFor: (anchor) => open && anchorEl === anchor,
    sourceLane: () => sourceLane,
  };
}
