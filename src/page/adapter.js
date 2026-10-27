// Everything that depends on Linear's page structure lives in this file.
import { parseProjectPath } from '../project-url.js';

const MARK = 'data-linear-gantt';
const PANEL_URL = chrome.runtime.getURL('panel.html');
const EXTENSION_ORIGIN = new URL(PANEL_URL).origin;
const STYLE_KEYS = ['color', 'background-color', 'box-shadow', 'border-color', 'font-weight', 'opacity'];
const HEADER_MAX_HEIGHT = 120;
const Z_INDEX = 30;

let view = null; // State for the project page currently shown.
let timer = null;
let observer = null;
let themeObserver = null;

export function start() {
  // A reloaded extension leaves its old elements behind; the old copy tears itself down.
  for (const node of document.querySelectorAll(`[${MARK}]`)) node.remove();
  observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  themeObserver = new MutationObserver(schedule);
  for (const root of [document.documentElement, document.body]) themeObserver.observe(root, { attributes: true });
  addEventListener('resize', schedule);
  addEventListener('message', onFrameMessage);
  document.addEventListener('click', onDocumentClick, true);
  globalThis.navigation?.addEventListener('currententrychange', schedule);
  update();
}

function teardown() {
  observer?.disconnect();
  themeObserver?.disconnect();
  clearTimeout(timer);
  removeEventListener('resize', schedule);
  removeEventListener('message', onFrameMessage);
  document.removeEventListener('click', onDocumentClick, true);
  globalThis.navigation?.removeEventListener('currententrychange', schedule);
  removeView();
}

function schedule() {
  timer ??= setTimeout(update, 50);
}

function update() {
  timer = null;
  if (!chrome.runtime?.id) return teardown();
  const route = parseProjectPath(location.pathname);
  const id = route && `${route.workspace}/${route.key}`;
  if (view && view.id !== id) removeView();
  if (!route) return;
  view ??= { id, route, path: location.pathname, nav: null, tab: null, host: null, frame: null, open: false, saved: null, theme: null };
  if (view.path !== location.pathname) {
    view.path = location.pathname;
    close();
  }
  const nav = findProjectNav(route);
  if (!nav) {
    view.tab?.remove();
    view.tab = null;
    view.nav = null;
    return close();
  }
  view.nav = nav;
  if (!view.tab?.isConnected || view.tab.previousElementSibling !== nav.items.at(-1)) insertTab(nav);
  syncTheme();
  if (view.open) position();
}

function removeView() {
  if (!view) return;
  restoreNativeTab();
  view.tab?.remove();
  view.host?.remove();
  view = null;
}

// The project's tabs (Overview, Issues, saved views) are links to sibling routes of the
// same project, each possibly wrapped in several elements. A tab row is an element whose
// children each hold exactly one such link, to distinct views, side by side on one line.
// Pick the row furthest from the sidebar.
function findProjectNav(route) {
  const groups = new Map();
  for (const link of document.querySelectorAll('a[href*="/project/"]')) {
    if (link.closest(`[${MARK}]`) || !link.getClientRects().length) continue;
    const url = new URL(link.href, location.href);
    const target = url.origin === location.origin && parseProjectPath(url.pathname);
    if (!target?.view || target.workspace !== route.workspace || target.key !== route.key) continue;
    for (let item = link; item.parentElement && item !== document.body; item = item.parentElement) {
      const group = groups.get(item.parentElement) ?? { container: item.parentElement, items: new Map() };
      group.items.set(item, [...(group.items.get(item) ?? []), { link, view: target.view }]);
      groups.set(item.parentElement, group);
    }
  }
  const candidates = [];
  for (const { container, items } of groups.values()) {
    const tabs = [...items.values()];
    if (tabs.length < 2 || tabs.some(links => links.length !== 1)) continue;
    const links = tabs.map(([tab]) => tab.link);
    if (new Set(tabs.map(([tab]) => tab.view)).size !== tabs.length || !onOneLine(links)) continue;
    candidates.push({ container, items: [...items.keys()] });
  }
  candidates.sort((a, b) => b.container.getBoundingClientRect().left - a.container.getBoundingClientRect().left);
  return candidates[0] ?? null;
}

function onOneLine(elements) {
  const middle = element => { const box = element.getBoundingClientRect(); return box.top + box.height / 2; };
  const first = elements[0].getBoundingClientRect();
  return elements.every(element => Math.abs(middle(element) - middle(elements[0])) < first.height / 2);
}

const isActive = item => [item, ...item.querySelectorAll('a')].some(node =>
  node.getAttribute('aria-current') === 'page' || node.getAttribute('aria-selected') === 'true' || node.getAttribute('data-active') === 'true');

// Linear styles the link inside each tab, not the wrappers around it.
const styled = item => item.matches('a') ? item : item.querySelector('a') ?? item;

