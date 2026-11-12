import { hash, verify } from "@node-rs/argon2";

// OWASP-recommended argon2id parameters (19 MiB, 2 iterations).
const options = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password: string) => hash(password, options);
export const verifyPassword = (passwordHash: string, password: string) => verify(passwordHash, password);
