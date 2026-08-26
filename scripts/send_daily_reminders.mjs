/**
 * Standalone Background Reminder Script (send_daily_reminders.mjs)
 * 
 * Can be scheduled via GitHub Actions, Cron, or Firebase Cloud Functions
 * to trigger daily reading notifications at 7:00 AM (or user's custom time)
 * even when the PWA is completely closed.
 */

function getLogTimestamp(l) {
  if (!l) return 0;
  if (l.created_at && typeof l.created_at.toDate === 'function') {
    return l.created_at.toDate().getTime();
  }
  if (l.created_at && l.created_at.seconds) {
    return l.created_at.seconds * 1000;
  }
  if (l.timestamp) {
    const t = new Date(l.timestamp).getTime();
    if (!isNaN(t) && t > 0) return t;
  }
  if (l.date) {
    const d = new Date(l.date).getTime();
    if (!isNaN(d) && d > 0) return d;
  }
  return 0;
}

function doesLogMatchBook(l, b) {
  if (!l || !b) return false;
  if (b.id && l.book_id && String(l.book_id) === String(b.id)) return true;
  const bTitle = (b.title || '').trim().toLowerCase();
  if (!bTitle) return false;
  const lBookTitle = (l.book_title || '').trim().toLowerCase();
  const lTitle = (l.title || '').trim().toLowerCase();
  return (lBookTitle && lBookTitle === bTitle) || (lTitle && lTitle === bTitle);
}

export function generateDailyReminderPayload(books, logs, userSettings = {}) {
  const booksToSearch = books || [];
  const logsToSearch = logs || [];

  if (booksToSearch.length === 0) return null;

  function getBookLastActivity(b) {
    const bookLogs = logsToSearch.filter(l => doesLogMatchBook(l, b));
    let latestTime = 0;
    for (const l of bookLogs) {
      const t = getLogTimestamp(l);
      if (t > latestTime) latestTime = t;
    }
    if (latestTime > 0) return latestTime;
    if (b.last_read) {
      const t = new Date(b.last_read).getTime();
      if (!isNaN(t) && t > 0) return t;
    }
    if (b.updated_at) {
      const t = new Date(b.updated_at).getTime();
      if (!isNaN(t) && t > 0) return t;
    }
    if (b.date_added) {
      const t = new Date(b.date_added).getTime();
      if (!isNaN(t) && t > 0) return t;
    }
    return 0;
  }

  const inProgressBooks = booksToSearch.filter(b => b.status === 'In Progress');
  const candidateBooks = inProgressBooks.length > 0 ? [...inProgressBooks] : [...booksToSearch];

  candidateBooks.sort((a, b) => getBookLastActivity(b) - getBookLastActivity(a));

  const book = candidateBooks[0];
  if (!book) return null;

  const activeLogs = logsToSearch.filter(l => doesLogMatchBook(l, book));
  const totalPages = Math.max(1, Number(book.total_pages) || 1);

  // Progress calculations
  let currentPage = 0;
  if (activeLogs.length > 0) {
    const maxEnd = Math.max(...activeLogs.map(l => {
      const end = parseInt(l.end_page || 0, 10);
      const pages = parseInt(l.pages_read || 0, 10);
      return Math.max(end, pages);
    }));
    const bookPagesRead = parseInt(book.pages_read || 0, 10);
    const bookCurrentPage = parseInt(book.current_page || 0, 10);
    const rawPage = Math.max(maxEnd, bookPagesRead, bookCurrentPage);
    currentPage = (totalPages > 0 && rawPage > totalPages) ? (rawPage % totalPages === 0 ? totalPages : rawPage % totalPages) : rawPage;
  } else {
    const bookPagesRead = parseInt(book.pages_read || 0, 10);
    const bookCurrentPage = parseInt(book.current_page || 0, 10);
    currentPage = Math.max(bookPagesRead, bookCurrentPage);
  }

  currentPage = Math.min(totalPages, Math.max(0, currentPage));
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
    .sort((a, b) => getLogTimestamp(b) - getLogTimestamp(a));

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

export const VAPID_KEYS = {
  publicKey: process.env.VAPID_PUBLIC_KEY || "BKTwspEAyTyd-h-CX0RtwUDm6MV4KgJRtkz_56uHP-jvf4hbIS_7JK4jRZCKdk7-CpiTpqVBkYemwJMvWgcuTuY",
  get privateKey() {
    return process.env.VAPID_PRIVATE_KEY || "Lrjsh4YBDNcI2QESraS8SOL5mSVE0t_CimawlBjZWOs";
  },
  subject: process.env.VAPID_SUBJECT || "mailto:support@readingtracker.app"
};

export function formatWebPushNotificationPayload(reminderPayload) {
  if (!reminderPayload) return null;
  return {
    title: reminderPayload.title,
    body: reminderPayload.body,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: 'daily-reading-reminder',
    data: {
      url: `/#book-${reminderPayload.bookId || ''}`,
      timestamp: Date.now()
    }
  };
}

export function validatePushSubscription(subscription) {
  if (!subscription || typeof subscription !== 'object') return false;
  if (typeof subscription.endpoint !== 'string' || !subscription.endpoint.startsWith('http')) return false;
  if (!subscription.keys || typeof subscription.keys.p256dh !== 'string' || typeof subscription.keys.auth !== 'string') return false;
  return true;
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

