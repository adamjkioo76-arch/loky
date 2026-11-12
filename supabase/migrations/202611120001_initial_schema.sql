create extension if not exists pgcrypto;

create type public.transaction_kind as enum (
  'income',
  'expense',
  'savings_deposit',
  'savings_withdrawal',
  'transfer'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  currency text not null default 'EGP' check (currency ~ '^[A-Z]{3}$'),
  locale text not null default 'ar' check (locale in ('ar', 'en')),
  theme text not null default 'dark' check (theme in ('dark', 'light')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  color text not null default '#f44067' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  icon text not null default 'wallet',
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  kind text not null check (kind in ('income', 'expense')),
  color text not null default '#f44067' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, name, kind)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id uuid not null,
  category_id uuid,
  kind public.transaction_kind not null,
  amount_minor bigint not null check (amount_minor between 1 and 9007199254740991),
  transaction_date date not null default current_date,
  description text not null default '' check (length(description) <= 240),
  notes text not null default '' check (length(notes) <= 2000),
  transfer_group_id uuid,
  idempotency_key text,
  created_at timestamptz not null default now(),
  foreign key (account_id, user_id) references public.accounts(id, user_id) on delete restrict,
  foreign key (category_id, user_id) references public.categories(id, user_id) on delete restrict,
  check ((kind = 'transfer') = (transfer_group_id is not null)),
  check (idempotency_key is null or length(idempotency_key) between 8 and 120),
  unique (user_id, idempotency_key)
);

create index transactions_user_date_idx on public.transactions(user_id, transaction_date desc);
create index transactions_user_account_date_idx on public.transactions(user_id, account_id, transaction_date desc);
create index transactions_user_category_date_idx on public.transactions(user_id, category_id, transaction_date desc);
create index accounts_user_idx on public.accounts(user_id);
create index categories_user_kind_idx on public.categories(user_id, kind);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  amount_minor bigint not null check (amount_minor between 1 and 9007199254740991),
  period text not null default 'monthly' check (period in ('weekly', 'monthly', 'custom')),
  starts_on date not null default current_date,
  ends_on date,
  alert_thresholds integer[] not null default array[50, 75, 90, 100],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on),
  check (cardinality(alert_thresholds) between 1 and 10),
  check (array_position(alert_thresholds, null) is null and 0 < all(alert_thresholds) and 100 >= all(alert_thresholds)),
  unique (id, user_id)
);

create table public.budget_categories (
  budget_id uuid not null references public.budgets(id) on delete cascade,
  category_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  primary key (budget_id, category_id),
  foreign key (budget_id, user_id) references public.budgets(id, user_id) on delete cascade,
  foreign key (category_id, user_id) references public.categories(id, user_id) on delete cascade
);

create table public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  target_minor bigint not null check (target_minor between 1 and 9007199254740991),
  saved_minor bigint not null default 0 check (saved_minor between 0 and 9007199254740991),
  target_date date,
  icon text not null default 'target',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.salary_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  salary_minor bigint not null default 0 check (salary_minor between 0 and 9007199254740991),
  pay_day smallint check (pay_day between 1 and 31),
  cycle_days smallint not null default 30 check (cycle_days between 1 and 366),
  auto_save_enabled boolean not null default false,
  auto_save_percent smallint not null default 100 check (auto_save_percent between 1 and 100),
  savings_account_id uuid,
  updated_at timestamptz not null default now(),
  foreign key (savings_account_id, user_id) references public.accounts(id, user_id) on delete restrict
);

