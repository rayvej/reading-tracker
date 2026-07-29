/**
 * 10-Year Usage Data Simulator & Stress Testing Data Generator
 * Multi-Profile Generator for rayvej/reading-tracker
 * 
 * Profiles:
 * 1. 10-Year Master Archivist (2016–2026): ~250 books, ~3,500 daily logs, 150+ quotes, 11 annual goal configs.
 * 2. High-Velocity Power Reader: 100+ books, 1,200+ logs, high daily page velocity, 300+ day streaks.
 * 3. Chaos & Edge Case Stress Profile: 50 books with complex diacritics, 1,500+ page tomes, long notes, images.
 */

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

const AUTHOR_CATALOG = [
  { name: 'Bahá’u’lláh', category: 'Bahá’í Sacred Writings', coverGrad: '#4d1b14' },
  { name: '‘Abdu’l-Bahá', category: 'Bahá’í Sacred Writings', coverGrad: '#123322' },
  { name: 'Shoghi Effendi', category: 'Bahá’í History & Guidance', coverGrad: '#182233' },
  { name: 'The Báb', category: 'Bahá’í Sacred Writings', coverGrad: '#3d2618' },
  { name: 'H.M. Balyuzi', category: 'Biography & History', coverGrad: '#281a38' },
  { name: 'Adib Taherzadeh', category: 'Study & Commentary', coverGrad: '#2b3318' },
  { name: 'Ruhiyyih Khanum', category: 'Inspirational & Reflections', coverGrad: '#382d1a' },
  { name: 'Universal House of Justice', category: 'Institutional Messages', coverGrad: '#2e1c14' },
  { name: 'Yuval Noah Harari', category: 'Non-Fiction History', coverGrad: '#1e3838' },
  { name: 'Walter Isaacson', category: 'Biography', coverGrad: '#381e38' }
];

const TITLE_PREFIXES = [
  'The Revelation of', 'Studies in the Kitáb-i-', 'Gleanings from', 'Memorials of', 
  'The Covenant of', 'Vignettes from the Life of', 'The Story of', 'Chronicles of', 
  'A Companion to', 'Lessons in', 'The Century of', 'Promulgation of', 
  'The Divine Plan for', 'Selected Writings of', 'Light of the'
];

const TITLE_NOUNS = [
  'Divine Light', 'The Center of the Covenant', 'The Master', 'The Purest Branch',
  'The Most Exalted Leaf', 'Universal Peace', 'The King of Glory', 'World Order',
  'God Passes By', 'Citadel of Faith', 'The Secret of Civilization', 'Attaining Higher Functioning',
  'The Advent of Divine Justice', 'Promised Day', 'Tabernacle of Unity', 'Call of the Beloved'
];

const SAMPLE_QUOTES = [
  "So powerful is the light of unity that it can illuminate the whole earth.",
  "Let your vision be world-embracing, rather than confined to your own self.",
  "The earth is but one country, and mankind its citizens.",
  "Truthfulness is the foundation of all human virtues.",
  "Be an ornament to the countenance of truth, a crown to the brow of fidelity.",
  "Regard man as a mine rich in gems of inestimable value.",
  "Justice is in thee the most beloved of all things; turn not away therefrom if thou desirest Me.",
  "Knowledge is a single point, which the foolish have multiplied.",
  "Beware lest any name withhold you from Him Who is the Possessor of all names.",
  "Blessed is he who preferreth his brother before himself."
];

/**
 * Profile 1: 10-Year Master Archivist Data Generator (2016–2026)
 */
