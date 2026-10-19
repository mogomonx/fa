"""
Compares full-results.json from two folders (e.g. parse-export.js output vs
extract-from-parquet.py output) entry by entry, ignoring order and formatting.

    python scripts/compare-full-results.py <dirA> <dirB> <slug> [slug ...]

Exits 1 if any list differs.
"""
import json
import os
import sys

FIELDS = ["name", "competitionName", "date", "roundName", "roundRank", "pos", "single", "average", "attempts"]


def load(path):
    entries = json.load(open(path, encoding="utf-8"))["entries"]
    return {(e["wcaId"], e["competitionId"], e["eventId"], e["round"]): e for e in entries}, len(entries)


def main():
    a_dir, b_dir, *slugs = sys.argv[1:]
    bad = 0
    for slug in slugs:
        a, na = load(os.path.join(a_dir, slug, "full-results.json"))
        b, nb = load(os.path.join(b_dir, slug, "full-results.json"))
        only_a = a.keys() - b.keys()
        only_b = b.keys() - a.keys()
        diffs = {f: [] for f in FIELDS}
        for k in a.keys() & b.keys():
            for f in FIELDS:
                if a[k].get(f) != b[k].get(f):
                    diffs[f].append((k, a[k].get(f), b[k].get(f)))
        n_diff = sum(len(v) for v in diffs.values())
        ok = not only_a and not only_b and not n_diff and na == nb
        print(f"{'OK  ' if ok else 'DIFF'} {slug}: A={na} B={nb} onlyA={len(only_a)} onlyB={len(only_b)} fieldDiffs={n_diff}")
        if not ok:
            bad += 1
            for k in list(only_a)[:3]:
                print(f"    only in A: {k}")
            for k in list(only_b)[:3]:
                print(f"    only in B: {k}")
            for f, items in diffs.items():
                for k, va, vb in items[:3]:
                    print(f"    {f} differs at {k}: A={va!r} B={vb!r}")
                if items:
                    print(f"    ({len(items)} total differences in '{f}')")
    sys.exit(1 if bad else 0)


main()
