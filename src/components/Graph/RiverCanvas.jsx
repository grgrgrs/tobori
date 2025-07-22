import React, { useState, useEffect } from "react";

// TEMP: mock data until wired up
const MOCK_ARTICLES = Array.from({ length: 25 }).map((_, i) => ({
  id: `article-${i}`,
  title: `Interesting AI Article ${i + 1}`,
  score: Math.round(Math.random() * 1000) / 10,
}));

export default function RiverCanvas({
  filterText,
  publishedFilter,
  onSelectArticle,
}) {
  const [articles, setArticles] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    // In final version, filtering and scoring will be done on real data
    let filtered = MOCK_ARTICLES;

    if (filterText) {
      const lower = filterText.toLowerCase();
      filtered = filtered.filter((a) => a.title.toLowerCase().includes(lower));
    }

    // publishedFilter logic would go here (using mock dates later)

    setArticles(filtered.slice(0, 100));
  }, [filterText, publishedFilter]);

  const handleClick = (article) => {
    setSelectedId(article.id);
    onSelectArticle(article); // hook into shared right panel display
  };

  return (
    <div style={{ overflowY: "auto", height: "100%", padding: "1rem" }}>
      {articles.map((a) => (
        <div
          key={a.id}
          onClick={() => handleClick(a)}
          style={{
            padding: "4px 8px",
            cursor: "pointer",
            fontSize: "14px",
            borderBottom: "1px solid #eee",
            backgroundColor: a.id === selectedId ? "#e6f0ff" : "transparent",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={a.title}
        >
          {a.title}
        </div>
      ))}
    </div>
  );
}
