import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { closeRoom, createAccount, GAME_URL, listAccounts, listAllRooms, openGrafanaSession, setAccountAdmin, setAccountPassword, type AccountInfo } from "@/net/api";
import type { RoomInfo } from "@/net/protocol";
import { session } from "@/net/session";
import { useMenuStore } from "@/stores/menuStore";
import { useSessionStore } from "@/stores/sessionStore";
import { poll, POLL } from "@/net/poll";
import ArenaPanel from "./ArenaPanel";
import CardsPanel, { type CardDraft } from "./CardsPanel";
import CardLabPanel from "./CardLabPanel";
import DeckAIPanel from "./DeckAIPanel";
import CardScoutPanel from "./CardScoutPanel";

const ghost = " border border-white/25 px-3 py-2 text-sm hover:border-white active:border-yellow-400 disabled:opacity-40 pointer-coarse:min-h-11";
const small = " border border-white/25 px-2 py-1 text-xs hover:border-white disabled:opacity-40 pointer-coarse:min-h-10";
const input = "min-w-0  border border-white/20 bg-black/60 px-2 py-1 text-sm outline-none focus:border-fuchsia-300";

type Notice = { text: string; bad?: boolean; } | null;

const TABS = [
  { id: "accounts", label: "👤 Accounts" },
  { id: "rooms", label: "🏠 Rooms" },
  { id: "arena", label: "⚔️ Arena" },
  { id: "cards", label: "🃏 Cards" },
  { id: "lab", label: "✨ Card Lab" },
  { id: "deckai", label: "🤖 Deck AI" },
  { id: "scout", label: "🔭 Card Scout" },
  { id: "monitoring", label: "📈 Monitoring" },
] as const;
type Tab = (typeof TABS)[number]["id"];
const TAB_KEY = "admin.tab";

/**
 * Keeps an admin page's bug to that page: it shows the error with a way to
 * try again, instead of the whole client going blank.
 */
class PageBoundary extends Component<{ name: string; children: ReactNode; }, { error: Error | null; }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(`admin ${this.props.name} page crashed`, error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex flex-col items-start gap-2 border border-rose-400/40 bg-black/75 p-3 text-sm">
        <p className="font-bold text-rose-300">The {this.props.name} page hit an error.</p>
        <p className="font-mono text-xs text-white/60">{this.state.error.message}</p>
        <p className="text-xs text-white/50">If the server was started before the client was updated, restart it.</p>
        <button className="border border-white/25 px-2 py-1 text-xs hover:border-white" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}

function savedTab(): Tab {
  try {
    const t = localStorage.getItem(TAB_KEY);
    if (TABS.some((x) => x.id === t)) return t as Tab;
  } catch { /* storage unavailable: start on accounts */ }
  return "accounts";
}

/**
 * The administrators' pages, one per tab: accounts (admin access and
 * passwords), rooms, the arena (test games between bots and LLMs), the card
 * editor, the Card Lab (Claude designs cards) and the Card Scout (outside
 * cards Claude adapted, waiting for review). Only administrators reach it.
 */
