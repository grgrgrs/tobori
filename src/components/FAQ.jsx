import React, { useState } from 'react';

const faqData = [
  {
    question: "What is this site about?",
    answer: "This site helps you track and explore the latest in AI news using a graph-based interface and custom AI filters.",
  },

  {
    question: "How does it work?",
    answer: "There is a small cloud server that polls RSS feeds multiple times a day and stores article files. Daily I run a local process that ingests the article files, discards ones I've already seen, and creates embeddings to assign a similarity score for each new article to my personal corpus. That becomes my reading list.",
  },
  {
    question: "How does it decide which articles are interesting?",
    answer: "I have a personal corpus consisting of about 30 small documents, each describing an area of interest to me. In each document I have a short paragraph describing the topic, and a paragraph saying why I am interested. The system creates embeddings for the corpus, then daily creates embeddings for new articles. A similarity calculation is used against the embeddings to determine how relevant the article is to the overall corpus.",
  },  
  {
    question: "How often is the content updated?",
    answer: "The system updates daily with new articles, analyses, and graph relationships.",
  },
  {
    question: "What are 'related articles' I see in the graph view?",
    answer: "The system uses the article embeddings to calculate similarity between articles. Those most similar are shown as 'related articles' in the graph view.",
  },  
  {
    question: "What determines the hierarchy used in graph view (themes, categories)?",
    answer: "Those are attributes around which the personal corpus is defined.",
  },  
  {
    question: "Can I modify it for my interests?",
    answer: "Not yet. I'd like to take it there, if interest exists.",
  },  
];

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState(null);

  const toggle = (index) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section className="faq">
      <h1>Frequently Asked Questions</h1>
      {faqData.map((item, i) => (
        <div key={i} className="faq-item">
          <button
            onClick={() => toggle(i)}
            className="faq-question"
            aria-expanded={openIndex === i}
          >
            {item.question}
          </button>
          {openIndex === i && (
            <div className="faq-answer">
              <p>{item.answer}</p>
            </div>
          )}
        </div>
      ))}
    <style>
      {`
        .faq {
          max-width: 600px;
          margin: 2rem auto;
          padding: 0 1rem;
        }
        .faq-question {
          width: 100%;
          text-align: left;
          font-weight: bold;
          font-size: 1.1rem;
          padding: 0.5rem;
          margin-top: 1rem;
          background: none;
          border: none;
          cursor: pointer;
          border-bottom: 1px solid #ccc;
        }
        .faq-answer {
          padding: 0.5rem 1rem;
        }
      `}
    </style>

    </section>
  );
}
