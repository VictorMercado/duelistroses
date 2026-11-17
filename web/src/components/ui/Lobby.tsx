import { useCallback, useEffect, useState } from "react";
import { playSfx } from "@/game/sfx";
import { useMenuStore } from "@/stores/menuStore";
import { useSessionStore, type BotStyle } from "@/stores/sessionStore";
import { useGameStore } from "@/stores/gameStore";
import { useUIStore } from "@/stores/uiStore";
import { session } from "@/net/session";
import {
  ApiError, createRoom, listMaps, listRooms, myDecks, mySeatedRooms, serverConfig, signIn, starterDecks, whoAmI,
  type DeckSummary, type LlmModel, type MapSummary, type ServerConfig,
} from "@/net/api";
import type { RoomInfo } from "@/net/protocol";
import Friends from "./Friends";
import { BecomeDisplayButton, DisplayLobby } from "./ArenaDisplay";
import ProfileModal, { AvatarButton } from "./ProfileModal";
import { poll, POLL } from "@/net/poll";
import { ensureCatalog, mainMonsterType } from "@/game/catalog";
import { preloadCards } from "@/game/preload";

// Map choices the server understands besides a map id. The picker's empty value means RANDOM_MAP.
const RANDOM_MAP = "random";
const GENERATE_MAP = "generate";

const field = "w-full  border border-white/20 bg-black/60 px-3 py-2 text-sm text-white outline-none focus:border-yellow-400";
const button = " bg-yellow-600 px-4 py-2 text-sm font-bold text-black hover:bg-yellow-500 disabled:opacity-40 pointer-coarse:min-h-11";
const ghost = " border border-white/25 px-3 py-2 text-sm hover:border-white active:border-yellow-400 disabled:opacity-40 pointer-coarse:min-h-11";

function SignIn() {
  const setSession = useSessionStore((s) => s.setSession);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const go = async (kind: "guest" | "login" | "register") => {
    setBusy(true);
    setError("");
    try {
      const result = await signIn(kind, name.trim() || "Duelist", password);
      setSession(result.token, result.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    // A form, so Enter in either field signs in.
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (password && !busy) go("login"); }}>
      <input className={field} placeholder="Duelist name" autoComplete="username" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
      <input className={field} placeholder="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <div className="flex items-center gap-2">
        {/* Signing in is the main way in; a guest seat is the quick alternative, on the right. */}
        <button type="submit" className={`${button} flex-1`} disabled={busy || !password}>Sign in</button>
        <button type="button" className={`${ghost} ml-auto`} disabled={busy} onClick={() => go("guest")}>Play as guest</button>
      </div>
      <p className="text-xs text-white/60">
        New here?{" "}
        <button
          type="button"
          className="font-semibold text-yellow-300 underline underline-offset-2 hover:text-yellow-200 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={busy || !password}
          title={password ? undefined : "Pick a name and password first"}
          onClick={() => go("register")}
        >
          Create an account
        </button>
        {!password && <span className="text-white/40"> with the name and password above</span>}
      </p>
      {error && <p className="text-sm text-rose-300">{error}</p>}
      <p className="text-xs text-white/50">An account keeps your decks; a guest keeps them on this browser.</p>
    </form>
  );
}

/**
 * `battle` setups seat only Claudes, each with its own model, and you watch with nothing hidden.
 * `spectate` setups seat only rule-based bots, started at once, and you watch them the same way.
 */
type Setup = { label: string; note: string; mode: "1v1" | "2v2"; seats: string[]; llm?: boolean; lobby?: boolean; battle?: boolean; spectate?: boolean; };

const SETUPS: Setup[] = [
  { label: "Duel a bot", note: "1v1 against the rule-based bot", mode: "1v1", seats: ["human", "bot"] },
  { label: "Duel Claude", note: "1v1 against an LLM", mode: "1v1", seats: ["human", "bot:llm"], llm: true },
  { label: "2v2 with Claude", note: "you + Claude against two bots", mode: "2v2", seats: ["human", "bot", "bot:llm", "bot"], llm: true },
  { label: "2v2, all LLM", note: "you + Claude against two Claudes", mode: "2v2", seats: ["human", "bot:llm", "bot:llm", "bot:llm"], llm: true },
  { label: "Claude vs Claude", note: "watch two LLMs duel 1v1; pick each model", mode: "1v1", seats: ["bot:llm", "bot:llm"], llm: true, battle: true },
  { label: "2v2 Claude battle", note: "watch four LLMs fight 2v2; pick each model", mode: "2v2", seats: ["bot:llm", "bot:llm", "bot:llm", "bot:llm"], llm: true, battle: true },
  { label: "Bot vs Bot", note: "watch two rule-based bots duel 1v1", mode: "1v1", seats: ["bot", "bot"], spectate: true },
  { label: "2v2 bot battle", note: "watch four rule-based bots fight 2v2", mode: "2v2", seats: ["bot", "bot", "bot", "bot"], spectate: true },
  { label: "Open a lobby", note: "invite friends, pick teams, 1v1 or 2v2", mode: "1v1", seats: ["human", "human"], lobby: true },
];

