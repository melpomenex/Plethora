import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const OUT_DIR = resolve("mobile-screenshots", "obsidian-noir");
await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
  isMobile: true,
  hasTouch: true,
});

const page = await context.newPage();

// Pre-seed localStorage before any React code runs
await page.addInitScript(() => {
  localStorage.setItem("plethora-onboarding-tour-optout", "1");
  localStorage.setItem("plethora-last-theme", "obsidian-noir");
  sessionStorage.setItem("__sw_cleared__", "1");

  const settings = {
    state: {
      settings: {
        interface: {
          startupAnimationEnabled: false,
        },
      },
    },
  };
  localStorage.setItem("plethora-settings", JSON.stringify(settings));

  // Seed RSS Feeds
  const rssFeeds = [
    {
      id: "feed-ars",
      title: "Ars Technica",
      feedUrl: "https://feeds.arstechnica.com/arstechnica/index",
      link: "https://arstechnica.com",
      description: "Original tech reporting, analysis of technology trends, and science news.",
      unreadCount: 4,
      lastFetched: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      items: [
        {
          id: "ars-1",
          feedId: "feed-ars",
          title: "Quantum Computing Reaches High-Fidelity Entanglement Milestone",
          description: "Researchers demonstrated fault-tolerant logical qubits with error rates below the threshold required for sustained multi-depth circuits.",
          content: "<p>Researchers demonstrated fault-tolerant logical qubits with error rates below the threshold required for sustained multi-depth circuits.</p>",
          link: "https://arstechnica.com/science/quantum-computing-milestone",
          pubDate: new Date(Date.now() - 42 * 60 * 1000).toISOString(),
          author: "Dr. Elena Rostova",
          read: false,
          favorite: true,
          categories: ["Quantum", "Hardware"],
        },
        {
          id: "ars-2",
          feedId: "feed-ars",
          title: "New Solid-State Battery Architecture Delivers 800-Mile Range in Testing",
          description: "A ceramic-electrolyte cell design avoids dendrite formation even during ultra-rapid 12-minute charge cycles.",
          content: "<p>A ceramic-electrolyte cell design avoids dendrite formation even during ultra-rapid 12-minute charge cycles.</p>",
          link: "https://arstechnica.com/cars/solid-state-battery-breakthrough",
          pubDate: new Date(Date.now() - 110 * 60 * 1000).toISOString(),
          author: "Jonathan M. Gitlin",
          read: false,
          favorite: false,
          categories: ["Energy", "Automotive"],
        },
        {
          id: "ars-3",
          feedId: "feed-ars",
          title: "Inside the Reasoning Models Transforming Knowledge Retrieval",
          description: "How test-time compute scaling is reshaping how neural retrieval systems synthesize complex scientific literature.",
          content: "<p>How test-time compute scaling is reshaping how neural retrieval systems synthesize complex scientific literature.</p>",
          link: "https://arstechnica.com/ai/reasoning-models-deep-dive",
          pubDate: new Date(Date.now() - 240 * 60 * 1000).toISOString(),
          author: "Benj Edwards",
          read: false,
          favorite: true,
          categories: ["AI", "Algorithms"],
        },
        {
          id: "ars-4",
          feedId: "feed-ars",
          title: "Linux 6.18 Adds Native Memory-Tiering Engine for CXL Devices",
          description: "Automatic hot/cold page migration balances NUMA latency across high-bandwidth on-package RAM and expansion pools.",
          content: "<p>Automatic hot/cold page migration balances NUMA latency across high-bandwidth on-package RAM and expansion pools.</p>",
          link: "https://arstechnica.com/gadgets/linux-kernel-cxl-memory",
          pubDate: new Date(Date.now() - 360 * 60 * 1000).toISOString(),
          author: "Jim Salter",
          read: true,
          favorite: false,
          categories: ["Linux", "Kernel"],
        },
      ],
    },
    {
      id: "feed-quanta",
      title: "Quanta Magazine",
      feedUrl: "https://api.quantamagazine.org/feed",
      link: "https://quantamagazine.org",
      description: "Illuminating science and math research through in-depth reporting.",
      unreadCount: 2,
      lastFetched: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      items: [
        {
          id: "qm-1",
          feedId: "feed-quanta",
          title: "Mathematicians Discover New Geometric Bridge to Number Theory",
          description: "An unexpected duality between hyperbolic 3-manifolds and modular curves unlocks long-standing conjectures.",
          content: "<p>An unexpected duality between hyperbolic 3-manifolds and modular curves unlocks long-standing conjectures.</p>",
          link: "https://quantamagazine.org/geometric-bridge-number-theory",
          pubDate: new Date(Date.now() - 75 * 60 * 1000).toISOString(),
          author: "Kevin Hartnett",
          read: false,
          favorite: true,
          categories: ["Mathematics", "Topology"],
        },
        {
          id: "qm-2",
          feedId: "feed-quanta",
          title: "How Neural Networks Form Higher-Order Conceptual Manifolds",
          description: "Geometry reveals how multi-layer representations collapse high-dimensional token spaces into structured cognitive maps.",
          content: "<p>Geometry reveals how multi-layer representations collapse high-dimensional token spaces into structured cognitive maps.</p>",
          link: "https://quantamagazine.org/neural-concept-geometry",
          pubDate: new Date(Date.now() - 280 * 60 * 1000).toISOString(),
          author: "Jordana Cepelewicz",
          read: false,
          favorite: false,
          categories: ["Computer Science", "Neuroscience"],
        },
      ],
    },
    {
      id: "feed-nature",
      title: "Nature Neuroscience",
      feedUrl: "https://www.nature.com/neuro.rss",
      link: "https://www.nature.com/neuro",
      description: "Leading peer-reviewed journal publishing research in neuroscience.",
      unreadCount: 3,
      lastFetched: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      items: [
        {
          id: "nat-1",
          feedId: "feed-nature",
          title: "Hippocampal Replay and Synaptic Consolidation During Slow-Wave Sleep",
          description: "Optogenetic interrogation reveals that coordinated spindle-ripple complexes orchestrate neocortical trace permanence.",
          content: "<p>Optogenetic interrogation reveals that coordinated spindle-ripple complexes orchestrate neocortical trace permanence.</p>",
          link: "https://nature.com/articles/s41593-026-01824-x",
          pubDate: new Date(Date.now() - 180 * 60 * 1000).toISOString(),
          author: "Marcus E. Raichle",
          read: false,
          favorite: true,
          categories: ["Neuroscience", "Memory"],
        },
      ],
    },
  ];
  localStorage.setItem("rss_feeds", JSON.stringify(rssFeeds));

  // Seed Assistant Conversation
  const assistantConvs = {
    "mobile:global": {
      messages: [
        {
          id: "msg-1",
          role: "user",
          content: "Can you generate 3 high-yield flashcards from the chapter on synaptic consolidation?",
          timestamp: Date.now() - 120_000,
        },
        {
          id: "msg-2",
          role: "assistant",
          content: `Here are 3 high-yield flashcards crafted from the synaptic consolidation section:

**1. Basic Card**
**Q:** What biochemical process is required for late-phase LTP and long-term synaptic consolidation?
**A:** De novo protein synthesis and gene transcription (mediated by CREB activation).

**2. Cloze Card**
{{c1::Slow-wave sleep}} coordinates hippocampal sharp-wave ripples with cortical sleep spindles to transfer memories from temporary to long-term storage.

**3. Concept Check**
**Q:** Why does retrieval practice strengthen memory more than passive re-reading?
**A:** Testing induces active memory reconsolidation, updating the trace and creating richer associative search pathways.`,
          timestamp: Date.now() - 60_000,
        },
      ],
      scope: "chat",
      input: "",
      updatedAt: Date.now() - 60_000,
    },
  };
  localStorage.setItem("assistant-panel-conversations-v1", JSON.stringify(assistantConvs));

  // Seed Audiobook listening stats
  localStorage.setItem("audiobook-listening-stats-summary", JSON.stringify({ today: 48, week: 315 }));
});

