# Batch system updates

Open **Systems → Batch Updates**, then choose **Pending L11 Logs** or
**Pending MRB**. Their bulk destinations are RMA PID and RMA CID, respectively.

Search service tags to filter the pending queue. Click the Service Tag or
L11 Logs/MRB Approval column header to sort; click again to reverse the order.
**Select All**, **Select Movable**, and **Select Pending** apply to the rows
currently shown. Filtering does not clear existing selections; the selected count
and upload summaries include hidden selected rows. Use **Clear Selection** to
start over.

## Unified submission

Choose a shared approval document or L11 archive to stage it. Choosing the shared
file does not upload it yet. The upload section lists two groups, updated immediately
as checkboxes change:

- **Will receive evidence:** selected units missing current evidence.
- **Evidence already on file:** selected units that will not receive another file,
  but can move when a movement note is supplied and validation passes.

The single submission button adapts to the work selected:

| Evidence to upload | Movement note | Action |
| --- | --- | --- |
| None | Entered | Submit Bulk Movement |
| MRB document | Entered | Apply MRB Approval & Move |
| MRB document | Empty | Apply MRB Approval |
| L11 archive | Entered | Upload L11 Logs & Move |
| L11 archive | Empty | Upload L11 Logs |

Without an upload, movement is disabled while selected units are blocked. With an
upload and a note, evidence is uploaded first, then the selected units are checked
again. Eligible units move; failed uploads and remaining blockers are reported
per unit. Units with existing evidence never receive a duplicate upload. If no
selected unit needs evidence, only movement is offered when a note is present.
Each movement uses a separate transaction and preserves successful results.
History includes the common note, acting user, destination, and assigned pallet.
Use **Download RMA labels** for a combined PDF of successful movements.

An individual row upload starts immediately after selecting its file. Its buttons
are disabled while the row is checked for bulk work. Staging a shared file disables
all individual upload/scan buttons; remove the shared file to use those again.
While any individual or bulk operation runs, selection and shared setup are locked.
Switching between the MRB and L11 queues clears the staged file, selection, and note.

## L11 logs

L11 eligibility requires an archive matching the unit's service tag and current
rack tag, modified after the latest Received event. This is enforced for individual
and batch moves from Pending L11 Logs to RMA PID. Moving back to In Debug - Wistron
is still allowed without logs.

Each row has side-by-side **Upload L11 Logs** and **Scan L11 Logs** buttons.
**Choose L11 archive** supports ZIP, TAR, TAR.GZ and TGZ:

```text
batch.zip
  ABC1234/
    log1.txt
    log2.log
  DEF5678/
    nested-folder/
      log3.txt
```

The uploader automatically detects service-tag folders at the archive root or inside
one parent folder, using known service tags. Both layouts work without a setting:

```text
batch.zip
  collection/
    ABC1234/
      log1.txt
    DEF5678/
      log2.txt
```

Choosing an archive calls the authenticated `POST /systems/batch-updates/l11-archive/preview`
endpoint with `archive`. It inspects folder metadata without extracting logs or creating
per-unit TGZs, and reports matched tags and skipped folders with reasons. Matching
Pending L11 Logs units with missing logs, a valid rack, and Received history replace
the current selection. Users can adjust checkboxes before submitting. In Pending L11 Logs, only units with
current logs or matching logs in the staged archive can be checked; selection buttons
count only those units. Removing the archive clears selections that depended on it. The temporary
preview upload is deleted; submission sends the archive again and rechecks each unit.

Archive uploads process only selected units missing logs. Extra service-tag folders
are ignored, and selected tags without an archive folder are reported. This selection
is enforced by the backend: the archive endpoint requires `service_tags` alongside
`archive`. If known tags appear at both folder levels, the upload is rejected
with instructions to place service-tag folders directly at the archive root. Unknown tags, units outside Pending L11 Logs, missing/invalid
rack tags, and units with current logs are skipped and reported. Missing Received
history also blocks upload. Each accepted folder becomes the existing
`L11_logs_ST_<SERVICE_TAG>_RT_<RACK_TAG>.tgz` format. Archives are unpacked in an
isolated temporary directory; links, unsafe paths, duplicate filenames and
configured size/count violations are rejected before publishing any unit's files.

## MRB approvals

On a Pending MRB unit, use **Upload MRB Approval**. In the batch queue, select the
units covered by a shared approval and use **Choose MRB approval**. Review the
document name and the live target lists inside the upload section before submitting. A copy
is stored under each unit's `MRB Approvals` folder. Units with a current approval
are skipped; existing documents are preserved.

Supported files: JPEG, PNG, WebP, HEIC/HEIF, PDF, Outlook `.msg`, and `.eml`.
Extensions and basic file signatures/email headers are validated. The application
records proof supplied by the operator; it does not interpret an email's approval
wording or determine which service tags the document covers.

