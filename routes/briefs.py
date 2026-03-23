from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta, date, time
from zoneinfo import ZoneInfo
from urllib.parse import urlparse, urlunparse
import hashlib, json, re, uuid, sqlite3
from typing import Literal, Tuple, Union, List
from copy import deepcopy
import os, json, re
from .db import get_conn
from .auth import require_session
from html import escape, unescape

router = APIRouter(prefix="/briefs", tags=["briefs"], dependencies=[Depends(require_session)])

ET = ZoneInfo("America/New_York")
BriefWindow = Literal["daily","weekly","monthly","all"]

DEFAULT_OPTIONS = {
  "timeframe": "window",        # window | lookback | all
  "lookback_days": None,
  "date_basis": "published",    # processed | published
  "themes_include": [],
  "keywords": [],
  "sources_exclude": [],
  "tone": "conversational",     # conversational | executive | researcher
  "format": {
    "style": "paragraphs",
    "length": "medium",         # short|medium|long
    "paragraphs": 5,
    "links_per_item_min": 1,
    "links_per_item_max": 2,
    "length_words": None,
    "since_yesterday": "line"   # line|paragraph|none
  },
  "top_n": 5,
  "candidate_pool": 250,         # hidden in MVP
  "input_per_source_cap": 5,    # hidden in MVP
  "output_per_source_cap": 2,
  "novelty_boost": "none"       # none|mild|strong|extreme
}

LENGTH_TO_TOPN = {"short": 3, "medium": 5, "long": 7}
NOVELTY_MULT = {"none": 1.00, "mild": 1.15, "strong": 1.40, "extreme": 1.80}
KW_BOOST_PER_HIT = float(os.getenv("KW_BOOST_PER_HIT", "0.5"))  # default +10% per hit
KW_BOOST_CAP     = int(os.getenv("KW_BOOST_CAP", "3"))           # cap at 3 hits
MIN_ARTICLE_SCORE = .04
LOOKBACK_MIN_HOURS_FOR_DAILY = 36


# ---- Tease generation helpers ----
_TEASE_BANNED = ("article", "articles", "source", "sources", "coverage", "roundup", "brief")
# --- Boolean keyword query: tokenize → shunting-yard → AST → normalize/eval ---

from dataclasses import dataclass

@dataclass
class _Node:
    op: str                   # AND | OR | NOT | TERM
    left: '_Node' = None
    right: '_Node' = None
    term: str = None          # for TERM
    phrase: bool = False
    wildcard: bool = False    # suffix *

def eval_bool(node: _Node, fields: dict) -> bool:
    if node is None:
        return True
    if node.op == 'TERM':
        blob = _normalize_text(f"{fields.get('title','')} {fields.get('summary','')} {fields.get('full','')}")
        return _match_term(blob, node.term, node.phrase, node.wildcard)
    if node.op == 'NOT':
        return not eval_bool(node.left, fields)
    if node.op == 'AND':
        return eval_bool(node.left, fields) and eval_bool(node.right, fields)
    if node.op == 'OR':
        return eval_bool(node.left, fields) or eval_bool(node.right, fields)
    return True


def eval_fields(node: _Node, title: str, summary: str, full: str) -> tuple[bool,bool,bool]:
    if node is None:
        return (False, False, False)
    title_n  = _normalize_text(title or "")
    summary_n = _normalize_text(summary or "")
    full_n   = _normalize_text(full or "")
    return (
        eval_bool(node, {'title': title_n, 'summary': '', 'full': ''}),
        eval_bool(node, {'title': '', 'summary': summary_n, 'full': ''}),
        eval_bool(node, {'title': '', 'summary': '', 'full': full_n}),
    )

# --- HTML cleanup helpers ---
_TOKEN_RE = re.compile(r'''
    "(.*?)"              |  # 1: double-quoted phrase (no escapes; exact match)
    \(|\)                |  # parens
    \bAND\b|\bOR\b|\bNOT\b | # operators (word boundaries)
    -(?=\S)              |  # prefix minus as NOT
    [^\s()"]+               # bare token
''', re.IGNORECASE | re.VERBOSE)

_TAG_RE = re.compile(r"<[^>]+>")
_SCRIPT_STYLE_RE = re.compile(r"<\s*(script|style)\b[^>]*>.*?</\s*\1\s*>", re.I | re.S)
_URL_RE = re.compile(r"https?://\S+")
_LEAD_TITLE_RE = re.compile(
    r'^\s*["“]?(?:[A-Z0-9][^.!?]{5,180})["”]?\s*[—–-]\s*[^.!?\n]{2,80}\s*[—–-]?\s*',
    re.U
)
_LEADIN_RE = re.compile(
    r"^(?:in\s+the\s+article|the\s+(?:piece|article|study|paper)|"
    r"this\s+(?:piece|article)|an\s+article)\b[^,—–-]*[,—–-]\s*",
    re.I,
)
_DANGLERS_RE = re.compile(r"\b(to|towards?|of|about|that|which|who|where|as|while|because)$", re.I)

# Grab first N sentences exactly as they appear in the rendered brief HTML.
_LI_RE = re.compile(r"<li\b[^>]*>(.*?)</li>", re.I | re.S)
_P_RE  = re.compile(r"<p\b[^>]*>(.*?)</p>", re.I | re.S)
# e.g. "Only 1 item matched filter ((...)) in the selected window."
FILTER_NOTE_RE = re.compile(r'^\s*Only\s+\d+\s+item(?:s)?\s+matched\s+filter', re.IGNORECASE)

def _is_filter_note(text: str) -> bool:
    return bool(FILTER_NOTE_RE.search((text or "").strip()))


def _strip_leadin_title(text: str) -> str:
    t = _strip_html(text or "")
    # If there’s an em/en dash (or hyphen) chunk near the start, drop it.
    t2 = _LEAD_TITLE_RE.sub("", t, count=1).strip()
    return t2 or t

def _strip_html(s: str) -> str:
    if not s:
        return ""
    s = _SCRIPT_STYLE_RE.sub(" ", s)
    s = unescape(s)
    s = _TAG_RE.sub(" ", s)
    s = _URL_RE.sub("", s)
    return re.sub(r"\s+", " ", s).strip()

def _first_sentences_from_brief_html(html: str, n: int = 2, exclude_texts: Optional[List[str]] = None) -> List[str]:
    if not html:
        return []
    ex_norm = {(_strip_html(x).strip() if x else "") for x in (exclude_texts or [])}

    blocks = _LI_RE.findall(html)  # prefer list items
    if not blocks:
        blocks = _P_RE.findall(html)  # fallback to paragraphs

    out = []
    for raw in blocks:
        txt_full = _strip_html(raw).strip()
        if not txt_full:
            continue
        # skip if this block is the note (“Only N items matched …”)
        if txt_full in ex_norm or _is_filter_note(txt_full):
            continue

        # first sentence exactly as shown
        first = re.split(r"(?<=[.!?])\s+", txt_full, maxsplit=1)[0].strip()
        if first and first[-1] not in ".!?":
            first += "."
        out.append(first)
        if len(out) >= n:
            break
    return out

def _tidy_sentence(s: str) -> str:
    """Normalize LLM output into a single, fluent sentence (no titley lead-ins)."""
    s = _strip_html(s or "")

    # drop "In the article …," style preambles
    s = _LEADIN_RE.sub("", s).strip()

    # discourage pronoun starts (It/This/They) → concrete subjects
    s = re.sub(r'^(?i)\s*(it|this)\s+', 'The article ', s)
    s = re.sub(r'^(?i)\s*they\s+', 'Researchers ', s)

    # normalize spaces around punctuation
    s = re.sub(r"\s+([,;:.!?])", r"\1", s)
    s = re.sub(r"\(\s+", "(", s)
    s = re.sub(r"\s+\)", ")", s)

    # ensure sentence end punctuation
    s = s.strip()
    if s and s[-1] not in ".!?":
        s += "."

    # capitalize first visible letter
    for i, ch in enumerate(s):
        if ch.isalpha():
            if ch.islower():
                s = s[:i] + ch.upper() + s[i+1:]
            break
    return s


_ARXIV_PREFIX_RE = re.compile(
    r"""(?ix)                # case-insensitive, verbose
    ^\s*arxiv:\d{4}\.\d+(?:v\d+)?      # ArXiv:YYYY.NNNNN[vN]
    (?:\s*\([^)]+\))?\s*               # optional "(cs.AI)" etc
    (?:[-–—]\s*)?                      # optional dash
    (?:announce(?:ment)?\s*type:\s*\w+\s*)?  # optional "Announcement Type: new"
    (?:new\s+)?abstract:\s*            # "... Abstract:"
    """
)

def _strip_source_boilerplate(s: str) -> str:
    """Remove feed cruft like 'ArXiv:NNNN… Abstract:' and announcer prefixes."""
    s = _strip_html(s or "")

    # Strip common arXiv/announcer forms up-front
    s = _ARXIV_PREFIX_RE.sub("", s)

    # Be extra-safe: if a line *starts* with plain 'arxiv:ID ...'
    s = re.sub(r'(?i)^\s*arxiv:\d{4}\.\d+(?:v\d+)?\b[:\-\s]*', '', s)

    # Nuke leading 'Announcement Type: …' or 'Announce Type: …'
    s = re.sub(r'(?i)^\s*announce(?:ment)?\s*type:\s*\w+\s*', '', s)

    # If 'Abstract:' is still present at the very start, drop it
    s = re.sub(r'(?i)^\s*abstract:\s*', '', s)

    return s.strip()


