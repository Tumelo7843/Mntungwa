-- ============================================================================
-- seed.sql
--
-- Development and acceptance-test seed for Mntungwa LMS.
--
-- Carries forward the demo's real curriculum content (audit §5): the QCTO
-- Occupational Certificate: Project Manager, SAQA 101869, NQF 5, 240 credits,
-- 28 modules across KM/PM/WM, and the 12 genuine MCQs from QUIZ_BANK.
--
-- WHAT IS DIFFERENT FROM THE DEMO SEED
--   * No passwords. Auth users are created through Supabase Auth (see the
--     block at the end); this file never stores a credential (audit S-01).
--   * No RSA ID numbers (audit S-07). id_number is left null.
--   * Answer keys live in formative_options.is_correct, which no learner can
--     read (audit S-03).
--   * The strict linear chain KM-01 → … → WM-04 is expressed as explicit
--     prerequisite rows, not a hard-coded array (decision D-02).
--
-- Safe to run repeatedly: every insert is idempotent on a natural key.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Institution
-- ----------------------------------------------------------------------------
insert into institution (id, name, legal_name, accreditation_body, email, phone,
                         city, province, country, accent_color)
values (
  '00000000-0000-0000-0000-000000000001',
  'Mntungwa IT Solution',
  'Mntungwa IT Solution (Pty) Ltd',
  'QCTO',
  'info@mntungwa.co.za',
  '+27 11 000 0000',
  'Johannesburg', 'Gauteng', 'South Africa',
  '#1a396b'
)
on conflict (singleton) do update
  set name = excluded.name, accent_color = excluded.accent_color;

insert into institution_settings (
  institution_id, default_pass_mark, min_cohort_size,
  certificate_prefix, certificate_signatory_name, certificate_signatory_title,
  currency, vat_rate
)
select id, 50.00, 15, 'MIS', 'N. Dlamini', 'Head Facilitator & Assessor', 'ZAR', 0.1500
  from institution
on conflict (institution_id) do nothing;

-- ----------------------------------------------------------------------------
-- Cohorts (retained from the demo — audit §8.1)
-- ----------------------------------------------------------------------------
insert into cohorts (code, name, start_date, is_active) values
  ('PM-2026A', 'PM-2026 Cohort A', '2026-02-03', true),
  ('PM-2026B', 'PM-2026 Cohort B', '2026-08-03', true)
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------
-- Course
-- ----------------------------------------------------------------------------
insert into courses (
  id, code, title, subtitle, description,
  qualification_body, qualification_id, nqf_level, total_credits,
  outcomes, requirements, duration_months,
  pass_mark, require_all_modules, require_final_exam, issues_certificate,
  price, price_includes_vat, publication_status, published_at
)
values (
  '00000000-0000-0000-0000-0000000000c1',
  'OC-PM-101869',
  'Occupational Certificate: Project Manager',
  'SAQA ID 101869 · NQF Level 5 · 240 Credits',
  'A full occupational qualification covering the project life cycle from initiation through close-out, combining knowledge modules, practical application and workplace evidence.',
  'QCTO', '101869', 5, 240,
  array[
    'Plan, execute and close projects within scope, time and cost constraints',
    'Apply risk, quality and procurement management practices',
    'Lead project teams and manage stakeholder relationships',
    'Compile a defensible Portfolio of Evidence from workplace practice'
  ],
  array[
    'National Senior Certificate (Grade 12) or equivalent',
    'Mathematical Literacy at NQF Level 4',
    'Access to a workplace for the workplace modules'
  ],
  12,
  50.00, true, true, true,
  23800.00, true, 'PUBLISHED', now()
)
on conflict (code) do update set publication_status = 'PUBLISHED';