function insertTab(nav) {
  restoreNativeTab();
  view.tab?.remove();
  const template = nav.items.find(item => !isActive(item)) ?? nav.items.at(-1);
  const tab = template.cloneNode(true);
  for (const node of [tab, ...tab.querySelectorAll('*')]) {
    for (const name of ['href', 'id', 'aria-current', 'aria-selected', 'data-active', 'aria-controls']) node.removeAttribute(name);
  }
  for (const icon of tab.querySelectorAll('svg, img')) icon.remove();
  const texts = [];
  const walker = document.createTreeWalker(tab, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) if (walker.currentNode.nodeValue.trim()) texts.push(walker.currentNode);
  if (texts.length) {
    texts[0].nodeValue = 'Gantt';
    for (const text of texts.slice(1)) text.remove();
  } else {
    tab.textContent = 'Gantt';
  }
  tab.setAttribute(MARK, 'tab');
  tab.setAttribute('role', 'button');
  tab.setAttribute('aria-pressed', 'false');
  tab.tabIndex = 0;
  tab.style.cursor = 'pointer';
  tab.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    open();
  });
  tab.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  });
  nav.items.at(-1).after(tab);
  view.tab = tab;
  view.tabStyle = styled(tab).getAttribute('style');
  if (view.open) setActive();
}

function open() {
  if (!view?.tab) return;
  if (!view.host) createPanel();
  view.open = true;
  view.host.style.display = 'block';
  position();
  setActive();
  view.frame.focus();
}

function close() {
  if (!view?.open) return;
  view.open = false;
  view.host.style.display = 'none';
  resetTabStyles();
  view.tab?.setAttribute('aria-pressed', 'false');
}

function createPanel() {
  const host = document.createElement('div');
  host.setAttribute(MARK, 'panel');
  host.style.cssText = `position:fixed;z-index:${Z_INDEX};display:none;`;
  const frame = document.createElement('iframe');
  frame.title = 'Project Gantt chart';
  frame.style.cssText = 'display:block;width:100%;height:100%;border:0;';
  frame.src = `${PANEL_URL}?${new URLSearchParams({ workspace: view.route.workspace, slug: view.route.slug, theme: theme() })}`;
  // Focus given to the frame before its page loads is lost when the page commits.
  frame.addEventListener('load', () => { if (document.activeElement === host) frame.contentWindow.focus(); });
  host.attachShadow({ mode: 'closed' }).append(frame);
  document.documentElement.append(host);
  view.host = host;
  view.frame = frame;
  view.theme = theme();
}

// Cover the content area below the project header, leaving Linear's sidebar and header usable.
function position() {
  let header = view.nav.container;
  for (let node = header.parentElement; node && node !== document.body; node = node.parentElement) {
    if (node.getBoundingClientRect().height > HEADER_MAX_HEIGHT) break;
    header = node;
  }
  let pane = header.parentElement;
  while (pane && pane !== document.body && pane.getBoundingClientRect().height < innerHeight * 0.6) pane = pane.parentElement;
  const box = header.getBoundingClientRect();
  const bottom = Math.min(pane ? pane.getBoundingClientRect().bottom : innerHeight, innerHeight);
  Object.assign(view.host.style, {
    top: `${box.bottom}px`,
    left: `${box.left}px`,
    width: `${box.width}px`,
    height: `${Math.max(bottom - box.bottom, 0)}px`
  });
}

function snapshotStyle(element) {
  const style = getComputedStyle(element);
  return STYLE_KEYS.map(key => [key, style.getPropertyValue(key)]);
}

// Show Gantt as the selected tab by borrowing the selected native tab's look.
function setActive() {
  view.tab.setAttribute('aria-pressed', 'true');
  const tab = styled(view.tab);
  const item = view.nav.items.find(isActive);
  if (!item) {
    tab.style.boxShadow = 'inset 0 -2px currentColor';
    return;
  }
  const native = styled(item);
  const active = snapshotStyle(native);
  const inactive = snapshotStyle(tab);
  view.saved = { native, style: native.getAttribute('style') };
  for (const [key, value] of active) tab.style.setProperty(key, value);
  for (const [key, value] of inactive) native.style.setProperty(key, value);
}

function restoreNativeTab() {
  if (!view?.saved) return;
  const { native, style } = view.saved;
  if (style === null) native.removeAttribute('style');
  else native.setAttribute('style', style);
  view.saved = null;
}

function resetTabStyles() {
  restoreNativeTab();
  if (!view?.tab) return;
  const tab = styled(view.tab);
  if (view.tabStyle === null) tab.removeAttribute('style');
  else tab.setAttribute('style', view.tabStyle);
}

// Light text means a dark theme. A canvas converts any CSS color (Linear uses lch()) to RGB.
function theme() {
  const context = new OffscreenCanvas(1, 1).getContext('2d');
  context.fillStyle = getComputedStyle(view?.nav?.container ?? document.body).color;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 128 ? 'dark' : 'light';
}

function syncTheme() {
  if (!view.frame) return;
  const next = theme();
  if (next === view.theme) return;
  view.theme = next;
  view.frame.contentWindow?.postMessage({ type: 'linear-gantt:theme', theme: next }, EXTENSION_ORIGIN);
  if (view.open && view.tab) {
    resetTabStyles();
    setActive();
  }
}

function onDocumentClick(event) {
  if (view?.open && view.nav?.container.contains(event.target) && !view.tab?.contains(event.target)) close();
}

function onFrameMessage(event) {
  if (!view?.frame || event.source !== view.frame.contentWindow || event.origin !== EXTENSION_ORIGIN) return;
  if (event.data?.type === 'linear-gantt:focus-tab') view.tab?.focus();
}