def _host_from(url: str, fallback: str = "") -> str:
    try:
        h = urlparse(url).netloc.lower()
        if h.startswith("www."): h = h[4:]
        return h or fallback
    except Exception:
        return fallback

def _fmt_date_short(iso_s: str) -> str:
    if not iso_s:
        return ""
    try:
        dt = datetime.fromisoformat(iso_s.replace("Z", "+00:00"))
        m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][dt.month-1]
        return f"{m} {dt.day}, {dt.year}"
    except Exception:
        return iso_s[:10]  # fallback YYYY-MM-DD

# ----- LLM condenser (batch) -----
def _llm_condense_batch(paragraphs: list[str]) -> list[str]:
    """
    Ask the same LLM you use for the brief to condense each paragraph to ONE complete sentence.
    Returns a list of strings, or [] if no LLM is configured/available.
    """
    model = os.getenv("BRIEF_MODEL") or os.getenv("OPENAI_MODEL") or ""
    llm_chat = globals().get("llm_chat") or globals().get("chat_llm")
    if not (model and llm_chat and paragraphs):
        return []

    system = ("You write concise, factual, self-contained one-sentence summaries. "
               "No links. Begin with a concrete subject (e.g., 'The article…', "
               "'Researchers…'), never with pronouns like 'It', 'This', or 'They'.")
    items = [{"text": _strip_leadin_title(p or "")} for p in paragraphs]
    user = (
        "For each item, write EXACTLY ONE complete sentence (18–34 words) capturing the gist. "
        "Avoid phrases like 'In the article' or quoting titles; write stand-alone prose. "
        "No hyperlinks. Return JSON only: {\"summaries\":[\"...\",\"...\"]}.\n\n"
        f"{items}"
    )

    try:
        out = llm_chat(model=model, system=system, user=user).strip()
        data = json.loads(out)
        arr = data.get("summaries") or []
        # final cleanup/normalization; keep full sentence (no word-cap cutoffs)
        return [ _tidy_sentence(s) if s else "" for s in arr ]
    except Exception:
        return []

def _one_line_from_item(it: dict) -> str:
    """Prefer summary-like fields; fallback to title; return a single clean sentence."""
    txt = it.get("summary") or it.get("abstract") or it.get("snippet") or ""
    s = _first_sentence(txt)
    if not s:
        s = _first_sentence(it.get("title") or "")
    # Drop “Learn/Read more …” tails if they slipped in
    s = re.sub(r"(?i)\b(Learn|Read) more\b.*$", "", s).strip()
    return s

def _llm_one_liner_fallback(title: str, text: str) -> str:
    """
    Optional: use your existing LLM stack if available (no hard dependency).
    Returns "" if no LLM is wired up.
    """
    model = os.getenv("BRIEF_MODEL") or os.getenv("OPENAI_MODEL") or ""
    llm_chat = globals().get("llm_chat") or globals().get("chat_llm") or None
    if not (model and llm_chat):
        return ""
    system = "You write concise, factual one-sentence summaries."
    user = (
        "Write ONE short sentence (<= 28 words) summarizing this article. "
        "No links, no title repetition, neutral tone.\n\n"
        f"Title: {title}\n"
        f"Text: {text[:1000]}"
    )
    try:
        out = llm_chat(model=model, system=system, user=user).strip()
        # keep it to one sentence
        out = _first_sentence(out)
        return out
    except Exception:
        return ""


@dataclass
class T:
    type: str     # 'WORD' | 'PHRASE' | 'AND' | 'OR' | 'NOT' | 'LP' | 'RP'
    value: str

@dataclass
class N:  # AST node
    op: str                 # 'AND'|'OR'|'NOT'|'TERM'
    left: 'N' = None
    right: 'N' = None
    term: str = None        # for TERM only
    phrase: bool = False    # phrase vs word
    wildcard: bool = False  # suffix wildcard *

def normalize_bool_query(node: _Node) -> str:
    if node is None: return ""
    if node.op == 'TERM':
        return f'"{node.term}"' if node.phrase else node.term + ('*' if node.wildcard else '')
    if node.op == 'NOT':
        return f'NOT ({normalize_bool_query(node.left)})'
    return f'({normalize_bool_query(node.left)} {node.op} {normalize_bool_query(node.right)})'

def _as_dt(v) -> datetime:
    """Coerce v into a naive datetime (YYYY-MM-DD [HH:MM:SS])."""
    if isinstance(v, datetime):
        return v
    if isinstance(v, date):
        return datetime.combine(v, time(0, 0, 0))
    if isinstance(v, str):
        s = v.strip().replace("T", " ")
        # drop fractional seconds if present
        if "." in s:
            s = s.split(".", 1)[0]
        # try full datetime first
        try:
            return datetime.fromisoformat(s)
        except Exception:
            # try date-only
            try:
                d = date.fromisoformat(s[:10])
                return datetime.combine(d, time(0, 0, 0))
            except Exception:
                pass
    raise ValueError(f"Unsupported datetime value: {v!r}")

def _normalize_query_string(s: str) -> str:
    # Normalize unicode spaces/quotes/dashes that UIs/extensions may insert
    if not s:
        return ""
    # Non-breaking spaces, thin spaces, etc. → regular space
    s = re.sub(r"[\u00A0\u2000-\u200B\u202F\u205F\u3000]", " ", s)
    # Smart quotes → plain quotes
    s = s.replace("\u201c", '"').replace("\u201d", '"').replace("\u201e", '"').replace("\u201f", '"')
    # En/em dashes used as minus → ASCII hyphen
    s = s.replace("\u2013", "-").replace("\u2014", "-")
    # Collapse runs of whitespace
    s = re.sub(r"\s+", " ", s).strip()
    return s

def _normalize_text(s: str) -> str:
    """Normalize article text for robust matching without changing semantics."""
    if not s:
        return ""
    # normalize unicode whitespace to space
    s = re.sub(r"[\u00A0\u2000-\u200B\u202F\u205F\u3000]", " ", s)
    # normalize smart quotes/dashes to ASCII so \b works reliably
    s = (s.replace("\u201c", '"').replace("\u201d", '"')
           .replace("\u2018", "'").replace("\u2019", "'")
           .replace("\u2013", "-").replace("\u2014", "-"))
    # collapse spaces
    s = re.sub(r"\s+", " ", s)
    return s

def _tok(s: str) -> List[T]:
    s = _normalize_query_string(s)
    if not s:
        return []
    # commas behave like AND → replace with spaces around AND
    s = re.sub(r'\s*,\s*', ' AND ', s)
    out = []
    it = _TOKEN_RE.finditer(s)
    print (f"In _tok, it:", it)
    for m in it:
        g = m.group(0)
        if g.startswith('"'):
            out.append(T('PHRASE', m.group(1)))
        elif g == '(':
            out.append(T('LP','('))
        elif g == ')':
            out.append(T('RP',')'))
        else:
            k = g.upper()
            if k in ('AND','OR','NOT'):
                out.append(T(k, k))
            elif g == '-':
                out.append(T('NOT','NOT'))
            else:
                out.append(T('WORD', g))
    # inject default AND between adjacent terms/phrases/closing parens
    with_and = []
    prev_type = None
    def is_termish(t): return t.type in ('WORD','PHRASE','RP')
    print (f"is_termish: ", is_termish)
    for t in out:
        if prev_type and is_termish(T(prev_type,'')) and t.type in ('WORD','PHRASE','LP'):
            with_and.append(T('AND','AND'))
        with_and.append(t)
        prev_type = t.type
    return with_and


# precedence: NOT > AND > OR
_PRECEDENCE = {'OR':1,'AND':2,'NOT':3}

def _to_rpn(tokens: List[T]) -> List[T]:
    out, stack = [], []
    for t in tokens:
        if t.type in ('WORD','PHRASE'):
            out.append(t)
        elif t.type in ('AND','OR','NOT'):
            while stack and stack[-1].type in ('AND','OR','NOT') and _PRECEDENCE[stack[-1].type] >= _PRECEDENCE[t.type]:
                out.append(stack.pop())
            stack.append(t)
        elif t.type == 'LP':
            stack.append(t)
        elif t.type == 'RP':
            while stack and stack[-1].type != 'LP':
                out.append(stack.pop())
            if not stack:
                raise ValueError("Unbalanced ')'")
            stack.pop()
    while stack:
        top = stack.pop()
        if top.type in ('LP','RP'):
            raise ValueError("Unbalanced '('")
        out.append(top)
    return out

