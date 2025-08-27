---
title: Topic Clusters - A Major Tobori Update
description: A new topics view reduces noise by grouping related articles.
pubDate: 2025-08-26
---
I love how many interesting articles Tobori surfaces each day—but when news breaks, it can feel like a firehose. I wanted a way to keep breadth without the overwhelm, so I’ve added a calmer, smarter view.

Meet the new Topics view. Pick a timeframe—past 24 hours, 3 days, or a week—and Tobori groups highly similar stories into compact stacks. Each stack is a Topic. When ten, twenty, or thirty outlets all publish variations on the same story, you see one tidy Topic instead of thirty separate tiles. 

**Why this helps**
Topics condense the day into a clean top layer so you can grasp what’s happening fast and dive deeper on demand. It also surfaces genuinely different clusters that might otherwise get buried under the headline of the day.

**How the clustering works**
Tobori turns each article (title + summary and, when available, the full text) into a numeric vector with a text-embedding model—imagine each story as a point on an invisible map where distance means “how different.” Articles that land close together form a Topic. Behind the scenes, Tobori clusters nearby articles and picks a representative that’s both central and high on our relevance-and-recency score. Each Topic can include up to 30 related articles.

**More sources, better coverage**
In ongoing work, I added 20 new RSS feeds across research outlets, thoughtful newsletters, and industry blogs. The river is richer, but the Topics view keeps it from feeling noisy.

**What’s next: Collections**
Next up are Collections—your own saved groups of articles. Think personal reference libraries you can organize around projects, themes, or long-running questions.