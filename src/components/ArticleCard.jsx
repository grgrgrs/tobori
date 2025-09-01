// ArticleCard.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import PropTypes from "prop-types";
import he from "he";

export default function ArticleCard(props) {
  const {
    article,
    initialDetailsExpanded = false,
    initialSimilarExpanded = false,
    density = "comfortable",
    maxSiblingPreview = 3,
    onLike,
    onAddToCollection,
    onForget,
    onPaywallToggle,
    onExpandDetails,
    onExpandSimilar,
    onSiblingLike,
    onSiblingAddToCollection,
    onSiblingHide,
    onSiblingClick,
    onTelemetry,
  } = props;

  const [detailsOpen, setDetailsOpen] = useState(initialDetailsExpanded);
  const [similarOpen, setSimilarOpen] = useState(initialSimilarExpanded);
  const [siblings, setSiblings] = useState(article.grouped?.siblings || []);
  // Keep local siblings in sync with parent props (needed for Like/Forget to reflect immediately)
  useEffect(() => {
    setSiblings(article.grouped?.siblings || []);
    }, [article.grouped, article.id]);
  const [loadingSiblings, setLoadingSiblings] = useState(false);
  const [previewN, setPreviewN] = useState(maxSiblingPreview);
  const isGrouped = !!article.grouped && (article.grouped.count ?? 0) > 0;
  const similarCount = article.grouped?.count ?? 0;
  const [sibOpen, setSibOpen] = useState({}); // sibling-id -> expanded?
  const relCount = useMemo(() => Math.max(similarCount, siblings.length), [similarCount, siblings.length]);

  const toggleSibling = useCallback((sid) => {
    setSibOpen(prev => ({ ...prev, [sid]: !prev[sid] }));
    onSiblingClick && onSiblingClick(sid);
  }, [onSiblingClick]);

  useEffect(() => {
    // fire impressions minimally
    if (isGrouped && onTelemetry) onTelemetry("dup_toggle_shown", { groupId: article.grouped.groupId, count: similarCount });
  }, [isGrouped, similarCount, onTelemetry, article.grouped]);

  const toggleDetails = useCallback(() => {
    const next = !detailsOpen;
    setDetailsOpen(next);
    onExpandDetails && onExpandDetails(article.id, next);
  }, [detailsOpen, onExpandDetails, article.id]);

  const toggleSimilar = useCallback(async () => {
    const next = !similarOpen;
    setSimilarOpen(next);
    if (next && isGrouped && siblings.length === 0 && article.grouped?.loadSiblings) {
      setLoadingSiblings(true);
      try {
        const loaded = await article.grouped.loadSiblings();
        setSiblings(Array.isArray(loaded) ? loaded : []);
      } finally {
        setLoadingSiblings(false);
      }
    }
    onExpandSimilar && article.grouped && onExpandSimilar(article.grouped.groupId, next);
    onTelemetry && article.grouped && onTelemetry(next ? "group_expanded" : "group_collapsed", { groupId: article.grouped.groupId, count: similarCount });
  }, [similarOpen, isGrouped, siblings.length, article.grouped, onExpandSimilar, similarCount, onTelemetry]);

  const siblingPreview = useMemo(() => siblings.slice(0, Math.max(0, previewN)), [siblings, previewN]);

  const onKeyDown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); toggleDetails(); }
    else if (e.key.toLowerCase() === "r") { e.preventDefault(); if (isGrouped) toggleSimilar(); }
    else if (e.key === "Escape") { setDetailsOpen(false); setSimilarOpen(false); }
  };

  const formatDate = (iso) => {
    try { return new Date(iso).toLocaleDateString(); } catch { return ""; }
  };


  // Render summary as plain text (strip tags, leave words)
  const toPlain = useCallback((html) => {
    if (!html) return "";
    try {
      let s = String(html);
      // remove scripts/styles entirely
      s = s.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
           .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ");
      // bullets for list items
      s = s.replace(/<li[^>]*>/gi, "• ").replace(/<\/li>/gi, "\n");
      // line breaks for paragraphs/divs/BRs
      s = s.replace(/<(\/)?p[^>]*>/gi, "\n")
           .replace(/<(\/)?div[^>]*>/gi, "\n")
           .replace(/<br\s*\/?>/gi, "\n");
      // strip any remaining tags
      s = s.replace(/<[^>]+>/g, "");
      // normalize whitespace: collapse blank lines (even if they have spaces/tabs)
      s = s.replace(/\r\n/g, "\n");
      s = s.replace(/\n[ \t]*\n+/g, "\n");   // <-- blank lines -> single newline
      s = s.replace(/\n{2,}/g, "\n").trim();
      s = he.decode(s).replace(/\u00A0/g, " ");
      return s;
    } catch { return ""; }
  }, []);

  // Aggregate badges
  const badges = [];
  if (article.firstSighted) badges.push({ class: "first", label: "First sighted" });
  if (article.paywalled) badges.push({ class: "paywall", label: "Paywall" });
  // (If you have aggregated counts across group, pass in via props and render here)

  return (
    <article
      className={[
        "card",
        "seed", // enable emerald left stripe
        isGrouped ? "grouped" : "",
        detailsOpen ? "expanded-details" : "",
        similarOpen ? "expanded-similar" : "",
        density === "compact" ? "density-compact" : "density-comfortable",
      ].join(" ").trim()}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label={`Article: ${article.title}`}
      style={{
        borderBottom: "1px solid #e5e5e5",
        paddingBottom: 8,
        marginBottom: 8,
        //boxShadow: article.liked ? "inset 3px 0 0 #e6a700" : "none", // keep left accent
      }}
    >





      <header className="card-header">
        {/* Line 1: Title (one line, bold) — click toggles details */}
        <button
          type="button"
          className="card-title"
          onClick={toggleDetails}
          aria-expanded={detailsOpen}
          title={article.title}
          style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "left", width: "100%", background: "transparent", border: "none", padding: 0, cursor: "pointer", font: "inherit", fontWeight: 700 }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%" }}>
            {article.liked && (
              <span aria-label="liked" style={{ color: "#e6a700", fontWeight: 700 }}>★</span>
            )}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{he.decode(article.title || "")}</span>
          </span>


        </button>

        {/* Line 2: Source & date & Theme/Category & Related(N) */}
        <div className="card-meta meta" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="meta-domain">{article.domain}</span>
          <span className="meta-dot"> · </span>
          <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
          {(article.theme || article.category) && (
            <>
              <span className="meta-dot"> · </span>
              <span className="meta-taxonomy">
                {article.theme || ""}{article.category ? ` › ${article.category}` : ""}
              </span>
            </>
          )}
          {isGrouped && similarCount > 0 && (
            <button
              type="button"
              className="dup-toggle btn-outline" 
              aria-expanded={similarOpen}
              aria-controls={`similar-${article.id}`}
              onClick={toggleSimilar}
              style={{ marginLeft: "auto" }}
            >
              {similarOpen ? "Hide related" : `Show (${relCount}) Related Articles`}
            </button>
          )}
        </div>
      </header>





      {detailsOpen && badges.length > 0 && (
        <div className="card-badges">
          {badges.map((b) => (
            <span key={b.class} className={`badge ${b.class}`}>{b.label}</span>
          ))}
        </div>
      )}


      {/* Details (shown when expanded): link → buttons */}
      {detailsOpen && (
        <section
          className="card-actions"
          style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
        >


          <a
            className="view-link"
            href={article.url}
            target="_blank"
            rel="noreferrer"
            style={{ color: "#06c", textDecoration: "underline", fontWeight: 600 }}
          >
            View full article
          </a>

          <button type="button" onClick={() => onLike && onLike(article.id)} aria-pressed={!!article.liked}>★ Like</button>
          <button type="button" onClick={() => onAddToCollection && onAddToCollection(article.id)}>+ Collection</button>
          <button type="button" onClick={() => onForget && onForget(article.id)}>• Forget</button>
          <label className="paywall-toggle" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <input
              type="checkbox"
              checked={!!article.paywalled}
              onChange={(e) => onPaywallToggle && onPaywallToggle(article.id, e.target.checked)}
            /> Paywall
          </label>

        </section>
      )}

      {/* Seed summary (if present), clamped to ~15 lines */}
      {detailsOpen && article.summary && (
        <section
          className="card-summary"
          style={{
            marginTop: 6,
            color: "#333",
            display: "-webkit-box",
            WebkitLineClamp: 12,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            whiteSpace: "pre-line",
            lineHeight: 1.25,
          }}
        >
          {toPlain(article.summary)}
        </section>
      )}


      {/* Similar coverage */}
      {isGrouped && (
        <section
          id={`similar-${article.id}`}
          className="card-similar"
          hidden={!similarOpen}
          style={{ paddingLeft: 16, marginLeft: 4, marginTop: 8 }}
        >
          {loadingSiblings && <div className="loading">Loading similar…</div>}
          {!loadingSiblings && (
            <>
              <div className="related-list" style={{ paddingLeft: 8 }}>

              {siblingPreview.map((s) => (
                <div className="related sibling-line" key={s.id} style={{ padding: "4px 0" }}>
                  {/* One-line title; click to expand sibling */}
                  <button
                    type="button"
                    className="sibling-title"
                    onClick={() => toggleSibling(s.id)}
                    aria-expanded={!!sibOpen[s.id]}
                    title={toPlain(s.title)}
                    style={{
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      textAlign: "left",
                      width: "100%",
                      background: "transparent",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      font: "inherit",
                      fontWeight: 600,
                    }}
                  >

                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%" }}>
                      <span aria-hidden="true" style={{ color: "#BBB" }}>↳</span>
                      {s.liked && (
                        <span aria-label="liked" style={{ color: "#e6a700", fontWeight: 700 }}>★</span>
                      )}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{he.decode(s.title || "")}</span>
                    </span>


                  </button>

                  {/* Meta for related: source · date */}
                  <div className="sibling-meta" style={{ color: "#666", fontSize: 12, marginTop: 2, paddingLeft: 18 }}>
                    <span className="meta-domain">{s.domain}</span>
                    {s.publishedAt ? (
                      <>
                        <span className="meta-dot"> · </span>
                        <time dateTime={s.publishedAt}>
                          {new Date(s.publishedAt).toLocaleDateString()}
                        </time>
                      </>
                    ) : null}
                  </div>


                  {/* Sibling expanded: link first → buttons → summary (if present) */}
                  {sibOpen[s.id] && (
                    <div className="sibling-details" style={{ marginTop: 6, paddingLeft: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>

                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="view-link"
                          onClick={(e) => e.stopPropagation()}
                          style={{ color: "#0066cc", textDecoration: "underline", fontWeight: 600 }}
                        >
                          View full article
                        </a>

                        <button type="button" onClick={() => onSiblingLike && onSiblingLike(s.id)}>☆ Like</button>
                        <button type="button" onClick={() => onSiblingAddToCollection && onSiblingAddToCollection(s.id)}>+ Collection</button>
                        <button type="button" onClick={() => onSiblingHide && onSiblingHide(s.id)}>• Forget</button>
                      </div>
                      {s.summary && (
                        <div
                          className="sibling-summary"
                          style={{
                            marginTop: 6,
                            paddingLeft: 4,
                            color: "#333",
                            display: "-webkit-box",
                            WebkitLineClamp: 12,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                            whiteSpace: "pre-line",
                            lineHeight: 1.25,
                          }}
                        >
                          {toPlain(s.summary)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              </div> {/* /.related-list */}

               {siblings.length > previewN && (
                <button
                  type="button"
                  className="show-all btn-outline"
                  onClick={() => setPreviewN(siblings.length)}
                >
                  Show all ({siblings.length})
                </button>
              )}
            </>
          )}
        </section>
      )}
    </article>
  );
}

ArticleCard.propTypes = {
  article: PropTypes.shape({
    id: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    url: PropTypes.string.isRequired,
    domain: PropTypes.string.isRequired,
    publishedAt: PropTypes.string.isRequired,
    liked: PropTypes.bool,
    paywalled: PropTypes.bool,
    firstSighted: PropTypes.bool,
    grouped: PropTypes.shape({
      groupId: PropTypes.string.isRequired,
      count: PropTypes.number.isRequired,
      topSources: PropTypes.arrayOf(PropTypes.string).isRequired,
      siblings: PropTypes.array,
      loadSiblings: PropTypes.func,
    }),
  }).isRequired,
  initialDetailsExpanded: PropTypes.bool,
  initialSimilarExpanded: PropTypes.bool,
  density: PropTypes.oneOf(["compact", "comfortable"]),
  maxSiblingPreview: PropTypes.number,
  onLike: PropTypes.func,
  onAddToCollection: PropTypes.func,
  onForget: PropTypes.func,
  onPaywallToggle: PropTypes.func,
  onExpandDetails: PropTypes.func,
  onExpandSimilar: PropTypes.func,
  onSiblingLike: PropTypes.func,
  onSiblingAddToCollection: PropTypes.func,
  onSiblingHide: PropTypes.func,
  onSiblingClick: PropTypes.func,
  onTelemetry: PropTypes.func,
};