def _rpn_to_ast(rpn: List[T]) -> Union[N,None]:
    st: List[N] = []
    for t in rpn:
        if t.type in ('WORD','PHRASE'):
            w = t.value.strip()
            wildcard = False
            if t.type == 'WORD' and w.endswith('*'):
                wildcard = True
                w = w[:-1]
            st.append(N(op='TERM', term=w, phrase=(t.type=='PHRASE'), wildcard=wildcard))
        elif t.type == 'NOT':
            if not st: raise ValueError("NOT missing operand")
            st.append(N(op='NOT', left=st.pop()))
        else:  # AND/OR
            if len(st) < 2: raise ValueError(f"{t.type} missing operands")
            b, a = st.pop(), st.pop()
            st.append(N(op=t.type, left=a, right=b))
    if not st: return None
    if len(st) != 1: raise ValueError("Parse error")
    return st[0]

def parse_bool_query(q: str) -> N:
    toks = _tok(q)
    return _rpn_to_ast(_to_rpn(toks))

def _normalize_ast(node: N) -> str:
    if node is None: return ""
    if node.op == 'TERM':
        s = f'"{node.term}"' if node.phrase else node.term + ('*' if node.wildcard else '')
        return s
    if node.op == 'NOT':
        return f'NOT ({_normalize_ast(node.left)})'
    return f'({_normalize_ast(node.left)} {node.op} {_normalize_ast(node.right)})'

# ---- evaluation helpers ----

_BOUNDARY = r'\b'

def _match_term(text: str, term: str, phrase: bool, wildcard: bool) -> bool:
    tl = (text or "").lower()
    t = (term or "").lower().strip()
    if not t:
        return False
    if phrase:                      # exact substring
        return t in tl
    if wildcard:                    # prefix wildcard
        return bool(re.search(r'\b' + re.escape(t) + r'\w*', tl))
    # tolerant stem match for longer words (e.g., buddhist → buddhists)
    if len(t) >= 5:
        return bool(re.search(r'\b' + re.escape(t) + r'\w*\b', tl))
    # short terms must be exact whole words (ai, law, god…)
    return bool(re.search(r'\b' + re.escape(t) + r'\b', tl))

def eval_ast(node: N, fields: dict) -> bool:
    """
    fields: {'title': str, 'summary': str, 'full': str}
    """
    if node is None: return True
    if node.op == 'TERM':
        blob = f"{fields.get('title','')} {fields.get('summary','')} {fields.get('full','')}"
        return _match_term(blob, node.term, node.phrase, node.wildcard)
    if node.op == 'NOT':
        return not eval_ast(node.left, fields)
    if node.op == 'AND':
        return eval_ast(node.left, fields) and eval_ast(node.right, fields)
    if node.op == 'OR':
        return eval_ast(node.left, fields) or eval_ast(node.right, fields)
    return True

def _clean_line(s):
    import re
    s = (s or "").strip()
    s = re.sub(r"\s+", " ", s).strip('"\u201c\u201d')
    s = s.replace(":", " ").replace(";", " ")
    parts = re.split(r"(?<=[.!?])\s+", s)
    parts = [p for p in parts if p][:2]
    def clip(p):
        words = p.split()
        if len(words) > 28:
            words = words[:28]
        out = " ".join(words)
        return out if out.endswith(('.', '!', '?')) else out + "."
    return " ".join([clip(p) for p in parts])

def _is_bad(s):
    import re
    if not s or len(s.split()) < 3:
        return True
    low = s.lower()
    if any(w in low for w in _TEASE_BANNED):
        return True
    if ":" in s or ";" in s:
        return True
    if s.count(",") > 2:
        return True
    if low.count(" and ") > 1:
        return True
    if re.search(r"\b\w+(, \w+){2,}", s):  # obvious lists
        return True
    return False

def _score_line(s):
    low = s.lower()
    score = 0
    for w in ("drives","driven","as ","so ","therefore","implies","signals","nudges","pushes","shifts"):
        if w in low: score += 2
    for w in ("accelerates","slows","stalls","reverses","expands","tightens","widens","eases","spikes","dips","slides","rises","grows"):
        if w in low: score += 1
    score -= max(0, s.count(",") - 1)
    n = len(s.split())
    if 10 <= n <= 28: score += 1
    return score

def _as_bool(v):
    return str(v or "").lower() in ("1", "true", "yes")

def canonical_url_key(u: str) -> str:
    """Host+path only; drop www/m, query, fragment, trailing slash."""
    p = urlparse(u or "")
    host = (p.hostname or "").lower()
    if host.startswith("www."): host = host[4:]
    if host.startswith("m."):   host = host[2:]
    path = (p.path or "/")
    if path.endswith("/"): path = path[:-1]
    return f"{host}{path}"

def title_key(t: str) -> str:
    t = (t or "").lower()
    t = re.sub(r"[^a-z0-9]+", " ", t).strip()
    return re.sub(r"\s+", " ", t)

def _json_default(o):
    if isinstance(o, (datetime, date)):
        return o.isoformat()
    if isinstance(o, set):
        return sorted(o)
    return str(o)
    
def _normalize_timeframe(opts: dict) -> dict:
    """Ensure timeframe is one of window|lookback|all and infer lookback if days is set."""
    tf = (opts.get("timeframe") or "").strip().lower()
    if tf not in ("window", "lookback", "all"):
        # If UI saved lookback_days but forgot timeframe, honor lookback.
        if opts.get("lookback_days") not in (None, "", 0, "0"):
            tf = "lookback"
        else:
            tf = "window"
    opts["timeframe"] = tf
    # Coerce lookback_days to int when present
    if tf == "lookback":
        try:
            opts["lookback_days"] = int(opts.get("lookback_days") or 1)
        except Exception:
            opts["lookback_days"] = 1
    return opts

def resolve_time_range(window: str, options: dict, today_et: date):
    # normalize opts and pick timeframe
    opts = _normalize_timeframe(options or {})
    tf = opts.get("timeframe")
    if tf == "lookback" and opts.get("lookback_days"):
        end = datetime.now(ET)
        days = int(opts["lookback_days"])
        hours = days * 24
        basis = (opts.get("date_basis") or "published").lower()
        if days == 1 and basis.startswith("pub"):  # grace period on "Last 24h" for Published
            hours = 36

        start = end - timedelta(hours=hours)
        return start, end
    if tf == "all":
        return datetime(1970,1,1,tzinfo=ET), datetime.now(ET)
    # calendar week/month fallback
    s, e = et_window_for(today_et, window)
    return s, e

def _split_items(html: str) -> list[str]:
    """Return list of item blocks in order: <li>…</li>, else <p>…</p>, else paragraphy fallback."""
    items = re.findall(r"(?is)<li\b[^>]*>.*?</li>", html)
    if items:
        return items
    items = re.findall(r"(?is)<p\b[^>]*>.*?</p>", html)
    if items:
        return items
    # fallback: split by blank lines and wrap as <p>
    parts = [p.strip() for p in re.split(r"\n\s*\n", html) if p.strip()]
    return [f"<p>{p}</p>" for p in parts]

def enforce_unique_links_in_html(html: str, selected_items: list, top_n: int) -> str:
    # Extract items robustly
    items = _split_items(html)
    seen, kept = set(), []
    for block in items:
        # hrefs with single OR double quotes
        hrefs = re.findall(r'href=[\'"]([^\'"]+)[\'"]', block, flags=re.I)
        keys  = [canonical_url_key(h) for h in hrefs]
        if any(k in seen for k in keys):
            continue
        for k in keys:
            seen.add(k)
        kept.append(block)
        if len(kept) >= top_n:
            break

    # Backfill with any unused selected items to reach top_n
    if len(kept) < top_n and selected_items:
        for it in selected_items:
            k = canonical_url_key(it["url"])
            if k in seen:
                continue
            kept.append(f'<p><a href="{it["url"]}">{escape(it["title"])}</a> — {escape(it["source_root"])}</p>')
            seen.add(k)
            if len(kept) >= top_n:
                break

    return "\n".join(kept)



def markdown_to_html(text: str) -> str:
    # If it already looks like HTML, keep it.
    if "<" in text and ">" in text:
        return text

    # Try python-markdown if available.
    try:
        import markdown as md
        return md.markdown(text, extensions=["extra", "sane_lists"])
    except Exception:
        # Fallback: convert [title](url) and split paragraphs on blank lines.
        import re
        html = re.sub(r"\[([^\]]+)\]\((https?://[^\s)]+)\)", r'<a href="\2">\1</a>', text)
        parts = [p.strip() for p in re.split(r"\n\s*\n", html) if p.strip()]
        return "".join(f"<p>{p}</p>" for p in parts)
        
def prev_window_start(window: str, window_start_iso: str) -> str:
    if isinstance(window_start_iso, datetime):
        ws = window_start_iso
    else:
        ws = datetime.fromisoformat(str(window_start_iso))

    # ensure tz (match your ET usage)
    if ws.tzinfo is None:
        ws = ws.replace(tzinfo=ET)

    if window == "daily":
        prev = ws - timedelta(days=1)
    elif window == "weekly":
        prev = ws - timedelta(days=7)
    else:  # monthly
        year, month = ws.year, ws.month
        if month == 1:
            year, month = year - 1, 12
        else:
            month -= 1
        prev = datetime(year, month, 1, 0, 0, 0, tzinfo=ws.tzinfo)
    return prev.isoformat()

