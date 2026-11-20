"""Vérifie la banque d'exercices avant chaque envoi.

Usage :
    python outils/verifier.py                     # vérifie data/*.json
    python outils/verifier.py --interdits "a,b"   # refuse aussi ces mots (insensible à la casse)
    python outils/verifier.py --avant-commit      # refuse les fichiers modifiés hors data/*.json et sw.js

Sort avec le code 1 et la liste des problèmes si quelque chose ne va pas.
"""
import argparse
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
DATA = RACINE / "data"
NIVEAUX = {"B1", "B2", "C1"}
TYPES = {
    "ce": {"qcm"},
    "co": {"qcm", "dictee"},
    "ee": {"correction", "redaction"},
    "eo": {"dire", "shadow", "situation"},
}
CHAMPS = {
    "dictee": ["audio"],
    "correction": ["wrong", "answers", "explain"],
    "redaction": ["prompt", "model", "checklist", "min"],
    "dire": ["target"],
    "shadow": ["audio"],
    "situation": ["prompt", "model", "checklist"],
}
COURRIEL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")


def categories():
    """Lit la liste des catégories dans js/adaptation.js, pour ne pas la recopier ici."""
    js = (RACINE / "js" / "adaptation.js").read_text(encoding="utf-8")
    bloc = js.split("export const CATEGORIES = {", 1)[1].split("};", 1)[0]
    return {a or b for a, b in re.findall(r"(?:'([\w-]+)'|\b([a-z]\w*))\s*:", bloc)}


def mots(texte):
    return len(str(texte).split())


def verifier_exercice(e, fichier, cats_ok, pb):
    ref = f"{fichier}:{e.get('id', '?')}"
    skill, niveau, typ = e.get("skill"), e.get("level"), e.get("type")
    if skill != fichier:
        pb.append(f"{ref} : skill « {skill} » au lieu de « {fichier} »")
    if niveau not in NIVEAUX:
        pb.append(f"{ref} : niveau « {niveau} » inconnu (B1, B2 ou C1)")
    if typ not in TYPES.get(fichier, set()):
        pb.append(f"{ref} : type « {typ} » impossible pour {fichier}")
        return
    for c in CHAMPS.get(typ, []):
        if not e.get(c):
            pb.append(f"{ref} : champ « {c} » manquant ou vide")
    cats = list(e.get("cats") or [])
    if typ == "qcm":
        qs = e.get("questions")
        if not isinstance(qs, list) or not qs:
            pb.append(f"{ref} : « questions » doit être une liste non vide")
            qs = []
        for i, q in enumerate(qs, 1):
            opts = q.get("options")
            if not q.get("q"):
                pb.append(f"{ref} q{i} : question vide")
            if not isinstance(opts, list) or len(opts) != 4 or len(set(opts)) != 4 or not all(opts):
                pb.append(f"{ref} q{i} : il faut 4 options différentes et non vides")
            if not isinstance(q.get("answer"), int) or not 0 <= q["answer"] <= 3:
                pb.append(f"{ref} q{i} : « answer » doit être un entier de 0 à 3")
            cats.append(q.get("cat"))
        if fichier == "ce":
            n = mots(e.get("text", ""))
            if not 150 <= n <= 400:
                pb.append(f"{ref} : le texte fait {n} mots (il en faut 150 à 400)")
        if fichier == "co" and mots(e.get("audio", "")) < 25:
            pb.append(f"{ref} : l'audio est trop court pour un QCM d'écoute (25 mots au moins)")
    else:
        if not cats:
            pb.append(f"{ref} : « cats » manquant")
    if typ == "dictee" and not 5 <= mots(e.get("audio", "")) <= 25:
        pb.append(f"{ref} : une dictée fait 5 à 25 mots")
    if typ == "correction":
        norm = lambda s: re.sub(r"[^a-z0-9' ]", "", str(s).lower()).split()
        if any(norm(a) == norm(e.get("wrong")) for a in e.get("answers") or []):
            pb.append(f"{ref} : la phrase fausse figure parmi les bonnes réponses")
    if typ in ("redaction", "situation"):
        if not isinstance(e.get("checklist"), list) or len(e["checklist"]) < 2:
            pb.append(f"{ref} : la grille « checklist » doit avoir 2 points au moins")
    for c in cats:
        if c not in cats_ok:
            pb.append(f"{ref} : catégorie « {c} » inconnue")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--interdits", default="")
    ap.add_argument("--avant-commit", action="store_true")
    args = ap.parse_args()
    pb, ids, compte = [], Counter(), Counter()
    cats_ok = categories()
    if not cats_ok:
        print("Impossible de lire les catégories dans js/adaptation.js")
        return 1

    for f in ["ce", "co", "ee", "eo"]:
        try:
            liste = json.loads((DATA / f"{f}.json").read_text(encoding="utf-8"))
        except Exception as err:
            pb.append(f"data/{f}.json illisible : {err}")
            continue
        for e in liste:
            ids[e.get("id")] += 1
            compte[(f, e.get("level"))] += 1
            verifier_exercice(e, f, cats_ok, pb)

    try:
        vocab = json.loads((DATA / "vocab.json").read_text(encoding="utf-8"))
        for t in vocab["termes"]:
            ids[t.get("id")] += 1
            if not (t.get("fr") and t.get("ex") and isinstance(t.get("en"), list) and t["en"]):
                pb.append(f"vocab:{t.get('id')} : il faut fr, en (liste) et ex")
        compte[("voc", "B2")] = len(vocab["termes"])
    except Exception as err:
        pb.append(f"data/vocab.json illisible : {err}")
    for f in ["indien", "liens"]:
        try:
            json.loads((DATA / f"{f}.json").read_text(encoding="utf-8"))
        except Exception as err:
            pb.append(f"data/{f}.json illisible : {err}")

    for i, n in ids.items():
        if not i:
            pb.append("un exercice n'a pas d'identifiant")
        elif n > 1:
            pb.append(f"identifiant en double : {i} ({n} fois)")

    brut = "\n".join(p.read_text(encoding="utf-8") for p in DATA.glob("*.json"))
    for adr in set(COURRIEL.findall(brut)):
        pb.append(f"adresse e-mail interdite dans les données : {adr}")
    for mot in filter(None, (m.strip() for m in args.interdits.split(","))):
        if mot.lower() in brut.lower():
            pb.append(f"mot interdit présent dans les données : {mot}")

    if args.avant_commit:
        sortie = subprocess.run(["git", "status", "--porcelain"], cwd=RACINE, capture_output=True, text=True).stdout
        for ligne in sortie.splitlines():
            chemin = ligne[3:].strip().strip('"')
            if not (re.fullmatch(r"data/[\w-]+\.json", chemin) or chemin == "sw.js"):
                pb.append(f"fichier modifié non autorisé : {chemin}")

    print("Exercices par compétence et niveau :")
    for (f, n), k in sorted(compte.items()):
        print(f"  {f} {n} : {k}")
    if pb:
        print(f"\n{len(pb)} problème(s) :")
        for p in pb:
            print("  - " + p)
        return 1
    print("\nTout est valide.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