/** LLM seats name the chosen model: "bot:llm" becomes "bot:llm:<model>". */
const withModel = (seats: string[], model: string) => seats.map((seat) => (seat === "bot:llm" && model ? `bot:llm:${model}` : seat));

/** Rule-based seats take the personality an administrator chose: "bot" becomes "bot:aggressive"... The server ignores it from anyone else. */
const withStyle = (seats: string[], style: BotStyle) => seats.map((seat) => (seat === "bot" && style ? `bot:${style}` : seat));

const BOT_STYLES: { id: BotStyle; label: string; note: string; }[] = [
  { id: "", label: "Random", note: "a surprise each duel" },
  { id: "balanced", label: "Balanced", note: "plays what looks best" },
  { id: "aggressive", label: "Aggressive", note: "leader charges, attacks fast" },
  { id: "builder", label: "Builder", note: "builds a field, then attacks" },
  { id: "defensive", label: "Defensive", note: "walls up and counters" },
];

/** Which personality the rule-based bots play with: an administrator's choice only. Buttons, not a select, so it is one tap on a phone. */
function BotStylePicker() {
  const style = useSessionStore((s) => s.botStyle);
  const setBotStyle = useSessionStore((s) => s.setBotStyle);
  return (
    <div className="text-xs text-white/60">
      <p className="mb-1">Bot personality</p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" role="radiogroup" aria-label="Bot personality">
        {BOT_STYLES.map((s) => (
          <button
            key={s.id}
            role="radio"
            aria-checked={style === s.id}
            onClick={() => setBotStyle(s.id)}
            className={`border px-2 py-1.5 text-left pointer-coarse:min-h-11 ${style === s.id ? "border-yellow-400 bg-yellow-900/30 text-yellow-200" : "border-white/20 text-white/80 hover:border-white/60"}`}
          >
            <span className="block truncate text-sm font-bold">{s.label}</span>
            <span className="block text-[10px] leading-tight text-white/50">{s.note}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The chosen model if the server still offers it, else the server's default. */
function useLlmModel(models: LlmModel[], fallback: string) {
  const chosen = useSessionStore((s) => s.llmModel);
  const id = models.some((m) => m.id === chosen) ? chosen : fallback;
  return models.find((m) => m.id === id) ?? null;
}

/** Which Claude plays the LLM seats. Buttons, not a select, so it is one tap on a phone. */
function ModelPicker({ models, current }: { models: LlmModel[]; current: LlmModel | null; }) {
  const setLlmModel = useSessionStore((s) => s.setLlmModel);
  if (models.length < 2) return null;
  return (
    <div className="text-xs text-white/60">
      <p className="mb-1">Claude model</p>
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Claude model">
        {models.map((m) => (
          <button
            key={m.id}
            role="radio"
            aria-checked={current?.id === m.id}
            onClick={() => setLlmModel(m.id)}
            className={`border px-2 py-1.5 text-left pointer-coarse:min-h-11 ${current?.id === m.id ? "border-yellow-400 bg-yellow-900/30 text-yellow-200" : "border-white/20 text-white/80 hover:border-white/60"}`}
          >
            <span className="block truncate text-sm font-bold">{m.label}</span>
            <span className="block truncate text-[10px] text-white/50">{m.note}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** On phones and tablets the lobby is split into these tabs, in the settings gear's row. */
const TABS = [
  { id: "start", label: "Start" },
  { id: "live", label: "Live" },
  { id: "friends", label: "Friends" },
] as const;
type Tab = (typeof TABS)[number]["id"];
/** Tabs beside them that leave the lobby for another menu screen (signed in only). */
const SCREEN_TABS = [
  { screen: "decks", label: "Decks" },
  { screen: "maps", label: "Maps" },
] as const;

// Stacked on phones (the page scrolls); side by side, each scrolling on its own, on large screens.
const panel = "pointer-events-auto flex shrink-0 flex-col gap-4  border border-white/15 bg-black/75 p-4 sm:p-5 md:backdrop-blur lg:max-h-full lg:overflow-y-auto";
/**
 * Sets up an LLM-only duel: a model for every seat, grouped by team, then the
 * duel is created and watched with nothing hidden.
 */
function BattleSetup({ setup, models, initial, onStart, onCancel }: {
  setup: Setup; models: LlmModel[]; initial: string;
  onStart: (seats: string[]) => void; onCancel: () => void;
}) {
  const [picks, setPicks] = useState<string[]>(() => setup.seats.map(() => initial));
  const pick = (seat: number, id: string) => setPicks((old) => old.map((m, i) => (i === seat ? id : m)));
  const teams = [0, 1].map((team) => setup.seats.map((_, i) => i).filter((i) => i % 2 === team));
  return (
    <div className="flex flex-col gap-3 border border-yellow-400/60 bg-black/60 p-3 text-xs">
      <p className="text-sm font-bold text-yellow-200">{setup.label}: choose the models</p>
      {teams.map((seats, team) => (
        <div key={team} className="flex flex-col gap-2">
          <p className={`font-bold ${team === 0 ? "text-rose-300" : "text-sky-200"}`}>Team {TEAM_NAMES[team]}</p>
          {seats.map((seat) => (
            <div key={seat}>
              <p className="mb-1 text-white/50">Seat {seat + 1} · {EDGES[seat]} edge</p>
              <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={`Model for seat ${seat + 1}`}>
                {models.map((m) => (
                  <button
                    key={m.id}
                    role="radio"
                    aria-checked={picks[seat] === m.id}
                    onClick={() => pick(seat, m.id)}
                    className={`truncate border px-2 py-1.5 text-sm font-bold pointer-coarse:min-h-11 ${picks[seat] === m.id ? "border-yellow-400 bg-yellow-900/30 text-yellow-200" : "border-white/20 text-white/80 hover:border-white/60"}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
      <p className="text-white/50">You watch with every hand visible and can read each Claude's thinking. The duel pauses while nobody is watching.</p>
      <div className="flex gap-2">
        <button className={button} onClick={() => onStart(picks.map((m) => (m ? `bot:llm:${m}` : "bot:llm")))}>Start the battle</button>
        <button className={ghost} onClick={() => { playSfx("cancel", 0.4); onCancel(); }}>Cancel</button>
      </div>
    </div>
  );
}

/** One game in the list, with the choice of who to watch it through. */
function GameRow({ room, signedIn, admin }: { room: RoomInfo; signedIn: boolean; admin: boolean; }) {
  const [choosing, setChoosing] = useState(false);
  const joinable = room.seats.some((s) => s.open) && !room.started;
  const teams = [0, 1].map((team) => room.seats.filter((s) => s.team === team));
  const botsOnly = room.seats.every((s) => s.kind === "bot");
  const label = (seats: RoomInfo["seats"]) => seats.map((s) => s.name || (s.open ? "open" : s.kind)).join(" & ");

  return (
    <div className="border-t border-white/10 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span>
          <span className="text-rose-300">{label(teams[0])}</span> <span className="text-white/40">vs</span> <span className="text-sky-200">{label(teams[1])}</span>
          <span className="block text-[11px] text-white/40">
            {room.id} · {room.mode} · {room.finished ? "finished" : room.started ? "in play" : "waiting for players"}{room.spectators > 0 && ` · ${room.spectators} watching`}
          </span>
        </span>
        <span className="flex shrink-0 gap-1">
          {joinable && <button className={ghost} disabled={!signedIn} onClick={() => session.connect(room.id)}>Join</button>}
          {/* Nobody plays a duel between computer players: watch it with nothing hidden, no choice to make. */}
          <button className={ghost} disabled={!signedIn} onClick={() => (botsOnly ? session.connect(room.id, "all") : setChoosing(!choosing))}>Spectate</button>
        </span>
      </div>
      {choosing && !botsOnly && (
        // Watching is from one side of the table: a team in 2v2, a player in 1v1.
        <div className="mt-2 flex flex-wrap items-center gap-1 bg-white/5 p-2 text-xs">
          <span className="text-white/60">Watch:</span>
          {room.mode === "2v2"
            ? teams.map((_, team) => (
              <button key={team} className={`${ghost} ${team === 0 ? "text-rose-300" : "text-sky-200"}`} onClick={() => session.connect(room.id, `team:${team}`)}>{TEAM_NAMES[team]}</button>
            ))
            : room.seats.filter((s) => !s.open).map((s) => (
              <button key={s.index} className={`${ghost} ${s.team === 0 ? "text-rose-300" : "text-sky-200"}`} onClick={() => session.connect(room.id, `seat:${s.index}`)}>{s.name}</button>
            ))}
          {admin && <button className={`${ghost} border-fuchsia-400/60 text-fuchsia-300`} onClick={() => session.connect(room.id, "admin")}>Everything (admin)</button>}
        </div>
      )}
    </div>
  );
}

/**
 * The menu. It floats over the empty game board: who you are and how to start
 * a duel on one side, every game being played on the other.
 */
/** The last token the server confirmed this page load (see Lobby). */
let vouched = "";

type ServerState = "checking" | "online" | "offline";

/**
 * Whether the game server answers, asked now and then while the menu is
 * open. Only a real answer from it counts: the dev proxy answers on its own
 * (with an error) when the Go server is down. Hidden tabs do not ask (see poll).
 */
function useServerStatus(onConfig: (config: ServerConfig) => void) {
  const [state, setState] = useState<ServerState>("checking");
  useEffect(() => {
    let live = true;
    const stop = poll(() => {
      serverConfig()
        .then((config) => { if (live) { setState("online"); onConfig(config); } })
        .catch(() => live && setState("offline"));
    }, POLL.config);
    return () => { live = false; stop(); };
  }, [onConfig]);
  return state;
}

const SERVER_LABEL: Record<ServerState, { text: string; dot: string; }> = {
  checking: { text: "Checking server…", dot: "bg-white/40 animate-pulse" },
  online: { text: "Server online", dot: "bg-emerald-400" },
  offline: { text: "Server offline", dot: "bg-rose-500" },
};

function ServerStatus({ state }: { state: ServerState; }) {
  const { text, dot } = SERVER_LABEL[state];
  return (
    <p className="mt-1 flex items-center gap-2 text-xs text-white/70" role="status" aria-live="polite">
      <span className={`inline-block size-2 ${dot}`} aria-hidden />
      {text}
      {state === "offline" && <span className="text-white/40">· start it with go run .</span>}
    </p>
  );
}

export default function Lobby() {
  const { token, user, deckId, mapId, setSession, setDeckId, setMapId } = useSessionStore();
  const setBackdrop = useMenuStore((s) => s.setBackdrop);
  const status = useGameStore((s) => s.status);
  const setScreen = useMenuStore((s) => s.setScreen);
  const showProfile = useMenuStore((s) => s.showProfile);
  const { notice, setNotice } = useMenuStore();
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  // The card catalog names each deck's main monster type in the picker.
  const [catalogReady, setCatalogReady] = useState(false);
  useEffect(() => { ensureCatalog().then(() => setCatalogReady(true)).catch(() => { }); }, []);
  const [maps, setMaps] = useState<MapSummary[] | null>(null);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [seated, setSeated] = useState<RoomInfo[]>([]);
  const [joinId, setJoinId] = useState("");
  const [llm, setLlm] = useState(false);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [error, setError] = useState("");
  const onConfig = useCallback((config: ServerConfig) => {
    setLlm(config.llmBots);
    setModels((old) => (JSON.stringify(old) === JSON.stringify(config.llmModels ?? []) ? old : config.llmModels ?? []));
    setDefaultModel(config.llmDefault ?? "");
  }, []);
  const server = useServerStatus(onConfig);
  const model = useLlmModel(models, defaultModel);

  // A saved token may have expired, or belong to a server that was reset.
  // Asking also refreshes what the server says about us (such as admin access)
  // and renews the token. Only a refusal (401) signs us out: a server that is
  // restarting or unreachable for a moment must not throw the session away.
  useEffect(() => {
    // A token the server has just vouched for (or issued) needs no second check:
    // without this, storing the renewed token would ask again, forever.
    if (!token || token === vouched) return;
    whoAmI(token)
      .then(({ token: renewed, ...fresh }) => {
        vouched = renewed ?? token;
        setSession(vouched, fresh);
      })
      .catch((e) => { if (e instanceof ApiError && e.status === 401) setSession(null, null); });
  }, [token, setSession]);

  // The list of games is public: it is there before anyone signs in.
  useEffect(() => {
    let live = true;
    const stop = poll(() => listRooms().then((list) => live && setRooms(list)).catch(() => { }), POLL.rooms);
    return () => { live = false; stop(); };
  }, []);

  // Duels we still hold a seat in (after a reload, or leaving mid-game), to rejoin.
  useEffect(() => {
    if (!token) return;
    let live = true;
    const stop = poll(() => mySeatedRooms(token).then((list) => live && setSeated(Array.isArray(list) ? list : [])).catch(() => { }), POLL.rooms);
    // Forget them on sign out, so another account never sees them.
    return () => { live = false; stop(); setSeated([]); };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let live = true;
    Promise.all([starterDecks(), myDecks(token).catch(() => [])])
      .then(([starters, mine]) => {
        if (!live) return;
        const all = [...mine, ...starters];
        setDecks(all);
        // A remembered deck that was deleted, or is not ours, would get us
        // turned away from every room: fall back to a random starter.
        const chosen = useSessionStore.getState().deckId;
        if (chosen && !all.some((d) => d.id === chosen)) setDeckId("");
      })
      .catch((e: Error) => live && setError(e.message));
    listMaps(token).then((list) => live && setMaps(list)).catch(() => { });
    // Forget the maps on sign out, so another account never sees them.
    return () => { live = false; setMaps(null); };
  }, [token, setDeckId]);

  // Fetch the chosen deck's art while the lobby fills, so the first hand shows at once.
  useEffect(() => {
    const deck = decks.find((d) => d.id === deckId);
    if (deck) preloadCards([deck.leaderNum, ...deck.cards].filter((n) => n >= 0));
  }, [decks, deckId]);

  // The board behind the menu shows the chosen map; plain ground when the map is random or generated.
  useEffect(() => {
    if (!token) { setBackdrop(null); return; } // signed out: plain ground
    if (!maps) return; // not loaded yet: keep what is showing
    const map = maps.find((m) => m.id === mapId);
    // A remembered map that was deleted, or is no longer ours to use, goes back to random.
    if (mapId && mapId !== GENERATE_MAP && !map) setMapId("");
    setBackdrop(map ? { size: map.size, tiles: map.tiles } : null);
  }, [token, maps, mapId, setMapId, setBackdrop]);

  // Opening the page with ?room=name joins that room straight away.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get("room");
    // ?display=1: this screen is the room's arena display (see ArenaDisplay).
    if (token && room && status === "idle") session.connect(room, params.get("display") === "1" ? "display" : undefined);
  }, [token, status]);

  // The battle whose models are being chosen, if any.
  const [battle, setBattle] = useState<Setup | null>(null);

  const start = async (setup: Setup, seats?: string[]) => {
    if (!token) return;
    if (setup.battle && !seats) { setBattle(setup); return; }
    setError("");
    try {
      // A lobby waits for its host to start and is only reachable by invitation or link.
      const room = await createRoom(token, { mode: setup.mode, seats: seats ?? withStyle(withModel(setup.seats, model?.id ?? ""), user?.admin ? useSessionStore.getState().botStyle : ""), mapId: mapId || RANDOM_MAP, lobby: setup.lobby, private: setup.lobby });
      setBattle(null);
      // Nobody plays a battle: watch it with nothing hidden.
      session.connect(room.id, setup.battle || setup.spectate ? "all" : undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // An administrator's test table: they play both seats, and nothing is recorded.
  const openSandbox = async () => {
    if (!token) return;
    setError("");
    try {
      const room = await createRoom(token, { mode: "1v1", seats: [], sandbox: true });
      session.connect(room.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const signedIn = !!token && !!user;
  // Phones and tablets show one tab at a time; large screens show every panel.
  const [tab, setTab] = useState<Tab>("start");
  const [profileOpen, setProfileOpen] = useState(false);
  // The settings panel opens over the lobby: the tabs step aside for it.
  const settingsOpen = useUIStore((s) => s.showControlPanel);
  const shownOn = (...tabs: Tab[]) => (tabs.includes(tab) ? "" : "max-lg:hidden");
  return (
    <div className="absolute inset-0 z-40 flex flex-col gap-3 overflow-y-auto overscroll-contain p-3 pt-[max(3.5rem,calc(env(safe-area-inset-top)+3rem))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] font-mono text-white lg:pointer-events-none lg:flex-row lg:items-start lg:justify-between lg:overflow-hidden">
      {/* Left of the settings gear (App), which keeps the top-right corner. */}
      <nav
        className={`pointer-events-auto fixed left-[max(0.75rem,env(safe-area-inset-left))] right-[calc(max(0.5rem,env(safe-area-inset-right))+3.25rem)] top-(--hud-top) z-[70] flex h-9 gap-1 border border-white/20 bg-black/80 p-0.5 text-xs pointer-coarse:h-11 lg:hidden ${settingsOpen ? "hidden" : ""}`}
        aria-label="Lobby"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={`flex-1 truncate px-2 font-bold ${tab === t.id ? "bg-yellow-600 text-black" : "text-white/70 hover:text-white"}`}
          >
            {t.label}
          </button>
        ))}
        {signedIn && SCREEN_TABS.map((t) => (
          <button
            key={t.screen}
            onClick={() => setScreen(t.screen)}
            className="flex-1 truncate px-2 font-bold text-white/70 hover:text-white"
          >
            {t.label}
          </button>
        ))}
      </nav>
      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}

      <section className={`${panel} lg:w-[20rem] xl:w-[26rem] ${shownOn("start")}`}>
        <header>
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-3xl font-bold tracking-wide text-yellow-300">Duelist City</h1>
            {signedIn && <AvatarButton className="lg:hidden" onClick={() => setProfileOpen(true)} />}
          </div>
          <p className="text-sm text-white/60">Tactical card duels on a living board.</p>
          <ServerStatus state={server} />
        </header>

        {notice && (
          <div className="flex items-start justify-between gap-2 border border-rose-400/60 bg-rose-950/50 p-2.5 text-sm text-rose-200">
            <span>{notice}</span>
            <button className="text-white/50 hover:text-white pointer-coarse:min-h-10 pointer-coarse:px-2" aria-label="Dismiss" onClick={() => setNotice("")}>✕</button>
          </div>
        )}

        {!signedIn ? <SignIn /> : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm max-lg:hidden">
              <span><b className="text-yellow-200">{user.name}</b>{user.guest && " (guest)"}{user.admin && <span className="text-fuchsia-300"> · admin</span>}</span>
              <button className={ghost} onClick={() => setSession(null, null)}>Sign out</button>
            </div>

            {seated.map((room) => (
              <div key={room.id} className="flex items-center justify-between gap-2 border border-yellow-400/60 bg-yellow-900/30 p-2.5 text-sm">
                <span>
                  <b className="text-yellow-200">Duel in progress</b>
                  <span className="block text-[11px] text-white/60">
                    {room.id} · {room.mode} · {room.seats.filter((s) => s.userId !== user.id).map((s) => s.name || s.kind).join(", ")}
                  </span>
                </span>
                <button className={button} onClick={() => session.connect(room.id)}>Rejoin</button>
              </div>
            ))}

            <div className="grid grid-cols-2 gap-2 max-lg:hidden">
              <button className={ghost} onClick={() => setScreen("decks")}>🃏 Deck builder</button>
              <button className={ghost} onClick={() => setScreen("maps")}>🗺️ Map editor</button>
              <button className={ghost} onClick={() => showProfile()}>👤 Profile</button>
              {user.admin && <button className={ghost} onClick={() => setScreen("admin")}>🛡️ Admin</button>}
            </div>

            <label className="text-xs text-white/60">Your deck
              <select className={field} value={deckId} onChange={(e) => setDeckId(e.target.value)}>
                <option value="">Random starter deck</option>
                {decks.map((deck) => {
                  const type = catalogReady ? mainMonsterType(deck.cards) : undefined;
                  return <option key={deck.id} value={deck.id}>{deck.starter ? "Starter · " : ""}{deck.name}{type && ` · ${type}`} (cost {deck.deckCost})</option>;
                })}
              </select>
            </label>
            <label className="text-xs text-white/60">Map
              <select className={field} value={mapId} onChange={(e) => setMapId(e.target.value)}>
                <option value="">Random map (default or player-made)</option>
                <option value={GENERATE_MAP}>Generate a new map, mirrored for fairness</option>
                {(maps ?? []).some((map) => map.preset) && (
                  <optgroup label="Default maps">
                    {maps!.filter((map) => map.preset).map((map) => <option key={map.id} value={map.id}>{map.name} ({map.size}×{map.size})</option>)}
                  </optgroup>
                )}
                {(maps ?? []).some((map) => !map.preset) && (
                  <optgroup label="Player maps">
                    {maps!.filter((map) => !map.preset).map((map) => <option key={map.id} value={map.id}>{map.name} ({map.size}×{map.size}) by {map.ownerName}</option>)}
                  </optgroup>
                )}
              </select>
            </label>

            {/* One tap into a duel: the deck and map above, against the rule-based bot, balanced. */}
            <button className={`${button} w-full py-3 text-base`} onClick={() => start(SETUPS[0], ["human", "bot:balanced"])}>
              ⚔️ Quick duel
              <span className="block text-[11px] font-normal text-black/70">1v1 against the rule-based bot · balanced</span>
            </button>

            <div className="flex gap-2">
              <input className={field} placeholder="Room name to join or create" value={joinId} onChange={(e) => setJoinId(e.target.value.replace(/[^A-Za-z0-9_-]/g, ""))} />
              <button className={button} disabled={!joinId} onClick={() => session.connect(joinId)}>Join</button>
            </div>
            {error && <p className="text-sm text-rose-300">{error}</p>}
          </>
        )}
      </section>

      {/* The ways to start a duel, on their own in the middle of the screen. */}
      {signedIn && (
        <section className={`${panel} lg:w-[30rem] lg:min-w-0 lg:shrink lg:self-center ${shownOn("start")}`}>
          <p className="text-lg font-bold text-yellow-300">Game modes</p>
          {llm && <ModelPicker models={models} current={model} />}
          {user?.admin && <BotStylePicker />}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {SETUPS.map((setup) => (
              <button
                key={setup.label}
                disabled={setup.llm && !llm}
                title={setup.llm && !llm ? "The game server has no Anthropic credentials (set ANTHROPIC_API_KEY)" : ""}
                onClick={() => start(setup)}
                aria-pressed={setup.battle ? battle === setup : undefined}
                // Primary buttons: these start a match.
                className={`group flex items-center gap-2 bg-yellow-600 p-3 text-left text-black shadow-md shadow-black/40 hover:bg-yellow-500 active:bg-yellow-400 disabled:opacity-40 disabled:hover:bg-yellow-600 pointer-coarse:min-h-11 ${battle === setup ? "ring-2 ring-white ring-offset-2 ring-offset-black" : ""}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">{setup.label}</span>
                  <span className="text-[11px] text-black/70">{setup.llm && !llm ? "needs an API key on the server" : setup.llm && model && !setup.battle ? setup.note.replaceAll("Claude", `Claude ${model.label}`) : setup.note}</span>
                </span>
                <span aria-hidden className="shrink-0 text-xl font-bold leading-none transition-transform group-hover:translate-x-0.5 group-disabled:translate-x-0">→</span>
              </button>
            ))}
          </div>
          {user?.admin && (
            <button
              onClick={openSandbox}
              className="border border-fuchsia-400/50 bg-black/50 p-3 text-left hover:border-fuchsia-300 active:border-fuchsia-300"
            >
              <span className="block text-sm font-bold text-fuchsia-300">🧪 Sandbox</span>
              <span className="text-[11px] text-white/60">admin only: play both sides, any card, free summons, no clock</span>
            </button>
          )}
          {battle && llm && (
            <BattleSetup
              key={battle.label}
              setup={battle}
              models={models}
              initial={model?.id ?? ""}
              onStart={(seats) => start(battle, seats)}
              onCancel={() => setBattle(null)}
            />
          )}
        </section>
      )}

      <section className={`${panel} lg:w-[20rem] xl:w-[26rem] ${shownOn("live", "friends")}`}>
        <div className={shownOn("live")}>
          <p className="font-bold text-yellow-200">Games being played</p>
          {rooms.length === 0 && <p className="text-sm text-white/50">No public games right now. Start one!</p>}
          {!signedIn && rooms.length > 0 && <p className="text-xs text-white/50">Sign in to join or watch.</p>}
          {rooms.map((room) => <GameRow key={room.id} room={room} signedIn={signedIn} admin={!!user?.admin} />)}
        </div>
        <div className={shownOn("friends")}>
          {signedIn ? <Friends inRoom={false} /> : <p className="text-sm text-white/50 lg:hidden">Sign in to add friends and invite them to a duel.</p>}
        </div>
      </section>
    </div>
  );
}

const TEAM_NAMES = ["Red Rose", "White Rose"];

// Phones get the system share sheet (Messages, WhatsApp...); elsewhere the link is copied.
const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches;

function shareInvite(link: string, roomId: string) {
  if (canShare) navigator.share({ title: "Duelist City", text: `Join my duel in room ${roomId}`, url: link }).catch(() => { });
  else navigator.clipboard?.writeText(link);
}
const EDGES = ["south", "north", "east", "west"];

/**
 * The room before the duel. In a lobby this is where players pick a seat (and
 * with it a team), the host fills seats with computer players, switches
 * between 1v1 and 2v2, and starts. Other rooms pass through it in a moment.
 */
export function WaitingRoom({ onLeave }: { onLeave: () => void; }) {
  const room = useGameStore((s) => s.room);
  const seat = useGameStore((s) => s.seat);
  const status = useGameStore((s) => s.status);
  const log = useGameStore((s) => s.log);
  const userId = useSessionStore((s) => s.user?.id);
  const botStyle = useSessionStore((s) => s.botStyle);
  const admin = useSessionStore((s) => !!s.user?.admin);
  const [llm, setLlm] = useState(false);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  useEffect(() => {
    serverConfig().then((config) => {
      setLlm(config.llmBots);
      setModels(config.llmModels ?? []);
      setDefaultModel(config.llmDefault ?? "");
    }).catch(() => { });
  }, []);
  const model = useLlmModel(models, defaultModel);

  const lastError = [...log].reverse().find((entry) => entry.tone === "bad");
  const display = useGameStore((s) => s.display);
  const host = !!room && room.hostId === userId;
  const ready = !!room && room.seats.every((s) => !s.open);
  const link = room ? `${window.location.origin}/?room=${room.id}` : "";

  return (
    <div className="absolute inset-0 z-40 overflow-y-auto overscroll-contain bg-black/40 px-3 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] font-mono text-white">
      <div className="mx-auto my-4 flex max-w-2xl sm:my-10 flex-col gap-4 border border-white/15 bg-black/75 px-5 py-6 text-sm backdrop-blur">
        {!room ? (
          <p>{status === "closed" ? "Could not join the room." : "Connecting…"}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xl font-bold text-yellow-300">{display ? "Arena" : "Lobby"} {room.id} <span className="text-sm font-normal text-white/50">· {room.mapName} map · {room.size}×{room.size}</span></p>
              {room.lobby && (
                <span className="flex gap-1">
                  {(["1v1", "2v2"] as const).map((mode) => (
                    <button
                      key={mode}
                      disabled={!host}
                      onClick={() => session.lobby({ t: "mode", mode })}
                      className={`border px-3 py-1 pointer-coarse:min-h-11 ${room.mode === mode ? "border-yellow-400 text-yellow-300" : "border-white/25"} disabled:cursor-default`}
                    >
                      {mode}
                    </button>
                  ))}
                </span>
              )}
            </div>

            {display && <DisplayLobby />}
            {!display && room.display && seat >= 0 && <p className="border border-yellow-500/40 bg-yellow-950/30 px-3 py-2 text-yellow-100">🖥 An arena display is showing the board. When the duel starts this phone becomes your controller and holds your hand.</p>}

            <div className="grid gap-3 sm:grid-cols-2">
              {[0, 1].map((team) => (
                <div key={team} className={`border p-3 ${team === 0 ? "border-rose-400/50 bg-rose-950/30" : "border-sky-300/50 bg-sky-950/30"}`}>
                  <p className={`mb-2 font-bold ${team === 0 ? "text-rose-300" : "text-sky-200"}`}>Team {TEAM_NAMES[team]}</p>
                  {room.seats.filter((s) => s.team === team).map((s) => (
                    <div key={s.index} className="flex min-h-10 flex-wrap items-center justify-between gap-2 border-t border-white/10 py-1.5">
                      <span>
                        {s.open ? <span className="text-white/40">open seat</span> : <b>{s.name}</b>}
                        {s.userId === room.hostId && s.kind === "human" && !s.open && <span className="text-yellow-300"> ★</span>}
                        {s.index === seat && <span className="text-white/50"> (you)</span>}
                        <span className="block text-[10px] text-white/40">{EDGES[s.index]} edge{s.deckName && ` · ${s.deckName}`}{s.kind === "bot" && " · computer"}</span>
                      </span>
                      {room.lobby && (
                        <span className="flex gap-1">
                          {s.open && s.index !== seat && !display && <button className={ghost} onClick={() => session.lobby({ t: "sit", seat: s.index })}>Sit here</button>}
                          {host && s.open && <button className={ghost} onClick={() => session.lobby({ t: "seat", seat: s.index, kind: admin && botStyle ? `bot:${botStyle}` : "bot" })}>+ Bot</button>}
                          {host && s.open && llm && <button className={ghost} onClick={() => session.lobby({ t: "seat", seat: s.index, kind: model ? `bot:llm:${model.id}` : "bot:llm" })}>+ Claude{model && ` ${model.label}`}</button>}
                          {host && s.kind === "bot" && <button className={ghost} onClick={() => session.lobby({ t: "seat", seat: s.index, kind: "human" })}>Remove</button>}
                          {s.index === seat && <button className={ghost} onClick={() => session.lobby({ t: "stand" })}>Stand up</button>}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {room.lobby && host && llm && <ModelPicker models={models} current={model} />}
            {room.lobby && host && admin && <BotStylePicker />}

            {room.lobby && (
              <p className="text-xs text-white/50">
                {display ? "Players pick a team by taking a seat from their phone. " : "Pick a team by taking a seat on it. "}{seat < 0 && !display && "You are watching; take an open seat to play. "}
                {room.spectators > 0 && `${room.spectators} watching. `}
                {host ? "You are the host (★): start when every seat is filled." : "Waiting for the host (★) to start."}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {room.lobby && host && !display && <button className={button} disabled={!ready} onClick={() => session.lobby({ t: "start" })}>Start duel</button>}
              <button className={ghost} onClick={onLeave}>Leave</button>
              <BecomeDisplayButton />
              <button className={ghost} onClick={() => shareInvite(link, room.id)}>{canShare ? "Share invite" : "Copy invite link"}</button>
              <span className="break-all text-xs text-white/40">{link}</span>
            </div>
            {lastError && <p className="text-rose-300">{lastError.text}</p>}

            {room.lobby && <Friends inRoom />}
          </>
        )}
        {!room && <button className={`${ghost} w-fit`} onClick={onLeave}>Leave</button>}
      </div>
    </div>
  );
}
