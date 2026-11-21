import { useEffect, useMemo, useState, type ReactNode } from "react";
import { rarityProgress } from "@/const";
import { allCards, cardArt, catalogCard, ensureCatalog } from "@/game/catalog";
import { CardInspector } from "./CardPreview";
import { loadProfile, type DeckSummary, type DuelStats, type MatchSummary, type NamedTally, type Profile, type Tally } from "@/net/api";
import { watchReplay } from "@/net/replay";
import { useMenuStore } from "@/stores/menuStore";
import { useSessionStore } from "@/stores/sessionStore";

const ghost = " border border-white/25 px-3 py-2 text-sm hover:border-white active:border-yellow-400 disabled:opacity-40 pointer-coarse:min-h-11";
const input = "min-w-0  border border-white/20 bg-black/60 px-3 py-2 text-sm outline-none focus:border-yellow-400";
const card = " border border-white/15 bg-black/75 p-4 md:backdrop-blur";

const number = new Intl.NumberFormat();
const n = (v: number | undefined) => number.format(v ?? 0);
const pct = (wins: number, games: number) => (games ? `${Math.round((wins / games) * 100)}%` : "–");
const perDuel = (total: number, games: number) => (games ? (total / games).toFixed(total / games >= 100 ? 0 : 1) : "0");

function duration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** A duelist's record: lifetime totals of what they did in their duels, their decks and rivals, and recent matches. */
export default function ProfilePage() {
  const token = useSessionStore((s) => s.token);
  const isAdmin = useSessionStore((s) => !!s.user?.admin);
  const { profileName, showProfile, setScreen } = useMenuStore();
  // What was loaded, and for whom: switching duelists shows "Loading…" until theirs arrives.
  const [loaded, setLoaded] = useState<{ name: string; profile?: Profile; error?: string; } | null>(null);
  const [search, setSearch] = useState("");
  const current = loaded?.name === profileName ? loaded : null;
  const profile = current?.profile ?? null;
  const error = current?.error ?? "";

  useEffect(() => { if (!token) setScreen("lobby"); }, [token, setScreen]);

  useEffect(() => {
    if (!token) return;
    let live = true;
    loadProfile(token, profileName || undefined)
      .then((p) => live && setLoaded({ name: profileName, profile: p }))
      .catch((e: Error) => live && setLoaded({ name: profileName, error: e.message }));
    return () => { live = false; };
  }, [token, profileName]);

  if (!token) return null;

  return (
    <div className="absolute inset-0 z-40 overflow-y-auto overscroll-contain bg-black/60 p-3 pt-[max(3.5rem,calc(env(safe-area-inset-top)+3rem))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] font-mono text-white">
      <div className="mx-auto flex max-w-4xl flex-col gap-3">
        <header className="flex flex-wrap items-center gap-2">
          <button className={ghost} onClick={() => setScreen("lobby")}>← Menu</button>
          {profileName && <button className={ghost} onClick={() => showProfile()}>My profile</button>}
          {isAdmin && <button className={ghost} onClick={() => setScreen("admin")}>🛡️ Admin</button>}
          <form
            className="ml-auto flex w-full gap-2 sm:w-auto"
            onSubmit={(e) => { e.preventDefault(); if (search.trim()) { showProfile(search.trim()); setSearch(""); } }}
          >
            <input className={`${input} flex-1 sm:w-48`} placeholder="Find a duelist" maxLength={20} value={search} onChange={(e) => setSearch(e.target.value)} />
            <button className={ghost} disabled={!search.trim()}>View</button>
          </form>
        </header>

        {error && <p className={`${card} text-sm text-rose-300`}>{error}</p>}
        {!profile && !error && <p className={`${card} text-sm text-white/60`}>Loading…</p>}
        {profile && <ProfileBody profile={profile} />}
      </div>
    </div>
  );
}

