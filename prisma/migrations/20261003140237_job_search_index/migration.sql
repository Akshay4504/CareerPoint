-- Full-text search: generated, weighted tsvector (title > company/role > description), indexed with GIN.
ALTER TABLE "Job" ADD COLUMN "search" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("companyName", '') || ' ' || coalesce("bimRole", '') || ' ' || coalesce("location", '')), 'B') ||
    setweight(to_tsvector('english', left(coalesce("description", ''), 20000)), 'C')
  ) STORED;

CREATE INDEX "Job_search_idx" ON "Job" USING GIN ("search");
