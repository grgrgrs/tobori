import React, { useEffect, useState, useRef } from "react";
import he from "he";



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



// when toggling a cluster…
const onToggleCluster = (id) => {
  const next = selectedClusters.includes(id)
    ? selectedClusters.filter(x => x !== id)
    : [...selectedClusters, id];
  setSelectedClusters(next);
  if (next.length) { setSelectedTags([]); setTheme(null); setCategory(null); }
  applyUrlParams({ clusters: next, tags: [] });
};

// Tag topics: global list (fetch once, no querystring)
useEffect(() => {
  (async () => {
    try {
      const res = await fetch('/tag_topics');   // <= no period/user filters
      const raw = res.ok ? await res.json() : [];
      // normalize to {group_id, label, count}
      const norm = Array.isArray(raw)
        ? raw.map(o => ({
            group_id: o.group_id ?? o.id ?? o.topic_id,
            label: (o.label && String(o.label).trim()) ? o.label : (o.group_id ?? o.id ?? 'untitled'),
            count: o.count ?? o.cnt ?? o.n ?? 0,
          }))
          .sort((a,b) => a.label.localeCompare(b.label, undefined, {sensitivity:'base'}))
        : [];
      setTagOptions(norm);
      console.log('[/tag_topics] options:', norm); // sanity log
    } catch (e) {
      console.error('Failed /tag_topics', e);
      setTagOptions([]);
    }
  })();
}, []);


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


  useEffect(() => {
    const fetchThemes = async () => {
      try {
        const res = await fetch("/themes/");
        if (res.ok) {
          const data = await res.json();
          setThemes(data);
        }
      } catch (err) {
        console.error("Error fetching themes:", err);
      }
    };
    fetchThemes();
  }, []);

  useEffect(() => {
    if (!theme || theme === "") {
      setCategories([]); // disables category dropdown
      return;
    }
    const fetchCategories = async () => {
      try {
        const res = await fetch(`/categories/?theme=${encodeURIComponent(theme)}`);
        if (res.ok) {
          const data = await res.json();
          setCategories(data);
        }
      } catch (err) {
        console.error("Error fetching categories:", err);
      }
    };
    fetchCategories();
  }, [theme]);

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
        // Expect data.likedIds = array of article IDs
        setLikedArticles(data.likedIds || []);
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

    fetch("/user_interactions", {
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

      // Mutually exclusive filters:
      if (selectedClusters.length) {
        params.append("clusters", selectedClusters.join("|"));
        params.delete("theme"); params.delete("category");
      }  else {
        if (theme) params.append("theme", theme);
        if (category) params.append("category", category);
      }

      try {
        const res = await fetch(`/api/articles?${params.toString()}`);
        const data = res.ok ? await res.json() : [];
        setArticles(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Error fetching articles:", err);
        setArticles([]);
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
  ]);


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

    try {
      await fetch("/user_interactions", {
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

        {/* Theme */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <label style={{ fontSize: "0.7rem", marginBottom: "0.25rem" }}>Theme</label>
          <select
            value={theme || ""}
            onChange={(e) => handleThemeChange(e.target.value)}
            style={{ width: "120px" }}
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


        {/* Article Clusters */}
        <CompactMultiSelect
          label="Cluster (articles)"
          options={clusterOptions}
          selected={selectedClusters}
          setSelected={(ids) => {
            // selecting any cluster disables Tag + Theme/Category
            //setSelectedTags([]);
            setTheme(null); setCategory(null);
            setSelectedClusters(ids);
          }}
          disabled={!!theme || !!category}
        />

        {/* Keyword Search */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <label style={{ fontSize: "0.7rem", marginBottom: "0.25rem" }}>Keyword search</label>
          <input
            type="text"
            placeholder="Enter text..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            style={{ width: "250px" }}
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

        {/* Spacer */}
        <div style={{ flex: 1 }} />
      </div>

      {/* --- Article List with Accordion --- */}
      <div style={{ flex: 1, overflowY: "scroll", padding: "1rem" }}>
        {loading ? (
        <div>Loading articles...</div>
          ) : articles.length === 0 ? (
            <div>No results for the current filters.</div>
          ) : (
          articles.map((article) => (
          <div
            key={article.id}
            style={{
              borderBottom: "1px solid #eee",
              paddingBottom: "0.75rem",
              marginBottom: "0.75rem",
              cursor: "pointer",
              backgroundColor: likedArticles.includes(article.id) ? "#fff9e6" : "#fff",
              transition: "background-color 0.2s ease-in-out",
            }}
            onClick={() => {
              handleArticleClick(article);
              setSelectedArticle(
                selectedArticle && selectedArticle.id === article.id ? null : article
              );
            }}
          >

              <div
                style={{
                  fontWeight: selectedArticle && selectedArticle.id === article.id ? "bold" : "normal",
                  textOverflow: "ellipsis",
                  overflow: "hidden",
                  whiteSpace: "nowrap"
                }}
              >
                {he.decode(article.title || "")}
              </div>


              {selectedArticle && selectedArticle.id === article.id && (
                <div
                  style={{
                    marginTop: "0.75rem",
                    backgroundColor: "#f9f9f9",
                    padding: "0.75rem",
                    borderRadius: "4px",
                  }}
                  ref={summaryRef}
                >
                  <div style={{ marginBottom: "0.5rem" }}>
                    <a
                      href={selectedArticle.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => {
                        e.stopPropagation();           // ✅ Don't close accordion
                      }}
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
                  </div>
                  <div style={{ fontWeight: "bold", marginBottom: "0.5rem" }}>
                    Your Feedback
                  </div>
                  <div style={{ marginBottom: "0.5rem" }}>
                    {/* --- Like / Unlike --- */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation(); // Prevent closing accordion

                        if (likedArticles.includes(article.id)) {
                          // 🔹 Unlike
                          setLikedArticles((prev) => prev.filter((id) => id !== article.id));
                          logInteraction(article, "unlike");
                        } else {
                          // 🔹 Like
                          setLikedArticles((prev) => [...prev, article.id]);
                          logInteraction(article, "like");
                        }
                      }}
                      style={{
                        marginRight: "0.5rem",
                        backgroundColor: likedArticles.includes(article.id) ? "green" : "",
                        color: likedArticles.includes(article.id) ? "white" : "",
                      }}
                    >
                      {likedArticles.includes(article.id) ? "Unlike" : "Like"}
                    </button>

                    {/* --- Forget --- */}
                    <button
                      onClick={(e) => {
                        //e.stopPropagation();

                        // Log and update backend
                        logInteraction(article, "forget");

                        // 🔹 Mark forgotten locally
                        setForgottenArticles((prev) => [...prev, article.id]);

                        // 🔹 Remove from liked
                        setLikedArticles((prev) => prev.filter((id) => id !== article.id));

                        // 🔹 Immediately remove article from list
                        setArticles((prev) => prev.filter((a) => a.id !== article.id));
                      }}
                      style={{
                        backgroundColor: forgottenArticles.includes(article.id) ? "red" : "",
                        color: forgottenArticles.includes(article.id) ? "white" : "",
                      }}
                    >
                      Forget
                    </button>
                  </div>


                  <div style={{ fontWeight: "bold", marginBottom: "0.5rem", lineHeight: "1.3" }}>
                    {he.decode(article.title || "")}
                  </div>

                  <div
                    style={{
                      marginTop: "0.75rem",
                      backgroundColor: "#fafafa",
                      padding: "0.75rem",
                      border: "1px solid #ddd",
                      borderRadius: "4px",
                      lineHeight: "1.5",
                      fontSize: "0.95rem",
                      color: "#333",
                    }}
                    dangerouslySetInnerHTML={{
                      __html: (selectedArticle.summary || "No summary available.").replace(
                        /<img /g,
                        `<img style="display:block;max-width:100%;max-height:400px;width:auto;height:auto;object-fit:contain;margin:0 auto;background-color:#fff;" `
                      )
                    }}
                  ></div>

                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );


}