function ProfileBody({ profile }: { profile: Profile; }) {
  const { user, record: r, collection } = profile;
  const t = r.totals;
  const games = r.games;
  const newDeckFor = useMenuStore((s) => s.newDeckFor);
  // Friends build decks for each other; an administrator for anyone.
  const canBuild = !profile.me && !user.guest && (!!profile.canEdit || profile.friend);

  return (
    <>
      <section className={`${card} flex flex-col gap-4`}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-bold text-yellow-300 sm:text-3xl">{user.name}</h1>
          {user.admin && <Badge tone="fuchsia">admin</Badge>}
          {user.guest && <Badge tone="white">guest</Badge>}
          {profile.friend && <Badge tone="emerald">friend</Badge>}
          <span className="text-xs text-white/50">
            {user.joined && `Joined ${new Date(user.joined).toLocaleDateString()}`}
            {r.last && ` · last duel ${ago(r.last)}`}
          </span>
          {canBuild && (
            <button className={`${ghost} sm:ml-auto`} onClick={() => newDeckFor({ id: user.id, name: user.name })}>
              🃏 Build a deck for {user.name}
            </button>
          )}
        </div>

        {user.guest ? (
          <p className="text-sm text-white/60">Guests have no record. Create an account to keep your stats, decks and friends.</p>
        ) : games === 0 ? (
          <p className="text-sm text-white/60">{profile.me ? "Finish a duel and your stats start here." : "No finished duels yet."}</p>
        ) : (
          <Overview profile={profile} />
        )}
      </section>

      {!user.guest && (
        <Section title="Collection">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Decks" value={n(collection.decks)} note={collection.publicDecks ? `${collection.publicDecks} public` : undefined} />
            <Tile label="Maps made" value={n(collection.maps)} />
            <Tile label="Friends" value={n(collection.friends)} />
            <Tile label="Decks played" value={n(profile.decks.length)} note="starter decks included" />
          </div>
        </Section>
      )}

      {!user.guest && <CardRarity profile={profile} />}

      {profile.ownDecks && <OwnDecks profile={profile} />}

      {t && games > 0 && (
        <>
          <Section title="Combat">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              <Tile accent label="Life points taken" value={n(t.damageDealt)} note={`${perDuel(t.damageDealt, games)} / duel`} />
              <Tile label="Life points lost" value={n(t.damageTaken)} note={`${perDuel(t.damageTaken, games)} / duel`} />
              <Tile label="Biggest hit" value={n(t.biggestHit)} />
              <Tile label="Life points healed" value={n(t.healed)} />
              <Tile label="Attacks" value={n(t.attacks)} note={`best ${n(r.best?.attacks)} in a duel`} />
              <Tile label="Direct attacks" value={n(t.directAttacks)} />
              <Tile label="Battles won" value={n(t.battlesWon)} note={t.attacks ? `${pct(t.battlesWon, t.attacks)} of attacks` : undefined} />
              <Tile label="Flawless wins" value={n(r.flawless)} note="no LP lost" />
            </div>
          </Section>

          <Section title="Cards">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              <Tile accent label="Cards destroyed" value={n(t.cardsDestroyed)} note={`${n(t.monstersDestroyed)} monsters · best ${n(r.best?.cardsDestroyed)}`} />
              <Tile label="Cards lost" value={n(t.cardsLost)} note={t.cardsLost ? `${(t.cardsDestroyed / t.cardsLost).toFixed(2)} destroyed per loss` : undefined} />
              <Tile accent label="Fusions" value={n(t.fusions)} note={`best ${n(r.best?.fusions)} in a duel`} />
              <Tile label="Summons" value={n(t.summons)} note={`${perDuel(t.summons, games)} / duel`} />
              <Tile label="Ritual summons" value={n(t.rituals)} />
              <Tile label="Revived" value={n(t.revives)} />
              <Tile label="Equips" value={n(t.equips)} />
              <Tile label="Spells cast" value={n(t.spellsCast)} />
              <Tile label="Traps sprung" value={n(t.trapsSprung)} />
              <Tile label="Monsters taken over" value={n(t.takeovers)} />
              <Tile label="Cards drawn" value={n(t.cardsDrawn)} />
            </div>
          </Section>

          <div className="grid gap-3 md:grid-cols-3">
            <Ranking title="Favourite decks" rows={profile.decks.slice(0, 5)} empty="No decks played yet." />
            <Ranking title="Rivals" rows={profile.rivals.slice(0, 5)} empty="No opponents yet." />
            <Ranking title="Maps" rows={profile.maps.slice(0, 5)} empty="No maps played yet." />
          </div>

          <Section title={`Recent duels`}>
            <ul className="flex flex-col">
              {r.recent.map((m, i) => <MatchRow key={`${m.at}-${i}`} match={m} />)}
            </ul>
          </Section>
        </>
      )}
    </>
  );
}

