"""Convert a backed-up single interview without opening or changing the old app."""

import argparse
import hashlib
import json
import re
import shutil
import unicodedata
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path
from urllib.parse import quote, unquote
from uuid import uuid4

from bs4 import BeautifulSoup, Tag

parser = argparse.ArgumentParser()
parser.add_argument("--source", type=Path, required=True)
parser.add_argument("--data", type=Path, required=True)
parser.add_argument("--title", required=True)
parser.add_argument("--company", default="")
parser.add_argument("--role", default="")
parser.add_argument("--speaking-notes", default="")
parser.add_argument("--thread-id")
args = parser.parse_args()


def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def normalize(value):
    return "".join(c for c in unicodedata.normalize("NFKC", value).casefold() if c.isalnum())


def plain(element):
    copy = BeautifulSoup(str(element), "html.parser")
    for annotation in copy.select("rt,rp"):
        annotation.decompose()
    return copy.get_text(" ", strip=True)


def localized(value, language="ja"):
    return {"text": value, "language": language}


def sentence(old):
    data = localized(old["ja"])
    for before, after in (("pronunciation", "reading"), ("ko", "translation")):
        if old.get(before):
            data[after] = localized(old[before], "ko")
    if old.get("rubyHtml") and "<ruby" in old["rubyHtml"]:
        ruby = BeautifulSoup(old["rubyHtml"], "html.parser")
        data["rubyHtml"] = ruby.div.decode_contents() if ruby.div else str(ruby)
    return data


def question(old):
    return {
        "id": old["id"], "sectionId": old["sectionId"], "title": old["title"],
        "prompt": localized(old["promptJa"]), "answer": [sentence(s) for s in old["answer"]],
        "referenceFacts": old["referenceFacts"], "version": old["version"], "status": old["status"],
    }


def note(tag):
    return {"type": "html", "html": str(tag)}


def reference(q):
    return {"type": "question", "questionId": q["id"]}


prep = read(args.source / "prep.json")
progress = read(args.source / "progress.json")
questions = [question(q) for q in prep["questions"]]
originals = {q["id"]: q for q in prep["questions"]}
categories = {}
sections = []
placed = set()
supplemental = Counter()


def similarity(a, b):
    return SequenceMatcher(None, a, b).ratio()


def title_key(title):
    return normalize(title.split(" — ")[0])


def migrate_section(section, qs):
    soup = BeautifulSoup(section["html"], "html.parser")
    for a in soup.select('a[href^="/api/files/"]'):
        name = unquote(a["href"].split("/api/files/", 1)[1])
        a["href"] = "asset:" + quote(name)
    first = soup.find(recursive=False)
    main = next((q for q in qs if q["id"] == section["id"]), None)

    def assign(element):
        if element is first:
            return main
        summary = element.find("summary", recursive=False)
        title = title_key(plain(summary)) if summary else ""
        packs = {x.get("data-learning-id") for x in element.select(":scope > .sentence-pack")}
        units = {normalize(plain(x)) for x in element.select(":scope > .sentence-pack .jp")}
        for q in qs:
            if q is main or q["id"] in placed:
                continue
            old = originals[q["id"]]
            if title and title in {title_key(q["title"]), title_key(q["prompt"]["text"])}:
                return q
            if any(s.get("paragraph") and s["paragraph"] in packs for s in old["answer"]):
                return q
            answer = {normalize(s["text"]) for s in q["answer"]}
            if units and answer and len(units & answer) >= min(2, len(answer)):
                return q
        return None

    def blocks(element, q=None, top=False):
        output = []
        inserted = False
        prompt = normalize(q["prompt"]["text"]) if q else ""
        answer = {normalize(s["text"]) for s in q["answer"]} if q else set()
        if q:
            placed.add(q["id"])
        for child in list(element.children):
            if not isinstance(child, Tag):
                if child.strip():
                    output.append(note(child))
                continue
            if child.name == "summary" or (top and child.name == "h2"):
                continue
            if child.name == "details":
                summary = child.find("summary", recursive=False)
                group_title = plain(summary) if summary else "추가 학습"
                matched = assign(child)
                group = {"type": "group", "title": group_title[:300], "blocks": blocks(child, matched)}
                if child.get("id"):
                    group["anchor"] = child["id"]
                if matched:
                    group["title"] = matched["title"]
                    if main:
                        matched["parentId"] = main["id"]
                output.append(group)
                continue
            if q and ("sentence-pack" in child.get("class", []) or "jp" in child.get("class", [])):
                if not inserted:
                    output.append(reference(q))
                    inserted = True
                if "jp" in child.get("class", []):
                    if normalize(plain(child)) != prompt:
                        output.append(note(child))
                    continue
                for unit in list(child.select(".sentence-unit")):
                    jp = unit.select_one(".jp")
                    if not jp:
                        continue
                    value = normalize(plain(jp))
                    if value == prompt:
                        reading = unit.select_one(".hangul-reading")
                        translation = unit.select_one(".translation")
                        q["promptStudy"] = sentence({
                            "ja": q["prompt"]["text"], "rubyHtml": str(jp),
                            "pronunciation": plain(reading) if reading else "",
                            "ko": plain(translation) if translation else "",
                        })
                        unit.decompose()
                    elif value in answer or any(similarity(value, a) >= 0.86 for a in answer):
                        unit.decompose()
                    else:
                        supplemental[q["id"]] += 1
                if child.select_one(".sentence-unit"):
                    output.append(note(child))
                continue
            output.append(note(child))
        if q and not inserted:
            output.insert(0, reference(q))
        return output

    if first and (first.get("id") == section["id"] or main):
        output = blocks(first, main, top=True)
        output.extend(note(s) for s in first.next_siblings if isinstance(s, Tag))
    elif section["html"]:
        output = [note(soup)]
    else:
        output = []
    for q in qs:
        if q["id"] in placed:
            continue
        if q is main:
            output.insert(0, reference(q))
        else:
            if main:
                q["parentId"] = main["id"]
            output.append({"type": "group", "title": q["title"], "blocks": [reference(q)]})
        placed.add(q["id"])
    return output


