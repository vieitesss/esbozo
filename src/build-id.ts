type GitAnswer = (args: readonly string[]) => string | null;

export function buildId(git: GitAnswer): string {
  const commit = git(['rev-parse', '--short', 'HEAD'])?.trim() ?? '';
  if (commit === '') {
    return 'unknown';
  }
  const changes = git(['status', '--porcelain']);
  if (changes === null) {
    return 'unknown';
  }
  return changes.trim() === '' ? commit : `${commit}-dirty`;
}

export function buildTime(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
