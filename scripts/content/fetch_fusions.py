#!/usr/bin/env python3
"""Fetches the Duelists of the Roses fusion table into scripts/content/source/.

    python3 scripts/content/fetch_fusions.py                 # download and convert
    python3 scripts/content/fetch_fusions.py --from FILE     # convert a saved copy of the page source

Source: Yugipedia, "List of Yu-Gi-Oh! The Duelists of the Roses Fusions"
(https://yugipedia.com/wiki/List_of_Yu-Gi-Oh!_The_Duelists_of_the_Roses_Fusions),
which is datamined from the game (GenericMadScientist's DotR fusions table).
Yugipedia text is CC BY-SA.

Each fusion result lists one or more groups of materials: any monster from
group A plus any monster from group B makes the result. The game's conditions
(types, "female" monsters, ATK limits, named cards) are already spelled out as
those card lists, so nothing here has to interpret them; "rule" keeps the
page's one-line summary for people to read.

Writes scripts/content/source/dor_fusions.json, in the page's order. When a pair
of materials appears under two results, the first one listed wins (see
content.Catalog.Fuse). Run build_catalog.py afterwards to rebuild
content/data/fusions.json.
"""
import argparse
import json
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "source", "dor_fusions.json")
PAGE = "List_of_Yu-Gi-Oh!_The_Duelists_of_the_Roses_Fusions"
URL = "https://yugipedia.com/index.php?title=%s&action=raw" % PAGE


def plain(wikitext: str) -> str:
    """'[[Dragon]] + "[[Mystic Lamp (DOR)|Mystic Lamp]]"' -> 'Dragon + "Mystic Lamp"'."""
    text = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", wikitext)
    return re.sub(r"\s*\(DOR\)", "", text).strip()


def parse(text: str) -> list[dict]:
    fusions = []
    for block in re.split(r"\{\{DM Fusion Material", text)[1:]:
        body = block.split("\n}}")[0]
        result = re.search(r"\| result = (.*)", body).group(1).strip()
        result = re.sub(r"\s*\(DOR\)$", "", result)
        rule = re.search(r"\| description =[ \t]*(.*)", body)
        groups = []
        for g in sorted(set(re.findall(r"\| f(\d+)_m1 =", body)), key=int):
            def materials(side: int) -> list[int]:
                part = re.search(r"\| f%s_m%d =\n(.*?)(?=\n\||$)" % (g, side), body, re.S)
                return [int(n) for n in re.findall(r"^\* #(\d+):", part.group(1), re.M)] if part else []
            a, b = materials(1), materials(2)
            if a and b:
                groups.append({"a": a, "b": b})
        if groups:
            fusions.append({"result": result, "rule": plain(rule.group(1)) if rule else "", "groups": groups})
    return fusions


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="source", help="a saved copy of the page's wikitext")
    args = ap.parse_args()
    if args.source:
        with open(args.source, encoding="utf-8") as f:
            text = f.read()
    else:
        request = urllib.request.Request(URL, headers={"User-Agent": "duelistRoses-content-tool"})
        with urllib.request.urlopen(request, timeout=30) as response:
            text = response.read().decode("utf-8")

    fusions = parse(text)
    if not fusions:
        sys.exit("no fusions found: the page layout may have changed")
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"source": "https://yugipedia.com/wiki/" + PAGE, "license": "CC BY-SA", "fusions": fusions}, f, indent=1)
        f.write("\n")
    pairs = sum(len(g["a"]) * len(g["b"]) for x in fusions for g in x["groups"])
    print("wrote %s: %d results, %d groups, %d material pairs" % (
        os.path.relpath(OUT, os.path.dirname(os.path.dirname(HERE))), len(fusions), sum(len(x["groups"]) for x in fusions), pairs))


if __name__ == "__main__":
    main()