console.log("Navigating to http://127.0.0.1:5199/ ...");
await page.goto("http://127.0.0.1:5199/", { waitUntil: "domcontentloaded" });
await page.waitForSelector('body[data-plethora-ready="true"]', { timeout: 30000 });
await page.waitForSelector('#nav-tab-dashboard', { timeout: 30000 });

// Populate IndexedDB with documents, extracts, learning items, and podcasts
console.log("Seeding IndexedDB...");
await page.evaluate(async () => {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("plethora");
    req.onsuccess = async () => {
      const db = req.result;
      const now = new Date().toISOString();
      const today = new Date().toISOString().slice(0, 10);

      const tx = db.transaction(
        ["documents", "extracts", "learning_items", "podcast_feeds", "podcast_episodes"],
        "readwrite"
      );

      const docStore = tx.objectStore("documents");
      const extStore = tx.objectStore("extracts");
      const itemStore = tx.objectStore("learning_items");
      const pFeedStore = tx.objectStore("podcast_feeds");
      const pEpStore = tx.objectStore("podcast_episodes");

      // Clear existing records
      docStore.clear();
      extStore.clear();
      itemStore.clear();
      pFeedStore.clear();
      pEpStore.clear();

      // 1. Documents
      const docs = [
        {
          id: "doc-1",
          title: "Why Highlighting Feels Like Learning",
          file_path: "demo/encoding-versus-highlighting.epub",
          file_type: "epub",
          content: "Why highlighting feels like learning. By Dr. Anne Cleary. The psychological illusion of competence...",
          total_pages: 32,
          current_page: 18,
          current_scroll_percent: 56,
          progress_percent: 56,
          category: "Cognitive Science",
          tags: ["memory", "learning", "incremental-reading"],
          date_added: new Date(Date.now() - 7 * 86400000).toISOString(),
          date_modified: now,
          extract_count: 8,
          learning_item_count: 5,
          priority_rating: 5,
          priority_slider: 92,
          priority_score: 92,
          priority_explicitly_set: true,
          is_archived: false,
          is_favorite: true,
          next_reading_date: now,
          reading_count: 4,
          stability: 18.5,
          difficulty: 4.2,
          reps: 4,
          metadata: { author: "Dr. Anne Cleary", subject: "Cognitive Psychology" },
        },
        {
          id: "doc-2",
          title: "Synaptic Plasticity & Memory Consolidation",
          file_path: "demo/synaptic-plasticity.pdf",
          file_type: "pdf",
          content: "Mechanisms of long-term potentiation and structural remodeling in dendritic spines...",
          total_pages: 24,
          current_page: 9,
          current_scroll_percent: 38,
          progress_percent: 38,
          category: "Neuroscience",
          tags: ["neuroscience", "biology", "synapses"],
          date_added: new Date(Date.now() - 5 * 86400000).toISOString(),
          date_modified: now,
          extract_count: 12,
          learning_item_count: 9,
          priority_rating: 4,
          priority_slider: 85,
          priority_score: 85,
          priority_explicitly_set: true,
          is_archived: false,
          is_favorite: true,
          next_reading_date: now,
          reading_count: 3,
          stability: 12.0,
          difficulty: 5.1,
          reps: 3,
          metadata: { author: "Eric R. Kandel", subject: "Neurobiology" },
        },
        {
          id: "doc-3",
          title: "Spaced Retrieval Methods & FSRS Scheduling",
          file_path: "demo/spaced-retrieval-methods.pdf",
          file_type: "pdf",
          content: "A rigorous mathematical formulation of the Free Spaced Repetition Scheduler...",
          total_pages: 16,
          current_page: 13,
          current_scroll_percent: 81,
          progress_percent: 81,
          category: "Algorithms",
          tags: ["fsrs", "spaced-repetition", "methods"],
          date_added: new Date(Date.now() - 10 * 86400000).toISOString(),
          date_modified: now,
          extract_count: 6,
          learning_item_count: 4,
          priority_rating: 4,
          priority_slider: 78,
          priority_score: 78,
          priority_explicitly_set: true,
          is_archived: false,
          is_favorite: false,
          next_reading_date: now,
          reading_count: 6,
          stability: 28.4,
          difficulty: 3.5,
          reps: 6,
          metadata: { author: "Jarrett Ye & Plethora Team", subject: "Learning Science" },
        },
        {
          id: "doc-4",
          title: "The Principles of Psychology: Habit & Memory",
          file_path: "demo/william-james-habit-memory.epub",
          file_type: "epub",
          content: "Habit is thus the enormous fly-wheel of society, its most precious conservative agent...",
          total_pages: 48,
          current_page: 11,
          current_scroll_percent: 23,
          progress_percent: 23,
          category: "Classics",
          tags: ["william-james", "psychology", "habit"],
          date_added: new Date(Date.now() - 14 * 86400000).toISOString(),
          date_modified: now,
          extract_count: 15,
          learning_item_count: 11,
          priority_rating: 3,
          priority_slider: 65,
          priority_score: 65,
          priority_explicitly_set: true,
          is_archived: false,
          is_favorite: false,
          next_reading_date: now,
          reading_count: 2,
          stability: 8.5,
          difficulty: 6.2,
          reps: 2,
          metadata: { author: "William James (1890)", subject: "Philosophy of Mind" },
        },
        // Audiobooks (file_type: 'audio', tags: ['audiobook'])
        {
          id: "doc-audio-1",
          title: "Atomic Habits: An Easy & Proven Way",
          file_path: "audio/atomic-habits.m4b",
          file_type: "audio",
          total_pages: 1,
          current_page: 1,
          current_scroll_percent: 48,
          progress_percent: 48,
          category: "Self-Improvement",
          tags: ["audiobook", "habits", "productivity"],
          date_added: new Date(Date.now() - 12 * 86400000).toISOString(),
          date_modified: now,
          extract_count: 6,
          learning_item_count: 8,
          priority_rating: 5,
          priority_slider: 90,
          priority_score: 90,
          priority_explicitly_set: true,
          is_archived: false,
          is_favorite: true,
          total_time_spent: 19800,
          duration: 41400, // 11h 30m
          metadata: { author: "James Clear", subject: "Behavioral Psychology" },
        },
        {
          id: "doc-audio-2",
          title: "Thinking, Fast and Slow",
          file_path: "audio/thinking-fast-slow.m4b",
          file_type: "audio",
          total_pages: 1,
          current_page: 1,
          current_scroll_percent: 32,
          progress_percent: 32,
          category: "Psychology",
          tags: ["audiobook", "cognition", "psychology"],
          date_added: new Date(Date.now() - 20 * 86400000).toISOString(),
          date_modified: now,
          extract_count: 9,
          learning_item_count: 14,
          priority_rating: 4,
          priority_slider: 82,
          priority_score: 82,
          priority_explicitly_set: true,
          is_archived: false,
          is_favorite: true,
          total_time_spent: 23400,
          duration: 72900, // 20h 15m
          metadata: { author: "Daniel Kahneman", subject: "Cognitive Biases" },
        },
        {
          id: "doc-audio-3",
          title: "Deep Work: Rules for Focused Success",
          file_path: "audio/deep-work.m4b",
          file_type: "audio",
          total_pages: 1,
          current_page: 1,
          current_scroll_percent: 100,
          progress_percent: 100,
          category: "Productivity",
          tags: ["audiobook", "focus", "deep-work"],
          date_added: new Date(Date.now() - 30 * 86400000).toISOString(),
          date_modified: now,
          extract_count: 11,
          learning_item_count: 16,
          priority_rating: 4,
          priority_slider: 75,
          priority_score: 75,
          priority_explicitly_set: true,
          is_archived: false,
          is_favorite: false,
          total_time_spent: 27900,
          duration: 27900, // 7h 45m
          metadata: { author: "Cal Newport", subject: "Focus & Attention" },
        },
      ];

      for (const d of docs) docStore.put(d);

      // 2. Extracts
      const extracts = [
        {
          id: "ext-1",
          document_id: "doc-1",
          title: "The Fluency Illusion in Highlighting",
          content: "The illusion of explanatory depth occurs when learners mistake passive recognition of high-level terms for generative comprehension.",
          category: "Cognitive Science",
          tags: ["fluency-illusion", "comprehension"],
          date_created: now,
          next_review_date: now,
          priority_slider: 90,
          priority_score: 90,
        },
        {
          id: "ext-2",
          document_id: "doc-2",
          title: "Late-Phase Long-Term Potentiation (L-LTP)",
          content: "Unlike early LTP which relies on kinase phosphorylation of existing AMPA receptors, L-LTP requires transcription via CREB.",
          category: "Neuroscience",
          tags: ["synaptic-plasticity", "creb"],
          date_created: now,
          next_review_date: now,
          priority_slider: 86,
          priority_score: 86,
        },
      ];

      for (const e of extracts) extStore.put(e);

      // 3. Learning Items (Flashcards)
      const items = [
        {
          id: "card-1",
          document_id: "doc-1",
          extract_id: "ext-1",
          item_type: "basic",
          question: "What is the primary cognitive flaw of passive highlighting while reading?",
          answer: "It triggers the 'fluency illusion'—mistaking familiar visual cues for active mental encoding.",
          category: "Cognitive Science",
          tags: ["learning", "encoding"],
          state: "review",
          stability: 14.2,
          difficulty: 4.8,
          elapsed_days: 12,
          scheduled_days: 14,
          reps: 3,
          lapses: 0,
          due_date: new Date(Date.now() - 3600000).toISOString(),
          date_created: now,
          date_modified: now,
          review_count: 3,
          interval: 14,
          ease_factor: 2.5,
          is_suspended: false,
        },
        {
          id: "card-2",
          document_id: "doc-2",
          extract_id: "ext-2",
          item_type: "cloze",
          cloze_text: "{{c1::Slow-wave sleep}} coordinates hippocampal sharp-wave ripples with cortical sleep spindles to consolidate memories.",
          question: "Slow-wave sleep coordinates hippocampal sharp-wave ripples...",
          category: "Neuroscience",
          tags: ["sleep", "cognition"],
          state: "learning",
          stability: 9.4,
          difficulty: 5.2,
          elapsed_days: 8,
          scheduled_days: 9,
          reps: 2,
          lapses: 0,
          due_date: new Date(Date.now() - 7200000).toISOString(),
          date_created: now,
          date_modified: now,
          review_count: 2,
          interval: 9,
          ease_factor: 2.4,
          is_suspended: false,
        },
        {
          id: "card-3",
          document_id: "doc-3",
          item_type: "basic",
          question: "In FSRS-7, what does the Stability parameter (S) measure?",
          answer: "The time (in days) required for memory retrievability (R) to decrease from 100% to 90%.",
          category: "Algorithms",
          tags: ["fsrs", "spaced-repetition"],
          state: "new",
          stability: 28.0,
          difficulty: 3.2,
          elapsed_days: 0,
          scheduled_days: 1,
          reps: 0,
          lapses: 0,
          due_date: new Date(Date.now() - 1800000).toISOString(),
          date_created: now,
          date_modified: now,
          review_count: 0,
          interval: 1,
          ease_factor: 2.5,
          is_suspended: false,
        },
        {
          id: "card-4",
          document_id: "doc-4",
          item_type: "basic",
          question: "How does William James describe habit in 'The Principles of Psychology'?",
          answer: "As 'the enormous fly-wheel of society, its most precious conservative agent'.",
          category: "Classics",
          tags: ["psychology", "habit"],
          state: "review",
          stability: 34.0,
          difficulty: 3.8,
          elapsed_days: 20,
          scheduled_days: 21,
          reps: 6,
          lapses: 0,
          due_date: new Date(Date.now() - 10800000).toISOString(),
          date_created: now,
          date_modified: now,
          review_count: 6,
          interval: 21,
          ease_factor: 2.6,
          is_suspended: false,
        },
      ];

      for (const it of items) itemStore.put(it);

      // 4. Podcasts
      const podcastFeeds = [
        {
          id: "pod-huberman",
          title: "Huberman Lab",
          author: "Scicomm Media & Andrew Huberman, Ph.D.",
          description: "Discusses neuroscience and science-based tools for everyday life.",
          feed_url: "https://feeds.megaphone.fm/hubermanlab",
          link: "https://hubermanlab.com",
          image_url: null,
          language: "en",
          last_fetched: now,
          subscribed_at: now,
          sort_order: 0,
          auto_transcribe: false,
        },
        {
          id: "pod-hardcore",
          title: "Dan Carlin's Hardcore History",
          author: "Dan Carlin",
          description: "In-depth explorations of the most dramatic moments in human history.",
          feed_url: "https://feeds.feedburner.com/dancarlin/history",
          link: "https://dancarlin.com",
          image_url: null,
          language: "en",
          last_fetched: now,
          subscribed_at: now,
          sort_order: 1,
          auto_transcribe: false,
        },
        {
          id: "pod-lex",
          title: "Lex Fridman Podcast",
          author: "Lex Fridman",
          description: "Conversations about AI, science, technology, history, and philosophy.",
          feed_url: "https://lexfridman.com/feed/podcast/",
          link: "https://lexfridman.com",
          image_url: null,
          language: "en",
          last_fetched: now,
          subscribed_at: now,
          sort_order: 2,
          auto_transcribe: false,
        },
      ];

      for (const pf of podcastFeeds) pFeedStore.put(pf);

      const podcastEpisodes = [
        {
          id: "ep-huberman-1",
          feed_id: "pod-huberman",
          guid: "hl-ep-learning-faster",
          title: "How to Learn & Retain Information Faster",
          description: "In this episode, Dr. Huberman discusses the biological mechanisms of neuroplasticity, memory formation, and deliberate focus protocols.",
          published_date: new Date(Date.now() - 3 * 86400000).toISOString(),
          duration: 8280, // 2h 18m
          audio_url: "https://example.com/audio/huberman-learning.mp3",
          audio_type: "audio/mpeg",
          file_size: 78500000,
          image_url: null,
          link: "https://hubermanlab.com/how-to-learn-faster",
          played: false,
          playback_position: 2450, // 40m 50s in
          transcript_status: "ready",
          transcript_text: "Welcome to the Huberman Lab Podcast, where we discuss science and science-based tools for everyday life...",
          date_added: now,
        },
        {
          id: "ep-huberman-2",
          feed_id: "pod-huberman",
          guid: "hl-ep-sleep-memory",
          title: "Master Your Sleep & Enhance Your Memory",
          description: "Exploring the critical roles of slow-wave sleep and REM sleep in memory consolidation, synaptic homeostasis, and cognitive health.",
          published_date: new Date(Date.now() - 10 * 86400000).toISOString(),
          duration: 6840, // 1h 54m
          audio_url: "https://example.com/audio/huberman-sleep.mp3",
          audio_type: "audio/mpeg",
          file_size: 64200000,
          image_url: null,
          link: "https://hubermanlab.com/master-sleep-memory",
          played: false,
          playback_position: 0,
          transcript_status: "ready",
          date_added: now,
        },
        {
          id: "ep-hardcore-1",
          feed_id: "pod-hardcore",
          guid: "hh-supernova-6",
          title: "Supernova in the East VI",
          description: "The cataclysmic finale of the Asia-Pacific theater in World War II, examining industrial mobilization and strategic consequence.",
          published_date: new Date(Date.now() - 25 * 86400000).toISOString(),
          duration: 16080, // 4h 28m
          audio_url: "https://example.com/audio/hh-supernova-6.mp3",
          audio_type: "audio/mpeg",
          file_size: 154000000,
          image_url: null,
          link: "https://dancarlin.com/supernova-6",
          played: false,
          playback_position: 6120, // 1h 42m in
          transcript_status: "ready",
          date_added: now,
        },
        {
          id: "ep-lex-1",
          feed_id: "pod-lex",
          guid: "lex-412-lecun",
          title: "#412 – Yann LeCun: World Models, Joint Embedding & AGI",
          description: "Yann LeCun discusses autonomous intelligence, JEPA architectures, objective-driven AI, and the future of open-source research.",
          published_date: new Date(Date.now() - 14 * 86400000).toISOString(),
          duration: 9900, // 2h 45m
          audio_url: "https://example.com/audio/lex-412.mp3",
          audio_type: "audio/mpeg",
          file_size: 92000000,
          image_url: null,
          link: "https://lexfridman.com/yann-lecun",
          played: false,
          playback_position: 1800,
          transcript_status: "ready",
          date_added: now,
        },
      ];

      for (const ep of podcastEpisodes) pEpStore.put(ep);

      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
    req.onerror = () => reject(req.error);
  });
});

