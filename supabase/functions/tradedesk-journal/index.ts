import postgres from 'npm:postgres@3.4.8';
import { journalHandler } from './core.mjs';
// The database credential stays inside Supabase. It is never sent to Netlify or the browser.
const sql=postgres(Deno.env.get('SUPABASE_DB_URL')!,{max:1,prepare:false,connect_timeout:8,idle_timeout:10});
const adapt=(connection:any):any=>({
  query:async(text:string,values:unknown[])=>await connection.unsafe(text,values),
  transaction:async(fn:any)=>await connection.begin((tx:any)=>fn(adapt(tx)))
});
Deno.serve(journalHandler(adapt(sql)));
