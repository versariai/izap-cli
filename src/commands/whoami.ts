import { assertNoArgs } from "../args.js";
import { createApiClient, resolveCredential, type CredentialSource } from "../auth.js";
import { fields } from "../format.js";
import type { Command } from "./types.js";

const CREDENTIAL_LABELS: Record<CredentialSource, string> = {
  env: "IZAP_TOKEN environment variable",
  token: "saved token",
  oauth: "browser login",
};

export const whoami: Command = {
  name: "whoami",
  summary: "Show who the current credential belongs to",
  flags: [],
  help: `Usage: izap whoami [--profile <name>] [--json]

Checks the current credential against the API (GET /api/v1/auth/token/introspect)
and shows the user, business and token it resolves to. The token itself is never
printed.`,

  async run(ctx, args) {
    assertNoArgs(args, "whoami");
    const credential = await resolveCredential(ctx);
    const izap = createApiClient(ctx, credential.token);
    const { data: principal } = await izap.introspectToken();
    const businessId = ctx.businessId ?? principal.business_id ?? null;

    if (ctx.out.json) {
      ctx.out.data({
        profile: ctx.profileName,
        baseUrl: ctx.baseUrl,
        credential: credential.source,
        businessId,
        principal,
      });
      return;
    }
    ctx.out.line(
      fields([
        ["Profile", ctx.profileName],
        ["API", ctx.baseUrl],
        ["Credential", CREDENTIAL_LABELS[credential.source]],
        ["Principal", principal.kind],
        ["User ID", principal.user_id],
        ["Token ID", principal.token_id],
        ["Business", businessId ?? "none selected (pass --business <id> or set IZAP_BUSINESS_ID)"],
      ]),
    );
  },
};