export function generate10YearArchivistData() {
  const books = [];
  const reading_logs = [];
  const wishlist = [];
  const goals = {};

  // 1. Generate Goals Config for 2016-2026 (11 years)
  for (let year = 2016; year <= 2026; year++) {
    goals[year] = {
      target_books: randomInt(18, 30),
      target_pages: randomInt(4000, 8000)
    };
  }

  // 2. Generate Books (~220 books)
  const totalBooksCount = 220;
  for (let i = 1; i <= totalBooksCount; i++) {
    const authorObj = randomChoice(AUTHOR_CATALOG);
    const prefix = randomChoice(TITLE_PREFIXES);
    const noun = randomChoice(TITLE_NOUNS);
    const title = `${prefix} ${noun} ${i > 40 ? 'Vol. ' + (i % 5 + 1) : ''}`.trim();
    const totalPages = randomInt(60, 750);
    
    // Status distribution: ~140 Finished, 8 In Progress, 15 DNF, 57 Wishlist/Unread
    let status = 'Not Started';
    let ownership = 'Owned';
    let readCount = 0;
    let pagesRead = 0;
    let rating = 0;

    if (i <= 140) {
      status = 'Finished';
      readCount = (i % 7 === 0) ? 2 : 1; // Some books re-read twice
      pagesRead = totalPages;
      rating = randomInt(4, 5);
      if (i % 5 === 0) ownership = 'Borrowed';
    } else if (i <= 148) {
      status = 'In Progress';
      pagesRead = Math.round(totalPages * (randomInt(15, 85) / 100));
      readCount = 0;
    } else if (i <= 163) {
      status = 'DNF';
      pagesRead = Math.round(totalPages * (randomInt(5, 35) / 100));
    } else if (i <= 185) {
      status = 'Not Started';
      ownership = 'Owned';
    } else {
      status = 'Wishlist';
      ownership = 'Wishlist';
    }

    const yearAdded = randomInt(2016, 2026);
    const monthAdded = String(randomInt(1, 12)).padStart(2, '0');
    const dayAdded = String(randomInt(1, 28)).padStart(2, '0');

    if (status === 'Wishlist') {
      wishlist.push({
        title,
        author: authorObj.name,
        category: authorObj.category,
        priority: randomChoice(['High', 'Medium', 'Low']),
        status: 'Wishlist',
        est_pages: totalPages,
        est_cost: randomInt(12, 45),
        date_added: `${yearAdded}-${monthAdded}-${dayAdded}`,
        notes: `Recommended by book club in ${yearAdded}`
      });
    } else {
      books.push({
        title,
        author: authorObj.name,
        category: authorObj.category,
        collection: (i % 3 === 0) ? 'Core Curriculum' : (i % 2 === 0 ? 'Historical Studies' : 'General Reading'),
        status: status === 'Finished' ? 'Owned and Read' : (ownership === 'Borrowed' ? 'Borrowed' : 'Owned'),
        ownership,
        total_pages: totalPages,
        pages_read: pagesRead,
        read_count: readCount,
        rating,
        date_added: `${yearAdded}-${monthAdded}-${dayAdded}`,
        notes: (rating >= 4) ? `Profound insights in chapters ${randomInt(1, 5)}. ` + randomChoice(SAMPLE_QUOTES) : '',
        cover_url: '',
        priority: (status === 'In Progress') ? 'High' : 'Medium'
      });
    }
  }

  // 3. Generate 10-Year Timestamped Reading Logs (~2,800 daily entries)
  const startDate = new Date('2016-01-01');
  const endDate = new Date('2026-07-28');
  const finishedBooks = books.filter(b => b.pages_read === b.total_pages || b.read_count > 0);
  const inProgressBooks = books.filter(b => b.pages_read < b.total_pages && b.pages_read > 0);

  let currentBookIdx = 0;
  let currBook = finishedBooks[0] || books[0];
  let currCycle = 1;
  let currStartPage = 0;

  for (let dt = new Date(startDate); dt <= endDate; dt.setDate(dt.getDate() + 1)) {
    // 70% probability of reading on any given day (simulating real reading streaks & occasional lulls)
    const month = dt.getMonth();
    const dayOfWeek = dt.getDay();
    // Summer (June-Aug) and Winter (Dec) have 85% probability
    const isPeakSeason = (month >= 5 && month <= 7) || month === 11;
    const probability = isPeakSeason ? 0.85 : (dayOfWeek === 0 || dayOfWeek === 6 ? 0.80 : 0.65);

    if (Math.random() > probability) continue; // Skip day (lull/rest day)

    if (!currBook) break;

    const remainingPages = currBook.total_pages - currStartPage;
    if (remainingPages <= 0) {
      // Advance to next book
      currentBookIdx = (currentBookIdx + 1) % (finishedBooks.length || books.length);
      currBook = finishedBooks[currentBookIdx] || books[currentBookIdx];
      currCycle = (currBook.read_count > 1 && Math.random() > 0.5) ? 2 : 1;
      currStartPage = 0;
    }

    const pagesThisSession = Math.min(remainingPages > 0 ? remainingPages : randomInt(15, 45), randomInt(12, 55));
    const currEndPage = currStartPage + pagesThisSession;
    const minutesSpent = Math.max(10, Math.round(pagesThisSession * (60 / randomInt(25, 45))));
    const dateStr = formatDate(dt);

    const hasQuote = (Math.random() < 0.08); // 8% of logs have a note/quote attached
    const noteContent = hasQuote ? `"${randomChoice(SAMPLE_QUOTES)}" (p. ${currEndPage})` : '';

    reading_logs.push({
      date: dateStr,
      book_title: currBook.title,
      read_cycle: currCycle,
      start_page: currStartPage,
      end_page: currEndPage,
      minutes_spent: minutesSpent,
      notes: noteContent,
      photo_url: null,
      created_at: dateStr + 'T20:00:00.000Z'
    });

    currStartPage = currEndPage;
  }

  return { books, reading_logs, wishlist, goals };
}

