import { useId } from "react";
import { AlertTriangle, Check, Ear, X } from "lucide-react";
import "./buyer-audio-recovery.css";

export interface BuyerAudioRecoveryIssue {
  id: string;
  reason: string;
  message: string;
  repeatLine: string;
  attempt: number;
  at: number;
}

export interface BuyerAudioRecoveryProps {
  issue: BuyerAudioRecoveryIssue | null;
  onConfirm?: () => void;
  onDismiss?: () => void;
}

export function BuyerAudioRecovery({
  issue,
  onConfirm,
  onDismiss,
}: BuyerAudioRecoveryProps) {
  const titleId = useId();
  if (!issue) return null;

  const repeatedFailure = issue.attempt > 1;
  const repeatLine = issue.repeatLine.trim() || (
    repeatedFailure
      ? "Sorry, the audio is still unclear. Could you repeat that a little more slowly, please?"
      : "I didn’t catch that clearly. Could you repeat that, please?"
  );

  return (
    <section
      className="buyer-audio-recovery"
      role="alert"
      aria-atomic="true"
      aria-labelledby={titleId}
      lang="en"
      data-issue-id={issue.id}
    >
      <div className="buyer-audio-recovery-header">
        <AlertTriangle size={19} aria-hidden="true" />
        <h2 id={titleId}>
          {repeatedFailure ? "Still missing the buyer’s words" : "Buyer audio unclear"}
        </h2>
        {onDismiss && (
          <button
            type="button"
            className="buyer-audio-recovery-dismiss"
            aria-label="Dismiss buyer audio warning"
            onClick={onDismiss}
          >
            <X size={18} aria-hidden="true" />
          </button>
        )}
      </div>

      <p className="buyer-audio-recovery-message">{issue.message}</p>

      <div className="buyer-audio-recovery-script">
        <span className="buyer-audio-recovery-label">Say to the buyer</span>
        <p>{repeatLine}</p>
      </div>

      <div className="buyer-audio-recovery-listen">
        <Ear size={18} aria-hidden="true" />
        <p>
          <strong>Listen carefully to the repeated answer.</strong>{" "}
          Don’t rely on the transcript until you’ve confirmed what was said.
          {repeatedFailure && " Ask for a slower repeat and note any important numbers or terms yourself."}
        </p>
      </div>

      {onConfirm && (
        <button
          type="button"
          className="buyer-audio-recovery-confirm"
          onClick={onConfirm}
          title="Clear this warning when you understand the buyer. This does not change the transcript."
        >
          <Check size={16} aria-hidden="true" />
          I heard it clearly
        </button>
      )}
    </section>
  );
}