-- ----------------------------------------------------------------------------
-- 28 modules. Content lifted verbatim from the demo's curriculum.js.
-- ----------------------------------------------------------------------------
insert into course_modules (course_id, code, title, description, track, sequence, credits, publication_status, published_at)
select c.id, v.code, v.title, v.descr, v.track, v.seq, v.credits, 'PUBLISHED', now()
from courses c,
(values
  -- Knowledge Modules (8 credits each = 88)
  ('KM-01','Project Management Principles & Environment','Foundations of the project life cycle, PMBOK knowledge areas and the South African occupational context.','KM',1,8),
  ('KM-02','Project Scope Definition & Requirements','Scope statements, requirements elicitation, work breakdown structures and change control theory.','KM',2,8),
  ('KM-03','Project Schedule & Time Management','Activity sequencing, network diagrams, critical path method and schedule compression techniques.','KM',3,8),
  ('KM-04','Project Cost Estimation & Budgeting','Estimating techniques, cost baselines, earned value management fundamentals and cash-flow forecasting.','KM',4,8),
  ('KM-05','Project Quality Management','Quality planning, assurance vs control, ISO alignment and continuous improvement models.','KM',5,8),
  ('KM-06','Project Risk Identification & Response','Risk registers, qualitative & quantitative analysis, response strategies and contingency reserves.','KM',6,8),
  ('KM-07','Project Human Resources & Team Leadership','Team formation, RACI matrices, motivation theory, conflict resolution and performance management.','KM',7,8),
  ('KM-08','Procurement & Contract Management','Procurement planning, tender processes, contract types and supplier performance in the SA regulatory context.','KM',8,8),
  ('KM-09','Stakeholder & Communication Management','Stakeholder mapping, engagement strategies, communication plans and reporting cadences.','KM',9,8),
  ('KM-10','Project Governance, Ethics & Compliance','Governance frameworks, King IV principles, professional ethics and statutory compliance.','KM',10,8),
  ('KM-11','Project Monitoring, Evaluation & Close-Out','Performance measurement, variance analysis, lessons learned and administrative closure theory.','KM',11,8),
  -- Practical Modules (112 credits)
  ('PM-01','Develop a Project Charter & Business Case','Compile a complete charter with objectives, high-level scope, budget envelope and sponsor sign-off.','PM',12,8),
  ('PM-02','Construct a Work Breakdown Structure','Decompose a real project brief into a 4-level WBS with a supporting WBS dictionary.','PM',13,8),
  ('PM-03','Build & Baseline a Project Schedule','Produce a resourced Gantt schedule with critical path analysis and milestone baseline.','PM',14,8),
  ('PM-04','Prepare a Project Budget & Cost Baseline','Develop a bottom-up cost estimate, S-curve and funding requirements schedule.','PM',15,8),
  ('PM-05','Draft a Quality Management Plan','Define quality metrics, inspection checklists and acceptance criteria for deliverables.','PM',16,8),
  ('PM-06','Compile a Risk Register & Response Plan','Identify, score and mitigate 20+ project risks with owners and trigger conditions.','PM',17,8),
  ('PM-07','Produce a Resource & Responsibility Plan','Build an OBS, RACI matrix and resource histogram for a multi-disciplinary team.','PM',18,8),
  ('PM-08','Administer a Procurement & Tender Pack','Prepare an RFQ/RFP pack, evaluation matrix and draft contract terms.','PM',19,8),
  ('PM-09','Design a Stakeholder Engagement Plan','Map stakeholders on a power/interest grid and produce a communication matrix.','PM',20,8),
  ('PM-10','Execute Monitoring & Control Reporting','Compile earned-value dashboards, variance reports and change requests over a simulated period.','PM',21,10),
  ('PM-11','Facilitate Project Meetings & Minutes','Plan, chair and minute kickoff, progress and steering committee meetings with action registers.','PM',22,10),
  ('PM-12','Manage Issues, Changes & Escalations','Run an issue log and integrated change control cycle end-to-end with approvals.','PM',23,10),
  ('PM-13','Compile a Project Close-Out Report','Deliver a close-out report with benefits review, lessons learned and archive index.','PM',24,10),
  -- Workplace Modules (40 credits)
  ('WM-01','Workplace Project Initiation Processes','Evidence of participation in initiating a live workplace project, signed off by a workplace mentor.','WM',25,10),
  ('WM-02','Workplace Project Planning Processes','Portfolio of authentic planning artefacts produced under supervision in the workplace.','WM',26,10),
  ('WM-03','Workplace Execution, Monitoring & Control','Logbook and evidence pack demonstrating live tracking, reporting and corrective action.','WM',27,10),
  ('WM-04','Workplace Close-Out & Handover Processes','Evidence of contributing to a real project close-out, handover certificate and lessons log.','WM',28,10)
) as v(code, title, descr, track, seq, credits)
where c.code = 'OC-PM-101869'
on conflict (course_id, code) do nothing;

-- ----------------------------------------------------------------------------
-- Strict linear prerequisite chain (decision D-02).
-- Each module requires the one before it — identical behaviour to the demo's
-- isUnlocked(), but as data.
-- ----------------------------------------------------------------------------
update course_modules m
   set prerequisite_module_id = prev.id
  from course_modules prev
 where prev.course_id = m.course_id
   and prev.sequence  = m.sequence - 1
   and m.sequence > 1
   and m.prerequisite_module_id is null;

