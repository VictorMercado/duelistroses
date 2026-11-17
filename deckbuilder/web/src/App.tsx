import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, artUrl, setToken, type Card, type Deck, type GameMap, type User } from './api';

const DECK_SIZE = 40;
const MAX_COPIES = 3;
const TERRAINS = ['normal', 'sogen', 'forest', 'wasteland', 'mountain', 'umi', 'yami', 'toon', 'crush', 'labyrinth'];
const terrainUrl = (name: string) => `/assets/terrains/${name}.png`;

type Notice = { text: string; bad?: boolean; } | null;

function SignIn({ onUser }: { onUser: (user: User) => void; }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const go = async (kind: 'guest' | 'login' | 'register') => {
    setError('');
    try {
      const result = await api.signIn(kind, name.trim() || 'Duelist', password);
      setToken(result.token);
      onUser(result.user);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="signin">
      <h1 style={{ color: 'var(--gold)', margin: 0 }}>Duelist City · Deck Builder</h1>
      <p className="dim">Sign in with your Duelist City account. Accounts live on the game server; this site only checks the token it issues.</p>
      <input placeholder="Duelist name" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
      <input placeholder="Password (accounts only)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <div className="row">
        <button className="primary" onClick={() => go('guest')}>Continue as guest</button>
        <button disabled={!password} onClick={() => go('login')}>Sign in</button>
        <button disabled={!password} onClick={() => go('register')}>Create account</button>
      </div>
      {error && <p className="notice bad" style={{ padding: 0 }}>{error}</p>}
    </div>
  );
}

// --- decks -----------------------------------------------------------------

interface Draft { id?: string; name: string; leaderNum: number; cards: number[]; isPublic: boolean; }
const emptyDraft = (): Draft => ({ name: 'New deck', leaderNum: -1, cards: [], isPublic: false });

function DeckBuilder({ cards, notify }: { cards: Card[]; notify: (notice: Notice) => void; }) {
  const byNum = useMemo(() => new Map(cards.map((card) => [card.num, card])), [cards]);
  const [mine, setMine] = useState<Deck[]>([]);
  const [starters, setStarters] = useState<Deck[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [focus, setFocus] = useState<Card | null>(null);

  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [type, setType] = useState('');
  const [maxLevel, setMaxLevel] = useState(12);
  const [workingOnly, setWorkingOnly] = useState(true);

  const reload = useCallback(() => api.decks().then(setMine).catch((e: Error) => notify({ text: e.message, bad: true })), [notify]);
  useEffect(() => { reload(); api.starterDecks().then(setStarters).catch(() => { }); }, [reload]);

  const types = useMemo(() => [...new Set(cards.map((card) => card.type).filter(Boolean) as string[])].sort(), [cards]);
  const counts = useMemo(() => {
    const map = new Map<number, number>();
    for (const num of draft.cards) map.set(num, (map.get(num) ?? 0) + 1);
    return map;
  }, [draft.cards]);

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return cards.filter((card) =>
      (!term || card.name.toLowerCase().includes(term) || card.text?.toLowerCase().includes(term)) &&
      (!kind || card.kind === kind) &&
      (!type || card.type === type) &&
      (card.kind !== 'monster' || (card.level ?? 0) <= maxLevel) &&
      (!workingOnly || card.implemented !== false)
    ).slice(0, 240);
  }, [cards, search, kind, type, maxLevel, workingOnly]);

  const add = (card: Card) => {
    setFocus(card);
    if (draft.cards.length >= DECK_SIZE) return notify({ text: `A deck holds exactly ${DECK_SIZE} cards.`, bad: true });
    if ((counts.get(card.num) ?? 0) >= MAX_COPIES) return notify({ text: `At most ${MAX_COPIES} copies of ${card.name}.`, bad: true });
    notify(null);
    setDraft((d) => ({ ...d, cards: [...d.cards, card.num], leaderNum: d.leaderNum < 0 && card.kind === 'monster' ? card.num : d.leaderNum }));
  };

  const remove = (num: number) => setDraft((d) => {
    const index = d.cards.lastIndexOf(num);
    const next = d.cards.filter((_, i) => i !== index);
    return { ...d, cards: next, leaderNum: d.leaderNum === num && !next.includes(num) ? -1 : d.leaderNum };
  });

  const load = (deck: Deck, asCopy: boolean) => {
    setDraft({ id: asCopy ? undefined : deck.id, name: asCopy ? `${deck.name} (copy)` : deck.name, leaderNum: deck.leaderNum, cards: [...deck.cards], isPublic: asCopy ? false : deck.isPublic });
    notify(null);
  };

  const save = async () => {
    try {
      const saved = await api.saveDeck({ name: draft.name, leaderNum: draft.leaderNum, cards: draft.cards, isPublic: draft.isPublic }, draft.id);
      setDraft((d) => ({ ...d, id: saved.id }));
      notify({ text: `Saved "${saved.name}". It is ready to pick in Duelist City.` });
      reload();
    } catch (e) {
      notify({ text: (e as Error).message, bad: true });
    }
  };

  const destroy = async () => {
    if (!draft.id || !confirm(`Delete "${draft.name}"?`)) return;
    try {
      await api.deleteDeck(draft.id);
      setDraft(emptyDraft());
      reload();
    } catch (e) {
      notify({ text: (e as Error).message, bad: true });
    }
  };

  const cost = draft.cards.reduce((sum, num) => sum + (byNum.get(num)?.deckCost ?? 0), 0);
  const entries = [...counts.entries()]
    .map(([num, count]) => ({ card: byNum.get(num)!, count }))
    .filter((entry) => entry.card)
    .sort((a, b) => a.card.kind.localeCompare(b.card.kind) || (b.card.level ?? 0) - (a.card.level ?? 0) || a.card.name.localeCompare(b.card.name));
  const problem = draft.cards.length !== DECK_SIZE ? `${DECK_SIZE - draft.cards.length} more card(s) needed` : draft.leaderNum < 0 ? 'pick a deck leader (★)' : '';

  return (
    <main className="split">
      <section className="panel">
        <div className="filters">
          <input placeholder="Search name or effect…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All kinds</option>
            {['monster', 'spell', 'trap', 'ritual'].map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={maxLevel} onChange={(e) => setMaxLevel(Number(e.target.value))} title="Highest monster level">
            {[12, 8, 6, 4, 3].map((level) => <option key={level} value={level}>level ≤ {level}</option>)}
          </select>
          <label className="row small"><input type="checkbox" checked={workingOnly} onChange={(e) => setWorkingOnly(e.target.checked)} /> working effects only</label>
        </div>
        <div className="grid">
          {shown.map((card) => (
            <button key={card.num} className={`card ${card.implemented === false ? 'inert' : ''}`} onClick={() => add(card)} onMouseEnter={() => setFocus(card)} title={card.text}>
              <img src={artUrl(card)} alt="" loading="lazy" />
              {counts.has(card.num) && <span className="count">{counts.get(card.num)}</span>}
              <div className="name">{card.name}</div>
              <div className="stats">{card.kind === 'monster' ? `★${card.level} ${card.atk}/${card.def}` : card.kind} · {card.deckCost}</div>
            </button>
          ))}
        </div>
        <div className="detail">
          {focus ? (
            <>
              <b style={{ color: 'var(--gold)' }}>{focus.name}</b>{' '}
              <span className="dim">#{focus.num} · {focus.kind === 'monster' ? `${focus.type} · ${focus.attribute} · level ${focus.level} · ${focus.atk}/${focus.def}` : focus.kind} · deck cost {focus.deckCost}</span>
              <div>{focus.text || <span className="dim">No effect.</span>}</div>
              {focus.implemented === false && <div className="dim">This card's effect is not available in the game yet.</div>}
              {focus.abilityPending && <div className="dim">The monster plays normally; its special ability is not active in the game yet.</div>}
            </>
          ) : <span className="dim">Click a card to add it. Hover to read it.</span>}
        </div>
      </section>

      <aside className="panel">
        <div className="row">
          <input type="text" value={draft.name} maxLength={40} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <button onClick={() => { setDraft(emptyDraft()); notify(null); }}>New</button>
        </div>
        <div className="row small">
          <b style={{ color: draft.cards.length === DECK_SIZE ? 'var(--good)' : 'var(--gold)' }}>{draft.cards.length}/{DECK_SIZE}</b>
          <span className="dim">deck cost {cost}</span>
          <label className="row"><input type="checkbox" checked={draft.isPublic} onChange={(e) => setDraft({ ...draft, isPublic: e.target.checked })} /> public</label>
        </div>
        <div className="list">
          {entries.length === 0 && <p className="dim small">Empty. Add cards from the left, or start from a deck below.</p>}
          {entries.map(({ card, count }) => (
            <div key={card.num} className={`entry ${card.num === draft.leaderNum ? 'leader' : ''}`} onMouseEnter={() => setFocus(card)}>
              <span className="dim">{count}×</span>
              <span className="n">{card.name}</span>
              <span className="dim">{card.kind === 'monster' ? `★${card.level}` : card.kind}</span>
              {card.kind === 'monster' && <button title="Make deck leader" onClick={() => setDraft({ ...draft, leaderNum: card.num })}>★</button>}
              <button title="Remove one" onClick={() => remove(card.num)}>−</button>
            </div>
          ))}
        </div>
        <div className="row">
          <button className="primary" disabled={!!problem} onClick={save}>{draft.id ? 'Save changes' : 'Save deck'}</button>
          {draft.id && <button className="danger" onClick={destroy}>Delete</button>}
          {problem && <span className="dim small">{problem}</span>}
        </div>
        <div className="list" style={{ flex: '0 1 220px' }}>
          <div className="dim small">Your decks</div>
          {mine.length === 0 && <div className="dim small">None yet.</div>}
          {mine.map((deck) => (
            <div key={deck.id} className="entry"><span className="n">{deck.name}</span><span className="dim">{deck.deckCost}</span><button onClick={() => load(deck, false)}>Edit</button></div>
          ))}
          <div className="dim small" style={{ marginTop: 8 }}>Starter decks</div>
          {starters.map((deck) => (
            <div key={deck.id} className="entry" title={deck.description}><span className="n">{deck.name}</span><span className="dim">{deck.deckCost}</span><button onClick={() => load(deck, true)}>Copy</button></div>
          ))}
        </div>
      </aside>
    </main>
  );
}

// --- maps ------------------------------------------------------------------

function MapEditor({ user, notify }: { user: User; notify: (notice: Notice) => void; }) {
  const [maps, setMaps] = useState<GameMap[]>([]);
  const [id, setId] = useState<string | undefined>();
  const [name, setName] = useState('New map');
  const [size, setSize] = useState(7);
  const [tiles, setTiles] = useState<string[]>(() => Array(49).fill('normal'));
  const [brush, setBrush] = useState('forest');
  const [mirror, setMirror] = useState(true);
  const [isPublic, setIsPublic] = useState(true);
  const [painting, setPainting] = useState(false);

  const reload = useCallback(() => api.maps().then(setMaps).catch((e: Error) => notify({ text: e.message, bad: true })), [notify]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const stop = () => setPainting(false);
    window.addEventListener('pointerup', stop);
    return () => window.removeEventListener('pointerup', stop);
  }, []);

  const resize = (next: number) => { setSize(next); setTiles(Array(next * next).fill('normal')); };

  const paint = (index: number) => setTiles((current) => {
    const next = [...current];
    next[index] = brush;
    // Mirroring through the centre keeps the map fair for both sides.
    if (mirror) next[current.length - 1 - index] = brush;
    return next;
  });

  // Tiles are stored from the south-west corner; draw the north row first.
  const half = Math.floor(size / 2);
  const rows = Array.from({ length: size }, (_, row) => size - 1 - row);
  const isStart = (x: number, y: number) => (x === half && (y === 0 || y === size - 1)) || (y === half && (x === 0 || x === size - 1));

  const save = async () => {
    try {
      const saved = await api.saveMap({ name, size, tiles, isPublic }, id);
      setId(saved.id);
      notify({ text: `Saved "${saved.name}". Pick it in the Duelist City lobby.` });
      reload();
    } catch (e) {
      notify({ text: (e as Error).message, bad: true });
    }
  };

  const load = (map: GameMap) => {
    const own = map.ownerId === user.id;
    setId(own ? map.id : undefined);
    setName(own ? map.name : `${map.name} (copy)`);
    setSize(map.size);
    setTiles([...map.tiles]);
    setIsPublic(own ? map.isPublic : false);
    notify(null);
  };

  return (
    <main className="split">
      <section className="panel">
        <div className="palette">
          {TERRAINS.map((terrain) => (
            <button key={terrain} className={brush === terrain ? 'on' : ''} onClick={() => setBrush(terrain)}>
              <i style={{ backgroundImage: `url(${terrainUrl(terrain)})` }} />{terrain}
            </button>
          ))}
        </div>
        <div className="board" style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}>
          {rows.flatMap((y) => Array.from({ length: size }, (_, x) => {
            const index = y * size + x;
            return (
              <div
                key={index}
                className={`tile ${isStart(x, y) ? 'start' : ''}`}
                style={{ backgroundImage: `url(${terrainUrl(tiles[index])})` }}
                onPointerDown={() => { setPainting(true); paint(index); }}
                onPointerEnter={() => painting && paint(index)}
              />
            );
          }))}
        </div>
        <p className="dim small">Click or drag to paint. ★ marks where deck leaders start (south and north; east and west too in 2v2). A leader's own square is always cleared to normal ground when a duel begins.</p>
      </section>
      <aside className="panel">
        <div className="row"><input type="text" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></div>
        <div className="row small">
          <label>size <select value={size} onChange={(e) => resize(Number(e.target.value))}>{[5, 7, 9, 11, 13].map((n) => <option key={n} value={n}>{n}×{n}</option>)}</select></label>
          <label className="row"><input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /> mirror</label>
          <label className="row"><input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} /> public</label>
        </div>
        <div className="row">
          <button className="primary" onClick={save}>{id ? 'Save changes' : 'Save map'}</button>
          <button onClick={() => { setId(undefined); setName('New map'); setTiles(Array(size * size).fill('normal')); }}>New</button>
          {id && <button className="danger" onClick={async () => { if (confirm(`Delete "${name}"?`)) { await api.deleteMap(id).catch((e: Error) => notify({ text: e.message, bad: true })); setId(undefined); reload(); } }}>Delete</button>}
        </div>
        <div className="list">
          <div className="dim small">Maps</div>
          {maps.length === 0 && <div className="dim small">None yet.</div>}
          {maps.map((map) => (
            <div key={map.id} className="entry">
              <span className="n">{map.name}</span><span className="dim">{map.size}×{map.size} · {map.ownerName}</span>
              <button onClick={() => load(map)}>{map.ownerId === user.id ? 'Edit' : 'Copy'}</button>
            </div>
          ))}
        </div>
      </aside>
    </main>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  const [cards, setCards] = useState<Card[]>([]);
  const [tab, setTab] = useState<'decks' | 'maps'>('decks');
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    // A token saved earlier is good until the game server says otherwise.
    api.me().then(setUser).catch(() => setToken(null)).finally(() => setChecked(true));
    api.cards().then((catalog) => setCards(catalog.cards)).catch((e: Error) => setNotice({ text: e.message, bad: true }));
  }, []);

  if (!checked) return null;
  if (!user) return <SignIn onUser={setUser} />;

  return (
    <>
      <header className="top">
        <h1>Duelist City · Builder</h1>
        <span className="tabs row">
          <button className={tab === 'decks' ? 'on' : ''} onClick={() => setTab('decks')}>Decks</button>
          <button className={tab === 'maps' ? 'on' : ''} onClick={() => setTab('maps')}>Maps</button>
        </span>
        {notice && <span className={`notice ${notice.bad ? 'bad' : 'good'}`}>{notice.text}</span>}
        <span className="spacer" />
        <span className="dim">{user.name}{user.guest && ' (guest)'} · {cards.length} cards</span>
        <button onClick={() => { setToken(null); setUser(null); }}>Sign out</button>
      </header>
      {tab === 'decks' ? <DeckBuilder cards={cards} notify={setNotice} /> : <MapEditor user={user} notify={setNotice} />}
    </>
  );
}
