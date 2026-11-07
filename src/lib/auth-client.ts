// Owns: the browser-side better-auth client (sign in, sign out, session). Not here: sign-up, which goes through src/server/sign-up-fn.ts so the browser never sends an email.

import { usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({ plugins: [usernameClient()] });
