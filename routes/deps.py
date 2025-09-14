# routes/deps.py
from fastapi import Depends, HTTPException, Request, status
from .auth import require_session

def get_current_user(request: Request):
    user = getattr(request.state, "user", None)  # however you attach the user from the session
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="no_session")
    return user

def get_corpus_id(request: Request, user = Depends(require_session)):
    cid = request.query_params.get("corpus_id")
    if not cid:
      raise HTTPException(status_code=400, detail="corpus_id required")
    # validate membership (pseudo-code)
    if not request.app.state.db.user_has_corpus(user.id, cid):
      raise HTTPException(status_code=403, detail="not a member of corpus")
    return cid

def current_account_id(request: Request) -> str:
    """Return the authenticated account_id, or raise 401."""
    acc = require_session(request)  # raises 401 if no/invalid cookie
    aid = acc.get("account_id")
    if not aid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="no_account_id")
    return aid