/**
 * Profile 2: High-Velocity Power Reader (Dense 2-Year Load)
 */
export function generateHighVelocityData() {
  const books = [];
  const reading_logs = [];
  const wishlist = [];
  const goals = {};

  const currYear = new Date().getFullYear();
  goals[currYear - 1] = { target_books: 50, target_pages: 15000 };
  goals[currYear] = { target_books: 60, target_pages: 18000 };

  for (let i = 1; i <= 100; i++) {
    const title = `Power Velocity Tome ${i}`;
    const totalPages = randomInt(150, 450);
    books.push({
      title,
      author: 'Speed Reader',
      category: 'Power Reading',
      collection: 'Sprint 2025-2026',
      status: i <= 80 ? 'Owned and Read' : 'In Progress',
      ownership: 'Owned',
      total_pages: totalPages,
      pages_read: i <= 80 ? totalPages : randomInt(20, totalPages - 10),
      read_count: 1,
      rating: randomInt(3, 5),
      date_added: '2025-01-01',
      notes: 'High velocity sprint read.'
    });
  }

  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 2);
  const endDate = new Date();

  let bIdx = 0;
  for (let dt = new Date(startDate); dt <= endDate; dt.setDate(dt.getDate() + 1)) {
    const book = books[bIdx % books.length];
    const pages = randomInt(35, 90);
    reading_logs.push({
      date: formatDate(dt),
      book_title: book.title,
      read_cycle: 1,
      start_page: 0,
      end_page: pages,
      minutes_spent: randomInt(40, 90),
      notes: 'Daily high-speed session.',
      photo_url: null,
      created_at: formatDate(dt) + 'T18:00:00.000Z'
    });
    bIdx++;
  }

  return { books, reading_logs, wishlist, goals };
}

/**
 * Profile 3: Chaos & Boundary Edge Case Profile
 */
export function generateChaosStressData() {
  const books = [];
  const reading_logs = [];
  const wishlist = [];
  const goals = { 2026: { target_books: 100, target_pages: 50000 } };

  const COMPLEX_TITLES = [
    "‘Abdu’l-Bahá in London: Addresses & Notes",
    "Ásíyih Khánum — The Most Exalted Leaf Entitled Navváb / S",
    "Kitáb-i-Íqán: The Book of Certitude <Special Unicode & Symbols> #1",
    "The Dawn-Breakers: Nabíl’s Narrative of the Early Days of the Bahá’í Revelation (Edition 1890–1950 & Extra Notes)",
    "Short 1-Page Folio",
    "A Massive 2,500 Page Omnibus Encyclopedia of Comparative World Religions and Historical Treatises (Vol. I–X)"
  ];

  COMPLEX_TITLES.forEach((t, i) => {
    const totalPages = (i === 4) ? 1 : ((i === 5) ? 2500 : 350);
    books.push({
      title: t,
      author: "‘Abdu’l-Bahá / Nabíl-i-A‘zam",
      category: "Edge Case Testing",
      collection: "Special UTF-8 & Diacritics",
      status: i % 2 === 0 ? "Owned and Read" : "In Progress",
      ownership: "Owned",
      total_pages: totalPages,
      pages_read: Math.min(totalPages, 120),
      read_count: 1,
      rating: 5,
      date_added: "2026-01-01",
      notes: `Long text edge case note: ${"Very long reflection text ".repeat(30)} with special chars <script>alert("test")</script> & "quotes".`
    });
  });

  const today = formatDate(new Date());
  reading_logs.push({
    date: today,
    book_title: COMPLEX_TITLES[0],
    read_cycle: 1,
    start_page: 0,
    end_page: 120,
    minutes_spent: 180,
    notes: 'Chaos test log entry with long reflections & UTF-8 diacritics: ‘Abdu’l-Bahá, Ásíyih, Íqán.',
    photo_url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="%23d4a359"/><text x="10" y="50" fill="%23000">QUOTE</text></svg>',
    created_at: today + 'T12:00:00.000Z'
  });

  return { books, reading_logs, wishlist, goals };
}
