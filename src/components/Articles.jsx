import React, { useEffect, useState, useRef } from "react";

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
  const [theme, setTheme] = useState(null);
  const [category, setCategory] = useState(null);
  const [themes, setThemes] = useState([]);
  const [categories, setCategories] = useState([]);
  const [variety, setVariety] = useState(true);
  const [loading, setLoading] = useState(false);
  const [userId, setUserID] = useState(null);

  const handleThemeChange = (value) => {
    const newTheme = value || null;
    setTheme(newTheme);
    if (!newTheme) {
      setCategory(null);  // <-- Reset category if no theme
    }
  };

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



  // -----------------------
  // 2. Handle article click (logs "open")
  // -----------------------
  const handleArticleClick = (article) => {
    setSelectedArticle(article);

    // Log open interaction
    const sessionID = localStorage.getItem("sessionID") || "default-session";
    const safeUserID = userId || "anonymous";
    const safeArticleId = article.id;
    console.log("Posting logInteraction interactionType: ", "open", "  value: ", null, " with sessionID: ", sessionID, "  and userId: ", safeUserID, " for article: ", safeArticleId);

    fetch("/user_interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: safeUserID,
        session_id: sessionID,
        article_id: safeArticleId,
        interaction_type: "open",
        value: null,
      }),
    }).catch((err) => console.error("Error logging open interaction:", err));
  };



  // -----------------------
  // 1. Fetch articles from new /articles endpoint
  // -----------------------
  useEffect(() => {
    const fetchArticles = async () => {
      setLoading(true);

      const periodMap = {
        "24hours": 1,
        "2days": 2,
        "week": 7,
        "month": 30,
        "all": 101, // triggers all-time
      };

      const period = periodMap[publishedFilter] || 1;

      const params = new URLSearchParams({
        limit: "75",
        period: period.toString(),
        variety: variety ? "true" : "false",
      });

      if (userId) {
        params.append("user_id", userId);  // ✅ Always include user_id
      }

      if (likedOnly) params.append("liked", "true");
      if (openedOnly) params.append("opened", "true");

      if (filterText.trim()) {
        params.append("keyword", filterText.trim());
      }


      if (theme) params.append("theme", theme);
        if (category) params.append("category", category);
          try {
            console.log("fetch articles with params: ", params);
            const response = await fetch(`/api/articles?${params.toString()}`);
            if (!response.ok) {
              console.error("Failed to fetch articles:", response.statusText);
              setArticles([]);
            } else {
              const data = await response.json();
              setArticles(data);
            }
          } catch (err) {
          console.error("Error fetching articles:", err);
          setArticles([]);
          } finally {
            setLoading(false);
        }
      };

    fetchArticles();
    }, [publishedFilter, likedOnly, openedOnly, theme, category, variety, filterText]);

    // -----------------------
    // 2. Apply keyword filter client-side
    // -----------------------
    useEffect(() => {
      console.log("NOT Filtering keyword client side")
      //if (!articles || !articles.length) {
      //  setFilteredArticles([]);
      //  return;
      //}

      //const lowerFilter = filterText.trim().toLowerCase();
      //const filtered = articles.filter(
      //  (a) =>
      //    !lowerFilter ||
      //    a.title.toLowerCase().includes(lowerFilter) ||
      //    (a.summary && a.summary.toLowerCase().includes(lowerFilter))
      //);

      //setFilteredArticles(articles);
    }, [articles, filterText]);


  // -----------------------
  // 3. Feedback logging (Like / Forget)
  // -----------------------
  const logInteraction = async (article, action) => {
    setFeedback((prev) => ({ ...prev, [article.id]: action }));

    const sessionID = localStorage.getItem("sessionID") || "default-session";
    const safeUserID = userId || "anonymous";
    const safeArticleId = article.id;

    // Map frontend action to backend schema
    let interactionType = "rate";
    let value = action === "like" ? "liked" : "forget";
    console.log("Posting logInteraction interactionType: ", interactionType, "  value: ", value, " with sessionID: ", sessionID, "  and userId: ", userId);
    try {
      await fetch("/user_interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: safeUserID,
          session_id: sessionID,
          article_id: safeArticleId,
          interaction_type: interactionType,
          value: value,
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
          gap: "1rem",
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
            style={{ width: "120px" }}
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

        {/* Spacer */}
        <div style={{ flex: 1 }} />
      </div>

      {/* --- Article List with Accordion --- */}
      <div style={{ flex: 1, overflowY: "scroll", padding: "1rem" }}>
        {loading ? (
          <div>Loading articles...</div>
        ) : (
          articles.map((article) => (
            <div
              key={article.id}
              style={{
                borderBottom: "1px solid #eee",
                paddingBottom: "0.75rem",
                marginBottom: "0.75rem",
                cursor: "pointer",
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
                  fontWeight:
                    selectedArticle && selectedArticle.id === article.id
                      ? "bold"
                      : "normal",
                }}
              >
                {article.title}
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
                      href={article.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => handleArticleClick(article)}
                      style={{
                        color: "#0066cc",
                        textDecoration: "underline",
                        fontWeight: "bold",
                        marginBottom: "0.5rem",
                        display: "inline-block"
                      }}
                    >
                      View full article
                    </a>
                  </div>
                  <div style={{ fontWeight: "bold", marginBottom: "0.5rem" }}>
                    Your Feedback
                  </div>
                  <div style={{ marginBottom: "0.5rem" }}>
                    <button
                      onClick={() => logInteraction(article, "like")}
                      style={{ marginRight: "0.5rem" }}
                    >
                      Like
                    </button>
                    <button onClick={() => logInteraction(article, "forget")}>
                      Forget
                    </button>
                  </div>
                  <div style={{ fontWeight: "bold", marginBottom: "0.5rem" }}>
                    {article.title}
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
                      color: "#333"
                    }}
                    dangerouslySetInnerHTML={{ __html: selectedArticle.summary || "No summary available." }}
                    >
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );


}