export default function AdminDashboard() {
  const { token, user } = useSessionStore();
  const setScreen = useMenuStore((s) => s.setScreen);
  const showProfile = useMenuStore((s) => s.showProfile);
  const newDeckFor = useMenuStore((s) => s.newDeckFor);
  const [accounts, setAccounts] = useState<AccountInfo[] | null>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [tab, setTab] = useState<Tab>(savedTab);
  // Pages stay mounted once opened, so a conversation or an unsaved card survives switching tabs.
  const [opened, setOpened] = useState<Set<Tab>>(() => new Set([tab]));
  // A card sent to the editor from the Card Lab; the key remounts the editor on it.
  const [draft, setDraft] = useState<{ key: number; card: CardDraft; } | null>(null);
  const [labInput, setLabInput] = useState("");

  const go = (next: Tab) => {
    setTab(next);
    setOpened((set) => (set.has(next) ? set : new Set(set).add(next)));
    setNotice(null);
    try { localStorage.setItem(TAB_KEY, next); } catch { /* not remembered */ }
  };

  // Not signed in as an administrator (any more): back to the menu.
  const allowed = !!token && !!user?.admin;
  useEffect(() => { if (!allowed) setScreen("lobby"); }, [allowed, setScreen]);

  useEffect(() => {
    if (!token || !allowed) return;
    let live = true;
    listAccounts(token).then((list) => live && setAccounts(list)).catch((e: Error) => live && setNotice({ text: e.message, bad: true }));
    return () => { live = false; };
  }, [token, allowed]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (accounts ?? []).filter((a) => !q || a.name.toLowerCase().includes(q) || a.id.includes(q));
  }, [accounts, query]);

  if (!token || !user || !allowed) return null;

  const replace = (next: AccountInfo) => setAccounts((list) => list?.map((a) => (a.id === next.id ? next : a)) ?? null);
  const run = async (task: Promise<AccountInfo>, done: string) => {
    setNotice(null);
    try {
      replace(await task);
      setNotice({ text: done });
    } catch (e) {
      setNotice({ text: (e as Error).message, bad: true });
    }
  };

  const admins = accounts?.filter((a) => a.admin).length ?? 0;
  return (
    <div className="absolute inset-0 z-40 overflow-y-auto overscroll-contain bg-black/60 p-3 pt-[max(3.5rem,calc(env(safe-area-inset-top)+3rem))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] font-mono text-white">
      {/* Centred and capped, so rows stay readable on a wide monitor; the Grafana dashboards use the full width. */}
      <div className={`mx-auto flex w-full flex-col gap-3 ${tab === "monitoring" ? "" : "max-w-5xl"}`}>
      <header className="flex flex-wrap items-center gap-2">
        <button className={ghost} onClick={() => setScreen("lobby")}>← Menu</button>
        <h1 className="mr-2 text-xl font-bold text-fuchsia-300">Admin</h1>
      </header>
      <nav className="-mx-1 flex justify-center-safe gap-1 overflow-x-auto border-b border-white/15 px-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm pointer-coarse:min-h-11 ${tab === t.id ? "border-fuchsia-300 bg-white/10 text-white" : "border-transparent text-white/60 hover:text-white"}`}
            onClick={() => go(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {notice && <p className={`text-sm ${notice.bad ? "text-rose-300" : "text-emerald-300"}`}>{notice.text}</p>}
      {tab === "rooms" && <PageBoundary name="Rooms"><Rooms token={token} onNotice={setNotice} /></PageBoundary>}
      {opened.has("arena") && <div hidden={tab !== "arena"}><PageBoundary name="Arena"><ArenaPanel token={token} onNotice={setNotice} /></PageBoundary></div>}
      {opened.has("cards") && (
        <div hidden={tab !== "cards"}>
          <PageBoundary name="Cards">
          <CardsPanel
            key={draft?.key ?? 0}
            token={token}
            onNotice={setNotice}
            initial={draft?.card}
            onAsk={(message) => { setLabInput(message); go("lab"); }}
          />
          </PageBoundary>
        </div>
      )}
      {opened.has("lab") && (
        <div hidden={tab !== "lab"}>
          <PageBoundary name="Card Lab">
          <CardLabPanel
            token={token}
            onNotice={setNotice}
            input={labInput}
            setInput={setLabInput}
            onOpen={(card) => { setDraft({ key: Date.now(), card: { card, from: "from the Card Lab" } }); go("cards"); }}
          />
          </PageBoundary>
        </div>
      )}

      {opened.has("scout") && (
        <div hidden={tab !== "scout"}>
          <PageBoundary name="Card Scout"><CardScoutPanel token={token} active={tab === "scout"} onNotice={setNotice} /></PageBoundary>
        </div>
      )}

      {tab === "deckai" && <PageBoundary name="Deck AI"><DeckAIPanel token={token} onNotice={setNotice} /></PageBoundary>}

      {opened.has("monitoring") && (
        <div hidden={tab !== "monitoring"}>
          <PageBoundary name="Monitoring"><Monitoring token={token} /></PageBoundary>
        </div>
      )}

      {tab === "accounts" && <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-white/60">{accounts ? `${accounts.length} accounts · ${admins} admins` : "loading…"}</span>
        <input className={`${input} ml-auto w-56`} placeholder="Search by name or id" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <p className="text-xs text-white/50">
        Guests have no account, so they are not listed. An administrator playing a duel gets the 🛠 Test tools (any card, deck order, refresh turn).
      </p>

      <h2 className="mt-2 font-bold text-fuchsia-200">Accounts <span className="text-xs font-normal text-white/50">· tap a name for their stats and decks</span></h2>
      <CreateAccount
        onCreate={async (account) => {
          setNotice(null);
          try {
            const created = await createAccount(token, account);
            setAccounts((list) => [...(list ?? []), created].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())));
            setNotice({ text: `Created ${created.name}${created.admin ? " (admin)" : ""}. Give them the password to sign in.` });
            return true;
          } catch (e) {
            setNotice({ text: (e as Error).message, bad: true });
            return false;
          }
        }}
      />
      <ul className="flex flex-col gap-2">
        {shown.map((account) => (
          <AccountRow
            key={account.id}
            account={account}
            me={account.id === user.id}
            onOpen={() => showProfile(account.name)}
            onBuild={() => newDeckFor({ id: account.id, name: account.name })}
            onAdmin={(admin) => run(setAccountAdmin(token, account.id, admin), admin ? `${account.name} is now an admin.` : `${account.name} is no longer an admin.`)}
            onPassword={(password) => run(setAccountPassword(token, account.id, password), `${account.name}'s password was changed.`)}
          />
        ))}
        {accounts && shown.length === 0 && <li className="text-sm text-white/50">No account matches.</li>}
      </ul>
      </>}
      </div>
    </div>
  );
}

