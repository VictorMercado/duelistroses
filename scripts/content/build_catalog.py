#!/usr/bin/env python3
"""Builds the content service's card data from the raw card dump.

    python3 scripts/content/build_catalog.py

Reads  scripts/content/source/dor_raw.json (one record per card: number, name, stats, text)
Writes content/data/cards.json             (the catalog the server serves)
       content/data/fusions.json           (fusion recipes)
       content/data/starter-decks.json     (ready-made 40 card decks)

The server embeds content/data, so rebuild it after running this.

A card's behaviour is described as data ("effect": {"op": ...}) that the game
server's rules engine interprets. Cards whose behaviour the engine does not
have an op for yet are still in the catalog, flagged "implemented": false, so
the deck builder can show them and the game simply treats them as inert.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SOURCE = os.path.join(HERE, "source", "dor_raw.json")
OUT = os.path.join(ROOT, "content", "data")
CARD_ART = os.path.join(ROOT, "content", "assets", "cards")


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

def equip(amount, types=None, attrs=None, name=None, nums=None, grant=None, maxAtk=None):
    e = {"op": "equip", "amount": amount}
    if types:
        e["types"] = types
    if attrs:
        e["attrs"] = attrs
    if name:
        e["name"] = name
    if nums:
        e["nums"] = sorted(nums)
    if maxAtk:
        e["maxAtk"] = maxAtk
    if grant:
        e["grant"] = grant
    return e


def trap(op, **extra):
    return {"op": op, "trigger": "move", "range": "limited", **extra}


def reaction(op, trigger, **extra):
    return {"op": op, "trigger": trigger, "range": "full", **extra}


# Monsters a few power-ups single out. Female monsters are the ones the
# game's own fusion table calls female; horns and shells are by the art.
FEMALE = [35, 39, 42, 43, 44, 47, 48, 49, 50, 53, 70, 79, 80, 81, 87, 89, 92, 95, 96, 141, 150, 180,
          184, 186, 187, 192, 195, 200, 201, 202, 203, 204, 221, 245, 272, 273, 356, 368, 369, 373,
          374, 378, 382, 385, 387, 394, 462, 467, 475, 539, 565, 566, 576, 577, 578, 579, 605, 610,
          611, 612, 648, 653, 667]
HORNED_DARK = [10, 292, 293, 294, 295, 339, 362]
HORNED_OTHER = [211, 229, 265, 301, 398]
SHELLED = [149, 395, 503, 520, 549, 552, 557, 558, 571, 584, 585, 591, 592, 596, 598]


def ab(op, on="", **extra):
    """A monster ability: what it does (op) and when (on)."""
    a = {"op": op}
    if on:
        a["on"] = on
    a.update(extra)
    return a


def bonus(amount, *types):
    return ab("battleBonus", types=list(types), amount=amount)


def flip_boost(amount, **filters):
    return ab("boost", "flip", amount=amount, **filters)


def crush_on_death():
    return ab("terrain", "destroyed", terrain="crush", shape="ring", radius=1)


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
    686: {"op": "reviveCard", "side": "enemy", "kinds": ["spell"]},
    687: {"op": "reviveCard"},
    688: {"op": "reviveCard", "kinds": ["spell"]},
    698: {"op": "magicLabyrinth"},
    718: {"op": "peekHand"},
    719: {"op": "spyTypes"},
    731: {"op": "meteor", "count": 10},
    745: {"op": "convert", "side": "own", "toType": "zombie"},
    750: {"op": "earthshaker"},
    751: {"op": "creatureSwap"},
    760: equip(500, nums=SHELLED),
    764: equip(500, nums=HORNED_OTHER),
    765: equip(500, nums=HORNED_DARK),
    767: equip(500, nums=FEMALE),
    768: equip(500, nums=FEMALE),
    770: equip(500, types=["fiend"], nums=FEMALE),
    790: equip(0, nums=[297], grant=[ab("reviveSelf", "destroyed"), ab("summon", "flip", summon=297, faceDown=True)]),
    791: equip(0, ["warrior"], grant=[ab("autoDestroy", types=["dragon"])]),
    792: equip(0, ["fairy"], grant=[ab("autoDestroy", types=["fiend"])]),
    793: equip(0, ["plant"], grant=[ab("autoDestroy", types=["spellcaster"])]),
    794: equip(500, maxAtk=1000, grant=[crush_on_death()]),
    795: {"op": "spellbindExcept", "types": ["machine"], "turns": -1},
    # These only work through the fusion table (Elegant Egotist, Cocoon of
    # Evolution, Metalmorph); Insect Imitation turns an egg into something else.
    797: {"op": "morph"},
    798: {"op": "morph"},
    799: {"op": "morph"},
    800: {"op": "imitation"},
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
    813: reaction("trapJam", "spell"),
    814: reaction("trapReflect", "spell", nums=[789], permanent=True),
    815: reaction("trapBackfire", "heal", permanent=True),
    816: reaction("trapReverse", "powerUp", permanent=True),
    817: trap("trapBind", turns=1),
    818: trap("trapForceAttack", trigger="defense", permanent=True),
    819: trap("trapGorgon", trigger="defense", permanent=True),
    820: reaction("trapJam", "spell", nums=[702]),
    821: reaction("trapJam", "spell", nums=[700], permanent=True),
    822: reaction("trapJam", "spell", counters=["revive", "reviveCard"], permanent=True),
    823: reaction("trapJam", "spell"),
    824: reaction("trapShield", "spell", nums=[699], permanent=True),
    825: reaction("trapDecree", "trap", permanent=True),
    826: reaction("trapJam", "spell", kinds=["ritual"], permanent=True),
    827: reaction("trapMirrorForce", "attack"),
    828: reaction("trapNegate", "attack"),
    829: reaction("trapWeaken", "attack"),
}

# Deck leader passives (see game/engine/leader.go), and the cards whose
# ability is carried out by one of them.
LEADERS = {
    # Exodia the Forbidden One: a seat it leads wins when one of its turns
    # begins with all four limbs on the field, face up and not spellbound.
    # The limbs are drawn and played one by one like any card.
    58: {"op": "assembleLimbs", "cards": [54, 55, 56, 57]},
}
LEADER_PARTS = {54, 55, 56, 57}

# Monster abilities the engine carries out, by card number (see
# game/engine/abilities.go for the ops and the moments they work at). The
# five oldest keep their single "effect"; the rest are lists of "abilities".
MONSTER_EFFECTS = {
    388: {"op": "halveDamage"},  # Tenderness: halves damage to its side's LP while in defense
    498: {"op": "breakLabyrinth"},  # Cannon Soldier: can enter labyrinth squares, turning them to normal terrain
    506: {"op": "blastOnDestroy"},  # Blast Sphere: destroyed in battle, destroys every card in the 3x3 area around it
    528: {"op": "battleBonus", "amount": 2000, "types": ["warrior"]},  # Kinetic Soldier: +2000 ATK/DEF in battles against warriors
    514: {"op": "flipBoostMachines", "amount": 100},  # Machine King: flipped face up, +100 per face-up machine on the field
}

TRAP_IMMUNE = [ab("trapImmune")]
NO_BATTLE_DAMAGE = [ab("noBattleDamage")]
CANCEL_MODS = ab("cancelMods")
CRUSH = crush_on_death()
SEA_AROUND = ab("terrain", "flip", terrain="umi", shape="ring", radius=1)
REVIVE_SELF = [ab("reviveSelf", "destroyed")]
ENEMY_WEAKEN = [ab("boost", "turn", side="enemy", amount=-100)]
SPELLS = ["spell"]

MONSTER_ABILITIES = {
    1: [bonus(300, "fiend")],
    6: [ab("terrain", "battle", terrain="wasteland", shape="here")],
    11: [bonus(900, "spellcaster")],
    13: [ab("terrain", "battle", terrain="normal", shape="ring", radius=1),
         ab("terrain", "flip", terrain="normal", shape="ring", radius=1)],
    16: [ab("imitate", types=["dragon"], attrs=["fire"])],
    25: [ab("evolve", "turn", turns=3, summon=13)],
    35: [flip_boost(800, side="own", attrs=["light"])],
    36: [ab("transform", "flip", types=["dragon"], maxAtk=2399, summon=24)],
    37: [ab("autoDestroy", types=["zombie"])],
    38: TRAP_IMMUNE,
    40: [ab("auraBoost", "aura", attrs=["dark"], amount=-100)],
    42: [ab("heal", "flip", amount=800)],
    43: [ab("reviveSpell", "flip")],
    45: [ab("equipPlus", "aura", amount=200)],
    51: [ab("reveal", "flip")],
    53: NO_BATTLE_DAMAGE,
    61: [ab("spellbindFoe", "battleFlip", turns=3)],
    62: [ab("spellbindFoe", "battleFlip", turns=1)],
    64: [ab("auraBind", "aura", side="enemy", types=["warrior"])],
    66: TRAP_IMMUNE,
    67: [ab("spellbindFoe", "battleFlip", turns=3)],
    72: [ab("weakenFoe", "destroyed", amount=300)],
    73: [flip_boost(700, nums=[312])],
    74: [flip_boost(700, nums=[274])],
    76: [ab("terrain", "flip", terrain="yami", radius=2)],
    77: [bonus(900, "warrior")],
    79: [ab("battleCost", "battle", amount=50)],
    80: [ab("auraBoost", "aura", attrs=["light"], amount=-100)],
    83: [ab("dragonWard", "aura")],
    84: [ab("bind", "flip", side="enemy", turns=1)],
    85: [flip_boost(300, types=["zombie"])],
    87: [ab("boostPerGrave", "flip", nums=[60, 87], amount=500)],
    89: [ab("spellbindFoe", "battleFlip", turns=1)],
    90: [ab("convert", "flip", attrs=["light"], toAttr="dark")],
    95: [ab("heal", "turn", amount=50)],
    98: [ab("destroyNear", "flip", radius=1, kinds=SPELLS)],
    99: NO_BATTLE_DAMAGE,
    101: [flip_boost(300, nums=[101])],
    102: [flip_boost(300, nums=[102])],
    104: [ab("spellbindFoe", "destroyed", turns=-1)],
    108: [ab("boost", "turn", types=["zombie"], amount=100)],
    109: [ab("convert", "flip", side="own", toType="zombie")],
    111: [ab("destroyFoe", "destroyed")],
    112: [ab("convert", "flip", side="own", toType="zombie")],
    113: [ab("noSpells", "aura")],
    114: TRAP_IMMUNE,
    115: [ab("destroyTerrain", "flip", terrain="sogen")],
    116: [ab("convertFoe", "battleFlip", toType="zombie")],
    118: [ab("destroyTerrain", "flip", terrain="umi")],
    119: [flip_boost(500, nums=[119])],
    123: [ab("enterLabyrinth", summon=144)],
    127: TRAP_IMMUNE,
    128: [ab("moveTerrain", "move", terrain="wasteland")],
    135: [bonus(900, "fiend"), flip_boost(300, attrs=["light"])],
    137: [ab("noBattleDamage"), ab("summon", "flip", summon=137)],
    140: [ab("weakenFoe", "destroyed", amount=300)],
    141: [flip_boost(300, nums=[150])],
    143: [bonus(600, "dragon")],
    144: [ab("enterLabyrinth")],
    145: NO_BATTLE_DAMAGE,
    146: [ab("boostPerGrave", "flip", side="own", amount=100)],
    148: [bonus(800, "spellcaster")],
    149: [ab("copyStrongest", "flip")],
    151: [bonus(300, "dinosaur")],
    152: [flip_boost(300, types=["warrior"])],
    153: [flip_boost(500, nums=[197])],
    156: [ab("noControl", "aura")],
    161: [bonus(500, "beast")],
    163: [flip_boost(300, types=["warrior"])],
    164: [ab("spellbindFoe", "battleFlip", turns=-1)],
    167: [ab("imitate", types=["beast-warrior"], attrs=["earth"])],
    170: [flip_boost(500, nums=[171])],
    171: [flip_boost(500, nums=[170])],
    175: [ab("copyStrongest", "flip")],
    176: [ab("summon", "flip", summon=176)],
    178: TRAP_IMMUNE,
    181: [flip_boost(300, types=["plant"])],
    183: [ab("banish")],
    186: [flip_boost(500, nums=[203])],
    189: [ab("auraBoost", "aura", side="own", amount=1000, stat="def")],
    190: [flip_boost(300, types=["insect"])],
    191: [ab("destroyFoe", "destroyed")],
    192: [flip_boost(300, types=["beast"])],
    193: TRAP_IMMUNE,
    195: [bonus(900, "warrior")],
    197: [flip_boost(500, nums=[153])],
    201: [flip_boost(700, nums=[204])],
    203: [flip_boost(500, nums=[186])],
    206: [ab("spellbindFoe", "destroyed", turns=1)],
    213: [flip_boost(300, terrain="mountain")],
    216: [ab("spellbindFoe", "destroyed", turns=3)],
    217: [ab("banish")],
    220: [bonus(900, "rock")],
    224: [ab("maxStars", "flip")],
    228: [ab("returnSelf", "destroyed")],
    236: [flip_boost(500, nums=[259])],
    242: TRAP_IMMUNE,
    247: [ab("spellbindFoe", "battleFlip", turns=1)],
    248: [ab("fastMove")],
    255: [ab("destroyFoe", "battleFlip", types=["zombie"])],
    257: [ab("returnSelf", "flip")],
    266: [ab("fastMove")],
    268: [ab("extraPlay", "flip")],
    272: [flip_boost(300, nums=[30])],
    273: [flip_boost(900, nums=[30])],
    274: [ab("summon", "flip", summon=74, faceDown=True)],
    276: [ab("reveal", "flip", maxAtk=500, kinds=["monster"])],
    291: [ab("auraBoost", "aura", side="own", types=["winged-beast"], amount=300)],
    295: [ab("jigen", "flip", nums=[621])],
    297: NO_BATTLE_DAMAGE,
    298: [ab("auraBoost", "aura", types=["fiend"], amount=500)],
    299: TRAP_IMMUNE,
    305: [ab("reviveSpell", "flip")],
    310: [ab("jigen", "flip", nums=[621])],
    311: [ab("spellbindFoe", "battleFlip", turns=3)],
    313: [ab("seeClass", "aura")],
    316: [ab("spellbindFoe", "destroyed", turns=1)],
    317: NO_BATTLE_DAMAGE,
    322: [ab("damagePlus", "aura", amount=100)],
    325: [ab("position", "flip", position="attack")],
    326: ENEMY_WEAKEN,
    328: [ab("evolve", "turn", turns=3, summon=292)],
    332: [ab("imitate", types=["zombie"], attrs=["dark"])],
    338: [ab("starsMinus", "aura")],
    344: [ab("revealLast", "flip")],
    346: [ab("burn", "destroyed", amount=500)],
    348: [bonus(500, "dragon")],
    349: [ab("weakenFoe", "battleFlip", amount=500)],
    352: REVIVE_SELF,
    353: [ab("boostIfLeader", "flip", nums=[173], amount=1500)],
    357: [ab("identify", "flip")],
    361: [ab("returnFoe", "battleFlip")],
    364: [ab("maxStars", "flip")],
    365: [ab("damagePlus", "aura", amount=200)],
    368: [flip_boost(1000, side="own", maxAtk=1000)],
    371: [ab("terrain", "flip", terrain="wasteland", shape="ring", radius=1)],
    372: [ab("auraBind", "aura", types=["fiend"])],
    374: [ab("position", "flip", position="defense")],
    375: [CANCEL_MODS],
    376: REVIVE_SELF,
    377: [ab("massRevive", "destroyed", minLP=1000, count=4, cost=1000)],
    379: [ab("imitate", name="elf")],
    380: [CANCEL_MODS],
    382: [ab("whim", amount=1500)],
    383: [flip_boost(300, side="own", attrs=["light"])],
    384: [ab("extraPlay", "destroyed")],
    386: [ab("auraBind", "aura", types=["warrior"])],
    387: [flip_boost(700, nums=[46])],
    389: [ab("spellbindFoe", "battleFlip", turns=1)],
    390: [ab("rally", "destroyed", minLP=1000, amount=1000, cost=1000)],
    395: [ab("fastMove")],
    402: ENEMY_WEAKEN,
    403: ENEMY_WEAKEN,
    404: [ab("spellbindFoe", "battleFlip", turns=1)],
    408: [CANCEL_MODS, ab("moveCost", "move", amount=100)],
    409: [ab("enterLabyrinth")],
    410: [ab("teleport", "flip", side="enemy")],
    411: TRAP_IMMUNE,
    415: [ab("weakenCross", "destroyed", amount=300)],
    417: [ab("destroyFoe", "battleFlip")],
    418: ENEMY_WEAKEN,
    422: [bonus(600, "dragon")],
    427: [ab("immobile"), ab("evolve", "turn", turns=5, summon=428), ab("reviveSelf", "destroyed", summon=401)],
    428: [ab("immobile"), ab("evolve", "turn", turns=1, summon=403), ab("reviveSelf", "destroyed", summon=402)],
    429: [ab("terrain", "flip", terrain="forest", radius=2), ab("boostIfLeader", "flip", types=["insect"], amount=1500)],
    432: [ab("auraBoost", "aura", attrs=["wind"], amount=500)],
    447: [ab("noMoveBonus", "aura")],
    456: [ab("zeroStars", "destroyed")],
    457: [ab("hide", "flip", side="own", kinds=SPELLS)],
    458: [flip_boost(900, side="own", types=["reptile"])],
    461: [SEA_AROUND],
    469: [bonus(500, "machine")],
    470: [ab("weakenFoe", "battleFlip", amount=500)],
    472: [ab("autoDestroy", types=["warrior"])],
    476: [SEA_AROUND],
    478: [ab("terrain", "battle", terrain="umi", shape="here")],
    480: [ab("boostPerField", "flip", types=["thunder"], amount=300)],
    486: [ab("enterLabyrinth")],
    490: [ab("burn", "destroyed", amount=300)],
    493: NO_BATTLE_DAMAGE,
    495: [ab("terrain", "battle", terrain="wasteland", shape="here")],
    496: [ab("auraBoost", "aura", side="own", types=["machine"], amount=300)],
    500: [ab("breakLabyrinth")],
    502: [ab("destroyRandom", "flip")],
    509: [ab("blastOnDestroy", "destroyed")],
    510: [ab("auraBoost", "aura", side="own", types=["machine"], amount=300)],
    519: REVIVE_SELF,
    523: [ab("reveal", "flip", side="enemy", kinds=SPELLS)],
    530: [ab("jigen", "flip", nums=[621])],
    533: [bonus(800, "fish")],
    534: NO_BATTLE_DAMAGE,
    536: [ab("auraBoost", "aura", nums=FEMALE, amount=-500)],
    537: [bonus(1000, "machine")],
    539: [ab("auraMove", "aura", types=["thunder"])],
    541: [ab("spellbindFoe", "battleFlip", turns=1)],
    542: [ab("auraBoost", "aura", types=["machine"], amount=-500)],
    545: [ab("controlFoe", "battleFlip", types=["machine"])],
    551: [ab("auraBoost", "aura", types=["thunder"], amount=-500)],
    552: [ab("breakLabyrinth")],
    554: [ab("summon", "flip", summon=594)],
    560: [flip_boost(800, nums=[600])],
    561: [ab("spellbindFoe", "destroyed", turns=1)],
    563: [ab("terrain", "battle", terrain="umi", shape="here"), SEA_AROUND],
    564: [bonus(1000, "machine")],
    565: [ab("hide", "flip", side="own", kinds=SPELLS)],
    567: [ab("destroyFoe", "destroyed")],
    568: [SEA_AROUND],
    570: [ab("copyFoe", "battleFlip")],
    571: NO_BATTLE_DAMAGE,
    573: NO_BATTLE_DAMAGE,
    574: [ab("terrain", "flip", terrain="umi", shape="row")],
    575: [ab("teleport", "flip", side="enemy")],
    580: [bonus(1000, "fish")],
    582: [ab("spellbindFoe", "battleFlip", turns=1)],
    589: [ab("terrain", "destroyed", terrain="umi", shape="ring", radius=1)],
    591: [ab("teleport", "flip", side="own")],
    593: [flip_boost(300, side="own", types=["aqua"])],
    594: [ab("healDouble", "aura")],
    599: [SEA_AROUND],
    600: [flip_boost(800, nums=[560])],
    612: [ab("auraBoost", "aura", side="own", types=["aqua"], amount=500)],
    613: [ab("unbind", "flip")],
    616: TRAP_IMMUNE,
    617: [ab("destroyNear", "destroyed", radius=1, kinds=SPELLS)],
    621: [ab("jigenBlast", "turn", turns=2)],
    622: [ab("auraBoost", "aura", side="own", types=["pyro"], amount=500)],
    624: [ab("hide", "flip", side="own", kinds=SPELLS)],
    627: [ab("freezeCountdown", "aura")],
    629: [ab("destroyTerrain", "flip", terrain="mountain")],
    635: [ab("breakLabyrinth")],
    639: [ab("boostPerGrave", "flip", side="own", amount=300)],
    642: [ab("unbind", "flip", side="own")],
    647: [ab("terrain", "destroyed", terrain="crush", shape="ring", radius=1)],
    649: [flip_boost(500, nums=[196])],
    652: [ab("destroyTerrain", "flip", terrain="forest")],
    654: [ab("heal", "flip", amount=500)],
    655: [ab("noTraps", "aura")],
    656: [flip_boost(500, nums=[667])],
    659: [ab("controlFoe", "battleFlip")],
    668: [bonus(2500, "fiend")],
    670: [ab("auraBoost", "aura", side="own", types=["plant"], amount=500)],
    672: [ab("controlFoe", "battleFlip"), CRUSH],
    673: [ab("souleater", "turn", amount=200), CRUSH],
    674: [flip_boost(500, side="own", types=["immortal"]), CRUSH],
    675: [ab("shapesnatch"), CRUSH],
    676: [ab("caratPull", "turn"), CRUSH],
    677: [ab("controlAll", "flip", types=["machine"]), CRUSH],
    678: [ab("fastCountdown", "aura"), CRUSH],
    679: [ab("moveBurn", "move", amount=50), CRUSH],
    680: [ab("starsPlus", "aura"), CRUSH],
    681: [ab("discardHands", "flip"), CRUSH],
    682: [ab("noLeader", "aura"), CRUSH],
}

# Monsters whose text describes a fusion recipe (Metalmorph, Cocoon of
# Evolution, Elegant Egotist): the fusion table already carries it out.
FUSION_TEXT = {7, 342, 401, 407, 416, 423, 426}

# Cards that were not in the original set. Numbers from 900 up are ours.
CUSTOM = [
    {"num": 900, "name": "Pot of Greed", "kind": "spell", "deckCost": 40,
     "text": "Draw 2 cards from your deck.", "effect": {"op": "draw", "amount": 2}},
    {"num": 901, "name": "Trap Hole", "kind": "trap", "deckCost": 20,
     "text": "Disposable trap that triggers when an enemy monster with ATK of 1000 or more moves next to it, and destroys it.",
     "effect": trap("trapDestroy", minAtk=1000)},
]

KINDS = {"Monster Card": "monster", "Spell Card": "spell", "Trap Card": "trap", "Ritual Card": "ritual"}

# --- fusion recipes ---------------------------------------------------------
# The game's own fusion table, datamined, fetched by fetch_fusions.py. Each
# group is "any card of A + any card of B"; the conditions (types, female
# monsters, ATK limits, named cards) are already spelled out as those lists.
FUSIONS_SOURCE = os.path.join(HERE, "source", "dor_fusions.json")


def build_cards(raw):
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
            # A monster with text has an ability (MONSTER_ABILITIES); one not
            # wired up yet is flagged abilityPending and plays as a plain monster.
            card["implemented"] = True
            if r["num"] in LEADERS:
                card["leader"] = LEADERS[r["num"]]
            elif r["num"] in MONSTER_EFFECTS:
                card["effect"] = MONSTER_EFFECTS[r["num"]]
            elif r["num"] in MONSTER_ABILITIES:
                card["abilities"] = MONSTER_ABILITIES[r["num"]]
            elif text and "favors" not in card and r["num"] not in LEADER_PARTS and r["num"] not in FUSION_TEXT:
                card["abilityPending"] = True
        else:
            effect = EFFECTS.get(r["num"])
            if effect:
                card["effect"] = effect
            card["implemented"] = effect is not None

        # The client draws the numbered art (upscaled), with its own mask from build_masks.py.
        card["image"] = "cards/%03d.png" % r["num"]
        if os.path.isfile(os.path.join(CARD_ART, "%03d_Mask.png" % r["num"])):
            card["mask"] = "cards/%03d_Mask.png" % r["num"]
        cards.append(card)

    for custom in CUSTOM:
        card = dict(custom)
        card["implemented"] = True
        card["custom"] = True
        cards.append(card)
    return cards


def build_fusions(cards):
    # Materials are usually monsters, but a few spells fuse too (Metalmorph...).
    by_num = {c["num"]: c for c in cards}
    by_name = {key(c["name"]): c for c in cards if c["kind"] == "monster"}
    with open(FUSIONS_SOURCE) as f:
        table = json.load(f)["fusions"]
    fusions, missing = [], set()
    for entry in table:
        result = by_name.get(key(entry["result"])) or by_name.get(key(re.sub(r" (\d)$", r" #\1", entry["result"])))
        if not result:
            missing.add(entry["result"])
            continue
        for group in entry["groups"]:
            a = [n for n in group["a"] if n in by_num]
            b = [n for n in group["b"] if n in by_num]
            missing.update("#%03d" % n for n in group["a"] + group["b"] if n not in by_num)
            if a and b:
                fusion = {"a": {"nums": a}, "b": {"nums": b}, "result": result["num"]}
                if entry.get("rule"):
                    fusion["rule"] = entry["rule"]
                fusions.append(fusion)
    if missing:
        print("fusion cards not in the catalog (skipped):", ", ".join(sorted(missing)), file=sys.stderr)
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


# Hand-built starter decks, for strategies the generator cannot see.
HANDMADE_DECKS = [
    {
        "id": "starter-forbidden-one",
        "name": "The Forbidden One",
        # Exodia leads: a turn that begins with all four limbs face up on the
        # field wins. The limbs are drawn and played one by one.
        "leaderNum": 58,
        "cards": [
            54, 54, 55, 55, 56, 56, 57, 57,      # the four limbs, two each to draw them sooner
            59, 59, 335, 335,                    # low-level walls
            100, 100, 298, 298, 361, 361, 35, 35,
            348, 348,                            # mid-level defenders
            60, 75,                              # finishers
            694, 694,                            # Yami: spellcasters and fiends grow stronger
            715,                                 # Swords of Revealing Light: hold the enemy back
            704, 705, 705, 780, 762, 716, 712,
            823, 823,                            # Magic Jammer: stop the spell that would break a limb
            828, 828, 801, 809,
        ],
        # No Fissure or board wipes: they would destroy the limbs too.
        "description": "Exodia leads: play the four limbs one by one, flip them face up, and win when a turn begins with all four on the field.",
    },
]


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
    for made in HANDMADE_DECKS:
        assert len(made["cards"]) == 40, made["id"]
        decks.append({
            "id": made["id"], "name": made["name"], "leaderNum": made["leaderNum"],
            "cards": sorted(made["cards"]), "deckCost": sum(by_num[n]["deckCost"] for n in made["cards"]),
            "description": made["description"],
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
