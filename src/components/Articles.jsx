import React, { useEffect, useState, useRef } from "react";
import he from "he";
import ArticleCard from "./ArticleCard.jsx"; 

console.log('[Articles.jsx loaded]', new Date().toISOString());

// ---- CompactMultiSelect (replace your current one) ----
function CompactMultiSelect({ label, options, selected, setSelected, disabled }) {
  const CONTROL_H = 28;                  // match your <select> height
  const MIN_PANEL = 420;                 // minimum open width
  const MAX_PANEL = 640;                 // cap to avoid silly-wide menus

  const [open, setOpen] = React.useState(false);
  const [panelWidth, setPanelWidth] = React.useState(MIN_PANEL);
  const triggerRef = React.useRef(null);

  // Recompute panel width when opened
  React.useLayoutEffect(() => {
    if (!open) return;
    const el = triggerRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    // a bit wider than the button so long labels fit on one line
    setPanelWidth(Math.min(MAX_PANEL, Math.max(MIN_PANEL, w + 160)));
  }, [open]);

  const toggle = (id) => {
    const next = selected.includes(id)
      ? selected.filter(x => x !== id)
      : [...selected, id];
    setSelected(next);
  };

  const allCount = options?.reduce((sum, o) => sum + (o.count ?? 0), 0) ?? 0;
  const buttonLabel = selected.length
    ? `${selected.length} selected`
    : `All (${options?.length ?? 0})`;

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <div style={{ fontSize: 11, marginBottom: 4 }}>{label}</div>

      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(v => !v)}
        style={{
          height: CONTROL_H,
          lineHeight: `${CONTROL_H - 2}px`,
          padding: '0 10px',
          minWidth: 180,
          background: disabled ? '#f5f5f5' : '#fff',
          border: '1px solid #cfcfcf',
          borderRadius: 4,
          color: '#222',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span>{buttonLabel}</span>
        <span style={{ marginLeft: 'auto', opacity: 0.6 }}>▾</span>
      </button>

      {open && !disabled && (
        <div
          style={{
            position: 'absolute',
            top: CONTROL_H + 6,
            left: 0,
            zIndex: 50,
            background: '#fff',
            border: '1px solid #cfcfcf',
            borderRadius: 6,
            boxShadow: '0 10px 24px rgba(0,0,0,0.12)',
            minWidth: panelWidth,
            maxWidth: MAX_PANEL,
            overflow: 'hidden',
            lineHeight: 1.05,
          }}
        >
          {/* header row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '8px 10px',
              borderBottom: '1px solid #eee',
              fontSize: 12,
              color: '#666',
              background: '#fafafa',
            }}
          >
            <div style={{ flex: 1 }}>Select clusters</div>
            <div style={{ whiteSpace: 'nowrap' }}>{allCount.toLocaleString()}</div>
          </div>

          {/* options */}
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {options?.map((opt) => {
              const checked = selected.includes(opt.id);
              return (
                <label
                  key={opt.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '6px 4px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',   // keep on one line now that it's wider
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(opt.id)}
                    style={{ width: 14, height: 14 }}
                  />
                  <span style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: MAX_PANEL - 110, // leave room for count + paddings
                    display: 'inline-block',
                    verticalAlign: 'middle'
                  }}>
                    {opt.label}
                  </span>
                  <span style={{ marginLeft: 'auto', opacity: 0.65 }}>
                    {opt.count?.toLocaleString?.() ?? opt.count}
                  </span>
                </label>
              );
            })}
          </div>

          {/* footer actions */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              padding: '8px 10px',
              borderTop: '1px solid #eee',
              background: '#fafafa',
            }}
          >
            <button
              type="button"
              onClick={() => { setSelected([]); }}
              style={{ fontSize: 12 }}
            >
              Clear
            </button>
            <div style={{ marginLeft: 'auto' }} />
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{ fontSize: 12 }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}