def get_run_by_window(conn, brief_id: str, window_start_iso: str):
    row = conn.execute("""
        SELECT id, run_at, window_start, window_end, article_ids_json
        FROM brief_runs
        WHERE brief_id=? AND window_start=?
        LIMIT 1
    """, (brief_id, window_start_iso)).fetchone()
    if not row: return None
    return {
        "id": row[0],
        "run_at": row[1],
        "window_start": row[2],
        "window_end": row[3],
        "article_ids": json.loads(row[4]) if row[4] else []
    }

def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"

def slugify(s: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9\- ]+", "", s.strip()).lower()
    s = re.sub(r"\s+", "-", s)
    return s[:80] or "brief"

class BriefIn(BaseModel):
    title: str
    corpus_id: str
    # accept 'all' or None; we’ll coerce below
    window: BriefWindow
    prompt_template: str
    visibility: Literal["private","public"] = "private"
    options_json: Optional[Dict[str, Any]] = None  
    show_on_home: Optional[bool] = False
    home_order: Optional[int] = 0

class BriefOut(BaseModel):
    id: str
    title: str
    corpus_id: str
    window: str
    visibility: str
    is_default_home: int
    slug: str
    last_run_at: Optional[str] = None
    show_on_home: bool = False
    home_order: int = 0
    options_json: Optional[Dict[str, Any]] = None
    content_html: Optional[str] = None

class RunOut(BaseModel):
    id: str
    brief_id: str
    run_at: str
    window_start: str
    window_end: str
    status: str
    content_html: Optional[str] = None
    content_json: Optional[Dict[str, Any]] = None

# Add with your other models
class BriefDetail(BaseModel):
    id: str
    title: str
    corpus_id: str
    window: BriefWindow
    visibility: Literal["private","public"]
    prompt_template: str
    options_json: Optional[Dict[str, Any]] = None
    is_default_home: bool
    slug: str
    created_at: str
    updated_at: str
    last_run_at: Optional[str] = None
    show_on_home: bool = False
    home_order: int = 0

class LatestRunOut(BaseModel):
    id: str
    run_at: str
    window_start: str
    window_end: str
    status: Literal["ok","fallback","error"]
    content_html: Optional[str] = None
    content_json: Optional[Dict[str, Any]] = None

def force_links_new_tab(html: str) -> str:
    """Ensure all <a> tags open in a new tab (and are safe)."""
    def _fix(m):
        tag = m.group(0)
        # strip any existing target/rel, then add ours
        tag = re.sub(r'\s+target\s*=\s*([\'"]).*?\1', '', tag, flags=re.I)
        tag = re.sub(r'\s+rel\s*=\s*([\'"]).*?\1', '', tag, flags=re.I)
        return re.sub(r'>', ' target="_blank" rel="noopener noreferrer">', tag, count=1)
    return re.sub(r'<a\b[^>]*>', _fix, html, flags=re.I)

def _date_expr_for_basis(basis: str) -> str:
    """
    Returns a SQLite expression that parses our ISO-ish strings into a datetime().
    basis: 'processed' (default) or 'published'
    """
    col = "published_date" if (basis or "").lower().startswith("pub") else "processed_date"
    # Handles 'YYYY-MM-DDTHH:MM:SS' and trims any subsecond/zone bits
    return f"datetime(substr(REPLACE(a.{col}, 'T', ' '), 1, 19))"

def et_window_for(date_obj: date, window: str):
    if window == "daily":
        start = datetime(date_obj.year, date_obj.month, date_obj.day, 0, 0, 0, tzinfo=ET)
        end   = start + timedelta(days=1)
    elif window == "weekly":  # Mon-Sun
        monday = date_obj - timedelta(days=(date_obj.weekday()))
        start = datetime(monday.year, monday.month, monday.day, 0, 0, 0, tzinfo=ET)
        end   = start + timedelta(days=7)
    else:  # monthly
        first = date_obj.replace(day=1)
        if first.month == 12:
            next_first = date(first.year+1, 1, 1)
        else:
            next_first = date(first.year, first.month+1, 1)
        start = datetime(first.year, first.month, first.day, 0, 0, 0, tzinfo=ET)
        end   = datetime(next_first.year, next_first.month, next_first.day, 0, 0, 0, tzinfo=ET)
    return start.isoformat(), end.isoformat()

def source_root(url: str) -> str:
    """
    Normalize source for caps. Treat subdomains as same root.
    Also collapse common multi-tenant hosts.
    """
    try:
        host = urlparse(url).hostname or ""
    except Exception:
        host = ""
    host = host.lower()
    labels = host.split(".")
    root = ".".join(labels[-2:]) if len(labels) >= 2 else host
    # Optional: collapse well-known multi-tenant hosts (keep it simple for MVP)
    if root.endswith("substack.com"): root = "substack.com"
    if root.endswith("medium.com"):   root = "medium.com"
    return root or "unknown"

def get_last_run(conn: sqlite3.Connection, brief_id: str) -> Optional[dict]:
    cur = conn.execute(
        "SELECT id, run_at, window_start, window_end, content_json, article_ids_json "
        "FROM brief_runs WHERE brief_id=? ORDER BY run_at DESC LIMIT 1",
        (brief_id,)
    )
    row = cur.fetchone()
    if not row: return None
    return {
        "id": row[0],
        "run_at": row[1],
        "window_start": row[2],
        "window_end": row[3],
        "content_json": json.loads(row[4]) if row[4] else None,
        "article_ids": json.loads(row[5]) if row[5] else []
    }


def call_llm_and_render(compiled_user_prompt: str, facts: dict, opts: dict):
    system = "You are a precise editor who writes crisp, useful briefs."
    model_name = os.getenv("BRIEF_MODEL","gpt-4o-mini")
    temperature = float(os.getenv("BRIEF_TEMPERATURE","0.3"))
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key: raise RuntimeError("OPENAI_API_KEY not set")

    from openai import OpenAI
    client = OpenAI(api_key=api_key)
    resp = client.chat.completions.create(
        model=model_name, temperature=temperature, top_p=0.9, frequency_penalty=0.6, presence_penalty=0.2,
        messages=[{"role":"system","content":system},{"role":"user","content":compiled_user_prompt}]
    )
    text = resp.choices[0].message.content
    html = markdown_to_html(text)
    return html, {"paragraphs": [p for p in text.split("\n\n") if p.strip()]}, model_name, getattr(resp, "usage", None)

def generate_home_tease_sentence(
    brief_title, content_json, model_name=None, prev_tease=None, mode="gist"
) -> Tuple[str, str]: 
    """
    Produce a 1–2 sentence teaser. Prefer LLM with multi-candidate + selection; otherwise deterministic fallback.    Returns (sentence, model_used).
    """

    paragraphs = (content_json or {}).get("paragraphs") or []
    since = (content_json or {}).get("since_yesterday") or {}
    api_key = os.getenv("OPENAI_API_KEY")

    # Try LLM first if api key is present and we have some text
    text = " ".join([p.strip() for p in paragraphs if isinstance(p, str)])[:3500].strip()
    if api_key and text:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=api_key)
        except Exception:
            client = None
        if client:
            sys_msg = (
                "You write tight, neutral update teases for briefings. "
                "Avoid lists and name-dropping unless one entity is central. "
                "Emphasize change and consequence."
            )
            tail = (
                "Write 5 distinct candidates. Each is 1–2 short sentences; ≤ 28 words per sentence. "
                "Synthesize across sources; do not enumerate items. Use verbs of change; at most one proper noun. "
                "Do NOT use a colon or semicolons; no more than two commas total; "
                "do NOT use the words articles, sources, coverage, roundup, brief."
            )
            if mode == "delta" and prev_tease:
                tail += "\nFocus on what changed since the prior run and the implication."
            user_msg = (
                "BRIEF TITLE: " + str(brief_title) + "\n"
                "CONTENT (truncated):\n" + text + "\n\n" + tail + "\n"
                "Return the 5 lines separated by newline characters."
            )
            resp = client.chat.completions.create(
                model=(model_name or os.getenv("BRIEF_MODEL") or "gpt-4o-mini"),
                temperature=0.5,
                presence_penalty=0.3,
                max_tokens=180,
                n=1,
                messages=[{"role":"system","content":sys_msg},
                          {"role":"user","content":user_msg}]
            )
            raw = (resp.choices[0].message.content or "").strip()
            cands = [x.strip() for x in raw.split("\n") if x.strip()]
            cleaned = []
            for c in cands:
                c2 = _clean_line(c)
                if not _is_bad(c2):
                    cleaned.append(c2)
            best = None
            if cleaned:
                if len(cleaned) > 1:
                    try:
                        rank_prompt = (
                            "Pick the single best line. Score each 1–5 on: "
                            "(1) specificity (not generic), (2) consequence/implication, "
                            "(3) cohesion (no lists), (4) clarity (≤ 28 words). "
                            "Return only the exact winning line."
                        )
                        ranking = client.chat.completions.create(
                            model=(model_name or os.getenv("BRIEF_MODEL") or "gpt-4o-mini"),
                            temperature=0.2,
                            max_tokens=60,
                            messages=[
                                {"role":"system","content":"You are a strict evaluator."},
                                {"role":"user","content": rank_prompt + "\n\nCANDIDATES:\n- " + "\n- ".join(cleaned)}
                            ]
                        )
                        sel = (ranking.choices[0].message.content or "").strip().strip('"\u201c\u201d')
                        if any(sel == c for c in cleaned):
                            best = sel
                    except Exception:
                        best = None
                if best is None:
                    best = sorted(cleaned, key=_score_line, reverse=True)[0]
                return best, (model_name or "gpt-4o-mini")

    # Fallback: short deterministic line (no lists, no colon)
    n = len(paragraphs)
    added = int(since.get("added_count") or 0)
    dropped = int(since.get("removed_count") or 0)
    lead = "Momentum shifts today" if (added or dropped) else "Steady movement today"
    line = lead + " across the theme, pointing to near-term follow-through."
    line = _clean_line(line)
    return line, "fallback"



