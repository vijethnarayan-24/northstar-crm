import type { FastifyBaseLogger } from "fastify";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/**
 * Used until an email provider is configured. In development it prints the whole message
 * (including invite/reset links) so you can click through. In production it never logs the
 * body: those links grant account access, and logs are often readable by more people than
 * the accounts themselves. Admins share invite links from the UI instead.
 */
export const createLogMailer = (log: FastifyBaseLogger, options: { includeBody: boolean }): Mailer => ({
  async send(mail) {
    if (!options.includeBody) {
      log.warn({ mail: { to: mail.to, subject: mail.subject } }, "Email not sent: no email provider is configured");
      return;
    }
    log.info({ mail: { to: mail.to, subject: mail.subject } }, `\n--- email (not sent: no provider configured) ---\nTo: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n------------------------------------------------`);
  },
});

/** Test mailer that records messages. */
export const createMemoryMailer = () => {
  const sent: Mail[] = [];
  return { sent, async send(mail: Mail) { sent.push(mail); } } satisfies Mailer & { sent: Mail[] };
};