/**
 * Every card that has earned rarity points, rarest first: its rarity, its
 * points and how far it is from the next rarity. Tapping one opens it.
 */
function CardRarity({ profile }: { profile: Profile; }) {
  const [ready, setReady] = useState(() => allCards().length > 0);
  const [inspect, setInspect] = useState<number | null>(null);
  useEffect(() => { if (!ready) ensureCatalog().then(() => setReady(true)).catch(() => { }); }, [ready]);

  const cards = useMemo(() => Object.entries(profile.cardPoints ?? {})
    .map(([num, points]) => ({ num: Number(num), points, ...rarityProgress(points) }))
    .filter((c) => c.points > 0)
    .sort((a, b) => b.points - a.points || a.num - b.num), [profile.cardPoints]);

  return (
    <Section title={`Card rarity${cards.length ? ` · ${cards.length}` : ""}`}>
      {cards.length === 0 && (
        <p className="text-xs text-white/50">
          {profile.me ? "Your monsters earn rarity by destroying enemy monsters and finishing off deck leaders." : "No card has earned rarity yet."}
        </p>
      )}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
        {cards.map(({ num, points, rarity, next }) => {
          const name = ready ? catalogCard(num)?.name ?? `Card #${num}` : "…";
          const from = rarity.points, to = next?.points;
          const fill = to ? ((points - from) / (to - from)) * 100 : 100;
          return (
            <li key={num}>
              <button
                className="flex w-full gap-2 border border-white/10 bg-white/5 p-1.5 text-left hover:border-white/40 active:border-yellow-400"
                style={{ borderLeftColor: rarity.color, borderLeftWidth: 3 }}
                onClick={() => setInspect(num)}
              >
                {ready && <img src={cardArt(num).art} alt="" loading="lazy" className="h-12 w-12 shrink-0 object-cover" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs">{name}</span>
                  <span className="block text-[11px] font-bold" style={{ color: rarity.color }}>{rarity.name}</span>
                  <span className="mt-0.5 block h-1 overflow-hidden bg-white/10">
                    <span className="block h-full" style={{ width: `${fill}%`, background: next?.color ?? rarity.color }} />
                  </span>
                  <span className="block text-[10px] tabular-nums text-white/50">{to ? `${points} / ${to} pts` : `${points} pts · max`}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {inspect !== null && (
        <CardInspector num={inspect} onClose={() => setInspect(null)} points={profile.cardPoints[inspect] ?? 0} rarity={rarityProgress(profile.cardPoints[inspect] ?? 0).rarity.id} />
      )}
    </Section>
  );
}

/**
 * The decks they built, with how each has done. Shown to the owner and to
 * administrators, who can open any of them in the deck builder.
 */
function OwnDecks({ profile }: { profile: Profile; }) {
  const openDeck = useMenuStore((s) => s.openDeck);
  const decks = profile.ownDecks ?? [];
  // Duels are recorded by deck name: a renamed deck starts a new tally.
  const played = new Map(profile.decks.map((d) => [d.name, d]));
  const edit = (deck: DeckSummary) => openDeck({ ...deck, ownerId: deck.ownerId ?? profile.user.id, ownerName: deck.ownerName ?? profile.user.name });

  return (
    <Section title={profile.me ? "Your decks" : `${profile.user.name}'s decks`}>
      {decks.length === 0 && <p className="text-xs text-white/50">No decks built yet.</p>}
      <ul className="flex flex-col">
        {decks.map((deck) => {
          const tally = played.get(deck.name);
          return (
            <li key={deck.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/10 py-2 text-sm first:border-t-0 first:pt-0">
              <div className="min-w-0 flex-1">
                <p className="truncate">
                  <b className="text-yellow-100">{deck.name}</b>
                  {deck.isPublic && <span className="ml-2"><Badge tone="white">public</Badge></span>}
                </p>
                <p className="text-[11px] text-white/50">
                  {deck.cards.length} cards · cost {deck.deckCost}
                  {deck.updatedAt && ` · updated ${ago(deck.updatedAt)}`}
                  {tally ? ` · ${tally.wins}–${tally.games - tally.wins} (${pct(tally.wins, tally.games)})` : " · not played yet"}
                </p>
              </div>
              {profile.canEdit && <button className={ghost} onClick={() => edit(deck)}>Edit in deck builder</button>}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function Overview({ profile }: { profile: Profile; }) {
  const r = profile.record;
  const streak = r.streak > 0 ? `${r.streak} win${r.streak > 1 ? "s" : ""}` : r.streak < 0 ? `${-r.streak} loss${r.streak < -1 ? "es" : ""}` : "–";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <p className="text-4xl font-bold tabular-nums text-yellow-200">{pct(r.wins, r.games)}</p>
          <p className="text-xs text-white/50">win rate</p>
        </div>
        <Stat label="duels" value={n(r.games)} />
        <Stat label="W / L / D" value={`${r.wins} / ${r.losses} / ${r.draws}`} />
        <Stat label="streak" value={streak} tone={r.streak > 0 ? "text-emerald-300" : r.streak < 0 ? "text-rose-300" : undefined} />
        <Stat label="best streak" value={n(r.bestStreak)} />
      </div>

      {/* Wins, draws and losses as one bar. */}
      <div className="flex h-2 overflow-hidden bg-white/10" role="img" aria-label={`${r.wins} wins, ${r.draws} draws, ${r.losses} losses`}>
        <div className="bg-emerald-400" style={{ width: `${(r.wins / r.games) * 100}%` }} />
        <div className="bg-white/40" style={{ width: `${(r.draws / r.games) * 100}%` }} />
        <div className="bg-rose-400" style={{ width: `${(r.losses / r.games) * 100}%` }} />
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <Split label="vs humans" tally={r.vsHumans} />
        <Split label="vs bots" tally={r.vsBots} />
        <Split label="1v1" tally={r.oneVOne} />
        <Split label="2v2" tally={r.twoVTwo} />
      </div>

      <p className="text-xs text-white/50">
        {n(r.turns)} turns · {duration(r.seconds)} played
        {r.fastestWin > 0 && ` · fastest win in ${r.fastestWin} turns`}
        {r.concedes > 0 && ` · conceded ${r.concedes}`}
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode; }) {
  return (
    <section className={card}>
      <h2 className="mb-3 font-bold text-yellow-200">{title}</h2>
      {children}
    </section>
  );
}

function Badge({ tone, children }: { tone: "fuchsia" | "emerald" | "white"; children: ReactNode; }) {
  const tones = { fuchsia: "bg-fuchsia-900/70 text-fuchsia-200", emerald: "bg-emerald-900/70 text-emerald-200", white: "bg-white/10 text-white/70" };
  return <span className={`px-1.5 text-[11px] ${tones[tone]}`}>{children}</span>;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string; }) {
  return (
    <div>
      <p className={`text-xl font-bold tabular-nums ${tone ?? "text-white"}`}>{value}</p>
      <p className="text-xs text-white/50">{label}</p>
    </div>
  );
}

function Split({ label, tally }: { label: string; tally: Tally; }) {
  return (
    <div className="bg-white/5 px-2 py-1.5">
      <p className="text-white/50">{label}</p>
      <p className="tabular-nums"><b>{tally.wins}</b>–{tally.games - tally.wins} <span className="text-white/50">({pct(tally.wins, tally.games)})</span></p>
    </div>
  );
}

function Tile({ label, value, note, accent }: { label: string; value: string; note?: string; accent?: boolean; }) {
  return (
    <div className={`border p-3 ${accent ? "border-yellow-400/40 bg-yellow-950/30" : "border-white/10 bg-white/5"}`}>
      <p className="text-[11px] uppercase tracking-wide text-white/50">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${accent ? "text-yellow-200" : "text-white"}`}>{value}</p>
      {note && <p className="text-[11px] text-white/40">{note}</p>}
    </div>
  );
}

function Ranking({ title, rows, empty }: { title: string; rows: NamedTally[]; empty: string; }) {
  return (
    <section className={card}>
      <h2 className="mb-2 font-bold text-yellow-200">{title}</h2>
      {rows.length === 0 && <p className="text-xs text-white/50">{empty}</p>}
      <ul className="flex flex-col gap-1.5 text-sm">
        {rows.map((row) => (
          <li key={row.name}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate">{row.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-white/60">{row.wins}–{row.games - row.wins} · {pct(row.wins, row.games)}</span>
            </div>
            <div className="mt-0.5 h-1 overflow-hidden bg-rose-400/40">
              <div className="h-full bg-emerald-400" style={{ width: `${(row.wins / row.games) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const RESULT = {
  win: { label: "Win", tone: "bg-emerald-900/70 text-emerald-200" },
  loss: { label: "Loss", tone: "bg-rose-900/70 text-rose-200" },
  draw: { label: "Draw", tone: "bg-white/10 text-white/70" },
};

function MatchRow({ match: m }: { match: MatchSummary; }) {
  const showProfile = useMenuStore((s) => s.showProfile);
  const result = RESULT[m.result];
  const s: DuelStats = m.stats;
  const people = (seats: MatchSummary["opponents"]) => seats.map((seat, i) => (
    <span key={i}>
      {i > 0 && " & "}
      {seat.userId && !seat.bot
        ? <button className="underline decoration-white/30 underline-offset-2 hover:text-yellow-200" onClick={() => showProfile(seat.name)}>{seat.name}</button>
        : <span>{seat.name}{seat.bot && <span className="text-white/40"> (bot)</span>}</span>}
    </span>
  ));

  return (
    <li className="flex flex-col gap-1 border-t border-white/10 py-2 text-sm first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`px-1.5 text-xs font-bold ${result.tone}`}>{result.label}{m.conceded && " · conceded"}</span>
        <span className="min-w-0">vs {people(m.opponents)}{m.allies.length > 0 && <span className="text-white/50"> · with {people(m.allies)}</span>}</span>
        <span className="ml-auto text-xs text-white/40">{ago(m.at)}</span>
        {m.replay && <button className="border border-white/25 px-2 py-0.5 text-xs hover:border-yellow-400 pointer-coarse:py-2" onClick={() => watchReplay(m.replay!)}>▶ Replay</button>}
      </div>
      <p className="text-[11px] text-white/50">
        {m.mode} · {m.map}{m.deck && ` · ${m.deck}`} · {m.turns} turns · {duration(m.seconds)} · {n(m.lp)} LP left
      </p>
      <p className="text-[11px] text-white/70">
        {n(s.damageDealt)} LP taken · {s.cardsDestroyed} destroyed · {s.fusions} fused · {s.summons} summoned
        {s.biggestHit > 0 && ` · biggest hit ${n(s.biggestHit)}`}
      </p>
    </li>
  );
}
