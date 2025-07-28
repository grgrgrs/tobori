// src/dataService.js

let relatedData = null;

/**
 * Load the main flat article graph from static JSON
 */
export async function loadGraphData() {
  const response = await fetch('/flat_graph_data.json');
  if (!response.ok) {
    throw new Error("Failed to load flat_graph_data.json");
  }
  return await response.json();
}

/**
 * Load the precomputed related-article mapping from static JSON
 */
export async function loadRelatedData() {
  if (!relatedData) {
    const response = await fetch('/related.json');
    if (!response.ok) {
      throw new Error("Failed to load related.json");
    }
    relatedData = await response.json();
  }
  return relatedData;
}

/**
 * Given an article ID and the full article node list,
 * return a list of related article objects (not just IDs)
 * 
 * @param {string} articleId - The ID of the focused article
 * @param {Array} allNodes - The full article node array (flatData.nodes)
 * @returns {Array} - Related article node objects
 */
export function getRelatedArticles(articleId) {
  if (!relatedData) {
    console.warn("getRelatedArticles called before relatedData loaded.");
    return [];
  }

  return relatedData[articleId] || [];
}