for section in prep["sections"]:
    category = section["category"]
    category_id = categories.setdefault(category, f"category-{len(categories) + 1}")
    aliases = [s for s in re.split(r"\||\s+(?=[^|]*$)", prep.get("aliases", {}).get(section["id"], "")) if s]
    qs = [q for q in questions if q["sectionId"] == section["id"]]
    sections.append({
        "id": section["id"], "title": section["title"], "categoryId": category_id,
        "blocks": migrate_section(section, qs), "aliases": aliases,
    })

assert placed == {q["id"] for q in questions}
interview_id = str(uuid4())
directory = args.data / "interviews" / interview_id
history = directory / "history"
history.mkdir(parents=True)
shutil.copytree(args.source / "files", directory / "assets")

manifest = {
    "schemaVersion": 1, "interviewId": interview_id, "title": args.title,
    "company": args.company, "role": args.role, "questionLanguage": "ja",
    "explanationLanguage": "ko", "speakingNotes": args.speaking_notes,
}
write(directory / "manifest.json", manifest)
write(directory / "content.json", {
    "version": prep["version"], "categories": [{"id": v, "title": k} for k, v in categories.items()],
    "sections": sections, "questions": questions,
})


def map_attempt(attempt):
    attempt["interviewId"] = interview_id
    attempt["questionSnapshot"] = question(attempt["questionSnapshot"])
    if attempt["evaluation"]:
        attempt["evaluation"]["corrections"] = [sentence(s) for s in attempt["evaluation"]["corrections"]]
    return attempt


with (history / "events.jsonl").open("w", encoding="utf-8", newline="\n") as out:
    for line in (args.source / "events.jsonl").read_text(encoding="utf-8-sig").splitlines():
        if not line.strip():
            continue
        event = json.loads(line)
        event["interviewId"] = interview_id
        payload = event["payload"]
        payload.pop("prep", None)
        for item in [*payload.get("messages", []), payload.get("session"), payload.get("revision")]:
            if item is not None:
                item["interviewId"] = interview_id
        if "attempt" in payload:
            map_attempt(payload["attempt"])
        out.write(json.dumps(event, ensure_ascii=False) + "\n")

progress["interviewId"] = interview_id
for item in [*progress["sessions"], *progress["messages"], *progress["revisions"]]:
    item["interviewId"] = interview_id
for item in progress["attempts"]:
    map_attempt(item)
write(history / "progress.json", progress)
write(args.data / "settings.json", {"lastInterviewId": interview_id})
if args.thread_id:
    bindings_path = args.data / "thread-bindings.json"
    bindings = read(bindings_path) if bindings_path.exists() else {}
    if args.thread_id in bindings:
        raise ValueError("기존 대화 연결 덮어쓰기 금지")
    write(bindings_path, {**bindings, args.thread_id: interview_id})

write(args.data / "backups" / "migration-receipt.json", {
    "interviewId": interview_id, "questions": len(questions),
    **{key: len(progress[key]) for key in ("sessions", "messages", "attempts", "revisions")},
    "assets": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (directory / "assets").iterdir()},
    "supplementalUnits": supplemental,
})
print(json.dumps({"interviewId": interview_id, "questions": len(questions), "sections": len(sections),
                  "supplementalUnits": supplemental}, ensure_ascii=False))

