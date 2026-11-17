/**
 * One clock for everything the menus refresh from the server (room lists,
 * friends, server status). A single timer fires every task that is due in the
 * same moment, so a phone's radio wakes once per tick instead of once per
 * request. Nothing is asked while the page is hidden; when it is shown again,
 * every task runs at once so the screen is fresh.
 */

// Every period should be a multiple of this, so tasks fall due together.
const TICK_MS = 5000;
// Timers drift a little; a task this close to due runs now rather than a whole tick late.
const SLACK_MS = 500;

interface Task { run: () => void; every: number; last: number; }

const tasks = new Set<Task>();
let timer: ReturnType<typeof setInterval> | null = null;

function tick(all: boolean) {
  if (document.hidden) return;
  const now = Date.now();
  for (const task of tasks) {
    if (all || now - task.last >= task.every - SLACK_MS) {
      task.last = now;
      task.run();
    }
  }
}

const onVisibility = () => tick(true);

function sync() {
  if (tasks.size && !timer) {
    timer = setInterval(() => tick(false), TICK_MS);
    document.addEventListener("visibilitychange", onVisibility);
  } else if (!tasks.size && timer) {
    clearInterval(timer);
    timer = null;
    document.removeEventListener("visibilitychange", onVisibility);
  }
}

/**
 * Runs `run` now (unless the page is hidden, then as soon as it is shown) and
 * every `every` ms after that while the page is visible. Returns the stop.
 */
export function poll(run: () => void, every: number): () => void {
  const task: Task = { run, every, last: 0 };
  tasks.add(task);
  sync();
  if (!document.hidden) {
    task.last = Date.now();
    run();
  }
  return () => {
    tasks.delete(task);
    sync();
  };
}

/** How often each menu refresh runs. */
export const POLL = {
  /** Public room list, and the duels we still hold a seat in. */
  rooms: 5000,
  /** Friends list. Also how the server knows we are online: keep it well under its 20 s window (onlineWindow in api/friends.go). */
  friends: 10000,
  /** Server status light and bot settings. */
  config: 15000,
} as const;
