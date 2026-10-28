import { createBrowserClient } from "@supabase/ssr";
import { COOKIE_DOMAIN } from "../../lib/hosts";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const createClient = () => createBrowserClient(supabaseUrl!, supabaseKey!, COOKIE_DOMAIN ? { cookieOptions: { domain: COOKIE_DOMAIN } } : undefined);