export default function Articles() {

  // memberships for the logged-in account
  const [corpora, setCorpora] = useState([]);
  // --- read corpus_id from page URL once ---
  const [corpusId, setCorpusId] = useState(
    new URLSearchParams(window.location.search).get("corpus_id") || null
  );

  const [articles, setArticles] = useState([]);
  const [filteredArticles, setFilteredArticles] = useState([]);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [filterText, setFilterText] = useState("");
  const [publishedFilter, setPublishedFilter] = useState("24hours");
  const [sortBy, setSortBy] = useState("score"); // kept for future use
  const [feedback, setFeedback] = useState({});
  const summaryRef = useRef(null);
  const [likedOnly, setLikedOnly] = useState(false);
  const [openedOnly, setOpenedOnly] = useState(false);
  const [unOpenedOnly, setUnopenedOnly] = useState(false);
  const [theme, setTheme] = useState(null);
  const [category, setCategory] = useState(null);
  const [themes, setThemes] = useState([]);
  const [categories, setCategories] = useState([]);
  const [variety, setVariety] = useState(false);
  const [loading, setLoading] = useState(false);
  const [userId, setUserID] = useState(null);
  const [likedArticles, setLikedArticles] = useState([]);
  const [forgottenArticles, setForgottenArticles] = useState([]);
  const [clusterOptions, setClusterOptions] = useState([]);
  //const [tagOptions, setTagOptions] = useState([]);
  const [selectedClusters, setSelectedClusters] = useState([]); // array of group_ids
  //const [selectedTags, setSelectedTags] = useState([]);
  
  const [viewMode, setViewMode] = useState("list");          // NEW: "list" | "cards"
  const [collections, setCollections] = useState(null);       // NEW: result from /api/article_collections

  const handleThemeChange = (value) => {
    const newTheme = value || null;
    setTheme(newTheme);
    if (newTheme) setSelectedClusters([]);  
    if (!newTheme) {
      setCategory(null);  // <-- Reset category if no theme
    }
  };


  //const tagsDisabled = !!theme || !!category || selectedClusters.length > 0;
  const periodMap = { "24hours": 1, "2days": 2, "week": 7, "month": 30, "all": 101 };
  const buildFacetQS = () => {
    const p = new URLSearchParams({
      period: String(periodMap[publishedFilter] || 1),
      variety: variety ? "true" : "false",
    });
    if (userId) p.append("user_id", userId);
    if (likedOnly) p.append("liked", "true");
    if (openedOnly) p.append("opened", "true");
    if (unOpenedOnly) p.append("unOpened", "true");
    if (filterText.trim()) p.append("keyword", filterText.trim());
    if (corpusId) p.append("corpus_id", corpusId);
    return p.toString();
  };

const applyUrlParams = (next) => {
  const qs = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(next)) {
    if (!v || (Array.isArray(v) && v.length === 0)) qs.delete(k);
    else qs.set(k, Array.isArray(v) ? v.join("|") : v);
  }
  window.history.replaceState(null, "", `?${qs.toString()}`);
};

// --- helper for cards ---
const toDomain = (u) => { try { return new URL(u).hostname.replace(/^www\./,''); } catch { return ""; } };

// when toggling a cluster…
const onToggleCluster = (id) => {
  const next = selectedClusters.includes(id)
    ? selectedClusters.filter(x => x !== id)
    : [...selectedClusters, id];
  setSelectedClusters(next);
  if (next.length) {  setTheme(null); setCategory(null); }
  applyUrlParams({ clusters: next});
};

