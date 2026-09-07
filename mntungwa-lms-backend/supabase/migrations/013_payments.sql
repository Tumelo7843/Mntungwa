-- ============================================================================
-- 013_payments.sql
--
-- INVOICE → PAYMENT SUBMITTED → PROOF UPLOADED → FINANCE REVIEW →
-- APPROVED/REJECTED → ENROLLMENT STATUS UPDATED
--
-- Replaces audit M-07/M-08, where approval was a single unaudited client-side
-- state flip and "proof of payment" was a boolean with no file. Also fixes
-- C-03 (invoices matched by learner display name) and C-04 (colliding invoice
-- numbers) by using real foreign keys and a transactional counter.
--
-- Architected so a gateway can be added later: payments.gateway_* columns and
-- the payment_events ledger are the integration seam. No gateway is wired now.
-- ============================================================================

create table invoices (
  id                uuid primary key default gen_random_uuid(),
  invoice_number    text not null unique,

  profile_id        uuid not null references profiles(id)    on delete restrict,
  enrollment_id     uuid references enrollments(id)          on delete set null,
  course_id         uuid references courses(id)              on delete set null,

  status            invoice_status not null default 'DRAFT',

  currency          text not null default 'ZAR',
  subtotal          numeric(12,2) not null default 0,
  vat_rate          numeric(5,4)  not null default 0.15,
  vat_amount        numeric(12,2) not null default 0,
  total             numeric(12,2) not null default 0,
  amount_paid       numeric(12,2) not null default 0,

  -- Installment support (the demo's four-payment plan).
  is_installment    boolean not null default false,
  installment_no    integer,
  installment_count integer,

  issued_at         timestamptz,
  due_at            timestamptz,
  paid_at           timestamptz,
  cancelled_at      timestamptz,

  description       text,
  notes             text,

  created_by        uuid references profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint invoices_amounts_positive check (subtotal >= 0 and vat_amount >= 0 and total >= 0 and amount_paid >= 0),
  constraint invoices_vat_range        check (vat_rate >= 0 and vat_rate < 1),
  constraint invoices_paid_not_over    check (amount_paid <= total + 0.01),
  constraint invoices_installment_sane check (
    (is_installment = false and installment_no is null and installment_count is null) or
    (is_installment = true  and installment_no is not null and installment_count is not null
      and installment_no between 1 and installment_count)
  ),
  constraint invoices_issued_has_date  check (status = 'DRAFT' or issued_at is not null),
  constraint invoices_paid_has_date    check (status <> 'PAID' or paid_at is not null)
);

create index invoices_profile_idx    on invoices (profile_id);
create index invoices_enrollment_idx on invoices (enrollment_id);
create index invoices_status_idx     on invoices (status);
create index invoices_outstanding_idx on invoices (due_at) where status in ('ISSUED','PARTIALLY_PAID','OVERDUE');

create trigger invoices_set_updated_at
  before update on invoices
  for each row execute function app.set_updated_at();

comment on column invoices.profile_id is
  'Real foreign key. The demo matched invoices to learners by display-name string, which corrupted billing for duplicate names (audit C-03).';

-- Per-year invoice counter (fixes audit C-04).
create table invoice_sequences (
  year        integer primary key,
  last_number integer not null default 0,
  constraint invoice_sequences_number_sane check (last_number >= 0)
);

-- ----------------------------------------------------------------------------
-- payments
-- ----------------------------------------------------------------------------
create table payments (
  id                uuid primary key default gen_random_uuid(),
  invoice_id        uuid not null references invoices(id) on delete cascade,
  profile_id        uuid not null references profiles(id) on delete restrict,
  enrollment_id     uuid references enrollments(id) on delete set null,

  status            payment_status not null default 'SUBMITTED',
  method            payment_method not null default 'EFT',

  currency          text not null default 'ZAR',
  amount            numeric(12,2) not null,
  reference         text,
  paid_on           date,

  submitted_at      timestamptz not null default now(),
  reviewed_at       timestamptz,
  reviewed_by       uuid references profiles(id) on delete set null,
  rejection_reason  text,

  -- Gateway integration seam. Unused until a provider is configured.
  gateway_provider     text,
  gateway_reference    text,
  gateway_status       text,
  gateway_payload      jsonb,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint payments_amount_positive check (amount > 0),
  constraint payments_reviewed_consistent check (
    (status in ('SUBMITTED','UNDER_REVIEW') and reviewed_at is null) or
    (status in ('APPROVED','REJECTED')      and reviewed_at is not null)
  ),
  constraint payments_rejection_has_reason check (
    status <> 'REJECTED' or (rejection_reason is not null and length(btrim(rejection_reason)) > 0)
  )
);

create index payments_invoice_idx  on payments (invoice_id);
create index payments_profile_idx  on payments (profile_id);
create index payments_queue_idx    on payments (status, submitted_at)
  where status in ('SUBMITTED','UNDER_REVIEW');

create trigger payments_set_updated_at
  before update on payments
  for each row execute function app.set_updated_at();

comment on index payments_queue_idx is 'Backs the finance review queue.';
comment on constraint payments_rejection_has_reason on payments is
  'A rejection must carry a reason the learner can act on.';

-- ----------------------------------------------------------------------------
-- payment_proofs — real uploaded evidence (fixes audit M-08)
-- ----------------------------------------------------------------------------
create table payment_proofs (
  id               uuid primary key default gen_random_uuid(),
  payment_id       uuid not null references payments(id) on delete cascade,

  storage_bucket   text not null default 'payment-proofs',
  storage_path     text not null,
  file_name        text not null,
  mime_type        text not null,
  file_size_bytes  bigint not null,

  uploaded_by      uuid references profiles(id) on delete set null,
  uploaded_at      timestamptz not null default now(),

  constraint payment_proofs_size_positive check (file_size_bytes > 0),
  constraint payment_proofs_unique_path unique (storage_bucket, storage_path)
);

create index payment_proofs_payment_idx on payment_proofs (payment_id);

-- ----------------------------------------------------------------------------
-- payment_events — append-only ledger
-- ----------------------------------------------------------------------------
create table payment_events (
  id            uuid primary key default gen_random_uuid(),
  payment_id    uuid references payments(id) on delete cascade,
  invoice_id    uuid references invoices(id) on delete cascade,

  event_type    text not null,
  from_status   text,
  to_status     text,
  amount        numeric(12,2),
  actor_id      uuid references profiles(id) on delete set null,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),

  constraint payment_events_type_not_blank check (length(btrim(event_type)) > 0),
  constraint payment_events_has_target check (payment_id is not null or invoice_id is not null)
);

create index payment_events_payment_idx on payment_events (payment_id, created_at desc);
create index payment_events_invoice_idx on payment_events (invoice_id, created_at desc);

comment on table payment_events is
  'Append-only financial ledger. Never updated or deleted; RLS grants no UPDATE/DELETE to any role.';
