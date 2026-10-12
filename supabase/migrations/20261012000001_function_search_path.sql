-- Pin the search_path of trigger functions so they always resolve the intended tables
-- (Supabase advisor: function_search_path_mutable). Security-definer helpers already set it.
alter function app.prevent_ledger_mutation() set search_path = public;
alter function app.check_bom_cycle() set search_path = public;
alter function app.check_journal_balanced() set search_path = public;