def generate_brief_content(brief_id: str, title: str, corpus_id: str, window: str,
                           prompt: str, options: Dict[str, Any],
                           window_start: str, window_end: str):
    # Merge defaults
    opts = deepcopy(DEFAULT_OPTIONS)
    opts.update(options or {})
    opts = _normalize_timeframe(opts)
    fmt = {**DEFAULT_OPTIONS["format"], **(opts.get("format") or {})}
    opts["format"] = fmt

    # --- v1 UX clamps (leave plumbing intact) ---
    # Force consistent caps while the UI control is hidden.
    opts["input_per_source_cap"]  = 5
    opts["output_per_source_cap"] = 2
    # Ensure novelty is off in this phase, regardless of legacy saved options.
    opts["novelty_boost"] = "none"

    # Derive top_n from length
    top_n = LENGTH_TO_TOPN.get(fmt.get("length","medium"), 5)
    opts["top_n"] = top_n
    fmt["paragraphs"] = top_n

    # Resolve timeframe (overrides) — compute once based on current window+options
    today_et = datetime.now(ET).date()
    start_dt, end_dt = resolve_time_range(window, opts, today_et)
    start_dt = _as_dt(start_dt)
    end_dt   = _as_dt(end_dt)
    start_s  = start_dt.strftime("%Y-%m-%d %H:%M:%S")
    end_s    = end_dt.strftime("%Y-%m-%d %H:%M:%S")

    # --- 1) Fetch candidates (SQL hard filters for time + themes) ---
    basis = (opts.get("date_basis") or opts.get("recency_by") or "processed").lower()
    date_col = "COALESCE(a.published_date, a.processed_date)" if basis.startswith("pub") else "a.processed_date"
    date_expr = _date_expr_for_basis(basis)

    # how many rows to pull before client-side caps/dedupe
    limit_n = max(int(opts.get("candidate_pool", 250)) * 3, 500)

    # ---- Keyword expression (Boolean) ----
    expr = (opts.get("keyword_expr") or "").strip()
    if not expr:
        # legacy support: "kw1, kw2" → "kw1 AND kw2"
        kws = opts.get("keywords")
        if isinstance(kws, str):
            # If user typed a single boolean string (no commas), keep it as-is.
            if "," not in kws:
                expr = kws.strip()
            else:
                kws = [k.strip() for k in re.split(r"\s*,\s*", kws) if k.strip()]
        if isinstance(kws, list) and not expr:
            flat = [k.strip() for k in kws if isinstance(k, str) and k.strip()]
            if len(flat) == 1:
                expr = flat[0]
            elif flat:
                expr = " AND ".join(flat)
    _ast = None
    _parse_err = None
    print (f"expr: ", expr)
    if expr:
        try:
            _ast = parse_bool_query(expr)
            print (f"_ast: ", _ast)
            opts["keyword_expr"] = normalize_bool_query(_ast)
            print (f"normalized: ",  opts["keyword_expr"] )
            opts["keyword_expr_input"] = expr  # what user/legacy actually supplied
        except Exception as e:
            # Hard fail closed: record error and force a filter that never matches.
            print ("exception")
            _parse_err = str(e)
            opts["keyword_expr_error"] = _parse_err
            # a TERM that cannot appear in real text → guarantees match-none
            _ast = _Node(op='TERM', term='\u0000__never__\u0000', phrase=True, wildcard=False)

    # ---- Source exclusions (case-insensitive substrings) ----
    raw_excl = opts.get("sources_exclude") or []
    if isinstance(raw_excl, str):
        ex_parts = re.split(r"[,\s]+", raw_excl)
    else:
        ex_parts = raw_excl
    ex_terms = [p.strip().lower() for p in ex_parts if isinstance(p, str) and p.strip()]

    def _values_cte(lst):
        return "SELECT NULL WHERE 0" if not lst else "VALUES " + ",".join(["(?)"] * len(lst))

    ex_cte = _values_cte(ex_terms)


    sql = f"""
        WITH ex(term) AS (
          {ex_cte}
        )
        SELECT
          a.id,
          a.title,
          a.url,
          {date_col} AS date_col,
          a.summary,
          MAX(s.combined_score) AS best_score
        FROM article_corpus_scores s
        JOIN articles a ON a.id = s.article_id
        WHERE s.corpus_id = ?
          AND datetime(substr(REPLACE({date_col}, 'T', ' '), 1, 19)) >= datetime(?)
          AND datetime(substr(REPLACE({date_col}, 'T', ' '), 1, 19)) <  datetime(?)
          AND s.combined_score > ?
          AND NOT EXISTS (
                SELECT 1
                FROM ex
                WHERE instr(
                  lower(COALESCE(a.url,'') || ' ' || COALESCE(a.feed_name,'')),
                  ex.term
                ) > 0
              )
        GROUP BY a.id
        ORDER BY best_score DESC,
                 datetime(substr(REPLACE({date_col}, 'T', ' '), 1, 19)) DESC
        LIMIT ?;
    """

    # Bind order:
    #  [corpus_id, start_s, end_s, MIN_ARTICLE_SCORE, limit_n]
    # plus 0..N kw/exclusion values inside the CTEs (placed BEFORE these five)
    params = (
        ex_terms
        + [corpus_id, start_s, end_s, MIN_ARTICLE_SCORE, limit_n]
    )

    with get_conn(ro=True) as conn:
        rows = conn.execute(sql, params).fetchall()

    # --- 2) Normalize + soft filters (keywords boost, exclusions) ---
    # Accept both list and comma/space-separated string
    if isinstance(raw_excl, str):
        parts = re.split(r"[,\s]+", raw_excl)
    else:
        parts = raw_excl
    excl_terms = [p.strip().lower() for p in parts if isinstance(p, str) and p.strip()]

    # --- 2) Hard Boolean filter + field-weighted ranking bump ---
    def _fulltext_of(conn, article_id: str) -> str:
        # Try to read full text from articles.full_text if present; otherwise empty.
        try:
            row = conn.execute("SELECT COALESCE(full_text, '') FROM articles WHERE id=?", (article_id,)).fetchone()
            return row[0] if row else ""
        except Exception:
            return ""

    cand = []
    with get_conn(ro=True) as _c2:
        for (aid, atitle, url, pub, summary, score) in rows:
            # Hard Boolean filter (title + summary + full)
            full = _fulltext_of(_c2, aid)
            if _ast:
                if not eval_bool(_ast, {"title": atitle or "", "summary": summary or "", "full": full or ""}):
                    continue

            root = source_root(url)

            # Field-weighted bumps for ranking only (exact numbers are tame)
            title_hit, summary_hit, full_hit = eval_fields(_ast, atitle or "", summary or "", full or "")
            bump = 1.0
            if title_hit:
                bump *= 1.30
            elif summary_hit:
                bump *= 1.15
            elif full_hit:
                bump *= 1.05

            cand.append({
                "article_id": aid,
                "title": atitle,
                "url": url,
                "published_at": pub,
                "source_root": root,
                "summary" : summary,
                "score": float(score) * bump
            })
    cand.sort(key=lambda it: it["score"], reverse=True)
    
    # --- 3) De-dupe (URL + root|title) then input caps + candidate_pool ---
    in_cap = int(opts.get("input_per_source_cap", 3))
    pool   = int(opts.get("candidate_pool", 250))

    seen = set()  # URL key + root|title key
    per_source_in, candidates = {}, []

    for it in cand:
        k_url = canonical_url_key(it["url"])
        k_rt  = f'{it["source_root"]}|{title_key(it["title"])}'
        if k_url in seen or k_rt in seen:
            continue
        seen.add(k_url); seen.add(k_rt)

        r = it["source_root"]
        per_source_in[r] = per_source_in.get(r, 0) + 1
        if per_source_in[r] > in_cap:
            continue

        candidates.append(it)
        if len(candidates) >= pool:
            break


    # --- 4) Novelty boost & final selection with output cap ---
    # Get previous window's article_ids for novelty
    with get_conn(ro=True) as conn:
        prev_start = prev_window_start(window, start_dt) if opts.get("timeframe") in (None, "window", "lookback") else None
        prev_ids = set()
        if prev_start:
            prev = get_run_by_window(conn, brief_id, prev_start)
            if prev: prev_ids = set(prev["article_ids"])

    novelty_mult = NOVELTY_MULT.get(opts.get("novelty_boost","mild"), 1.15)
    scored = []
    for it in candidates:
        is_new = it["article_id"] not in prev_ids
        adj = it["score"] * (novelty_mult if is_new else 1.0)
        scored.append((adj, it))
    scored.sort(key=lambda x: x[0], reverse=True)

    out_cap = int(opts.get("output_per_source_cap", 1))
    selected, per_source_out = [], {}
    for adj, it in scored:
        r = it["source_root"]
        if per_source_out.get(r, 0) >= out_cap:
            continue
        per_source_out[r] = per_source_out.get(r, 0) + 1
        selected.append(it)
        if len(selected) >= top_n:
            break

    # --- FINAL de-dupe by canonical URL (belt & suspenders) ---
    seen_final = set()
    unique_selected = []
    for it in selected:
        k = canonical_url_key(it["url"])
        if k in seen_final:
            continue
        seen_final.add(k)
        unique_selected.append(it)

    # keep top_n in case de-dupe shrank the list mid-stream
    selected = unique_selected[:top_n]

    # Hard cap: one paragraph per selected item
    fmt = opts.get("format", {}) if isinstance(opts.get("format"), dict) else {}
    requested = int(fmt.get("paragraphs") or len(selected))
    para_limit = max(0, min(len(selected), requested))
    fmt["paragraphs"] = para_limit
    opts["format"] = fmt

    # --- 5) Diff vs previous window (deterministic) ---
    curr_ids = [it["article_id"] for it in selected]
    added = [it for it in selected if it["article_id"] not in prev_ids]
    removed_ct = len(prev_ids - set(curr_ids))

    since_mode = fmt.get("since_yesterday","line")
    if opts.get("timeframe") == "all":     # suppress for all-time
        since_mode = "none"

    facts = {
      "title": title,
      "window_start": start_dt.isoformat(), "window_end": end_dt.isoformat(),
      "items": selected,
      "since_yesterday": {
        "mode": since_mode,
        "added_count": len(added),
        "removed_count": removed_ct,
        "notable_new_sources": sorted({it["source_root"] for it in added})[:3]
      }
    }

    # --- 6) Compose dynamic constraints (tone/format) ---
    constraints, tone_text = build_constraints(opts), tone_block(opts.get("tone","conversational"))
    selection_summary = build_selection_summary(opts, [], excl_terms)

    compiled_user_prompt = compose_prompt(prompt, constraints, tone_text, selection_summary, facts)


    if not selected:
        msg = "<p><em>No articles matched your filters for this timeframe.</em></p>"
        return msg, {"note": "no_articles"}, compiled_user_prompt



    html, llm_json, model, usage = call_llm_and_render(compiled_user_prompt, facts, opts)
    html = enforce_unique_links_in_html(html, selected, top_n)
    html = force_links_new_tab(html)
    # selected was built earlier (the N picked items)
    selected_ids = [it["article_id"] for it in selected]

    # Shortage note when hard-keyword filter leaves fewer items than requested
    if (opts.get("keyword_expr") and len(selected) < top_n):
        note = (
            f'<p><em>Only {len(selected)} item{"s" if len(selected)!=1 else ""} matched '
            f'filter ({escape(opts.get("keyword_expr"))}) in the selected window.</em></p>'
        )

        html = html + note 

    # NEW: explicit parse error banner so the user knows why nothing matched
    if _parse_err:
        err = (
            f'<p style="color:#b00020;"><strong>Keyword filter error:</strong> '
            f'{escape(_parse_err)}. The filter was not applied and no items were included. '
            f'Please correct the expression in the Brief settings.</p>'
        )
        html = err + html


    content = {
        "paragraphs": llm_json.get("paragraphs", []),
        "since_yesterday": facts["since_yesterday"],
        "selected_article_ids": selected_ids,
        "selected_preview": [
           {
             "title": it["title"],
             "url": it["url"],
             "summary": it.get("summary") or "",
             "source_root": it.get("source_root") or "",
             "published_at": it.get("published_at") or it.get("published") or ""
           }
           for it in selected[:2]
        ],
        "selected_total": len(selected)
    }

    # ensure paragraphs are List[str]
    pars = content.get("paragraphs") or []
    if pars and isinstance(pars[0], dict):
        pars = [str(p.get("text") or "") for p in pars]
    else:
        pars = [str(p or "") for p in pars]
    content["paragraphs"] = pars

    return html, content, compiled_user_prompt



