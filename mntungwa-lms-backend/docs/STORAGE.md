# STORAGE.md

Supabase Storage buckets, path conventions and access policies.

---

## Buckets

| Bucket | Public | Contents | Write |
|---|---|---|---|
| `learning-resources` | no | study guides, templates, worksheets | academic staff |
| `learner-submissions` | no | assignments, PoE evidence | owning learner |
| `payment-proofs` | no | proof-of-payment uploads | owning learner |
| `certificates` | no | generated certificate PDFs | Edge Function only |
| `institution-assets` | **yes** | logo, letterhead | admin |

Only `institution-assets` is public, because a logo appears on the public site.
Everything else is private and reached through signed URLs.

---

## Path conventions

**Policies match on path segments, so paths are load-bearing.** The first
segment is always the ownership anchor. Generate them from one shared helper in
the applications — if the format drifts, access checks fail silently (risk
R-04).

```
learning-resources   {course_id}/{module_id}/{lesson_id|_}/{uuid}-{filename}
learner-submissions  {enrollment_id}/{assessment_id}/{staging_id}/{uuid}-{filename}
payment-proofs       {profile_id}/{invoice_id}/{uuid}-{filename}
certificates         {certificate_number}.pdf
institution-assets   branding/{uuid}-{filename}
```

For `learner-submissions`, segment 3 is a **client-generated staging UUID**, not
the `submission_versions` id. Files are uploaded first, then
`finalize_submission_version()` creates the version row and every
`submission_files` row in one transaction (migration 022). The version id
therefore does not exist at upload time; only segments 1 and 2 are checked by
policy, and the finalize function additionally rejects any path outside
`{enrollment_id}/{assessment_id}/`.

`storage.foldername(name)` returns the segments as a 1-indexed array, which is
how the policies read them:

```sql
app.owns_enrollment((storage.foldername(name))[1]::uuid)
```

The `{uuid}-` prefix on filenames prevents collisions and stops a learner
overwriting an existing object by re-uploading the same name.

---

## Access rules

### learning-resources

Read is delegated to `app.can_access_resource()` — the same function the
`learning_resources` table policy uses. Reusing it means the file rule and the
row rule cannot drift apart: if a learner can see the metadata, they can fetch
the file, and not otherwise.

That function preserves the demo's behaviour that resources unlock together
with their module (audit §2.3), extended to lesson- and course-scoped
resources.

Write, update: academic staff. Delete: admin only.

### learner-submissions

Read: the owning learner, any assessor, or an admin.
Write: **only under the learner's own enrollment folder.**

```sql
with check (
  bucket_id = 'learner-submissions'
  and app.owns_enrollment((storage.foldername(name))[1]::uuid)
)
```

This is what satisfies the brief's requirement that "a learner should only
upload submissions belonging to their own enrollment/assessment".

There is deliberately **no UPDATE policy**: submitted evidence is immutable. A
correction is a new `submission_version`, so the moderation trail survives.

Delete has two policies. `learner_submissions_delete` (admin only) is for
genuine removals. `learner_submissions_delete_orphan` (migration 022) lets a
learner remove an object in **their own** enrollment folder **only while no
`submission_files` row references it** — i.e. an object left behind when a
multi-file upload failed before `finalize_submission_version()` recorded it.
Once finalised, the object is referenced and this policy no longer matches, so
attached evidence stays as immutable as before.

### payment-proofs

First segment is the `profile_id`. A learner reads and writes only their own;
finance reads all.

### certificates

Written by an Edge Function using the service-role key, so no end-user INSERT
policy exists. Learners read their own. Public verification is served by a
signed URL minted after `verify_certificate()` succeeds — the bucket itself is
never public.

---

## Upload validation

`app.validate_resource_upload()` runs `BEFORE INSERT` on `storage.objects` and
enforces the institution's MIME allow-list and size caps from
`institution_settings`:

| | Default cap | Allow-list |
|---|---|---|
| `learning-resources` | 50 MB | PDF, DOCX, PPTX, XLSX, DOC, XLS, PPT, TXT, PNG, JPEG, WebP |
| `learner-submissions`, `payment-proofs` | 25 MB | PDF, DOCX, XLSX, PNG, JPEG, ZIP |

Client-side validation is a convenience for the user; this trigger is the
control. Both lists are stored as arrays in `institution_settings`, so an admin
can adjust them without a migration.

**Video is excluded by design.** `learning_resources` additionally carries
`check (mime_type not like 'video/%')`. This is a document-based LMS (audit
§8.2).

---

## Signed URLs

Private buckets are read through short-lived signed URLs:

```ts
const { data } = await supabase.storage
  .from('learning-resources')
  .createSignedUrl(path, 300);   // 5 minutes
```

Generate on demand, never persist. The storage policy is still evaluated when
the URL is minted, so an unauthorised caller cannot obtain one.

---

## Versioning

`learning_resources` carries `version`, `replaces_id`, `is_archived`,
`archived_at` and `archived_by`. Replacing a document uploads a new object,
inserts a new row pointing at the old one via `replaces_id`, and archives the
previous row rather than deleting the file. Learners see only
`is_archived = false`; staff retain the history.

---

## Deployment note

On hosted Supabase the `storage` schema is owned by `supabase_storage_admin`.
Some CLI versions cannot alter it via `db push`. If migration `019` fails, run
it directly in the SQL Editor as project owner.

**These policies have not yet been executed against a hosted project.** The
local shim reproduces `storage.objects` and `storage.foldername()` well enough
to check the SQL parses and the logic is coherent, but real Storage behaviour
must be confirmed on Supabase before this is considered done.