-- ----------------------------------------------------------------------------
-- Lessons. One document-based lesson per module (the demo had none at all).
-- ----------------------------------------------------------------------------
insert into lessons (module_id, title, summary, body, sequence, estimated_minutes, publication_status, published_at)
select m.id,
       m.code || ' — Study Guide',
       'Core reading for ' || m.title,
       E'## ' || m.title || E'\n\n' || m.description ||
       E'\n\nWork through the attached study guide before attempting the knowledge check. ' ||
       E'Download the documents listed under Resources; they are the assessable content for this module.',
       1, 90, 'PUBLISHED', now()
  from course_modules m
  join courses c on c.id = m.course_id
 where c.code = 'OC-PM-101869'
   and not exists (select 1 from lessons l where l.module_id = m.id);

-- ----------------------------------------------------------------------------
-- Formative assessments — one knowledge check per module, 50% pass mark,
-- unlimited retries (matching the demo's behaviour).
-- ----------------------------------------------------------------------------
insert into formative_assessments (
  module_id, title, instructions, pass_mark, max_attempts, is_required,
  feedback_policy, show_correct_answers, publication_status, published_at
)
select m.id,
       m.code || ' Knowledge Check',
       'Answer every question. The pass mark is 50%. You may retry as often as you need — your best result is retained.',
       50.00, null, true, 'AFTER_SUBMIT', true, 'PUBLISHED', now()
  from course_modules m
  join courses c on c.id = m.course_id
 where c.code = 'OC-PM-101869'
   and not exists (select 1 from formative_assessments fa where fa.module_id = m.id);

-- ----------------------------------------------------------------------------
-- Question bank.
--
-- The 12 real questions from the demo's QUIZ_BANK (KM-01, KM-02) plus the
-- 6-question GENERIC_QUIZ applied to every other module — same content the
-- demo shipped, except the answers now live server-side.
-- ----------------------------------------------------------------------------
create temporary table _qbank (
  module_code text,
  seq         integer,
  prompt      text,
  opts        text[],
  correct_ix  integer      -- 0-based, as in the demo's `answer` field
) on commit drop;

insert into _qbank values
-- KM-01
('KM-01',1,'Which sequence correctly orders the project life-cycle phases?',
 array['Planning → Initiation → Execution → Closure','Initiation → Planning → Execution → Monitoring & Control → Closure','Execution → Planning → Closure → Initiation','Monitoring → Closure → Planning → Execution'],1),
('KM-01',2,'A project differs from operations primarily because a project is…',
 array['Permanent and repetitive','Temporary and unique','Always IT-related','Never budget-constrained'],1),
('KM-01',3,'The "triple constraint" of project management refers to…',
 array['People, process, technology','Scope, time, cost','Risk, quality, procurement','Sponsor, PM, team'],1),
('KM-01',4,'Who is accountable for realising the business benefits of a project?',
 array['The project sponsor','The intern','The procurement officer','The QA tester'],0),
('KM-01',5,'NQF Level 5 qualifications in South Africa are registered by…',
 array['SARS','SAQA','CIPC','NPA'],1),
('KM-01',6,'A programme is best described as…',
 array['A single small task','A group of related projects managed in a coordinated way','An operational department','A procurement contract'],1),
-- KM-02
('KM-02',1,'The WBS decomposes the project into…',
 array['Risk categories','Deliverable-oriented work packages','Stakeholder groups','Invoice line items'],1),
('KM-02',2,'"Gold plating" refers to…',
 array['Adding un-requested extras to deliverables','Formal change control','Budget contingency','Quality assurance'],0),
('KM-02',3,'Scope creep is best prevented by…',
 array['Ignoring stakeholders','A formal integrated change control process','Removing the schedule','Doubling the budget'],1),
('KM-02',4,'Requirements should be captured in a…',
 array['Risk register','Requirements traceability matrix','Payslip','Tender advert'],1),
('KM-02',5,'The scope baseline consists of the scope statement, WBS and…',
 array['WBS dictionary','Org chart','Payment schedule','Meeting minutes'],0),
('KM-02',6,'Verifying scope means…',
 array['Formal acceptance of deliverables by the customer','Auditing supplier invoices','Hiring the team','Writing the charter'],0);

-- Generic bank for the remaining 26 modules.
insert into _qbank
select m.code, g.seq, g.prompt, g.opts, g.ix
  from course_modules m
  join courses c on c.id = m.course_id
  cross join (values
    (1,'Within this module, the primary output must be formally…',
       array['Ignored','Baselined and placed under change control','Deleted after use','Outsourced without review'],1),
    (2,'Who approves formal changes to a baselined plan?',
       array['Any team member','The change control board / sponsor','The office cleaner','No one'],1),
    (3,'A variance between planned and actual performance should trigger…',
       array['Analysis and corrective action','Silence','Deleting the baseline','Blaming suppliers'],0),
    (4,'Lessons learned should be captured…',
       array['Never','Only at project start','Throughout the project and at close-out','Only by auditors'],2),
    (5,'Effective stakeholder communication should be…',
       array['Ad hoc and undocumented','Planned, targeted and recorded','Avoided','Limited to invoices'],1),
    (6,'The minimum competent pass mark for this qualification is…',
       array['30%','40%','50%','90%'],2)
  ) as g(seq, prompt, opts, ix)
 where c.code = 'OC-PM-101869'
   and m.code not in ('KM-01','KM-02');

-- Materialise questions.
insert into formative_questions (assessment_id, question_type, prompt, points, sequence, is_active)
select fa.id, 'MULTIPLE_CHOICE', q.prompt, 1, q.seq, true
  from _qbank q
  join course_modules m on m.code = q.module_code
  join formative_assessments fa on fa.module_id = m.id
  join courses c on c.id = m.course_id
 where c.code = 'OC-PM-101869'
   and not exists (
     select 1 from formative_questions fq
      where fq.assessment_id = fa.id and fq.sequence = q.seq);

-- Materialise options. is_correct is set here and never leaves the database.
insert into formative_options (question_id, label, is_correct, sequence)
select fq.id,
       o.label,
       (o.ord - 1) = q.correct_ix,
       o.ord
  from _qbank q
  join course_modules m on m.code = q.module_code
  join formative_assessments fa on fa.module_id = m.id
  join formative_questions fq on fq.assessment_id = fa.id and fq.sequence = q.seq
  join courses c on c.id = m.course_id
  cross join lateral unnest(q.opts) with ordinality as o(label, ord)
 where c.code = 'OC-PM-101869'
   and not exists (
     select 1 from formative_options fo
      where fo.question_id = fq.id and fo.sequence = o.ord);

-- ----------------------------------------------------------------------------
-- Rubric for practical and workplace assessment.
-- ----------------------------------------------------------------------------
insert into rubrics (code, title, description)
values ('RUB-PM-STD', 'Standard Practical Assessment Rubric',
        'Applied to practical (PM) and workplace (WM) module submissions.')
on conflict (code) do nothing;

insert into rubric_criteria (rubric_id, title, description, max_points, weight, sequence)
select r.id, v.title, v.descr, v.pts, 1, v.seq
  from rubrics r,
  (values
    ('Completeness',       'All required deliverables are present and address the brief.', 25, 1),
    ('Technical accuracy', 'Correct application of project management method and terminology.', 25, 2),
    ('Evidence quality',   'Artefacts are authentic, legible and appropriately referenced.', 25, 3),
    ('Professional presentation', 'Structure, clarity and adherence to the supplied template.', 25, 4)
  ) as v(title, descr, pts, seq)
 where r.code = 'RUB-PM-STD'
   and not exists (select 1 from rubric_criteria rc where rc.rubric_id = r.id and rc.sequence = v.seq);

-- ----------------------------------------------------------------------------
-- Summative assessments.
--   KM modules → no summative (knowledge check only), matching the demo.
--   PM modules → practical assignment, rubric-graded.
--   WM modules → Portfolio of Evidence.
-- ----------------------------------------------------------------------------
update course_modules m
   set require_summative = false
  from courses c
 where c.id = m.course_id and c.code = 'OC-PM-101869' and m.track = 'KM';

insert into summative_assessments (
  module_id, title, instructions, task_brief, pass_mark, max_attempts,
  requires_submission, min_files, max_files, allow_resubmission,
  question_weight, submission_weight, rubric_id, publication_status, published_at
)
select m.id,
       m.code || case when m.track = 'WM' then ' Portfolio of Evidence' else ' Practical Assignment' end,
       'Complete the task described below and upload your evidence. A registered assessor will mark your submission against the rubric. The pass mark is 50%.',
       m.description,
       50.00, 3, true, 1, 5, true,
       0, 100, r.id, 'PUBLISHED', now()
  from course_modules m
  join courses c on c.id = m.course_id
  join rubrics r on r.code = 'RUB-PM-STD'
 where c.code = 'OC-PM-101869'
   and m.track in ('PM','WM')
   and not exists (select 1 from summative_assessments sa where sa.module_id = m.id);

-- Mark the workplace submissions as Portfolio of Evidence.
insert into assignments (module_id, summative_assessment_id, code, title, brief, is_poe)
select m.id, sa.id, m.code || '-POE', sa.title, m.description, true
  from summative_assessments sa
  join course_modules m on m.id = sa.module_id
  join courses c on c.id = m.course_id
 where c.code = 'OC-PM-101869' and m.track = 'WM'
   and not exists (select 1 from assignments a where a.summative_assessment_id = sa.id);

-- ----------------------------------------------------------------------------
-- Final examination (new — decision D-04).
-- ----------------------------------------------------------------------------
insert into final_exams (
  course_id, title, instructions,
  duration_minutes, pass_mark, max_attempts, retake_wait_hours,
  questions_per_attempt, shuffle_questions, shuffle_options,
  require_all_modules, require_formatives, require_summatives, require_poe,
  require_payment_cleared, require_documents_verified,
  publication_status, published_at
)
select c.id,
       'Final Integrated Examination — Project Manager',
       'This examination integrates all 28 modules. You have 2 hours. The pass mark is 50%. Once started, the timer cannot be paused.',
       120, 50.00, 2, 24,
       20, true, true,
       true, true, true, true,
       true, true,
       'PUBLISHED', now()
  from courses c
 where c.code = 'OC-PM-101869'
on conflict (course_id) do nothing;

-- Exam bank: draws one integrating question per module.
insert into final_exam_questions (exam_id, module_id, question_type, prompt, points, sequence, is_active)
select fe.id, m.id, 'MULTIPLE_CHOICE',
       format('(%s) In the context of %s, which statement best reflects competent practice?', m.code, m.title),
       1, m.sequence, true
  from final_exams fe
  join courses c on c.id = fe.course_id
  join course_modules m on m.course_id = c.id
 where c.code = 'OC-PM-101869'
   and not exists (select 1 from final_exam_questions q where q.exam_id = fe.id and q.sequence = m.sequence);

insert into final_exam_options (question_id, label, is_correct, sequence)
select q.id, o.label, o.ord = 2, o.ord
  from final_exam_questions q
  cross join lateral (values
    ('The activity is performed informally and left undocumented.', 1),
    ('The activity is planned, executed against a baseline, documented and reviewed.', 2),
    ('The activity is delegated without oversight or acceptance criteria.', 3),
    ('The activity is skipped when the schedule is under pressure.', 4)
  ) as o(label, ord)
 where not exists (select 1 from final_exam_options fo where fo.question_id = q.id and fo.sequence = o.ord);

commit;

-- ============================================================================
-- DEVELOPMENT ACCOUNTS
--
-- Deliberately NOT created here. Passwords must never live in a SQL file
-- (audit S-01, S-02) and Supabase Auth owns credential storage.
--
-- Create them through the Auth API or the Supabase dashboard, then grant the
-- staff roles. app.handle_new_user() creates the profile and grants LEARNER
-- automatically; run the block below afterwards to add staff roles.
--
--   supabase auth admin create-user admin@mntungwa.co.za  --password '<strong>'
--   supabase auth admin create-user assessor@mntungwa.co.za --password '<strong>'
--   supabase auth admin create-user finance@mntungwa.co.za  --password '<strong>'
--
-- Then:
--
--   insert into user_roles (profile_id, role)
--   select id, 'ADMIN'::app_role    from profiles where email = 'admin@mntungwa.co.za'
--   on conflict do nothing;
--
--   insert into user_roles (profile_id, role)
--   select id, 'ASSESSOR'::app_role from profiles where email = 'assessor@mntungwa.co.za'
--   on conflict do nothing;
--
--   insert into user_roles (profile_id, role)
--   select id, 'FINANCE'::app_role  from profiles where email = 'finance@mntungwa.co.za'
--   on conflict do nothing;
--
--   update profiles set account_status = 'ACTIVE'
--    where email in ('admin@mntungwa.co.za','assessor@mntungwa.co.za','finance@mntungwa.co.za');
--
-- See docs/SUPABASE_SETUP.md step 13.
-- ============================================================================
