export function nowUTC(): string {
  return new Date().toISOString();
}

export function nowMs(): number {
  return Date.now();
}

export function isWeekendLowLiquidity(): boolean {
  const now = new Date();
  const day = now.getUTCDay();
  const hour = now.getUTCHours();

  // Friday 22:00 UTC - Monday 06:00 UTC
  if (day === 5 && hour >= 22) return true;
  if (day === 6) return true;
  if (day === 0) return true;
  if (day === 1 && hour < 6) return true;
  return false;
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function todayUTC(): string {
  return new Date().toISOString().split('T')[0]!;
}
