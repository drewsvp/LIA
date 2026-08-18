-- Track how many sweep-triggered retries have been attempted for each need's
-- image sourcing.  The column starts at 0 (no retries yet) and is incremented
-- atomically when the image-sweep job claims a failed or stranded row.  This
-- gives the sweep a durable, DB-enforced cap so a persistently-failing need
-- stops being retried after MAX_RETRIES attempts while staying visible on the
-- admin panel via image_gen_status = 'failed'.
alter table item_requests
  add column image_gen_retries int not null default 0;