/** Opens an account for someone: a name, a password to hand over, and optionally admin access. */
function CreateAccount({ onCreate }: { onCreate: (account: { name: string; password: string; admin: boolean; }) => Promise<boolean>; }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [admin, setAdmin] = useState(false);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const ready = name.trim().length >= 2 && password.length >= 8;

  return (
    <form
      className="grid gap-2 border border-fuchsia-400/30 bg-black/75 p-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        setBusy(true);
        if (await onCreate({ name: name.trim(), password, admin })) {
          setName("");
          setPassword("");
          setAdmin(false);
        }
        setBusy(false);
      }}
    >
      <p className="text-sm font-bold text-fuchsia-300 sm:col-span-2">New account</p>
      {/* Half the width for what you type, half for the controls; stacked on phones. */}
      <div className="flex min-w-0 items-center gap-2">
        <input className={`${input} flex-1`} placeholder="Name" maxLength={20} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        <input
          className={`${input} flex-1`}
          type={show ? "text" : "password"}
          placeholder="Password (8+ characters)"
          autoComplete="new-password"
          maxLength={72}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button type="button" className={small} onClick={() => setShow(!show)} title={show ? "Hide password" : "Show password"}>{show ? "🙈" : "👁"}</button>
        <label className="flex items-center gap-1.5 text-sm text-white/70 pointer-coarse:min-h-10">
          <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} /> admin
        </label>
        <button type="submit" className={`${small} ml-auto`} disabled={busy || !ready}>Create account</button>
      </div>
    </form>
  );
}

function AccountRow({ account, me, onOpen, onBuild, onAdmin, onPassword }: {
  account: AccountInfo; me: boolean; onOpen: () => void; onBuild: () => void;
  onAdmin: (admin: boolean) => Promise<void>; onPassword: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const act = async (task: () => Promise<void>) => { setBusy(true); await task(); setBusy(false); };

  // Your own access can't be removed here (you'd lock yourself out), nor can access granted by ADMIN_USERS.
  const locked = me || !!account.fromConfig;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 border border-white/15 bg-black/75 p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold text-yellow-200">
          <button className="underline decoration-yellow-200/30 underline-offset-2 hover:text-yellow-100 pointer-coarse:min-h-10" title={`Open ${account.name}'s page: stats and decks`} onClick={onOpen}>
            {account.name}
          </button>
          {me && <span className="font-normal text-white/50"> (you)</span>}
          {account.admin && <span className="ml-2 bg-fuchsia-900/70 px-1.5 text-[11px] font-normal text-fuchsia-200">admin{account.fromConfig ? " · ADMIN_USERS" : ""}</span>}
        </p>
        <p className="truncate text-[11px] text-white/40">
          {account.id}{account.created && ` · joined ${new Date(account.created).toLocaleDateString()}`}
        </p>
      </div>

      {!me && <button className={small} title={`Open the deck builder on a new deck for ${account.name}`} onClick={onBuild}>🃏 Build a deck</button>}

      <button
        className={small}
        disabled={busy || (account.admin && locked)}
        title={account.admin && locked ? (me ? "You can't remove your own admin access" : "Granted by ADMIN_USERS on the server") : undefined}
        onClick={() => act(() => onAdmin(!account.admin))}
      >
        {account.admin ? "Remove admin" : "Make admin"}
      </button>

      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (password) act(async () => { await onPassword(password); setPassword(""); });
        }}
      >
        <input
          className={`${input} w-36`}
          type={show ? "text" : "password"}
          placeholder="New password"
          autoComplete="new-password"
          maxLength={72}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="button" className={small} onClick={() => setShow(!show)} title={show ? "Hide" : "Show"}>{show ? "🙈" : "👁"}</button>
        <button type="submit" className={small} disabled={busy || !password}>Set password</button>
      </form>
    </li>
  );
}