// sanitize summary HTML for List view (strip scripts/styles/images/embeds)
const sanitizeSummary = (html) => {
  if (!html) return "";
  try {
    const decoded = he.decode(html);
    return decoded
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<img[^>]*>/gi, "")
      .replace(/<\/?(iframe|video|audio|canvas|svg|object|embed)[^>]*>/gi, "")
      .replace(/\s+on\w+="[^"]*"/gi, ""); // strip inline handlers
  } catch { return ""; }
};

  // React to header selection (AuthHeader dispatches 'corpus-changed')
  useEffect(() => {
    function onCorpusChanged(e) {
      if (e?.detail && e.detail !== corpusId) {
        setCorpusId(e.detail);
      }
    }
    window.addEventListener('corpus-changed', onCorpusChanged);
    return () => window.removeEventListener('corpus-changed', onCorpusChanged);
  }, [corpusId]);


  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("corpus_id");
    if (fromUrl) setCorpusId(fromUrl);
  }, []);


  useEffect(() => {
    const onPop = () => {
      const q = new URLSearchParams(window.location.search).get("corpus_id") || null;
      setCorpusId(q);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);


  useEffect(() => {
    if (theme || category) { setClusterOptions([]); return; }

    (async () => {
      const res = await fetch(`/api/article_clusters?${buildFacetQS()}`, { credentials: 'include' });
      if (res.status === 401) {
        const next = "/articles/" + (window.location.search || "");
        window.location.href = `/login/?next=${encodeURIComponent(next)}`;
        return;
      }
      const raw = res.ok ? await res.json() : [];
      const mapped = Array.isArray(raw)
        ? raw.map(o => ({
            id: o.group_id ?? o.id ?? o.cluster_id,
            label: (o.label && String(o.label).trim()) ? o.label : (o.group_id ?? o.id ?? 'untitled'),
            count: o.count ?? o.cnt ?? o.n ?? 0,
          }))
        : [];
      setClusterOptions(mapped);
    })();
  }, [publishedFilter, likedOnly, openedOnly, unOpenedOnly, filterText, variety, userId, theme, category, corpusId]);


   useEffect(() => {
     if (!corpusId) return;
     (async () => {
       const qs = new URLSearchParams();
       qs.set("corpus_id", corpusId);
       const res = await fetch(`/api/themes?${qs.toString()}`, { credentials: "include" });
       if (res.status === 401) {
         const next = "/articles/" + (window.location.search || "");
         window.location.href = `/login/?next=${encodeURIComponent(next)}`;
         return;
       }
       if (res.ok) setThemes(await res.json());
     })();
    }, [corpusId]);

   useEffect(() => {
     if (!theme || theme === "") { setCategories([]); return; }
     if (!corpusId) return;
     (async () => {
       const qs = new URLSearchParams({ theme });

       qs.set("corpus_id", corpusId);
       const res = await fetch(`/api/categories?${qs.toString()}`, { credentials: "include" });
       if (res.status === 401) {
         const next = "/articles/" + (window.location.search || "");
         window.location.href = `/login/?next=${encodeURIComponent(next)}`;
         return;
       }
       if (res.ok) setCategories(await res.json());
     })();
   }, [theme, corpusId]);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/corpora", { credentials: "include" });
      if (res.status === 401) {
        const next = "/articles/" + (window.location.search || "");
        window.location.href = `/login/?next=${encodeURIComponent(next)}`;
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data?.corpora) ? data.corpora
                 : Array.isArray(data) ? data : [];
      setCorpora(list);
    })();
  }, []);

  // Choose a default corpus once memberships are known
  useEffect(() => {
    if (corpusId || corpora.length === 0) return;
    const def = corpora[0].corpus_id;
    setCorpusId(def);
    const qs = new URLSearchParams(window.location.search);
    qs.set("corpus_id", def);
    window.history.replaceState(null, "", `?${qs.toString()}`);
  }, [corpora, corpusId]);

  // -----------------------
  // Fetch liked articles from past sessions
  // -----------------------
  useEffect(() => {
    if (!userId) return;

    const fetchLikedArticles = async () => {
      try {
        const res = await fetch(`/api/liked_articles?user_id=${userId}`);
        if (!res.ok) return;
        const data = await res.json();
        // Expect data.likedIds = array of IDs; store as strings for stable .includes()
        setLikedArticles((data.likedIds || []).map((id) => String(id)));
      } catch (err) {
        console.error("Error fetching liked articles:", err);
      }
    };

    fetchLikedArticles();
  }, [userId]);

  useEffect(() => {
    let uid = localStorage.getItem("userId");
    if (!uid) {
      uid = `user-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem("userId", uid);
    }
    setUserID(uid);

    if (!localStorage.getItem("sessionID")) {
      const sid = `sess-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem("sessionID", sid);
    }
  }, []);



  // 2. Handle article click (logs "open" only when expanding)
  const handleArticleClick = (article) => {
    const opening = !selectedArticle || selectedArticle.id !== article.id;
    setSelectedArticle(opening ? article : null);

    if (!opening) return; // collapsing → don't log

    const sessionID = localStorage.getItem("sessionID") || "default-session";
    const safeUserID = userId || "anonymous";

    fetch("/api/user_interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: safeUserID,
        session_id: sessionID,
        article_id: Number(article.id),     // strictly integer id
        interaction_type: "open",
        value: null
      })
    }).catch(() => {});
  };



  // -----------------------
  // 1. Fetch articles from new /articles endpoint
  // -----------------------
  useEffect(() => {
    const fetchArticles = async () => {
      if (!corpusId) return;
      setLoading(true);

      const periodMap = { "24hours": 1, "2days": 2, "week": 7, "month": 30, "all": 101 };
      const period = periodMap[publishedFilter] || 1;

      const params = new URLSearchParams({
        limit: "50",
        period: String(period),
        variety: variety ? "true" : "false",
      });

      if (userId) params.append("user_id", userId);
      if (likedOnly) params.append("liked", "true");
      if (openedOnly) params.append("opened", "true");
      if (unOpenedOnly) params.append("unOpened", "true");
      if (filterText.trim()) params.append("keyword", filterText.trim());
      console.log ("in fetchArticles, corpusId: ", corpusId);
      if (corpusId) params.append("corpus_id", corpusId);
      console.log('[fetch /api/articles]', params.toString());
      // Mutually exclusive filters:
      if (selectedClusters.length) {
        params.append("clusters", selectedClusters.join("|"));
        params.delete("theme"); params.delete("category");
      }  else {
        if (theme) params.append("theme", theme);
        if (category) params.append("category", category);
      }

      try {
        const res = await fetch(`/api/articles?${params.toString()}`, { credentials: 'include' });
        if (res.status === 401) {
          const next = "/articles/" + (window.location.search || "");
          window.location.href = `/login/?next=${encodeURIComponent(next)}`;
          return;
        }
        // Accept both shapes: { articles: [...] } OR bare [ ... ]
        const data = res.ok ? await res.json() : [];
        const list = Array.isArray(data?.articles) ? data.articles
                   : (Array.isArray(data) ? data : []);
        setArticles(list);
        setFilteredArticles(list); // keep river in sync with server result

      } catch (err) {
        console.error("Error fetching articles:", err);
        setArticles([]);
        setFilteredArticles([]);
      } finally {
        setLoading(false);
      }
    };

    fetchArticles();
  }, [
    publishedFilter,
    likedOnly,
    openedOnly,
    unOpenedOnly,
    theme,
    category,
    variety,
    filterText,
    userId,
    selectedClusters,
    corpusId
  ]);

  // -----------------------
  // Build Collections when in Cards view (non-destructive)
  // -----------------------
  useEffect(() => {
    if (!corpusId) return;

    if (viewMode !== "cards") { setCollections(null); return; }

    if (!articles || !articles.length) { setCollections({ groups: [] }); return; }
    // Use what's on screen; switch to `articles` if you prefer server result strictly
    const ids = (filteredArticles.length ? filteredArticles : articles).map(a => a.id).join(",");    

    const qs = new URLSearchParams({
      ids,
      group_limit: "40",
      max_siblings: "50",
      min_similarity: "0.2",
      half_life_days: "7",
      min_group_size_to_seed: "2",
      w_rel: "0.75",
      w_rec: "0.20",
      w_nov: "0.05",
    });

    if (userId) qs.set("user_id", userId);
    qs.set("exclude_forgotten", "true");
    if (corpusId) qs.set("corpus_id", corpusId);
    fetch(`/api/article_collections?${qs.toString()}`)
      .then(r => r.ok ? r.json() : { groups: [] })
      .then(setCollections)
      .catch(() => setCollections({ groups: [] }));
  }, [viewMode, articles, filteredArticles, userId, corpusId]);

  // Rebuild collections on-demand (used by seed "Forget" flow a.1)
  const rebuildCollectionsExcluding = async (excludeId) => {

    const source = (filteredArticles.length ? filteredArticles : articles)
      .filter(a => String(a.id) !== String(excludeId));
    if (!source.length) { setCollections({ groups: [] }); return; }

    const ids = source.map(a => a.id).join(",");
    const qs = new URLSearchParams({
      ids,
      group_limit: "40",
      max_siblings: "50",
      min_similarity: "0.2",
      half_life_days: "7",
      min_group_size_to_seed: "2",
      w_rel: "0.75",
      w_rec: "0.20",
      w_nov: "0.05",
    });

    if (corpusId) qs.set("corpus_id", corpusId);
    if (userId) qs.set("user_id", userId);
    qs.set("exclude_forgotten", "true");
    try {
      const res = await fetch(`/api/article_collections?${qs.toString()}`);
      if (res.status === 401) { window.location.href = `/login/?next=${encodeURIComponent('/articles/' + (window.location.search||''))}`; return; }
      const data = res.ok ? await res.json() : { groups: [] };
      setCollections(data);
    } catch {
      setCollections({ groups: [] });
    }
  };

  // --- Card handlers (mirror existing semantics) ---
  const onCardLike = (id) => {
    const a = articles.find(x => String(x.id) === String(id));
    if (!a) return;

    // log like/unlike as you already do in list
    const sessionID = localStorage.getItem("sessionID") || "default-session";
    const safeUserID = userId || "anonymous";

    const key = String(a.id);
    const wasLiked = likedArticles.includes(key);
    setLikedArticles(prev => wasLiked ? prev.filter(x => x !== key) : [...prev, key]);


    fetch("/api/user_interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: safeUserID,
        session_id: sessionID,
        article_id: Number(a.id),
        interaction_type: "rate",
        value: wasLiked ? "unliked" : "liked",
      })
    }).catch(() => {});
  };

  const onCardForget = (id) => {
    const a = articles.find(x => String(x.id) === String(id));
    if (!a) return;
    // mirror list behavior: log & remove from view
    const sessionID = localStorage.getItem("sessionID") || "default-session";
    const safeUserID = userId || "anonymous";
    fetch("/api/user_interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: safeUserID,
        session_id: sessionID,
        article_id: Number(a.id),
        interaction_type: "rate",
        value: "forget"
      })
    }).catch(() => {});
    setForgottenArticles(prev => [...prev, a.id]);
    setLikedArticles(prev => prev.filter(x => x !== a.id));
    // Remove the seed from both sources feeding collections
    setArticles(prev => prev.filter(x => x.id !== a.id));
    setFilteredArticles(prev => prev.filter(x => x.id !== a.id));
    // Optimistically remove the group from current collections
    setCollections(prev => {
      if (!prev?.groups) return prev;
      return { ...prev, groups: prev.groups.filter(g => String(g.seed.id) !== String(a.id)) };
    });
    // Recompute collections immediately, excluding this id (a.1)
    rebuildCollectionsExcluding(a.id);
   };



  const onCardPaywall = (id) => {
    const a = articles.find(x => String(x.id) === String(id));
    if (!a) return;
    const sessionID = localStorage.getItem("sessionID") || "default-session";
    const safeUserID = userId || "anonymous";
    fetch("/api/user_interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: safeUserID,
        session_id: sessionID,
        article_id: Number(a.id),
        interaction_type: "paywall",
        value: null
      })
    }).catch(() => {});
    setArticles(prev => prev.filter(x => x.id !== a.id));
  };

  // keep “open on expand” semantics
  const onCardExpandDetails = (id, open) => {
    if (!open) return;
    const a = articles.find(x => String(x.id) === String(id));
    if (!a) return;
    const sessionID = localStorage.getItem("sessionID") || "default-session";
    const safeUserID = userId || "anonymous";
    fetch("/api/user_interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: safeUserID,
        session_id: sessionID,
        article_id: Number(a.id),
        interaction_type: "open",
        value: null
      })
    }).catch(() => {});
  };

  // -----------------------
  // 3. Feedback logging (Like / Forget)
  // -----------------------
  const logInteraction = async (article, action) => {
    setFeedback((prev) => ({ ...prev, [article.id]: action }));

    const sessionID = localStorage.getItem("sessionID") || "default-session";
    const safeUserID = userId || "anonymous";

    let interactionType = "rate";
    let value = null;
    if (action === "like") value = "liked";
    else if (action === "forget") value = "forget";
    else if (action === "unlike") value = "unliked"; // optional, harmless
    else if (action === "paywall") value = "paywall";

    try {
      await fetch("/api/user_interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: safeUserID,
          session_id: sessionID,
          article_id: Number(article.id),     // <- ensure integer
          interaction_type: interactionType,  // 'rate'
          value                                // 'liked' | 'forget' | 'unliked'
        }),
      });
    } catch (err) {
      console.error("Error logging interaction:", err);
    }
  };


  // -----------------------
  // 4. Render
  // -----------------------

    return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
      {/* --- Top Filter Bar --- */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",        // ✅ allows filters to wrap to next line
          gap: "0.75rem 1rem",     // vertical gap, horizontal gap
          padding: "0.5rem 0.5rem 0.25rem 0.5rem",
          borderBottom: "1px solid #ddd",
          backgroundColor: "#f9f9f9",
          alignItems: "flex-start",
        }}
      >

        {/* View  */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <label style={{ fontSize: "0.7rem", marginBottom: "0.25rem" }}>View</label>
          <select
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value)}
            style={{ width: "75px" }}
          >
            <option value="list">List</option>
            <option value="cards">Cards</option>
          </select>
        </div>

        {/* Recency */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <label style={{ fontSize: "0.7rem", marginBottom: "0.25rem" }}>Recency</label>
          <select
            value={publishedFilter}
            onChange={(e) => setPublishedFilter(e.target.value)}
            style={{ width: "100px" }}
          >
            <option value="24hours">24 Hours</option>
            <option value="2days">2 Days</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
            <option value="all">All</option>
          </select>
        </div>


        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <label style={{ fontSize: "0.7rem", marginBottom: "0.25rem" }}>Corpus</label>
          <select
            value={corpusId || ""}
            onChange={(e) => {
              const v = e.target.value || null;
              setCorpusId(v);
              const qs = new URLSearchParams(window.location.search);
              if (v) qs.set("corpus_id", v); else qs.delete("corpus_id");
              window.history.replaceState(null, "", `?${qs.toString()}`);
            }}
          >
            {corpora.map(c => (
              <option key={c.corpus_id} value={c.corpus_id}>
                {c.label || c.corpus_id}
              </option>
            ))}
          </select>
        </div>




        {/* Theme */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <label style={{ fontSize: "0.7rem", marginBottom: "0.25rem" }}>Theme</label>
          <select
            value={theme || ""}
            onChange={(e) => handleThemeChange(e.target.value)}
            style={{ width: "200px" }}
          >
            <option value="">All</option>
            {themes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {/* Category */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <label style={{ fontSize: "0.7rem", marginBottom: "0.25rem" }}>Category</label>
          <select
            value={category || ""}
            onChange={(e) => setCategory(e.target.value || null)}
            style={{ width: "120px" }}
            disabled={!theme}
          >
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>


        {/* Keyword Search */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <label style={{ fontSize: "0.7rem", marginBottom: "0.25rem" }}>Keyword search</label>
          <input
            type="text"
            placeholder="Enter text..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            style={{ width: "150px" }}
          />
        </div>

        {/* Liked */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <label style={{ fontSize: "0.7rem", marginBottom: "0.25rem" }}>Liked</label>
          <input
            type="checkbox"
            checked={likedOnly}
            onChange={(e) => setLikedOnly(e.target.checked)}
          />
        </div>

        {/* Viewed */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <label style={{ fontSize: "0.7rem", marginBottom: "0.25rem" }}>Viewed</label>
          <input
            type="checkbox"
            checked={openedOnly}
            onChange={(e) => setOpenedOnly(e.target.checked)}
          />
        </div>

        {/* Not Viewed */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <label style={{ fontSize: "0.7rem", marginBottom: "0.25rem" }}>Not viewed</label>
          <input
            type="checkbox"
            checked={unOpenedOnly}
            onChange={(e) => setUnopenedOnly(e.target.checked)}
          />
        </div>



      </div>

      {/* --- Article List with Accordion --- */}
      <div style={{ flex: 1, overflowY: "scroll", padding: "1rem" }}>

        {loading ? (
          <div>Loading articles...</div>
        ) : articles.length === 0 ? (
          <div>No results for the current filters.</div>
        ) : viewMode === "cards" ? (
          !collections ? (
            <div>Building collections…</div>
          ) : collections.groups?.length ? (

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>

              {collections.groups.map((g) => {
                const seed = g.seed;
                const members = g.members || [];
                const mapped = {
                  id: String(seed.id),
                  title: he.decode(seed.title || ""),
                  url: seed.url,
                  domain: (seed.feed_name && String(seed.feed_name).trim()) || toDomain(seed.url),
                  publishedAt: seed.published_date || seed.processed_date || null,


                  // Seed summary (decode). Fallback to first member if seed summary missing.
                  summary: seed.summary
                    ? he.decode(seed.summary)
                    : (members[0]?.summary ? he.decode(members[0].summary) : ""),

                  liked: likedArticles.includes(String(seed.id)),
                  grouped: {
                    groupId: `rel:${seed.id}`,
                    count: Math.max(0, members.length - 1),
                    topSources: g.top_sources || [],
                    siblings: members.slice(1).map((s) => ({
                      id: String(s.id),
                      title: he.decode(s.title || ""),
                      url: s.url,
                      domain: (s.feed_name && String(s.feed_name).trim()) || toDomain(s.url),
                      publishedAt: s.published_date || s.processed_date || null,
                      summary: s.summary ? he.decode(s.summary) : "",
                      score: s.similarity_score ?? null,
                      liked: likedArticles.includes(String(s.id)),
                    })),
                  },
                };
                return (
                  <ArticleCard
                    key={mapped.id}
                    article={mapped}
                    density="list"
                    maxSiblingPreview={5}
                    onLike={onCardLike}
                    onForget={onCardForget}
                    onPaywallToggle={onCardPaywall}
                    onExpandDetails={onCardExpandDetails}


                    onSiblingLike={(sid) => {
                      const key = String(sid);
                      const was = likedArticles.includes(key);
                      setLikedArticles(prev => was ? prev.filter(x => x !== key) : [...prev, key]);

                      const sessionID = localStorage.getItem("sessionID") || "default-session";
                      const safeUserID = userId || "anonymous";
                      fetch("/api/user_interactions", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          user_id: safeUserID,
                          session_id: sessionID,
                          article_id: Number(sid),
                          interaction_type: "rate",
                          value: was ? "unliked" : "liked",
                        })
                      }).catch(() => {});
                    }}
                    onSiblingAddToCollection={(sid) => {
                      // placeholder: wire to your collection flow as needed
                      console.debug("add-to-collection (sibling)", sid);
                    }}
                    onSiblingHide={(sid) => {
                      // Log & purge from current group(s) view
                      const sessionID = localStorage.getItem("sessionID") || "default-session";
                      const safeUserID = userId || "anonymous";
                      fetch("/api/user_interactions", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          user_id: safeUserID,
                          session_id: sessionID,
                          article_id: Number(sid),
                          interaction_type: "rate",
                          value: "forget",
                        })
                      }).catch(() => {});

                      const key = String(sid);
                      setForgottenArticles(prev => [...prev, key]);
                      setLikedArticles(prev => prev.filter(x => x !== key));
                      setCollections(prev => {
                        if (!prev?.groups) return prev;
                        return {
                          ...prev,
                          groups: prev.groups.map(gr => ({
                            ...gr,
                            members: (gr.members || []).filter(m => String(m.id) !== String(sid))
                          }))
                        };
                      });
                    }}



                  />
                );
              })}
            </div>
          ) : (
            <div>No collections for the current filters.</div>
          )
        ) : (
          /* LIST PATH — UI Tweak 2: show only meta row + 1-line title when collapsed */
          filteredArticles.map((article) => (
            <div
              key={article.id}
              onClick={() => handleArticleClick(article)}
              style={{
                padding: "0.5rem",
                marginBottom: "0.4rem",
                background: selectedArticle && selectedArticle.id === article.id ? "#f0f6ff" : "#fff",
                border: "1px solid #ddd",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              
              {/* --- Title (clamped to 1 line) --- */}
              <div
                style={{
                  fontSize: "1rem",
                  fontWeight: selectedArticle && selectedArticle.id === article.id ? "bold" : "bold",
                  textOverflow: "ellipsis",
                  overflow: "hidden",
                  whiteSpace: "nowrap"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", overflow: "hidden" }}>
                  {likedArticles.includes(String(article.id)) && (
                    <span aria-label="liked" title="Liked" style={{ color: "#e6a700", fontWeight: 700 }}>★</span>
                  )}

                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }} title={he.decode(article.title || "")}>
                    {he.decode(article.title || "")}
                  </span>

                </div>
              </div>

              {/* --- Row: Source & Date & Theme/Category & Score/Actions --- */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ color: "#555" }}>
                    {article.feed_name || ""}
                  </span>
                  <span style={{ margin: "0 1rem", color: "#999" }}>
                    {article.published_date
                      ? new Date(article.published_date).toLocaleString()
                      : (article.processed_date
                        ? new Date(article.processed_date).toLocaleString()
                        : "")}
                  </span>
                  <span style={{ color: "#777" }}>
                    {article.theme ? `${article.theme}` : ""}
                    {article.category ? ` › ${article.category}` : ""}
                  </span>
                </div>
              </div>



              {/* --- Summary (collapsed/expanded as before) --- */}
              {/* --- Summary (only on expand) --- */}
              {!selectedArticle || selectedArticle.id !== article.id ? null : (
                <div style={{ marginTop: "0.5rem" }}>


                  <div style={{ marginBottom: "0.5rem" }}>

                    <a
                      href={article.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        color: "#0066cc",
                        textDecoration: "underline",
                        fontWeight: "bold",
                        marginBottom: "0.5rem",
                        display: "inline-block",
                      }}
                    >
                      View full article
                    </a>

                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                    <span style={{ fontWeight: "bold" }}>Your feedback:</span>




                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const key = String(article.id);
                        if (likedArticles.includes(key)) {
                          setLikedArticles((prev) => prev.filter((id) => id !== key));
                          logInteraction(article, "unlike");
                        } else {
                          setLikedArticles((prev) => [...prev, key]);
                          logInteraction(article, "like");
                        }
                      }}
                      style={{
                        marginRight: "0.5rem",
                        //backgroundColor: likedArticles.includes(article.id) ? "#fff9e6" : "#fff",
                        //backgroundColor: "#fff",
                        boxShadow: likedArticles.includes(String(article.id)) ? "inset 3px 0 0 #e6a700" : "none",
                        //color: likedArticles.includes(article.id) ? "white" : "",
                      }}
                    >
                      {likedArticles.includes(String(article.id)) ? "Unlike" : "Like"}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        logInteraction(article, "forget");
                        setForgottenArticles((prev) => [...prev, article.id]);
                        setLikedArticles((prev) => prev.filter((id) => id !== article.id));
                        setArticles((prev) => prev.filter((a) => a.id !== article.id));
                        setFilteredArticles((prev) => prev.filter((a) => a.id !== article.id));
                      }}
                      style={{
                        marginRight: "0.5rem",
                        backgroundColor: forgottenArticles.includes(article.id) ? "red" : "",
                        color: forgottenArticles.includes(article.id) ? "white" : "",
                      }}
                    >
                      Forget
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        logInteraction(article, "paywall");
                        setArticles((prev) => prev.filter((a) => a.id !== article.id));
                        setFilteredArticles((prev) => prev.filter((a) => a.id !== article.id));
                      }}
                    >
                      Paywall
                    </button>
                  </div>
                  </div>


                  <div
                    style={{
                      marginTop: "0.5rem",
                      backgroundColor: "#fafafa",
                      padding: "0.75rem",
                      border: "1px solid #ddd",
                      borderRadius: "4px",
                      lineHeight: "1.5",
                      fontSize: "0.95rem",
                      color: "#333",
                      display: "-webkit-box",
                      WebkitLineClamp: 15,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                      whiteSpace: "normal",
                    }}
                    dangerouslySetInnerHTML={{ __html: sanitizeSummary(selectedArticle.summary) || "No summary available." }}
                  />

                </div>
              )}
            </div>
          ))
        )}



      </div>
    </div>
  );


}
