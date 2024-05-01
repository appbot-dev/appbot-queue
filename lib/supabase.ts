import { createClient } from 'supabase';
import { Database } from './database.types.ts';

export const supabaseServiceRole = createClient<Database>(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);