def tone_block(tone: str) -> str:
    m = {
      "conversational": "Use plain, friendly language. No jargon. Keep it approachable but concise.",
      "executive": "Be terse and action-oriented. Lead with outcomes and implications. Avoid filler.",
      "researcher": "Be precise and technical. Prefer primary sources. Note methods or limitations when relevant."
    }
    return m.get(tone, m["conversational"])

def build_constraints(opts: dict) -> str:
    fmt = opts.get("format", {})
    n   = int(fmt.get("paragraphs", 5))
    style = fmt.get("style","paragraphs")
    min_l = int(fmt.get("links_per_item_min", 1))
    max_l = int(fmt.get("links_per_item_max", 2))
    length = fmt.get("length","medium")
    words  = fmt.get("length_words")
    since  = fmt.get("since_yesterday","line")

    lines = []
    lines.append("Output strictly as HTML fragments (no Markdown, no code fences).")
    if style == "paragraphs":
         lines.append(f"Write {n} short items as paragraphs.")
         lines.append("Wrap each item in <p>…</p>. Do NOT include <html>, <head>, or <body>.")
    else:  # bullets
         lines.append(f"Write {n} short items as bullet points.")
         lines.append("Output a single <ul> with one <li> per item (no <p> inside the list).")
    lines.append("Write exactly one item per paragraph, covering each item from FACTS.items at most once.")
    lines.append("Never reuse the same article URL across paragraphs; each paragraph must reference a different item.url.")
    lines.append(
      f"Write at most {n} items. If FACTS.items has fewer than {n} "
      f"distinct URLs, output that smaller number. Map 1-to-1: paragraph i must summarize "
      f"FACTS.items[i] and include its item.url exactly once in the first sentence. "
      f"Never reuse the same URL across paragraphs."
      f"Write exactly {n} paragraphs, **one paragraph per item** listed below."
      f"If there are fewer than the usual number of items, write **only** that many paragraphs."
      f"Do **not** add extra sections, wrap-up, conclusions, background, or commentary."
      f"Do **not** invent items or merge items."
    )


    verb = "must include at least" if min_l >= 1 else "may include"
    lines.append(
        f"Each item {verb} {min_l} and at most {max_l} inline links using HTML "
        f"<a href=\"URL\">Title</a>. Always hyperlink the article title using the corresponding item.url from FACTS (no generic 'here')."
    )
    if words:
        lines.append(f"Target about {int(words)} words total.")
    else:
        lines.append({"short":"Aim for ~250 words.","medium":"Aim for ~400 words.","long":"Aim for ~600 words."}[length])
    lines.append("Verify that the same URL or Title does not appear in two different paragraphs or bullets. If that happens, try again to generate it without that problem.")

    lines.append(
      "For every item, include exactly one HTML link in the FIRST sentence, "
      "using the item's URL. The link MUST be an HTML <a> tag with "
      'target="_blank" rel="noopener noreferrer". '
      "Do not output markdown links [..](..) or bare URLs."
    )
    lines.append(
      "Map 1-to-1: paragraph i summarizes FACTS.items[i] and uses its item.url exactly once. "
      "Never reuse the same URL across paragraphs."
    )
    return "\n".join(lines)

def build_selection_summary(opts: dict, _keywords_unused: list, excl_terms: set) -> str:
    expr = (opts.get("keyword_expr") or "").strip()
    lines = ["Selection rules in effect:"]
    if expr:
        lines.append(f"- Require items to match: {expr}.")
    if excl_terms:
        lines.append(f"- Exclude sources: {', '.join(sorted(set(excl_terms)))}.")
    return "\n".join(lines)

def compose_prompt(user_prompt: str, constraints: str, tone_text: str, selection_summary: str, facts: dict) -> str:
    return f"""{user_prompt.strip()}

CONSTRAINTS
{constraints}

TONE
{tone_text}

SELECTION
{selection_summary}

FACTS (JSON)
{json.dumps(facts, ensure_ascii=False, default=_json_default)}
"""

@router.get("/{brief_id}/latest", response_model=LatestRunOut)
def get_latest_run(brief_id: str, acct=Depends(require_session)):
    with get_conn(ro=True) as conn:
        row = conn.execute("""
            SELECT r.id, r.run_at, r.window_start, r.window_end, r.status,
                   r.content_html, r.content_json, b.user_id
            FROM brief_runs r
            JOIN briefs b ON b.id = r.brief_id
            WHERE r.brief_id=? 
            ORDER BY r.run_at DESC
            LIMIT 1
        """, (brief_id,)).fetchone()
        if not row:
            raise HTTPException(404, "no runs yet")
        if row[7] != acct["account_id"]:
            raise HTTPException(403, "not owner")
    return {
        "id": row[0], "run_at": row[1],
        "window_start": row[2], "window_end": row[3],
        "status": row[4],
        "content_html": row[5],
        "content_json": json.loads(row[6] or "{}"),
    }


