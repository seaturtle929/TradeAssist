// Presentation only: preserve legacy records while giving an absent outcome a clear label.
export function callOutcomeLabel(outcome?: string | null): string {
  return !outcome?.trim() || outcome.trim().toLowerCase() === 'unrated'
    ? 'Outcome not recorded'
    : outcome;
}