Every move to RMA CID requires an approval uploaded **after the latest Received
event**. Previous-cycle documents remain downloadable but do not qualify. Damage
photos, PPID details, recent good-part restrictions, and locked-pallet restrictions
still apply. MRB approval folders are excluded from L10 folder listings and L10-only
batch exports; the full unit export includes them.

## Deployment and configuration

Deploy **both frontend and backend**. Rebuild the backend Docker image: it now
installs Python 3 for standard-library ZIP/TAR processing. A non-Docker backend
needs `python3` (Python 3.9+) and the existing `tar` command. No database migration
is required. Approval documents and L11 archives use the existing `L10_LOGS_ROOT`
volume.

Backend environment settings (restart the backend after changing them):

| Setting | Default | Purpose |
| --- | --- | --- |
| `BATCH_L11_MAX_ARCHIVE_BYTES` | 1073741824 (1 GiB) | Compressed upload size |
| `BATCH_L11_MAX_EXPANDED_BYTES` | 5368709120 (5 GiB) | Total decompressed file bytes |
| `BATCH_L11_MAX_FILES` | 10000 | Files in an archive |
| `BATCH_UPDATE_MAX_SYSTEMS` | 500 | Units per movement, shared approval, or archive |
| `MRB_APPROVAL_MAX_BYTES` | 26214400 (25 MiB) | One approval document |
| `PYTHON_BIN` | `python3` | Python executable |

Invalid/nonpositive limits use their defaults. The queue reports the active limits
in its upload guide. Archive extraction also has a 10-minute timeout. Configure the
reverse proxy's request-body limit and request timeout to accommodate the chosen
limits and expected batch processing time. Uploads use temporary disk storage;
allow room for the compressed input, extracted logs, and generated unit archives.

## Verification

```sh
cd website_backend
npm run test:batch
cd ../website_frontend
npm run test:batch
```

Tests cover eligibility and freshness, shared movement transactions, selected-only
updates and notes, mixed results, unified upload/move sequencing, partial-failure
reporting, shared approval upload, selected-only L11 archive upload,
ZIP/TAR formats, wrapper layouts, traversal/link rejection and size/count limits.
Database operations use fixtures; these tests do not connect to a production site.

## Persistent L11 scans

Apply `0016-persistent-l11-scans.sql` before deploying the updated backend and frontend.
New system creation, every new Received movement (including unchanged racks), rack
changes, individual scans, and batch scans all enqueue records in `l11_scan_job`.
Creation, Received history and rack changes enqueue in their database transaction.
An existing active job for the same unit, Received event and rack is reused.

The backend worker processes the saved queue sequentially, protected by a PostgreSQL
advisory lock across API instances. Runner IDs, output and results persist, and the
worker resumes polling after a restart. Browser pages poll saved records, so closing
the tab no longer stops a batch. The batch endpoint uses the entire Pending L11 queue,
not the currently filtered or checked rows.

`GET /systems/:tag/l11-scans` returns the latest 100 attempts with trigger, requesting
user, rack, Received context, timestamps and runner details. Scan History is inside
Logs. Old-context attempts remain in history, but do not replace the current status;
queued outdated attempts are skipped. Delayed output from scans started in an earlier
Received cycle cannot count as fresh evidence during that scan's execution window.

`POST /systems/batch-updates/l11-scans` queues all units missing logs that have racks;
`GET` on that path returns each pending unit's latest current-context job. Existing
individual start/status endpoints now use persistent application job IDs; runner IDs
are retained separately. Jobs launched before this migration cannot be reconstructed.

If the runner accepted a job but its acknowledgement was lost, automatically retrying
could duplicate it. The record is marked **Needs review**, and further queued jobs for
that unit wait for runner reconciliation. Other units continue. Runner status outages
are retried; a runner job that has disappeared also requires review. Raw runner details
are available in history, while normal messages omit script prefixes.

## Evidence success notes

Apply `0017-evidence-history.sql` with this update. It adds a non-login **System**
identity and an optional unique scan-job reference on history entries.

Successful manual L11 uploads (single and batch) MRB approval uploads, and support-photo uploads create a
same-location history note attributed to the uploader. Successful runner downloads
create a System note only when the expected rack archive exists, is nonempty, and
was written since the scan started. Failed or no-match scans create no success note.
The worker commits its result and history note together; a scan-job reference prevents
duplicates if a result is processed again. Existing completed jobs are not backfilled.

Received-cycle lookup/counts exclude same-location entries in the API, scan queue,
unit page and shipping reports. Deleting a same-location note does not roll back
location, pallet, root-cause or unit-tag state. Unit history refreshes after evidence
uploads and scan completion.
