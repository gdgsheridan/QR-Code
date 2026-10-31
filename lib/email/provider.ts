export interface InlineImage {
  cid: string;
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  inlineImages: InlineImage[];
  idempotencyKey: string;
  /**
   * Readable name for dev artifacts, e.g. "Demo-Hack-Day-Zoe" (see toFileLabel). Only the console
   * provider uses it, to name the QR image it saves. Real providers must never send it anywhere.
   */
  fileLabel?: string;
}

export interface EmailProvider {
  readonly name: string;
  /** v0.11.26: leave the outbox alone. A console provider on a shared (deployed) database would mark real
   *  emails sent without sending them; held, they stay queued for the deployed app's drainer. */
  readonly holdQueue?: boolean;
  send(message: EmailMessage): Promise<{ id: string }>;
}

// Thrown by providers for delivery failures. `message` must never contain recipient data.
export class ProviderError extends Error {
  override readonly name = 'ProviderError';
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}
