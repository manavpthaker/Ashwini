/** Public literature retrieval. Search terms come only from this vocabulary,
 * never from a check-in, name, location, imported record, or model output. */
export const RESEARCH_TOPICS = {
  sleep: "sleep restriction recovery adults",
  nutrition: "dietary protein energy restriction resistance training adults",
  training: "resistance training exercise adherence adults",
  focus: "adult attention deficit hyperactivity disorder behavioral interventions",
  caffeine: "caffeine sleep adults",
  fatigue: "fatigue lifestyle sleep physical activity adults",
} as const;
export type ResearchTopic = keyof typeof RESEARCH_TOPICS;

export interface ResearchArticle {
  id: string;
  title: string;
  year: string;
  url: string;
  publicationTypes: string[];
  abstract: string;
}
export interface ResearchBundle {
  status: "retrieved" | "unavailable" | "not_requested";
  articles: ResearchArticle[];
  checkedAt: string;
  sourceId?: string;
}

export function topicsForCheckin(text: string): ResearchTopic[] {
  const matches: ResearchTopic[] = [];
  if (/\b(sleep|slept|tired|recovery|insomnia)\b/i.test(text)) matches.push("sleep");
  if (/\b(food|meal|ate|eat|lunch|dinner|protein|diet|calories|nutrition)\b/i.test(text))
    matches.push("nutrition");
  if (/\b(train|training|workout|exercise|gym|lifting)\b/i.test(text)) matches.push("training");
  if (/\b(adhd|focus|attention|concentrat\w*)\b/i.test(text)) matches.push("focus");
  if (/\b(caffeine|coffee)\b/i.test(text)) matches.push("caffeine");
  if (/\b(fatigue|exhausted|energy)\b/i.test(text)) matches.push("fatigue");
  return matches.slice(0, 2);
}

export async function fetchHealthResearch(
  topics: readonly ResearchTopic[],
  now: Date,
  fetcher: typeof fetch = fetch,
): Promise<ResearchBundle> {
  const checkedAt = now.toISOString();
  if (!topics.length) return { status: "not_requested", articles: [], checkedAt };
  try {
    const articles = await Promise.all(
      topics.slice(0, 2).map(async (topic) => {
        // No geographic or date cutoff: retrieve across the index, not only US/recent work.
        const query = `(${RESEARCH_TOPICS[topic]}) AND SRC:MED AND (PUB_TYPE:"Systematic Review" OR PUB_TYPE:"Meta-Analysis" OR PUB_TYPE:"Review")`;
        const url = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
        url.search = new URLSearchParams({
          query,
          format: "json",
          resultType: "core",
          pageSize: "3",
        }).toString();
        const response = await fetcher(url, {
          signal: AbortSignal.timeout(6_000),
          cache: "no-store",
          redirect: "error",
        });
        if (!response.ok) throw new Error("Research unavailable");
        const payload = (await response.json()) as {
          resultList?: { result?: Array<Record<string, unknown>> };
        };
        return (payload.resultList?.result ?? []).flatMap((row): ResearchArticle[] => {
          if (
            typeof row.id !== "string" ||
            !/^\d+$/.test(row.id) ||
            typeof row.title !== "string" ||
            typeof row.abstractText !== "string"
          )
            return [];
          const types = (row.pubTypeList as { pubType?: unknown } | undefined)?.pubType;
          const publicationTypes = Array.isArray(types)
            ? types.filter((v): v is string => typeof v === "string")
            : [];
          if (publicationTypes.some((type) => /retracted/i.test(type))) return [];
          return [
            {
              id: row.id,
              title: row.title,
              year: String(row.pubYear ?? "unknown"),
              url: `https://pubmed.ncbi.nlm.nih.gov/${row.id}/`,
              publicationTypes,
              abstract: row.abstractText.replace(/<[^>]*>/g, " ").slice(0, 8_000),
            },
          ];
        });
      }),
    );
    const unique = [...new Map(articles.flat().map((article) => [article.id, article])).values()];
    return { status: unique.length ? "retrieved" : "unavailable", articles: unique, checkedAt };
  } catch {
    return { status: "unavailable", articles: [], checkedAt };
  }
}
