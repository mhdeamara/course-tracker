// Supabase Edge Function "ai" — entry point. The logic is in handler.ts.
//
// Secrets and settings it reads (none of them are in the code or in git):
//   ANTHROPIC_API_KEY          you set it: Supabase → Edge Functions → Secrets (see README)
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY   set by Supabase automatically for every function.
//     The service-role key is used only to run ai_begin / ai_finish (usage counters you cannot change yourself).
import Anthropic from 'npm:@anthropic-ai/sdk@1.14.0';
import { handle, type Claude } from './handler.ts';

const apiKey = Deno.env.get('ANTHROPIC_API_KEY') || '';
const client = apiKey ? new Anthropic({ apiKey, maxRetries: 1, timeout: 90_000 }) : null;

/** The Claude client, with the SDK's typed errors turned into short codes (most specific first). */
const claude: Claude | null = client ? {
  async create(params) {
    try {
      // deno-lint-ignore no-explicit-any
      return await client.messages.create(params as any) as any;
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw { aiError: 'ai-key' };
      if (e instanceof Anthropic.RateLimitError) throw { aiError: 'ai-busy' };
      if (e instanceof Anthropic.BadRequestError) throw { aiError: 'ai-bad-request' };
      if (e instanceof Anthropic.APIConnectionError) throw { aiError: 'ai-down' };
      if (e instanceof Anthropic.APIError) throw { aiError: 'ai-down' };
      throw e;
    }
  },
} : null;

Deno.serve((req) => handle(req, {
  url: Deno.env.get('SUPABASE_URL') || '',
  anonKey: Deno.env.get('SUPABASE_ANON_KEY') || '',
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
}, { fetch, claude }));
