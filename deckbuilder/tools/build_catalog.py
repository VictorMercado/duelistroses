#!/usr/bin/env python3
"""Builds the content service's card data from the raw card dump.

    python3 tools/build_catalog.py

Reads  tools/source/dor_raw.json   (one record per card: number, name, stats, text)
Writes api/Data/cards.json         (the catalog the API serves)
       api/Data/fusions.json       (fusion recipes)
       api/Data/starter-decks.json (ready-made 40 card decks)

A card's behaviour is described as data ("effect": {"op": ...}) that the game
server's rules engine interprets. Cards whose behaviour the engine does not
have an op for yet are still in the catalog, flagged "implemented": false, so
the deck builder can show them and the game simply treats them as inert.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "tools", "source", "dor_raw.json")
OUT = os.path.join(ROOT, "api", "Data")
HD_ART = os.path.join(ROOT, "api", "wwwroot", "assets", "cards", "hd")


def clean(text):
    """Strips wiki markup from card text."""
    if not text:
        return ""
    text = re.sub(r"\[\[([^\]|]*\|)?([^\]]*)\]\]", r"\2", text)
    text = re.sub(r"<br\s*/?>", " ", text)
    text = re.sub(r"'{2,}", "", text)
    return re.sub(r"\s+", " ", text).strip()


def slug(value):
    return (value or "").strip().lower().replace(" ", "-")


def key(name):
    return re.sub(r"[^a-z0-9]", "", name.lower())


# --- spell and trap behaviour, by card number ------------------------------

def equip(amount, types=None, attrs=None, name=None):
    e = {"op": "equip", "amount": amount}
    if types:
        e["types"] = types
    if attrs:
        e["attrs"] = attrs
    if name:
        e["name"] = name
    return e


def trap(op, **extra):
    return {"op": op, "trigger": "move", "range": "limited", **extra}


def reaction(op, trigger):
    return {"op": op, "trigger": trigger, "range": "full"}


NON_DARK = ["light", "earth", "water", "fire", "wind"]

EFFECTS = {
    683: {"op": "spellbindType", "types": ["dragon"], "turns": -1},
    684: {"op": "spellbindStrongest", "turns": -1},
    685: {"op": "revive"},
    689: {"op": "terrain", "terrain": "forest", "radius": 2},
    690: {"op": "terrain", "terrain": "wasteland", "radius": 2},
    691: {"op": "terrain", "terrain": "mountain", "radius": 2},
    692: {"op": "terrain", "terrain": "sogen", "radius": 2},
    693: {"op": "terrain", "terrain": "umi", "radius": 2},
    694: {"op": "terrain", "terrain": "yami", "radius": 2},
    695: {"op": "terrain", "terrain": "toon", "radius": 2},
    696: {"op": "terrain", "terrain": "normal", "radius": 2},
    697: {"op": "terrainHere", "terrain": "labyrinth"},
    699: {"op": "destroyAll"},
    700: {"op": "destroyCross"},
    701: {"op": "destroySpells"},
    702: {"op": "destroySpellsCross"},
    703: {"op": "heal", "amount": 200},
    704: {"op": "heal", "amount": 500},
    705: {"op": "heal", "amount": 1000},
    706: {"op": "heal", "amount": 2000},
    707: {"op": "healTo", "amount": 4000},
    708: {"op": "heal", "amount": 1500},
    709: {"op": "burn", "amount": 50},
    710: {"op": "burn", "amount": 100},
    711: {"op": "burn", "amount": 200},
    712: {"op": "burn", "amount": 500},
    713: {"op": "burn", "amount": 1000},
    714: {"op": "burnPerEnemy", "amount": 300},
    715: {"op": "swords", "turns": 3},
    716: {"op": "revealEnemy"},
    717: {"op": "hideAll"},
    720: {"op": "destroyType", "types": ["warrior"]},
    721: {"op": "destroyType", "types": ["zombie"]},
    722: {"op": "destroyType", "types": ["machine"]},
    723: {"op": "destroyType", "types": ["insect"]},
    724: {"op": "destroyType", "types": ["rock"]},
    725: {"op": "destroyType", "types": ["fish"]},
    726: {"op": "destroyWeakest"},
    727: {"op": "destroyType", "types": ["spellcaster"]},
    728: {"op": "destroyType", "types": ["fiend"]},
    729: {"op": "destroyType", "types": ["winged-beast"]},
    730: {"op": "destroyType", "types": ["dinosaur"]},
    732: {"op": "control"},
    733: {"op": "controlStrongest"},
    734: {"op": "cleanse"},
    735: {"op": "boost", "amount": 600, "types": ["fairy"]},
    736: {"op": "swapStats"},
    737: {"op": "boostOwnDef", "amount": 900},
    738: {"op": "boost", "amount": 600, "types": ["machine"]},
    739: {"op": "boost", "amount": 600, "types": ["plant"]},
    740: {"op": "boost", "amount": 600, "types": ["winged-beast"]},
    741: {"op": "boost", "amount": 600, "types": ["reptile"]},
    742: {"op": "boost", "amount": 600, "attrs": ["water"]},
    743: {"op": "stopDefense"},
    744: {"op": "recall"},
    746: {"op": "shift"},
    747: {"op": "extraPlay"},
    748: {"op": "drainStars"},
    749: {"op": "teleportLeader"},
    752: equip(500, ["warrior"], ["light", "earth"]),
    753: equip(500, ["warrior"], ["dark", "fire", "water", "wind"]),
    754: equip(300, attrs=["dark"]),
    755: equip(500, ["beast-warrior", "fiend"]),
    756: equip(500, ["insect"]),
    757: equip(500, ["insect"]),
    758: equip(700, name="elf"),
    759: equip(500, ["beast"]),
    761: equip(500, ["plant"]),
    762: equip(500, ["spellcaster"], ["dark"]),
    763: equip(500, ["fairy"]),
    766: equip(500, ["dragon", "sea-serpent"]),
    769: equip(500, ["beast", "beast-warrior"]),
    771: equip(500, ["spellcaster"], NON_DARK),
    772: equip(500, ["zombie"]),
    773: equip(300, attrs=["earth"]),
    774: equip(500, ["machine"]),
    775: equip(500, ["dragon", "reptile"]),
    776: equip(500, ["winged-beast"]),
    777: equip(500, attrs=["water"]),
    778: equip(500, ["warrior", "beast-warrior"]),
    779: equip(500, attrs=["fire"]),
    780: equip(300),
    781: equip(500, attrs=["light"]),
    782: equip(500, ["fiend"]),
    783: equip(500, ["fish", "sea-serpent"]),
    784: equip(500, ["thunder", "aqua", "pyro", "rock"]),
    785: equip(500, attrs=["wind"]),
    786: equip(500, ["pyro"]),
    787: equip(700, name="slot machine"),
    788: equip(700, ["dragon"], ["dark"]),
    789: {"op": "halveLP"},
    795: {"op": "spellbindExcept", "types": ["machine"], "turns": -1},
    796: {"op": "cleanse"},
    801: trap("trapBind", turns=3, amount=600),
    802: trap("trapBind", turns=3, amount=1000),
    803: trap("trapBind", turns=1, amount=800),
    804: trap("trapBind", turns=1, amount=600),
    805: trap("trapBind", turns=3),
    806: trap("trapBind", turns=-1, amount=1500),
    807: trap("trapDestroy", maxAtk=1000),
    808: trap("trapDestroy", maxAtk=1500),
    809: trap("trapDestroy", maxAtk=2000),
    810: trap("trapDestroy", maxAtk=3000),
    811: trap("trapDestroy", maxAtk=4000),
    812: trap("trapRuin"),
    823: reaction("trapJam", "spell"),
    827: reaction("trapMirrorForce", "attack"),
    828: reaction("trapNegate", "attack"),
    829: reaction("trapWeaken", "attack"),
}

# Cards that were not in the original set. Numbers from 900 up are ours.
CUSTOM = [
    {"num": 900, "name": "Pot of Greed", "kind": "spell", "deckCost": 40,
     "text": "Draw 2 cards from your deck.", "effect": {"op": "draw", "amount": 2}},
    {"num": 901, "name": "Trap Hole", "kind": "trap", "deckCost": 20,
     "text": "Disposable trap that triggers when an enemy monster with ATK of 1000 or more moves next to it, and destroys it.",
     "effect": trap("trapDestroy", minAtk=1000)},
]

KINDS = {"Monster Card": "monster", "Spell Card": "spell", "Trap Card": "trap", "Ritual Card": "ritual"}

# --- fusion recipes, by card name ------------------------------------------
# Named pairs first, then type pairs. A type pair only fuses when the result
# is stronger than both materials, so a fusion is never a downgrade.
NAMED_FUSIONS = [
    ("Red-Eyes B. Dragon", "Summoned Skull", "B. Skull Dragon"),
    ("Red-Eyes B. Dragon", "Meteor Dragon", "Meteor B. Dragon"),
    ("Time Wizard", "Baby Dragon", "Thousand Dragon"),
    ("Gaia The Fierce Knight", "Curse of Dragon", "Gaia the Dragon Champion"),
    ("Battle Ox", "Mystic Horseman", "Rabid Horseman"),
    ("Flame Manipulator", "Masaki the Legendary Swordsman", "Flame Swordsman"),
    ("Thunder Dragon", "Thunder Dragon", "Twin-headed Thunder Dragon"),
    ("M-Warrior #1", "M-Warrior #2", "Karbonala Warrior"),
    ("Petit Angel", "Mystical Sheep #2", "Fusionist"),
    ("Blue-Winged Crown", "Niwatori", "Punished Eagle"),
    ("Tainted Wisdom", "Ancient Brain", "Skull Knight"),
    ("Mystic Lamp", "Hyosube", "Roaring Ocean Snake"),
    ("Water Magician", "Behegon", "Marine Beast"),
    ("Bottom Dweller", "Tongyo", "Deepsea Shark"),
    ("Queen's Double", "Hibikime", "Empress Judge"),
    ("Witch of the Black Forest", "Lady of Faith", "Musician King"),
    ("Blast Juggler", "Two-Headed King Rex", "Cyber Saurus"),
    ("Two-Headed King Rex", "Crawling Dragon #2", "Bracchio-raidus"),
    ("Faith Bird", "Skull Red Bird", "Crimson Sunbird"),
    ("Feral Imp", "Snakeyashi", "Rose Spectre of Dunn"),
    ("Trakadon", "Flame Viper", "Pragtical"),
    ("Beautiful Headhuntress", "Sonic Maid", "Warrior of Tradition"),
    ("Rhaimundos of the Red Sword", "Fireyarou", "Vermillion Sparrow"),
    ("Steel Ogre Grotto #1", "Lesser Dragon", "Metal Dragon"),
    ("Guardian of the Labyrinth", "Protector of the Throne", "Giltia the D. Knight"),
    ("Armaill", "One-Eyed Shield Dragon", "Dragoness the Wicked Knight"),
    ("Firegrass", "Petit Dragon", "Darkfire Dragon"),
    ("Monster Egg", "Hinotama Soul", "Charubin the Fire Knight"),
    ("Silver Fang", "Darkworld Thorns", "Flower Wolf"),
    ("Ocubeam", "Mega Thunderball", "Kaminari Attack"),
    ("Fairy Dragon", "Amazon of the Seas", "Aqua Dragon"),
    ("Zanki", "Crawling Dragon", "Dragon Zombie"),
    ("Skull Servant", "Dissolverock", "Flame Ghost"),
    ("Mushroom Man", "Ancient Elf", "Kamionwizard"),
    ("Ancient Elf", "Giant Flea", "Mystical Sand"),
]

TYPE_FUSIONS = [
    ("dragon", "thunder", "Thunder Dragon"),
    ("dragon", "zombie", "Dragon Zombie"),
    ("dragon", "warrior", "Dragoness the Wicked Knight"),
    ("dragon", "pyro", "Darkfire Dragon"),
    ("dragon", "machine", "Metal Dragon"),
    ("dragon", "aqua", "Aqua Dragon"),
    ("zombie", "warrior", "Zombie Warrior"),
    ("pyro", "warrior", "Charubin the Fire Knight"),
    ("plant", "beast", "Flower Wolf"),
    ("thunder", "warrior", "Kaminari Attack"),
    ("pyro", "beast", "Flame Cerberus"),
    ("pyro", "zombie", "Flame Ghost"),
    ("machine", "beast", "Giga-Tech Wolf"),
    ("fish", "warrior", "Marine Beast"),
    ("fish", "dragon", "Roaring Ocean Snake"),
    ("winged-beast", "pyro", "Crimson Sunbird"),
    ("dinosaur", "machine", "Cyber Saurus"),
    ("beast", "warrior", "Rabid Horseman"),
    ("spellcaster", "fairy", "Musician King"),
    ("rock", "spellcaster", "Mystical Sand"),
]


def build_cards(raw):
    hd = {}
    if os.path.isdir(HD_ART):
        for filename in os.listdir(HD_ART):
            base, ext = os.path.splitext(filename)
            if ext.lower() == ".png":
                hd[key(base)] = filename

    cards = []
    for r in raw:
        kind = KINDS.get(r["ctype"], "monster")
        card = {"num": r["num"], "name": r["name"], "kind": kind, "deckCost": r["dc"] or 0}
        text = clean(r["lore"])
        if text:
            card["text"] = text
        if kind == "monster":
            card.update({
                "type": slug(r["type"]), "attribute": slug(r["attr"]),
                "level": r["level"] or 1, "atk": r["atk"] or 0, "def": r["deff"] or 0,
            })
            if "Strong in TOON terrain" in text:
                card["favors"] = ["toon"]
            # A monster with text has an ability; none of those are wired up yet,
            # but the monster itself plays normally.
            card["implemented"] = True
            if text and "favors" not in card:
                card["abilityPending"] = True
        else:
            effect = EFFECTS.get(r["num"])
            if effect:
                card["effect"] = effect
            card["implemented"] = effect is not None

        card["image"] = "cards/%03d.png" % r["num"]
        art = hd.get(key(r["name"]))
        if art:
            card["imageHd"] = "cards/hd/" + art
            mask = hd.get(key(r["name"]) + "mask")
            if mask:
                card["mask"] = "cards/hd/" + mask
        cards.append(card)

    for custom in CUSTOM:
        card = dict(custom)
        card["implemented"] = True
        card["custom"] = True
        art = hd.get(key(card["name"]))
        if art:
            card["imageHd"] = "cards/hd/" + art
        cards.append(card)
    return cards


def build_fusions(cards):
    by_name = {key(c["name"]): c for c in cards if c["kind"] == "monster"}
    fusions, missing = [], []

    def find(name):
        card = by_name.get(key(name))
        if not card:
            missing.append(name)
        return card

    for a, b, result in NAMED_FUSIONS:
        ca, cb, cr = find(a), find(b), find(result)
        if ca and cb and cr:
            fusions.append({"a": {"num": ca["num"]}, "b": {"num": cb["num"]}, "result": cr["num"]})
    for a, b, result in TYPE_FUSIONS:
        cr = find(result)
        if cr:
            fusions.append({"a": {"type": a}, "b": {"type": b}, "result": cr["num"]})
    if missing:
        print("fusion names not in the catalog (skipped):", ", ".join(sorted(set(missing))), file=sys.stderr)
    return fusions


# --- starter decks ---------------------------------------------------------

DECK_THEMES = [
    ("dragons-of-the-peak", "Dragons of the Peak", ["dragon"], 691, [766, 775]),
    ("meadow-knights", "Meadow Knights", ["warrior", "beast-warrior"], 692, [778, 752]),
    ("dark-arts", "Dark Arts", ["spellcaster", "fiend"], 694, [762, 782]),
    ("iron-legion", "Iron Legion", ["machine", "rock"], 690, [774, 784]),
    ("deep-tide", "Deep Tide", ["aqua", "fish", "sea-serpent"], 693, [777, 783]),
    ("wild-hunt", "Wild Hunt", ["beast", "insect", "plant"], 689, [759, 756]),
    ("restless-dead", "Restless Dead", ["zombie", "fiend"], 694, [772, 782]),
    ("storm-wings", "Storm Wings", ["winged-beast", "thunder", "fairy"], 691, [776, 763]),
]

# Level bands and how many monsters come from each: a deck needs cheap bodies
# for the early turns and a few heavy hitters for when the stars pile up.
CURVE = [((1, 3), 8), ((4, 4), 8), ((5, 6), 6), ((7, 12), 2)]
SUPPORT_SPELLS = [704, 705, 712, 726, 716, 780]  # heal, heal, burn, removal, reveal, any-monster power-up
SUPPORT_TRAPS = [809, 808, 801, 828]             # two pits, a binding circle, a negate


def build_decks(cards):
    by_num = {c["num"]: c for c in cards}
    # Monsters that only exist as the result of a ritual do not go in a deck.
    rituals = " ".join(c.get("text", "").split("summon")[-1] for c in cards if c["kind"] == "ritual")
    special = {c["num"] for c in cards if c["kind"] == "monster" and c["name"] in rituals}
    decks = []
    for deck_id, name, types, terrain, equips in DECK_THEMES:
        pool = [c for c in cards if c["kind"] == "monster" and c["type"] in types
                and c["num"] < 900 and c["num"] not in special]
        picked = []
        for (low, high), count in CURVE:
            band = sorted(
                (c for c in pool if low <= c["level"] <= high),
                key=lambda c: (-(c["atk"] + c["def"]), c["num"]),
            )
            # Two copies of the best, then singles, until the band is full.
            chosen = []
            for card in band:
                if len(chosen) >= count:
                    break
                copies = 2 if len(chosen) + 2 <= count and len(chosen) < count // 2 else 1
                chosen.extend([card["num"]] * copies)
            picked.extend(chosen[:count])

        spells = [terrain, terrain] + equips + [equips[0]] + SUPPORT_SPELLS
        traps = SUPPORT_TRAPS + [SUPPORT_TRAPS[0]]
        deck = picked + spells + traps

        # Pad or trim to exactly 40 with level 4 monsters from the theme.
        fillers = sorted((c for c in pool if c["level"] <= 4), key=lambda c: (-c["atk"], c["num"]))
        index = 0
        while len(deck) < 40 and fillers:
            candidate = fillers[index % len(fillers)]["num"]
            if deck.count(candidate) < 3:
                deck.append(candidate)
            index += 1
            if index > 400:
                break
        deck = deck[:40]

        leader = max((by_num[n] for n in picked), key=lambda c: (c["level"], c["atk"]))
        cost = sum(by_num[n]["deckCost"] for n in deck)
        decks.append({
            "id": "starter-" + deck_id, "name": name, "leaderNum": leader["num"],
            "cards": sorted(deck), "deckCost": cost,
            "description": "%s deck built around %s terrain." % (" / ".join(t.title() for t in types), by_num[terrain]["name"]),
        })
    return decks


def write(name, data):
    path = os.path.join(OUT, name)
    with open(path, "w") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print("wrote", os.path.relpath(path, ROOT))


def main():
    with open(SOURCE) as f:
        raw = json.load(f)
    os.makedirs(OUT, exist_ok=True)

    cards = build_cards(raw)
    fusions = build_fusions(cards)
    decks = build_decks(cards)

    write("cards.json", cards)
    write("fusions.json", fusions)
    write("starter-decks.json", decks)

    spells = [c for c in cards if c["kind"] != "monster"]
    print("%d cards: %d monsters, %d spell/trap/ritual (%d with working effects), %d fusions, %d starter decks" % (
        len(cards), len(cards) - len(spells), len(spells),
        sum(1 for c in spells if c["implemented"]), len(fusions), len(decks)))
    for deck in decks:
        assert len(deck["cards"]) == 40, deck["name"]
        assert max(deck["cards"].count(n) for n in deck["cards"]) <= 3, deck["name"]


if __name__ == "__main__":
    main()
