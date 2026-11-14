import { createClient } from '@supabase/supabase-js';

// Replace these with your actual Supabase Project URL and Anon/Public Key from your Supabase dashboard
const SUPABASE_URL = 'https://igmoxpyewymclghvckar.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_kVfqNuDQQdmwnrzhHgBEoA_-8GS1KZ9';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);