@router.delete("/{brief_id}")
def delete_brief(brief_id: str, acct=Depends(require_session)):
    with get_conn() as conn:
        # verify ownership
        row = conn.execute("SELECT user_id FROM briefs WHERE id=?", (brief_id,)).fetchone()
        if not row:
            raise HTTPException(404, "brief not found")
        if row[0] != acct["account_id"]:
            raise HTTPException(403, "not owner")
        # delete runs first (FK or manual)
        conn.execute("DELETE FROM brief_runs WHERE brief_id=?", (brief_id,))
        conn.execute("DELETE FROM briefs WHERE id=?", (brief_id,))
    return {"ok": True, "deleted": brief_id}



@router.get("", response_model=List[BriefOut])

def list_briefs(request: Request, acct=Depends(require_session)):
    qp = request.query_params
    mine      = _as_bool(qp.get("mine"))
    home      = _as_bool(qp.get("home"))
    corpus_id = (qp.get("corpus_id") or "").strip()

    where = ["1=1"]
    args: list = []
    if mine:
        where.append("b.user_id = ?")
        args.append(acct["account_id"])
    # Only add the corpus filter when non-empty (avoids AND b.corpus_id = '' → zero rows)
    if corpus_id:
        where.append("b.corpus_id = ?")
        args.append(corpus_id)
    if home:
        # Be tolerant of NULL (old rows) and require pinned
        where.append("COALESCE(b.show_on_home, 0) = 1")

    # Sort pinned by home_order then latest run; otherwise by updated_at
    order_by = "COALESCE(b.home_order,0) ASC, last_run_at DESC" if home else "b.updated_at DESC"

    sql = f"""
        SELECT b.id,
               b.title,
               b.corpus_id,
               b.window,
               b.visibility,
               b.is_default_home,
               b.slug,
               (SELECT run_at
                  FROM brief_runs r
                 WHERE r.brief_id = b.id
                 ORDER BY run_at DESC
                 LIMIT 1) AS last_run_at,
               COALESCE(b.show_on_home, 0) AS show_on_home,
               COALESCE(b.home_order,   0) AS home_order,
            b.options_json
          FROM briefs b
         WHERE { ' AND '.join(where) }
         ORDER BY {order_by}
    """
    with get_conn(ro=True) as conn:
        rows = conn.execute(sql, args).fetchall()

    # Map to your BriefOut shape
    out = []
    for r in rows:
        opts = {}
        try:
            opts = json.loads(r[10] or "{}")
        except Exception:
            opts = {}
        # Surface “all time” in the API response even though DB window stays daily/weekly/monthly
        win = "all" if (str(opts.get("timeframe") or "").lower() == "all") else r[3]
        out.append(BriefOut(
            id=r[0], title=r[1], corpus_id=r[2], window=win,
            visibility=r[4], is_default_home=r[5], slug=r[6],
            last_run_at=r[7],
            show_on_home=bool(r[8]),
            home_order=int(r[9] or 0),
            options_json=opts
        ))
    return out

