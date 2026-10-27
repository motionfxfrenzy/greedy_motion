// Ten briefs across the film types. `expect` is the type a good director should pick; the harness also checks that
// inferVideoType reaches it from the words and the template alone.
export const briefs = [
  { id: "e1-binary-search", expect: "explainer", text: "Explain how binary search finds a number in a sorted list by halving the range each time.", seconds: 30, template: "binary-search", theme: "neutral", screens: [] },
  { id: "e2-merge-sort", expect: "explainer", text: "Explain how merge sort works: split the list in halves until single items remain, then merge the pairs back together in order.", seconds: 40, theme: "neutral", look: "clean", screens: [] },
  { id: "e3-api-flow", expect: "explainer", text: "Explain what happens when a client calls our API: the request reaches the gateway, the auth service checks the token, then the database returns the data.", seconds: 30, template: "api-request-flow", theme: "neutral", screens: ["api-flow.png"] },
  { id: "e4-sky-sketch", expect: "explainer", text: "Explain why the sky is blue: sunlight contains every colour, air scatters short blue wavelengths the most, so blue reaches our eyes from every direction.", seconds: 30, theme: "neutral", look: "sketch", screens: [] },
  { id: "t1-invite", expect: "tutorial", text: "How to invite a teammate in Tidyflow and then check their workload on the dashboard.", seconds: 30, template: "narrated-walkthrough", theme: "neutral", product: "Tidyflow", description: "Tidyflow is a shared task board for small teams.", screens: ["invite.png", "dashboard.png"] },
  { id: "d1-demo", expect: "demo", text: "Show team leads how Tidyflow's workload dashboard and weekly report replace the status meeting.", seconds: 30, template: "feature-spotlight", theme: "neutral", product: "Tidyflow", description: "Tidyflow is a shared task board for small teams.", screens: ["dashboard.png", "report.png"] },
  { id: "p1-ad", expect: "promo", text: "A short social ad for Brew Club, a coffee subscription app: fresh beans every two weeks, skip or pause any time.", seconds: 15, theme: "neutral", product: "Brew Club", description: "Brew Club delivers freshly roasted coffee beans on a schedule you control.", screens: [] },
  { id: "p2-launch", expect: "promo", text: "Launch Tidyflow 2.0: the shared task board that updates itself, with a workload dashboard and a weekly report.", seconds: 30, template: "product-launch", theme: "neutral", product: "Tidyflow", description: "Tidyflow is a shared task board for small teams.", screens: ["dashboard.png", "report.png", "invite.png"] },
  { id: "s1-story", expect: "story", text: "Brand story for Marlowe Bakery: a family bakery that started in a garage and now bakes at dawn for the whole neighbourhood.", seconds: 45, theme: "neutral", product: "Marlowe Bakery", description: "A family bakery.", screens: [] },
  { id: "x1-data", expect: "data", text: "Our revenue grew every quarter this year: Q1 1.2 million dollars, Q2 1.5 million, Q3 1.9 million and Q4 2.4 million. Tell the story of the year.", seconds: 30, template: "stat-highlight", theme: "neutral", product: "Tidyflow", description: "Tidyflow is a shared task board for small teams.", screens: ["revenue.png"] }
];
export const models = [
  { id: "claude-opus-5-5", provider: "anthropic", model: "claude-opus-5-5" },
  { id: "claude-sonnet-5-5", provider: "anthropic", model: "claude-sonnet-5-5" },
  { id: "gemini-3.1-pro", provider: "gemini", model: "gemini-3.1-pro-preview" },
  { id: "gemini-3.8-flash", provider: "gemini", model: "gemini-3.8-flash" }
];
