import React, { useEffect, useState, useRef, useMemo } from "react";
import he from "he";
import ArticleCard from "./ArticleCard";

/*************************
 * CompactMultiSelect (kept inline; matches your current behavior)
 *************************/
function CompactMultiSelect({ label, options, selected, setSelected, disabled }) {
  const CONTROL_H = 28;
  const MIN_PANEL = 420;
  const MAX_PANEL = 640;

  const [open, setOpen] = React.useState(false);
  const [panelWidth, setPanelWidth] = React.useState(MIN_PANEL);
  const triggerRef = React.useRef(null);

  React.useLayoutEffect(() => {
    if (!open) return;
    const el = triggerRef.current;
    if (!el) return;
    const w = el.offsetWidth;
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
                    whiteSpace: 'nowrap',
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
                    maxWidth: MAX_PANEL - 110,
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

          <div
            style={{
              display: 'flex',
              gap: 8,
              padding: '8px 10px',
              borderTop: '1px solid #eee',
              background: '#fafafa',
            }}
          >
            <button type="button" onClick={() => { setSelected([]); }} style={{ fontSize: 12 }}>Clear</button>
            <div style={{ marginLeft: 'auto' }} />
            <button type="button" onClick={() => setOpen(false)} style={{ fontSize: 12 }}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

/*************************
 * Articles (page)
 *************************/
export default function Articles() {
  const [articles, setArticles] = useState([]);
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
  const [selectedClusters, setSelectedClusters] = useState([]);

  const handleThemeChange = (value) => {
    const newTheme = value || null;
    setTheme(newTheme);
    if (newTheme) setSelectedClusters([]);
    if (!newTheme) { setCategory(null); }
  };

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

  const onToggleCluster = (id) => {
    const next = selectedClusters.includes(id)
      ? selectedClusters.filter(x => x !== id)
      : [...selectedClusters, id];
    setSelectedClusters(next);
    if (next.length) { setTheme(null); setCategory(null); }
    applyUrlParams({ clusters: next});
  };

  // Fetch cluster options
  useEffect(() => {
    if (theme || category) { setClusterOptions([]); return; }
    (async () => {
      const res = await fetch(`/article_clusters?${buildFacetQS()}`);
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
  }, [publishedFilter, likedOnly, openedOnly, unOpenedOnly, filterText, variety, userId, theme, category]);

  // Themes
  useEffect(() => {
    const fetchThemes = async () => {
      try { const res = await fetch("/themes/"); if (res.ok) setThemes(await res.json()); } catch {}
    };
    fetchThemes();
  }, []);

  // Categories for theme
  useEffect(() => {
    if (!theme || theme === "") { setCategories([]); return; }
    const fetchCategories = async () => {
      try { const res = await fetch(`/categories/?theme=${encodeURIComponent(theme)}`); if (res.ok) setCategories(await res.json()); } catch {}
    };
    fetchCategories();
  }, [theme]);

  // Liked from past sessions
  useEffect(() => {
    if (!userId) return;
    (async () => {
      try { const res = await fetch(`/api/liked_articles?user_id=${userId}`); if (res.ok) { const data = await res.json(); setLikedArticles(data.likedIds || []); } } catch {}
    })();
  }, [userId]);

  // Init user/session ids
  useEffect(() => {
    let uid = localStorage.getItem("userId");
    if (!uid) { uid = `user-${Math.random().toString(36).slice(2)}`; localStorage.setItem("userId", uid); }
    setUserID(uid);

    if (!localStorage.getItem("sessionID")) {
      const sid = `sess-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem("sessionID", sid);
    }
  }, []);

  // Log open
  const logOpen = (article) => {
    const sessionID = localStorage.getItem("sessionID") || "default-session";
    const safeUserID = userId || "anonymous";
    fetch("/user_interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: safeUserID,
        session_id: sessionID,
        article_id: Number(article.id),
        interaction_type: "open",
        value: null
      })
    }).catch(() => {});
  };

  // Fetch articles
  useEffect(() => {
    const fetchArticles = async () => {
      setLoading(true);
      const period = periodMap[publishedFilter] || 1;
      const params = new URLSearchParams({ limit: "50", period: String(period), variety: variety ? "true" : "false" });
      if (userId) params.append("user_id", userId);
      if (likedOnly) params.append("liked", "true");
      if (openedOnly) params.append("opened", "true");
      if (unOpenedOnly) params.append("unOpened", "true");
      if (filterText.trim()) params.append("keyword", filterText.trim());
      if (selectedClusters.length) {
        params.append("clusters", selectedClusters.join("|"));
      } else {
        if (theme) params.append("theme", theme);
        if (category) params.append("category", category);
      }
      try { const res = await fetch(`/api/articles?${params.toString()}`); const data = res.ok ? await res.json() : []; setArticles(Array.isArray(data) ? data : []); }
      catch { setArticles([]); } finally { setLoading(false); }
    };
    fetchArticles();
  }, [publishedFilter, likedOnly, openedOnly, unOpenedOnly, theme, category, variety, filterText, userId, selectedClusters]);

  // Record like/forget/paywall
  const logInteraction = async (article, action) => {
    setFeedback((prev) => ({ ...prev, [article.id]: action }));
    const sessionID = localStorage.getItem("sessionID") || "default-session";
    const safeUserID = userId || "anonymous";
    let interactionType = "rate";
    let value = null;
    if (action === "like") value = "liked";
    else if (action === "forget") value = "forget";
    else if (action === "unlike") value = "unliked";
    else if (action === "paywall") value = "paywall";
    try {
      await fetch("/user_interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: safeUserID,
          session_id: sessionID,
          article_id: Number(article.id),
          interaction_type: interactionType,
          value
        }),
      });
    } catch {}
  };

  // Build grouping info *within current list* (only when backend provides duplicate_group_id)
  const groupIndex = useMemo(() => {
    const byId = new Map();
    for (const a of articles) {
      const g = a.duplicate_group_id; // EXPECTED from backend in Step 1; otherwise no grouping UI
      if (!g) continue;
      if (!byId.has(g)) byId.set(g, { ids: [], sources: new Map() });
      byId.get(g).ids.push(a.id);
      byId.get(g).sources.set(a.domain, (byId.get(g).sources.get(a.domain) || 0) + 1);
    }
    return byId;
  }, [articles]);

  const inboxCount = articles.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
      {/* --- Top Filter Bar --- */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem 1rem",
          padding: "0.5rem 0.5rem 0.25rem 0.5rem",
          borderBottom: "1px solid #ddd",
          backgroundColor: "#f9f9f9",
          alignItems: "flex-start",
        }}
      >
        {/* Recency */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <label style={{ fontSize: "0.7rem", marginBottom: "0.25rem" }}>Recency</label>
          <select value={publishedFilter} onChange={(e) => setPublishedFilter(e.target.value)} style={{ width: "100px" }}>
            <option value="24hours">24 Hours</option>
            <option value="2days">2 Days</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
            <option value="all">All</option>
          </select>
        </div>

        {/* Theme */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <label style={{ fontSize: "0.7rem", marginBottom: "0.25rem" }}>Theme</label>
          <select value={theme || ""} onChange={(e) => handleThemeChange(e.target.value)} style={{ width: "120px" }}>
            <option value="">All</option>
            {themes.map((t) => (<option key={t} value={t}>{t}</option>))}
          </select>
        </div>

        {/* Category */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <label style={{ fontSize: "0.7rem", marginBottom: "0.25rem" }}>Category</label>
          <select value={category || ""} onChange={(e) => setCategory(e.target.value || null)} style={{ width: "120px" }} disabled={!theme}>
            <option value="">All</option>
            {categories.map((c) => (<option key={c} value={c}>{c}</option>))}
          </select>
        </div>

        {/* Article Clusters */}
        <CompactMultiSelect
          label="Cluster (articles)"
          options={clusterOptions}
          selected={selectedClusters}
          setSelected={(ids) => { setTheme(null); setCategory(null); setSelectedClusters(ids); }}
          disabled={!!theme || !!category}
        />

        {/* Keyword Search */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <label style={{ fontSize: "0.7rem", marginBottom: "0.25rem" }}>Keyword search</label>
          <input type="text" placeholder="Enter text..." value={filterText} onChange={(e) => setFilterText(e.target.value)} style={{ width: "250px" }} />
        </div>

        {/* Liked */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <label style={{ fontSize: "0.7rem", marginBottom: "0.25rem" }}>Liked</label>
          <input type="checkbox" checked={likedOnly} onChange={(e) => setLikedOnly(e.target.checked)} />
        </div>

        {/* Viewed */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <label style={{ fontSize: "0.7rem", marginBottom: "0.25rem" }}>Viewed</label>
          <input type="checkbox" checked={openedOnly} onChange={(e) => setOpenedOnly(e.target.checked)} />
        </div>

        {/* Not Viewed */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <label style={{ fontSize: "0.7rem", marginBottom: "0.25rem" }}>Not viewed</label>
          <input type="checkbox" checked={unOpenedOnly} onChange={(e) => setUnopenedOnly(e.target.checked)} />
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Inbox counter */}
        <div style={{ alignSelf: "flex-end", color: "#666", fontSize: 12 }}>{inboxCount} items</div>
      </div>

      {/* --- Article List --- */}
      <div style={{ flex: 1, overflowY: "scroll", padding: "1rem" }}>
        {loading ? (
          <div>Loading articles...</div>
        ) : articles.length === 0 ? (
          <div>No results for the current filters.</div>
        ) : (
          articles.map((article) => {
            const isOpen = selectedArticle && selectedArticle.id === article.id;

            // summary HTML (preserve your image styling transform)
            const summaryHtml = ((isOpen ? (article.summary || "No summary available.") : ""))
              .replace(
                /<img /g,
                `<img style="display:block;max-width:100%;max-height:400px;width:auto;height:auto;object-fit:contain;margin:0 auto;background-color:#fff;" `
              );

            // Build grouped sibling info (only if backend provides duplicate_group_id)
            let grouped = undefined;
            const g = article.duplicate_group_id;
            if (g && groupIndex.has(g)) {
              const entry = groupIndex.get(g);
              const ids = entry.ids.filter(id => id !== article.id);
              const siblings = articles.filter(a => ids.includes(a.id)).map(a => ({
                id: a.id, title: a.title, url: a.url, domain: a.domain, publishedAt: a.published_date, liked: !!a.liked, paywalled: !!a.paywalled
              }));
              const topSources = Array.from(entry.sources.entries())
                .sort((a,b) => b[1]-a[1])
                .slice(0, 3)
                .map(([domain]) => domain);
              grouped = { groupId: g, count: ids.length, topSources, siblings };
            }

            return (
              <ArticleCard
                key={article.id}
                article={{
                  id: article.id,
                  title: he.decode(article.title || ""),
                  url: article.url,
                  domain: article.domain,
                  publishedAt: article.published_date,
                  liked: !!article.liked,
                  paywalled: !!article.paywalled,
                  firstSighted: !!article.first_sighted,
                  clusterId: article.cluster_id,
                  tags: article.tags || [],
                  grouped,
                }}
                initialDetailsExpanded={isOpen}
                initialSimilarExpanded={false}
                maxSiblingPreview={1} // set to 1 for mobile feel; bump on desktop
                onLike={(id) => { if (!likedArticles.includes(id)) setLikedArticles(prev => [...prev, id]); logInteraction(article, "like"); }}
                onAddToCollection={(id) => { /* open your picker; also log like */ if (!likedArticles.includes(id)) setLikedArticles(prev => [...prev, id]); logInteraction(article, "like"); }}
                onForget={(id) => { logInteraction(article, "forget"); setForgottenArticles(prev => [...prev, article.id]); setLikedArticles(prev => prev.filter(x => x !== article.id)); setArticles(prev => prev.filter(x => x.id !== article.id)); }}
                onPaywallToggle={(id,val) => { if (val) { logInteraction(article, "paywall"); setArticles(prev => prev.filter(x => x.id !== article.id)); } }}
                onExpandDetails={(id,open)=>{ if (open) logOpen(article); if (open) setSelectedArticle(article); else setSelectedArticle(null); }}
                onExpandSimilar={(gid,open)=>{}}
                onSiblingClick={(sid)=>{}}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
