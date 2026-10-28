-- Revisions (docs/PRICING.md). A film's start fee covers a few changes after it was first made (recreating the preview from an
-- edited script, applying a comment in the Preview); further ones cost tokens. Counted per person, period and project, in the row
-- the preview allowance (010) already keeps.
alter table app.preview_usage add column revisions integer not null default 0;