create table public.salary_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  income_minor bigint not null check (income_minor between 0 and 9007199254740991),
  income_transaction_id uuid references public.transactions(id) on delete set null,
  finalized_at timestamptz,
  savings_transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  unique (user_id, starts_on, ends_on)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (length(title) between 1 and 120),
  body text not null default '' check (length(body) <= 1000),
  kind text not null check (kind in ('transaction', 'budget', 'salary', 'savings', 'system')),
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create table public.automation_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  operation text not null,
  idempotency_key text not null,
  status text not null check (status in ('succeeded', 'skipped', 'failed')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index notifications_user_created_idx on public.notifications(user_id, created_at desc);
create index budgets_user_dates_idx on public.budgets(user_id, starts_on, ends_on);
create index goals_user_idx on public.savings_goals(user_id, target_date);
create index salary_cycles_user_dates_idx on public.salary_cycles(user_id, starts_on, ends_on);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger preferences_updated_at before update on public.user_preferences
for each row execute function public.set_updated_at();
create trigger accounts_updated_at before update on public.accounts
for each row execute function public.set_updated_at();
create trigger budgets_updated_at before update on public.budgets
for each row execute function public.set_updated_at();
create trigger goals_updated_at before update on public.savings_goals
for each row execute function public.set_updated_at();
create trigger salary_settings_updated_at before update on public.salary_settings
for each row execute function public.set_updated_at();

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  insert into public.user_preferences (user_id) values (new.id);
  insert into public.salary_settings (user_id) values (new.id);
  insert into public.accounts (user_id, name, color, icon)
  values (new.id, 'الحساب الرئيسي', '#f44067', 'wallet');
  insert into public.categories (user_id, name, kind, color, is_default)
  values
    (new.id, 'الراتب', 'income', '#42d6a0', true),
    (new.id, 'دخل إضافي', 'income', '#568eff', true),
    (new.id, 'الطعام', 'expense', '#ff875c', true),
    (new.id, 'المواصلات', 'expense', '#568eff', true),
    (new.id, 'السكن', 'expense', '#a875ff', true),
    (new.id, 'الفواتير', 'expense', '#ff304f', true),
    (new.id, 'الصحة', 'expense', '#42d6a0', true),
    (new.id, 'التسوق', 'expense', '#ff875c', true),
    (new.id, 'أخرى', 'expense', '#98a4ba', true);
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create function public.prevent_negative_account_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance bigint;
  v_archived boolean;
begin
  select is_archived into v_archived from public.accounts
  where id = new.account_id and user_id = new.user_id
  for update;
  if not found or v_archived then raise exception 'account is unavailable'; end if;
  if new.kind not in ('expense', 'savings_withdrawal')
     and not (new.kind = 'transfer' and new.description like '[تحويل صادر]%') then
    return new;
  end if;
  perform 1 from public.accounts
  where id = new.account_id and user_id = new.user_id
  for update;
  if not found then raise exception 'account not found'; end if;
  select coalesce(sum(
    case
      when kind = 'income' then amount_minor
      when kind = 'savings_deposit' then amount_minor
      when kind in ('expense', 'savings_withdrawal') then -amount_minor
      when kind = 'transfer' and description like '[تحويل وارد]%' then amount_minor
      when kind = 'transfer' and description like '[تحويل صادر]%' then -amount_minor
      else 0
    end
  ), 0)::bigint into v_balance
  from public.transactions
  where user_id = new.user_id and account_id = new.account_id and id is distinct from new.id;
  if v_balance < new.amount_minor then raise exception 'insufficient funds'; end if;
  return new;
end;
$$;

create trigger transactions_prevent_negative
before insert or update of account_id, kind, amount_minor, description on public.transactions
for each row execute function public.prevent_negative_account_balance();

create function public.validate_transaction_category()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_category_kind text;
begin
  if new.category_id is null then return new; end if;
  select kind into v_category_kind from public.categories
  where id = new.category_id and user_id = new.user_id;
  if not found then raise exception 'category not found'; end if;
  if (v_category_kind = 'income') <> (new.kind = 'income') then
    raise exception 'category type does not match transaction type';
  end if;
  return new;
end;
$$;

create trigger transactions_validate_category
before insert or update of category_id, kind on public.transactions
for each row execute function public.validate_transaction_category();

create view public.account_balances
with (security_invoker = true)
as
select
  a.id as account_id,
  a.user_id,
  a.name,
  a.color,
  a.icon,
  a.is_archived,
  coalesce(sum(
    case
      when t.kind = 'income' then t.amount_minor
      when t.kind = 'savings_deposit' then t.amount_minor
      when t.kind in ('expense', 'savings_withdrawal') then -t.amount_minor
      when t.kind = 'transfer' and t.description like '[تحويل وارد]%' then t.amount_minor
      when t.kind = 'transfer' and t.description like '[تحويل صادر]%' then -t.amount_minor
      else 0
    end
  ), 0)::bigint as balance_minor
from public.accounts a
left join public.transactions t on t.account_id = a.id and t.user_id = a.user_id
group by a.id;

create function public.transfer_between_accounts(
  p_from_account uuid,
  p_to_account uuid,
  p_amount_minor bigint,
  p_transfer_date date,
  p_description text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_group_id uuid;
  v_existing uuid;
  v_available bigint;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if p_from_account = p_to_account then raise exception 'accounts must differ'; end if;
  if p_amount_minor is null or p_amount_minor <= 0 then raise exception 'amount must be positive'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 120 then
    raise exception 'valid idempotency key required';
  end if;

  select transfer_group_id into v_existing
  from public.transactions
  where user_id = v_user_id and idempotency_key = p_idempotency_key;
  if v_existing is not null then
    if not exists (
      select 1 from public.transactions
      where user_id = v_user_id and transfer_group_id = v_existing and account_id = p_from_account
        and kind = 'transfer' and amount_minor = p_amount_minor
        and description = '[تحويل صادر] ' || left(coalesce(p_description, ''), 200)
        and (p_transfer_date is null or transaction_date = p_transfer_date)
    ) or not exists (
      select 1 from public.transactions
      where user_id = v_user_id and transfer_group_id = v_existing and account_id = p_to_account
        and kind = 'transfer' and amount_minor = p_amount_minor
        and description = '[تحويل وارد] ' || left(coalesce(p_description, ''), 200)
        and (p_transfer_date is null or transaction_date = p_transfer_date)
    ) then
      raise exception 'idempotency key was already used for a different transfer';
    end if;
    return v_existing;
  end if;

  perform 1 from public.accounts
  where user_id = v_user_id and id in (p_from_account, p_to_account) and not is_archived
  order by id for update;
  if (select count(*) from public.accounts
      where user_id = v_user_id and id in (p_from_account, p_to_account) and not is_archived) <> 2 then
    raise exception 'account not found';
  end if;
  select transfer_group_id into v_existing
  from public.transactions
  where user_id = v_user_id and idempotency_key = p_idempotency_key;
  if v_existing is not null then
    if not exists (
      select 1 from public.transactions
      where user_id = v_user_id and transfer_group_id = v_existing and account_id = p_from_account
        and kind = 'transfer' and amount_minor = p_amount_minor
        and description = '[تحويل صادر] ' || left(coalesce(p_description, ''), 200)
        and (p_transfer_date is null or transaction_date = p_transfer_date)
    ) or not exists (
      select 1 from public.transactions
      where user_id = v_user_id and transfer_group_id = v_existing and account_id = p_to_account
        and kind = 'transfer' and amount_minor = p_amount_minor
        and description = '[تحويل وارد] ' || left(coalesce(p_description, ''), 200)
        and (p_transfer_date is null or transaction_date = p_transfer_date)
    ) then
      raise exception 'idempotency key was already used for a different transfer';
    end if;
    return v_existing;
  end if;

  select coalesce(sum(
    case
      when kind = 'income' then amount_minor
      when kind in ('expense', 'savings_withdrawal') then -amount_minor
      when kind = 'savings_deposit' then amount_minor
      when kind = 'transfer' and description like '[تحويل وارد]%' then amount_minor
      when kind = 'transfer' and description like '[تحويل صادر]%' then -amount_minor
      else 0
    end
  ), 0)::bigint into v_available
  from public.transactions
  where user_id = v_user_id and account_id = p_from_account;
  if v_available < p_amount_minor then raise exception 'insufficient funds'; end if;

  v_group_id := gen_random_uuid();
  insert into public.transactions
    (user_id, account_id, kind, amount_minor, transaction_date, description, transfer_group_id, idempotency_key)
  values
    (v_user_id, p_from_account, 'transfer', p_amount_minor, coalesce(p_transfer_date, current_date),
     '[تحويل صادر] ' || left(coalesce(p_description, ''), 200), v_group_id, p_idempotency_key),
    (v_user_id, p_to_account, 'transfer', p_amount_minor, coalesce(p_transfer_date, current_date),
     '[تحويل وارد] ' || left(coalesce(p_description, ''), 200), v_group_id, null);
  return v_group_id;
end;
$$;

create function public.finalize_salary_cycle(
  p_cycle_id uuid,
  p_idempotency_key text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_cycle public.salary_cycles%rowtype;
  v_settings public.salary_settings%rowtype;
  v_spent bigint;
  v_saved bigint;
  v_surplus bigint;
  v_savings_transaction_id uuid;
  v_income_account_id uuid;
  v_transfer_group_id uuid;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 120 then
    raise exception 'valid idempotency key required';
  end if;

  select * into v_cycle from public.salary_cycles
  where id = p_cycle_id and user_id = v_user_id for update;
  if not found then raise exception 'salary cycle not found'; end if;
  if v_cycle.finalized_at is not null then return 0; end if;
  if v_cycle.ends_on > current_date then raise exception 'salary cycle has not ended'; end if;
  select * into v_settings from public.salary_settings
  where user_id = v_user_id for update;
  if not found or not v_settings.auto_save_enabled then
    update public.salary_cycles set finalized_at = now() where id = v_cycle.id;
    insert into public.automation_logs (user_id, operation, idempotency_key, status, details)
    values (v_user_id, 'salary_cycle', p_idempotency_key, 'skipped',
            jsonb_build_object('reason', 'auto-save is disabled or target account is missing'))
    on conflict (user_id, idempotency_key) do nothing;
    return 0;
  end if;
  if v_settings.savings_account_id is null then raise exception 'choose a savings account before closing the cycle'; end if;

  select account_id into v_income_account_id
  from public.transactions
  where id = v_cycle.income_transaction_id and user_id = v_user_id and kind = 'income';
  if v_income_account_id is null or v_income_account_id = v_settings.savings_account_id then
    raise exception 'salary and savings accounts must be different';
  end if;
  perform 1 from public.accounts
  where user_id = v_user_id
  order by id for update;
  if (select count(*) from public.accounts
      where user_id = v_user_id and id in (v_income_account_id, v_settings.savings_account_id) and not is_archived) <> 2 then
    raise exception 'salary or savings account is unavailable';
  end if;

  select
    coalesce(sum(case when t.kind = 'expense' then t.amount_minor else 0 end), 0),
    coalesce(sum(case
      when t.kind = 'savings_deposit' then t.amount_minor
      when t.kind = 'transfer' and t.description like '[تحويل صادر]%' and exists (
        select 1
        from public.transactions incoming
        where incoming.user_id = t.user_id
          and incoming.transfer_group_id = t.transfer_group_id
          and incoming.account_id = v_settings.savings_account_id
          and incoming.kind = 'transfer'
          and incoming.description like '[تحويل وارد]%'
      ) then t.amount_minor
      else 0
    end), 0)
  into v_spent, v_saved
  from public.transactions t
  where t.user_id = v_user_id and t.transaction_date between v_cycle.starts_on and v_cycle.ends_on;

  v_surplus := greatest(v_cycle.income_minor - v_spent - v_saved, 0);
  v_surplus := (v_surplus * v_settings.auto_save_percent) / 100;
  if v_surplus > 0 then
    v_transfer_group_id := gen_random_uuid();
    insert into public.transactions
      (user_id, account_id, kind, amount_minor, transaction_date, description, transfer_group_id, idempotency_key)
    values
      (v_user_id, v_income_account_id, 'transfer', v_surplus, v_cycle.ends_on,
       '[تحويل صادر] ادخار تلقائي - فائض دورة الراتب', v_transfer_group_id, p_idempotency_key)
    returning id into v_savings_transaction_id;
    insert into public.transactions
      (user_id, account_id, kind, amount_minor, transaction_date, description, transfer_group_id)
    values
      (v_user_id, v_settings.savings_account_id, 'transfer', v_surplus, v_cycle.ends_on,
       '[تحويل وارد] ادخار تلقائي - فائض دورة الراتب', v_transfer_group_id);
    insert into public.notifications (user_id, title, body, kind)
    values (v_user_id, 'تم تحويل فائض الراتب للادخار',
            'تم إيداع ' || (v_surplus / 100.0)::numeric(14,2)::text || ' في حساب الادخار.', 'savings');
  end if;

  update public.salary_cycles
  set finalized_at = now(), savings_transaction_id = v_savings_transaction_id
  where id = v_cycle.id and finalized_at is null;
  insert into public.automation_logs (user_id, operation, idempotency_key, status, details)
  values (v_user_id, 'salary_cycle', p_idempotency_key, case when v_surplus > 0 then 'succeeded' else 'skipped' end,
          jsonb_build_object('amount_minor', v_surplus, 'spent_minor', v_spent, 'saved_minor', v_saved))
  on conflict (user_id, idempotency_key) do nothing;
  return v_surplus;
end;
$$;

create function public.record_salary_cycle(
  p_starts_on date,
  p_ends_on date,
  p_income_minor bigint,
  p_account_id uuid,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_cycle_id uuid;
  v_existing_cycle public.salary_cycles%rowtype;
  v_transaction_id uuid;
  v_category_id uuid;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 120 then
    raise exception 'valid idempotency key required';
  end if;
  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on or p_ends_on > current_date then
    raise exception 'invalid salary cycle dates';
  end if;
  if p_income_minor is null or p_income_minor <= 0 then raise exception 'income must be positive'; end if;
  if not exists (select 1 from public.accounts where id = p_account_id and user_id = v_user_id and not is_archived) then
    raise exception 'account not found';
  end if;
  if not exists (select 1 from public.salary_settings where user_id = v_user_id and enabled) then
    raise exception 'salary tracking is not enabled';
  end if;
  select * into v_existing_cycle from public.salary_cycles
  where user_id = v_user_id and starts_on = p_starts_on and ends_on = p_ends_on;
  if found then
    if v_existing_cycle.income_minor <> p_income_minor or not exists (
      select 1 from public.transactions
      where id = v_existing_cycle.income_transaction_id and user_id = v_user_id
        and account_id = p_account_id and amount_minor = p_income_minor
    ) then
      raise exception 'salary cycle already exists with different income details';
    end if;
    return v_existing_cycle.id;
  end if;

  insert into public.salary_cycles (user_id, starts_on, ends_on, income_minor)
  values (v_user_id, p_starts_on, p_ends_on, p_income_minor)
  returning id into v_cycle_id;
  select id into v_category_id from public.categories
  where user_id = v_user_id and kind = 'income' and name = 'الراتب'
  limit 1;
  perform 1 from public.accounts where user_id = v_user_id order by id for update;
  insert into public.transactions
    (user_id, account_id, category_id, kind, amount_minor, transaction_date, description, idempotency_key)
  values
    (v_user_id, p_account_id, v_category_id, 'income', p_income_minor, p_ends_on, 'راتب دورة مالية', p_idempotency_key)
  returning id into v_transaction_id;
  update public.salary_cycles set income_transaction_id = v_transaction_id where id = v_cycle_id;
  perform public.finalize_salary_cycle(v_cycle_id, left('salary-finalize:' || p_idempotency_key, 120));
  return v_cycle_id;
end;
$$;

create function public.contribute_to_savings_goal(
  p_goal_id uuid,
  p_from_account uuid,
  p_amount_minor bigint,
  p_transfer_date date,
  p_idempotency_key text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_goal public.savings_goals%rowtype;
  v_to_account uuid;
  v_group_id uuid := gen_random_uuid();
  v_new_saved bigint;
  v_existing public.transactions%rowtype;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 120 then
    raise exception 'valid idempotency key required';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then raise exception 'amount must be positive'; end if;
  select * into v_goal from public.savings_goals
  where id = p_goal_id and user_id = v_user_id for update;
  if not found then raise exception 'savings goal not found'; end if;
  if v_goal.saved_minor + p_amount_minor > v_goal.target_minor then raise exception 'contribution exceeds goal target'; end if;
  select savings_account_id into v_to_account from public.salary_settings where user_id = v_user_id;
  if v_to_account is null then raise exception 'choose a savings account in salary settings first'; end if;
  if p_from_account = v_to_account then raise exception 'source and savings accounts must differ'; end if;
  select * into v_existing from public.transactions
  where user_id = v_user_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.kind <> 'transfer' or v_existing.transfer_group_id is null
       or v_existing.account_id <> p_from_account or v_existing.amount_minor <> p_amount_minor
       or v_existing.description <> ('[تحويل صادر] ادخار هدف - ' || left(v_goal.name, 80))
       or not exists (
         select 1 from public.transactions incoming
         where incoming.user_id = v_user_id and incoming.transfer_group_id = v_existing.transfer_group_id
           and incoming.account_id = v_to_account and incoming.amount_minor = p_amount_minor
           and incoming.description = ('[تحويل وارد] ادخار هدف - ' || left(v_goal.name, 80))
           and (p_transfer_date is null or incoming.transaction_date = p_transfer_date)
       ) then
      raise exception 'idempotency key was already used for a different savings contribution';
    end if;
    return v_goal.saved_minor;
  end if;
  perform 1 from public.accounts
  where user_id = v_user_id and id in (p_from_account, v_to_account) and not is_archived
  order by id for update;
  if (select count(*) from public.accounts where user_id = v_user_id and id in (p_from_account, v_to_account) and not is_archived) <> 2 then
    raise exception 'account not found';
  end if;

  insert into public.transactions
    (user_id, account_id, kind, amount_minor, transaction_date, description, transfer_group_id, idempotency_key)
  values
    (v_user_id, p_from_account, 'transfer', p_amount_minor, coalesce(p_transfer_date, current_date),
     '[تحويل صادر] ادخار هدف - ' || left(v_goal.name, 80), v_group_id, p_idempotency_key),
    (v_user_id, v_to_account, 'transfer', p_amount_minor, coalesce(p_transfer_date, current_date),
     '[تحويل وارد] ادخار هدف - ' || left(v_goal.name, 80), v_group_id, null);
  update public.savings_goals
  set saved_minor = saved_minor + p_amount_minor
  where id = v_goal.id and user_id = v_user_id
  returning saved_minor into v_new_saved;
  insert into public.notifications (user_id, title, body, kind)
  values (v_user_id, 'تقدم جديد في هدف الادخار', 'تم تحديث هدف «' || v_goal.name || '».', 'savings');
  return v_new_saved;
end;
$$;

create function public.reset_financial_data(p_confirmation text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if p_confirmation <> 'RESET' then raise exception 'confirmation required'; end if;
  insert into public.audit_logs (user_id, action, details)
  values (v_user_id, 'financial_data_reset', jsonb_build_object('confirmed', true));
  delete from public.budgets where user_id = v_user_id;
  delete from public.savings_goals where user_id = v_user_id;
  delete from public.salary_cycles where user_id = v_user_id;
  delete from public.transactions where user_id = v_user_id;
  update public.salary_settings
  set savings_account_id = null, enabled = false, auto_save_enabled = false, salary_minor = 0, pay_day = null
  where user_id = v_user_id;
  delete from public.accounts where user_id = v_user_id;
  insert into public.accounts (user_id, name, color, icon)
  values (v_user_id, 'الحساب الرئيسي', '#f44067', 'wallet');
end;
$$;

create function public.notify_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_budget record;
  v_start date;
  v_end date;
  v_spent bigint;
  v_percent integer;
  v_threshold integer;
begin
  if new.kind = 'transfer' then return new; end if;
  insert into public.notifications (user_id, title, body, kind)
  values (
    new.user_id,
    case when new.kind = 'income' then 'تم تسجيل دخل جديد' else 'تم تسجيل معاملة جديدة' end,
    left(case when new.kind = 'income' then 'دخل بقيمة ' else 'معاملة بقيمة ' end || (new.amount_minor / 100.0)::numeric(14,2)::text, 1000),
    case when new.kind::text like 'savings_%' then 'savings' else 'transaction' end
  );

  if new.kind::text <> 'expense' then return new; end if;
  for v_budget in
    select b.*
    from public.budgets b
    where b.user_id = new.user_id
      and new.transaction_date >= b.starts_on
      and (b.ends_on is null or new.transaction_date <= b.ends_on)
      and (
        not exists (select 1 from public.budget_categories bc where bc.budget_id = b.id)
        or exists (select 1 from public.budget_categories bc where bc.budget_id = b.id and bc.category_id = new.category_id)
      )
  loop
    if v_budget.period = 'weekly' then
      v_start := greatest(v_budget.starts_on, new.transaction_date - (extract(isodow from new.transaction_date)::integer - 1));
      v_end := v_start + 6;
    elsif v_budget.period = 'monthly' then
      v_start := greatest(v_budget.starts_on, date_trunc('month', new.transaction_date)::date);
      v_end := (date_trunc('month', new.transaction_date) + interval '1 month')::date - 1;
    else
      v_start := v_budget.starts_on;
      v_end := coalesce(v_budget.ends_on, new.transaction_date);
    end if;
    select coalesce(sum(amount_minor), 0)::bigint into v_spent
    from public.transactions
    where user_id = new.user_id and kind = 'expense'
      and transaction_date between v_start and least(v_end, coalesce(v_budget.ends_on, v_end))
      and (
        not exists (select 1 from public.budget_categories bc where bc.budget_id = v_budget.id)
        or category_id in (select bc.category_id from public.budget_categories bc where bc.budget_id = v_budget.id)
      );
    v_percent := floor(v_spent::numeric * 100 / v_budget.amount_minor)::integer;
    foreach v_threshold in array v_budget.alert_thresholds loop
      if v_percent >= v_threshold then
        insert into public.notifications (user_id, title, body, kind, dedupe_key)
        values (
          new.user_id,
          case when v_percent >= 100 then 'تم تجاوز الميزانية' else 'تنبيه استخدام الميزانية' end,
          'استخدمت ' || v_percent::text || '% من «' || v_budget.name || '».',
          'budget',
          'budget:' || v_budget.id::text || ':' || v_threshold::text || ':' || v_start::text
        )
        on conflict (user_id, dedupe_key) do nothing;
      end if;
    end loop;
  end loop;
  return new;
end;
$$;

create trigger transaction_notifications after insert on public.transactions
for each row execute function public.notify_transaction();

alter table public.profiles enable row level security;
alter table public.user_preferences enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.budget_categories enable row level security;
alter table public.savings_goals enable row level security;
alter table public.salary_settings enable row level security;
alter table public.salary_cycles enable row level security;
alter table public.notifications enable row level security;
alter table public.automation_logs enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles select own" on public.profiles for select using (id = (select auth.uid()));
create policy "profiles update own" on public.profiles for update using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "preferences own" on public.user_preferences for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "accounts own" on public.accounts for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "categories own" on public.categories for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "transactions select own" on public.transactions for select using (user_id = (select auth.uid()));
create policy "transactions insert own non-transfer" on public.transactions for insert
with check (user_id = (select auth.uid()) and kind <> 'transfer' and idempotency_key is null);
create policy "transactions update own non-transfer" on public.transactions for update
using (
  user_id = (select auth.uid()) and kind <> 'transfer'
  and not exists (select 1 from public.salary_cycles sc where sc.income_transaction_id = transactions.id)
)
with check (
  user_id = (select auth.uid()) and kind <> 'transfer'
  and not exists (select 1 from public.salary_cycles sc where sc.income_transaction_id = transactions.id)
);
create policy "transactions delete own non-transfer" on public.transactions for delete
using (
  user_id = (select auth.uid()) and kind <> 'transfer'
  and not exists (select 1 from public.salary_cycles sc where sc.income_transaction_id = transactions.id)
);
create policy "budgets own" on public.budgets for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "budget categories own" on public.budget_categories for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "goals own" on public.savings_goals for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "salary settings own" on public.salary_settings for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "salary cycles select own" on public.salary_cycles for select using (user_id = (select auth.uid()));
create policy "notifications own" on public.notifications for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "automation logs select own" on public.automation_logs for select using (user_id = (select auth.uid()));
create policy "audit logs select own" on public.audit_logs for select using (user_id = (select auth.uid()));

revoke all on public.profiles, public.user_preferences, public.accounts, public.categories,
  public.transactions, public.budgets, public.budget_categories, public.savings_goals,
  public.salary_settings, public.salary_cycles, public.notifications, public.automation_logs,
  public.audit_logs, public.account_balances from public, anon, authenticated;

revoke all on function public.transfer_between_accounts(uuid, uuid, bigint, date, text, text) from public;
revoke all on function public.finalize_salary_cycle(uuid, text) from public;
revoke all on function public.record_salary_cycle(date, date, bigint, uuid, text) from public;
revoke all on function public.contribute_to_savings_goal(uuid, uuid, bigint, date, text) from public;
revoke all on function public.reset_financial_data(text) from public;
revoke all on function public.notify_transaction() from public;
revoke all on function public.prevent_negative_account_balance() from public;
grant execute on function public.transfer_between_accounts(uuid, uuid, bigint, date, text, text) to authenticated;
grant execute on function public.finalize_salary_cycle(uuid, text) to authenticated;
grant execute on function public.record_salary_cycle(date, date, bigint, uuid, text) to authenticated;
grant execute on function public.contribute_to_savings_goal(uuid, uuid, bigint, date, text) to authenticated;
grant execute on function public.reset_financial_data(text) to authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.user_preferences to authenticated;
grant select, insert, update, delete on public.accounts to authenticated;
grant select, insert, update, delete on public.categories to authenticated;
grant select, insert, update, delete on public.transactions to authenticated;
grant select, insert, update, delete on public.budgets to authenticated;
grant select, insert, update, delete on public.budget_categories to authenticated;
grant select, insert, delete on public.savings_goals to authenticated;
revoke update on public.savings_goals from public, anon, authenticated;
grant update (name, target_minor, target_date, icon) on public.savings_goals to authenticated;
grant select, insert, update, delete on public.salary_settings to authenticated;
grant select on public.salary_cycles to authenticated;
grant select, insert, update, delete on public.notifications to authenticated;
grant select on public.automation_logs, public.audit_logs to authenticated;
grant select on public.account_balances to authenticated;