/** Every room on the server, private ones too, with a way to close any of them. */
function Rooms({ token, onNotice }: { token: string; onNotice: (notice: Notice) => void; }) {
  const [rooms, setRooms] = useState<RoomInfo[] | null>(null);
  const [busy, setBusy] = useState("");
  // The room whose close button was tapped once and now asks to be tapped again.
  // An in-page confirm rather than window.confirm, which some browsers (embedded
  // previews, automation, a tab losing focus) dismiss on their own.
  const [armed, setArmed] = useState("");

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(""), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  useEffect(() => {
    let live = true;
    const stop = poll(() => listAllRooms(token).then((list) => live && setRooms(list)).catch((e: Error) => live && onNotice({ text: e.message, bad: true })), POLL.rooms);
    return () => { live = false; stop(); };
  }, [token, onNotice]);

  const close = async (room: RoomInfo) => {
    if (armed !== room.id) { setArmed(room.id); return; }
    setArmed("");
    setBusy(room.id);
    onNotice(null);
    try {
      await closeRoom(token, room.id);
      setRooms((list) => list?.filter((r) => r.id !== room.id) ?? null);
      onNotice({ text: `Room ${room.id} was closed.` });
    } catch (e) {
      onNotice({ text: (e as Error).message, bad: true });
    }
    setBusy("");
  };

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-bold text-fuchsia-200">Rooms <span className="text-xs font-normal text-white/60">{rooms ? `${rooms.length} open` : "loading…"}</span></h2>
      <ul className="flex flex-col gap-2">
        {rooms?.map((room) => {
          const state = room.finished ? "finished" : room.started ? "in play" : room.lobby ? "lobby" : "waiting for players";
          const players = room.seats.map((s) => s.name || (s.open ? "open seat" : s.kind)).join(" vs ");
          return (
            <li key={room.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border border-white/15 bg-black/75 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-yellow-200">
                  {room.id}
                  <span className="ml-2 font-normal text-white/60">{room.mode} · {state}</span>
                  {room.private && <span className="ml-2 bg-white/10 px-1.5 text-[11px] font-normal text-white/70">private</span>}
                </p>
                <p className="truncate text-[11px] text-white/50">
                  {players}{room.spectators > 0 && ` · ${room.spectators} watching`}
                </p>
              </div>
              {room.started && <button className={small} onClick={() => session.connect(room.id, "admin")}>Watch</button>}
              <button
                className={`${small} ${armed === room.id ? "border-rose-300 bg-rose-900/70 font-bold text-white" : "border-rose-400/60 text-rose-200 hover:border-rose-300"}`}
                disabled={busy === room.id}
                title={armed === room.id ? `This ${room.started && !room.finished ? "ends the duel in progress and disconnects" : "disconnects"} everyone in it.` : undefined}
                onClick={() => close(room)}
              >
                {armed === room.id ? "Tap again to close" : room.started && !room.finished ? "End duel & close" : "Close room"}
              </button>
            </li>
          );
        })}
        {rooms && rooms.length === 0 && <li className="text-sm text-white/50">No rooms are open.</li>}
      </ul>
    </section>
  );
}

/**
 * Grafana's "Duelist server" dashboard, inside the portal: the game server
 * proxies Grafana at /grafana/ to administrators and signs in to it for them
 * (api/grafana.go), so there is nothing else to open or log in to. It stays
 * mounted once opened, so switching tabs keeps its place and time range.
 */
function Monitoring({ token }: { token: string; }) {
  const [state, setState] = useState<"opening" | "ready" | string>("opening");
  useEffect(() => {
    let live = true;
    openGrafanaSession(token)
      .then(() => live && setState("ready"))
      .catch((e) => live && setState((e as Error).message));
    return () => { live = false; };
  }, [token]);

  if (state === "opening") return <p className="text-sm text-white/60">Opening the dashboards…</p>;
  if (state !== "ready") return <p className="text-sm text-rose-300">{state}</p>;
  const src = `${GAME_URL}/grafana/d/duelist?theme=dark&refresh=30s`;
  return (
    <div className="flex flex-col gap-1">
      <iframe
        title="Monitoring: the Duelist server dashboard"
        src={src}
        className="h-[calc(100dvh-11rem)] min-h-96 w-full border border-white/15 bg-black"
      />
      <a className="self-end text-xs text-white/50 underline hover:text-white" href={src} target="_blank" rel="noreferrer">Open in a new tab</a>
    </div>
  );
}
