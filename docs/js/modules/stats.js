/**
 * Reconciled Calculation Rules & Metrics Math Engine
 * Enforces exact rules from READING_TRACKER_CALCULATION_RULES.md
 */

export function calculateReconciledMetrics(books, logs) {
  const activeLogs = logs.filter(l => !l.notes || !l.notes.startsWith('Historical cycle'));

  // 1. Finished Titles & Books Read (Completed Cycles)
  let finishedTitles = 0;
  let activeTitles = 0;
  let unreadTitles = 0;
  let totalCompletedReads = 0;
  let finishedCyclesPages = 0;
  let activeCyclesPages = 0;

  books.forEach(b => {
    const rc = parseInt(b.read_count || 0, 10);
    const totalPages = parseInt(b.total_pages || 0, 10);
    const status = b.status || 'Unread';
    const isFinishedStatus = ['Finished', 'Owned and Read', 'Borrowed and Read'].includes(status);
    const isFinished = isFinishedStatus || rc > 0;

    if (isFinished) {
      finishedTitles++;
      const completedCycles = Math.max(rc, isFinishedStatus ? 1 : 0);
      totalCompletedReads += completedCycles;
      finishedCyclesPages += completedCycles * totalPages;
    } else if (status === 'In Progress') {
      activeTitles++;
    } else {
      unreadTitles++;
    }

    // Active cycle progress calculation for In-Progress books
    if (status === 'In Progress' || rc > 0) {
      const currentCycle = rc + (isFinishedStatus ? 1 : 1);
      const bookLogs = activeLogs.filter(l => l.book_title === b.title && parseInt(l.read_cycle || 1, 10) === currentCycle);
      if (bookLogs.length > 0) {
        const maxEndPage = Math.max(...bookLogs.map(l => parseInt(l.end_page || 0, 10)));
        if (totalPages > 0) {
          activeCyclesPages += maxEndPage % totalPages;
        } else {
          activeCyclesPages += maxEndPage;
        }
      } else if (b.current_page && status === 'In Progress') {
        activeCyclesPages += parseInt(b.current_page || 0, 10);
      }
    }
  });

  const totalCatalogTitles = books.length;
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