@router.post("", response_model=BriefOut)
def create_brief(payload: BriefIn, acct=Depends(require_session)):
    # Coerce/merge options so 'all' works without breaking DB invariants
    opts = dict(DEFAULT_OPTIONS)
    if payload.options_json:
        opts.update(payload.options_json or {})
    # Store exactly what the UI sends: daily | weekly | monthly | all
    win = payload.window
    # keep options_json consistent (optional)
    opts["timeframe"] = "all" if win == "all" else (opts.get("timeframe") or "window")

    b_id = new_id("brf")
    slug = slugify(payload.title + "-" + b_id[-5:])
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute("""
            INSERT INTO briefs (
              id, user_id, title, corpus_id, window, prompt_template, options_json,
              visibility, is_default_home, slug, created_at, updated_at,
              show_on_home, home_order
            )
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            b_id, acct["account_id"], payload.title, payload.corpus_id, win,
            payload.prompt_template, json.dumps(opts or {}),
            payload.visibility, 0, slug, now, now,
            1 if payload.show_on_home else 0,
            int(payload.home_order or 0)
        ))
    return BriefOut(
        id=b_id, title=payload.title, corpus_id=payload.corpus_id,
        window=win, visibility=payload.visibility,
        is_default_home=0, slug=slug, last_run_at=None,
        show_on_home=bool(payload.show_on_home),
        home_order=int(payload.home_order or 0)
    )

class BriefPatch(BaseModel):
    title: Optional[str] = None
    corpus_id: Optional[str] = None
    window: Optional[BriefWindow] = None
    prompt_template: Optional[str] = None
    visibility: Optional[Literal["private","public"]] = None
    is_default_home: Optional[bool] = None
    options_json: Optional[Dict[str, Any]] = None
    show_on_home: Optional[bool] = None
    home_order: Optional[int] = None
    


@router.patch("/{brief_id}", response_model=BriefOut)
def update_brief(brief_id: str, payload: BriefPatch, acct=Depends(require_session)):
    with get_conn() as conn:
        # Ownership check
        owner = conn.execute("SELECT user_id, corpus_id FROM briefs WHERE id=?", (brief_id,)).fetchone()
        if not owner: raise HTTPException(404, "brief not found")
        if owner[0] != acct["account_id"]:
            raise HTTPException(403, "not owner")

        fields, values = [], []

        for col in ("title","corpus_id","window","prompt_template","visibility"):
          val = getattr(payload, col)
          if val is not None:
              fields.append(f"{col}=?"); values.append(val)

        if payload.options_json is not None:
            fields.append("options_json=?")
            values.append(json.dumps(payload.options_json))
        if payload.show_on_home is not None:
            fields.append("show_on_home=?")
            values.append(1 if payload.show_on_home else 0)
        if payload.home_order is not None:
            fields.append("home_order=?")
            values.append(int(payload.home_order))
        values.append(datetime.utcnow().isoformat())
        fields.append("updated_at=?")
        if payload.is_default_home is not None:
            # ensure only one default per (user, corpus)
            corpus = payload.corpus_id or owner[1]
            conn.execute("UPDATE briefs SET is_default_home=0 WHERE user_id=? AND corpus_id=?", (acct["account_id"], corpus))
            conn.execute("UPDATE briefs SET is_default_home=1 WHERE id=?", (brief_id,))
        if fields:
            conn.execute(f"UPDATE briefs SET {', '.join(fields)} WHERE id=?", (*values, brief_id))

        row = conn.execute("""
            SELECT id, title, corpus_id, window, visibility, is_default_home, slug,
                   (SELECT run_at FROM brief_runs WHERE brief_id=? ORDER BY run_at DESC LIMIT 1),
                   show_on_home, home_order
            FROM briefs WHERE id=?
        """, (brief_id, brief_id)).fetchone()

    return BriefOut(id=row[0], title=row[1], corpus_id=row[2], window=row[3],
                    visibility=row[4], is_default_home=row[5], slug=row[6], last_run_at=row[7],
                    show_on_home=bool(row[8]), home_order=int(row[9] or 0))

class RunRequest(BaseModel):
    date_str: Optional[str] = None  # "YYYY-MM-DD" (ET). If None -> today ET.

@router.post("/{brief_id}/run", response_model=RunOut)
def run_brief(brief_id: str, req: Optional[RunRequest] = None, acct=Depends(require_session)):
     # ownership
    with get_conn(ro=True) as conn:
        b = conn.execute("""
            SELECT id, user_id, title, corpus_id, window, prompt_template, options_json
            FROM briefs WHERE id=?
        """, (brief_id,)).fetchone()
        if not b: raise HTTPException(404, "brief not found")
        if b[1] != acct["account_id"]:
            raise HTTPException(403, "not owner")

    today_et = datetime.now(ET).date() if not req or not req.date_str else date.fromisoformat(req.date_str)
    opts = json.loads(b[6] or "{}")
    win = b[4]  # 'daily' | 'weekly' | 'monthly' | 'all'
    # compute actual bounds (all → 1970..now)
    start_dt, end_dt = resolve_time_range(win, opts, today_et)
    wstart = _as_dt(start_dt).isoformat()
    wend   = _as_dt(end_dt).isoformat()



    html, content_json, compiled_prompt = generate_brief_content(
        brief_id=brief_id, title=b[2], corpus_id=b[3], window=win,
        prompt=b[5], options=opts, window_start=wstart, window_end=wend
    )


    if content_json.get("note") == "no_articles":
        # No results
        lines      = []
        lines_html = "<div>No articles matched your filters for this timeframe.</div>"
        total      = 0

    else:
        # Build from the exact text the Brief page just rendered.
        # Grab the first sentence of the first two items *as written* in the brief.
        # (We also auto-skip the “Only N items matched …” note.)
        sentences = _first_sentences_from_brief_html(html, n=2)

        preview = content_json.get("selected_preview") or []

        lines = []
        for i, s in enumerate(sentences):
            pr = (preview[i] if i < len(preview) else {}) or {}
            host   = (pr.get("source_root") or "") or _host_from(pr.get("url") or "")
            date_s = _fmt_date_short(pr.get("published_at") or "")
            meta = "; ".join([p for p in [host and f"source: {host}", date_s and f"date: {date_s}"] if p])
            tail = f" ({meta})" if meta else ""
            lines.append({"text": f"{s}{tail}"})


        lis       = [f"<li>{escape(li['text'])}</li>" for li in lines]  # escape() you already import
        lines_html = f"<ul>{''.join(lis)}</ul>" if lis else ""
        # how many items total were selected for the brief (for the “…and N others” tail)
        total = int(content_json.get("selected_total")
                    or len(content_json.get("selected_article_ids") or []))
        if total > len(lines):
            rest = total - len(lines)
            lines_html += f'<div>…and {rest} other article{"s" if rest != 1 else ""}.</div>'

    # Optional back-compat single string
    sentence_text = "; ".join(li["text"] for li in lines)
    if total > len(lines):
        sentence_text += f"; and {total - len(lines)} other article{'s' if total - len(lines) != 1 else ''}."

    content_json["home_tease"] = {
        "mode": "first-sentences",
        "lines": lines,
        "lines_html": lines_html,
        "total": total,
        "sentence": sentence_text,
        "generated_at": datetime.utcnow().isoformat(),
        "model": "none",
        "notes": None,
    }



    # Persist (UPSERT the same window)
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM brief_runs WHERE brief_id=? AND window_start=? LIMIT 1",
            (brief_id, wstart)
        ).fetchone()
        run_id = existing[0] if existing else new_id("run")
        now = datetime.utcnow().isoformat()
        inputs_hash = hashlib.sha256(
            (json.dumps({"options":opts,"facts":content_json}, sort_keys=True) + (b[5] or "")).encode("utf-8")
        ).hexdigest()

        conn.execute("""
        INSERT INTO brief_runs (
          id, brief_id, run_at, window_start, window_end, status, model, token_usage_json,
          inputs_hash, article_ids_json, content_html, content_json, diagnostics_json, error_text
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(brief_id, window_start) DO UPDATE SET
          run_at=excluded.run_at, window_end=excluded.window_end, status=excluded.status,
          model=excluded.model, token_usage_json=excluded.token_usage_json, inputs_hash=excluded.inputs_hash,
          article_ids_json=excluded.article_ids_json, content_html=excluded.content_html,
          content_json=excluded.content_json, diagnostics_json=excluded.diagnostics_json, error_text=excluded.error_text
        """, (
          run_id, brief_id, now, wstart, wend, "ok", "gpt-4o-mini", None,
          inputs_hash,
          json.dumps(content_json.get("selected_article_ids", [])),
          html, json.dumps(content_json),
          json.dumps({"options": opts, "keyword_expr": opts.get("keyword_expr")}, default=str),None
        ))

    return RunOut(
        id=run_id, brief_id=brief_id, run_at=now,
        window_start=wstart, window_end=wend,
        status="ok", content_html=html, content_json=content_json
    )

@router.get("/{brief_id}/runs")
def list_runs(brief_id: str, limit: int = 20, acct=Depends(require_session)):
    con = get_conn()
    try:
        con.row_factory = sqlite3.Row
        rows = con.execute(
            """
            SELECT id, brief_id, run_at, status, model,
                   content_html, content_json, error_text
            FROM brief_runs
            WHERE brief_id = ?
            ORDER BY run_at DESC
            LIMIT ?
            """,
            (brief_id, limit),
        ).fetchall()
        out = []
        for r in rows:
            out.append({
                "id": r["id"],
                "brief_id": r["brief_id"],
                "run_at": r["run_at"],
                "status": r["status"],
                "model": r["model"],
                "content_html": r["content_html"],
                "content_json": r["content_json"],
                "error_text": r["error_text"],
            })
        return out
    finally:
        con.close()

@router.get("/{brief_id}/runs/latest")
def get_latest_run(brief_id: str, acct=Depends(require_session)):
    con = get_conn()
    try:
        con.row_factory = sqlite3.Row
        row = con.execute(
            """
            SELECT *
            FROM brief_runs
            WHERE brief_id = ?
            ORDER BY run_at DESC
            LIMIT 1
            """,
            (brief_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="No runs")
        # return FULL run, including content_html and content_json
        return dict(row)
    finally:
        con.close()

class PreviewReq(BaseModel):
    options_overrides: Optional[Dict[str, Any]] = None
    prompt_template: Optional[str] = None


# --- Preview for a brand-new brief (no id yet) ---
class PreviewNewReq(BaseModel):
    corpus_id: str
    window: Optional[Literal["daily","weekly","monthly","all"]] = "weekly"
    prompt_template: str
    options_json: Optional[Dict[str, Any]] = None

@router.post("/preview/new")
def preview_new(body: PreviewNewReq, acct=Depends(require_session)):
    # Build time window (ET) from requested window + options
    today_et = datetime.now(ET).date()
    win = body.window if body.window in ("daily","weekly","monthly","all") else "weekly"
    opts = dict(DEFAULT_OPTIONS)
    if body.options_json:
        opts.update(body.options_json or {})
    # compute the actual time range (all → 1970..now)
    start_dt, end_dt = resolve_time_range(win, opts, today_et)
    wstart = _as_dt(start_dt).isoformat()
    wend   = _as_dt(end_dt).isoformat()

    html, content_json, compiled = generate_brief_content(
        brief_id=f"preview-{acct['account_id']}-{body.corpus_id}",  # synthetic id; no previous runs -> no diff
        title="(preview)",
        corpus_id=body.corpus_id,
        window=win,
        prompt=body.prompt_template,
        options=opts,
        window_start=wstart,
        window_end=wend,
    )
    return {
        "content_html": html,
        "content_json": content_json,
        "compiled_prompt": compiled,
    }

# Put this route AFTER /preview/new and BEFORE any subpaths like /{brief_id}/run
@router.get("/{brief_id}", response_model=BriefDetail)
def get_brief(brief_id: str, acct=Depends(require_session)):
    with get_conn(ro=True) as conn:
        row = conn.execute("""
            SELECT
              b.id, b.user_id, b.title, b.corpus_id, b.window, b.prompt_template,
              b.options_json, b.visibility, b.is_default_home, b.slug,
              b.created_at, b.updated_at, b.show_on_home, b.home_order,
              (SELECT run_at FROM brief_runs r WHERE r.brief_id=b.id ORDER BY run_at DESC LIMIT 1) AS last_run_at
            FROM briefs b
            WHERE b.id=?
        """, (brief_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="brief not found")
        if row[1] != acct["account_id"]:
            raise HTTPException(status_code=403, detail="not owner")

    opts = json.loads(row[6] or "{}")
    win = "all" if str(opts.get("timeframe") or "").lower() == "all" else row[4]
    return {
        "id": row[0],
        "title": row[2],
        "corpus_id": row[3],
        "window": win,
        "prompt_template": row[5] or "",
        "options_json": opts,
        "visibility": row[7],
        "is_default_home": bool(row[8]),
        "slug": row[9],
        "created_at": row[10],
        "updated_at": row[11],
        "show_on_home": bool(row[12]),
        "home_order": int(row[13] or 0),
        "last_run_at": row[14],

    }

@router.post("/{brief_id}/preview")
def preview_brief(brief_id: str, body: PreviewReq, acct=Depends(require_session)):
    with get_conn(ro=True) as conn:
        b = conn.execute("""
          SELECT id, user_id, title, corpus_id, window, prompt_template, options_json
          FROM briefs WHERE id=?
        """, (brief_id,)).fetchone()
        if not b: raise HTTPException(404, "brief not found")
        if b[1] != acct["account_id"]: raise HTTPException(403, "not owner")

    prompt = (body.prompt_template if body and body.prompt_template is not None else b[5]) or ""
    base_opts = json.loads(b[6] or "{}")
    opts = {**base_opts, **(body.options_overrides or {})}

    today_et = datetime.now(ET).date()
    start_dt, end_dt = resolve_time_range(b[4], opts, today_et)
    wstart, wend = _as_dt(start_dt).isoformat(), _as_dt(end_dt).isoformat()

    html, content_json, _ = generate_brief_content(
        brief_id=b[0], title=b[2], corpus_id=b[3], window=b[4],
        prompt=prompt, options=opts, window_start=wstart, window_end=wend
    )
    return {"content_html": html, "content_json": content_json}

# -------- Generator (MVP) --------



def fallback_render_html(facts: Dict[str, Any], style: str = "paragraphs") -> str:
    items = facts.get("items", [])
    sy = facts.get("since_yesterday", {"added_count":0,"removed_count":0,"notable_new_sources":[]})
    if style == "bullets":
        lis = "".join(
            f'<li><a href="{it["url"]}">{escape(it["title"])}</a> — {escape(it["source_root"])}</li>'
            for it in items
        )
        body = f"<ul>{lis}</ul>"
    else:
        paras = [
            f'<p><a href="{it["url"]}">{escape(it["title"])}</a> — {escape(it["source_root"])}</p>'
            for it in items
        ]
        body = "\n".join(paras)
    since = (
        f'<p><em>Since yesterday:</em> +{sy["added_count"]} new, {sy["removed_count"]} dropped; '
        f'new sources: {", ".join(sy.get("notable_new_sources") or []) or "—"}.</p>'
    )
    return body + "\n" #+ since