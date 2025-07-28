import React, { useEffect, useState, useRef } from "react";

export default function RiverCanvas() {
  const [articles, setArticles] = useState([]);
  const [filteredArticles, setFilteredArticles] = useState([]);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [filterText, setFilterText] = useState("");
  const [publishedFilter, setPublishedFilter] = useState("2weeks");
  const [sortBy, setSortBy] = useState("score");
  const summaryRef = useRef(null);

  useEffect(() => {
    fetch("/river_articles.json")
      .then((res) => res.json())
      .then((data) => setArticles(data));
  }, []);

  useEffect(() => {
    const now = new Date();
    let cutoff;
    switch (publishedFilter) {
      case "24hours":
        cutoff = new Date(now.setDate(now.getDate() - 1));
        break;
      case "2days":
        cutoff = new Date(now.setDate(now.getDate() - 2));
        break;
      case "week":
        cutoff = new Date(now.setDate(now.getDate() - 7));
        break;
      case "month":
        cutoff = new Date(now.setMonth(now.getMonth() - 1));
        break;
      case "all":
        cutoff = new Date("2000-01-01");
        break;
      default:
        cutoff = new Date(now.setDate(now.getDate() - 14));
    }

    const filtered = articles
      .filter((a) => new Date(a.pub_date) >= cutoff)
      .filter((a) => a.title.toLowerCase().includes(filterText.toLowerCase()))
      .sort((a, b) => b.score - a.score)
      .slice(0, 75);

    setFilteredArticles(filtered);
  }, [articles, filterText, publishedFilter, sortBy]);


  const renderSummary = () => {
    if (!selectedArticle) return null;
    const { url, title, summary, semantic_tags = [] } = selectedArticle;
    const match = summary.match(/<img[^>]+src=\"([^\"]+)\"[^>]*>/i);
    const imageUrl = match ? match[1] : null;
    const cleanedSummary = summary.replace(/<img[^>]*>/gi, "");

    return (
      <div style={{ fontSize: "14px", lineHeight: "1.4em" }}>
        <div style={{ marginBottom: "0.25rem" }}>
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "12px", color: "#0077cc" }}>
            🔗 View full article
          </a>
        </div>
        <div style={{ fontWeight: "bold", marginBottom: "0.5rem" }}>{title}</div>
        {imageUrl && (
          <img
            src={imageUrl}
            alt="article"
            style={{ height: "100px", objectFit: "cover", objectPosition: "center", width: "100%", marginBottom: "0.5rem" }}
          />
        )}
        <div style={{ marginBottom: "0.5rem" }}>
          {semantic_tags.map((tag, idx) => (
            <span key={idx} style={{ fontSize: "10px", color: "#666", marginRight: "0.5rem" }}>#{tag}</span>
          ))}
        </div>
        <div dangerouslySetInnerHTML={{ __html: cleanedSummary }} />
      </div>
    );
  };

  return (
    <div style={{ display: "flex", width: "100%", height: "100%" }}>
      <div style={{ flex: "4", display: "flex", height: "100%" }}>
        <div style={{ flex: 1, overflowY: "scroll", padding: "1rem" }}>
          {filteredArticles.map((article) => (
            <div
              key={article.url}
              onClick={() => setSelectedArticle(article)}
              style={{ padding: "0.5rem 0", borderBottom: "1px solid #ddd", cursor: "pointer" }}
            >
              {article.title}
            </div>
          ))}
        </div>
      </div>

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
              style={{ width: "100%", marginTop: "4px", fontSize: "12px", padding: "4px", boxSizing: "border-box" }}
            />
          </div>

          <div style={{ marginTop: "0.5rem", fontSize: "12px" }}>
            <label htmlFor="publishedFilter">Date range</label>
            <select
              id="publishedFilter"
              value={publishedFilter}
              onChange={(e) => setPublishedFilter(e.target.value)}
              style={{ width: "100%", marginTop: "4px", fontSize: "12px", padding: "4px", boxSizing: "border-box" }}
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
