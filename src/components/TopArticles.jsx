import React, { useEffect, useState } from "react";

export default function TopArticles() {
  const [topArticles, setTopArticles] = useState([]);

  useEffect(() => {
    const cacheKey = "topArticles24h";
    const cacheDateKey = "topArticles24hDate";

    // Check localStorage cache
    const today = new Date().toISOString().slice(0, 10); // e.g., "2025-08-03"
    const cachedDate = localStorage.getItem(cacheDateKey);
    const cachedArticles = localStorage.getItem(cacheKey);

    if (cachedArticles && cachedDate === today) {
      setTopArticles(JSON.parse(cachedArticles));
      return;
    }

    // Fetch from API if no cache or stale
    const fetchTopArticles = async () => {
      try {
        const params = new URLSearchParams({
          limit: 3,
          period: 1,        // integer days
          variety: false,
          feed_exclude: arXiv
        });

        const res = await fetch(`/api/articles?${params.toString()}`);
        if (!res.ok) {
          throw new Error(`Failed: ${res.status}`);
        }

        const data = await res.json();

        if (!Array.isArray(data)) {
          throw new Error("Unexpected API response format");
        }

        const sorted = data
          .sort((a, b) => (b.score || 0) - (a.score || 0))
          .slice(0, 3);

        setTopArticles(sorted);
        localStorage.setItem(cacheKey, JSON.stringify(sorted));
        localStorage.setItem(cacheDateKey, today);
      } catch (err) {
        console.error("Failed to fetch top articles:", err);
      }
    };


    fetchTopArticles();
  }, []);

  return (
    <div style={{ maxWidth: "800px", margin: "2rem auto" }}>
      {topArticles.length === 0 && <p>Loading top articles...</p>}
      {topArticles.map((article) => (
        <div
          key={article.id}
          style={{
            borderBottom: "1px solid #ddd",
            padding: "1rem 0",
            marginBottom: "1rem",
          }}
        >
          <h4 style={{ marginBottom: "0.5rem" }}>
            <a
              href={article.url}
              target="_blank"
              rel="noreferrer"
              style={{
                color: "#0066cc",
                textDecoration: "underline",
                fontWeight: "bold",
              }}
            >
              {article.title}
            </a>
          </h4>

          <p style={{ fontSize: "0.95rem", lineHeight: "1.5", color: "#333" }}>
            {(article.summary || "")
              .replace(/<[^>]*>?/gm, "") // strip HTML tags
              .split(/\s+/) // split into words
              .slice(0, 100) // first 250 words
              .join(" ") + "..."}
          </p>
        </div>
      ))}
    </div>
  );
}
