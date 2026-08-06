/**
 * Reconciled Calculation Rules & Metrics Math Engine
 * Enforces exact rules from READING_TRACKER_CALCULATION_RULES.md
 */

export function calculateReconciledMetrics(books, logs) {
  const activeLogs = (logs || []).filter(l => l && (!l.notes || !l.notes.startsWith('Historical cycle')));

  // Pre-index max end_page per book title for fast O(1) active cycle lookup
  const maxEndPageMap = new Map();
  for (let i = 0; i < activeLogs.length; i++) {
    const l = activeLogs[i];
    if (!l || !l.book_title) continue;
    const ep = typeof l.end_page === 'number' ? l.end_page : parseInt(l.end_page || 0, 10) || 0;
    const cur = maxEndPageMap.get(l.book_title) || 0;
    if (ep > cur) maxEndPageMap.set(l.book_title, ep);
  }

  // 1. Finished Titles & Books Read (Completed Cycles)
  let finishedTitles = 0;
  let activeTitles = 0;
  let unreadTitles = 0;
  let totalCompletedReads = 0;
  let finishedCyclesPages = 0;
  let activeCyclesPages = 0;

  const totalCatalogTitles = (books || []).length;

  for (let i = 0; i < totalCatalogTitles; i++) {
    const b = books[i];
    if (!b) continue;
    const rc = typeof b.read_count === 'number' ? b.read_count : parseInt(b.read_count || 0, 10) || 0;
    const totalPages = typeof b.total_pages === 'number' ? b.total_pages : parseInt(b.total_pages || 0, 10) || 0;
    const status = b.status || 'Unread';
    const isFinishedStatus = status === 'Finished' || status === 'Owned and Read' || status === 'Borrowed and Read';
    const isFinished = isFinishedStatus || rc > 0;

    if (isFinished) {
      finishedTitles++;
      const completedCycles = rc > 0 ? rc : (isFinishedStatus ? 1 : 0);
      totalCompletedReads += completedCycles;
      finishedCyclesPages += completedCycles * totalPages;
    } else if (status === 'In Progress') {
      activeTitles++;
    } else {
      unreadTitles++;
    }

    // Active cycle progress calculation for In-Progress books
    if (status === 'In Progress' || rc > 0) {
      const maxEndPage = b.title ? (maxEndPageMap.get(b.title) || 0) : 0;
      if (maxEndPage > 0) {
        activeCyclesPages += totalPages > 0 ? Math.min(maxEndPage, totalPages) : maxEndPage;
      } else if (b.current_page && status === 'In Progress') {
        const cp = typeof b.current_page === 'number' ? b.current_page : parseInt(b.current_page || 0, 10) || 0;
        activeCyclesPages += cp;
      }
    }
  }

  const grandTotalPages = finishedCyclesPages + activeCyclesPages;

  return {
    totalCatalogTitles,
    finishedTitles,
    activeTitles,
    unreadTitles,
    totalCompletedReads,
    finishedCyclesPages,
    activeCyclesPages,
    grandTotalPages
  };
}

export function calculateReadingStreaks(logs) {
  const dates = [...new Set(logs.map(l => l.date).filter(Boolean))].sort();
  if (dates.length === 0) return { currentStreak: 0, longestStreak: 0 };

  const dateObjects = dates.map(d => new Date(d + 'T00:00:00'));
  let longest = 1;
  let current = 1;

  for (let i = 1; i < dateObjects.length; i++) {
    const diff = (dateObjects[i] - dateObjects[i - 1]) / (1000 * 60 * 60 * 24);
    if (diff === 1) {
      current++;
    } else if (diff > 1) {
      if (current > longest) longest = current;
      current = 1;
    }
  }
  if (current > longest) longest = current;

  // Check if current streak extends to today or yesterday
  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const lastLoggedDate = dates[dates.length - 1];

  let activeCurrentStreak = 0;
  if (lastLoggedDate === todayStr || lastLoggedDate === yesterdayStr) {
    activeCurrentStreak = current;
  }

  return {
    currentStreak: activeCurrentStreak,
    longestStreak: longest
  };
}
