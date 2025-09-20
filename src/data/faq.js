export const FAQ_GROUPS = [
	{
		id: "basics",
		title: "Basics",
		items: [
			{
		    question: "What is Tobori?",
		    answer: "Tobori is a personal research app that digests thousands of new articles daily, scores them against your defined corpus of interests, and surfaces the day’s top pieces for quick review.",
		  	},
		  	{
		    question: "How does it work?",
		    answer: "There is a small cloud server that polls RSS feeds multiple times a day and stores article files. A process daily that ingests the article files, discards ones already seen, and creates embeddings to assign a similarity score for each new article to the corpus. That becomes the prioritized reading list.",
		  	},
		  	{
		    question: "How do I get access?",
		    answer: "In order to access the article listing for the first time, you will need to log in with your e-mail and an 'invite code' that was sent to you. This ties your account to a corpus that defines the articles you are presented.",
		  	},
		  	{
		    question: "How does it decide which articles are interesting?",
		    answer: "There is a corpus consisting of a set of small documents, each describing an area of interest to me. In each document there is a short paragraph describing the topic, and a paragraph saying why it is of interest. The system creates embeddings for the corpus, then daily creates embeddings for new articles. A similarity calculation is used against the embeddings to determine how relevant the article is to the overall corpus.",
		  	},  
		  	{
		    question: "How often is the content updated?",
		    answer: "The system updates daily with new articles, analyses, and graph relationships.",
		  	},
		  	{
		    question: "Why do I sometimes see older articles when viewing last 24 hours?",
		    answer: "This is usually the result of having added a new article feed. We may receive older articles in the initial fetch, if the feed doesn't have enough recent activity. This clears up after the first day for the feed.",
		  	},
		  	{
		    question: "What are 'related articles' seen in Card View?",
		    answer: "The system uses the article embeddings to calculate similarity between articles. Those most similar are shown as 'related articles' in the graph view.",
		  	},   
		  	{
		    question: "Can I provide my own corpus?",
		    answer: "Not yet. That is the intent as the system evolves.",
		  	},  
		]
	},
	{
		id: "briefs",
		title: "Briefs",
		items: [
			{
			question: "What is a Brief (aka Report)?",
			answer: "A saved recipe for an AI-generated summary. It has a title, corpus_id, visibility, tone/length/style, and optional keywords/filters."
			},
			{
			question: "Where do I create and manage Briefs?",
			answer: "Start by going to to Briefs from the navigation menu. From here you can click Create Brief to set up a new report, or various actions for your displayed list of existing reports."
			},
			{
			question: "What’s the difference between Preview and Create & Run?",
			answer: "Preview calls the LLM and shows the result without saving anything. Create & Run saves the report and then runs it once."
			},
			{
			question: "How do I read or edit a single Brief?",
			answer: "Click Open from the list of Briefs to view a report, or Edit to see and modify the settings defining the report."
			},
			{
			question: "How do I pin a Brief to my Home page?",
			answer: "Check “Show on Home” in the Briefing list."
			},
			{
			question: "Why does my Home say “No Home Briefs yet”?",
			answer: "You haven’t pinned any Briefs for the current corpus. Pin one via /reports or the single report page."
			},
			{
			question: "Can I refresh the contents of a Brief from Home?",
			answer: "Yes. Each tile has a Run now button that triggers the same backend run as the single report page."
			},
			{
			question: "What does “latest” mean on a Brief?",
			answer: "It’s the most recent completed run, showing currency of articles used for the run."
			},
			{
			question: "Does anything auto-refresh on a schedule?",
			answer: "Currently, all runs are manual. Scheduling/auto-refresh will be added soon."
			},
			{
			question: "Who can see or edit my Briefs?",
			answer: "The owner (you) can edit. Currently only you can see your Briefs; a mechanism for sharing public views is next."
			},
			{
			question: "Can I reorder Home Brief tiles?",
			answer: "Yes. Set home_order in the brief's settings. Lower numbers appear first."
			},
			{
			question: "What data sources does a Brief use?",
			answer: "It uses the articles and metadata in its corpus, with filters set based on the Brief's parameters. Your tone/length/style along with your free text instructions steer the LLM output."
			}
		]
	}
]