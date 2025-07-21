import stopwords from './stopwords-en.js';
const stopwordSet = new Set(stopwords.map(w =>
  w.replace(/\s+/g, ' ').trim().toLowerCase()
));

export function getTagFrequencies(articles) {
  const tagCounts = {};
  console.log("In getTagFrequencies ------------------------")

  articles.forEach((article) => {
    const tags = article.data.semantic_tags || [];
    tags.forEach((tag) => {
      const normalized = tag.replace(/\s+/g, ' ').trim().toLowerCase();
      if (!stopwordSet.has(normalized)) {
        tagCounts[normalized] = (tagCounts[normalized] || 0) + 1;
      }
    });
  });

  return Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([text, value]) => ({ text, value }));
}
