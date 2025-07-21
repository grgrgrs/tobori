import { useState } from "react";

export default function BlogBrowser({ posts }) {
  const [selected, setSelected] = useState(posts[0]);

  return (
    <div>
      <article style={{ marginBottom: "2rem" }}>
        <h2>{selected.data.title}</h2>
        <p><em>{new Date(selected.data.pubDate).toDateString()}</em></p>
        <div dangerouslySetInnerHTML={{ __html: selected.body }} />
      </article>

      <hr />
      <h3>More Posts</h3>
      <ul>
        {posts.map((post, idx) => (
          <li key={idx} style={{ cursor: "pointer", marginBottom: "0.5rem" }}>
            <a onClick={() => setSelected(post)}>
              {post.data.title} – {new Date(post.data.pubDate).toDateString()}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
