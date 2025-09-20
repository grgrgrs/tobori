import React, { useState, useEffect, useMemo } from "react";
import { FAQ_GROUPS } from "../data/faq";

export default function FAQ() {
  const hash = typeof window !== "undefined" ? window.location.hash.replace("#", "") : "";
  const openById = useMemo(() => new Set([hash]), [hash]);

  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [hash]);

  return (
    <div className="faq mx-auto max-w-3xl">
      {FAQ_GROUPS.map((group) => (
        <section key={group.id} id={group.id}>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "0.75rem" }}>
            <a href={`#${group.id}`} style={{ textDecoration: "none" }}>
              {group.title}
            </a>
          </h2>

          <div>
            {group.items.map((qa, i) => (
              <details key={i} open={openById.has(group.id) && i === 0}>
                <summary
                  style={{ cursor: "pointer", fontStyle: "italic", fontSize: "1rem", fontWeight: 500 }}
                >
                  {qa.question}
                </summary>
                <div style={{ marginTop: "0.5rem", lineHeight: 1.7, fontSize: "0.95rem" }}>
                  {qa.answer}
                </div>
              </details>
            ))}
          </div>
        </section>
      ))}

      {/* Spacing rules for the FAQ; works even without Tailwind */}
      <style>{`
        .faq details { margin: 0.25rem 0; }          /* small gap between items */
        .faq details[open] { margin-bottom: 0.75rem; } /* extra space after expanded item */
        .faq summary::-webkit-details-marker { margin-right: .25rem; }
      `}</style>
    </div>
  );
}
