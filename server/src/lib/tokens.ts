import { createHash, randomBytes } from "node:crypto";

/** 256-bit URL-safe random token. */
export const randomToken = () => randomBytes(32).toString("base64url");

/** Tokens are stored hashed so a database leak can't be replayed as live sessions or links. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