console.log("IndexedDB seeded successfully!");

// Reload the page so all React stores rehydrate the seeded DB and localStorage
console.log("Reloading page with seeded data...");
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('body[data-plethora-ready="true"]', { timeout: 30000 });
await page.waitForSelector('#nav-tab-dashboard', { timeout: 30000 });
await page.waitForTimeout(1500);

// Helper function to capture a view
async function captureView(filename, prepAction) {
  console.log(`Capturing ${filename}...`);
  if (prepAction) {
    await prepAction();
    await page.waitForTimeout(1000);
  }
  // Wait for any animations/spinners to settle
  await page.waitForSelector(".animate-spin", { state: "detached", timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT_DIR}/${filename}` });
  console.log(`Saved ${filename}`);
}

// 1. Dashboard View
await captureView("1_dashboard.png", async () => {
  await page.click("#nav-tab-dashboard");
});

// 2. Queue View
await captureView("2_queue.png", async () => {
  await page.click("#nav-tab-queue");
});

// 3. Review View
await captureView("3_review.png", async () => {
  await page.click("#nav-tab-review");
});

// 4. Documents View
await captureView("4_documents.png", async () => {
  await page.click("#nav-tab-documents");
});

// 5. Settings View
await captureView("5_settings.png", async () => {
  await page.click("#nav-tab-settings");
});

// Open More Menu helper
async function openMoreItem(labelText) {
  const moreBtn = page.locator("nav.mobile-bottom-nav > button").last();
  await moreBtn.click();
  await page.waitForSelector(".mobile-more-sheet", { state: "visible", timeout: 5000 });
  await page.waitForTimeout(300);
  const item = page.locator(`.mobile-more-item:has-text("${labelText}")`).first();
  await item.click();
  await page.waitForTimeout(1000);
}

// 6. Statistics / Analytics View
await captureView("6_analytics.png", async () => {
  await openMoreItem("Statistics");
});

// 7. RSS Feeds View
await captureView("7_rss.png", async () => {
  await openMoreItem("RSS");
});

// 8. Podcasts View
await captureView("8_podcasts.png", async () => {
  await openMoreItem("Podcasts");
});

// 9. Audiobooks View
await captureView("9_audiobooks.png", async () => {
  await openMoreItem("Audiobooks");
});

// 10. Assistant Open View
await captureView("10_assistant.png", async () => {
  await page.click("#nav-tab-dashboard");
  await page.waitForTimeout(500);
  const pill = page.locator(".mobile-assistant-pill");
  await pill.waitFor({ state: "visible", timeout: 5000 });
  await pill.click();
  await page.waitForSelector("#mobile-assistant-dialog", { state: "visible", timeout: 5000 });
  await page.waitForSelector("text=Loading Assistant…", { state: "detached", timeout: 15000 }).catch(() => {});
  await page.waitForSelector("#mobile-assistant-chat textarea", { timeout: 15000 });
  await page.waitForTimeout(1000);

  await page.evaluate(() => {
    const sheet = document.getElementById("mobile-assistant-dialog");
    if (sheet) {
      sheet.style.height = "700px";
      sheet.style.transform = "translate3d(0, 0px, 0)";
    }
    const scrim = document.querySelector(".mobile-assistant-scrim");
    if (scrim) {
      scrim.style.opacity = "0.6";
    }
    const scroller = document.querySelector("#mobile-assistant-chat .overflow-y-auto");
    if (scroller) {
      scroller.scrollTop = 0;
    }
  });
  await page.waitForTimeout(600);
});

console.log("All views captured successfully!");
await browser.close();
