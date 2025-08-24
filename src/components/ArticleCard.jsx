// ArticleCard.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import PropTypes from "prop-types";

/** @typedef {{id:string,title:string,url:string,domain:string,publishedAt:string,liked?:boolean,paywalled?:boolean,firstSighted?:boolean}} ArticleSummary */
/** @typedef {{groupId:string,count:number,topSources:string[],siblings?:ArticleSummary[],loadSiblings?:()=>Promise<ArticleSummary[]>}} DuplicateGroupInfo */

/**
 * @param {{
 *   article: ArticleSummary & { clusterId?:string, tags?:string[], grouped?:DuplicateGroupInfo },
 *   initialDetailsExpanded?: boolean,
 *   initialSimilarExpanded?: boolean,
 *   density?: "compact" | "comfortable",
 *   maxSiblingPreview?: number, // pass 1 on mobile
 *   onLike?: (id:string)=>void,
 *   onAddToCollection?: (id:string)=>void,
 *   onForget?: (id:string)=>void,
 *   onPaywallToggle?: (id:string, val:boolean)=>void,
 *   onExpandDetails?: (id:string, open:boolean)=>void,
 *   onExpandSimilar?: (groupId:string, open:boolean)=>void,
 *   onSiblingLike?: (id:string)=>void,
 *   onSiblingAddToCollection?: (id:string)=>void,
 *   onSiblingHide?: (id:string)=>void,
 *   onSiblingClick?: (id:string)=>void,
 *   onTelemetry?: (event:string, payload?:object)=>void,
 * }} props
 */
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
  const [loadingSiblings, setLoadingSiblings] = useState(false);

  const isGrouped = !!article.grouped && (article.grouped.count ?? 0) > 0;
  const similarCount = article.grouped?.count ?? 0;

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

  const siblingPreview = useMemo(() => siblings.slice(0, Math.max(0, maxSiblingPreview)), [siblings, maxSiblingPreview]);

  const onKeyDown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); toggleDetails(); }
    else if (e.key.toLowerCase() === "r") { e.preventDefault(); if (isGrouped) toggleSimilar(); }
    else if (e.key === "Escape") { setDetailsOpen(false); setSimilarOpen(false); }
  };

  const formatDate = (iso) => {
    try { return new Date(iso).toLocaleDateString(); } catch { return ""; }
  };

  // Aggregate badges
  const badges = [];
  if (article.firstSighted) badges.push({ class: "first", label: "First sighted" });
  if (article.paywalled) badges.push({ class: "paywall", label: "Paywall" });
  // (If you have aggregated counts across group, pass in via props and render here)

  return (
    <article
      className={[
        "card",
        isGrouped ? "grouped" : "",
        detailsOpen ? "expanded-details" : "",
        similarOpen ? "expanded-similar" : "",
        density === "compact" ? "density-compact" : "density-comfortable",
      ].join(" ").trim()}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label={`Article: ${article.title}`}
    >
      <header className="card-header">
        <a className="card-title" href={article.url} target="_blank" rel="noreferrer">
          {article.title}
        </a>
        <div className="card-meta">
          <span className="meta-domain">{article.domain}</span>
          <span className="meta-dot"> · </span>
          <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
        </div>

        {isGrouped && (
          <div className="chip-strip" aria-label="Also covered by">
            {(article.grouped.topSources || []).slice(0, 3).map((src) => (
              <span className="chip" key={src} title={src}>{src}</span>
            ))}
            {similarCount > (article.grouped.topSources || []).slice(0, 3).length && (
              <span className="chip more">+{similarCount - Math.min(3, (article.grouped.topSources || []).length)}</span>
            )}
          </div>
        )}

        {isGrouped && similarCount > 0 && (
          <button
            type="button"
            className="dup-toggle"
            aria-expanded={similarOpen}
            aria-controls={`similar-${article.id}`}
            onClick={toggleSimilar}
          >
            {similarOpen ? "hide similar" : `and ${similarCount} similar`}
          </button>
        )}
      </header>

      {badges.length > 0 && (
        <div className="card-badges">
          {badges.map((b) => (
            <span key={b.class} className={`badge ${b.class}`}>{b.label}</span>
          ))}
        </div>
      )}

      {/* Details section */}
      <section className="card-actions">
        <button type="button" onClick={() => onLike && onLike(article.id)} aria-pressed={!!article.liked}>★ Like</button>
        <button type="button" onClick={() => onAddToCollection && onAddToCollection(article.id)}>+ Collection</button>
        <button type="button" onClick={() => onForget && onForget(article.id)}>• Forget</button>
        <label className="paywall-toggle">
          <input
            type="checkbox"
            checked={!!article.paywalled}
            onChange={(e) => onPaywallToggle && onPaywallToggle(article.id, e.target.checked)}
          /> Paywall
        </label>
        <button type="button" className="details-toggle" onClick={toggleDetails} aria-expanded={detailsOpen}>
          {detailsOpen ? "Hide details" : "Show details"}
        </button>
        <a className="view-link" href={article.url} target="_blank" rel="noreferrer">View full article</a>
      </section>

      {detailsOpen && (
        <section className="card-summary">
          {/* Inject your real summary text here */}
          <p className="summary-text">(Summary goes here…)</p>
        </section>
      )}

      {/* Similar coverage */}
      {isGrouped && (
        <section id={`similar-${article.id}`} className="card-similar" hidden={!similarOpen}>
          {loadingSiblings && <div className="loading">Loading similar…</div>}
          {!loadingSiblings && (
            <>
              {siblingPreview.map((s) => (
                <div className="sibling-line" key={s.id}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => onSiblingClick && onSiblingClick(s.id)}
                  >
                    {s.title}
                  </a>
                  <span className="sibling-meta"> — {s.domain} — {formatDate(s.publishedAt)}</span>
                  <div className="sibling-actions">
                    <button type="button" onClick={() => onSiblingLike && onSiblingLike(s.id)}>☆ Like</button>
                    <button type="button" onClick={() => onSiblingAddToCollection && onSiblingAddToCollection(s.id)}>+ Collection</button>
                    <button type="button" onClick={() => onSiblingHide && onSiblingHide(s.id)}>• Hide</button>
                  </div>
                </div>
              ))}
              {siblings.length > maxSiblingPreview && (
                <button type="button" className="show-all" onClick={() => props.maxSiblingPreview = siblings.length /* quick and dirty; or lift state up */}>
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
