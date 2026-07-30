/**
 * Standalone Background Reminder Script (send_daily_reminders.mjs)
 * 
 * Can be scheduled via GitHub Actions, Cron, or Firebase Cloud Functions
 * to trigger daily reading notifications at 7:00 AM (or user's custom time)
 * even when the PWA is completely closed.
 */

export function generateDailyReminderPayload(books, logs, userSettings = {}) {
  const booksToSearch = books || [];
  const logsToSearch = logs || [];

  const activeBooks = booksToSearch.filter(b => b.status === 'In Progress');
  if (activeBooks.length === 0 && booksToSearch.length === 0) return null;

  const book = activeBooks.length > 0 ? activeBooks[0] : booksToSearch[0];
  const activeLogs = logsToSearch.filter(l => l.book_id === book.id || (l.title && l.title.toLowerCase() === book.title.toLowerCase()));

  // Progress calculations
  const currentPage = Number(book.current_page || 0);
  const totalPages = Number(book.total_pages) || 1;
  const remainingPages = Math.max(0, totalPages - currentPage);
  const progressPct = Math.min(100, Math.round((currentPage / totalPages) * 100));

  // Time estimate calculations
  const timedLogs = activeLogs.filter(l => Number(l.minutes_spent) > 0 && Number(l.pages_read) > 0);
  let estTimeText = "";

  if (timedLogs.length > 0) {
    const totalMins = timedLogs.reduce((sum, l) => sum + Number(l.minutes_spent), 0);
    const totalPagesLogged = timedLogs.reduce((sum, l) => sum + Number(l.pages_read), 0);
    const pagesPerMin = totalPagesLogged / (totalMins || 1);

    if (pagesPerMin > 0 && remainingPages > 0) {
      const estMinsRemaining = Math.round(remainingPages / pagesPerMin);
      const hours = Math.floor(estMinsRemaining / 60);
      const mins = estMinsRemaining % 60;
      estTimeText = hours > 0 ? `Est. ${hours}h ${mins}m remaining` : `Est. ${mins}m remaining`;
    } else {
      estTimeText = `Est. complete soon`;
    }
  } else {
    const dailyPagePace = 25;
    const daysLeft = Math.ceil(remainingPages / dailyPagePace);
    estTimeText = daysLeft > 1 ? `Est. ${daysLeft} days remaining` : `Est. 1 day remaining`;
  }

  // Retrieve most recent note
  const logsWithNotes = activeLogs
    .filter(l => l.notes && l.notes.trim().length > 0 && !l.notes.startsWith('Historical cycle'))
    .sort((a, b) => new Date(b.date || b.timestamp || 0) - new Date(a.date || a.timestamp || 0));

  const rawNote = logsWithNotes.length > 0 ? logsWithNotes[0].notes.trim() : (book.notes ? book.notes.trim() : null);

  const title = `${book.title} (${progressPct}% Complete)`;
  let body = `Page ${currentPage} of ${totalPages} • ${estTimeText}`;

  const includeQuote = userSettings.includeQuote !== false;
  if (includeQuote && rawNote) {
    const cleanQuote = rawNote.length > 120 ? rawNote.substring(0, 117) + "..." : rawNote;
    body += `\n\nRecent Note:\n"${cleanQuote}"`;
  }

  return {
    title,
    body,
    bookTitle: book.title,
    currentPage,
    totalPages,
    progressPct,
    estTimeText,
    recentNote: rawNote,
    bookId: book.id
  };
}

export function getMillisecondsUntilNextReminder(timeStr = "07:00", referenceDate = new Date()) {
  const parts = (timeStr || "07:00").split(':').map(Number);
  const targetHours = isNaN(parts[0]) ? 7 : parts[0];
  const targetMins = isNaN(parts[1]) ? 0 : parts[1];

  const target = new Date(referenceDate);
  target.setHours(targetHours, targetMins, 0, 0);

  if (target <= referenceDate) {
    target.setDate(target.getDate() + 1);
  }

  return target.getTime() - referenceDate.getTime();
}
