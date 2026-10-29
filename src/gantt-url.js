// Linear has no /gantt page, so its router must never see a project's /gantt address. This runs
// before Linear's scripts and its listeners run before theirs: it swaps /gantt for the project's
// overview and asks the adapter (via OPEN_KEY) to open the chart.
const GANTT_PATH = /^(\/[^/]+\/project\/[^/]+)\/gantt\/?$/;
const OPEN_KEY = 'linear-gantt:open';

function leaveGanttPath() {
  const match = GANTT_PATH.exec(location.pathname);
  if (!match) return;
  sessionStorage.setItem(OPEN_KEY, match[1]);
  history.replaceState(history.state, '', `${match[1]}/overview${location.search}${location.hash}`);
}

sessionStorage.removeItem(OPEN_KEY);
leaveGanttPath();
addEventListener('popstate', leaveGanttPath);
globalThis.navigation?.addEventListener('navigate', event => {
  const url = new URL(event.destination.url);
  if (url.origin === location.origin && GANTT_PATH.test(url.pathname)) event.stopImmediatePropagation();
});
