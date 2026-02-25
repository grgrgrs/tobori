# Tobori Dev Log

---

## 2026-02-25

### Architecture review
Read and documented the entire codebase. Full report saved as `docs/documentation/InitialToboriArchitectureReport.txt`. Key findings recorded there including fragile items (dead routers, duplicate identity systems, missing env var wiring, etc.).

### Articles filter bar — font and label (commit `7a4866b`)
**Files:** `src/components/Articles.jsx`

- Added `fontSize: "0.85rem"` to the filter bar container div so all controls inherit a consistent, slightly larger size (previously controls had no explicit font size and fell back to browser defaults, likely not rendering in Inter).
- Renamed "Not viewed" label to "Unseen".

### Email-only login with optional invite code (commit `fd48e26`)
**Files:** `routes/auth.py`, `src/components/LoginPage.jsx`

**Background:** Needed a simpler onboarding path for new users — email only, no invite code required.

**Changes:**
- Added `DEFAULT_CORPUS_ID = "companion-ai"` constant to `auth.py` (hardcoded; env var `DEFAULT_CORPUS` existed in `.env` but was never read by the Python backend).
- Made `code` field optional (`str = ""`) on both `InviteSignupIn` and `SimpleLoginIn` Pydantic models.
- Added `_ensure_membership_default(account_id)` helper — assigns account to `companion-ai` corpus directly, no invite code needed.
- Both login endpoints (`/api/signup/invite`, `/api/login/simple`) now branch: empty code → default corpus assignment; code present → existing invite-code validation unchanged.
- `LoginPage.jsx`: cleared pre-filled `GR-LENS-2025` default, removed `required` from code input, labeled field as optional.

**Notes:**
- No email verification — anyone can type any email and get in. Acceptable for now given corpus is not sensitive.
- User identity (and all interaction history — likes, forgets, opens) is tied to email string. If a user returns with a different email they get a new account with no history.
- Expanding an article card logs an "open" interaction; scrolling/browsing does not. Safe to test with a new user's email as long as no cards are expanded and no action buttons are clicked.

### Extended session cookie to 90 days (commit `5a86aa8`)
**Files:** `routes/auth.py`

Changed `COOKIE_MAX_DAYS` from 30 to 90. Applies to new sessions only; existing sessions are unaffected until they re-authenticate.
