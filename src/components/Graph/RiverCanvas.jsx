import React, { useEffect, useState, useRef } from "react";
import { logInteraction } from "../../utils/userData";


export default function RiverCanvas() {

  const [articles, setArticles] = useState([]);
  const [filteredArticles, setFilteredArticles] = useState([]);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [filterText, setFilterText] = useState("");
  const [publishedFilter, setPublishedFilter] = useState("24hours");
  const [sortBy, setSortBy] = useState("score");
  const [feedback, setFeedback] = useState({});   // <-- NEW
  const summaryRef = useRef(null);
  const [likedOnly, setLikedOnly] = useState(false);
  const userId = localStorage.getItem("userId"); 



  // Fetch articles on mount
  useEffect(() => {
    const fetchArticles = async () => {
      const response = await fetch('/articles');
      const data = await response.json();
      setArticles(data);  // <- still required to update the state
    };

    fetchArticles();
  }, []);

  // Filter and sort whenever dependencies change
  useEffect(() => {
    if (!articles.length) return;

    // --- Compute cutoff reliably ---
    const HOURS = {
      "24hours": 24,
      "2days": 48,
      "week": 24 * 7,
      "month": 24 * 30,
    };

    let cutoff = new Date(0); // Default to epoch for "all"
    if (publishedFilter !== "all") {
      const hours = HOURS[publishedFilter] || 24;
      cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    }

    const lowerFilter = filterText.toLowerCase();
    console.log("likedOnly: ", likedOnly)
    console.log("cutoff:", cutoff)
    const filtered = articles
      .filter((a) => {
        if (!a.published_date) {
          console.log("Don't have published_date");
          return false;
        }
        // Normalize pub_date to a parseable format
        let pubDateStr = a.published_date;
        // Add Z (UTC) if no timezone info
        if (!/Z|[+-]\d\d:?\d\d$/.test(pubDateStr)) {
          pubDateStr += "Z";
        }

        const articleDate = new Date(pubDateStr);

        // Date filter
        if (articleDate < cutoff) return false;

        if (likedOnly && feedback[a.id || a.url] !== "liked") return false;
        
        // Keyword filter
        return !lowerFilter || a.title.toLowerCase().includes(lowerFilter);
      })
      .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
      .slice(0, 75);

    setFilteredArticles(filtered);
  }, [articles, filterText, publishedFilter, sortBy]);

  // --- Renders the right-hand summary panel ---
  const renderSummary = () => {
    if (!selectedArticle) return null;
    const { url, title, summary, semantic_tags = [] } = selectedArticle;
    const articleId = selectedArticle.id || url;
    const match = summary.match(/<img[^>]+src=\"([^\"]+)\"[^>]*>/i);
    const imageUrl = match ? match[1] : null;
    const cleanedSummary = summary.replace(/<img[^>]*>/gi, "");

    return (
      <div style={{ fontSize: "14px", lineHeight: "1.4em" }}>
        <button onClick={() => setLikedOnly(!likedOnly)}>
          {likedOnly ? "Show All Articles" : "Show Only Liked"}
        </button>
        
        <div style={{ marginBottom: "0.25rem" }}>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: "12px", color: "#0077cc" }}
            onClick={() => logInteraction(articleId, "open")}
          >
            🔗 View full article
          </a>
        </div>
        <div style={{ fontWeight: "bold", marginBottom: "0.5rem" }}>{title}</div>
        {imageUrl && (
          <img
            src={imageUrl}
            alt="article"
            style={{
              height: "100px",
              objectFit: "cover",
              objectPosition: "center",
              width: "100%",
              marginBottom: "0.5rem",
            }}
          />
        )}
        <div style={{ marginBottom: "0.5rem" }}>
          {semantic_tags.map((tag, idx) => (
            <span
              key={idx}
              style={{
                fontSize: "10px",
                color: "#666",
                marginRight: "0.5rem",
              }}
            >
              #{tag}
            </span>
          ))}
        </div>
        <div dangerouslySetInnerHTML={{ __html: cleanedSummary }} />

        {/* --- Feedback Buttons --- */}
        <div style={{ marginTop: "1rem" }}>
          <h4 style={{ fontSize: "12px", marginBottom: "0.25rem" }}>Your Feedback</h4>
          <button
            style={{ background: feedback[articleId] === "liked" ? "#dff0d8" : "" }}
            onClick={() => {
              setFeedback({ ...feedback, [articleId]: "liked" });
              logInteraction(articleId, "rate", "liked");
            }}
          >
            👍 Like
          </button>
          <button
            style={{
              marginLeft: "0.5rem",
              background: feedback[articleId] === "meh" ? "#fcf8e3" : "",
            }}
            onClick={() => {
              setFeedback({ ...feedback, [articleId]: "meh" });
              logInteraction(articleId, "rate", "meh");
            }}
          >
            😐 Meh
          </button>
          <button
            style={{
              marginLeft: "0.5rem",
              background: feedback[articleId] === "forget" ? "#f2dede" : "",
            }}
            onClick={() => {
              setFeedback({ ...feedback, [articleId]: "forget" });
              logInteraction(articleId, "forget", "user dismissed");
            }}
          >
            🚫 Forget
          </button>
        </div>

      </div>
    );
  };

  return (
    <div style={{ display: "flex", width: "100%", height: "100%" }}>
      {/* Main left content area */}
      <div
        style={{
          flex: "4",
          display: "flex",
          flexDirection: "column",
          height: "100%",
        }}
      >
        {/* Filter summary bar */}
        <div
          style={{
            padding: "6px 12px",
            fontSize: "12px",
            color: "#444",
            backgroundColor: "#f7f7f7",
            borderBottom: "1px solid #ddd",
          }}
        >
          Showing {filteredArticles.length} articles
          {publishedFilter && ` | Date: ${publishedFilter}`}
          {filterText && ` | Keyword: "${filterText}"`}
        </div>

        {/* Article list */}
        <div style={{ flex: 1, overflowY: "scroll", padding: "1rem" }}>
          {filteredArticles.map((article) => (
            <div
              key={article.url}
              onClick={() => setSelectedArticle(article)}
              style={{
                padding: "0.5rem 0",
                borderBottom: "1px solid #ddd",
                cursor: "pointer",
              }}
            >
              {article.title}
            </div>
          ))}
        </div>
      </div>

      {/* Sidebar */}
      <div
        style={{
          width: "18vw",
          minWidth: "150px",
          maxWidth: "300px",
          borderLeft: "1px solid #ccc",
          backgroundColor: "#fafafa",
          padding: "1rem",
          overflowY: "auto",
        }}
        ref={summaryRef}
      >
        <div style={{ marginBottom: "1rem" }}>
          <div style={{ marginBottom: "0.5rem", fontSize: "12px" }}>
            <label htmlFor="articleFilter">Keyword search</label>
            <input
              id="articleFilter"
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Enter text..."
              style={{
                width: "100%",
                marginTop: "4px",
                fontSize: "12px",
                padding: "4px",
                boxSizing: "border-box",
              }}
            />
          </div>

          <div style={{ marginTop: "0.5rem", fontSize: "12px" }}>
            <label htmlFor="publishedFilter">Date range</label>
            <select
              id="publishedFilter"
              value={publishedFilter}
              onChange={(e) => setPublishedFilter(e.target.value)}
              style={{
                width: "100%",
                marginTop: "4px",
                fontSize: "12px",
                padding: "4px",
                boxSizing: "border-box",
              }}
            >
              <option value="24hours">In Last 24 Hours</option>
              <option value="2days">In Last 2 Days</option>
              <option value="week">In Last Week</option>
              <option value="month">In Last Month</option>
              <option value="all">All Time</option>
            </select>
          </div>
        </div>

        {renderSummary()}
      </div>
    </div>
  );
}
