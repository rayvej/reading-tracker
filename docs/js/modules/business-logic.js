/**
 * Standalone Core Business Logic Module (business-logic.js)
 * High-performance pure calculation helpers for reading metrics, pace estimation, and status rules.
 */

export function calculateBookProgress(currentPage, totalPages) {
  const current = Math.max(0, Number(currentPage) || 0);
  const total = Math.max(1, Number(totalPages) || 1);
  const remaining = Math.max(0, total - current);
  const percentage = Math.min(100, Math.round((current / total) * 100));

  return {
    current,
    total,
    remaining,
    percentage,
    isComplete: current >= total
  };
}

export function determineBookStatus(currentPage, totalPages, readCount = 0) {
  const current = Math.max(0, Number(currentPage) || 0);
  const total = Math.max(1, Number(totalPages) || 1);
  const count = Math.max(0, Number(readCount) || 0);

  if (count > 0 || current >= total) {
    return 'Finished';
  }
  if (current > 0) {
    return 'In Progress';
  }
  return 'Not Started';
}

export function formatReadingTime(minutesSpent) {
  const mins = Math.max(0, Math.round(Number(minutesSpent) || 0));
  if (mins === 0) return '0m';
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;

  if (hours > 0 && remainingMins > 0) {
    return `${hours}h ${remainingMins}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${remainingMins}m`;
}

export function calculateReadingPace(pagesRead, durationMinutes) {
  const pages = Math.max(0, Number(pagesRead) || 0);
  const mins = Math.max(0, Number(durationMinutes) || 0);

  if (pages === 0 || mins === 0) return 0;
  const hours = mins / 60;
  return Math.round(pages / hours);
}

export function estimateCompletionDays(remainingPages, pagesPerDay = 25) {
  const pages = Math.max(0, Number(remainingPages) || 0);
  const pace = Math.max(1, Number(pagesPerDay) || 25);
  if (pages === 0) return 0;
  return Math.ceil(pages / pace);
}
