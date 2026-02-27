# Ramble — Component Ideas

A running list of ideas for meeting (and eventually journaling) widgets.
Each component follows the same pattern: detect a signal in the transcript → run a focused LLM or compute call → render a single-purpose card.

---

## Architecture note

A generic component engine is worth building: `(system prompt, output schema, renderer type)` as config.
The same component infrastructure can be reused for many purposes — pure text cards, lists, metrics, code-eval.
Each new card is just a new output schema + renderer, not a new pipeline.

---

## Text-based components

| Idea | Signal / Trigger | Output |
|---|---|---|
| **Open questions tracker** | Question asked, no clear answer follows | Running list of unanswered questions |
| **Parking lot** | "Let's come back to that", topic shift mid-thought | Deferred items list |
| **Commitment strength** | Action item language | Tags items: soft / firm / deadline-bound |
| **Jargon / acronym decoder** | Uncommon term or acronym, especially if followed by silence | One-line definition card |
| **Blocker surface** | "blocked on", "can't proceed until", dependency language | Blockers panel, distinct from action items |
| **Devil's advocate** | Convergence language: "let's go with", "we've decided" | 2–3 counterarguments or risks not yet mentioned |
| **Repeat detector** | Same point/concern surfaces 3+ times | "This topic has come up 3 times without resolution" |
| **Elephant detector** | Conversation orbiting something without naming it, lots of hedging | Surfaces the unspoken thing |
| **Pre-mortem card** | Significant commitment made | "Assume this fails in 6 months — most likely reason?" |
| **Negotiation signal tracker** | Pricing or terms discussion | Anchoring moves, concessions, gap between positions |
| **Buzzword meter** | Corporate clichés ("synergy", "circle back", "move the needle") | Playful count/gauge — configurable word list |
| **Talking points tracker** | Pre-meeting: user enters 3 things to cover | Crosses off each as it comes up in conversation |
| **Inspiration net** | Book, article, person, study mentioned as reference | Running "mentioned resources" list |
| **Time capsule** | End of meeting | One sentence: the single thing that will matter in 3 months |
| **Silence map** | Long pauses in audio | Timeline showing where silences occurred and after what |
| **Mental model mapper** | Framing language per speaker | "Speaker A frames this as X. Speaker B frames it as Y." |
| **Entity info card** | "Do you know [company/person]?" | Brief overview — LLM for known entities, search API for fresh info |
| **Analogy card** | Complex concept being explained, confusion signals | One fictional analogy + one historical parallel |
| **Cultural context hints** | Cross-cultural meeting, location/country mentioned | Relevant communication norms for that culture |
| **Meeting cost clock** | Participants × time elapsed × approximate rate | Running cost display — keeps meetings focused |

---

## Beyond-text components (computational / visual / interactive)

| Idea | Signal / Trigger | Output |
|---|---|---|
| **Live calculator** | Numbers + operations, pricing discussion | LLM generates JS expression → runs in frontend → shows inputs + formula + result (editable) |
| **Live chart** | Quantities, percentages, comparisons mentioned | LLM extracts data points + labels → renders bar or line chart |
| **Diagram generator** | Process, flow, or system described step by step | LLM generates Mermaid syntax → renders flowchart / sequence diagram |
| **Decision matrix** | Multiple options compared against multiple criteria | LLM fills in a table progressively as criteria/scores are mentioned |
| **Live QR code** | URL, email, or phone number mentioned verbally | Instant QR code rendered on screen |
| **Map with pins** | Locations mentioned | Map with pins; for timezone use case — overlap band + live local times |
| **Timezone view** | Time + location appear together ("3pm, I'm in Bangalore") | Two-clock or map view with working-hours overlap band |
| **Probability gauge** | Confidence expressed with numbers ("70% chance", "3 out of 10") | Visual arc/gauge rather than number in text |
| **Scorecard builder** | Vendor/candidate/option evaluation with criteria | Live scorecard table, sentiment mapped to rough scores |
| **Relationship graph** | People, teams, companies and their connections described | Live node-link graph (D3 force layout) |
| **SVG sketch** | Abstract concept described ("think of it like a funnel...") | LLM generates SVG markup to illustrate the concept |

---

*Last updated: Feb 2026*
