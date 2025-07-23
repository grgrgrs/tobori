---
title: Keeping up with AI news
description: How I'm using AI to track AI
pubDate: 2025-07-17
---
I've spent the last 15 months working and playing with AI. I retired from my full-time job in part to have the time to learn about AI. I illustrated two books ([Stay Out of the Kitchen: Pickleball Poems Illustrated](https://www.amazon.com/Stay-Out-Kitchen-Pickleball-Illustrated/dp/B0D9VSN54T/)  and [K9s Courageous: Illustrated Tails of Bravery](https://www.amazon.com/K9s-Courageous-Illustrated-Tails-Bravery/dp/B0DDNQTF5F)) using DALL-E and Midjourney. I built a fully automated system to pick up new pickleball tournament scores from a Google sheet, write a summary of the new activity using GPT, and post to Threads and Facebook using Zapier and Buffer. I generated images weekly for two newsletters I publish for meditation groups. I developed a presentation to introduce Meta Smart Glasses to visually impaired people. A talked to ChatGPT a lot, learning things that were effective ("ask me questions about my intent") and not ("rewrite this code  with a tweak" and blindly accepting the result.) I argued about AI consciousness with my friend Bill (often noting the irony of our inability to define human consciousness.) I am amazed by the things Notebook LM can do.

A couple of months ago, overwhelmed by the nonstop flood of AI news, I decided I needed AI to help me keep up with AI. Whether you call it an agent or a tool, the idea was simple: scan over a thousand articles a day and surface the handful that actually matter to me.

I set up a small cloud server that polls RSS feeds multiple times a day and stores article files. Daily I run a local process that ingests the article files, discards ones I've already seen, and creates embeddings to assign a similarity score for each new article to my personal corpus. That becomes my reading list.

You can see the current results [here in Notion](https://www.notion.so/21f96c12b31f80148e68e27aa33a49eb?v=21f96c12b31f809882bb000c00de9020&source=copy_link) It's updated daily, pulling the top 25 or so articles from the last 48 hours of new articles I've catalogued.

It's a work in progress, I have a long and growing backlog. I'm accomplishing my primary goal of learning a lot about AI capabilities and tools. It definitely surfaces articles that interest me; to be determined how well it is doing its selection. It’s tuned to my lens, not yours—yet. Supporting user-specific corpora is high on the roadmap.

Most recently, I’ve built a visual exploration UI. Some screenshots are below. I’ll post a link for feedback in the coming days.

<div style="display: flex; gap: 1rem;">
  <figure style="width: 48%; margin: 0;">
    <img src="/images/tobori-graph.png" style="width: 100%;" alt="Exploratory Graph" />
    <figcaption style="text-align: center; font-size: 0.9rem; color: #555;">
      Exploratory Graph
    </figcaption>
  </figure>

  <figure style="width: 48%; margin: 0;">
    <img src="/images/tobori-graph-related.png" style="width: 100%;" alt="Related Articles View" />
    <figcaption style="text-align: center; font-size: 0.9rem; color: #555;">
      Related Articles View
    </figcaption>
  </figure>
</div>
