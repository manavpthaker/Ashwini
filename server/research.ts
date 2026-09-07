import "server-only";
import { fetchHealthResearch, topicsForCheckin, type ResearchBundle } from "@/lib/health-research";
import { db } from "./db/client";

export async function researchForCheckin(text: string, now: Date): Promise<ResearchBundle> {
  const topics = topicsForCheckin(text);
  const bundle = await fetchHealthResearch(topics, now);
  if (bundle.status !== "retrieved") return bundle;
  // Retain bibliographic provenance, not copyrighted abstracts or private queries.
  const references = bundle.articles.map((article) => ({
    id: article.id,
    title: article.title,
    year: article.year,
    url: article.url,
    publicationTypes: article.publicationTypes,
  }));
  const result = await db()
    .insertInto("ashwini.external_results")
    .values({
      provider: "Europe PMC",
      items: topics,
      query: JSON.stringify({ topics }),
      requested_ts: now,
      response: JSON.stringify({ status: bundle.status }),
      evidence_grade: "Retrieved literature; applicability not independently appraised",
      references: JSON.stringify(references),
      license_note:
        "Bibliographic metadata only; abstracts used transiently for synthesis, not retained.",
      cache_expires_at: null,
      http_status: 200,
      error: null,
    })
    .returning("result_id")
    .executeTakeFirstOrThrow();
  return { ...bundle, sourceId: result.result_id };
}
