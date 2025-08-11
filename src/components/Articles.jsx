import React, { useEffect, useState, useRef } from "react";
import he from "he";

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



  // -----------------------
  // 2. Handle article click (logs "open")
  // -----------------------
  const handleArticleClick = (article) => {
    setSelectedArticle(article);

    // Log open interaction
    const sessionID = localStorage.getItem("sessionID") || "default-session";
    const safeUserID = userId || "anonymous";
    const safeArticleId = article.id;

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
        limit: "50",
        period: period.toString(),
        variety: variety ? "true" : "false",
      });

      if (userId) {
        params.append("user_id", userId);  // ✅ Always include user_id
      }

      if (likedOnly) params.append("liked", "true");
      if (openedOnly) params.append("opened", "true");
      if (unOpenedOnly) params.append("unOpened", "true");
      if (filterText.trim()) {
        params.append("keyword", filterText.trim());
      }


      if (theme) params.append("theme", theme);
        if (category) params.append("category", category);
          try {
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
    }, [publishedFilter, likedOnly, openedOnly, unOpenedOnly, theme, category, variety, filterText]);



  // -----------------------
  // 3. Feedback logging (Like / Forget)
  // -----------------------
  const logInteraction = async (article, action) => {
    setFeedback((prev) => ({ ...prev, [article.id]: action }));

    const sessionID = localStorage.getItem("sessionID") || "default-session";
    const safeUserID = userId || "anonymous";
    const safeArticleId = article.id;

    // Map frontend actions to backend schema
    let interactionType = "rate";
    let value = null;

    if (action === "like") value = "liked";
    else if (action === "forget") value = "forget";
    else if (action === "unlike") value = "unliked"; // ✅ new explicit value

    console.log(
      "Posting logInteraction interactionType: ",
      interactionType,
      "  value: ",
      value,
      " with sessionID: ",
      sessionID,
      "  and userId: ",
      userId
    );

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
                        logInteraction(selectedArticle, "opened"); // ✅ Log opened only here
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
