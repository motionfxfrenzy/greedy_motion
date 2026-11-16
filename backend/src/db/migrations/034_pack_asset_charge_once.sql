-- A template picture is charged once per (user, project, picture key + attempt): the ledger refuses a second spend row with the same ref,
-- whatever the cause (a retried job, a restarted process, a duplicate message). The ref is "material:pack-asset:<project>:<picture>:<hash>|<pool>".
-- Rows that already repeat a ref (there should be none) keep their amount but get a "#dupN" suffix, so the index can be built.
update app.token_ledger t
   set ref = t.ref || '#dup' || d.rn
  from (
    select ctid as c, row_number() over (partition by user_id, ref order by created_at, ctid) as rn
      from app.token_ledger
     where kind = 'spend' and ref like 'material:pack-asset:%'
  ) d
 where t.ctid = d.c and d.rn > 1;

create unique index if not exists token_ledger_pack_asset_once
    on app.token_ledger (user_id, ref)
 where kind = 'spend' and ref like 'material:pack-asset:%';
